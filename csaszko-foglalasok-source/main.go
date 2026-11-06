// Csaszko Foglalások – booking server for Csaszko Barbershop (Go, standard library only).
//
// A port of the earlier Node.js version (itself based on Esszencia Foglalások), with the same
// HTTP API and the same data files, so an update keeps every booking and setting.
//
// Three listeners:
//   - PUBLIC_PORT (3001): only what the website needs – services, free times, new bookings,
//     anonymous statistics. Reached by the website app over Umbrel's internal network.
//   - ADMIN_PORT (8080): the admin app, behind Umbrel's login through app_proxy.
//   - REMOTE_PORT (8082, published as 4773): the same admin app with its own password, for a
//     Cloudflare Tunnel hostname. Stays locked until a password is set from the Umbrel address.
//
// Data lives in DATA_DIR as JSON (db.json, settings.json, stats.json, stats-today.json).
// All dates and times are Budapest wall-clock strings ("2026-11-03", "09:30").
package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	_ "time/tzdata"
	"unicode/utf8"
)

//go:embed web
var webFS embed.FS

var (
	dataDir    = envOr("DATA_DIR", "data")
	adminPort  = envOr("ADMIN_PORT", "8080")
	publicPort = envOr("PUBLIC_PORT", "3001")
	remotePort = os.Getenv("REMOTE_PORT")
	loc        *time.Location
	mu         sync.Mutex // guards db, settings, stats and the limiters
)

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

/* ---------------------------------------------------------------- types */

type Service struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Note    string `json:"note"`
	Minutes int    `json:"minutes"`
	Price   *int   `json:"price"`
}

type BService struct {
	ID    string `json:"id"`
	Hu    string `json:"hu"`
	Price *int   `json:"price"`
}

type MailRec struct {
	Kind  string `json:"kind"`
	At    string `json:"at"`
	OK    bool   `json:"ok"`
	Error string `json:"error"`
}

type Booking struct {
	ID        string   `json:"id"`
	Status    string   `json:"status"` // pending | confirmed | declined | cancelled
	Source    string   `json:"source"` // web | manual
	Date      string   `json:"date"`
	Time      string   `json:"time"`
	Minutes   int      `json:"minutes"`
	Service   BService `json:"service"`
	Note      string   `json:"note"`
	Name      string   `json:"name"`
	Phone     string   `json:"phone"`
	Email     string   `json:"email"`
	CreatedAt string   `json:"createdAt"`
	UpdatedAt string   `json:"updatedAt,omitempty"`
	Message   string   `json:"message,omitempty"`
	Mail      *MailRec `json:"mail,omitempty"`
}

type Block struct {
	ID        string `json:"id"`
	Date      string `json:"date"`
	DateTo    string `json:"dateTo"`
	AllDay    bool   `json:"allDay"`
	From      string `json:"from"`
	To        string `json:"to"`
	Note      string `json:"note"`
	CreatedAt string `json:"createdAt"`
}

type DB struct {
	Bookings []*Booking `json:"bookings"`
	Blocks   []*Block   `json:"blocks"`
}

type SMTPConf struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Secure   bool   `json:"secure"`
	User     string `json:"user"`
	Pass     string `json:"pass"`
	FromName string `json:"fromName"`
}

type Remote struct {
	Hash  string `json:"hash,omitempty"`
	Salt  string `json:"salt,omitempty"`
	Ver   int    `json:"ver"`
	SetAt string `json:"setAt,omitempty"`
}

type Settings struct {
	// JS weekday keys: "0" = vasárnap … "6" = szombat. null = zárva. The second time is the LAST START.
	Hours            map[string][]string `json:"hours"`
	StepMinutes      int                 `json:"stepMinutes"`
	BufferMinutes    int                 `json:"bufferMinutes"`
	MinNoticeMinutes int                 `json:"minNoticeMinutes"`
	HorizonDays      int                 `json:"horizonDays"`
	AutoConfirm      bool                `json:"autoConfirm"`
	SameDay          bool                `json:"sameDay"` // false: the website books from tomorrow on
	Services         []Service           `json:"services"`
	SMTP             SMTPConf            `json:"smtp"`
	NotifyEmail      string              `json:"notifyEmail"`
	NtfyURL          string              `json:"ntfyUrl"`
	AdminURL         string              `json:"adminUrl"`
	SiteURL          string              `json:"siteUrl"`
	Secret           string              `json:"secret"`
	Remote           *Remote             `json:"remote,omitempty"`
}

func ip(n int) *int { return &n }

