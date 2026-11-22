// Zala Studio Irányítópult – incoming requests: the lead format the website sends, and the internal
// POST /ingest server on port 9097 (other containers only).

package main

import (
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"runtime/debug"
	"strings"
	"sync"
	"time"
	_ "time/tzdata"
)

// ---------- incoming data ----------

type leadIn struct {
	ID, Created, Source, Entry, Type, Business, City, Style, Situation, Link, Timing, Plan, Recommended, Billing string
	Name, Phone, Email, CallTime, Message, Device, Note                                                          string
	Features                                                                                                     []any
	Journey                                                                                                      *Journey
}

func sanitize(d leadIn, manual bool) *Lead {
	now := nowISO()
	l := &Lead{ID: uuid(), Created: now, Source: "urlap", Billing: "m", Status: "uj", Updated: now, Seen: manual, Features: []string{}, History: []Hist{{At: now, Status: "uj"}}}
	if idRe.MatchString(strings.ToLower(d.ID)) {
		l.ID = strings.ToLower(d.ID)
	}
	if !manual {
		if t, err := time.Parse(time.RFC3339Nano, d.Created); err == nil {
			l.Created = t.UTC().Format("2006-01-02T15:04:05.000Z")
		}
	}
	switch {
	case manual:
		l.Source = "kezi"
	case d.Source == "tervezo":
		l.Source = "tervezo"
	}
	l.Entry = clean(d.Entry, 30)
	l.Type, l.Style, l.Situation = pick("tipus", d.Type), pick("stilus", d.Style), pick("helyzet", d.Situation)
	l.Timing, l.Plan, l.Recommended, l.CallTime = pick("mikorra", d.Timing), pick("csomag", d.Plan), pick("csomag", d.Recommended), pick("hivhato", d.CallTime)
	l.Business, l.City, l.Link = clean(d.Business, 120), clean(d.City, 60), clean(d.Link, 200)
	l.Name, l.Phone, l.Email = clean(d.Name, 80), clean(d.Phone, 40), clean(d.Email, 120)
	l.Message = cut(strings.TrimSpace(noteText(d.Message)), 2000)
	if d.Billing == "y" {
		l.Billing = "y"
	}
	if d.Device == "mobil" || d.Device == "asztali" {
		l.Device = d.Device
	}
	if manual {
		l.Note = noteText(d.Note)
	} else {
		l.Journey = cleanJourney(d.Journey)
	}
	seen := map[string]bool{}
	for _, f := range d.Features {
		s, _ := f.(string)
		if pick("funkciok", s) != "" && !seen[s] && len(l.Features) < 12 {
			seen[s] = true
			l.Features = append(l.Features, s)
		}
	}
	return l
}

// ---------- ingest (internal only) ----------

var (
	inMu    sync.Mutex
	inLimit = map[string][]time.Time{}
)

func ingest(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path
	known := (p == "/ingest" && r.Method == "POST") || (p == "/stripe" && r.Method == "POST") || strings.HasPrefix(p, "/pay/")
	if !known {
		http.NotFound(w, r)
		return
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	inMu.Lock()
	var keep []time.Time
	for _, t := range inLimit[ip] {
		if time.Since(t) < time.Minute {
			keep = append(keep, t)
		}
	}
	if len(keep) > 300 {
		inMu.Unlock()
		w.WriteHeader(429)
		return
	}
	inLimit[ip] = append(keep, time.Now())
	inMu.Unlock()
	switch {
	case p == "/stripe":
		internalStripe(w, r)
		return
	case strings.HasPrefix(p, "/pay/"):
		internalPay(w, r, strings.TrimPrefix(p, "/pay/"))
		return
	}
	var d leadIn
	if !readBody(r, 32<<10, &d) {
		w.WriteHeader(400)
		return
	}
	mu.Lock()
	if id := strings.ToLower(d.ID); idRe.MatchString(id) && findLead(id) != nil {
		mu.Unlock()
		io.WriteString(w, "dup")
		return
	}
	l := sanitize(d, false)
	if l.Name == "" || (l.Phone == "" && l.Email == "") {
		mu.Unlock()
		w.WriteHeader(422)
		return
	}
	leads = append([]*Lead{l}, leads...)
	saveLeads()
	copyL := *l
	mu.Unlock()
	log.Printf("new lead: %s", firstNonEmpty(l.Business, l.Name))
	go notifyLead(copyL)
	io.WriteString(w, "ok")
}

func main() {
	// Keep memory small: the dashboard handles a handful of requests, not a busy website.
	debug.SetGCPercent(50)
	debug.SetMemoryLimit(24 << 20)
	log.SetFlags(log.LstdFlags)
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		log.Print("data dir: ", err)
	}
	readJSON("leads.json", &leads)
	if leads == nil {
		leads = []*Lead{}
	}
	readJSON("settings.json", &settings)
	readJSON("jelszo.json", &auth)
	loadTax()
	go taxLoop()
	if auth.Hash != "" && auth.Algo != "pbkdf2" {
		log.Print("Régi jelszóformátum: az Irányítópult kéri a jelszó újbóli beállítását (otthonról).")
	}
	if _, err := fs.Stat(webFS, "web/index.html"); err != nil {
		log.Fatal("web files missing")
	}
	go func() {
		time.Sleep(4 * time.Second)
		check()
		for range time.Tick(5 * time.Minute) {
			check()
		}
	}()
	go func() { time.Sleep(5 * time.Second); pushConfig() }()
	go func() {
		srv := &http.Server{Addr: ":" + ingestPort, Handler: http.HandlerFunc(ingest), ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second}
		log.Print("ingest on :", ingestPort)
		log.Fatal(srv.ListenAndServe())
	}()
	srv := &http.Server{Addr: ":" + port, Handler: http.HandlerFunc(handler), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 120 * time.Second}
	log.Printf("Zala Studio Irányítópult %s on :%s", version, port)
	log.Fatal(srv.ListenAndServe())
}
