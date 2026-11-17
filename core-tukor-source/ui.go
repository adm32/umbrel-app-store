package main

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

//go:embed www/index.html
var indexHTML []byte

//go:embed www/icon.svg
var iconSVG []byte

func (n *Node) serveUI() {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Write(indexHTML)
	})
	mux.HandleFunc("/icon.svg", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/svg+xml")
		w.Header().Set("Cache-Control", "max-age=86400")
		w.Write(iconSVG)
	})
	mux.HandleFunc("/ui/", n.uiAPI)
	srv := &http.Server{Addr: ":" + uiPort, Handler: mux, ReadHeaderTimeout: 20 * time.Second, ErrorLog: log.New(io.Discard, "", 0)}
	for {
		err := srv.ListenAndServe()
		n.event("bad", "A kezelőfelület nem indult el: "+err.Error())
		time.Sleep(30 * time.Second)
	}
}

func hashPass(pw, salt string) string {
	k, _ := pbkdf2.Key(sha256.New, pw, []byte(salt), 210000, 32)
	return hex.EncodeToString(k)
}

func token() string {
	b := make([]byte, 24)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func (n *Node) loggedIn(r *http.Request) bool {
	c, err := r.Cookie("tukor")
	if err != nil {
		return false
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	exp, ok := n.sessions[c.Value]
	return ok && time.Now().Before(exp)
}

func (n *Node) startSession(w http.ResponseWriter) {
	t := token()
	n.mu.Lock()
	n.sessions[t] = time.Now().Add(30 * 24 * time.Hour)
	n.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "tukor", Value: t, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: 30 * 24 * 3600})
}

type uiErr struct{ msg string }

