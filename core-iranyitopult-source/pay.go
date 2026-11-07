// Stripe: payment links for clients (admcore.hu/fizetes/KOD), monthly or yearly subscriptions,
// and webhooks that keep the dashboard up to date.
//
// No Stripe library: a few form-encoded HTTPS calls keep the program small.
// The website app forwards two things here over the internal port:
//
//	GET/POST /pay/{code}  the customer opened / accepted the payment page on admcore.hu
//	POST     /stripe      a webhook from Stripe (verified here with the signing secret)
package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
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
)

var stripeAPI = strings.TrimRight(env("STRIPE_API", "https://api.stripe.com"), "/")

// One-off setup fees per plan: [full price, launch-discount price]. Must match the website (preview.js PLANS).
var setupPrices = map[string][2]int{"nevjegy": {19900, 9950}, "vallalkozas": {39900, 19950}, "rendeles": {79000, 39500}, "premium": {349000, 174500}}

type PayEvent struct {
	ID     string `json:"id"`
	At     string `json:"at"`
	Kind   string `json:"kind"` // elindult | fizetve | sikertelen | lemondva | visszavonva | megszunt
	Amount int    `json:"amount"`
	Number string `json:"number,omitempty"`
	URL    string `json:"url,omitempty"`
	Plan   string `json:"plan,omitempty"`
	Billed bool   `json:"billed"`
}

type Payment struct {
	Code         string     `json:"code"`
	Plan         string     `json:"plan"`
	Amount       int        `json:"amount"`   // Ft per interval
	Setup        int        `json:"setup"`    // Ft, once, with the first payment
	Interval     string     `json:"interval"` // month | year
	Created      string     `json:"created"`
	State        string     `json:"state"` // pending | active | past_due | canceling | canceled
	Live         bool       `json:"live"`
	Customer     string     `json:"customer,omitempty"`
	Subscription string     `json:"subscription,omitempty"`
	Session      string     `json:"session,omitempty"`
	SessionURL   string     `json:"sessionUrl,omitempty"`
	SessionAt    string     `json:"sessionAt,omitempty"`
	Consent      string     `json:"consent,omitempty"`
	NextCharge   string     `json:"nextCharge,omitempty"`
	CancelAt     string     `json:"cancelAt,omitempty"`
	Paid         int        `json:"paid"`
	Events       []PayEvent `json:"events"`
}

func (p *Payment) running() bool {
	return p != nil && (p.State == "active" || p.State == "past_due" || p.State == "canceling")
}
func (p *Payment) monthly() int {
	if p.Interval == "year" {
		return p.Amount / 12
	}
	return p.Amount
}

