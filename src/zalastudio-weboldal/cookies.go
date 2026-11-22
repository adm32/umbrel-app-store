package main

// Cookies – only with the visitor's consent.
//
//	zs_c   the visitor's choice ("1" yes, "0" no). Strictly necessary: it only remembers the
//	       answer, so the banner doesn't come back on every page. 12 months.
//	zs_id  random visitor ID, set only after "Rendben". HttpOnly. 13 months.
//
// With an ID the site keeps a short, anonymous record per visitor in DATA_DIR/visitors.json:
// first visit, number of visits, the pages and planner steps. If that visitor later asks for a
// demo, the record goes along with the request, so the Irányítópult shows how they found the
// site. "Nem kérem" (or withdrawing later) deletes the record and the ID cookie.

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	consentCookie = "zs_c"
	idCookie      = "zs_id"
	consentMaxAge = 365 * 24 * 3600
	idMaxAge      = 395 * 24 * 3600
	visitGap      = 30 * time.Minute
	trailMax      = 60
	journeyMax    = 25
	visitorsMax   = 20000
)

type Step struct {
	At string `json:"at"`
	T  string `json:"t"`
	V  string `json:"v,omitempty"`
}
type Visitor struct {
	First  string `json:"first"`
	Last   string `json:"last"`
	Visits int    `json:"visits"`
	Views  int    `json:"views"`
	Source string `json:"source"`
	Entry  string `json:"entry"`
	Device string `json:"device"`
	Trail  []Step `json:"trail"`
}

// Journey is what a request carries to the Irányítópult.
type Journey struct {
	First  string `json:"first"`
	Visits int    `json:"visits"`
	Views  int    `json:"views"`
	Source string `json:"source"`
	Entry  string `json:"entry"`
	Device string `json:"device"`
	Trail  []Step `json:"trail"`
}

var (
	visitors      = map[string]*Visitor{} // guarded by stMu
	visitorsDirty bool
	idRe          = regexp.MustCompile(`^[0-9a-f]{32}$`)
	consentLimit  = newLimiter(30, 10*time.Minute)
)

func nowUTC() string { return time.Now().UTC().Format(time.RFC3339) }

func secureReq(r *http.Request) bool {
	return r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" || strings.Contains(r.Header.Get("Cf-Visitor"), "https")
}

func setCookie(w http.ResponseWriter, r *http.Request, name, value string, maxAge int, httpOnly bool) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", MaxAge: maxAge, HttpOnly: httpOnly, Secure: secureReq(r), SameSite: http.SameSiteLaxMode})
}

// visitorID returns the visitor's ID if they agreed to cookies, else "".
func visitorID(r *http.Request) string {
	c, err := r.Cookie(consentCookie)
	if err != nil || c.Value != "1" {
		return ""
	}
	id, err := r.Cookie(idCookie)
	if err != nil || !idRe.MatchString(id.Value) {
		return ""
	}
	return id.Value
}

func deviceOf(ua string) string {
	if tabletRe.MatchString(ua) || (androidRe.MatchString(ua) && !mobiRe.MatchString(ua)) {
		return "tablet"
	} else if mobileRe.MatchString(ua) {
		return "mobil"
	}
	return "asztali"
}

// call with stMu held. Returns the record (created if missing) and whether it existed before today.
func touchVisitor(id, ua, ref, page string) (*Visitor, bool) {
	now := time.Now()
	v := visitors[id]
	returning := false
	if v == nil {
		v = &Visitor{First: now.UTC().Format(time.RFC3339), Visits: 0, Source: refName(ref), Entry: cut(page, 60), Device: deviceOf(ua)}
		visitors[id] = v
	} else if t, err := time.Parse(time.RFC3339, v.First); err == nil && dayKey(t) != dayKey(now) {
		returning = true
	}
	last, _ := time.Parse(time.RFC3339, v.Last)
	if v.Visits == 0 || now.Sub(last) > visitGap {
		v.Visits++
		addStep(v, "visit", refName(ref))
	}
	v.Last = now.UTC().Format(time.RFC3339)
	visitorsDirty = true
	return v, returning
}

// call with stMu held
func addStep(v *Visitor, t, val string) {
	if n := len(v.Trail); n > 0 && v.Trail[n-1].T == t && v.Trail[n-1].V == val && t != "visit" {
		return // the same page twice in a row
	}
	v.Trail = append(v.Trail, Step{At: nowUTC(), T: t, V: cut(val, 60)})
	if len(v.Trail) > trailMax {
		v.Trail = append([]Step(nil), v.Trail[len(v.Trail)-trailMax:]...)
	}
	visitorsDirty = true
}

