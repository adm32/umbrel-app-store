package main

// Remote login for a Cloudflare Tunnel hostname. Password: scrypt hash in settings.remote
// (same format as the Node.js version). Session: signed cookie "<version>.<expiry>.<hmac>";
// bumping the version logs out every device.

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	cookieName  = "csaszko_remote"
	sessionDays = 60
)

func hashPassword(pw, salt string) string {
	k, err := scryptKey([]byte(pw), []byte(salt), 16384, 8, 1, 64)
	if err != nil {
		return ""
	}
	return hex.EncodeToString(k)
}

// setRemotePassword: callers hold mu.
func setRemotePassword(pw string) {
	salt := randHex(16)
	ver := 1
	if settings.Remote != nil {
		ver = settings.Remote.Ver + 1
	}
	settings.Remote = &Remote{Hash: hashPassword(pw, salt), Salt: salt, Ver: ver, SetAt: isoNow()}
	saveSettings()
}

func checkPassword(pw string) bool {
	mu.Lock()
	if !remoteEnabled() || pw == "" || len([]rune(pw)) > 200 {
		mu.Unlock()
		return false
	}
	salt, want := settings.Remote.Salt, settings.Remote.Hash
	mu.Unlock()
	a, _ := hex.DecodeString(hashPassword(pw, salt))
	b, _ := hex.DecodeString(want)
	return len(a) == len(b) && len(a) > 0 && subtle.ConstantTimeCompare(a, b) == 1
}

func sign(v string) string {
	m := hmac.New(sha256.New, []byte(settings.Secret+"|remote"))
	m.Write([]byte(v))
	return hex.EncodeToString(m.Sum(nil))
}

// makeSession: callers hold mu.
func makeSession() string {
	v := strconv.Itoa(settings.Remote.Ver) + "." + strconv.FormatInt(time.Now().UnixMilli()+sessionDays*86400000, 10)
	return v + "." + sign(v)
}

func validSession(r *http.Request) bool {
	mu.Lock()
	defer mu.Unlock()
	if !remoteEnabled() {
		return false
	}
	c, err := r.Cookie(cookieName)
	if err != nil || c.Value == "" {
		return false
	}
	parts := strings.Split(c.Value, ".")
	if len(parts) != 3 {
		return false
	}
	v := parts[0] + "." + parts[1]
	if !hmac.Equal([]byte(parts[2]), []byte(sign(v))) {
		return false
	}
	ver, err1 := strconv.Atoi(parts[0])
	exp, err2 := strconv.ParseInt(parts[1], 10, 64)
	return err1 == nil && err2 == nil && ver == settings.Remote.Ver && exp > time.Now().UnixMilli()
}

func isHTTPS(r *http.Request) bool {
	return r.Header.Get("X-Forwarded-Proto") == "https" || strings.Contains(r.Header.Get("Cf-Visitor"), `"scheme":"https"`)
}

func sessionCookie(r *http.Request, value string, maxAge int) string {
	// Lax (not Strict): the session must survive opening the app from the link in a notification.
	// Cross-site writes are still blocked by the X-Csaszko header check.
	c := cookieName + "=" + value + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + strconv.Itoa(maxAge)
	if isHTTPS(r) {
		c += "; Secure"
	}
	return c
}

var loginFails = map[string][]int64{}

func tooManyFails(key string, max int, window time.Duration) bool {
	t := time.Now().UnixMilli()
	keep := loginFails[key][:0:0]
	for _, x := range loginFails[key] {
		if t-x < window.Milliseconds() {
			keep = append(keep, x)
		}
	}
	loginFails[key] = keep
	return len(keep) >= max
}
func addFail(key string) { loginFails[key] = append(loginFails[key], time.Now().UnixMilli()) }

var loginFiles = map[string]string{
	"/login": "login.html", "/login.js": "login.js", "/admin.css": "admin.css", "/icon.svg": "icon.svg",
	"/icon-192.png": "icon-192.png", "/icon-512.png": "icon-512.png", "/manifest.webmanifest": "manifest.webmanifest",
}

func remoteAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Strict-Transport-Security", "max-age=15552000")
	p := strings.TrimRight(r.URL.Path, "/")
	if p == "" {
		p = "/"
	}

	if p == "/api/login-info" && r.Method == "GET" {
		mu.Lock()
		en := remoteEnabled()
		mu.Unlock()
		send(w, 200, obj{"enabled": en})
		return
	}
	if p == "/api/login" && r.Method == "POST" {
		if r.Header.Get("X-Csaszko") != "1" {
			send(w, 403, obj{"error": "forbidden"})
			return
		}
		ip := clientIP(r)
		mu.Lock()
		en := remoteEnabled()
		blocked := tooManyFails("ip:"+ip, 8, 15*time.Minute) || tooManyFails("all", 40, time.Hour)
		mu.Unlock()
		if !en {
			send(w, 403, obj{"error": "A távoli belépés nincs bekapcsolva. Az Umbrelen, a Beállításoknál lehet bekapcsolni."})
			return
		}
		if blocked {
			send(w, 429, obj{"error": "Túl sok sikertelen próbálkozás. Próbáld újra 15 perc múlva."})
			return
		}
		body, _, err := readBody(w, r, 4096)
		if err != nil {
			send(w, 400, obj{"error": "invalid"})
			return
		}
		pw, _ := body["password"].(string)
		if !checkPassword(pw) {
			mu.Lock()
			addFail("ip:" + ip)
			addFail("all")
			mu.Unlock()
			time.Sleep(600 * time.Millisecond)
			send(w, 401, obj{"error": "Hibás jelszó."})
			return
		}
		mu.Lock()
		delete(loginFails, "ip:"+ip)
		s := makeSession()
		mu.Unlock()
		w.Header().Add("Set-Cookie", sessionCookie(r, s, sessionDays*86400))
		send(w, 200, obj{"ok": true})
		return
	}
	if p == "/api/logout" && r.Method == "POST" {
		if r.Header.Get("X-Csaszko") != "1" {
			send(w, 403, obj{"error": "forbidden"})
			return
		}
		w.Header().Add("Set-Cookie", sessionCookie(r, "", 0))
		send(w, 200, obj{"ok": true})
		return
	}
	valid := validSession(r)
	if f, ok := loginFiles[p]; ok && (r.Method == "GET" || r.Method == "HEAD") && (p != "/login" || !valid) {
		serveStatic(w, r, "/"+f)
		return
	}
	if !valid {
		if strings.HasPrefix(p, "/api/") {
			send(w, 401, obj{"error": "Jelentkezz be újra.", "login": true})
			return
		}
		w.Header().Set("Location", "/login")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(302)
		return
	}
	if p == "/login" {
		w.Header().Set("Location", "/")
		w.WriteHeader(302)
		return
	}
	adminAPI(w, r, true)
}
