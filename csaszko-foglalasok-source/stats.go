package main

// Anonymous, cookie-free website statistics. Only daily counters are kept.
// Unique visitors are counted with a hash of (IP + browser) and a random salt
// that is thrown away every day, so nobody can be recognised or followed.

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
)

type DayRec struct {
	Views    int            `json:"views"`
	Visitors int            `json:"visitors"`
	Dev      map[string]int `json:"dev"`
	Ref      map[string]int `json:"ref"`
	Ev       map[string]int `json:"ev"`
}

type Stats struct {
	Days map[string]*DayRec `json:"days"`
}

type TodayVis struct {
	Date string   `json:"date"`
	Salt string   `json:"salt"`
	Seen []string `json:"seen"`
}

var (
	stats      = &Stats{Days: map[string]*DayRec{}}
	todayVis   *TodayVis
	seen       = map[string]bool{}
	statsDirty bool
	events     = map[string]bool{"book_open": true, "book_service": true, "book_time": true, "book_sent": true, "call": true, "map": true, "instagram": true, "tiktok": true, "gallery": true, "next_time": true}
	botUA      = regexp.MustCompile(`(?i)bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|lighthouse|pingdom|uptime|monitor|curl|wget|python|java/|go-http|node-fetch|axios|headless`)
)

func statsFile() string { return filepath.Join(dataDir, "stats.json") }
func todayFile() string { return filepath.Join(dataDir, "stats-today.json") }

func loadStats() {
	readJSON(statsFile(), stats)
	if stats.Days == nil {
		stats.Days = map[string]*DayRec{}
	}
	t := &TodayVis{}
	if readJSON(todayFile(), t) && t.Date != "" {
		todayVis = t
		for _, s := range t.Seen {
			seen[s] = true
		}
	}
}

func visitorDay() *TodayVis {
	d := now().date
	if todayVis == nil || todayVis.Date != d {
		todayVis = &TodayVis{Date: d, Salt: randHex(16), Seen: []string{}}
		seen = map[string]bool{}
		statsDirty = true
	}
	return todayVis
}

func dayRec(d string) *DayRec {
	r := stats.Days[d]
	if r == nil {
		r = &DayRec{}
		stats.Days[d] = r
	}
	if r.Dev == nil {
		r.Dev = map[string]int{}
	}
	if r.Ref == nil {
		r.Ref = map[string]int{}
	}
	if r.Ev == nil {
		r.Ev = map[string]int{}
	}
	return r
}

var (
	reFB     = regexp.MustCompile(`(^|\.)facebook\.com$|(^|\.)fb\.(com|me)$|messenger\.com$`)
	reInsta  = regexp.MustCompile(`instagram\.com$`)
	reTikTok = regexp.MustCompile(`tiktok\.com$`)
	reGoogle = regexp.MustCompile(`(^|\.)google\.[a-z.]+$`)
	reOther  = regexp.MustCompile(`bing\.com$|duckduckgo\.com$|yahoo\.|ecosia\.org$`)
	reMaps   = regexp.MustCompile(`maps\.apple\.com$|waze\.com$`)
)

func refSource(host string) string {
	host = cut(strings.TrimPrefix(strings.ToLower(host), "www."), 80)
	switch {
	case host == "":
		return "Közvetlen"
	case reFB.MatchString(host):
		return "Facebook"
	case reInsta.MatchString(host):
		return "Instagram"
	case reTikTok.MatchString(host):
		return "TikTok"
	case reGoogle.MatchString(host):
		return "Google"
	case reOther.MatchString(host):
		return "Más keresők"
	case reMaps.MatchString(host):
		return "Térkép"
	}
	return host
}

