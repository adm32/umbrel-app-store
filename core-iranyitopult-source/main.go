// core Irányítópult – requests (leads) and visitor statistics for admcore.hu.
//
// A single static Go program (like the Vadvirág apps): small, fast, and it uses a few MB of memory.
// The web interface is compiled into the program.
//
// Port 8080 (Umbrel app proxy): the dashboard, protected by its own password.
// Port 9097 (internal, other containers only): POST /ingest – the website hands over new requests here.
//
// Data in DATA_DIR (/data):
//
//	jelszo.json   salted PBKDF2-SHA256 hash of the password + session secret
//	leads.json    the requests, with status, notes and history
//	settings.json notifications, the launch-discount counter and the Stripe keys
//
// Payments (Stripe) live in pay.go.
package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"embed"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	_ "time/tzdata"
	"unicode/utf8"
)

const version = "1.2.0"

//go:embed web
var webFS embed.FS

var (
	dataDir    = env("DATA_DIR", "/data")
	port       = env("PORT", "8080")
	ingestPort = env("INGEST_PORT", "9097")
	siteURL    = strings.TrimRight(env("SITE_INTERNAL", "http://adam-admcore_web_1:9095"), "/")
	httpc      = &http.Client{Timeout: 12 * time.Second}
)

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

// ---------- vocabulary (must match the website) ----------

var L = map[string]map[string]string{
	"tipus":    {"etterem": "Étterem, kávézó", "szepseg": "Szépség, egészség", "szaki": "Szaki, építőipar", "szallas": "Szállás, vendégház", "bolt": "Üzlet, bolt", "egyeb": "Egyéb szolgáltatás"},
	"funkciok": {"arlista": "Árlista vagy étlap", "galeria": "Képgaléria", "ajanlat": "Ajánlatkérő űrlap", "foglalas": "Online időpontfoglalás", "rendeles": "Online rendelés", "nyelv": "Német és angol nyelv", "tobb": "Több aloldal", "kozosseg": "Facebook és Instagram", "kezeles": "Teljes körű kezelés"},
	"stilus":   {"meleg": "Meleg, barátságos", "lagy": "Lágy, elegáns", "termeszetes": "Természetes", "friss": "Friss, modern", "elegans": "Prémium, sötét"},
	"helyzet":  {"nincs": "Még nincs weboldala", "facebook": "Csak Facebook-oldala van", "regi": "Van, de megújítaná"},
	"mikorra":  {"surgos": "Minél előbb", "honap": "1–2 hónapon belül", "erdeklodik": "Csak tájékozódik"},
	"hivhato":  {"delelott": "Délelőtt", "delutan": "Délután", "barmikor": "Bármikor"},
	"csomag":   {"nevjegy": "Névjegy", "vallalkozas": "Vállalkozás", "rendeles": "Rendelés & Foglalás", "premium": "Prémium Partner"},
	"status":   {"uj": "Új", "hivtam": "Felhívtam", "bemutato": "Bemutató készül", "elkuldve": "Bemutató elküldve", "megrendelte": "Megrendelte", "elutasitotta": "Nem kérte"},
}
var prices = map[string]int{"nevjegy": 3490, "vallalkozas": 6990, "rendeles": 14990, "premium": 39990}

func pick(g, v string) string {
	if _, ok := L[g][v]; ok {
		return v
	}
	return ""
}

var ctrl = regexp.MustCompile("[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]")
var spaces = regexp.MustCompile(`[ \t]+`)
var idRe = regexp.MustCompile(`^[0-9a-f-]{36}$`)

func cut(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return string(r[:max])
}
func clean(s string, max int) string {
	s = strings.ToValidUTF8(s, "")
	s = ctrl.ReplaceAllString(s, "")
	s = spaces.ReplaceAllString(s, " ")
	return cut(strings.TrimSpace(s), max)
}
func noteText(s string) string {
	s = strings.ToValidUTF8(strings.ReplaceAll(s, "\r", ""), "")
	return cut(ctrl.ReplaceAllString(s, ""), 4000)
}
func nowISO() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }
func uuid() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func randHex(n int) string { b := make([]byte, n); rand.Read(b); return hex.EncodeToString(b) }

// ---------- storage ----------

