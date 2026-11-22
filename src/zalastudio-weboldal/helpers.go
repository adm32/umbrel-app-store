// Zala Studio weboldal – small helpers: JSON files in DATA_DIR, settings, client IP, text cleaning,
// security headers, JSON answers and the rate limiter.

package main

import (
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	_ "time/tzdata"
	"unicode/utf8"
)

// ---------- small helpers ----------

func readJSON(name string, v any) bool {
	b, err := os.ReadFile(filepath.Join(dataDir, name))
	return err == nil && json.Unmarshal(b, v) == nil
}
func writeJSON(name string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	f := filepath.Join(dataDir, name)
	if err := os.WriteFile(f+".tmp", b, 0o600); err != nil {
		return err
	}
	return os.Rename(f+".tmp", f)
}
func setting(envName, file string) string {
	if v := os.Getenv(envName); v != "" {
		return strings.TrimSpace(v)
	}
	b, _ := os.ReadFile(filepath.Join(dataDir, file))
	return strings.TrimSpace(string(b))
}
func dayKey(t time.Time) string { return t.In(budapest).Format("2006-01-02") }
func clientIP(r *http.Request) string {
	if v := r.Header.Get("Cf-Connecting-Ip"); v != "" {
		return v
	}
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		return strings.TrimSpace(strings.Split(v, ",")[0])
	}
	h, _, _ := net.SplitHostPort(r.RemoteAddr)
	return h
}
func cut(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	return string([]rune(s)[:max])
}

var ctrl = regexp.MustCompile("[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]")
var spaces = regexp.MustCompile(`[ \t]+`)

func clean(v any, max int) string {
	s, _ := v.(string)
	s = strings.ToValidUTF8(s, "")
	s = spaces.ReplaceAllString(ctrl.ReplaceAllString(s, ""), " ")
	return cut(strings.TrimSpace(s), max)
}
func secHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'")
}
func sendJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if w.Header().Get("Cache-Control") == "" {
		w.Header().Set("Cache-Control", "no-store")
	}
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

// limiter: at most max hits per window per key.
type limiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	m      map[string][]time.Time
}

func newLimiter(max int, window time.Duration) *limiter {
	l := &limiter{max: max, window: window, m: map[string][]time.Time{}}
	go func() {
		for range time.Tick(window) {
			l.mu.Lock()
			for k, v := range l.m {
				if len(v) == 0 || time.Since(v[len(v)-1]) > l.window {
					delete(l.m, k)
				}
			}
			l.mu.Unlock()
		}
	}()
	return l
}
func (l *limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	var keep []time.Time
	for _, t := range l.m[key] {
		if time.Since(t) < l.window {
			keep = append(keep, t)
		}
	}
	if len(keep) >= l.max {
		l.m[key] = keep
		return false
	}
	l.m[key] = append(keep, time.Now())
	return true
}
