package main

import (
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var httpc = &http.Client{Timeout: 8 * time.Second}

func smtpConfigured() bool {
	return settings.SMTP.Host != "" && settings.SMTP.User != "" && settings.SMTP.Pass != ""
}

func publicServices() []Service {
	out := make([]Service, len(settings.Services))
	copy(out, settings.Services)
	return out
}

func publicBooking(b *Booking) obj {
	return obj{"id": b.ID, "date": b.Date, "time": b.Time, "minutes": b.Minutes, "status": b.Status, "service": b.Service.Hu}
}

/* ------------------------------------------------------- notifications */

// ntfy sends a push notification (https://ntfy.sh); the ntfy app on the phone subscribes to the same topic.
func ntfy(topicURL, title, message, click string) bool {
	u, err := url.Parse(topicURL)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return false
	}
	q := u.Query()
	// every ntfy parameter may be a query parameter, which keeps the UTF-8 title intact
	q.Set("title", title)
	q.Set("tags", "scissors")
	if click != "" {
		q.Set("click", click)
	}
	u.RawQuery = q.Encode()
	req, _ := http.NewRequest("POST", u.String(), strings.NewReader(message))
	req.Header.Set("Content-Type", "text/plain; charset=utf-8")
	res, err := httpc.Do(req)
	if err != nil {
		log.Print("[ntfy] failed: ", err)
		return false
	}
	res.Body.Close()
	return res.StatusCode < 300
}

// notifyAdmin tells Bence about a new web booking. Runs in its own goroutine; b is a copy.
func notifyAdmin(b Booking) {
	mu.Lock()
	s := *settings
	mu.Unlock()
	when := strings.ReplaceAll(b.Date, "-", ".") + ". " + b.Time
	if s.NtfyURL != "" {
		title := "Új időpontkérés: "
		if b.Status == "confirmed" {
			title = "Új foglalás: "
		}
		ntfy(s.NtfyURL, title+when, b.Name+" · "+b.Service.Hu+" · "+b.Phone, s.AdminURL)
	}
	if s.SMTP.Host == "" || s.SMTP.User == "" || s.SMTP.Pass == "" || s.NotifyEmail == "" {
		return
	}
	m := adminNotification(&b, s.AdminURL)
	m.From, m.FromName, m.To, m.ReplyTo = s.SMTP.User, "Csaszko · Foglalás", s.NotifyEmail, b.Email
	if err := sendMail(s.SMTP, m); err != nil {
		log.Print("[mail] notification failed: ", err)
	}
}

// sendCustomer e-mails the guest about booking id and records the result on the booking.
// Called without mu held.
func sendCustomer(id, kind, message string) *MailRec {
	mu.Lock()
	var b *Booking
	for _, x := range db.Bookings {
		if x.ID == id {
			b = x
		}
	}
	if b == nil {
		mu.Unlock()
		return nil
	}
	cp := *b
	s := *settings
	mu.Unlock()

	rec := &MailRec{Kind: kind, At: isoNow()}
	m := customerEmail(kind, &cp, message, s.SiteURL)
	reply := s.NotifyEmail
	if reply == "" {
		reply = s.SMTP.User
	}
	m.From, m.FromName, m.To, m.ReplyTo = s.SMTP.User, s.SMTP.FromName, cp.Email, reply
	if err := sendMail(s.SMTP, m); err != nil {
		rec.Error = explainMail(err)
		log.Printf("[mail] %s → %s failed: %v", kind, cp.Email, err)
	} else {
		rec.OK = true
	}
	mu.Lock()
	b.Mail = rec
	saveDB()
	mu.Unlock()
	return rec
}

/* ============================================================ PUBLIC API */