func fail(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func (n *Node) uiAPI(w http.ResponseWriter, r *http.Request) {
	act := strings.TrimPrefix(r.URL.Path, "/ui/")
	if r.Method == http.MethodPost && r.Header.Get("X-Tukor") != "1" {
		fail(w, 403, "Hiányzó fejléc.")
		return
	}
	var body map[string]any
	if r.Method == http.MethodPost {
		json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body)
	}
	str := func(k string) string { s, _ := body[k].(string); return strings.TrimSpace(s) }

	n.mu.Lock()
	role := n.cfg.Role
	n.mu.Unlock()

	switch act {
	case "status":
		writeJSON(w, n.status(n.loggedIn(r)))
		return
	case "setup":
		if role != "" {
			fail(w, 409, "Már be van állítva.")
			return
		}
		rl, pw := str("role"), str("password")
		if rl != "primary" && rl != "standby" {
			fail(w, 400, "Válaszd ki, melyik gép ez.")
			return
		}
		if len([]rune(pw)) < 8 {
			fail(w, 400, "A jelszó legyen legalább 8 karakter.")
			return
		}
		salt := token()
		n.mu.Lock()
		n.cfg = Config{Role: rl, Salt: salt, PassHash: hashPass(pw, salt), Auto: true, Apps: map[string]string{}}
		if rl == "primary" {
			n.cfg.Secret = randomSecret()
		} else {
			n.st.Mode = "forward"
		}
		n.mu.Unlock()
		n.save()
		n.refreshRoutes()
		n.startSession(w)
		if rl == "primary" {
			n.event("ok", "Beállítva: ez a fő szerver.")
		} else {
			n.event("ok", "Beállítva: ez a tartalék szerver. Írd be a fő szerver párosító kódját.")
		}
		writeJSON(w, map[string]bool{"ok": true})
		return
	case "login":
		pw := str("password")
		n.mu.Lock()
		ok := role != "" && subtle.ConstantTimeCompare([]byte(hashPass(pw, n.cfg.Salt)), []byte(n.cfg.PassHash)) == 1
		if !ok {
			n.loginFails++
		}
		fails := n.loginFails
		n.mu.Unlock()
		if !ok {
			time.Sleep(time.Duration(min(fails, 10)) * 400 * time.Millisecond)
			fail(w, 401, "Hibás jelszó.")
			return
		}
		n.mu.Lock()
		n.loginFails = 0
		n.mu.Unlock()
		n.startSession(w)
		writeJSON(w, map[string]bool{"ok": true})
		return
	}
	if !n.loggedIn(r) {
		fail(w, 401, "Jelentkezz be.")
		return
	}
	if r.Method != http.MethodPost {
		fail(w, 405, "POST")
		return
	}
	switch act {
	case "logout":
		if c, err := r.Cookie("tukor"); err == nil {
			n.mu.Lock()
			delete(n.sessions, c.Value)
			n.mu.Unlock()
		}
		http.SetCookie(w, &http.Cookie{Name: "tukor", Value: "", Path: "/", MaxAge: -1})
	case "password":
		old, nw := str("old"), str("new")
		n.mu.Lock()
		ok := subtle.ConstantTimeCompare([]byte(hashPass(old, n.cfg.Salt)), []byte(n.cfg.PassHash)) == 1
		if ok && len([]rune(nw)) >= 8 {
			n.cfg.Salt = token()
			n.cfg.PassHash = hashPass(nw, n.cfg.Salt)
		}
		n.mu.Unlock()
		if !ok {
			fail(w, 400, "A régi jelszó nem jó.")
			return
		}
		if len([]rune(nw)) < 8 {
			fail(w, 400, "Az új jelszó legyen legalább 8 karakter.")
			return
		}
		n.save()
	case "pair":
		if role != "standby" {
			fail(w, 400, "Csak a tartalék szerveren.")
			return
		}
		peer, secret, err := parseCode(str("code"))
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		n.mu.Lock()
		oldPeer, oldSecret := n.cfg.Peer, n.cfg.Secret
		n.cfg.Peer, n.cfg.Secret = peer, secret
		n.mu.Unlock()
		if err := n.checkPeer(); err != nil {
			n.mu.Lock()
			n.cfg.Peer, n.cfg.Secret = oldPeer, oldSecret
			n.mu.Unlock()
			fail(w, 400, "Nem érem el a fő szervert ("+peer+"): "+err.Error()+". Fut mindkét gépen a Tailscale, ugyanabban a hálózatban?")
			return
		}
		n.save()
		n.event("ok", "Párosítva a fő szerverrel ("+peer+"). Indul az első szinkronizálás.")
		n.kickSync()
	case "app":
		if role != "primary" {
			fail(w, 400, "Csak a fő szerveren.")
			return
		}
		id, mode := str("id"), str("mode")
		if mode != "sync" && mode != "forward" && mode != "off" {
			fail(w, 400, "Ismeretlen mód.")
			return
		}
		n.mu.Lock()
		if n.cfg.Apps == nil {
			n.cfg.Apps = map[string]string{}
		}
		n.cfg.Apps[id] = mode
		n.mu.Unlock()
		n.save()
		n.refreshRoutes()
	case "extra":
		if role != "primary" {
			fail(w, 400, "Csak a fő szerveren.")
			return
		}
		var ports []int
		for _, f := range regexp.MustCompile(`\d+`).FindAllString(str("ports"), -1) {
			p, _ := strconv.Atoi(f)
			if p > 0 && p+portShift < 65536 {
				ports = append(ports, p)
			}
		}
		sort.Ints(ports)
		n.mu.Lock()
		n.cfg.Extra = ports
		n.mu.Unlock()
		n.save()
		n.refreshRoutes()
	case "newsecret":
		if role != "primary" {
			fail(w, 400, "Csak a fő szerveren.")
			return
		}
		n.mu.Lock()
		n.cfg.Secret = randomSecret()
		n.mu.Unlock()
		n.save()
		n.event("warn", "Új párosító kód készült. A tartalék szerveren is be kell írni.")
	case "auto":
		on, _ := body["on"].(bool)
		n.mu.Lock()
		n.cfg.Auto = on
		n.mu.Unlock()
		n.save()
		if on {
			n.event("info", "Automatikus átvétel: bekapcsolva.")
		} else {
			n.event("warn", "Automatikus átvétel: kikapcsolva.")
		}
	case "failover":
		if role != "standby" {
			fail(w, 400, "Csak a tartalék szerveren.")
			return
		}
		go n.failover("Kézi átvétel.", true)
	case "failback":
		if role != "standby" {
			fail(w, 400, "Csak a tartalék szerveren.")
			return
		}
		n.mu.Lock()
		ok := n.peerOK
		n.mu.Unlock()
		if !ok {
			fail(w, 400, "A fő szerver most nem érhető el, így nem tudom visszaadni.")
			return
		}
		go n.failback()
	case "sync":
		n.kickSync()
	case "clear-conflicts":
		n.mu.Lock()
		n.st.Conflicts = nil
		n.mu.Unlock()
		n.save()
	default:
		fail(w, 404, "Ismeretlen művelet.")
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

var (
	reIP     = regexp.MustCompile(`\b(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{2,5}))?`)
	reSecret = regexp.MustCompile(`[^A-Z2-7]`)
)

// parseCode accepts the pairing code however it was pasted: with or without dashes, spaces,
// line breaks or lower-case letters (Postel).
func parseCode(code string) (string, string, error) {
	m := reIP.FindStringSubmatchIndex(code)
	if m == nil {
		return "", "", fmt.Errorf("A kódban nincs benne a fő szerver címe (100.x.x.x).")
	}
	ip := code[m[2]:m[3]]
	port := apiPort
	if m[4] >= 0 {
		port = code[m[4]:m[5]]
	}
	if net.ParseIP(ip) == nil {
		return "", "", fmt.Errorf("Hibás cím a kódban.")
	}
	rest := strings.ToUpper(code[:m[0]] + " " + code[m[1]:])
	sec := reSecret.ReplaceAllString(rest, "")
	if len(sec) != 32 {
		return "", "", fmt.Errorf("A kód titkos része nem teljes (%d/32 karakter). Másold ki újra az egészet.", len(sec))
	}
	return net.JoinHostPort(ip, port), sec, nil
}

// ---------- status for the page ----------

func ago(t time.Time) int64 {
	if t.IsZero() {
		return -1
	}
	return int64(time.Since(t).Seconds())
}

func (n *Node) status(auth bool) map[string]any {
	n.mu.Lock()
	defer n.mu.Unlock()
	s := map[string]any{
		"role":       n.cfg.Role,
		"version":    version,
		"logged_in":  auth,
		"configured": n.cfg.Role != "",
	}
	if !auth {
		return s
	}
	ts := tailscaleIP()
	s["ts_ip"] = ts
	s["offset"] = portShift
	hits := map[string]int64{}
	for p, c := range n.hits {
		hits[strconv.Itoa(p)] = c
	}
	s["hits"] = hits
	s["routes"] = n.st.Routes
	ev := make([]Event, 0, 60)
	for i := len(n.events) - 1; i >= 0 && len(ev) < 60; i-- {
		ev = append(ev, n.events[i])
	}
	s["events"] = ev
	s["conflicts"] = n.st.Conflicts

	if n.cfg.Role == "primary" {
		code := ""
		if ts != "" {
			host := ts
			if apiPort != "4791" {
				host = ts + ":" + apiPort
			}
			code = host + " " + grouped(n.cfg.Secret)
		}
		s["code"] = code
		apps := scanApps()
		var list []map[string]any
		for id, a := range apps {
			mode := n.cfg.Apps[id]
			if mode == "" {
				mode = defaultMode(id)
			}
			list = append(list, map[string]any{"id": id, "name": a.Name, "version": a.Version, "ports": a.Ports, "mode": mode})
		}
		sort.Slice(list, func(i, j int) bool { return list[i]["name"].(string) < list[j]["name"].(string) })
		s["apps"] = list
		s["extra"] = n.cfg.Extra
		s["standby"] = map[string]any{
			"seen_ago": ago(n.st.StandbySeen), "mode": n.st.StandbyMode, "version": n.st.StandbyVer,
			"ip": n.st.StandbyIP, "pull_ago": ago(n.st.LastPull),
		}
		day := 0
		from := time.Now().Add(-24*time.Hour).Unix() / 60
		for m, c := range n.st.Writes {
			if m >= from {
				day += c
			}
		}
		s["writes_24h"] = day
		return s
	}

	// standby
	local := scanApps()
	var list []map[string]any
	for _, a := range n.peerApps {
		la, ok := local[a.ID]
		var size int64
		for _, f := range a.Files {
			size += f.Size
		}
		list = append(list, map[string]any{
			"id": a.ID, "name": a.Name, "mode": a.Mode, "ports": a.Ports,
			"version": a.Version, "local_version": la.Version, "installed": ok,
			"files": len(a.Files), "size": size,
		})
	}
	s["apps"] = list
	peerHost, _, _ := net.SplitHostPort(n.cfg.Peer)
	s["peer"] = peerHost
	s["paired"] = n.cfg.Peer != ""
	s["peer_ok"] = n.peerOK
	s["peer_err"] = n.peerErr
	s["peer_checked_ago"] = ago(n.peerChecked)
	s["peer_version"] = n.peerVersion
	s["fails"] = n.peerFails
	s["streak"] = n.peerStreak
	s["fail_after"] = failAfter
	s["health_s"] = healthEvery.Seconds()
	s["return_after"] = returnAfter
	s["mode"] = n.st.Mode
	s["busy"] = n.busy
	s["auto"] = n.cfg.Auto
	s["manual"] = n.st.Manual
	s["failover_ago"] = ago(n.st.FailoverAt)
	s["sync_ago"] = ago(n.st.LastSync)
	s["sync_err"] = n.st.LastSyncErr
	s["sync_files"] = n.st.SyncFiles
	s["sync_bytes"] = n.st.SyncBytes
	s["last_backup"] = n.st.LastBackup
	return s
}
