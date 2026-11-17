package main

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ---------- routes and listeners ----------

// routeLoop keeps a listener on <port>+10000 for every app port that should go through Tükör.
func (n *Node) routeLoop() {
	for {
		n.refreshRoutes()
		time.Sleep(15 * time.Second)
	}
}

func (n *Node) refreshRoutes() {
	n.mu.Lock()
	role := n.cfg.Role
	n.mu.Unlock()
	if role == "primary" {
		apps := scanApps()
		n.mu.Lock()
		if n.cfg.Apps == nil {
			n.cfg.Apps = map[string]string{}
		}
		changed := false
		for id := range apps {
			if _, ok := n.cfg.Apps[id]; !ok {
				n.cfg.Apps[id] = defaultMode(id)
				changed = true
			}
		}
		var routes []Route
		for id, a := range apps {
			mode := n.cfg.Apps[id]
			if mode == "off" || mode == "" {
				continue
			}
			for _, p := range a.Ports {
				routes = append(routes, Route{p, id, mode})
			}
		}
		for _, p := range n.cfg.Extra {
			routes = append(routes, Route{p, "", "forward"})
		}
		sort.Slice(routes, func(i, j int) bool { return routes[i].Port < routes[j].Port })
		n.st.Routes = routes
		n.mu.Unlock()
		if changed {
			n.save()
		}
	}
	n.mu.Lock()
	var want []int
	for _, r := range n.st.Routes {
		if !n.listening[r.Port] {
			want = append(want, r.Port)
			n.listening[r.Port] = true
		}
	}
	n.mu.Unlock()
	for _, p := range want {
		go n.listen(p)
	}
}

func (n *Node) listen(port int) {
	addr := ":" + strconv.Itoa(port+portShift)
	srv := &http.Server{
		Addr:              addr,
		Handler:           n.proxyHandler(port),
		ReadHeaderTimeout: 20 * time.Second,
		IdleTimeout:       120 * time.Second,
		ErrorLog:          log.New(io.Discard, "", 0),
	}
	for {
		err := srv.ListenAndServe()
		n.event("bad", fmt.Sprintf("Nem tudok figyelni a %s porton: %v. 30 mp múlva újra próbálom.", addr, err))
		time.Sleep(30 * time.Second)
	}
}

func (n *Node) route(port int) (Route, bool) {
	for _, r := range n.st.Routes {
		if r.Port == port {
			return r, true
		}
	}
	return Route{}, false
}

// target decides where one request goes: "host:port", or "" with a reason for the wait page.
func (n *Node) target(port int, hop bool) (string, string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	r, ok := n.route(port)
	if !ok {
		return "", "missing"
	}
	local := fmt.Sprintf("127.0.0.1:%d", port+localShift)
	if n.cfg.Role == "primary" {
		if r.Mode == "sync" && !hop && time.Since(n.st.StandbySeen) < reportFresh {
			switch n.st.StandbyMode {
			case "active": // the standby holds the newest data until it hands it back
				return fmt.Sprintf("%s:%d", n.st.StandbyIP, port+n.st.StandbyOffset), ""
			case "returning":
				return "", "busy"
			}
		}
		return local, ""
	}
	// standby
	peerHost, _, _ := net.SplitHostPort(n.cfg.Peer)
	toPeer := fmt.Sprintf("%s:%d", peerHost, port+n.st.PeerOffset)
	if r.Mode == "forward" {
		if hop {
			return "", "busy"
		}
		return toPeer, ""
	}
	switch n.st.Mode {
	case "active":
		return local, ""
	case "returning":
		return "", "busy"
	}
	if hop || n.cfg.Peer == "" { // never bounce a request back to the main server
		return "", "busy"
	}
	return toPeer, ""
}