func publicAPI(w http.ResponseWriter, r *http.Request) {
	p := strings.TrimRight(r.URL.Path, "/")
	q := r.URL.Query()

	switch {
	case r.Method == "GET" && p == "/api/health":
		send(w, 200, obj{"ok": true})
		return

	case r.Method == "GET" && p == "/api/info":
		mu.Lock()
		t := now()
		out := obj{"hours": settings.Hours, "stepMinutes": settings.StepMinutes, "horizonDays": settings.HorizonDays,
			"autoConfirm": settings.AutoConfirm, "sameDay": settings.SameDay, "services": publicServices(), "today": t.date, "nowMin": t.min}
		mu.Unlock()
		send(w, 200, out)
		return

	case r.Method == "GET" && p == "/api/availability":
		mu.Lock()
		defer mu.Unlock()
		if limited("av:"+clientIP(r), 120, 10*time.Minute, false) {
			send(w, 429, obj{"error": "rate"})
			return
		}
		t := now()
		from := q.Get("from")
		if !isDate(from) {
			from = t.date
		}
		days, ok := parseInt(q.Get("days"))
		if !ok || days == 0 {
			days = 14
		}
		days = max(1, min(62, days))
		svc := serviceByID(q.Get("service"))
		if svc == nil {
			send(w, 400, obj{"error": "service"})
			return
		}
		out := map[string][]string{}
		for i := 0; i < days; i++ {
			d := addDays(from, i)
			if s := freeStarts(d, svc.Minutes, false, ""); len(s) > 0 {
				out[d] = s
			}
		}
		send(w, 200, obj{"today": t.date, "lastDay": addDays(t.date, settings.HorizonDays), "hours": settings.Hours, "sameDay": settings.SameDay, "days": out})
		return

	case r.Method == "POST" && p == "/api/hit":
		mu.Lock()
		lim := limited("hit:"+clientIP(r), 300, time.Hour, false)
		mu.Unlock()
		if !lim {
			body, _, err := readBody(w, r, 2048)
			if err != nil {
				body = obj{}
			}
			mu.Lock()
			recordHit(r, body)
			mu.Unlock()
		}
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(204)
		return

	case r.Method == "POST" && p == "/api/bookings":
		createWebBooking(w, r)
		return

	case r.Method == "GET" && p == "/api/instagram":
		igPublic(w)
		return

	case (r.Method == "GET" || r.Method == "HEAD") && strings.HasPrefix(p, "/api/ig/"):
		igImage(w, r, strings.TrimPrefix(p, "/api/ig/"))
		return
	}
	send(w, 404, obj{"error": "not found"})
}

func createWebBooking(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	body, code, err := readBody(w, r, 16384)
	if err != nil {
		send(w, code, obj{"error": "invalid"})
		return
	}
	// spam traps: the hidden field must stay empty, and a human needs a few seconds for the form
	if el := num(body["elapsed"]); str(body["website"], 200) != "" || (el > 0 && el < 2500) {
		send(w, 200, obj{"ok": true, "id": "x"})
		return
	}

	mu.Lock()
	// mobile networks put many phones behind one address, so the per-address limits are generous
	if limited("ip:"+ip, 20, time.Hour, false) || limited("ok:"+ip, 8, time.Hour, true) || limited("all", 40, time.Hour, true) {
		mu.Unlock()
		send(w, 429, obj{"error": "rate"})
		return
	}
	svc := serviceByID(str(body["service"], 40))
	status := "pending"
	if settings.AutoConfirm {
		status = "confirmed"
	}
	b := &Booking{
		ID: randHex(6), Status: status, Source: "web",
		Date: str(body["date"], 10), Time: str(body["time"], 5),
		Note: str(body["note"], 500), Name: oneLine(body["name"], 80), Phone: oneLine(body["phone"], 30),
		Email: strings.ToLower(oneLine(body["email"], 120)), CreatedAt: isoNow(),
	}
	if svc != nil {
		b.Minutes = svc.Minutes
		b.Service = BService{ID: svc.ID, Hu: svc.Name, Price: svc.Price}
	}
	fields := obj{}
	if svc == nil {
		fields["service"] = 1
	}
	if !isDate(b.Date) {
		fields["date"] = 1
	}
	if !isTime(b.Time) {
		fields["time"] = 1
	}
	if len([]rune(b.Name)) < 2 {
		fields["name"] = 1
	}
	if !isPhone(b.Phone) {
		fields["phone"] = 1
	}
	if !isEmail(b.Email) { // the confirmation goes to this address
		fields["email"] = 1
	}
	if len(fields) > 0 {
		mu.Unlock()
		send(w, 400, obj{"error": "invalid", "fields": fields})
		return
	}
	// the final check and the save happen under one lock: two people can never get the same time
	if !contains(freeStarts(b.Date, b.Minutes, false, ""), b.Time) {
		mu.Unlock()
		send(w, 409, obj{"error": "taken"})
		return
	}
	db.Bookings = append(db.Bookings, b)
	saveDB()
	limited("ok:"+ip, 8, time.Hour, false)
	limited("all", 40, time.Hour, false)
	cp := *b
	mailNow := b.Status == "confirmed" && b.Email != "" && smtpConfigured()
	mu.Unlock()

	send(w, 201, obj{"ok": true, "booking": publicBooking(&cp)})
	go notifyAdmin(cp)
	if mailNow {
		go sendCustomer(cp.ID, "confirm", "")
	}
}
