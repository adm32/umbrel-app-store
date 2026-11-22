// Payment pages on zalastudio.hu (they answer "not found" while the Irányítópult has payments disabled). The website holds no Stripe key: it asks the Irányítópult
// (internal port) for the payment details, and the Irányítópult creates the Stripe Checkout page.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"html"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	dashBase      = strings.TrimSuffix(dashIngest, "/ingest")
	payCodeRe     = regexp.MustCompile(`^[A-HJ-NP-Z2-9]{10}$`)
	payLimit      = newLimiter(40, 10*time.Minute)
	withdrawLimit = newLimiter(10, 10*time.Minute)
	hookLimit     = newLimiter(600, 10*time.Minute)
	// Stripe's hosted checkout. Browsers apply form-action to the redirect after the form, so it must be listed.
	checkoutOrigin = env("CHECKOUT_ORIGIN", "https://checkout.stripe.com")
)

func ft(n int) string {
	s := strconv.Itoa(n)
	var out []byte
	for i := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, " "...)
		}
		out = append(out, s[i])
	}
	return string(out)
}

const arrowSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`
const checkSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`
const lockSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`

func payShell(w http.ResponseWriter, code int, title, inner string) {
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Robots-Tag", "noindex")
	// The form posts here and is then redirected to Stripe's checkout page.
	h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' "+checkoutOrigin+"; object-src 'none'")
	w.WriteHeader(code)
	io.WriteString(w, `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>`+html.EscapeString(title)+` – Zala Studio</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#FAF8F5" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#120F0D" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/assets/css/site.css?v=42">
<script src="/assets/js/pay.js?v=42" defer></script>
</head>
<body class="paypage">
<header class="head is-scrolled">
  <div class="wrap head__in">
    <a class="brand" href="/" aria-label="Zala Studio – főoldal"><img src="/assets/logo/zala-mark.svg" alt="" width="32" height="32"><b>zala<span class="serif">studio</span></b></a>
    <a class="back" href="mailto:info@zalastudio.hu">info@zalastudio.hu</a>
  </div>
</header>
<main class="doc"><div class="wrap">`+inner+`</div></main>
</body>
</html>`)
}

func payMessage(w http.ResponseWriter, code int, title, text string, ok bool, extra string) {
	icon := ""
	if ok {
		icon = `<span class="ok">` + checkSVG + `</span>`
	}
	payShell(w, code, title, `<div class="doc__card center-card">`+icon+`<h1>`+html.EscapeString(title)+`</h1><p class="pay__lead">`+text+`</p>`+extra+`<a class="btn btn--primary" href="/">Vissza a főoldalra</a></div>`)
}

type payInfo struct {
	OK       bool   `json:"ok"`
	State    string `json:"state"`
	Business string `json:"business"`
	PlanName string `json:"planName"`
	Amount   int    `json:"amount"`
	Setup    int    `json:"setup"`
	Interval string `json:"interval"`
	Vat      string `json:"vat"`
	Test     bool   `json:"test"`
	URL      string `json:"url"`
	Error    string `json:"error"`
	Code     string `json:"-"`
}

func dashPay(method, code string, body any) (int, payInfo, error) {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, dashBase+"/pay/"+code, rd)
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpc.Do(req)
	var info payInfo
	if err != nil {
		return 0, info, err
	}
	defer resp.Body.Close()
	json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&info)
	return resp.StatusCode, info, nil
}

func stateMessage(w http.ResponseWriter, info payInfo) {
	switch info.State {
	case "active", "past_due", "canceling":
		payMessage(w, 200, "Ez az előfizetés már él", "Köszönjük, a fizetés korábban megtörtént. A kártyádat és a számláidat itt kezelheted:", true,
			`<a class="btn btn--ghost" href="/elofizetes">Előfizetés kezelése</a>`)
	default:
		payMessage(w, 410, "Ez a fizetési link lejárt", "Kérj új linket: írj az <a href=\"mailto:info@zalastudio.hu\">info@zalastudio.hu</a> címre.", false, "")
	}
}

func payForm(w http.ResponseWriter, code int, info payInfo, errMsg string) {
	adv, unit := "havonta", "hónap"
	if info.Interval == "year" {
		adv, unit = "évente", "év"
	}
	today := info.Amount + info.Setup
	var b strings.Builder
	b.WriteString(`<article class="doc__card pay">`)
	if info.Test {
		b.WriteString(`<p class="pay__test">Teszt mód: ezen az oldalon nem történik valódi terhelés.</p>`)
	}
	b.WriteString(`<p class="eyebrow">Előfizetés indítása</p><h1>` + html.EscapeString(info.Business) + `</h1>`)
	plan := "Zala Studio weboldal"
	if info.PlanName != "" {
		plan += " · " + info.PlanName + " csomag"
	}
	b.WriteString(`<p class="pay__plan">` + html.EscapeString(plan) + `</p>`)
	b.WriteString(`<div class="pay__price"><b>` + ft(info.Amount) + `</b><span>Ft / ` + unit + `</span></div>`)
	b.WriteString(`<dl class="kv pay__kv">`)
	if info.Setup > 0 {
		b.WriteString(`<div><dt>Egyszeri beállítási díj</dt><dd>` + ft(info.Setup) + ` Ft</dd></div>`)
	}
	b.WriteString(`<div><dt>Most fizetendő</dt><dd>` + ft(today) + ` Ft</dd></div>`)
	b.WriteString(`<div><dt>Utána</dt><dd>` + adv + ` ` + ft(info.Amount) + ` Ft, automatikusan</dd></div></dl>`)
	// The business is alanyi adómentes (ÁSZF 5.), so the wording is fixed here and matches the website.
	b.WriteString(`<p class="pay__vat">Az árak alanyi adómentes végösszegek, ÁFA-t nem tartalmaznak.</p>`)
	b.WriteString(`<ul class="pay__list">