func defaultServices() []Service {
	return []Service{
		{ID: "haj", Name: "Hajvágás", Minutes: 40, Price: ip(3500)},
		{ID: "rovid", Name: "Rövid hajvágás", Minutes: 20, Price: ip(3500)},
		{ID: "hajszakall", Name: "Haj + szakáll", Minutes: 50, Price: ip(5500)},
		{ID: "szakall", Name: "Szakálligazítás", Minutes: 20, Price: ip(2000)},
		{ID: "gyerek", Name: "Gyerek hajvágás", Note: "13 éves korig", Minutes: 30, Price: ip(3000)},
	}
}

func defaultSettings() *Settings {
	open := []string{"15:00", "21:00"}
	return &Settings{
		Hours:            map[string][]string{"0": open, "1": nil, "2": open, "3": open, "4": open, "5": open, "6": open},
		StepMinutes:      20,
		MinNoticeMinutes: 30,
		HorizonDays:      30,
		Services:         defaultServices(),
		SMTP:             SMTPConf{Host: "smtp.gmail.com", Port: 465, Secure: true, FromName: "Csaszko Barbershop"},
		NotifyEmail:      "csaszarb666@gmail.com",
		SiteURL:          "https://csaszko.admcore.hu",
	}
}

/* -------------------------------------------------------------- storage */

var (
	db       = &DB{}
	settings = defaultSettings()
)

func dbFile() string       { return filepath.Join(dataDir, "db.json") }
func settingsFile() string { return filepath.Join(dataDir, "settings.json") }

func readJSON(file string, v any) bool {
	b, err := os.ReadFile(file)
	if err != nil {
		return false
	}
	if err := json.Unmarshal(b, v); err != nil {
		log.Printf("%s: %v", file, err)
		return false
	}
	return true
}

func writeJSON(file string, v any) {
	b, err := json.MarshalIndent(v, "", " ")
	if err != nil {
		log.Print(err)
		return
	}
	tmp := file + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		log.Print(err)
		return
	}
	if err := os.Rename(tmp, file); err != nil {
		log.Print(err)
	}
}

func saveDB()       { writeJSON(dbFile(), db) }
func saveSettings() { writeJSON(settingsFile(), settings) }

func loadAll() {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		log.Fatal(err)
	}
	readJSON(dbFile(), db)
	if db.Bookings == nil {
		db.Bookings = []*Booking{}
	}
	if db.Blocks == nil {
		db.Blocks = []*Block{}
	}
	readJSON(settingsFile(), settings) // fills over the defaults, like the old deep merge
	if settings.Hours == nil {
		settings.Hours = defaultSettings().Hours
	}
	if len(settings.Services) == 0 {
		settings.Services = defaultServices()
	}
	if settings.SMTP.Port == 0 {
		settings.SMTP.Port = 465
	}
	if settings.StepMinutes == 0 {
		settings.StepMinutes = 20
	}
	if settings.HorizonDays == 0 {
		settings.HorizonDays = 30
	}
	if settings.Secret == "" {
		settings.Secret = randHex(24)
		saveSettings()
	}
	loadStats()
}

func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func serviceByID(id string) *Service {
	for i := range settings.Services {
		if settings.Services[i].ID == id {
			return &settings.Services[i]
		}
	}
	return nil
}

func ft(n int) string {
	s := strconv.Itoa(n)
	var out []byte
	for i := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, ' ')
		}
		out = append(out, s[i])
	}
	return string(out) + " Ft"
}

/* ----------------------------------------------------------------- time */

var (
	reDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	reTime = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)
)

func toMin(t string) int {
	p := strings.SplitN(t, ":", 2)
	if len(p) != 2 {
		return 0
	}
	h, _ := strconv.Atoi(p[0])
	m, _ := strconv.Atoi(p[1])
	return h*60 + m
}
func fromMin(n int) string { return fmt.Sprintf("%02d:%02d", n/60, n%60) }

func parseDate(d string) (time.Time, bool) {
	t, err := time.Parse("2006-01-02", d)
	return t, err == nil
}
func dayNum(d string) int {
	t, ok := parseDate(d)
	if !ok {
		return 0
	}
	return int(t.Unix() / 86400)
}
func weekday(d string) int {
	t, _ := parseDate(d)
	return int(t.Weekday())
}
func addDays(d string, n int) string {
	t, _ := parseDate(d)
	return t.AddDate(0, 0, n).Format("2006-01-02")
}
func isDate(s string) bool {
	if !reDate.MatchString(s) {
		return false
	}
	t, ok := parseDate(s)
	return ok && t.Format("2006-01-02") == s
}
func isTime(s string) bool { return reTime.MatchString(s) }

type nowT struct {
	date string
	min  int
	abs  int
}

func now() nowT {
	t := time.Now().In(loc)
	d := t.Format("2006-01-02")
	m := t.Hour()*60 + t.Minute()
	return nowT{d, m, dayNum(d)*1440 + m}
}

func isoNow() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }

func budapestDate(iso string) string {
	t, err := time.Parse(time.RFC3339Nano, iso)
	if err != nil {
		return ""
	}
	return t.In(loc).Format("2006-01-02")
}

/* --------------------------------------------------------- availability */

func active(status string) bool { return status == "pending" || status == "confirmed" }

func hoursFor(d string) []string {
	h := settings.Hours[strconv.Itoa(weekday(d))]
	if len(h) != 2 {
		return nil
	}
	return h
}

func busy(date, excludeID string) [][2]int {
	buf := settings.BufferMinutes
	var out [][2]int
	for _, b := range db.Bookings {
		if b.Date == date && active(b.Status) && b.ID != excludeID {
			out = append(out, [2]int{toMin(b.Time) - buf, toMin(b.Time) + b.Minutes + buf})
		}
	}
	for _, k := range db.Blocks {
		to := k.DateTo
		if to == "" {
			to = k.Date
		}
		if date >= k.Date && date <= to {
			if k.AllDay {
				out = append(out, [2]int{0, 1440})
			} else {
				out = append(out, [2]int{toMin(k.From), toMin(k.To)})
			}
		}
	}
	return out
}

// freeStarts: start times that can be booked on date for a service of the given length.
// The closing time is the last possible START: a cut may run past it.
func freeStarts(date string, minutes int, admin bool, excludeID string) []string {
	h := hoursFor(date)
	res := []string{}
	if h == nil {
		return res
	}
	t := now()
	if !admin && (date < t.date || (date == t.date && !settings.SameDay) || date > addDays(t.date, settings.HorizonDays)) {
		return res
	}
	earliest := math.MinInt
	if !admin {
		earliest = t.abs + settings.MinNoticeMinutes
	}
	b := busy(date, excludeID)
	step := settings.StepMinutes
	if step <= 0 {
		step = 20
	}
	dn := dayNum(date) * 1440
	for s := toMin(h[0]); s <= toMin(h[1]); s += step {
		if dn+s < earliest {
			continue
		}
		e := s + minutes
		clash := false
		for _, z := range b {
			if s < z[1] && e > z[0] {
				clash = true
				break
			}
		}
		if !clash {
			res = append(res, fromMin(s))
		}
	}
	return res
}

func overlaps(date, tm string, minutes int, excludeID string) bool {
	s := toMin(tm)
	e := s + minutes
	for _, z := range busy(date, excludeID) {
		if s < z[1] && e > z[0] {
			return true
		}
	}
	return false
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

/* ----------------------------------------------------------- validation */

var (
	reCtrl  = regexp.MustCompile("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
	reSpace = regexp.MustCompile(`\s+`)
	reEmail = regexp.MustCompile(`(?i)^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$`)
	rePhone = regexp.MustCompile(`^[0-9+()/.\-\s]{6,30}$`)
	reDigit = regexp.MustCompile(`\d`)
)

// asStr turns a decoded JSON value into a string the way JavaScript's String() would.
func asStr(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case json.Number:
		return x.String()
	case bool:
		if x {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprint(x)
	}
}

func cut(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return string(r[:max])
}

func str(v any, max int) string {
	return cut(strings.TrimSpace(reCtrl.ReplaceAllString(asStr(v), "")), max)
}
func oneLine(v any, max int) string {
	return reSpace.ReplaceAllString(str(v, max), " ")
}
func isEmail(s string) bool { return len(s) <= 120 && reEmail.MatchString(s) }
func isPhone(s string) bool {
	return rePhone.MatchString(s) && len(reDigit.FindAllString(s, -1)) >= 6
}

// num: a number from JSON (number or numeric string); NaN when it is neither.
func num(v any) float64 {
	switch x := v.(type) {
	case json.Number:
		f, err := x.Float64()
		if err != nil {
			return math.NaN()
		}
		return f
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		if err != nil {
			return math.NaN()
		}
		return f
	case bool:
		if x {
			return 1
		}
		return 0
	case nil:
		return math.NaN()
	}
	return math.NaN()
}

// parseInt like JavaScript's parseInt(v, 10): leading digits of the text, NaN if none.
var reLeadInt = regexp.MustCompile(`^\s*([+-]?\d+)`)

func parseInt(v any) (int, bool) {
	m := reLeadInt.FindStringSubmatch(asStr(v))
	if m == nil {
		return 0, false
	}
	n, err := strconv.Atoi(m[1])
	return n, err == nil
}

func clampMinutes(v any) int {
	n := num(v)
	if math.IsNaN(n) || n == 0 {
		n = 40
	}
	r := int(math.Round(n))
	if r < 10 {
		r = 10
	}
	if r > 240 {
		r = 240
	}
	return r
}

// truthy like JavaScript's !!v.
func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case json.Number:
		f, _ := x.Float64()
		return f != 0
	}
	return true
}
func isFalse(v any) bool { b, ok := v.(bool); return ok && !b }