var transport = &http.Transport{
	DialContext:         (&net.Dialer{Timeout: 4 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
	MaxIdleConnsPerHost: 64,
	IdleConnTimeout:     90 * time.Second,
}

var (
	proxyMu sync.Mutex
	proxies = map[string]*httputil.ReverseProxy{}
)

func proxyTo(target string) *httputil.ReverseProxy {
	proxyMu.Lock()
	defer proxyMu.Unlock()
	if p, ok := proxies[target]; ok {
		return p
	}
	p := &httputil.ReverseProxy{
		Director: func(r *http.Request) {
			r.URL.Scheme = "http"
			r.URL.Host = target
			// r.Host stays the visitor's host name; X-Forwarded-For gets appended.
			if _, ok := r.Header["User-Agent"]; !ok {
				r.Header.Set("User-Agent", "")
			}
		},
		Transport: transport,
		ErrorLog:  log.New(io.Discard, "", 0),
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			waitPage(w, r)
		},
	}
	proxies[target] = p
	return p
}

func isWrite(m string) bool {
	return m == http.MethodPost || m == http.MethodPut || m == http.MethodPatch || m == http.MethodDelete
}

func (n *Node) proxyHandler(port int) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hop := r.Header.Get("X-Tukor-Hop") != ""
		target, why := n.target(port, hop)
		n.mu.Lock()
		n.hits[port]++
		if target != "" && strings.HasPrefix(target, "127.0.0.1:") && n.cfg.Role == "primary" && isWrite(r.Method) {
			n.st.Writes[time.Now().Unix()/60]++
		}
		n.mu.Unlock()
		if target == "" {
			if why == "missing" {
				http.Error(w, "Tükör: ez a port nincs beállítva.", http.StatusBadGateway)
				return
			}
			waitPage(w, r)
			return
		}
		if !strings.HasPrefix(target, "127.0.0.1:") {
			r.Header.Set("X-Tukor-Hop", "1")
		}
		proxyTo(target).ServeHTTP(w, r)
	})
}

// waitPage is shown for the few seconds while the sites move between the two servers.
func waitPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Retry-After", "5")
	w.Header().Set("Cache-Control", "no-store")
	if !strings.Contains(r.Header.Get("Accept"), "text/html") {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusServiceUnavailable)
		io.WriteString(w, "Egy pillanat, az oldal pár másodperc múlva újra elérhető. Kérjük, próbáld újra.\n")
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusServiceUnavailable)
	io.WriteString(w, `<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="5"><title>Egy pillanat…</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#f6f3ee;color:#2a221c}main{max-width:22rem;padding:2rem;text-align:center}
i{display:block;width:28px;height:28px;margin:0 auto 1.2rem;border:3px solid #d9cfc4;border-top-color:#b84a1c;border-radius:50%;animation:s .8s linear infinite}@keyframes s{to{transform:rotate(1turn)}}
h1{font-size:1.25rem;margin:0 0 .4rem}p{margin:0;color:#6b6057}@media (prefers-reduced-motion:reduce){i{animation:none}}</style>
<main><i></i><h1>Egy pillanat…</h1><p>Az oldal pár másodperc múlva újra elérhető, magától frissül.</p></main></html>`)
}

// ---------- main server API (over Tailscale) ----------

func (n *Node) serveAPI() {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", n.apiHealth)
	mux.HandleFunc("/api/manifest", n.apiManifest)
	mux.HandleFunc("/api/file", n.apiFile)
	mux.HandleFunc("/api/failback", n.apiFailback)
	srv := &http.Server{Addr: ":" + apiPort, Handler: mux, ReadHeaderTimeout: 20 * time.Second, ErrorLog: log.New(io.Discard, "", 0)}
	for {
		err := srv.ListenAndServe()
		n.event("bad", "Az API port nem indult el: "+err.Error())
		time.Sleep(30 * time.Second)
	}
}

func remoteIP(r *http.Request) net.IP {
	h, _, _ := net.SplitHostPort(r.RemoteAddr)
	return net.ParseIP(h)
}