<li>` + checkSVG + `<span>Bankkártya, Apple Pay vagy Google Pay</span></li>
<li>` + checkSVG + `<span>Nem kell figyelned a határidőket, a díjat ` + adv + ` automatikusan levonjuk</span></li>
<li>` + checkSVG + `<span>Minden befizetésről elektronikus számlát küldünk e-mailben</span></li>
</ul>`)
	b.WriteString(`<form class="pay__form" method="post" action="/fizetes/` + info.Code + `">`)
	if errMsg != "" {
		b.WriteString(`<p class="pay__err" role="alert">` + html.EscapeString(errMsg) + `</p>`)
	}
	// Ptk. 6:78. § (2): the terms that differ from the usual ones are shown separately and accepted expressly.
	b.WriteString(`<div class="pay__terms"><p><strong>Fontos feltételek, mielőtt elfogadod:</strong></p><ul>
<li>12 hónapos kezdő időtartam: ezalatt rendes felmondással nem lehet kilépni (ÁSZF 6.).</li>
<li>Kártyás fizetésnél a díjat ` + adv + ` automatikusan levonjuk, amíg a szerződés él (ÁSZF 5.).</li>
<li>Ha a díj 15 napnál tovább rendezetlen, előzetes felszólítás után szüneteltethetjük az oldalt (ÁSZF 5.).</li>
<li>A díj évente legfeljebb egyszer, csak megnevezett okból változhat; díj- vagy ÁSZF-változáskor díjmentesen felmondhatsz (ÁSZF 5. és 15.).</li>
<li>24 hónap után a weboldal kódját átadjuk, a foglalás- és rendeléskezelő rendszer kivételével (ÁSZF 7.).</li>
<li>Vállalkozásként a felelősségünk az utolsó 12 hónapban fizetett díjak összegéig korlátozott (ÁSZF 11.).</li>
</ul></div>`)
	b.WriteString(`<label class="pay__ok"><input type="checkbox" name="elfogadom" value="igen" required><span>Elolvastam és elfogadom az <a href="/aszf.html" target="_blank" rel="noopener">általános szerződési feltételeket</a>, kifejezetten a fenti kiemelt feltételeket is, hozzájárulok az elektronikus számla kiállításához (Áfa tv. 175. §), valamint ahhoz, hogy a díjat ` + adv + ` automatikusan levonják a kártyámról.</span></label>`)
	b.WriteString(`<button class="btn btn--primary btn--lg pay__go" type="submit"><span>Megrendelés és fizetés</span><span class="spinner" aria-hidden="true"></span>` + arrowSVG + `</button>`)
	b.WriteString(`<p class="pay__safe">` + lockSVG + `<span>A fizetés a Stripe oldalán történik. A kártyaadataidat mi nem látjuk és nem tároljuk.</span></p></form>`)
	b.WriteString(`<p class="pay__fine">Szolgáltató: Zala Studio (<a href="/adatvedelem.html#impresszum">Impresszum</a>) · <a href="/aszf.html">ÁSZF</a> · <a href="/adatvedelem.html">Adatvédelem</a> · <a href="/elallas">Elállás a szerződéstől</a> · Kérdésed van? <a href="mailto:info@zalastudio.hu">info@zalastudio.hu</a></p></article>`)
	payShell(w, code, "Előfizetés indítása", b.String())
}

func payPage(w http.ResponseWriter, r *http.Request, rest string) {
	if rest == "kesz" && (r.Method == "GET" || r.Method == "HEAD") {
		payMessage(w, 200, "Köszönjük, sikeres fizetés!", "A Stripe e-mailben elküldte a visszaigazolást, a számlát külön küldjük. Hamarosan jelentkezünk a következő lépésekkel.", true, "")
		return
	}
	code := strings.ToUpper(strings.TrimSpace(rest))
	if !payCodeRe.MatchString(code) {
		payMessage(w, 404, "A fizetési link nem érvényes", "Ellenőrizd, hogy a teljes linket nyitottad-e meg. Ha nem megy, írj nekünk: <a href=\"mailto:info@zalastudio.hu\">info@zalastudio.hu</a>.", false, "")
		return
	}
	if r.Method != "GET" && r.Method != "HEAD" && r.Method != "POST" {
		w.Header().Set("Allow", "GET, POST")
		w.WriteHeader(405)
		return
	}
	if !payLimit.allow(clientIP(r)) {
		payMessage(w, 429, "Túl sok próbálkozás", "Várj néhány percet, és nyisd meg újra a linket.", false, "")
		return
	}
	st, info, err := dashPay("GET", code, nil)
	if err != nil || st >= 500 {
		payMessage(w, 503, "A fizetés most nem érhető el", "Próbáld újra néhány perc múlva, vagy írj nekünk: <a href=\"mailto:info@zalastudio.hu\">info@zalastudio.hu</a>.", false, "")
		return
	}
	if st == 404 {
		payMessage(w, 404, "A fizetési link nem érvényes", "Lehet, hogy már visszavontuk, vagy elírás van benne. Írj nekünk, és küldünk újat: <a href=\"mailto:info@zalastudio.hu\">info@zalastudio.hu</a>.", false, "")
		return
	}
	if info.State != "pending" {
		stateMessage(w, info)
		return
	}
	info.Code = code
	if r.Method != "POST" {
		payForm(w, 200, info, "")
		return
	}
	raw, _ := io.ReadAll(io.LimitReader(r.Body, 4000))
	form, _ := url.ParseQuery(string(raw))
	if form.Get("elfogadom") != "igen" {
		payForm(w, 422, info, "A folytatáshoz fogadd el a feltételeket (pipáld be a négyzetet).")
		return
	}
	who := sha256.Sum256([]byte(clientIP(r) + "|" + r.UserAgent()))
	st, res, err := dashPay("POST", code, map[string]any{"consent": true, "who": hex.EncodeToString(who[:6])})
	if err == nil && st == 409 {
		stateMessage(w, res)
		return
	}
	u, perr := url.Parse(res.URL)
	if err != nil || st != 200 || !res.OK || perr != nil || (u.Scheme != "https" && u.Scheme != "http") {
		log.Printf("pay %s: checkout failed (%d) %s", code, st, res.Error)
		payForm(w, 502, info, "A fizetési oldal most nem nyílt meg. Próbáld újra pár perc múlva, vagy írj nekünk: info@zalastudio.hu.")
		return
	}
	w.Header().Set("Location", res.URL)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(303)
}

// withdrawPage implements the mandatory online withdrawal function for consumers
// (45/2014. (II. 26.) Korm. rendelet 22. § (1a)–(1d), effective 19 June 2026).
func withdrawForm(w http.ResponseWriter, code int, name, email, ref, note, errMsg string) {
	var b strings.Builder
	b.WriteString(`<article class="doc__card pay">`)
	b.WriteString(`<p class="eyebrow">Fogyasztói elállási funkció · 45/2014. Korm. rendelet 22. §</p>`)
	b.WriteString(`<h1>Elállás a szerződéstől</h1>`)
	b.WriteString(`<p class="pay__plan">Fogyasztóként a szerződés megkötésétől számított 14 napon belül itt is gyakorolhatod az indokolás nélküli elállási vagy felmondási jogodat (részletek: <a href="/aszf.html#fogyaszto">ÁSZF 12. pont</a>). Vállalkozások a szerződés felmondását e-mailben kérhetik az <a href="mailto:info@zalastudio.hu">info@zalastudio.hu</a> címen.</p>`)
	b.WriteString(`<form class="pay__form" method="post" action="/elallas">`)
	if errMsg != "" {
		b.WriteString(`<p class="pay__err" role="alert">` + html.EscapeString(errMsg) + `</p>`)
	}
	b.WriteString(`<label class="fld"><span>Fogyasztó neve</span><input class="inp" name="nev" required maxlength="80" autocomplete="name" value="` + html.EscapeString(name) + `" placeholder="Teljes név"></label>`)
	b.WriteString(`<label class="fld"><span>E-mail-cím (ide küldjük a visszaigazolást)</span><input class="inp" name="email" type="email" required maxlength="120" autocomplete="email" value="` + html.EscapeString(email) + `" placeholder="nev@example.hu"></label>`)
	b.WriteString(`<label class="fld"><span>A szerződés azonosítója</span><input class="inp" name="azonosito" required maxlength="120" value="` + html.EscapeString(ref) + `" placeholder="Weboldal neve, fizetési kód vagy számlaszám"></label>`)
	b.WriteString(`<label class="fld"><span>Megjegyzés <small>(nem kötelező)</small></span><textarea class="inp" name="uzenet" maxlength="1000" placeholder="Pl. szerződéskötés dátuma">` + html.EscapeString(note) + `</textarea></label>`)
	b.WriteString(`<div style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden" aria-hidden="true"><label>Weboldal<input name="weboldal" tabindex="-1" autocomplete="off"></label></div>`)
	b.WriteString(`<button class="btn btn--primary btn--lg" type="submit" style="width:100%"><span>Elállás megerősítése</span>` + arrowSVG + `</button>`)
	b.WriteString(`<p class="pay__fine">Az „Elállás megerősítése” gomb megnyomásával benyújtod az elállási/felmondási nyilatkozatodat. A beérkezést azonnal visszaigazoljuk ezen az oldalon és e-mailben is. · <a href="/aszf.html#fogyaszto">ÁSZF</a> · <a href="/adatvedelem.html#adatkezeles">Adatvédelem</a></p>`)
	b.WriteString(`</form></article>`)
	payShell(w, code, "Elállás a szerződéstől", b.String())
}