var (
	codeRe    = regexp.MustCompile(`^[A-HJ-NP-Z2-9]{10}$`)
	payPath   = regexp.MustCompile(`^/api/leads/([0-9a-f-]{36})/pay(/cancel|/resume|/billed)?$`)
	stripeKey = regexp.MustCompile(`^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$`)
	whsecRe   = regexp.MustCompile(`^whsec_[A-Za-z0-9+/=]{10,}$`)
	emailOK   = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`)
)

func newCode() string {
	const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, 10)
	rand.Read(b)
	for i := range b {
		b[i] = abc[int(b[i])%len(abc)]
	}
	return string(b)
}

// call with mu held
func findByCode(code string) *Lead {
	for _, l := range leads {
		if l.Pay != nil && l.Pay.Code == code {
			return l
		}
	}
	return nil
}

func vatNote(mode string) string {
	// Shown on the payment page, where the amounts are what the card is charged.
	if mode == "mentes" {
		return "Az összegek végösszegek, ÁFA-t nem tartalmaznak."
	}
	return "Az összegek a 27% ÁFA-t tartalmazzák."
}
func intervalWord(iv string) (adverb, unit string) {
	if iv == "year" {
		return "évente", "év"
	}
	return "havonta", "hó"
}

// ---------- Stripe API ----------

type stripeErr struct{ msg string }

func (e stripeErr) Error() string { return e.msg }

func stripeCall(method, path string, form url.Values, idem string) (map[string]any, error) {
	mu.Lock()
	key := settings.StripeKey
	mu.Unlock()
	if key == "" {
		return nil, stripeErr{"Nincs megadva Stripe kulcs (Beállítások → Fizetés)."}
	}
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req, _ := http.NewRequest(method, stripeAPI+path, body)
	req.SetBasicAuth(key, "")
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	if idem != "" {
		req.Header.Set("Idempotency-Key", idem)
	}
	resp, err := httpc.Do(req)
	if err != nil {
		return nil, stripeErr{"A Stripe most nem érhető el. Próbáld újra pár perc múlva."}
	}
	defer resp.Body.Close()
	var j map[string]any
	if json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&j) != nil {
		return nil, stripeErr{fmt.Sprintf("A Stripe érthetetlen választ adott (HTTP %d).", resp.StatusCode)}
	}
	if resp.StatusCode >= 300 {
		msg := str(j, "error.message")
		if resp.StatusCode == 401 {
			msg = "A Stripe kulcs nem jó. Másold be újra a Stripe-ból (Fejlesztők → API-kulcsok)."
		}
		if msg == "" {
			msg = fmt.Sprintf("HTTP %d", resp.StatusCode)
		}
		log.Printf("stripe %s %s: %d %s", method, path, resp.StatusCode, msg)
		return nil, stripeErr{"Stripe: " + msg}
	}
	return j, nil
}

// str/num read a dotted path from decoded JSON ("parent.subscription_details.subscription").
func dig(o map[string]any, p string) any {
	var cur any = o
	for _, k := range strings.Split(p, ".") {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		cur = m[k]
	}
	return cur
}
func str(o map[string]any, p string) string { s, _ := dig(o, p).(string); return s }
func num(o map[string]any, p string) float64 {
	f, _ := dig(o, p).(float64)
	return f
}
func first(o map[string]any, p string) map[string]any {
	a, _ := dig(o, p).([]any)
	if len(a) == 0 {
		return nil
	}
	m, _ := a[0].(map[string]any)
	return m
}
func unixISO(f float64) string {
	if f <= 0 {
		return ""
	}
	return time.Unix(int64(f), 0).UTC().Format("2006-01-02T15:04:05.000Z")
}

func createSession(l Lead, p Payment, site string) (id, link string, err error) {
	planName := "core weboldal"
	if n := L["csomag"][p.Plan]; n != "" {
		planName = "core weboldal – " + n + " csomag"
	}
	adv, _ := intervalWord(p.Interval)
	f := url.Values{}
	f.Set("mode", "subscription")
	f.Set("locale", "hu")
	f.Set("line_items[0][price_data][currency]", "huf")
	f.Set("line_items[0][price_data][unit_amount]", strconv.Itoa(p.Amount*100)) // HUF is sent with two decimals
	f.Set("line_items[0][price_data][recurring][interval]", p.Interval)
	f.Set("line_items[0][price_data][product_data][name]", planName)
	f.Set("line_items[0][quantity]", "1")
	if p.Setup > 0 {
		f.Set("line_items[1][price_data][currency]", "huf")
		f.Set("line_items[1][price_data][unit_amount]", strconv.Itoa(p.Setup*100))
		f.Set("line_items[1][price_data][product_data][name]", "Egyszeri beállítási díj")
		f.Set("line_items[1][quantity]", "1")
	}
	f.Set("success_url", site+"/fizetes/kesz?k="+p.Code)
	f.Set("cancel_url", site+"/fizetes/"+p.Code)
	f.Set("client_reference_id", l.ID)
	f.Set("metadata[lead]", l.ID)
	f.Set("metadata[code]", p.Code)
	f.Set("subscription_data[metadata][lead]", l.ID)
	f.Set("subscription_data[metadata][code]", p.Code)
	f.Set("subscription_data[description]", cut(firstNonEmpty(l.Business, l.Name)+" – "+planName, 450))
	f.Set("billing_address_collection", "required")
	f.Set("tax_id_collection[enabled]", "true")
	if p.Customer != "" {
		f.Set("customer", p.Customer)
		f.Set("customer_update[name]", "auto")
		f.Set("customer_update[address]", "auto")
	} else if emailOK.MatchString(l.Email) {
		f.Set("customer_email", l.Email)
	}
	f.Set("custom_text[submit][message]", fmt.Sprintf("A %s Ft-os díjat %s automatikusan levonjuk erről a kártyáról. A feltételek: %s/aszf.html", huNum(p.Amount), adv, site))
	idem := fmt.Sprintf("core-%s-%d", p.Code, time.Now().Unix()/120)
	j, err := stripeCall("POST", "/v1/checkout/sessions", f, idem)
	if err != nil {
		return "", "", err
	}
	id, link = str(j, "id"), str(j, "url")
	if id == "" || link == "" {
		return "", "", stripeErr{"A Stripe nem adott fizetési oldalt."}
	}
	return id, link, nil
}

// ---------- webhooks ----------

func verifyStripe(payload []byte, header, secret string, now time.Time) bool {
	if secret == "" || header == "" {
		return false
	}
	var ts string
	var sigs []string
	for _, part := range strings.Split(header, ",") {
		k, v, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		switch k {
		case "t":
			ts = v
		case "v1":
			sigs = append(sigs, v)
		}
	}
	t, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return false
	}
	if d := now.Unix() - t; d > 300 || d < -300 {
		return false
	}
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(ts + "."))
	m.Write(payload)
	want := hex.EncodeToString(m.Sum(nil))
	for _, s := range sigs {
		if hmac.Equal([]byte(s), []byte(want)) {
			return true
		}
	}
	return false
}

var (
	seenMu     sync.Mutex
	seenEvents = map[string]bool{}
	seenOrder  []string
	hookMu     sync.Mutex
	hookStatus struct {
		At    string `json:"at"`
		Type  string `json:"type"`
		Error string `json:"error"`
		Live  bool   `json:"live"`
	}
)

func markSeen(id string) bool {
	seenMu.Lock()
	defer seenMu.Unlock()
	if seenEvents[id] {
		return false
	}
	seenEvents[id] = true
	seenOrder = append(seenOrder, id)
	if len(seenOrder) > 600 {
		delete(seenEvents, seenOrder[0])
		seenOrder = seenOrder[1:]
	}
	return true
}

// call with mu held
func leadFor(o map[string]any) *Lead {
	for _, p := range []string{"metadata.lead", "client_reference_id", "parent.subscription_details.metadata.lead", "subscription_details.metadata.lead"} {
		if id := strings.ToLower(str(o, p)); idRe.MatchString(id) {
			if l := findLead(id); l != nil && l.Pay != nil {
				return l
			}
		}
	}
	subs := []string{str(o, "subscription"), str(o, "parent.subscription_details.subscription")}
	if str(o, "object") == "subscription" {
		subs = append(subs, str(o, "id"))
	}
	for _, l := range leads {
		if l.Pay == nil {
			continue
		}
		for _, s := range subs {
			if s != "" && l.Pay.Subscription == s {
				return l
			}
		}
	}
	if c := str(o, "customer"); c != "" {
		for _, l := range leads {
			if l.Pay != nil && l.Pay.Customer == c {
				return l
			}
		}
	}
	return nil
}

func addEvent(p *Payment, e PayEvent) bool {
	for _, x := range p.Events {
		if x.ID == e.ID {
			return false
		}
	}
	p.Events = append(p.Events, e)
	if len(p.Events) > 120 {
		p.Events = p.Events[len(p.Events)-120:]
	}
	return true
}

func setStatus(l *Lead, s string) {
	if l.Status != s {
		l.Status = s
		l.History = append(l.History, Hist{At: nowISO(), Status: s})
	}
}

// applySub copies the subscription's status into the payment. Returns the previous state.
func applySub(p *Payment, o map[string]any) string {
	prev := p.State
	if id := str(o, "id"); id != "" {
		p.Subscription = id
	}
	if c := str(o, "customer"); c != "" {
		p.Customer = c
	}
	end := num(o, "current_period_end")
	if end == 0 {
		if it := first(o, "items.data"); it != nil {
			end = num(it, "current_period_end")
		}
	}
	canceling := dig(o, "cancel_at_period_end") == true || num(o, "cancel_at") > 0
	switch str(o, "status") {
	case "active", "trialing":
		p.State = "active"
		if canceling {
			p.State = "canceling"
		}
	case "past_due", "unpaid":
		p.State = "past_due"
	case "canceled", "incomplete_expired":
		p.State = "canceled"
	case "incomplete", "paused":
		if prev == "" {
			p.State = "pending"
		}
	}
	p.CancelAt = ""
	if canceling {
		p.CancelAt = unixISO(num(o, "cancel_at"))
		if p.CancelAt == "" {
			p.CancelAt = unixISO(end)
		}
	}
	if p.State == "canceled" {
		p.NextCharge = ""
	} else if end > 0 {
		p.NextCharge = unixISO(end)
	}
	return prev
}

type notice struct {
	l Lead
	m ntfyMsg
}

func handleStripeEvent(raw []byte) error {
	var ev struct {
		ID       string `json:"id"`
		Type     string `json:"type"`
		Livemode bool   `json:"livemode"`
		Data     struct {
			Object map[string]any `json:"object"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &ev) != nil || ev.ID == "" || ev.Data.Object == nil {
		return errors.New("bad event")
	}
	hookMu.Lock()
	hookStatus.At, hookStatus.Type, hookStatus.Error, hookStatus.Live = nowISO(), ev.Type, "", ev.Livemode
	hookMu.Unlock()
	if !markSeen(ev.ID) {
		return nil
	}
	o := ev.Data.Object
	var notes []notice
	mu.Lock()
	l := leadFor(o)
	if l == nil {
		mu.Unlock()
		if strings.HasPrefix(ev.Type, "checkout.") || strings.HasPrefix(ev.Type, "invoice.") || strings.HasPrefix(ev.Type, "customer.subscription") {
			log.Printf("stripe: %s %s – nincs hozzá érdeklődő (más rendszerből jött?)", ev.Type, ev.ID)
		}
		return nil
	}
	p := l.Pay
	p.Live = ev.Livemode
	who := firstNonEmpty(l.Business, l.Name)
	adv, unit := intervalWord(p.Interval)
	switch ev.Type {
	case "checkout.session.completed":
		if c := str(o, "customer"); c != "" {
			p.Customer = c
		}
		if s := str(o, "subscription"); s != "" {
			p.Subscription = s
		}
		if p.State == "pending" || p.State == "" {
			p.State = "active"
		}
		if l.Email == "" {
			l.Email = clean(str(o, "customer_details.email"), 120)
		}
		if l.Name == "" {
			l.Name = clean(str(o, "customer_details.name"), 80)
		}
		if addEvent(p, PayEvent{ID: str(o, "id"), At: nowISO(), Kind: "elindult"}) {
			setStatus(l, "megrendelte")
			notes = append(notes, notice{*l, ntfyMsg{Title: "Új előfizető: " + who, Message: fmt.Sprintf("%s – %s Ft / %s\nA fizetés sikerült, %s automatikusan terheljük.", L["csomag"][p.Plan], huNum(p.Amount), unit, adv), Tags: []string{"tada"}, Priority: 4}})
		}
	case "invoice.paid", "invoice.payment_succeeded":
		amount := int(num(o, "amount_paid")) / 100
		if amount <= 0 {
			break
		}
		at := unixISO(num(o, "status_transitions.paid_at"))
		if at == "" {
			at = nowISO()
		}
		if addEvent(p, PayEvent{ID: str(o, "id"), At: at, Kind: "fizetve", Amount: amount, Number: str(o, "number"), URL: str(o, "hosted_invoice_url"), Plan: p.Plan}) {
			p.Paid += amount
			if p.State == "pending" || p.State == "past_due" || p.State == "" {
				p.State = "active"
			}
			if s := str(o, "parent.subscription_details.subscription"); s != "" {
				p.Subscription = s
			} else if s := str(o, "subscription"); s != "" {
				p.Subscription = s
			}
			if c := str(o, "customer"); c != "" {
				p.Customer = c
			}
			if ln := first(o, "lines.data"); ln != nil {
				if e := num(ln, "period.end"); e > 0 && p.State != "canceled" {
					p.NextCharge = unixISO(e)
				}
			}
			notes = append(notes, notice{*l, ntfyMsg{Title: "Befizetés: " + huNum(amount) + " Ft", Message: who + "\nNe felejtsd el kiállíttatni a számlát.", Tags: []string{"moneybag"}, Priority: 3}})
		}
	case "invoice.payment_failed":
		amount := int(num(o, "amount_due")) / 100
		if addEvent(p, PayEvent{ID: ev.ID, At: nowISO(), Kind: "sikertelen", Amount: amount}) {
			if p.State != "pending" {
				p.State = "past_due"
			}
			msg := who + " – " + huNum(amount) + " Ft nem sikerült levonni."
			if next := num(o, "next_payment_attempt"); next > 0 {
				msg += "\nA Stripe " + time.Unix(int64(next), 0).In(budapestTZ()).Format("01.02.") + "-án újrapróbálja."
			}
			msg += "\nÉrdemes felhívni, hogy ellenőrizze a kártyáját."
			notes = append(notes, notice{*l, ntfyMsg{Title: "Sikertelen fizetés: " + who, Message: msg, Tags: []string{"warning"}, Priority: 5}})
		}
	case "customer.subscription.created", "customer.subscription.updated", "customer.subscription.resumed":
		prev := applySub(p, o)
		if p.State == "canceling" && prev != "canceling" {
			addEvent(p, PayEvent{ID: ev.ID, At: nowISO(), Kind: "lemondva"})
			notes = append(notes, notice{*l, ntfyMsg{Title: "Lemondta: " + who, Message: "Az előfizetés a fizetett időszak végén megszűnik.", Tags: []string{"wave"}, Priority: 4}})
		}
		if p.State == "active" && prev == "canceling" {
			addEvent(p, PayEvent{ID: ev.ID, At: nowISO(), Kind: "visszavonva"})
		}
	case "customer.subscription.deleted":
		applySub(p, o)
		p.State = "canceled"
		p.NextCharge = ""
		if addEvent(p, PayEvent{ID: ev.ID, At: nowISO(), Kind: "megszunt"}) {
			notes = append(notes, notice{*l, ntfyMsg{Title: "Megszűnt az előfizetés: " + who, Message: "Már nem terheljük a kártyáját. Ha az oldalt le kell kapcsolni, most tedd meg.", Tags: []string{"no_entry"}, Priority: 4}})
		}
	}
	l.Updated = nowISO()
	saveLeads()
	mu.Unlock()
	for _, n := range notes {
		go sendPayNotice(n)
	}
	return nil
}

