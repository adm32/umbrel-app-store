// Zala Studio (zalastudio.hu, formerly admcore.hu) – web server for Umbrel.
//
// A single static Go program (like the Vadvirág apps). The website files are compiled into it.
//
// Public (port 8080, behind Umbrel's app proxy / Cloudflare Tunnel):
//
//	GET  /...                 the website
//	POST /api/ajanlatkeres    request from the planner (JSON) or the no-JS form (urlencoded)
//	POST /api/e               page statistics (counts; with cookie consent also a per-visitor record, see cookies.go)
//	POST /api/consent         the visitor's cookie choice from the banner
//	GET  /api/info            { spots, vat } – remaining launch-discount places, VAT wording
//	GET  /fizetes/{kod}       payment page for a client (link sent from the Irányítópult)
//	POST /fizetes/{kod}       accepts the terms, then redirects to Stripe Checkout
//	GET  /fizetes/kesz        thank-you page after a successful payment
//	GET  /elofizetes          redirect to the Stripe customer portal (card, invoices)
//	POST /stripe/webhook      Stripe webhooks, passed unchanged to the Irányítópult (it checks the signature)
//
// Internal (port 9095, only reachable from other containers on the Umbrel, never published):
//
//	GET  /stats               aggregated statistics (no personal data) for the Irányítópult app
//	GET  /health              status of the outbox
//	POST /config              { spots, vat, portal } – set by the Irányítópult
//
// Page visits on the old address (admcore.hu) and on www.zalastudio.hu get a permanent redirect
// to https://zalastudio.hu (SITE_URL) – from the first visit that arrives on zalastudio.hu on.
// POST requests (webhooks, forms) are served on every address.
//
// Requests are saved to DATA_DIR/outbox.json first, then handed to the Irányítópult (DASH_INGEST).
// Until that succeeds they stay in the outbox and are retried every minute. If the Irányítópult
// can't be reached, a push notification goes out through ntfy instead (NTFY_URL or data/ntfy-url.txt).
package main

import (
	"embed"
	"encoding/json"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"runtime/debug"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
	_ "time/tzdata"
)

//go:embed www
var wwwFS embed.FS

var (
	dataDir      = env("DATA_DIR", "/data")
	port         = env("PORT", "8080")
	internalPort = env("INTERNAL_PORT", "9095")
	dashIngest   = env("DASH_INGEST", "http://adam-core-iranyitopult_web_1:9097/ingest")
	appVersion   = env("APP_VERSION", "")
	siteURL      = strings.TrimRight(env("SITE_URL", "https://zalastudio.hu"), "/")
	oldHosts     = hostSet(env("OLD_HOSTS", "admcore.hu,www.admcore.hu,www.zalastudio.hu"))
	newHost      = strings.TrimPrefix(strings.TrimPrefix(siteURL, "https://"), "http://")
	// Old addresses are only redirected once a visit has arrived on the new domain, so updating
	// the app before zalastudio.hu is set up in Cloudflare never sends visitors to a dead address.
	newHostSeen atomic.Bool
	budapest, _ = time.LoadLocation("Europe/Budapest")
	httpc       = &http.Client{Timeout: 10 * time.Second}
)

func hostSet(list string) map[string]bool {
	m := map[string]bool{}
	for _, h := range strings.Split(list, ",") {
		if h = strings.ToLower(strings.TrimSpace(h)); h != "" {
			m[h] = true
		}
	}
	return m
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

// ---------- servers ----------

func public(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if e := recover(); e != nil {
			log.Print("panic: ", e)
		}
	}()
	secHeaders(w)
	p := r.URL.Path
	if r.Method == "GET" || r.Method == "HEAD" {
		host := strings.ToLower(r.Host)
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		if host == newHost && !newHostSeen.Load() {
			// The new domain reaches this app, so it is safe to send the old address there.
			newHostSeen.Store(true)
			os.WriteFile(filepath.Join(dataDir, "uj-domain.txt"), []byte(newHost+" "+time.Now().Format(time.RFC3339)+"\n"), 0o600)
			log.Print("new domain is live: ", newHost, " – old addresses now redirect here")
		}
		if oldHosts[host] && p != "/healthz" && newHostSeen.Load() {
			http.Redirect(w, r, siteURL+r.URL.RequestURI(), http.StatusMovedPermanently)
			return
		}
	}
	switch p {
	case "/api/ajanlatkeres":
		if r.Method != "POST" {
			w.Header().Set("Allow", "POST")
			w.WriteHeader(405)
			return
		}
		handleLead(w, r)
		return
	case "/api/consent":
		if r.Method != "POST" {
			w.Header().Set("Allow", "POST")
			w.WriteHeader(405)
			return
		}
		handleConsent(w, r)
		return
	case "/api/e":
		if r.Method != "POST" {
			w.Header().Set("Allow", "POST")
			w.WriteHeader(405)
			return
		}
		handleEvent(w, r)
		return
	case "/api/info":
		cfgMu.Lock()
		n, vat := max(0, config.Spots), config.Vat
		cfgMu.Unlock()
		w.Header().Set("Cache-Control", "public, max-age=60")
		sendJSON(w, 200, map[string]any{"spots": n, "vat": vat})
		return
	case "/stripe/webhook":
		if r.Method != "POST" {
			w.Header().Set("Allow", "POST")
			w.WriteHeader(405)
			return
		}
		relayWebhook(w, r)
		return
	case "/elofizetes":
		portalRedirect(w, r)
		return
	case "/elallas":
		withdrawPage(w, r)
		return
	case "/healthz":
		w.Header().Set("Content-Type", "text/plain")
		io.WriteString(w, "ok")
		return
	}
	if strings.HasPrefix(p, "/fizetes/") {
		payPage(w, r, strings.TrimPrefix(p, "/fizetes/"))
		return
	}
	if r.Method != "GET" && r.Method != "HEAD" {
		w.Header().Set("Allow", "GET, HEAD")
		w.WriteHeader(405)
		return
	}
	if strings.HasSuffix(p, "/") {
		p += "index.html"
	}
	p = path.Clean(p)
	if f := files[p]; f != nil {
		serveFile(w, r, p, f, 200)
		return
	}
	notFound(w, r)
}