// POST /api/consent {"ok": true|false, "p": "/", "r": "www.google.com"}
func handleConsent(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !consentLimit.allow(clientIP(r)) {
		w.WriteHeader(429)
		return
	}
	var d struct {
		OK bool   `json:"ok"`
		P  string `json:"p"`
		R  string `json:"r"`
	}
	b, _ := io.ReadAll(io.LimitReader(r.Body, 1024))
	if json.Unmarshal(b, &d) != nil {
		w.WriteHeader(400)
		return
	}
	ua := r.UserAgent()
	isBot := ua == "" || bot.MatchString(ua)
	old := ""
	if c, err := r.Cookie(idCookie); err == nil && idRe.MatchString(c.Value) {
		old = c.Value
	}
	stMu.Lock()
	day := today()
	if d.OK {
		setCookie(w, r, consentCookie, "1", consentMaxAge, false)
		id := old
		if id == "" {
			x := make([]byte, 16)
			rand.Read(x)
			id = hex.EncodeToString(x)
		}
		setCookie(w, r, idCookie, id, idMaxAge, true)
		if !isBot {
			day.Ev["consent_yes"]++
			if old == "" {
				day.Ck++ // counted here: today's page view came before the answer
			}
			p := d.P
			if p == "" {
				p = "/"
			}
			v, _ := touchVisitor(id, ua, d.R, p)
			v.Views = max(v.Views, 1)
			addStep(v, "pv", p)
		}
	} else {
		setCookie(w, r, consentCookie, "0", consentMaxAge, false)
		setCookie(w, r, idCookie, "", -1, true)
		if old != "" {
			delete(visitors, old)
			visitorsDirty = true
		}
		if !isBot {
			day.Ev["consent_no"]++
		}
	}
	statsDirty = true
	stMu.Unlock()
	w.WriteHeader(204)
}

// call with stMu held: records an event for a consenting visitor; tells whether they are returning.
func trackVisitor(r *http.Request, t, page, ref, step, src string) (known, returning bool) {
	id := visitorID(r)
	if id == "" {
		return false, false
	}
	v, ret := touchVisitor(id, r.UserAgent(), ref, page)
	switch t {
	case "pv":
		v.Views++
		addStep(v, "pv", page)
	case "cfg_step":
		if stepNames[step] {
			addStep(v, "cfg_step", step)
		}
	case "cfg_open":
		addStep(v, "cfg_open", src)
	default:
		addStep(v, t, "")
	}
	return true, ret
}

// journeyFor returns what to attach to a request (nil without consent).
func journeyFor(r *http.Request) *Journey {
	id := visitorID(r)
	if id == "" {
		return nil
	}
	stMu.Lock()
	defer stMu.Unlock()
	v := visitors[id]
	if v == nil {
		return nil
	}
	addStep(v, "lead", "")
	tr := v.Trail
	if len(tr) > journeyMax {
		tr = tr[len(tr)-journeyMax:]
	}
	return &Journey{First: v.First, Visits: v.Visits, Views: v.Views, Source: v.Source, Entry: v.Entry, Device: v.Device, Trail: append([]Step(nil), tr...)}
}

// call with stMu held
func saveVisitors() {
	if !visitorsDirty {
		return
	}
	cutoff := time.Now().Add(-time.Duration(idMaxAge) * time.Second)
	for id, v := range visitors {
		if t, err := time.Parse(time.RFC3339, v.Last); err != nil || t.Before(cutoff) {
			delete(visitors, id)
		}
	}
	if len(visitors) > visitorsMax { // keep the most recent ones
		ids := make([]string, 0, len(visitors))
		for id := range visitors {
			ids = append(ids, id)
		}
		sort.Slice(ids, func(i, j int) bool { return visitors[ids[i]].Last > visitors[ids[j]].Last })
		for _, id := range ids[visitorsMax:] {
			delete(visitors, id)
		}
	}
	if err := writeJSON("visitors.json", visitors); err != nil {
		log.Print("visitors: could not save: ", err)
		return
	}
	visitorsDirty = false
}

// call with stMu held: counts for the Irányítópult (no IDs leave the website app).
func visitorSummary() map[string]any {
	now := time.Now()
	n30, ret30 := 0, 0
	for _, v := range visitors {
		t, err := time.Parse(time.RFC3339, v.Last)
		if err != nil || now.Sub(t) > 30*24*time.Hour {
			continue
		}
		n30++
		if v.Visits > 1 {
			ret30++
		}
	}
	return map[string]any{"total": len(visitors), "active30": n30, "returning30": ret30}
}
