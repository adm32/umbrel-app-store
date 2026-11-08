// Zala Studio (zalastudio.hu, formerly admcore.hu) – web server for Umbrel.
//
// A single static Go program (like the Vadvirág apps). The website files are compiled into it.
//
// Public (port 8080, behind Umbrel's app proxy / Cloudflare Tunnel):
//
//	GET  /...                 the website
//	POST /api/ajanlatkeres    request from the planner (JSON) or the no-JS form (urlencoded)
//	POST /api/e               cookieless page statistics (counts only)
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
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	_ "time/tzdata"
	"unicode/utf8"
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

// ---------- small helpers ----------

func readJSON(name string, v any) bool {
	b, err := os.ReadFile(filepath.Join(dataDir, name))
	return err == nil && json.Unmarshal(b, v) == nil
}
func writeJSON(name string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	f := filepath.Join(dataDir, name)
	if err := os.WriteFile(f+".tmp", b, 0o600); err != nil {
		return err
	}
	return os.Rename(f+".tmp", f)
}
func setting(envName, file string) string {
	if v := os.Getenv(envName); v != "" {
		return strings.TrimSpace(v)
	}
	b, _ := os.ReadFile(filepath.Join(dataDir, file))
	return strings.TrimSpace(string(b))
}
func dayKey(t time.Time) string { return t.In(budapest).Format("2006-01-02") }
func clientIP(r *http.Request) string {
	if v := r.Header.Get("Cf-Connecting-Ip"); v != "" {
		return v
	}
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		return strings.TrimSpace(strings.Split(v, ",")[0])
	}
	h, _, _ := net.SplitHostPort(r.RemoteAddr)
	return h
}
func cut(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	return string([]rune(s)[:max])
}

var ctrl = regexp.MustCompile("[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]")
var spaces = regexp.MustCompile(`[ \t]+`)

func clean(v any, max int) string {
	s, _ := v.(string)
	s = strings.ToValidUTF8(s, "")
	s = spaces.ReplaceAllString(ctrl.ReplaceAllString(s, ""), " ")
	return cut(strings.TrimSpace(s), max)
}
func secHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'")
}
func sendJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if w.Header().Get("Cache-Control") == "" {
		w.Header().Set("Cache-Control", "no-store")
	}
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

// limiter: at most max hits per window per key.
type limiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	m      map[string][]time.Time
}

func newLimiter(max int, window time.Duration) *limiter {
	l := &limiter{max: max, window: window, m: map[string][]time.Time{}}
	go func() {
		for range time.Tick(window) {
			l.mu.Lock()
			for k, v := range l.m {
				if len(v) == 0 || time.Since(v[len(v)-1]) > l.window {
					delete(l.m, k)
				}
			}
			l.mu.Unlock()
		}
	}()
	return l
}
func (l *limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	var keep []time.Time
	for _, t := range l.m[key] {
		if time.Since(t) < l.window {
			keep = append(keep, t)
		}
	}
	if len(keep) >= l.max {
		l.m[key] = keep
		return false
	}
	l.m[key] = append(keep, time.Now())
	return true
}

// ---------- static files ----------

type file struct {
	data  []byte
	etag  string
	ctype string
}

var files = map[string]*file{}

