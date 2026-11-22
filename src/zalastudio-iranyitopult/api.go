// Zala Studio Irányítópult – the dashboard API (/api/...): leads, statuses, notes, statistics, settings, export.

package main

import (
	"encoding/csv"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata"
	"unicode/utf8"
)

// ---------- API ----------

var leadPath = regexp.MustCompile(`^/api/leads/([0-9a-f-]{36})(/seen)?$`)

func api(w http.ResponseWriter, r *http.Request, p string) {
	if r.Method != "GET" && r.Header.Get("X-Core") != "1" {
		sendJSON(w, 403, map[string]any{"ok": false, "error": "Hiányzó fejléc."})
		return
	}
	if p == "/api/ado" || strings.HasPrefix(p, "/api/ado/") {
		taxAPI(w, r, p)
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
		if paymentsOff(w) {
			return
		}
		stripeTest(w)
	case p == "/api/payments.csv" && r.Method == "GET":
		if paymentsOff(w) {
			return
		}
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
			Days     map[string]json.RawMessage `json:"days"`
			Live     int                        `json:"live"`
			Today    string                     `json:"today"`
			Visitors json.RawMessage            `json:"visitors"`
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
		sendJSON(w, 200, map[string]any{"ok": true, "days": days, "live": j.Live, "today": j.Today, "visitors": j.Visitors})
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
		if err := ntfy(ntfyMsg{Title: "Zala Studio Irányítópult", Message: "Működik! Innen kapod majd az új érdeklődőket.", Tags: []string{"tada"}, Priority: 3}); err != nil {
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
	case p == "/api/torles" && r.Method == "POST":
		// Delete everything chosen (test data). A full copy is written to the data folder first.
		var d struct {
			Leads   bool   `json:"leads"`
			Ado     bool   `json:"ado"`
			Stripe  bool   `json:"stripe"`
			Confirm string `json:"confirm"`
		}
		if !readBody(r, 4<<10, &d) || strings.ToUpper(strings.TrimSpace(d.Confirm)) != "TÖRLÉS" {
			sendJSON(w, 422, map[string]any{"ok": false, "error": "Írd be: TÖRLÉS"})
			return
		}
		if !d.Leads && !d.Ado && !d.Stripe {
			sendJSON(w, 422, map[string]any{"ok": false, "error": "Válaszd ki, mit törölj."})
			return
		}
		mu.Lock()
		taxMu.Lock()
		name := "torles-elotti-mentes-" + time.Now().Format("2006-01-02-150405") + ".json"
		err := writeJSON(name, map[string]any{"version": version, "exported": nowISO(), "leads": leads, "settings": settings, "ado": taxData})
		if err == nil {
			if d.Leads {
				leads = []*Lead{}
				saveLeads()
			}
			if d.Stripe {
				settings.StripeKey, settings.StripeWebhook, settings.PortalURL = "", "", ""
				writeJSON("settings.json", settings)
			}
			if d.Ado {
				taxData.Invoices = []TaxInvoice{}
				taxData.Sent = map[string]string{}
				saveTax()
			}
		}
		taxMu.Unlock()
		mu.Unlock()
		if err != nil {
			sendJSON(w, 500, map[string]any{"ok": false, "error": "Nem sikerült a biztonsági mentés, ezért nem töröltem semmit."})
			return
		}
		log.Printf("adatok törölve (érdeklődők: %v, adó: %v, stripe: %v), mentés: %s", d.Leads, d.Ado, d.Stripe, name)
		sendJSON(w, 200, map[string]any{"ok": true, "backup": name})
	case p == "/api/backup.json" && r.Method == "GET":
		mu.Lock()
		s := settings
		s.NtfyToken, s.StripeKey, s.StripeWebhook = "", "", ""
		taxMu.Lock()
		b, _ := json.MarshalIndent(map[string]any{"version": version, "exported": nowISO(), "leads": leads, "settings": s, "ado": taxData}, "", " ")
		taxMu.Unlock()
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="zalastudio-mentes-`+time.Now().Format("2006-01-02")+`.json"`)
		w.Write(b)
	default:
		sendJSON(w, 404, map[string]any{"ok": false, "error": "Nincs ilyen végpont."})
	}
}