func sendPayNotice(n notice) {
	mu.Lock()
	s := settings
	mu.Unlock()
	if !s.NotifyPay || s.NtfyURL == "" {
		return
	}
	m := n.m
	if n.l.Phone != "" && strings.HasPrefix(m.Title, "Sikertelen") {
		m.Actions = append(m.Actions, map[string]any{"action": "view", "label": "Hívás", "url": "tel:" + notPhone.ReplaceAllString(n.l.Phone, ""), "clear": false})
	}
	if s.DashURL != "" {
		link := strings.TrimRight(s.DashURL, "/") + "/#lead=" + n.l.ID
		m.Click = link
		m.Actions = append(m.Actions, map[string]any{"action": "view", "label": "Megnyitás", "url": link, "clear": true})
	}
	if err := ntfy(m); err != nil {
		log.Print("ntfy: ", err)
	}
}

var tzOnce sync.Once
var tzBud *time.Location

func budapestTZ() *time.Location {
	tzOnce.Do(func() {
		var err error
		if tzBud, err = time.LoadLocation("Europe/Budapest"); err != nil {
			tzBud = time.UTC
		}
	})
	return tzBud
}

// ---------- internal endpoints (called by the website app) ----------

var payLimit = struct {
	sync.Mutex
	m map[string][]time.Time
}{m: map[string][]time.Time{}}