func loadFiles() {
	fs.WalkDir(wwwFS, "www", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		b, _ := wwwFS.ReadFile(p)
		sum := sha256.Sum256(b)
		ct := mime.TypeByExtension(path.Ext(p))
		switch path.Ext(p) {
		case ".html":
			ct = "text/html; charset=utf-8"
		case ".css":
			ct = "text/css; charset=utf-8"
		case ".js":
			ct = "text/javascript; charset=utf-8"
		case ".webmanifest":
			ct = "application/manifest+json"
		case ".woff":
			ct = "font/woff"
		case ".txt":
			ct = "text/plain; charset=utf-8"
		case ".xml":
			ct = "application/xml"
		case ".ico":
			ct = "image/x-icon"
		}
		if ct == "" {
			ct = "application/octet-stream"
		}
		files[strings.TrimPrefix(p, "www")] = &file{data: b, etag: `"` + hex.EncodeToString(sum[:8]) + `"`, ctype: ct}
		return nil
	})
}
func cacheFor(p string) string {
	switch {
	case strings.HasPrefix(p, "/assets/fonts/"):
		return "public, max-age=31536000, immutable"
	case strings.HasPrefix(p, "/assets/img/"), strings.HasPrefix(p, "/assets/logo/"):
		return "public, max-age=2592000"
	case strings.HasPrefix(p, "/assets/"), strings.HasSuffix(p, ".png"), strings.HasSuffix(p, ".ico"), strings.HasSuffix(p, ".svg"), strings.HasSuffix(p, ".jpg"), strings.HasSuffix(p, ".webmanifest"):
		return "public, max-age=86400"
	}
	return "no-cache"
}
func serveFile(w http.ResponseWriter, r *http.Request, p string, f *file, code int) {
	w.Header().Set("Content-Type", f.ctype)
	w.Header().Set("Cache-Control", cacheFor(p))
	w.Header().Set("ETag", f.etag)
	if code == 200 && r.Header.Get("If-None-Match") == f.etag {
		w.WriteHeader(304)
		return
	}
	w.Header().Set("Content-Length", strconv.Itoa(len(f.data)))
	w.WriteHeader(code)
	if r.Method != "HEAD" {
		w.Write(f.data)
	}
}
func notFound(w http.ResponseWriter, r *http.Request) {
	if f := files["/404.html"]; f != nil {
		serveFile(w, r, "/404.html", f, 404)
		return
	}
	http.NotFound(w, r)
}

// ---------- configuration (set by the Irányítópult) ----------

var (
	cfgMu  sync.Mutex
	config = struct {
		Spots  int    `json:"spots"`
		Vat    string `json:"vat"`
		Portal string `json:"portal"`
	}{Spots: 5, Vat: "brutto"}
)

// ---------- statistics (no cookies, no IP addresses stored) ----------

type day struct {
	PV    int            `json:"pv"`
	UV    int            `json:"uv"`
	Dev   map[string]int `json:"dev"`
	Ref   map[string]int `json:"ref"`
	Pages map[string]int `json:"pages"`
	Ev    map[string]int `json:"ev"`
	Src   map[string]int `json:"src"`
}
type statsFile struct {
	Days map[string]*day `json:"days"`
	Salt *struct {
		Day   string `json:"day"`
		Value string `json:"value"`
	} `json:"salt"`
	Seen []string `json:"seen"`
}

var (
	stMu       sync.Mutex
	stats      = statsFile{Days: map[string]*day{}}
	seen       = map[string]bool{}
	live       = map[string]time.Time{}
	statsDirty bool
	bot        = regexp.MustCompile(`(?i)bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|node-fetch|go-http`)
	mobileRe   = regexp.MustCompile(`(?i)Mobi|Android|iPhone|iPod`)
	tabletRe   = regexp.MustCompile(`(?i)iPad|Tablet`)
	androidRe  = regexp.MustCompile(`(?i)Android`)
	mobiRe     = regexp.MustCompile(`(?i)Mobi`)
	evLimit    = newLimiter(400, 10*time.Minute)
	events     = map[string]bool{"pv": true, "cfg_open": true, "cfg_step": true, "cfg_sent": true, "cfg_preview": true, "call": true, "mail": true}
	stepNames  = map[string]bool{"type": true, "name": true, "features": true, "style": true, "situation": true, "contact": true, "done": true}
)