func withdrawPage(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" || r.Method == "HEAD" {
		withdrawForm(w, 200, "", "", "", "", "")
		return
	}
	if r.Method != "POST" {
		w.Header().Set("Allow", "GET, POST")
		w.WriteHeader(405)
		return
	}
	if !withdrawLimit.allow(clientIP(r)) {
		payMessage(w, 429, "Túl sok próbálkozás", "Várj néhány percet, vagy küldd el a nyilatkozatodat közvetlenül e-mailben az <a href=\"mailto:info@zalastudio.hu\">info@zalastudio.hu</a> címre.", false, "")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 8000))
	if err != nil {
		withdrawForm(w, 400, "", "", "", "", "Hibás kérés. Próbáld újra.")
		return
	}
	form, err := url.ParseQuery(string(raw))
	if err != nil {
		withdrawForm(w, 400, "", "", "", "", "Hibás kérés. Próbáld újra.")
		return
	}
	if form.Get("weboldal") != "" {
		payMessage(w, 200, "Elállási nyilatkozat rögzítve", "A nyilatkozatot rögzítettük.", true, "")
		return
	}
	name := clean(form.Get("nev"), 80)
	email := strings.ToLower(clean(form.Get("email"), 120))
	ref := clean(form.Get("azonosito"), 120)
	note := cut(strings.TrimSpace(ctrl.ReplaceAllString(strings.ToValidUTF8(strings.ReplaceAll(form.Get("uzenet"), "\r", ""), ""), "")), 1000)

	if len([]rune(name)) < 2 {
		withdrawForm(w, 422, name, email, ref, note, "Add meg a teljes neved.")
		return
	}
	if !emailRe.MatchString(email) {
		withdrawForm(w, 422, name, email, ref, note, "Adj meg egy érvényes e-mail-címet a visszaigazoláshoz.")
		return
	}
	if len([]rune(ref)) < 2 {
		withdrawForm(w, 422, name, email, ref, note, "Add meg a szerződés azonosítóját (pl. weboldal neve, fizetési kód vagy számlaszám).")
		return
	}

	now := time.Now()
	ts := now.In(budapest).Format("2006.01.02. 15:04:05")
	id := uuid()
	msg := "FOGYASZTÓI ELÁLLÁS / FELMONDÁS (45/2014. Korm. rendelet 22. §)\n" +
		"Nyilatkozat azonosítója: " + id[:8] + "\n" +
		"Beérkezés ideje: " + ts + " (Europe/Budapest)\n" +
		"Szerződés azonosítója: " + ref
	if note != "" {
		msg += "\nMegjegyzés: " + note
	}
	l := Lead{
		ID:       id,
		Created:  now.UTC().Format("2006-01-02T15:04:05.000Z"),
		Source:   "urlap",
		Entry:    "elallas",
		Business: "[ELÁLLÁS] " + cut(ref, 108),
		Name:     name,
		Email:    email,
		Message:  cut(msg, 2000),
		Features: []string{},
		Billing:  "m",
		Device:   "asztali",
	}
	if mobileRe.MatchString(r.UserAgent()) {
		l.Device = "mobil"
	}
	obMu.Lock()
	outbox = append(outbox, &outItem{Lead: l})
	err = saveOutbox()
	if err != nil {
		outbox = outbox[:len(outbox)-1]
	}
	obMu.Unlock()
	if err != nil {
		log.Print("withdraw: could not save: ", err)
		withdrawForm(w, 500, name, email, ref, note, "Most nem sikerült elmenteni. Küldd el e-mailben az info@zalastudio.hu címre.")
		return
	}
	log.Printf("withdraw: %s (%s)", id[:8], ref)
	go flush()

	receipt := `<dl class="kv pay__kv" style="width:100%;max-width:440px;text-align:left;margin:8px 0">` +
		`<div><dt>Visszaigazolási kód</dt><dd>` + html.EscapeString(strings.ToUpper(id[:8])) + `</dd></div>` +
		`<div><dt>Beérkezés ideje</dt><dd>` + html.EscapeString(ts) + `</dd></div>` +
		`<div><dt>Név</dt><dd>` + html.EscapeString(name) + `</dd></div>` +
		`<div><dt>E-mail</dt><dd>` + html.EscapeString(email) + `</dd></div>` +
		`<div><dt>Szerződés azonosítója</dt><dd>` + html.EscapeString(ref) + `</dd></div>` +
		`</dl>`
	payMessage(w, 200, "Elállási nyilatkozat megérkezett",
		"Rögzítettük a nyilatkozatodat. A visszaigazolást haladéktalanul megküldjük e-mailben is a megadott címre; addig ezt az oldalt elmentheted vagy kinyomtathatod.",
		true, receipt)
}