func internalPay(w http.ResponseWriter, r *http.Request, code string) {
	if !paymentsEnabled || !codeRe.MatchString(code) { // payment pages answer "not found" while payments are off
		sendJSON(w, 404, map[string]any{"ok": false, "state": "notfound"})
		return
	}
	mu.Lock()
	l := findByCode(code)
	if l == nil {
		mu.Unlock()
		sendJSON(w, 404, map[string]any{"ok": false, "state": "notfound"})
		return
	}
	p, lc, s := *l.Pay, *l, settings
	mu.Unlock()
	info := map[string]any{"ok": true, "state": p.State, "business": firstNonEmpty(lc.Business, lc.Name), "plan": p.Plan, "planName": L["csomag"][p.Plan],
		"amount": p.Amount, "setup": p.Setup, "interval": p.Interval, "vat": vatNote(s.VatMode), "test": !strings.Contains(s.StripeKey, "_live_")}
	if r.Method == "GET" {
		sendJSON(w, 200, info)
		return
	}
	if r.Method != "POST" {
		w.WriteHeader(405)
		return
	}
	var d struct {
		Consent bool   `json:"consent"`
		Who     string `json:"who"`
	}
	if !readBody(r, 4000, &d) || !d.Consent {
		sendJSON(w, 422, map[string]any{"ok": false, "error": "consent"})
		return
	}
	if p.State != "pending" {
		info["ok"] = false
		sendJSON(w, 409, info)
		return
	}
	// A recent checkout page can be reused (it stays valid for 24 hours); avoids piling up sessions.
	if t, err := time.Parse(time.RFC3339Nano, p.SessionAt); err == nil && time.Since(t) < 30*time.Minute && p.SessionURL != "" {
		sendJSON(w, 200, map[string]any{"ok": true, "url": p.SessionURL})
		return
	}
	site := strings.TrimRight(firstNonEmpty(s.SiteURL, "https://admcore.hu"), "/")
	id, link, err := createSession(lc, p, site)
	if err != nil {
		sendJSON(w, 502, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	mu.Lock()
	if l := findByCode(code); l != nil {
		l.Pay.Session, l.Pay.SessionURL, l.Pay.SessionAt = id, link, nowISO()
		l.Pay.Consent = nowISO() + " · " + cut(clean(d.Who, 40), 40)
		saveLeads()
	}
	mu.Unlock()
	sendJSON(w, 200, map[string]any{"ok": true, "url": link})
}

func internalStripe(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20+1))
	if err != nil || len(raw) > 1<<20 {
		w.WriteHeader(413)
		return
	}
	mu.Lock()
	secret := settings.StripeWebhook
	mu.Unlock()
	if !verifyStripe(raw, r.Header.Get("Stripe-Signature"), secret, time.Now()) {
		hookMu.Lock()
		hookStatus.At, hookStatus.Error = nowISO(), "Érvénytelen aláírás – ellenőrizd a webhook kulcsot (whsec_…)."
		if secret == "" {
			hookStatus.Error = "Megjött egy webhook, de nincs megadva a webhook kulcs."
		}
		hookMu.Unlock()
		log.Print("stripe webhook: invalid signature")
		w.WriteHeader(400)
		return
	}
	if err := handleStripeEvent(raw); err != nil {
		w.WriteHeader(400)
		return
	}
	io.WriteString(w, `{"received":true}`)
}