type Hist struct {
	At     string `json:"at"`
	Status string `json:"status"`
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
	Status      string   `json:"status"`
	Note        string   `json:"note"`
	DemoURL     string   `json:"demoUrl"`
	Seen        bool     `json:"seen"`
	Updated     string   `json:"updated"`
	History     []Hist   `json:"history"`
	Pay         *Payment `json:"pay,omitempty"`
}
type Settings struct {
	NtfyURL       string `json:"ntfyUrl"`
	NtfyToken     string `json:"ntfyToken"`
	NotifyLeads   bool   `json:"notifyLeads"`
	NotifyDown    bool   `json:"notifyDown"`
	SiteURL       string `json:"siteUrl"`
	DashURL       string `json:"dashUrl"`
	Spots         int    `json:"spots"`
	NotifyPay     bool   `json:"notifyPay"`
	StripeKey     string `json:"stripeKey"`
	StripeWebhook string `json:"stripeWebhook"`
	VatMode       string `json:"vatMode"` // brutto | netto | mentes
	PortalURL     string `json:"portalUrl"`
}
type Auth struct {
	Algo   string `json:"algo"`
	Salt   string `json:"salt"`
	Hash   string `json:"hash"`
	Secret string `json:"secret"`
	Set    string `json:"set"`
}

var (
	mu       sync.Mutex
	leads    []*Lead
	settings = Settings{NotifyLeads: true, NotifyDown: true, NotifyPay: true, SiteURL: "https://admcore.hu", Spots: 5, VatMode: "brutto"}
	auth     Auth
)

func readJSON(name string, v any) bool {
	b, err := os.ReadFile(filepath.Join(dataDir, name))
	if err != nil {
		return false
	}
	return json.Unmarshal(b, v) == nil
}
func writeJSON(name string, v any) error {
	b, err := json.MarshalIndent(v, "", " ")
	if err != nil {
		return err
	}
	f := filepath.Join(dataDir, name)
	if err := os.WriteFile(f+".tmp", b, 0o600); err != nil {
		return err
	}
	return os.Rename(f+".tmp", f)
}
func saveLeads() {
	if err := writeJSON("leads.json", leads); err != nil {
		log.Print("leads: could not save: ", err)
	}
}

// ---------- incoming data ----------

type leadIn struct {
	ID, Created, Source, Entry, Type, Business, City, Style, Situation, Link, Timing, Plan, Recommended, Billing string
	Name, Phone, Email, CallTime, Message, Device, Note                                                          string
	Features                                                                                                     []any
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

// ---------- ntfy ----------

type ntfyMsg struct {
	Topic    string           `json:"topic"`
	Title    string           `json:"title"`
	Message  string           `json:"message"`
	Tags     []string         `json:"tags,omitempty"`
	Priority int              `json:"priority"`
	Click    string           `json:"click,omitempty"`
	Actions  []map[string]any `json:"actions,omitempty"`
}

func ntfy(m ntfyMsg) error {
	mu.Lock()
	s := settings
	mu.Unlock()
	if s.NtfyURL == "" {
		return fmt.Errorf("Nincs megadva ntfy-cím.")
	}
	u, err := url.Parse(s.NtfyURL)
	if err != nil {
		return fmt.Errorf("Az ntfy-cím nem érvényes.")
	}
	m.Topic = strings.TrimLeft(u.Path, "/")
	b, _ := json.Marshal(m)
	req, _ := http.NewRequest("POST", u.Scheme+"://"+u.Host+"/", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if s.NtfyToken != "" {
		req.Header.Set("Authorization", "Bearer "+s.NtfyToken)
	}
	r, err := httpc.Do(req)
	if err != nil {
		return fmt.Errorf("Az ntfy nem érhető el: %v", err)
	}
	r.Body.Close()
	if r.StatusCode >= 300 {
		return fmt.Errorf("Az ntfy %d hibát adott.", r.StatusCode)
	}
	return nil
}

func huNum(n int) string {
	s := strconv.Itoa(n)
	var out []byte
	for i := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, ' ')
		}
		out = append(out, s[i])
	}
	return string(out)
}

var notPhone = regexp.MustCompile(`[^\d+]`)

func notifyLead(l Lead) {
	mu.Lock()
	s := settings
	mu.Unlock()
	if !s.NotifyLeads || s.NtfyURL == "" {
		return
	}
	var lines []string
	head := l.Name
	if l.Business != "" {
		head += " · " + l.Business
	}
	if l.City != "" {
		head += " (" + l.City + ")"
	}
	lines = append(lines, head)
	add := func(cond bool, s string) {
		if cond {
			lines = append(lines, s)
		}
	}
	add(l.Phone != "", "Telefon: "+l.Phone)
	add(l.Email != "", "E-mail: "+l.Email)
	if l.Plan != "" {
		lines = append(lines, "Csomag: "+L["csomag"][l.Plan]+" – "+huNum(prices[l.Plan])+" Ft/hó")
	}
	if len(l.Features) > 0 {
		var f []string
		for _, x := range l.Features {
			f = append(f, L["funkciok"][x])
		}
		lines = append(lines, "Kér: "+strings.Join(f, ", "))
	}
	add(l.Timing != "", "Mikorra: "+L["mikorra"][l.Timing])
	add(l.CallTime != "", "Hívható: "+L["hivhato"][l.CallTime])
	add(l.Message != "", "„"+cut(l.Message, 300)+"”")
	m := ntfyMsg{Title: "Új érdeklődő: " + firstNonEmpty(l.Business, l.Name), Message: strings.Join(lines, "\n"), Tags: []string{"house"}, Priority: 4}
	if l.Timing == "surgos" {
		m.Priority = 5
	}
	if l.Phone != "" {
		m.Actions = append(m.Actions, map[string]any{"action": "view", "label": "Hívás", "url": "tel:" + notPhone.ReplaceAllString(l.Phone, ""), "clear": false})
	}
	if s.DashURL != "" {
		link := strings.TrimRight(s.DashURL, "/") + "/#lead=" + l.ID
		m.Click = link
		m.Actions = append(m.Actions, map[string]any{"action": "view", "label": "Megnyitás", "url": link, "clear": true})
	}
	if err := ntfy(m); err != nil {
		log.Print("ntfy: ", err)
	}
}
func firstNonEmpty(a ...string) string {
	for _, s := range a {
		if s != "" {
			return s
		}
	}
	return ""
}

