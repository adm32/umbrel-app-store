// Szikra – the password of the public address (e.g. szikra.admcore.hu through a Cloudflare Tunnel).
//
// Two listeners: PORT (8080, behind Umbrel's own login through app_proxy) needs no password here;
// REMOTE_PORT (8082, published as 4781) asks for the app's password. Only the Umbrel address can
// set or change it, so nobody on the internet can claim the app before Ádám does.
// Password: scrypt hash in DATA_DIR/auth.json. Session: signed cookie "<ver>.<expiry>.<hmac>";
// a new password bumps ver and logs out every device.
package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	cookieName  = "szikra_session"
	sessionDays = 180
	minPassword = 6
)

type authFile struct {
	Hash   string `json:"hash,omitempty"`
	Salt   string `json:"salt,omitempty"`
	Ver    int    `json:"ver"`
	Secret string `json:"secret"`
	SetAt  string `json:"setAt,omitempty"`
}

type Auth struct {
	mu    sync.Mutex
	path  string
	a     authFile
	fails map[string][]int64
}

func randHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func openAuth(dir string) (*Auth, error) {
	au := &Auth{path: filepath.Join(dir, "auth.json"), fails: map[string][]int64{}}
	b, err := os.ReadFile(au.path)
	switch {
	case err == nil:
		if err := json.Unmarshal(b, &au.a); err != nil {
			return nil, err
		}
	case !os.IsNotExist(err):
		return nil, err
	}
	if au.a.Secret == "" {
		au.a.Secret = randHex(32)
		if err := au.saveLocked(); err != nil {
			return nil, err
		}
	}
	return au, nil
}

func (au *Auth) saveLocked() error {
	b, _ := json.MarshalIndent(au.a, "", " ")
	if err := os.WriteFile(au.path+".tmp", b, 0o600); err != nil {
		return err
	}
	return os.Rename(au.path+".tmp", au.path)
}

func (au *Auth) enabled() bool {
	au.mu.Lock()
	defer au.mu.Unlock()
	return au.a.Hash != ""
}

func hashPassword(pw, salt string) string {
	k, err := scryptKey([]byte(pw), []byte(salt), 16384, 8, 1, 64)
	if err != nil {
		return ""
	}
	return hex.EncodeToString(k)
}

func (au *Auth) setPassword(pw string) error {
	salt := randHex(16)
	h := hashPassword(pw, salt)
	au.mu.Lock()
	defer au.mu.Unlock()
	au.a.Hash, au.a.Salt, au.a.SetAt = h, salt, time.Now().Format(time.RFC3339)
	au.a.Ver++
	return au.saveLocked()
}

func (au *Auth) check(pw string) bool {
	au.mu.Lock()
	salt, want := au.a.Salt, au.a.Hash
	au.mu.Unlock()
	if want == "" || pw == "" || utf8.RuneCountInString(pw) > 200 {
		return false
	}
	a, _ := hex.DecodeString(hashPassword(pw, salt))
	b, _ := hex.DecodeString(want)
	return len(a) == len(b) && len(a) > 0 && subtle.ConstantTimeCompare(a, b) == 1
}

func (au *Auth) sign(v string) string {
	m := hmac.New(sha256.New, []byte(au.a.Secret+"|session"))
	m.Write([]byte(v))
	return hex.EncodeToString(m.Sum(nil))
}

func (au *Auth) newSession() string {
	au.mu.Lock()
	defer au.mu.Unlock()
	v := strconv.Itoa(au.a.Ver) + "." + strconv.FormatInt(time.Now().Add(sessionDays*24*time.Hour).Unix(), 10)
	return v + "." + au.sign(v)
}

func (au *Auth) valid(r *http.Request) bool {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return false
	}
	parts := strings.Split(c.Value, ".")
	if len(parts) != 3 {
		return false
	}
	au.mu.Lock()
	defer au.mu.Unlock()
	if au.a.Hash == "" {
		return false
	}
	v := parts[0] + "." + parts[1]
	if !hmac.Equal([]byte(parts[2]), []byte(au.sign(v))) {
		return false
	}
	ver, err1 := strconv.Atoi(parts[0])
	exp, err2 := strconv.ParseInt(parts[1], 10, 64)
	return err1 == nil && err2 == nil && ver == au.a.Ver && exp > time.Now().Unix()
}