// ---------- dashboard API ----------

// paymentsEnabled switches online payment (Stripe payment links, the admcore.hu/fizetes pages)
// on or off. Off for now: the dashboard hides everything about payments, and no new payment
// can start. Set to true (and PAYMENTS in web/app.js) to bring it back; saved data is kept.
const paymentsEnabled = false

func paymentsOff(w http.ResponseWriter) bool {
	if paymentsEnabled {
		return false
	}
	sendJSON(w, 403, map[string]any{"ok": false, "error": "Az online fizetés jelenleg ki van kapcsolva."})
	return true
}

func payAPI(w http.ResponseWriter, r *http.Request, id, sub string) {
	if paymentsOff(w) {
		return
	}
	mu.Lock()
	l := findLead(id)
	if l == nil {
		mu.Unlock()
		sendJSON(w, 404, map[string]any{"ok": false, "error": "Nincs ilyen érdeklődő."})
		return
	}
	switch {
	case sub == "" && r.Method == "POST":
		mu.Unlock()
		var d struct {
			Plan     string  `json:"plan"`
			Amount   float64 `json:"amount"`
			Setup    float64 `json:"setup"`
			Interval string  `json:"interval"`
		}
		if !readBody(r, 4000, &d) {
			sendJSON(w, 400, map[string]any{"ok": false})
			return
		}
		amount, setup := int(d.Amount+0.5), int(d.Setup+0.5)
		if d.Interval != "year" {
			d.Interval = "month"
		}
		switch {
		case amount < 175 || amount > 3000000:
			sendJSON(w, 422, map[string]any{"ok": false, "error": "A díj 175 és 3 000 000 Ft között legyen."})
			return
		case setup != 0 && (setup < 175 || setup > 10000000):
			sendJSON(w, 422, map[string]any{"ok": false, "error": "Az egyszeri díj 0 vagy legalább 175 Ft legyen."})
			return
		}
		mu.Lock()
		defer mu.Unlock()
		if settings.StripeKey == "" {
			sendJSON(w, 409, map[string]any{"ok": false, "error": "Előbb add meg a Stripe kulcsot a Beállításokban."})
			return
		}
		if l = findLead(id); l == nil {
			sendJSON(w, 404, map[string]any{"ok": false})
			return
		}
		if l.Pay.running() {
			sendJSON(w, 409, map[string]any{"ok": false, "error": "Ennek az ügyfélnek már fut egy előfizetése."})
			return
		}
		np := &Payment{Code: newCode(), Plan: pick("csomag", d.Plan), Amount: amount, Setup: setup, Interval: d.Interval, Created: nowISO(), State: "pending", Live: strings.Contains(settings.StripeKey, "_live_"), Events: []PayEvent{}}
		if old := l.Pay; old != nil {
			np.Customer, np.Paid, np.Events = old.Customer, old.Paid, old.Events
		}
		if np.Plan != "" {
			l.Plan = np.Plan
		}
		l.Pay, l.Updated = np, nowISO()
		saveLeads()
		sendJSON(w, 200, map[string]any{"ok": true, "lead": l})
	case sub == "" && r.Method == "DELETE":
		defer mu.Unlock()
		if l.Pay == nil {
			sendJSON(w, 200, map[string]any{"ok": true, "lead": l})
			return
		}
		if l.Pay.running() {
			sendJSON(w, 409, map[string]any{"ok": false, "error": "Futó előfizetést előbb le kell mondani."})
			return
		}
		if l.Pay.State == "pending" && l.Pay.Paid == 0 && len(l.Pay.Events) == 0 {
			l.Pay = nil
		} else {
			l.Pay.State, l.Pay.Code = "canceled", "" // keep the payment history
		}
		l.Updated = nowISO()
		saveLeads()
		sendJSON(w, 200, map[string]any{"ok": true, "lead": l})
	case (sub == "/cancel" || sub == "/resume") && r.Method == "POST":
		if l.Pay == nil || l.Pay.Subscription == "" || !l.Pay.running() {
			mu.Unlock()
			sendJSON(w, 409, map[string]any{"ok": false, "error": "Nincs futó előfizetés."})
			return
		}
		subID := l.Pay.Subscription
		mu.Unlock()
		f := url.Values{}
		f.Set("cancel_at_period_end", strconv.FormatBool(sub == "/cancel"))
		j, err := stripeCall("POST", "/v1/subscriptions/"+url.PathEscape(subID), f, "")
		if err != nil {
			sendJSON(w, 502, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		mu.Lock()
		defer mu.Unlock()
		if l = findLead(id); l == nil || l.Pay == nil {
			sendJSON(w, 404, map[string]any{"ok": false})
			return
		}
		prev := applySub(l.Pay, j)
		kind := "lemondva"
		if sub == "/resume" {
			kind = "visszavonva"
		}
		if prev != l.Pay.State {
			addEvent(l.Pay, PayEvent{ID: "kezi-" + kind + "-" + strconv.FormatInt(time.Now().Unix(), 10), At: nowISO(), Kind: kind})
		}
		l.Updated = nowISO()
		saveLeads()
		sendJSON(w, 200, map[string]any{"ok": true, "lead": l})
	case sub == "/billed" && r.Method == "POST":
		defer mu.Unlock()
		var d struct {
			ID     string `json:"id"`
			Billed bool   `json:"billed"`
		}
		if !readBody(r, 2000, &d) || l.Pay == nil {
			sendJSON(w, 400, map[string]any{"ok": false})
			return
		}
		for i := range l.Pay.Events {
			if l.Pay.Events[i].ID == d.ID {
				l.Pay.Events[i].Billed = d.Billed
			}
		}
		saveLeads()
		sendJSON(w, 200, map[string]any{"ok": true, "lead": l})
	default:
		mu.Unlock()
		sendJSON(w, 405, map[string]any{"ok": false})
	}
}

func stripeTest(w http.ResponseWriter) {
	j, err := stripeCall("GET", "/v1/account", nil, "")
	if err != nil {
		sendJSON(w, 502, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	name := firstNonEmpty(str(j, "settings.dashboard.display_name"), str(j, "business_profile.name"), str(j, "email"), str(j, "id"))
	mu.Lock()
	live := strings.Contains(settings.StripeKey, "_live_")
	mu.Unlock()
	sendJSON(w, 200, map[string]any{"ok": true, "name": name, "live": live, "charges": dig(j, "charges_enabled") == true})
}

func paymentsCSVRows() [][]string {
	var rows [][]string
	for _, l := range leads {
		if l.Pay == nil {
			continue
		}
		for _, e := range l.Pay.Events {
			if e.Kind != "fizetve" {
				continue
			}
			billed := "nem"
			if e.Billed {
				billed = "igen"
			}
			plan := e.Plan
			if plan == "" {
				plan = l.Pay.Plan
			}
			rows = append(rows, []string{e.At, l.Business, l.Name, l.Email, l.Phone, strconv.Itoa(e.Amount), L["csomag"][plan], e.Number, e.URL, billed})
		}
	}
	return rows
}