// ---------- monitoring ----------

type siteStatus struct {
	OK     *bool  `json:"ok"`
	At     string `json:"at"`
	Outbox int    `json:"outbox"`
	Error  string `json:"error"`
}
type pubStatus struct {
	OK      *bool  `json:"ok"`
	At      string `json:"at"`
	MS      int64  `json:"ms"`
	Error   string `json:"error"`
	Fails   int    `json:"fails"`
	Alerted bool   `json:"alerted"`
}
type statusT struct {
	Site   siteStatus `json:"site"`
	Public pubStatus  `json:"public"`
}

var (
	stMu    sync.Mutex
	status  statusT
	checkMu sync.Mutex
)

func bp(b bool) *bool { return &b }

func check() {
	checkMu.Lock()
	defer checkMu.Unlock()
	site := siteStatus{At: nowISO()}
	if r, err := httpc.Get(siteURL + "/health"); err == nil {
		var j struct {
			Outbox int `json:"outbox"`
		}
		json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&j)
		r.Body.Close()
		site.OK, site.Outbox = bp(r.StatusCode == 200), j.Outbox
	} else {
		site.OK, site.Error = bp(false), "A weboldal app nem válaszol."
	}
	mu.Lock()
	s := settings
	mu.Unlock()
	stMu.Lock()
	status.Site = site
	pub := status.Public
	stMu.Unlock()
	if s.SiteURL == "" {
		return
	}
	t0 := time.Now()
	req, _ := http.NewRequest("GET", strings.TrimRight(s.SiteURL, "/")+"/healthz", nil)
	req.Header.Set("User-Agent", "core-iranyitopult-monitor")
	pub.At = nowISO()
	if r, err := httpc.Do(req); err == nil {
		r.Body.Close()
		pub.OK, pub.MS, pub.Error = bp(r.StatusCode == 200), time.Since(t0).Milliseconds(), ""
		if r.StatusCode != 200 {
			pub.Error = fmt.Sprintf("HTTP %d", r.StatusCode)
			if r.StatusCode == 530 {
				pub.Error += " (Cloudflare: az alagút nem fut, 1033-as hiba)"
			}
		}
	} else {
		msg := err.Error()
		var dnsErr *net.DNSError
		if errors.As(err, &dnsErr) {
			msg = "a domain nem található"
		} else if strings.Contains(msg, "Client.Timeout") || strings.Contains(msg, "deadline") {
			msg = "nem válaszolt 12 másodpercen belül"
		}
		pub.OK, pub.MS, pub.Error = bp(false), 0, "Nem érhető el: "+msg
	}
	if *pub.OK {
		if pub.Alerted && s.NotifyDown {
			go ntfy(ntfyMsg{Title: "A weboldal újra elérhető", Message: s.SiteURL, Tags: []string{"white_check_mark"}, Priority: 3})
		}
		pub.Fails, pub.Alerted = 0, false
	} else {
		pub.Fails++
		if pub.Fails >= 2 && !pub.Alerted && s.NotifyDown {
			pub.Alerted = true
			go ntfy(ntfyMsg{Title: "A weboldal nem érhető el", Message: s.SiteURL + "\n" + pub.Error + "\nNézd meg a Cloudflare Tunnel appot és a core appot az Umbrelen.", Tags: []string{"warning"}, Priority: 5})
		}
	}
	stMu.Lock()
	status.Public = pub
	stMu.Unlock()
}

// pushConfig sends what the public website needs: discount places, VAT wording, customer-portal link.
func pushConfig() bool {
	mu.Lock()
	c := map[string]any{"spots": settings.Spots, "vat": settings.VatMode, "portal": settings.PortalURL}
	mu.Unlock()
	b, _ := json.Marshal(c)
	r, err := httpc.Post(siteURL+"/config", "application/json", bytes.NewReader(b))
	if err != nil {
		return false
	}
	r.Body.Close()
	return r.StatusCode == 200
}