// authAPI: only the paired standby, only over Tailscale.
func (n *Node) authAPI(w http.ResponseWriter, r *http.Request) bool {
	ip := remoteIP(r)
	n.mu.Lock()
	role, secret := n.cfg.Role, n.cfg.Secret
	n.mu.Unlock()
	okIP := ip != nil && (cgnat.Contains(ip) || ip.IsLoopback() || allowAnyPeer)
	key := r.Header.Get("X-Tukor-Key")
	if role != "primary" || secret == "" || !okIP || subtle.ConstantTimeCompare([]byte(key), []byte(secret)) != 1 {
		http.Error(w, "forbidden", http.StatusForbidden)
		return false
	}
	return true
}

func (n *Node) apiHealth(w http.ResponseWriter, r *http.Request) {
	if !n.authAPI(w, r) {
		return
	}
	mode := r.Header.Get("X-Tukor-Mode")
	off, _ := strconv.Atoi(r.Header.Get("X-Tukor-Offset"))
	n.mu.Lock()
	prev := n.st.StandbyMode
	n.st.StandbySeen = time.Now()
	n.st.StandbyMode = mode
	n.st.StandbyIP = remoteIP(r).String()
	if off > 0 {
		n.st.StandbyOffset = off
	}
	n.st.StandbyVer = r.Header.Get("X-Tukor-Version")
	n.mu.Unlock()
	if prev != mode {
		switch mode {
		case "active":
			n.event("warn", "A tartalék szerver szerint ő viszi az oldalakat. Amíg vissza nem adja, ide érkező kéréseket is neki adom tovább.")
		case "forward":
			if prev != "" {
				n.event("ok", "A tartalék szerver újra továbbít, minden ide fut be.")
			}
		}
	}
	writeJSON(w, map[string]any{"role": "primary", "version": version, "time": time.Now(), "offset": portShift})
}

type AppManifest struct {
	ID      string     `json:"id"`
	Name    string     `json:"name"`
	Version string     `json:"version"`
	Mode    string     `json:"mode"`
	Ports   []int      `json:"ports"`
	Files   []FileInfo `json:"files,omitempty"`
}

type Manifest struct {
	Version string        `json:"version"`
	Offset  int           `json:"offset"`
	Time    time.Time     `json:"time"`
	Apps    []AppManifest `json:"apps"`
	Routes  []Route       `json:"routes"`
}

func (n *Node) apiManifest(w http.ResponseWriter, r *http.Request) {
	if !n.authAPI(w, r) {
		return
	}
	apps := scanApps()
	n.mu.Lock()
	modes := map[string]string{}
	for k, v := range n.cfg.Apps {
		modes[k] = v
	}
	routes := append([]Route(nil), n.st.Routes...)
	n.st.LastPull = time.Now()
	n.mu.Unlock()
	m := Manifest{Version: version, Offset: portShift, Time: time.Now(), Routes: routes}
	var ids []string
	for id := range apps {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		mode := modes[id]
		if mode == "off" || mode == "" {
			continue
		}
		a := apps[id]
		am := AppManifest{ID: id, Name: a.Name, Version: a.Version, Mode: mode, Ports: a.Ports}
		if mode == "sync" {
			files, err := listFiles(id)
			if err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			am.Files = files
		}
		m.Apps = append(m.Apps, am)
	}
	writeJSON(w, m)
}

func (n *Node) syncMode(app string) bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.cfg.Apps[app] == "sync"
}

func (n *Node) apiFile(w http.ResponseWriter, r *http.Request) {
	if !n.authAPI(w, r) {
		return
	}
	app, rel := r.URL.Query().Get("app"), r.URL.Query().Get("path")
	if !n.syncMode(app) {
		http.Error(w, "not synced", 404)
		return
	}
	p, err := safeJoin(app, rel)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	f, err := os.Open(p)
	if err != nil {
		http.Error(w, "not found", 404)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/octet-stream")
	io.Copy(w, f)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(v)
}