// call with stMu held
func salt() string {
	d := dayKey(time.Now())
	if stats.Salt == nil || stats.Salt.Day != d {
		b := make([]byte, 16)
		rand.Read(b)
		stats.Salt = &struct {
			Day   string `json:"day"`
			Value string `json:"value"`
		}{d, hex.EncodeToString(b)}
		seen = map[string]bool{}
	}
	return stats.Salt.Value
}
func today() *day {
	d := dayKey(time.Now())
	x := stats.Days[d]
	if x == nil {
		x = &day{}
		stats.Days[d] = x
	}
	for _, m := range []*map[string]int{&x.Dev, &x.Ref, &x.Pages, &x.Ev, &x.Src} {
		if *m == nil {
			*m = map[string]int{}
		}
	}
	return x
}

var refRules = []struct {
	re   *regexp.Regexp
	name string
}{
	{regexp.MustCompile(`(^|\.)google\.`), "Google"},
	{regexp.MustCompile(`facebook\.com$|(^|\.)fb\.(com|me)$`), "Facebook"},
	{regexp.MustCompile(`instagram\.com$`), "Instagram"},
	{regexp.MustCompile(`bing\.com$`), "Bing"},
	{regexp.MustCompile(`duckduckgo\.com$`), "DuckDuckGo"},
	{regexp.MustCompile(`tiktok\.com$`), "TikTok"},
	{regexp.MustCompile(`youtube\.com$`), "YouTube"},
	{regexp.MustCompile(`zalastudio\.hu$|admcore\.hu$`), "Közvetlen"},
}

func refName(host string) string {
	h := strings.TrimPrefix(strings.ToLower(host), "www.")
	if h == "" {
		return "Közvetlen"
	}
	for _, r := range refRules {
		if r.re.MatchString(h) {
			return r.name
		}
	}
	return cut(h, 60)
}

func handleEvent(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(204)
	ua := r.UserAgent()
	if ua == "" || bot.MatchString(ua) {
		return
	}
	ip := clientIP(r)
	if !evLimit.allow(ip) {
		return
	}
	var e struct {
		T, P, R, S, Src string
	}
	b, _ := io.ReadAll(io.LimitReader(r.Body, 2048))
	if json.Unmarshal(b, &e) != nil || !events[e.T] {
		return
	}
	stMu.Lock()
	defer stMu.Unlock()
	d := today()
	h := sha256.Sum256([]byte(salt() + "|" + ip + "|" + ua))
	visitor := hex.EncodeToString(h[:8])
	live[visitor] = time.Now()
	switch e.T {
	case "pv":
		d.PV++
		if !seen[visitor] {
			seen[visitor] = true
			d.UV++
			dev := "asztali"
			if tabletRe.MatchString(ua) || (androidRe.MatchString(ua) && !mobiRe.MatchString(ua)) {
				dev = "tablet"
			} else if mobileRe.MatchString(ua) {
				dev = "mobil"
			}
			d.Dev[dev]++
			d.Ref[refName(e.R)]++
		}
		p := e.P
		if p == "" {
			p = "/"
		}
		d.Pages[cut(p, 60)]++
	case "cfg_step":
		if stepNames[e.S] {
			d.Ev["step_"+e.S]++
		}
	default:
		d.Ev[e.T]++
		if e.T == "cfg_open" && e.Src != "" {
			d.Src[cut(e.Src, 30)]++
		}
	}
	statsDirty = true
}

