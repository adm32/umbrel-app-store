package main

import (
	"fmt"
	"io/fs"
	"net/http"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var mimeTypes = map[string]string{
	".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8",
	".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon",
}

func serveStatic(w http.ResponseWriter, r *http.Request, p string) {
	rel := strings.TrimLeft(p, "/")
	if rel == "" {
		rel = "index.html"
	}
	rel = path.Clean(rel)
	if strings.HasPrefix(rel, "..") {
		w.WriteHeader(403)
		return
	}
	data, err := fs.ReadFile(webFS, "web/"+rel)
	if err != nil {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(404)
		w.Write([]byte("Not found"))
		return
	}
	h := w.Header()
	ct := mimeTypes[path.Ext(rel)]
	if ct == "" {
		ct = "application/octet-stream"
	}
	h.Set("Content-Type", ct)
	h.Set("Cache-Control", "no-cache")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Frame-Options", "SAMEORIGIN")
	h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'")
	w.WriteHeader(200)
	if r.Method != "HEAD" {
		w.Write(data)
	}
}

func remoteEnabled() bool { return settings.Remote != nil && settings.Remote.Hash != "" }

func settingsForClient() obj {
	s := settings
	smtp := obj{"host": s.SMTP.Host, "port": s.SMTP.Port, "secure": s.SMTP.Secure, "user": s.SMTP.User, "fromName": s.SMTP.FromName, "hasPass": s.SMTP.Pass != ""}
	setAt := any(nil)
	if s.Remote != nil && s.Remote.SetAt != "" {
		setAt = s.Remote.SetAt
	}
	return obj{
		"hours": s.Hours, "stepMinutes": s.StepMinutes, "bufferMinutes": s.BufferMinutes, "minNoticeMinutes": s.MinNoticeMinutes,
		"horizonDays": s.HorizonDays, "autoConfirm": s.AutoConfirm, "sameDay": s.SameDay, "services": s.Services, "smtp": smtp,
		"notifyEmail": s.NotifyEmail, "ntfyUrl": s.NtfyURL, "adminUrl": s.AdminURL, "siteUrl": s.SiteURL,
		"remote": obj{"enabled": remoteEnabled(), "setAt": setAt},
	}
}

func state(remote bool) obj {
	t := now()
	blocks := append([]*Block{}, db.Blocks...) // never null in JSON
	sort.SliceStable(blocks, func(i, j int) bool { return blocks[i].Date < blocks[j].Date })
	return obj{"today": t.date, "nowMin": t.min, "bookings": sortedBookings(), "blocks": blocks,
		"mailConfigured": smtpConfigured(), "ntfyConfigured": settings.NtfyURL != "", "settings": settingsForClient(), "remoteSession": remote, "remotePort": remotePort != ""}
}

func findBooking(id string) (*Booking, int) {
	for i, b := range db.Bookings {
		if b.ID == id {
			return b, i
		}
	}
	return nil, -1
}

func manualService(body obj) BService {
	if svc := serviceByID(str(body["serviceId"], 40)); svc != nil {
		return BService{ID: svc.ID, Hu: svc.Name, Price: svc.Price}
	}
	name := oneLine(body["serviceHu"], 160)
	if name == "" {
		name = "Szolgáltatás"
	}
	return BService{Hu: name}
}

var (
	reActionPath  = regexp.MustCompile(`^/api/admin/bookings/([a-f0-9]+)/(confirm|decline|cancel|resend)$`)
	reBookingPath = regexp.MustCompile(`^/api/admin/bookings/([a-f0-9]+)$`)
	reBlockPath   = regexp.MustCompile(`^/api/admin/blocks/([a-f0-9]+)$`)
	reNtfy        = regexp.MustCompile(`^https://[^\s/]+/[\w-]{6,64}$`)
	reSvcID       = regexp.MustCompile(`^[a-z0-9-]{1,40}$`)
	reNonAlnum    = regexp.MustCompile(`[^a-z0-9]+`)
)

const conflictMsg = "Ez az időpont ütközik egy másik foglalással vagy zárással."
const noMailMsg = "Az e-mail küldés még nincs beállítva (Beállítások)."

var accents = strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ö", "o", "ő", "o", "ú", "u", "ü", "u", "ű", "u")

func slug(name string) string {
	s := accents.Replace(strings.ToLower(name))
	s = strings.Trim(reNonAlnum.ReplaceAllString(s, "-"), "-")
	s = cut(s, 30)
	if s == "" {
		s = "szolg"
	}
	return s
}

func adminAPI(w http.ResponseWriter, r *http.Request, remote bool) {
	p := strings.TrimRight(r.URL.Path, "/")
	if p == "" {
		p = "/"
	}
	if !strings.HasPrefix(p, "/api/") {
		if r.Method != "GET" && r.Method != "HEAD" {
			send(w, 405, obj{"error": "method"})
			return
		}
		serveStatic(w, r, p)
		return
	}
	// simple CSRF guard: browsers can't add custom headers to cross-site form posts
	if r.Method != "GET" && r.Header.Get("X-Csaszko") != "1" {
		send(w, 403, obj{"error": "forbidden"})
		return
	}
	body := obj{}
	if r.Method == "POST" || r.Method == "PUT" {
		b, code, err := readBody(w, r, 65536)
		if err != nil {
			send(w, code, obj{"error": "invalid"})
			return
		}
		body = b
	}
	q := r.URL.Query()

	switch {
	case r.Method == "GET" && p == "/api/admin/state":
		mu.Lock()
		out := state(remote)
		mu.Unlock()
		send(w, 200, out)
		return

	case p == "/api/admin/remote" && r.Method == "POST":
		// the remote password can only be set from the Umbrel-protected address, never through the tunnel
		if remote {
			send(w, 403, obj{"error": "A távoli jelszót csak az Umbrelen keresztül lehet módosítani."})
			return
		}
		mu.Lock()
		defer mu.Unlock()
		switch {
		case truthy(body["disable"]):
			send(w, 400, obj{"error": "Az app jelszavát nem lehet kikapcsolni, csak megváltoztatni."})
			return
		case truthy(body["logoutAll"]):
			if remoteEnabled() {
				settings.Remote.Ver++
				saveSettings()
			}
		default:
			pw := asStr(body["password"])
			if len([]rune(pw)) < 8 {
				send(w, 400, obj{"error": "A jelszó legyen legalább 8 karakter."})
				return
			}
			if len([]rune(pw)) > 200 {
				send(w, 400, obj{"error": "Túl hosszú jelszó."})
				return
			}
			setRemotePassword(pw)
		}
		send(w, 200, obj{"ok": true, "settings": settingsForClient()})
		return

	case r.Method == "GET" && p == "/api/admin/services":
		mu.Lock()
		items := []obj{}
		for _, x := range settings.Services {
			price := ""
			if x.Price != nil {
				price = ft(*x.Price)
			}
			items = append(items, obj{"id": x.ID, "name": x.Name, "price": price, "minutes": x.Minutes})
		}
		mu.Unlock()
		send(w, 200, obj{"source": "settings", "categories": []obj{{"name": "Szolgáltatások", "items": items}}})
		return

	case r.Method == "GET" && p == "/api/admin/stats":
		days, ok := parseInt(q.Get("days"))
		if !ok || days == 0 {
			days = 30
		}
		days = max(7, min(365, days))
		mu.Lock()
		out := statsReport(days)
		mu.Unlock()
		send(w, 200, out)
		return

	case r.Method == "GET" && p == "/api/admin/slots":
		date := q.Get("date")
		if !isDate(date) {
			send(w, 400, obj{"error": "date"})
			return
		}
		mu.Lock()
		times := freeStarts(date, clampMinutes(q.Get("minutes")), true, q.Get("exclude"))
		mu.Unlock()
		send(w, 200, obj{"times": times})
		return
	}

	if m := reActionPath.FindStringSubmatch(p); m != nil && r.Method == "POST" {
		bookingAction(w, m[1], m[2], body)
		return
	}
	if m := reBookingPath.FindStringSubmatch(p); m != nil && r.Method == "DELETE" {
		mu.Lock()
		defer mu.Unlock()
		_, i := findBooking(m[1])
		if i < 0 {
			send(w, 404, obj{"error": "Nincs ilyen foglalás."})
			return
		}
		db.Bookings = append(db.Bookings[:i], db.Bookings[i+1:]...)
		saveDB()
		send(w, 200, obj{"ok": true})
		return
	}
	if m := reBookingPath.FindStringSubmatch(p); m != nil && r.Method == "PUT" {
		// move / edit a booking (date, time, minutes, service, note, contact)
		mu.Lock()
		defer mu.Unlock()
		b, _ := findBooking(m[1])
		if b == nil {
			send(w, 404, obj{"error": "Nincs ilyen foglalás."})
			return
		}
		date, tm, minutes := b.Date, b.Time, b.Minutes
		if v, ok := body["date"]; ok && v != nil {
			date = str(v, 10)
		}
		if v, ok := body["time"]; ok && v != nil {
			tm = str(v, 5)
		}
		if v, ok := body["minutes"]; ok && v != nil {
			minutes = clampMinutes(v)
		}
		if !isDate(date) || !isTime(tm) {
			send(w, 400, obj{"error": "Hibás dátum vagy idő."})
			return
		}
		if active(b.Status) && overlaps(date, tm, minutes, b.ID) && !truthy(body["force"]) {
			send(w, 409, obj{"error": conflictMsg})
			return
		}
		b.Date, b.Time, b.Minutes, b.UpdatedAt = date, tm, minutes, isoNow()
		if body["serviceId"] != nil || body["serviceHu"] != nil {
			b.Service = manualService(body)
		}
		if v, ok := body["note"]; ok && v != nil {
			b.Note = str(v, 1000)
		}
		if v, ok := body["name"]; ok && v != nil {
			if n := oneLine(v, 80); n != "" {
				b.Name = n
			}
		}
		if v, ok := body["phone"]; ok && v != nil {
			b.Phone = oneLine(v, 30)
		}
		if v, ok := body["email"]; ok && v != nil {
			b.Email = strings.ToLower(oneLine(v, 120))
		}
		saveDB()
		send(w, 200, obj{"ok": true, "booking": b})
		return
	}

	switch {
	case p == "/api/admin/bookings" && r.Method == "POST":
		manualBooking(w, body)
		return

	case p == "/api/admin/blocks" && r.Method == "POST":
		k := &Block{ID: randHex(6), Date: str(body["date"], 10), AllDay: !isFalse(body["allDay"]),
			From: str(body["from"], 5), To: str(body["to"], 5), Note: oneLine(body["note"], 120), CreatedAt: isoNow()}
		k.DateTo = str(body["dateTo"], 10)
		if k.DateTo == "" {
			k.DateTo = k.Date
		}
		if !isDate(k.Date) || !isDate(k.DateTo) || k.DateTo < k.Date {
			send(w, 400, obj{"error": "Hibás dátum."})
			return
		}
		if !k.AllDay && (!isTime(k.From) || !isTime(k.To) || toMin(k.To) <= toMin(k.From)) {
			send(w, 400, obj{"error": "Hibás időtartam."})
			return
		}
		if k.AllDay {
			k.From, k.To = "", ""
		}
		mu.Lock()
		db.Blocks = append(db.Blocks, k)
		saveDB()
		mu.Unlock()
		send(w, 201, obj{"ok": true, "block": k})
		return

	case p == "/api/admin/settings" && r.Method == "PUT":
		putSettings(w, body)
		return

	case p == "/api/admin/test-ntfy" && r.Method == "POST":
		mu.Lock()
		u, click := settings.NtfyURL, settings.AdminURL
		mu.Unlock()
		if u == "" {
			send(w, 400, obj{"error": "Előbb add meg és mentsd el az ntfy címet."})
			return
		}
		if ntfy(u, "Csaszko Foglalások – teszt", "Ha ezt látod a telefonodon, az értesítés működik.", click) {
			send(w, 200, obj{"ok": true})
		} else {
			send(w, 502, obj{"error": "Nem sikerült elküldeni. Ellenőrizd az ntfy címet."})
		}
		return

	case p == "/api/admin/test-email" && r.Method == "POST":
		mu.Lock()
		s := *settings
		mu.Unlock()
		// the form sends what is typed, so a password can be tried before it is saved
		unsaved := false
		if u := oneLine(body["user"], 120); u != "" {
			if !isEmail(u) {
				send(w, 400, obj{"error": "Hibás Gmail cím."})
				return
			}
			unsaved = unsaved || u != s.SMTP.User
			s.SMTP.User = u
		}
		if v := asStr(body["pass"]); strings.TrimSpace(v) != "" {
			p, msg := cleanAppPassword(v, s.SMTP.Host)
			if msg != "" {
				send(w, 400, obj{"error": msg})
				return
			}
			unsaved = unsaved || p != s.SMTP.Pass
			s.SMTP.Pass = p
		}
		ok := s.SMTP.Host != "" && s.SMTP.User != "" && s.SMTP.Pass != ""
		if !ok {
			send(w, 400, obj{"error": "Előbb add meg a Gmail címet és az alkalmazásjelszót, és mentsd el."})
			return
		}
		to := oneLine(body["to"], 120)
		if to == "" {
			to = s.NotifyEmail
		}
		if to == "" {
			to = s.SMTP.User
		}
		m := testEmail()
		m.From, m.FromName, m.To = s.SMTP.User, s.SMTP.FromName, to
		if err := sendMail(s.SMTP, m); err != nil {
			send(w, 502, obj{"error": explainMail(err)})
			return
		}
		send(w, 200, obj{"ok": true, "to": to, "unsaved": unsaved})
		return
	}

	if m := reBlockPath.FindStringSubmatch(p); m != nil && r.Method == "DELETE" {
		mu.Lock()
		defer mu.Unlock()
		for i, k := range db.Blocks {
			if k.ID == m[1] {
				db.Blocks = append(db.Blocks[:i], db.Blocks[i+1:]...)
				saveDB()
				send(w, 200, obj{"ok": true})
				return
			}
		}
		send(w, 404, obj{"error": "Nincs ilyen zárás."})
		return
	}

	send(w, 404, obj{"error": "not found"})
}

func bookingAction(w http.ResponseWriter, id, action string, body obj) {
	mu.Lock()
	b, _ := findBooking(id)
	if b == nil {
		mu.Unlock()
		send(w, 404, obj{"error": "Nincs ilyen foglalás."})
		return
	}
	message := str(body["message"], 1000)
	notify := !isFalse(body["sendEmail"]) && b.Email != ""
	switch action {
	case "confirm":
		if b.Status != "confirmed" && overlaps(b.Date, b.Time, b.Minutes, b.ID) && !truthy(body["force"]) {
			mu.Unlock()
			send(w, 409, obj{"error": conflictMsg})
			return
		}
		b.Status = "confirmed"
	case "decline":
		b.Status = "declined"
	case "cancel":
		b.Status = "cancelled"
	}
	if action != "resend" {
		b.Message = message
		b.UpdatedAt = isoNow()
	}
	saveDB()
	kind := action
	if action == "resend" {
		kind = map[string]string{"confirmed": "confirm", "declined": "decline", "cancelled": "cancel"}[b.Status]
		message = b.Message
	}
	var rec *MailRec
	mailOK := smtpConfigured()
	if notify && kind != "" && !mailOK {
		rec = &MailRec{Kind: kind, At: isoNow(), Error: noMailMsg}
		b.Mail = rec
		saveDB()
	}
	mu.Unlock()
	if notify && kind != "" && mailOK {
		rec = sendCustomer(id, kind, message)
	}
	mu.Lock()
	out := obj{"ok": true, "booking": b, "mail": rec}
	mu.Unlock()
	send(w, 200, out)
}

func manualBooking(w http.ResponseWriter, body obj) {
	// e.g. taken over the phone – confirmed straight away
	b := &Booking{ID: randHex(6), Status: "confirmed", Source: "manual",
		Date: str(body["date"], 10), Time: str(body["time"], 5), Minutes: clampMinutes(body["minutes"]),
		Note: str(body["note"], 1000), Name: oneLine(body["name"], 80), Phone: oneLine(body["phone"], 30),
		Email: strings.ToLower(oneLine(body["email"], 120)), CreatedAt: isoNow()}
	if !isDate(b.Date) || !isTime(b.Time) {
		send(w, 400, obj{"error": "Hibás dátum vagy idő."})
		return
	}
	if len([]rune(b.Name)) < 2 {
		send(w, 400, obj{"error": "Add meg a vendég nevét."})
		return
	}
	if b.Email != "" && !isEmail(b.Email) {
		send(w, 400, obj{"error": "Hibás e-mail cím."})
		return
	}
	mu.Lock()
	b.Service = manualService(body)
	if overlaps(b.Date, b.Time, b.Minutes, "") && !truthy(body["force"]) {
		mu.Unlock()
		send(w, 409, obj{"error": conflictMsg})
		return
	}
	db.Bookings = append(db.Bookings, b)
	saveDB()
	mailOK := smtpConfigured()
	var rec *MailRec
	wantMail := truthy(body["sendEmail"]) && b.Email != ""
	if wantMail && !mailOK {
		rec = &MailRec{Kind: "confirm", At: isoNow(), Error: noMailMsg}
		b.Mail = rec
		saveDB()
	}
	mu.Unlock()
	if wantMail && mailOK {
		rec = sendCustomer(b.ID, "confirm", "")
	}
	mu.Lock()
	out := obj{"ok": true, "booking": b, "mail": rec}
	mu.Unlock()
	send(w, 201, out)
}

var dayNames = []string{"vasárnap", "hétfő", "kedd", "szerda", "csütörtök", "péntek", "szombat"}

func putSettings(w http.ResponseWriter, s obj) {
	mu.Lock()
	defer mu.Unlock()
	next := *settings
	next.Hours = map[string][]string{}
	for k, v := range settings.Hours {
		next.Hours[k] = v
	}
	numIn := func(v any, lo, hi, def int) int {
		n, ok := parseInt(v)
		if !ok {
			return def
		}
		return max(lo, min(hi, n))
	}
	if hm, ok := s["hours"].(map[string]any); ok {
		for d := 0; d < 7; d++ {
			k := strconv.Itoa(d)
			v, present := hm[k]
			if !present {
				continue
			}
			if v == nil || isFalse(v) {
				next.Hours[k] = nil
				continue
			}
			arr, ok := v.([]any)
			if ok && len(arr) >= 2 {
				a, b := asStr(arr[0]), asStr(arr[1])
				if isTime(a) && isTime(b) && toMin(b) > toMin(a) {
					next.Hours[k] = []string{a, b}
					continue
				}
			}
			send(w, 400, obj{"error": "Hibás nyitvatartás (" + dayNames[d] + ")."})
			return
		}
	}
	if v, ok := s["stepMinutes"]; ok && v != nil {
		n := int(num(v))
		next.StepMinutes = 20
		for _, x := range []int{10, 15, 20, 30, 60} {
			if float64(x) == num(v) {
				next.StepMinutes = n
			}
		}
	}
	if v, ok := s["bufferMinutes"]; ok && v != nil {
		next.BufferMinutes = numIn(v, 0, 120, 0)
	}
	if v, ok := s["minNoticeMinutes"]; ok && v != nil {
		next.MinNoticeMinutes = numIn(v, 0, 10080, 30)
	}
	if v, ok := s["autoConfirm"]; ok && v != nil {
		next.AutoConfirm = truthy(v)
	}
	if v, ok := s["sameDay"]; ok && v != nil {
		next.SameDay = truthy(v)
	}
	if v, ok := s["horizonDays"]; ok && v != nil {
		next.HorizonDays = numIn(v, 7, 365, 30)
	}
	if v, ok := s["ntfyUrl"]; ok && v != nil {
		u := oneLine(v, 200)
		if u != "" && !reNtfy.MatchString(u) {
			send(w, 400, obj{"error": "Hibás ntfy cím. Formátum: https://ntfy.sh/egyedi-nev"})
			return
		}
		next.NtfyURL = u
	}
	if v, ok := s["services"]; ok && v != nil {
		arr, ok := v.([]any)
		if !ok || len(arr) == 0 || len(arr) > 30 {
			send(w, 400, obj{"error": "Legalább egy szolgáltatás kell."})
			return
		}
		seenID := map[string]bool{}
		list := []Service{}
		for _, it := range arr {
			x, _ := it.(map[string]any)
			if x == nil {
				x = obj{}
			}
			name := oneLine(x["name"], 60)
			minutes, mok := parseInt(x["minutes"])
			var price *int
			if pv := x["price"]; pv != nil && asStr(pv) != "" {
				digits := regexp.MustCompile(`\D`).ReplaceAllString(asStr(pv), "")
				n, err := strconv.Atoi(digits)
				if err != nil || n < 0 || n > 1000000 {
					send(w, 400, obj{"error": "Hibás ár: " + name + "."})
					return
				}
				price = &n
			}
			if name == "" {
				send(w, 400, obj{"error": "Minden szolgáltatásnak legyen neve."})
				return
			}
			if !mok || minutes < 5 || minutes > 240 {
				send(w, 400, obj{"error": "Hibás időtartam: " + name + " (5–240 perc)."})
				return
			}
			id := asStr(x["id"])
			if !reSvcID.MatchString(id) {
				id = slug(name)
			}
			for seenID[id] {
				id = cut(id, 36) + "-" + randHex(1)
			}
			seenID[id] = true
			list = append(list, Service{ID: id, Name: name, Note: oneLine(x["note"], 60), Minutes: minutes, Price: price})
		}
		next.Services = list
	}
	if v, ok := s["notifyEmail"]; ok && v != nil {
		e := oneLine(v, 120)
		if e != "" && !isEmail(e) {
			send(w, 400, obj{"error": "Hibás értesítési e-mail cím."})
			return
		}
		next.NotifyEmail = e
	}
	if v, ok := s["adminUrl"]; ok && v != nil {
		next.AdminURL = oneLine(v, 200)
	}
	if v, ok := s["siteUrl"]; ok && v != nil {
		next.SiteURL = oneLine(v, 200)
	}
	if sm, ok := s["smtp"].(map[string]any); ok {
		if v, ok := sm["user"]; ok && v != nil {
			u := oneLine(v, 120)
			if u != "" && !isEmail(u) {
				send(w, 400, obj{"error": "Hibás Gmail cím."})
				return
			}
			next.SMTP.User = u
		}
		if v := asStr(sm["pass"]); v != "" {
			host := next.SMTP.Host // the server named in this same save counts
			if h, ok := sm["host"]; ok && h != nil && oneLine(h, 120) != "" {
				host = oneLine(h, 120)
			}
			p, msg := cleanAppPassword(v, host)
			if msg != "" {
				send(w, 400, obj{"error": msg})
				return
			}
			next.SMTP.Pass = p
		}
		if truthy(sm["clearPass"]) {
			next.SMTP.Pass = ""
		}
		if v, ok := sm["fromName"]; ok && v != nil {
			next.SMTP.FromName = oneLine(v, 80)
		}
		if v, ok := sm["host"]; ok && v != nil {
			next.SMTP.Host = oneLine(v, 120)
			if next.SMTP.Host == "" {
				next.SMTP.Host = "smtp.gmail.com"
			}
		}
		if v, ok := sm["port"]; ok && v != nil {
			next.SMTP.Port = numIn(v, 1, 65535, 465)
		}
		if v, ok := sm["secure"]; ok && v != nil {
			next.SMTP.Secure = truthy(v)
		}
	}
	*settings = next
	saveSettings()
	send(w, 200, obj{"ok": true, "settings": settingsForClient(), "mailConfigured": smtpConfigured()})
}

// cleanAppPassword removes the spaces Google shows and checks the shape of a Gmail app password
// (16 letters), so a password the browser filled in by itself is refused instead of saved.
func cleanAppPassword(v, host string) (string, string) {
	p := reSpace.ReplaceAllString(v, "")
	if !strings.Contains(strings.ToLower(host), "gmail.com") {
		return cut(p, 200), ""
	}
	p = strings.ToLower(p) // Google's codes are lowercase; the iPad keyboard may capitalise the first letter
	if !reAppPass.MatchString(p) {
		return "", "A Google alkalmazásjelszó pontosan 16 betű (pl. abcd efgh ijkl mnop). Ez " + fmt.Sprint(len([]rune(p))) + " karakter: másold be újra a Google oldaláról."
	}
	return p, ""
}

var reAppPass = regexp.MustCompile(`^[a-z]{16}$`)
