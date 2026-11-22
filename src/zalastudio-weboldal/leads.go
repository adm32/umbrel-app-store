// Zala Studio weboldal – requests (leads) from the planner and the no-JS form: validation,
// the outbox (DATA_DIR/outbox.json), handing them to the Irányítópult and the ntfy fallback.

package main

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	_ "time/tzdata"
	"unicode/utf8"
)

// ---------- requests (leads) ----------

var labels = map[string]map[string]string{
	"tipus":    {"etterem": "Étterem, kávézó", "szepseg": "Szépség, egészség", "szaki": "Szaki, építőipar", "szallas": "Szállás, vendégház", "bolt": "Üzlet, bolt", "egyeb": "Egyéb szolgáltatás"},
	"funkciok": {"arlista": "Árlista vagy étlap", "galeria": "Képgaléria", "ajanlat": "Ajánlatkérő űrlap", "foglalas": "Online időpontfoglalás", "rendeles": "Online rendelés", "nyelv": "Német és angol nyelv", "tobb": "Több aloldal", "kozosseg": "Facebook és Instagram", "kezeles": "Korlátlan módosítás"},
	"stilus":   {"meleg": "Meleg, barátságos", "lagy": "Lágy, elegáns", "termeszetes": "Természetes", "friss": "Friss, modern", "elegans": "Prémium, sötét"},
	"helyzet":  {"nincs": "Még nincs weboldala", "facebook": "Csak Facebook-oldala van", "regi": "Van, de megújítaná"},
	"mikorra":  {"surgos": "Minél előbb", "honap": "1–2 hónapon belül", "erdeklodik": "Csak tájékozódik"},
	"hivhato":  {"delelott": "Délelőtt", "delutan": "Délután", "barmikor": "Bármikor"},
	"csomag":   {"nevjegy": "Névjegy", "vallalkozas": "Vállalkozás", "rendeles": "Rendelés & Foglalás", "premium": "Prémium Partner"},
}

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
	Journey     *Journey `json:"journey,omitempty"`
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
	return `<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nem sikerült elküldeni</title><link rel="stylesheet" href="/assets/css/site.css?v=36"><main class="doc"><div class="wrap"><div class="doc__card center-card"><h1>Nem sikerült elküldeni</h1><p>` + esc.Replace(msg) + `</p><p>Írj nekünk: <a href="mailto:info@zalastudio.hu">info@zalastudio.hu</a></p><a class="btn btn--primary" href="/#tervezes">Vissza</a></div></div></main></html>`
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
		reply(429, "Túl sok kérés rövid idő alatt. Próbáld újra később, vagy írj nekünk: info@zalastudio.hu.")
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
	l.Journey = journeyFor(r)
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

func notifyFallback(l Lead) bool {
	raw := setting("NTFY_URL", "ntfy-url.txt")
	if raw == "" {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return false
	}
	body, _ := json.Marshal(map[string]any{"topic": strings.TrimLeft(u.Path, "/"), "title": "Új ajánlatkérés", "message": "Új ajánlatkérés érkezett a zalastudio.hu-ról.\n(Az Irányítópult nem érhető el, a kérés a weboldal appban vár.)", "tags": []string{"house"}, "priority": 4})
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