// call with stMu held
func saveStats() {
	if !statsDirty {
		return
	}
	keys := make([]string, 0, len(stats.Days))
	for k := range stats.Days {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for len(keys) > 400 {
		delete(stats.Days, keys[0])
		keys = keys[1:]
	}
	stats.Seen = stats.Seen[:0]
	for k := range seen {
		stats.Seen = append(stats.Seen, k)
	}
	if err := writeJSON("stats.json", stats); err != nil {
		log.Print("stats: could not save: ", err)
		return
	}
	statsDirty = false
}
func liveCount() int {
	n := 0
	for k, t := range live {
		if time.Since(t) < 5*time.Minute {
			n++
		} else {
			delete(live, k)
		}
	}
	return n
}

// ---------- requests (leads) ----------

var labels = map[string]map[string]string{
	"tipus":    {"etterem": "Étterem, kávézó", "szepseg": "Szépség, egészség", "szaki": "Szaki, építőipar", "szallas": "Szállás, vendégház", "bolt": "Üzlet, bolt", "egyeb": "Egyéb szolgáltatás"},
	"funkciok": {"arlista": "Árlista vagy étlap", "galeria": "Képgaléria", "ajanlat": "Ajánlatkérő űrlap", "foglalas": "Online időpontfoglalás", "rendeles": "Online rendelés", "nyelv": "Német és angol nyelv", "tobb": "Több aloldal", "kozosseg": "Facebook és Instagram", "kezeles": "Teljes körű kezelés"},
	"stilus":   {"meleg": "Meleg, barátságos", "lagy": "Lágy, elegáns", "termeszetes": "Természetes", "friss": "Friss, modern", "elegans": "Prémium, sötét"},
	"helyzet":  {"nincs": "Még nincs weboldala", "facebook": "Csak Facebook-oldala van", "regi": "Van, de megújítaná"},
	"mikorra":  {"surgos": "Minél előbb", "honap": "1–2 hónapon belül", "erdeklodik": "Csak tájékozódik"},
	"hivhato":  {"delelott": "Délelőtt", "delutan": "Délután", "barmikor": "Bármikor"},
	"csomag":   {"nevjegy": "Névjegy", "vallalkozas": "Vállalkozás", "rendeles": "Rendelés & Foglalás", "premium": "Prémium Partner"},
}
var prices = map[string]int{"nevjegy": 3490, "vallalkozas": 6990, "rendeles": 12990, "premium": 39990}

func pick(g string, v any) string {
	s, _ := v.(string)
	if _, ok := labels[g][s]; ok {
		return s
	}
	return ""
}

type Lead struct {
	ID          string   `json:"id"`
	Created     string   `json:"created"`
	Source      string   `json:"source"`
	Entry       string   `json:"entry"`
	Type        string   `json:"type"`
	Business    string   `json:"business"`
	City        string   `json:"city"`
	Features    []string `json:"features"`
	Style       string   `json:"style"`
	Situation   string   `json:"situation"`
	Link        string   `json:"link"`
	Timing      string   `json:"timing"`
	Plan        string   `json:"plan"`
	Recommended string   `json:"recommended"`
	Billing     string   `json:"billing"`
	Name        string   `json:"name"`
	Phone       string   `json:"phone"`
	Email       string   `json:"email"`
	CallTime    string   `json:"callTime"`
	Message     string   `json:"message"`
	Device      string   `json:"device"`
}
type outItem struct {
	Lead     Lead `json:"lead"`
	Tries    int  `json:"tries"`
	Notified bool `json:"notified"`
}

var (
	obMu      sync.Mutex
	outbox    []*outItem
	formLimit = newLimiter(5, 10*time.Minute)
	emailRe   = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`)
	flushMu   sync.Mutex
)

func uuid() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func saveOutbox() error { return writeJSON("outbox.json", outbox) }

func errorPage(msg string) string {
	esc := strings.NewReplacer("<", "", ">", "", "&", "")
	return `<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nem sikerült elküldeni</title><link rel="stylesheet" href="/assets/css/site.css?v=14"><main class="doc"><div class="wrap"><div class="doc__card center-card"><h1>Nem sikerült elküldeni</h1><p>` + esc.Replace(msg) + `</p><p>Hívj minket: <a href="tel:+36203282840">+36 20 328 2840</a></p><a class="btn btn--primary" href="/#tervezes">Vissza</a></div></div></main></html>`
}

func handleLead(w http.ResponseWriter, r *http.Request) {
	isJSON := strings.Contains(r.Header.Get("Content-Type"), "application/json")
	reply := func(code int, msg string) {
		if isJSON {
			sendJSON(w, code, map[string]any{"ok": code == 200, "message": msg})
			return
		}
		if code == 200 {
			w.Header().Set("Location", "/koszonom.html")
			w.WriteHeader(303)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(code)
		io.WriteString(w, errorPage(msg))
	}
	if !formLimit.allow(clientIP(r)) {
		reply(429, "Túl sok kérés rövid idő alatt. Próbáld újra később, vagy hívj minket.")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 20001))
	if err != nil || len(raw) > 20000 {
		reply(400, "Hibás kérés.")
		return
	}
	d := map[string]any{}
	if isJSON {
		if json.Unmarshal(raw, &d) != nil {
			reply(400, "Hibás kérés.")
			return
		}
	} else {
		v, err := url.ParseQuery(string(raw))
		if err != nil {
			reply(400, "Hibás kérés.")
			return
		}
		for k := range v {
			d[k] = v.Get(k)
		}
	}
	if s, _ := d["weboldal"].(string); s != "" { // honeypot filled = bot
		reply(200, "ok")
		return
	}
	var t float64
	switch x := d["t"].(type) {
	case float64:
		t = x
	case string:
		t, _ = strconv.ParseFloat(x, 64)
	}
	now := time.Now()
	if t > 0 && float64(now.UnixMilli())-t < 2500 { // faster than a human
		reply(200, "ok")
		return
	}
	l := Lead{ID: uuid(), Created: now.UTC().Format("2006-01-02T15:04:05.000Z"), Source: "urlap", Features: []string{}, Billing: "m", Device: "asztali"}
	if d["forras"] == "tervezo" {
		l.Source = "tervezo"
	}
	l.Entry = clean(d["src"], 30)
	l.Type, l.Style, l.Situation, l.Timing = pick("tipus", d["tipus"]), pick("stilus", d["stilus"]), pick("helyzet", d["helyzet"]), pick("mikorra", d["mikorra"])
	l.Plan, l.Recommended, l.CallTime = pick("csomag", d["csomag"]), pick("csomag", d["ajanlott"]), pick("hivhato", d["hivhato"])
	l.Business, l.City, l.Link = clean(d["vallalkozas"], 120), clean(d["telepules"], 60), clean(d["link"], 200)
	l.Name, l.Phone, l.Email = clean(d["nev"], 80), clean(d["telefon"], 40), clean(d["email"], 120)
	msg, _ := d["uzenet"].(string)
	l.Message = cut(strings.TrimSpace(ctrl.ReplaceAllString(strings.ToValidUTF8(strings.ReplaceAll(msg, "\r", ""), ""), "")), 2000)
	if d["fizetes"] == "y" {
		l.Billing = "y"
	}
	if mobileRe.MatchString(r.UserAgent()) {
		l.Device = "mobil"
	}
	if arr, ok := d["funkciok"].([]any); ok {
		got := map[string]bool{}
		for _, f := range arr {
			if s := pick("funkciok", f); s != "" && !got[s] && len(l.Features) < 12 {
				got[s] = true
				l.Features = append(l.Features, s)
			}
		}
	}
	consent := d["adatkezeles"] == "igen" || d["adatkezeles"] == true
	switch {
	case utf8.RuneCountInString(l.Name) < 2:
		reply(422, "Add meg a neved.")
		return
	case l.Phone == "" && l.Email == "":
		reply(422, "Adj meg egy telefonszámot vagy e-mail-címet.")
		return
	case l.Email != "" && !emailRe.MatchString(l.Email):
		reply(422, "Az e-mail-cím formátuma nem megfelelő.")
		return
	case !consent:
		reply(422, "Fogadd el az adatkezelési tájékoztatót.")
		return
	case l.Business == "" && l.Source == "urlap":
		reply(422, "Add meg a vállalkozás nevét.")
		return
	}
	obMu.Lock()
	outbox = append(outbox, &outItem{Lead: l})
	err = saveOutbox()
	if err != nil {
		outbox = outbox[:len(outbox)-1]
	}
	obMu.Unlock()
	if err != nil {
		log.Print("lead: could not save: ", err)
		reply(500, "Most nem sikerült elmenteni a kérést.")
		return
	}
	log.Printf("lead: %s (%s)", firstNonEmpty(l.Business, l.Name), l.Source)
	reply(200, "ok")
	go flush()
}
func firstNonEmpty(a ...string) string {
	for _, s := range a {
		if s != "" {
			return s
		}
	}
	return ""
}

func flush() {
	if !flushMu.TryLock() {
		return
	}
	defer flushMu.Unlock()
	obMu.Lock()
	items := append([]*outItem(nil), outbox...)
	obMu.Unlock()
	for _, it := range items {
		b, _ := json.Marshal(it.Lead)
		delivered := false
		if resp, err := httpc.Post(dashIngest, "application/json", bytes.NewReader(b)); err == nil {
			resp.Body.Close()
			delivered = resp.StatusCode < 300
		}
		notified := false
		if !delivered && !it.Notified {
			notified = notifyFallback(it.Lead)
		}
		obMu.Lock()
		if delivered {
			out := outbox[:0]
			for _, x := range outbox {
				if x != it {
					out = append(out, x)
				}
			}
			outbox = out
		} else {
			it.Tries++
			if notified {
				it.Notified = true
			}
		}
		saveOutbox()
		obMu.Unlock()
	}
}

func leadText(l Lead) string {
	var lines []string
	head := l.Name
	if l.Business != "" {
		head += " · " + l.Business
	}
	lines = append(lines, head)
	add := func(ok bool, s string) {
		if ok {
			lines = append(lines, s)
		}
	}
	add(l.City != "", "Település: "+l.City)
	add(l.Phone != "", "Telefon: "+l.Phone)
	add(l.Email != "", "E-mail: "+l.Email)
	add(l.Type != "", "Típus: "+labels["tipus"][l.Type])
	if l.Plan != "" {
		lines = append(lines, fmt.Sprintf("Csomag: %s (%d Ft/hó)", labels["csomag"][l.Plan], prices[l.Plan]))
	}
	if len(l.Features) > 0 {
		var f []string
		for _, x := range l.Features {
			f = append(f, labels["funkciok"][x])
		}
		lines = append(lines, "Funkciók: "+strings.Join(f, ", "))
	}
	add(l.Timing != "", "Mikorra: "+labels["mikorra"][l.Timing])
	add(l.CallTime != "", "Hívható: "+labels["hivhato"][l.CallTime])
	add(l.Message != "", "\n"+l.Message)
	return strings.Join(lines, "\n")
}
func notifyFallback(l Lead) bool {
	raw := setting("NTFY_URL", "ntfy-url.txt")
	if raw == "" {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return false
	}
	body, _ := json.Marshal(map[string]any{"topic": strings.TrimLeft(u.Path, "/"), "title": "Új érdeklődő: " + firstNonEmpty(l.Business, l.Name), "message": leadText(l) + "\n\n(Az Irányítópult nem érhető el, a kérés a weboldal appban vár.)", "tags": []string{"house"}, "priority": 4})
	req, _ := http.NewRequest("POST", u.Scheme+"://"+u.Host+"/", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if tok := setting("NTFY_TOKEN", "ntfy-token.txt"); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	resp, err := httpc.Do(req)
	if err != nil {
		log.Print("ntfy: ", err)
		return false
	}
	resp.Body.Close()
	return resp.StatusCode < 300
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
		b, _ := json.Marshal(map[string]any{"days": stats.Days, "live": liveCount(), "today": dayKey(time.Now()), "spots": config.Spots})
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
		stMu.Unlock()
		os.Exit(0)
	}()
	srv := &http.Server{Addr: ":" + port, Handler: http.HandlerFunc(public), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 120 * time.Second}
	log.Printf("zalastudio: website %s on :%s", appVersion, port)
	log.Fatal(srv.ListenAndServe())
}