// ---------- auth ----------

const cookieName = "core_dash"
const maxAge = 180 * 24 * 3600

func hashPw(pw, salt string) string {
	k, _ := pbkdf2.Key(sha256.New, pw, []byte(salt), 210000, 32)
	return hex.EncodeToString(k)
}
func hasPassword() bool {
	mu.Lock()
	defer mu.Unlock()
	return auth.Hash != "" && auth.Algo == "pbkdf2"
}
func setPassword(pw string) error {
	a := Auth{Algo: "pbkdf2", Salt: randHex(16), Secret: randHex(32), Set: nowISO()}
	a.Hash = hashPw(pw, a.Salt)
	if err := writeJSON("jelszo.json", a); err != nil {
		return err
	}
	mu.Lock()
	auth = a
	mu.Unlock()
	return nil
}
func checkPassword(pw string) bool {
	mu.Lock()
	a := auth
	mu.Unlock()
	if a.Hash == "" || a.Algo != "pbkdf2" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(hashPw(pw, a.Salt)), []byte(a.Hash)) == 1
}
func sign(ts string) string {
	mu.Lock()
	sec := auth.Secret
	mu.Unlock()
	m := hmac.New(sha256.New, []byte(sec))
	m.Write([]byte("core-dash|" + ts))
	return hex.EncodeToString(m.Sum(nil))
}
func authed(r *http.Request) bool {
	if !hasPassword() {
		return false
	}
	c, err := r.Cookie(cookieName)
	if err != nil {
		return false
	}
	ts, mac, ok := strings.Cut(c.Value, ".")
	n, err := strconv.ParseInt(ts, 10, 64)
	if !ok || err != nil || time.Now().Unix()-n > maxAge {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(sign(ts)), []byte(mac)) == 1
}
func secure(r *http.Request) bool {
	return r.Header.Get("X-Forwarded-Proto") == "https" || r.Header.Get("Cf-Connecting-Ip") != ""
}
func setSession(w http.ResponseWriter, r *http.Request) {
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: ts + "." + sign(ts), Path: "/", MaxAge: maxAge, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: secure(r)})
}
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

// Requests through Cloudflare carry Cf-Connecting-Ip. The first password may only be set from home.
func fromInternet(r *http.Request) bool { return r.Header.Get("Cf-Connecting-Ip") != "" }

var (
	failMu sync.Mutex
	fails  = map[string][]time.Time{}
)

func loginAllowed(ip string) bool {
	failMu.Lock()
	defer failMu.Unlock()
	total, mine := 0, 0
	for k, l := range fails {
		var keep []time.Time
		for _, t := range l {
			if time.Since(t) < 15*time.Minute {
				keep = append(keep, t)
			}
		}
		if len(keep) == 0 {
			delete(fails, k)
			continue
		}
		fails[k] = keep
		total += len(keep)
		if k == ip {
			mine = len(keep)
		}
	}
	return mine < 8 && total < 40
}
func failLogin(ip string) { failMu.Lock(); fails[ip] = append(fails[ip], time.Now()); failMu.Unlock() }

// ---------- http helpers ----------

func secHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
	h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'")
}
func sendJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
func redirect(w http.ResponseWriter, to string) {
	w.Header().Set("Location", to)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(303)
}

var tplVar = regexp.MustCompile(`\{\{\w+\}\}`)

func page(w http.ResponseWriter, code int, file string, vars map[string]string) {
	b, _ := webFS.ReadFile("web/" + file)
	s := string(b)
	esc := strings.NewReplacer("<", "&lt;", ">", "&gt;", "&", "&amp;", `"`, "&quot;")
	for k, v := range vars {
		s = strings.ReplaceAll(s, "{{"+k+"}}", esc.Replace(v))
	}
	s = tplVar.ReplaceAllString(s, "")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	io.WriteString(w, s)
}
func readBody(r *http.Request, max int64, v any) bool {
	b, err := io.ReadAll(io.LimitReader(r.Body, max+1))
	if err != nil || int64(len(b)) > max {
		return false
	}
	return json.Unmarshal(b, v) == nil
}
func formValues(r *http.Request) url.Values {
	b, _ := io.ReadAll(io.LimitReader(r.Body, 4000))
	v, _ := url.ParseQuery(string(b))
	return v
}

var startTime = time.Now()