func internal(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.URL.Path == "/stats" && r.Method == "GET":
		stMu.Lock()
		saveStats()
		saveVisitors()
		b, _ := json.Marshal(map[string]any{"days": stats.Days, "live": liveCount(), "today": dayKey(time.Now()), "spots": config.Spots, "visitors": visitorSummary()})
		stMu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.Write(b)
	case r.URL.Path == "/health" && r.Method == "GET":
		obMu.Lock()
		n := len(outbox)
		var oldest any
		if n > 0 {
			oldest = outbox[0].Lead.Created
		}
		obMu.Unlock()
		sendJSON(w, 200, map[string]any{"ok": true, "outbox": n, "oldest": oldest, "ntfyFallback": setting("NTFY_URL", "ntfy-url.txt") != "", "version": appVersion})
	case r.URL.Path == "/config" && r.Method == "POST":
		var c struct {
			Spots  *float64 `json:"spots"`
			Vat    *string  `json:"vat"`
			Portal *string  `json:"portal"`
		}
		b, _ := io.ReadAll(io.LimitReader(r.Body, 1000))
		if json.Unmarshal(b, &c) != nil {
			sendJSON(w, 400, map[string]any{"ok": false})
			return
		}
		cfgMu.Lock()
		if c.Spots != nil {
			config.Spots = max(0, min(99, int(*c.Spots+0.5)))
		}
		if c.Vat != nil && (*c.Vat == "brutto" || *c.Vat == "netto" || *c.Vat == "mentes") {
			config.Vat = *c.Vat
		}
		if c.Portal != nil && (*c.Portal == "" || strings.HasPrefix(*c.Portal, "https://")) {
			config.Portal = cut(*c.Portal, 300)
		}
		err := writeJSON("config.json", config)
		out := config
		cfgMu.Unlock()
		if err != nil {
			sendJSON(w, 500, map[string]any{"ok": false})
			return
		}
		sendJSON(w, 200, map[string]any{"ok": true, "config": out})
	default:
		http.NotFound(w, r)
	}
}

func main() {
	// A small website: keep the memory footprint low.
	debug.SetGCPercent(50)
	debug.SetMemoryLimit(32 << 20)
	if budapest == nil {
		budapest = time.UTC
	}
	os.MkdirAll(dataDir, 0o700)
	loadFiles()
	if files["/index.html"] == nil {
		log.Fatal("website files missing")
	}
	readJSON("config.json", &config)
	readJSON("stats.json", &stats)
	if stats.Days == nil {
		stats.Days = map[string]*day{}
	}
	for _, s := range stats.Seen {
		seen[s] = true
	}
	readJSON("visitors.json", &visitors)
	if visitors == nil {
		visitors = map[string]*Visitor{}
	}
	readJSON("outbox.json", &outbox)
	if _, err := os.Stat(filepath.Join(dataDir, "uj-domain.txt")); err == nil {
		newHostSeen.Store(true)
	}

	go func() {
		time.Sleep(3 * time.Second)
		flush()
		for range time.Tick(time.Minute) {
			flush()
			stMu.Lock()
			saveStats()
			saveVisitors()
			stMu.Unlock()
		}
	}()
	go func() {
		srv := &http.Server{Addr: ":" + internalPort, Handler: http.HandlerFunc(internal), ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second}
		log.Print("zalastudio: internal data on :", internalPort)
		log.Fatal(srv.ListenAndServe())
	}()
	go func() {
		c := make(chan os.Signal, 1)
		signal.Notify(c, syscall.SIGTERM, syscall.SIGINT)
		<-c
		stMu.Lock()
		saveStats()
		saveVisitors()
		stMu.Unlock()
		os.Exit(0)
	}()
	srv := &http.Server{Addr: ":" + port, Handler: http.HandlerFunc(public), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 120 * time.Second}
	log.Printf("zalastudio: website %s on :%s", appVersion, port)
	log.Fatal(srv.ListenAndServe())
}
