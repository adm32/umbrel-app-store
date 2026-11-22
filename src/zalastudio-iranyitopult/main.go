// Zala Studio Irányítópult – requests (leads) and visitor statistics for zalastudio.hu (formerly admcore.hu).
//
// A single static Go program (like the Vadvirág apps): small, fast, and it uses a few MB of memory.
// The web interface is compiled into the program.
//
// Port 8080 (Umbrel app proxy): the dashboard, protected by its own password.
// Port 9097 (internal, other containers only): POST /ingest – the website hands over new requests here.
//
// Data in DATA_DIR (/data):
//
//	jelszo.json   salted PBKDF2-SHA256 hash of the password + session secret
//	leads.json    the requests, with status, notes and history
//	settings.json notifications, the launch-discount counter and the Stripe keys
//
// Payments (Stripe) live in pay.go.
package main

import (
	"embed"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
	_ "time/tzdata"
	"unicode/utf8"
)

const version = "2.1.5"

//go:embed web
var webFS embed.FS

var (
	dataDir    = env("DATA_DIR", "/data")
	port       = env("PORT", "8080")
	ingestPort = env("INGEST_PORT", "9097")
	siteURL    = strings.TrimRight(env("SITE_INTERNAL", "http://adam-admcore_web_1:9095"), "/")
	httpc      = &http.Client{Timeout: 12 * time.Second}
)

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

// ---------- main handler ----------

func handler(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if e := recover(); e != nil {
			log.Print("panic: ", e)
			sendJSON(w, 500, map[string]any{"ok": false, "error": "Szerverhiba."})
		}
	}()
	secHeaders(w)
	p := r.URL.Path
	if p == "/healthz" {
		io.WriteString(w, "ok")
		return
	}
	if (r.Method == "GET" || r.Method == "HEAD") && serveStatic(w, r, p) {
		return
	}
	if p == "/setup" {
		if hasPassword() {
			redirect(w, "/login")
			return
		}
		if fromInternet(r) {
			page(w, r, 403, "setup.html", map[string]string{"error": "Biztonsági okból az első jelszót otthonról kell beállítani: nyisd meg az appot az Umbrel kezdőképernyőjéről vagy Tailscale-en keresztül.", "disabled": "disabled"})
			return
		}
		if r.Method == "POST" {
			f := formValues(r)
			a, b := f.Get("jelszo"), f.Get("jelszo2")
			if utf8.RuneCountInString(a) < 8 {
				page(w, r, 422, "setup.html", map[string]string{"error": "A jelszó legalább 8 karakter legyen."})
				return
			}
			if a != b {
				page(w, r, 422, "setup.html", map[string]string{"error": "A két jelszó nem egyezik."})
				return
			}
			if err := setPassword(a); err != nil {
				page(w, r, 500, "setup.html", map[string]string{"error": "Nem sikerült menteni. Ellenőrizd az app adatmappáját."})
				return
			}
			setSession(w, r)
			redirect(w, "/")
			return
		}
		page(w, r, 200, "setup.html", nil)
		return
	}
	if !hasPassword() {
		if strings.HasPrefix(p, "/api/") {
			sendJSON(w, 401, map[string]any{"ok": false})
		} else {
			redirect(w, "/setup")
		}
		return
	}
	if p == "/login" {
		if r.Method == "POST" {
			ip := clientIP(r)
			if !loginAllowed(ip) {
				page(w, r, 429, "login.html", map[string]string{"error": "Túl sok próbálkozás. Várj 15 percet."})
				return
			}
			if !checkPassword(formValues(r).Get("jelszo")) {
				failLogin(ip)
				time.Sleep(600 * time.Millisecond)
				page(w, r, 200, "login.html", map[string]string{"error": "Hibás jelszó."})
				return
			}
			failMu.Lock()
			delete(fails, ip)
			failMu.Unlock()
			setSession(w, r)
			redirect(w, "/")
			return
		}
		if authed(r) {
			redirect(w, "/")
			return
		}
		page(w, r, 200, "login.html", nil)
		return
	}
	if p == "/logout" && r.Method == "POST" {
		http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
		redirect(w, "/login")
		return
	}
	if !authed(r) {
		if strings.HasPrefix(p, "/api/") {
			sendJSON(w, 401, map[string]any{"ok": false, "error": "Jelentkezz be újra."})
		} else {
			redirect(w, "/login")
		}
		return
	}
	if strings.HasPrefix(p, "/api/") {
		api(w, r, p)
		return
	}
	if p == "/" || p == "/index.html" {
		page(w, r, 200, "index.html", nil)
		return
	}
	http.NotFound(w, r)
}