func serveStatic(w http.ResponseWriter, r *http.Request, p string) bool {
	if strings.HasSuffix(p, ".html") || p == "/" {
		return false
	}
	name := "web" + path.Clean(p)
	f, err := webFS.Open(name)
	if err != nil {
		return false
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		return false
	}
	ct := mime.TypeByExtension(path.Ext(p))
	switch path.Ext(p) {
	case ".webmanifest":
		ct = "application/manifest+json"
	case ".woff":
		ct = "font/woff"
	case ".js":
		ct = "text/javascript; charset=utf-8"
	case ".css":
		ct = "text/css; charset=utf-8"
	}
	w.Header().Set("Content-Type", ct)
	if strings.HasPrefix(p, "/fonts/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeContent(w, r, p, startTime, f.(io.ReadSeeker))
	return true
}

func csvCell(s string) string {
	if s != "" && strings.ContainsAny(s[:1], "=+-@\t\r") {
		return "'" + s
	}
	return s
}

func publicSettings() Settings {
	s := settings
	if s.NtfyToken != "" {
		s.NtfyToken = "••••••"
	}
	s.StripeKey = maskKey(s.StripeKey)
	s.StripeWebhook = maskKey(s.StripeWebhook)
	return s
}
func maskKey(k string) string {
	if k == "" {
		return ""
	}
	pre := k
	if i := strings.LastIndex(k[:min(len(k), 9)], "_"); i > 0 {
		pre = k[:i+1]
	}
	return pre + "••••" + k[max(0, len(k)-4):]
}

// call with mu held
func stripeInfo() map[string]any {
	hookMu.Lock()
	h := hookStatus
	hookMu.Unlock()
	return map[string]any{"keySet": settings.StripeKey != "", "hookSet": settings.StripeWebhook != "", "live": strings.Contains(settings.StripeKey, "_live_"), "hook": h, "vatNote": vatNote(settings.VatMode)}
}
func findLead(id string) *Lead {
	for _, l := range leads {
		if l.ID == id {
			return l
		}
	}
	return nil
}

// ---------- API ----------

var leadPath = regexp.MustCompile(`^/api/leads/([0-9a-f-]{36})(/seen)?$`)

func api(w http.ResponseWriter, r *http.Request, p string) {
	if r.Method != "GET" && r.Header.Get("X-Core") != "1" {
		sendJSON(w, 403, map[string]any{"ok": false, "error": "Hiányzó fejléc."})
		return
	}
	switch {
	case p == "/api/me" && r.Method == "GET":
		sendJSON(w, 200, map[string]any{"ok": true, "version": version, "labels": L, "prices": prices, "setup": setupPrices})
	case p == "/api/leads" && r.Method == "GET":
		mu.Lock()
		b, _ := json.Marshal(map[string]any{"ok": true, "leads": leads})
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(b)
	case p == "/api/leads" && r.Method == "POST":
		var d leadIn
		if !readBody(r, 64<<10, &d) {
			sendJSON(w, 400, map[string]any{"ok": false})
			return
		}
		l := sanitize(d, true)
		if l.Name == "" && l.Business == "" {
			sendJSON(w, 422, map[string]any{"ok": false, "error": "Adj meg legalább egy nevet."})
			return
		}
		mu.Lock()
		leads = append([]*Lead{l}, leads...)
		saveLeads()
		mu.Unlock()
		sendJSON(w, 200, map[string]any{"ok": true, "lead": l})
	case payPath.MatchString(p):
		m := payPath.FindStringSubmatch(p)
		payAPI(w, r, m[1], m[2])
	case p == "/api/stripe/test" && r.Method == "POST":
		stripeTest(w)
	case p == "/api/payments.csv" && r.Method == "GET":
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Disposition", `attachment; filename="befizetesek-`+time.Now().Format("2006-01-02")+`.csv"`)
		io.WriteString(w, "\xEF\xBB\xBF")
		c := csv.NewWriter(w)
		c.Comma = ';'
		c.UseCRLF = true
		c.Write([]string{"Dátum", "Vállalkozás", "Név", "E-mail", "Telefon", "Összeg (Ft)", "Csomag", "Stripe számlaszám", "Stripe nyugta", "Kiszámlázva"})
		mu.Lock()
		rows := paymentsCSVRows()
		mu.Unlock()
		for _, row := range rows {
			for i := range row {
				row[i] = csvCell(row[i])
			}
			c.Write(row)
		}
		c.Flush()
	case leadPath.MatchString(p):
		m := leadPath.FindStringSubmatch(p)
		mu.Lock()
		defer mu.Unlock()
		l := findLead(m[1])
		if l == nil {
			sendJSON(w, 404, map[string]any{"ok": false, "error": "Nincs ilyen érdeklődő."})
			return
		}
		switch {
		case m[2] != "" && r.Method == "POST":
			if !l.Seen {
				l.Seen = true
				saveLeads()
			}
			sendJSON(w, 200, map[string]any{"ok": true, "lead": l})
		case m[2] == "" && r.Method == "PATCH":
			var d map[string]any
			if !readBody(r, 64<<10, &d) {
				sendJSON(w, 400, map[string]any{"ok": false})
				return
			}
			str := func(k string) (string, bool) { v, ok := d[k]; s, _ := v.(string); return s, ok }
			if s, ok := str("status"); ok {
				if pick("status", s) == "" {
					sendJSON(w, 422, map[string]any{"ok": false})
					return
				}
				if s != l.Status {
					l.Status = s
					l.History = append(l.History, Hist{At: nowISO(), Status: s})
					if len(l.History) > 50 {
						l.History = l.History[len(l.History)-50:]
					}
				}
			}
			if s, ok := str("note"); ok {
				l.Note = noteText(s)
			}
			if s, ok := str("demoUrl"); ok {
				l.DemoURL = clean(s, 300)
			}
			if s, ok := str("plan"); ok {
				l.Plan = pick("csomag", s)
			}
			for k, max := range map[string]int{"name": 80, "business": 120, "phone": 40, "email": 120, "city": 60} {
				if s, ok := str(k); ok {
					s = clean(s, max)
					switch k {
					case "name":
						l.Name = s
					case "business":
						l.Business = s
					case "phone":
						l.Phone = s
					case "email":
						l.Email = s
					case "city":
						l.City = s
					}
				}
			}
			l.Seen, l.Updated = true, nowISO()
			saveLeads()
			sendJSON(w, 200, map[string]any{"ok": true, "lead": l})
		case m[2] == "" && r.Method == "DELETE":
			if l.Pay.running() {
				sendJSON(w, 409, map[string]any{"ok": false, "error": "Ennek az ügyfélnek fut az előfizetése. Előbb mondd le."})
				return
			}
			out := leads[:0]
			for _, x := range leads {
				if x != l {
					out = append(out, x)
				}
			}
			leads = out
			saveLeads()
			sendJSON(w, 200, map[string]any{"ok": true})
		default:
			sendJSON(w, 405, map[string]any{"ok": false})
		}
	case p == "/api/stats" && r.Method == "GET":
		resp, err := httpc.Get(siteURL + "/stats")
		if err != nil {
			sendJSON(w, 200, map[string]any{"ok": false, "error": "A weboldal app nem érhető el, ezért most nincs statisztika.", "days": map[string]any{}, "live": 0})
			return
		}
		defer resp.Body.Close()
		var j struct {
			Days  map[string]json.RawMessage `json:"days"`
			Live  int                        `json:"live"`
			Today string                     `json:"today"`
		}
		if json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&j) != nil {
			sendJSON(w, 200, map[string]any{"ok": false, "error": "A statisztika most nem olvasható.", "days": map[string]any{}, "live": 0})
			return
		}
		keys := make([]string, 0, len(j.Days))
		for k := range j.Days {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		if len(keys) > 120 {
			keys = keys[len(keys)-120:]
		}
		days := map[string]json.RawMessage{}
		for _, k := range keys {
			days[k] = j.Days[k]
		}
		sendJSON(w, 200, map[string]any{"ok": true, "days": days, "live": j.Live, "today": j.Today})
	case p == "/api/status" && r.Method == "GET":
		stMu.Lock()
		s := status
		stMu.Unlock()
		sendJSON(w, 200, map[string]any{"ok": true, "status": s, "version": version})
	case p == "/api/check" && r.Method == "POST":
		check()
		stMu.Lock()
		s := status
		stMu.Unlock()
		sendJSON(w, 200, map[string]any{"ok": true, "status": s})
	case p == "/api/settings" && r.Method == "GET":
		mu.Lock()
		s := publicSettings()
		si := stripeInfo()
		mu.Unlock()
		sendJSON(w, 200, map[string]any{"ok": true, "settings": s, "stripe": si})
	case p == "/api/settings" && r.Method == "PUT":
		var d map[string]any
		if !readBody(r, 16<<10, &d) {
			sendJSON(w, 400, map[string]any{"ok": false})
			return
		}
		validURL := func(v any) (string, bool) {
			s, _ := v.(string)
			s = clean(s, 300)
			if s == "" {
				return "", true
			}
			u, err := url.Parse(s)
			if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
				return "", false
			}
			return strings.TrimRight(u.String(), "/"), true
		}
		mu.Lock()
		next := settings
		mu.Unlock()
		cfgChanged := false
		errs := map[string]string{"ntfyUrl": "Az ntfy-cím nem érvényes (pl. https://ntfy.sh/titkos-nev).", "siteUrl": "A weboldal címe nem érvényes.", "dashUrl": "Az Irányítópult címe nem érvényes.", "portalUrl": "Az ügyfélportál linkje nem érvényes (https://billing.stripe.com/p/login/…)."}
		for k, msg := range errs {
			if v, ok := d[k]; ok {
				s, good := validURL(v)
				if !good {
					sendJSON(w, 422, map[string]any{"ok": false, "error": msg})
					return
				}
				switch k {
				case "ntfyUrl":
					next.NtfyURL = s
				case "siteUrl":
					next.SiteURL = s
				case "dashUrl":
					next.DashURL = s
				case "portalUrl":
					if s != "" && !strings.HasPrefix(s, "https://") {
						sendJSON(w, 422, map[string]any{"ok": false, "error": msg})
						return
					}
					next.PortalURL = s
					cfgChanged = true
				}
			}
		}
		if v, ok := d["ntfyToken"].(string); ok && v != "••••••" {
			next.NtfyToken = clean(v, 200)
		}
		if v, ok := d["notifyLeads"].(bool); ok {
			next.NotifyLeads = v
		}
		if v, ok := d["notifyDown"].(bool); ok {
			next.NotifyDown = v
		}
		if v, ok := d["notifyPay"].(bool); ok {
			next.NotifyPay = v
		}
		if v, ok := d["stripeKey"].(string); ok && !strings.Contains(v, "••••") {
			v = strings.TrimSpace(v)
			if v != "" && !stripeKey.MatchString(v) {
				sendJSON(w, 422, map[string]any{"ok": false, "error": "Ez nem Stripe titkos kulcs. sk_test_… vagy sk_live_… kezdetű kulcsot másolj be (Fejlesztők → API-kulcsok)."})
				return
			}
			next.StripeKey = v
		}
		if v, ok := d["stripeWebhook"].(string); ok && !strings.Contains(v, "••••") {
			v = strings.TrimSpace(v)
			if v != "" && !whsecRe.MatchString(v) {
				sendJSON(w, 422, map[string]any{"ok": false, "error": "A webhook kulcs whsec_ kezdetű (Fejlesztők → Webhookok → a végpont → Aláíró kulcs)."})
				return
			}
			next.StripeWebhook = v
		}
		if v, ok := d["vatMode"].(string); ok {
			if v != "brutto" && v != "netto" && v != "mentes" {
				sendJSON(w, 422, map[string]any{"ok": false})
				return
			}
			next.VatMode = v
			cfgChanged = true
		}
		spotsChanged := false
		if v, ok := d["spots"].(float64); ok {
			n := int(v + 0.5)
			next.Spots = max(0, min(99, n))
			spotsChanged = true
		}
		mu.Lock()
		settings = next
		err := writeJSON("settings.json", settings)
		s := publicSettings()
		si := stripeInfo()
		mu.Unlock()
		if err != nil {
			sendJSON(w, 500, map[string]any{"ok": false, "error": "Nem sikerült menteni."})
			return
		}
		synced := true
		if spotsChanged || cfgChanged {
			synced = pushConfig()
		}
		sendJSON(w, 200, map[string]any{"ok": true, "synced": synced, "settings": s, "stripe": si})
	case p == "/api/test-ntfy" && r.Method == "POST":
		if err := ntfy(ntfyMsg{Title: "core Irányítópult", Message: "Működik! Innen kapod majd az új érdeklődőket.", Tags: []string{"tada"}, Priority: 3}); err != nil {
			sendJSON(w, 502, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		sendJSON(w, 200, map[string]any{"ok": true})
	case p == "/api/password" && r.Method == "POST":
		var d struct{ Old, New string }
		if !readBody(r, 4000, &d) {
			sendJSON(w, 400, map[string]any{"ok": false})
			return
		}
		if !checkPassword(d.Old) {
			sendJSON(w, 403, map[string]any{"ok": false, "error": "A jelenlegi jelszó nem jó."})
			return
		}
		if utf8.RuneCountInString(d.New) < 8 {
			sendJSON(w, 422, map[string]any{"ok": false, "error": "Az új jelszó legalább 8 karakter legyen."})
			return
		}
		if err := setPassword(d.New); err != nil {
			sendJSON(w, 500, map[string]any{"ok": false, "error": "Nem sikerült menteni."})
			return
		}
		setSession(w, r)
		sendJSON(w, 200, map[string]any{"ok": true})
	case p == "/api/export.csv" && r.Method == "GET":
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Disposition", `attachment; filename="erdeklodok-`+time.Now().Format("2006-01-02")+`.csv"`)
		io.WriteString(w, "\xEF\xBB\xBF")
		c := csv.NewWriter(w)
		c.Comma = ';'
		c.UseCRLF = true
		c.Write([]string{"Beérkezett", "Állapot", "Vállalkozás", "Név", "Telefon", "E-mail", "Település", "Típus", "Csomag", "Havidíj", "Funkciók", "Stílus", "Helyzet", "Link", "Mikorra", "Hívható", "Üzenet", "Jegyzet", "Bemutató", "Forrás"})
		mu.Lock()
		for _, l := range leads {
			var f []string
			for _, x := range l.Features {
				f = append(f, L["funkciok"][x])
			}
			price := ""
			if n, ok := prices[l.Plan]; ok {
				price = strconv.Itoa(n)
			}
			row := []string{l.Created, L["status"][l.Status], l.Business, l.Name, l.Phone, l.Email, l.City, L["tipus"][l.Type], L["csomag"][l.Plan], price, strings.Join(f, ", "), L["stilus"][l.Style], L["helyzet"][l.Situation], l.Link, L["mikorra"][l.Timing], L["hivhato"][l.CallTime], l.Message, l.Note, l.DemoURL, l.Source}
			for i := range row {
				row[i] = csvCell(row[i])
			}
			c.Write(row)
		}
		mu.Unlock()
		c.Flush()
	case p == "/api/backup.json" && r.Method == "GET":
		mu.Lock()
		s := settings
		s.NtfyToken, s.StripeKey, s.StripeWebhook = "", "", ""
		b, _ := json.MarshalIndent(map[string]any{"version": version, "exported": nowISO(), "leads": leads, "settings": s}, "", " ")
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="core-mentes-`+time.Now().Format("2006-01-02")+`.json"`)
		w.Write(b)
	default:
		sendJSON(w, 404, map[string]any{"ok": false, "error": "Nincs ilyen végpont."})
	}
}

// ---------- main handler ----------

func handler(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if e := recover(); e != nil {
			log.Print("panic: ", e)
			sendJSON(w, 500, map[string]any{"ok": false, "error": "Szerverhiba."})
		}
	}()
	secHeaders(w)
	p := r.URL.Path
	if p == "/healthz" {
		io.WriteString(w, "ok")
		return
	}
	if (r.Method == "GET" || r.Method == "HEAD") && serveStatic(w, r, p) {
		return
	}
	if p == "/setup" {
		if hasPassword() {
			redirect(w, "/login")
			return
		}
		if fromInternet(r) {
			page(w, 403, "setup.html", map[string]string{"error": "Biztonsági okból az első jelszót otthonról kell beállítani: nyisd meg az appot az Umbrel kezdőképernyőjéről vagy Tailscale-en keresztül.", "disabled": "disabled"})
			return
		}
		if r.Method == "POST" {
			f := formValues(r)
			a, b := f.Get("jelszo"), f.Get("jelszo2")
			if utf8.RuneCountInString(a) < 8 {
				page(w, 422, "setup.html", map[string]string{"error": "A jelszó legalább 8 karakter legyen."})
				return
			}
			if a != b {
				page(w, 422, "setup.html", map[string]string{"error": "A két jelszó nem egyezik."})
				return
			}
			if err := setPassword(a); err != nil {
				page(w, 500, "setup.html", map[string]string{"error": "Nem sikerült menteni. Ellenőrizd az app adatmappáját."})
				return
			}
			setSession(w, r)
			redirect(w, "/")
			return
		}
		page(w, 200, "setup.html", nil)
		return
	}
	if !hasPassword() {
		if strings.HasPrefix(p, "/api/") {
			sendJSON(w, 401, map[string]any{"ok": false})
		} else {
			redirect(w, "/setup")
		}
		return
	}
	if p == "/login" {
		if r.Method == "POST" {
			ip := clientIP(r)
			if !loginAllowed(ip) {
				page(w, 429, "login.html", map[string]string{"error": "Túl sok próbálkozás. Várj 15 percet."})
				return
			}
			if !checkPassword(formValues(r).Get("jelszo")) {
				failLogin(ip)
				time.Sleep(600 * time.Millisecond)
				page(w, 200, "login.html", map[string]string{"error": "Hibás jelszó."})
				return
			}
			failMu.Lock()
			delete(fails, ip)
			failMu.Unlock()
			setSession(w, r)
			redirect(w, "/")
			return
		}
		if authed(r) {
			redirect(w, "/")
			return
		}
		page(w, 200, "login.html", nil)
		return
	}
	if p == "/logout" && r.Method == "POST" {
		http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
		redirect(w, "/login")
		return
	}
	if !authed(r) {
		if strings.HasPrefix(p, "/api/") {
			sendJSON(w, 401, map[string]any{"ok": false, "error": "Jelentkezz be újra."})
		} else {
			redirect(w, "/login")
		}
		return
	}
	if strings.HasPrefix(p, "/api/") {
		api(w, r, p)
		return
	}
	if p == "/" || p == "/index.html" {
		page(w, 200, "index.html", nil)
		return
	}
	http.NotFound(w, r)
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
	log.Printf("core Irányítópult %s on :%s", version, port)
	log.Fatal(srv.ListenAndServe())
}
