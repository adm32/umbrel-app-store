// Zala Studio Irányítópult – HTTP helpers: JSON answers, gzip, security headers, request reading.

package main

import (
	"compress/gzip"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata"
)

// ---------- http helpers ----------

func secHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
	h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'")
}
func sendJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
func redirect(w http.ResponseWriter, to string) {
	w.Header().Set("Location", to)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(303)
}

var tplVar = regexp.MustCompile(`\{\{\w+\}\}`)

func page(w http.ResponseWriter, r *http.Request, code int, file string, vars map[string]string) {
	b, _ := webFS.ReadFile("web/" + file)
	s := string(b)
	// Script and style links carry the running version, so a phone never mixes a new page with an old cached script.
	s = strings.ReplaceAll(s, "{{v}}", version+"-"+strconv.FormatInt(startTime.Unix(), 36))
	esc := strings.NewReplacer("<", "&lt;", ">", "&gt;", "&", "&amp;", `"`, "&quot;")
	for k, v := range vars {
		s = strings.ReplaceAll(s, "{{"+k+"}}", esc.Replace(v))
	}
	s = tplVar.ReplaceAllString(s, "")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if code == 200 && strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Add("Vary", "Accept-Encoding")
		zw := gzip.NewWriter(w)
		io.WriteString(zw, s)
		zw.Close()
		return
	}
	w.WriteHeader(code)
	io.WriteString(w, s)
}
func readBody(r *http.Request, max int64, v any) bool {
	b, err := io.ReadAll(io.LimitReader(r.Body, max+1))
	if err != nil || int64(len(b)) > max {
		return false
	}
	return json.Unmarshal(b, v) == nil
}
func formValues(r *http.Request) url.Values {
	b, _ := io.ReadAll(io.LimitReader(r.Body, 4000))
	v, _ := url.ParseQuery(string(b))
	return v
}

var startTime = time.Now()

func serveStatic(w http.ResponseWriter, r *http.Request, p string) bool {
	if strings.HasSuffix(p, ".html") || p == "/" {
		return false
	}
	name := "web" + path.Clean(p)
	data, err := webFS.ReadFile(name)
	if err != nil { // missing, or a folder
		return false
	}
	ct := mime.TypeByExtension(path.Ext(p))
	switch path.Ext(p) {
	case ".webmanifest":
		ct = "application/manifest+json"
	case ".woff":
		ct = "font/woff"
	case ".woff2":
		ct = "font/woff2"
	case ".js":
		ct = "text/javascript; charset=utf-8"
	case ".css":
		ct = "text/css; charset=utf-8"
	}
	// Fonts never change; scripts and styles are asked for as name?v=<version>, so their address
	// changes with every update. Both may stay in the browser for good. The rest is revalidated.
	cache := "no-cache"
	if strings.HasPrefix(p, "/fonts/") || r.URL.Query().Get("v") != "" {
		cache = "public, max-age=31536000, immutable"
	}
	sendStatic(w, r, name, data, ct, cache)
	return true
}

func csvCell(s string) string {
	if s != "" && strings.ContainsAny(s[:1], "=+-@\t\r") {
		return "'" + s
	}
	return s
}

func publicSettings() Settings {
	s := settings
	if s.NtfyToken != "" {
		s.NtfyToken = "••••••"
	}
	s.StripeKey = maskKey(s.StripeKey)
	s.StripeWebhook = maskKey(s.StripeWebhook)
	return s
}
func maskKey(k string) string {
	if k == "" {
		return ""
	}
	pre := k
	if i := strings.LastIndex(k[:min(len(k), 9)], "_"); i > 0 {
		pre = k[:i+1]
	}
	return pre + "••••" + k[max(0, len(k)-4):]
}

// call with mu held
func stripeInfo() map[string]any {
	hookMu.Lock()
	h := hookStatus
	hookMu.Unlock()
	return map[string]any{"keySet": settings.StripeKey != "", "hookSet": settings.StripeWebhook != "", "live": strings.Contains(settings.StripeKey, "_live_"), "hook": h, "vatNote": vatNote(settings.VatMode)}
}
func findLead(id string) *Lead {
	for _, l := range leads {
		if l.ID == id {
			return l
		}
	}
	return nil
}