/* ------------------------------------------------------------ rate limit */

var hits = map[string][]int64{}

// limited: true when key already used max times within the window. checkOnly does not count this call.
// Callers hold mu.
func limited(key string, max int, window time.Duration, checkOnly bool) bool {
	t := time.Now().UnixMilli()
	w := window.Milliseconds()
	arr := hits[key][:0:0]
	for _, x := range hits[key] {
		if t-x < w {
			arr = append(arr, x)
		}
	}
	hits[key] = arr
	if len(arr) >= max {
		return true
	}
	if !checkOnly {
		hits[key] = append(arr, t)
	}
	return false
}

func cleanHits() {
	for range time.Tick(10 * time.Minute) {
		mu.Lock()
		t := time.Now().UnixMilli()
		for k, v := range hits {
			keep := false
			for _, x := range v {
				if t-x < 3600000 {
					keep = true
					break
				}
			}
			if !keep {
				delete(hits, k)
			}
		}
		mu.Unlock()
	}
}

/* ------------------------------------------------------------ http utils */

func send(w http.ResponseWriter, status int, obj any) {
	b, _ := json.Marshal(obj)
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	w.Write(b)
}

type obj = map[string]any

var errTooLarge = errors.New("too large")

// readBody decodes a JSON object body (empty body = {}).
func readBody(w http.ResponseWriter, r *http.Request, limit int64) (obj, int, error) {
	b, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		return nil, 400, err
	}
	if int64(len(b)) > limit {
		return nil, 413, errTooLarge
	}
	out := obj{}
	if len(strings.TrimSpace(string(b))) == 0 {
		return out, 0, nil
	}
	d := json.NewDecoder(strings.NewReader(string(b)))
	d.UseNumber()
	var v any
	if err := d.Decode(&v); err != nil {
		return nil, 400, err
	}
	if m, ok := v.(map[string]any); ok {
		return m, 0, nil
	}
	return out, 0, nil
}

func clientIP(r *http.Request) string {
	if v := strings.TrimSpace(r.Header.Get("Cf-Connecting-Ip")); v != "" {
		return v
	}
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		if f := strings.TrimSpace(strings.Split(v, ",")[0]); f != "" {
			return f
		}
	}
	h, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return h
}

func sortedBookings() []*Booking {
	out := append([]*Booking{}, db.Bookings...) // never null in JSON
	sort.SliceStable(out, func(i, j int) bool { return out[i].Date+out[i].Time < out[j].Date+out[j].Time })
	return out
}

/* ---------------------------------------------------------- housekeeping */

func purge() {
	mu.Lock()
	defer mu.Unlock()
	// personal data is not kept forever: bookings older than a year are removed
	cutoff := addDays(now().date, -365)
	before := len(db.Bookings) + len(db.Blocks)
	bk := db.Bookings[:0]
	for _, b := range db.Bookings {
		if b.Date >= cutoff {
			bk = append(bk, b)
		}
	}
	db.Bookings = bk
	bl := db.Blocks[:0]
	for _, k := range db.Blocks {
		to := k.DateTo
		if to == "" {
			to = k.Date
		}
		if to >= cutoff {
			bl = append(bl, k)
		}
	}
	db.Blocks = bl
	if len(db.Bookings)+len(db.Blocks) != before {
		saveDB()
	}
}

/* ----------------------------------------------------------------- start */

func serve(port string, h http.HandlerFunc, name string) *http.Server {
	srv := &http.Server{
		Addr: ":" + port,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if e := recover(); e != nil {
					log.Printf("[%s] panic: %v", name, e)
					send(w, 500, obj{"error": "Szerverhiba."})
				}
			}()
			h(w, r)
		}),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	return srv
}

func main() {
	var err error
	loc, err = time.LoadLocation("Europe/Budapest")
	if err != nil {
		log.Fatal(err)
	}
	loadAll()
	purge()
	go func() {
		for range time.Tick(12 * time.Hour) {
			purge()
		}
	}()
	go cleanHits()
	go func() {
		for range time.Tick(30 * time.Second) {
			flushStats()
		}
	}()

	servers := []*http.Server{
		serve(publicPort, publicAPI, "public"),
		serve(adminPort, func(w http.ResponseWriter, r *http.Request) { adminAPI(w, r, false) }, "admin"),
	}
	log.Print("Public booking API on :" + publicPort)
	log.Print("Admin app on :" + adminPort)
	if remotePort != "" {
		servers = append(servers, serve(remotePort, remoteAPI, "remote"))
		log.Print("Remote admin (own password) on :" + remotePort)
	}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
	<-sig
	flushStats()
	for _, s := range servers {
		s.Close()
	}
}
