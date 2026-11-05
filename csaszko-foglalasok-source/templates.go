package main

// E-mail texts (Hungarian, informal "te"): customer e-mails and the notification to Bence.

import (
	"fmt"
	"html"
	"strings"
	"time"
	"unicode/utf8"
)

var shop = struct{ Name, Owner, Address, Phone, PhoneHref string }{
	"Csaszko Barbershop", "Császár Bence", "8790 Zalaszentgrót, Nefelejts u. 1.", "+36 30 735 5077", "+36307355077",
}

var tx = map[string]string{
	"greet":           "Szia %s!",
	"confirm_subject": "Időpontod visszaigazolva – %s, %s",
	"confirm_intro":   "Visszaigazolom az időpontodat:",
	"confirm_outro":   "Ha mégsem tudsz jönni, szólj minél előbb telefonon vagy SMS-ben.",
	"decline_subject": "Időpontkérésed – %s, %s",
	"decline_intro":   "Köszönöm, hogy időpontot kértél. Erre az időpontra sajnos nem tudlak fogadni:",
	"decline_outro":   "Válassz egy másik időpontot a weboldalon, vagy hívj.",
	"cancel_subject":  "Időpontod lemondva – %s, %s",
	"cancel_intro":    "Sajnos le kell mondanom ezt az időpontodat:",
	"cancel_outro":    "Válassz egy új időpontot a weboldalon, vagy hívj. Bocs a kellemetlenségért.",
	"cal_hint":        "A csatolt fájllal egy koppintással beteheted a naptáradba.",
}

var huMonths = []string{"január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"}

// dateLong: "2026. november 17., kedd" (what Intl hu-HU gave the Node version)
func dateLong(d string) string {
	t, ok := parseDate(d)
	if !ok {
		return d
	}
	return fmt.Sprintf("%d. %s %d., %s", t.Year(), huMonths[t.Month()-1], t.Day(), dayNames[t.Weekday()])
}

func endTime(b *Booking) string { return fromMin(toMin(b.Time) + b.Minutes) }
func esc(s string) string       { return html.EscapeString(s) }
func nl2br(s string) string     { return strings.ReplaceAll(esc(s), "\n", "<br>") }

func firstName(name string) string {
	f := strings.Fields(name)
	if len(f) == 0 {
		return name
	}
	return f[len(f)-1] // Hungarian order: family name first, given name last
}

/* ---- calendar file ---- */