// tooMany reports whether key failed max times within window (and forgets older failures).
func (au *Auth) tooMany(key string, max int, window time.Duration) bool {
	au.mu.Lock()
	defer au.mu.Unlock()
	now := time.Now().UnixMilli()
	keep := au.fails[key][:0:0]
	for _, t := range au.fails[key] {
		if now-t < window.Milliseconds() {
			keep = append(keep, t)
		}
	}
	if len(keep) == 0 {
		delete(au.fails, key)
	} else {
		au.fails[key] = keep
	}
	return len(keep) >= max
}

func (au *Auth) fail(key string) {
	au.mu.Lock()
	au.fails[key] = append(au.fails[key], time.Now().UnixMilli())
	au.mu.Unlock()
}

func isHTTPS(r *http.Request) bool {
	return r.Header.Get("X-Forwarded-Proto") == "https" || strings.Contains(r.Header.Get("Cf-Visitor"), `"scheme":"https"`)
}

func sessionCookie(r *http.Request, value string, maxAge int) string {
	c := cookieName + "=" + value + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + strconv.Itoa(maxAge)
	if isHTTPS(r) {
		c += "; Secure"
	}
	return c
}

func clientIP(r *http.Request) string {
	if ip := r.Header.Get("Cf-Connecting-Ip"); ip != "" {
		return ip
	}
	if xf := r.Header.Get("X-Forwarded-For"); xf != "" {
		return strings.TrimSpace(strings.Split(xf, ",")[0])
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	return host
}

func authJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

// guard wraps the whole app. Writes must carry the X-Szikra header (a page on another site can't
// send it). On the remote listener every /api/ call except the login ones needs a session.
func (s *server) guard(next http.Handler, remote bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if remote && isHTTPS(r) {
			w.Header().Set("Strict-Transport-Security", "max-age=15552000")
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Header.Get("X-Szikra") != "1" {
			authJSON(w, 403, map[string]string{"error": "forbidden"})
			return
		}
		p := r.URL.Path
		switch {
		case p == "/api/auth" && r.Method == http.MethodGet:
			authJSON(w, 200, map[string]bool{"remote": remote, "enabled": s.auth.enabled(), "loggedIn": !remote || s.auth.valid(r)})
			return
		case p == "/api/login" && r.Method == http.MethodPost:
			s.login(w, r)
			return
		case p == "/api/logout" && r.Method == http.MethodPost:
			w.Header().Add("Set-Cookie", sessionCookie(r, "", 0))
			authJSON(w, 200, map[string]bool{"ok": true})
			return
		case p == "/api/password" && r.Method == http.MethodPost:
			if remote {
				authJSON(w, 403, map[string]string{"error": "Jelszót csak az Umbrelen (Tailscale-címen) lehet beállítani."})
				return
			}
			s.setPassword(w, r)
			return
		}
		if remote && strings.HasPrefix(p, "/api/") && !s.auth.valid(r) {
			authJSON(w, 401, map[string]string{"error": "login"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) login(w http.ResponseWriter, r *http.Request) {
	if !s.auth.enabled() {
		authJSON(w, 403, map[string]string{"error": "Még nincs jelszó. Nyisd meg a Szikrát az Umbrelen, és a profiloldalon adj meg egyet."})
		return
	}
	ip := clientIP(r)
	if s.auth.tooMany("ip:"+ip, 8, 15*time.Minute) || s.auth.tooMany("all", 40, time.Hour) {
		authJSON(w, 429, map[string]string{"error": "Túl sok rossz próbálkozás. Próbáld újra 15 perc múlva."})
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if json.NewDecoder(r.Body).Decode(&req) != nil {
		authJSON(w, 400, map[string]string{"error": "invalid"})
		return
	}
	if !s.auth.check(req.Password) {
		s.auth.fail("ip:" + ip)
		s.auth.fail("all")
		time.Sleep(400 * time.Millisecond)
		authJSON(w, 401, map[string]string{"error": "Nem jó a jelszó."})
		return
	}
	w.Header().Add("Set-Cookie", sessionCookie(r, s.auth.newSession(), sessionDays*86400))
	authJSON(w, 200, map[string]bool{"ok": true})
}

func (s *server) setPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if json.NewDecoder(r.Body).Decode(&req) != nil {
		authJSON(w, 400, map[string]string{"error": "invalid"})
		return
	}
	if n := utf8.RuneCountInString(req.Password); n < minPassword || n > 200 {
		authJSON(w, 400, map[string]string{"error": "A jelszó legyen legalább 6 karakter."})
		return
	}
	if err := s.auth.setPassword(req.Password); err != nil {
		authJSON(w, 500, map[string]string{"error": "Nem sikerült menteni."})
		return
	}
	authJSON(w, 200, map[string]bool{"ok": true})
}