// recordHit counts a page view or a click. Callers hold mu.
func recordHit(r *http.Request, body obj) {
	ua := r.Header.Get("User-Agent")
	if ua == "" || botUA.MatchString(ua) {
		return
	}
	t := asStr(body["t"])
	e := asStr(body["e"])
	isView := t == "view"
	if !isView && !(t == "event" && events[e]) {
		return
	}
	v := visitorDay()
	rec := dayRec(v.Date)
	if isView {
		m := hmac.New(sha256.New, []byte(v.Salt))
		m.Write([]byte(clientIP(r) + "|" + ua))
		id := hex.EncodeToString(m.Sum(nil))[:16]
		if !seen[id] {
			seen[id] = true
			v.Seen = append(v.Seen, id)
			rec.Visitors++
		}
		rec.Views++
		w := num(body["w"])
		dev := "desktop"
		if w > 0 && w < 760 {
			dev = "mobile"
		} else if w > 0 && w < 1100 {
			dev = "tablet"
		}
		rec.Dev[dev]++
		if !truthy(body["internal"]) {
			src := refSource(oneLine(body["ref"], 120))
			if _, ok := rec.Ref[src]; !ok && len(rec.Ref) >= 25 {
				src = "Egyéb"
			}
			rec.Ref[src]++
		}
	} else {
		rec.Ev[e]++
	}
	statsDirty = true
}

func flushStats() {
	mu.Lock()
	defer mu.Unlock()
	if !statsDirty {
		return
	}
	statsDirty = false
	cutoff := addDays(now().date, -400)
	for d := range stats.Days {
		if d < cutoff {
			delete(stats.Days, d)
		}
	}
	writeJSON(statsFile(), stats)
	if todayVis != nil {
		writeJSON(todayFile(), todayVis)
	}
}

func bump(m map[string]int, k string, n int) { m[k] += n }

func statsReport(days int) obj {
	t := now().date
	from := addDays(t, -(days - 1))
	prevFrom := addDays(from, -days)
	type pt struct {
		D        string `json:"d"`
		Visitors int    `json:"visitors"`
		Views    int    `json:"views"`
	}
	series := []pt{}
	sum := obj{}
	tv, tw := 0, 0
	dev, ref, ev := map[string]int{}, map[string]int{}, map[string]int{}
	pv, pw := 0, 0
	for i := 0; i < days; i++ {
		d := addDays(from, i)
		r := stats.Days[d]
		if r == nil {
			r = &DayRec{}
		}
		series = append(series, pt{d, r.Visitors, r.Views})
		tw += r.Views
		tv += r.Visitors
		for k, n := range r.Dev {
			bump(dev, k, n)
		}
		for k, n := range r.Ref {
			bump(ref, k, n)
		}
		for k, n := range r.Ev {
			bump(ev, k, n)
		}
		if p := stats.Days[addDays(prevFrom, i)]; p != nil {
			pw += p.Views
			pv += p.Visitors
		}
	}
	sum["views"], sum["visitors"], sum["dev"], sum["ref"], sum["ev"] = tw, tv, dev, ref, ev
	in := func(d, a, b string) bool { return d >= a && d <= b }
	reqs, prevReqs := 0, 0
	status := map[string]int{}
	services := map[string]int{}
	weekdays := []int{0, 0, 0, 0, 0, 0, 0}
	hours := map[string]int{}
	upcoming, revenue, done := 0, 0, 0
	for _, b := range db.Bookings {
		cd := budapestDate(b.CreatedAt)
		if b.Source != "manual" && b.CreatedAt != "" {
			if in(cd, from, t) {
				reqs++
				status[b.Status]++
			} else if in(cd, prevFrom, addDays(from, -1)) {
				prevReqs++
			}
		}
		if active(b.Status) && b.CreatedAt != "" && in(cd, from, t) {
			name := b.Service.Hu
			if name == "" {
				name = "Szolgáltatás"
			}
			services[name]++
			weekdays[weekday(b.Date)]++
			if len(b.Time) >= 2 {
				hours[b.Time[:2]]++
			}
		}
		if b.Status == "confirmed" && b.Date >= t && b.Date <= addDays(t, 6) {
			upcoming++
		}
		if b.Status == "confirmed" && in(b.Date, from, t) {
			done++
			if b.Service.Price != nil {
				revenue += *b.Service.Price
			}
		}
	}
	return obj{
		"today": t, "from": from, "days": days, "series": series, "totals": sum,
		"prev": obj{"views": pw, "visitors": pv}, "upcoming": upcoming, "revenue": revenue, "done": done,
		"bookings": obj{"requests": reqs, "prevRequests": prevReqs, "status": status, "services": services, "weekdays": weekdays, "hours": hours},
	}
}
