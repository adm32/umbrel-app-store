// Zala Studio Irányítópult – login: password setup, PBKDF2 hash, sessions, rate limit.

package main

import (
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	_ "time/tzdata"
)

// ---------- auth ----------

const cookieName = "core_dash"
const maxAge = 180 * 24 * 3600

func hashPw(pw, salt string) string {
	k, _ := pbkdf2.Key(sha256.New, pw, []byte(salt), 210000, 32)
	return hex.EncodeToString(k)
}
func hasPassword() bool {
	mu.Lock()
	defer mu.Unlock()
	return auth.Hash != "" && auth.Algo == "pbkdf2"
}
func setPassword(pw string) error {
	a := Auth{Algo: "pbkdf2", Salt: randHex(16), Secret: randHex(32), Set: nowISO()}
	a.Hash = hashPw(pw, a.Salt)
	if err := writeJSON("jelszo.json", a); err != nil {
		return err
	}
	mu.Lock()
	auth = a
	mu.Unlock()
	return nil
}
func checkPassword(pw string) bool {
	mu.Lock()
	a := auth
	mu.Unlock()
	if a.Hash == "" || a.Algo != "pbkdf2" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(hashPw(pw, a.Salt)), []byte(a.Hash)) == 1
}
func sign(ts string) string {
	mu.Lock()
	sec := auth.Secret
	mu.Unlock()
	m := hmac.New(sha256.New, []byte(sec))
	m.Write([]byte("core-dash|" + ts))
	return hex.EncodeToString(m.Sum(nil))
}
func authed(r *http.Request) bool {
	if !hasPassword() {
		return false
	}
	c, err := r.Cookie(cookieName)
	if err != nil {
		return false
	}
	ts, mac, ok := strings.Cut(c.Value, ".")
	n, err := strconv.ParseInt(ts, 10, 64)
	if !ok || err != nil || time.Now().Unix()-n > maxAge {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(sign(ts)), []byte(mac)) == 1
}
func secure(r *http.Request) bool {
	return r.Header.Get("X-Forwarded-Proto") == "https" || r.Header.Get("Cf-Connecting-Ip") != ""
}
func setSession(w http.ResponseWriter, r *http.Request) {
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: ts + "." + sign(ts), Path: "/", MaxAge: maxAge, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: secure(r)})
}
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

// Requests through Cloudflare carry Cf-Connecting-Ip. The first password may only be set from home.
func fromInternet(r *http.Request) bool { return r.Header.Get("Cf-Connecting-Ip") != "" }

var (
	failMu sync.Mutex
	fails  = map[string][]time.Time{}
)

func loginAllowed(ip string) bool {
	failMu.Lock()
	defer failMu.Unlock()
	total, mine := 0, 0
	for k, l := range fails {
		var keep []time.Time
		for _, t := range l {
			if time.Since(t) < 15*time.Minute {
				keep = append(keep, t)
			}
		}
		if len(keep) == 0 {
			delete(fails, k)
			continue
		}
		fails[k] = keep
		total += len(keep)
		if k == ip {
			mine = len(keep)
		}
	}
	return mine < 8 && total < 40
}
func failLogin(ip string) { failMu.Lock(); fails[ip] = append(fails[ip], time.Now()); failMu.Unlock() }