// relayWebhook passes Stripe's webhook to the Irányítópult unchanged; it verifies the signature.
func relayWebhook(w http.ResponseWriter, r *http.Request) {
	if !hookLimit.allow("all") {
		w.WriteHeader(429)
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20+1))
	if err != nil || len(raw) > 1<<20 {
		w.WriteHeader(413)
		return
	}
	req, _ := http.NewRequest("POST", dashBase+"/stripe", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Stripe-Signature", r.Header.Get("Stripe-Signature"))
	resp, err := httpc.Do(req)
	if err != nil {
		// Stripe retries for up to three days, so nothing is lost while the Irányítópult is down.
		log.Print("stripe webhook: Irányítópult not reachable: ", err)
		w.WriteHeader(503)
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, io.LimitReader(resp.Body, 4096))
}

func portalRedirect(w http.ResponseWriter, r *http.Request) {
	cfgMu.Lock()
	link := config.Portal
	cfgMu.Unlock()
	if link != "" {
		w.Header().Set("Location", link)
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(303)
		return
	}
	payMessage(w, 200, "Előfizetés kezelése", "Kártyacseréhez, számlamásolathoz vagy bármilyen kérdéshez írj az <a href=\"mailto:info@zalastudio.hu\">info@zalastudio.hu</a> címre.", false, "")
}