func icsStamp(t time.Time) string { return t.UTC().Format("20060102T150405Z") }
func icsEsc(s string) string {
	return strings.NewReplacer(`\`, `\\`, ";", `\;`, ",", `\,`, "\r\n", `\n`, "\n", `\n`).Replace(s)
}
func icsFold(line string) string {
	var out []string
	cur := ""
	for _, r := range line {
		if len(cur)+utf8.RuneLen(r) > 73 {
			out = append(out, cur)
			cur = " "
		}
		cur += string(r)
	}
	out = append(out, cur)
	return strings.Join(out, "\r\n")
}

func ics(b *Booking, service string) string {
	d, _ := parseDate(b.Date)
	m := toMin(b.Time)
	start := time.Date(d.Year(), d.Month(), d.Day(), m/60, m%60, 0, 0, loc)
	end := start.Add(time.Duration(b.Minutes) * time.Minute)
	lines := []string{
		"BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Csaszko Barbershop//Foglalas//HU", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
		"BEGIN:VEVENT",
		"UID:" + b.ID + "@csaszko",
		"DTSTAMP:" + icsStamp(time.Now()),
		"DTSTART:" + icsStamp(start),
		"DTEND:" + icsStamp(end),
		"SUMMARY:" + icsEsc("Csaszko Barbershop – "+service),
		"LOCATION:" + icsEsc("Csaszko Barbershop, "+shop.Address),
		"DESCRIPTION:" + icsEsc(shop.Owner+", "+shop.Phone),
		"BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + icsEsc("Csaszko – "+service), "TRIGGER:-PT1H", "END:VALARM",
		"END:VEVENT", "END:VCALENDAR", "",
	}
	for i, l := range lines {
		lines[i] = icsFold(l)
	}
	return strings.Join(lines, "\r\n")
}

/* ---- html ---- */

func htmlShell(inner string) string {
	return `<!doctype html><html><body style="margin:0;padding:0;background:#EDEAE4;">` +
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EDEAE4;padding:24px 12px;"><tr><td align="center">` +
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:10px;overflow:hidden;">` +
		`<tr><td style="padding:22px 28px;background:#000000;font-family:Arial,Helvetica,sans-serif;color:#F3EEE5;">` +
		`<div style="font-size:22px;font-weight:bold;letter-spacing:1px;">CSASZKO BARBERSHOP</div>` +
		`<div style="height:4px;margin-top:10px;background:#CDA75E;border-radius:2px;"></div></td></tr>` +
		`<tr><td style="padding:24px 28px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#1A1A1A;">` + inner + `</td></tr>` +
		`</table>` +
		`<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#5E5A52;margin-top:14px;">` + esc(shop.Address) + ` · ` + esc(shop.Phone) + `</div>` +
		`</td></tr></table></body></html>`
}

func rowsHTML(rows [][2]string) string {
	var b strings.Builder
	b.WriteString(`<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:16px 0 18px;border-top:1px solid #E2DED6;">`)
	for _, r := range rows {
		b.WriteString(`<tr><td style="padding:9px 12px 9px 0;border-bottom:1px solid #E2DED6;color:#5E5A52;font-size:14px;white-space:nowrap;vertical-align:top;">` + esc(r[0]) +
			`</td><td style="padding:9px 0;border-bottom:1px solid #E2DED6;font-weight:bold;color:#111111;">` + nl2br(r[1]) + `</td></tr>`)
	}
	b.WriteString(`</table>`)
	return b.String()
}

// customerEmail: kind is confirm | decline | cancel.
func customerEmail(kind string, b *Booking, message, siteURL string) *Mail {
	service := b.Service.Hu
	date := dateLong(b.Date)
	when := date + ", " + b.Time + "–" + endTime(b)
	rows := [][2]string{{"Szolgáltatás", service}, {"Időpont", when}}
	if kind == "confirm" {
		rows = append(rows, [2]string{"Időtartam", fmt.Sprintf("kb. %d perc", b.Minutes)})
		if b.Service.Price != nil {
			rows = append(rows, [2]string{"Ár", ft(*b.Service.Price)})
		}
		rows = append(rows, [2]string{"Cím", shop.Address})
	}
	message = strings.TrimSpace(message)
	greet := fmt.Sprintf(tx["greet"], firstName(b.Name))
	intro, outro := tx[kind+"_intro"], tx[kind+"_outro"]

	var text []string
	text = append(text, greet, "", intro, "")
	for _, r := range rows {
		text = append(text, r[0]+": "+r[1])
	}
	if message != "" {
		text = append(text, "", "Üzenet: "+message)
	}
	text = append(text, "", outro)
	if kind == "confirm" {
		text = append(text, tx["cal_hint"])
	}
	text = append(text, "", "Telefon: "+shop.Phone)
	if siteURL != "" && kind != "confirm" {
		text = append(text, "Weboldal: "+siteURL)
	}
	text = append(text, "", "Üdv,", shop.Owner, shop.Name)

	h := `<p style="margin:0 0 12px;">` + esc(greet) + `</p>` +
		`<p style="margin:0;">` + esc(intro) + `</p>` + rowsHTML(rows)
	if message != "" {
		h += `<p style="margin:0 0 14px;padding:12px 14px;background:#F3EFE6;border-radius:6px;"><b>Üzenet:</b> ` + nl2br(message) + `</p>`
	}
	h += `<p style="margin:0 0 10px;">` + esc(outro) + `</p>`
	if kind == "confirm" {
		h += `<p style="margin:0 0 10px;font-size:13px;color:#5E5A52;">` + esc(tx["cal_hint"]) + `</p>`
	}
	h += `<p style="margin:0 0 18px;">Telefon: <a href="tel:` + shop.PhoneHref + `" style="color:#111111;font-weight:bold;">` + esc(shop.Phone) + `</a>`
	if siteURL != "" && kind != "confirm" {
		h += `<br><a href="` + esc(siteURL) + `" style="color:#111111;">` + esc(strings.TrimPrefix(strings.TrimPrefix(siteURL, "https://"), "http://")) + `</a>`
	}
	h += `</p><p style="margin:0;">Üdv,<br><b>` + esc(shop.Owner) + `</b><br><span style="color:#5E5A52;font-size:14px;">` + esc(shop.Name) + `</span></p>`

	m := &Mail{Subject: fmt.Sprintf(tx[kind+"_subject"], date, b.Time), Text: strings.Join(text, "\n"), HTML: htmlShell(h)}
	if kind == "confirm" {
		m.Attachments = []Attachment{{Filename: "idopont.ics", ContentType: "text/calendar; charset=UTF-8; method=PUBLISH", Content: ics(b, service)}}
	}
	return m
}

func adminNotification(b *Booking, adminURL string) *Mail {
	confirmed := b.Status == "confirmed"
	svc := b.Service.Hu
	if b.Service.Price != nil {
		svc += " (" + ft(*b.Service.Price) + ")"
	}
	rows := [][2]string{
		{"Szolgáltatás", svc},
		{"Időpont", fmt.Sprintf("%s, %s–%s (%d perc)", dateLong(b.Date), b.Time, endTime(b), b.Minutes)},
		{"Név", b.Name}, {"Telefon", b.Phone},
	}
	if b.Email != "" {
		rows = append(rows, [2]string{"E-mail", b.Email})
	}
	if b.Note != "" {
		rows = append(rows, [2]string{"Megjegyzés", b.Note})
	}
	kind, action := "Új időpontkérés", "Elfogadás vagy elutasítás a Csaszko Foglalások appban:"
	if confirmed {
		kind, action = "Új foglalás", "A foglalás automatikusan visszaigazolt. Az appban áthelyezheted vagy lemondhatod:"
	}
	subject := kind + ": " + b.Name + " – " + strings.ReplaceAll(b.Date, "-", ".") + ". " + b.Time
	var text []string
	text = append(text, kind+" érkezett a weboldalról:", "")
	for _, r := range rows {
		text = append(text, r[0]+": "+r[1])
	}
	text = append(text, "", action, adminURL)
	h := `<p style="margin:0;font-size:18px;"><b>` + kind + ` érkezett</b></p>` + rowsHTML(rows)
	if adminURL != "" {
		h += `<p style="margin:0;text-align:center;"><a href="` + esc(adminURL) + `" style="display:inline-block;padding:13px 24px;background:#000000;color:#F3EEE5;text-decoration:none;border-radius:999px;font-weight:bold;">Megnyitás az appban</a></p>`
	}
	note := "Ha megadott e-mail címet, erre a levélre válaszolva közvetlenül neki írsz."
	if !confirmed {
		note = "A vendég csak akkor kap értesítést, amikor elfogadod vagy elutasítod. " + note
	}
	h += `<p style="margin:16px 0 0;font-size:13px;color:#5E5A52;">` + note + `</p>`
	return &Mail{Subject: subject, Text: strings.Join(text, "\n"), HTML: htmlShell(h)}
}

func testEmail() *Mail {
	return &Mail{
		Subject: "Csaszko Foglalások – teszt e-mail",
		Text:    "Ez egy teszt e-mail. Ha megkaptad, az e-mail küldés működik.",
		HTML:    htmlShell(`<p style="margin:0 0 10px;"><b>Teszt e-mail</b></p><p style="margin:0;">Ha megkaptad, az e-mail küldés működik.</p>`),
	}
}
