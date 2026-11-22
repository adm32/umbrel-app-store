// Zala Studio weboldal – configuration set by the Irányítópult (POST /config on the internal port),
// and page statistics (no IP addresses stored; cookies only with consent, see cookies.go).

package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	_ "time/tzdata"
)

// ---------- configuration (set by the Irányítópult) ----------

var (
	cfgMu  sync.Mutex
	config = struct {
		Spots  int    `json:"spots"`
		Vat    string `json:"vat"`
		Portal string `json:"portal"`
	}{Spots: 5, Vat: "mentes"}
)

// ---------- statistics (no IP addresses stored; cookies only with consent, see cookies.go) ----------

type day struct {
	PV    int            `json:"pv"`
	UV    int            `json:"uv"`
	Dev   map[string]int `json:"dev"`
	Ref   map[string]int `json:"ref"`
	Pages map[string]int `json:"pages"`
	Ev    map[string]int `json:"ev"`
	Src   map[string]int `json:"src"`
	Ck    int            `json:"ck"`  // visitors who accepted cookies
	Ret   int            `json:"ret"` // of those, the ones who were here on an earlier day
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
	known, returning := trackVisitor(r, e.T, firstNonEmpty(e.P, "/"), e.R, e.S, e.Src)
	switch e.T {
	case "pv":
		d.PV++
		if !seen[visitor] {
			seen[visitor] = true
			d.UV++
			if known {
				d.Ck++
				if returning {
					d.Ret++
				}
			}
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
	for len(keys) > 395 {
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
