// Tükör – keeps a standby Umbrel (Márk) in sync with the main one (Ádám) and takes over
// the websites if the main one goes offline.
//
// Both machines run the same Cloudflare Tunnel (replicas). Every public hostname points at
// Tükör (http://host.docker.internal:1<port>), never straight at an app:
//   - main server: Tükör serves its own apps;
//   - standby, normal mode ("forward"): Tükör passes every request to the main server over
//     Tailscale, so orders and bookings always land in one place. Its own copies of the apps
//     are stopped, and their data folders are refreshed from the main server every minute;
//   - standby, main server unreachable ("active"): it starts its copies and serves them;
//   - when the main server is back: the standby stops its copies and hands the changed files
//     back ("returning"), then goes back to forwarding.
//
// Standard library only; runs with host networking so it can reach the apps' ports and the
// Tailscale network.
package main

import (
	"crypto/rand"
	"encoding/base32"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	_ "time/tzdata"
)

var (
	version   = env("APP_VERSION", "1.0.0")
	dataDir   = env("DATA_DIR", "/data")
	appsDir   = env("APPS_DIR", "/app-data")
	uiPort    = env("UI_PORT", "4790")
	apiPort   = env("API_PORT", "4791")
	selfID    = env("APP_ID", "adam-tukor")
	portShift = envInt("PORT_OFFSET", 10000)
	// Test hooks: a fixed Tailscale address and a looser address check when no tailscale0 exists.
	tsOverride   = os.Getenv("TS_IP")
	allowAnyPeer = os.Getenv("ALLOW_ANY_PEER") == "1"
)

var (
	healthEvery = time.Duration(envInt("HEALTH_MS", 5000)) * time.Millisecond
	syncEvery   = time.Duration(envInt("SYNC_MS", 15000)) * time.Millisecond
	reportFresh = 4 * healthEvery // how long a standby report counts on the main server
	// Test hooks: apps listen on port+shift locally; skip the "is our own internet up" check.
	localShift = envInt("LOCAL_PORT_SHIFT", 0)
	skipNet    = os.Getenv("SKIP_INTERNET_CHECK") == "1"
)

const (
	failAfter      = 6  // failed checks in a row before taking over (~30 s)
	returnAfter    = 12 // good checks in a row before handing back (~60 s)
	keepDaily      = 14
	keepOther      = 20
	maxFileSize    = 512 << 20
	writeKeepDays  = 60
	slackBeforeTak = 10 * time.Second // clock difference between the two machines
)

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func envInt(k string, d int) int {
	if v, err := strconv.Atoi(os.Getenv(k)); err == nil {
		return v
	}
	return d
}

// ---------- persistent config and state ----------

type Config struct {
	Role     string            `json:"role"` // "primary" | "standby"
	Salt     string            `json:"salt"`
	PassHash string            `json:"pass_hash"`
	Secret   string            `json:"secret"`
	Peer     string            `json:"peer"` // standby: main server "ip:apiport"
	Apps     map[string]string `json:"apps"` // main server: app id -> "sync" | "forward" | "off"
	Extra    []int             `json:"extra_ports"`
	Auto     bool              `json:"auto"` // standby: take over automatically
}

type Route struct {
	Port int    `json:"port"`
	App  string `json:"app"`
	Mode string `json:"mode"` // "sync" | "forward"
}

type Conflict struct {
	Time  time.Time `json:"time"`
	App   string    `json:"app"`
	Path  string    `json:"path"`
	Kept  string    `json:"kept"`
	Saved string    `json:"saved"`
}

type State struct {
	Mode          string            `json:"mode"` // standby: "forward" | "active" | "returning"
	FailoverAt    time.Time         `json:"failover_at"`
	Manual        bool              `json:"manual"`
	Base          map[string]string `json:"base"` // "app/path" -> hash when the standby took over
	Routes        []Route           `json:"routes"`
	PeerOffset    int               `json:"peer_offset"`
	LastSync      time.Time         `json:"last_sync"`
	LastSyncErr   string            `json:"last_sync_err"`
	SyncFiles     int               `json:"sync_files"`
	SyncBytes     int64             `json:"sync_bytes"`
	LastBackup    string            `json:"last_backup"`
	Conflicts     []Conflict        `json:"conflicts"`
	Writes        map[int64]int     `json:"writes"` // main server: unix minute -> public write requests
	StandbySeen   time.Time         `json:"standby_seen"`
	StandbyMode   string            `json:"standby_mode"`
	StandbyIP     string            `json:"standby_ip"`
	StandbyOffset int               `json:"standby_offset"`
	StandbyVer    string            `json:"standby_version"`
	LastPull      time.Time         `json:"last_pull"` // main server: last manifest fetched by the standby
}

type Event struct {
	Time  time.Time `json:"time"`
	Level string    `json:"level"` // "info" | "warn" | "ok" | "bad"
	Text  string    `json:"text"`
}

type Node struct {
	mu     sync.Mutex
	cfg    Config
	st     State
	events []Event
	ctl    controller

	// runtime only
	peerOK      bool
	peerFails   int
	peerStreak  int
	peerChecked time.Time
	peerErr     string
	peerVersion string
	peerApps    []AppManifest
	busy        string // running failover / failback
	listening   map[int]bool
	hits        map[int]int64
	endpoints   map[int]string
	syncNow     chan struct{}
	sessions    map[string]time.Time
	loginFails  int
}

var n *Node

func main() {
	log.SetFlags(log.LstdFlags)
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		log.Fatal(err)
	}
	n = &Node{
		listening: map[int]bool{},
		hits:      map[int]int64{},
		syncNow:   make(chan struct{}, 1),
		sessions:  map[string]time.Time{},
		ctl:       newController(),
	}
	readJSON(filepath.Join(dataDir, "config.json"), &n.cfg)
	readJSON(filepath.Join(dataDir, "state.json"), &n.st)
	readJSON(filepath.Join(dataDir, "events.json"), &n.events)
	if n.st.Writes == nil {
		n.st.Writes = map[int64]int{}
	}
	if n.cfg.Role == "standby" && n.st.Mode == "" {
		n.st.Mode = "forward"
	}
	n.event("info", fmt.Sprintf("Tükör %s elindult.", version))

	go n.serveUI()
	go n.serveAPI()
	go n.routeLoop()
	go n.endpointLoop()
	go n.healthLoop()
	go n.syncLoop()
	go n.saveLoop()
	select {}
}

func (n *Node) event(level, text string) {
	log.Printf("[%s] %s", level, text)
	n.mu.Lock()
	n.events = append(n.events, Event{time.Now(), level, text})
	if len(n.events) > 200 {
		n.events = n.events[len(n.events)-200:]
	}
	n.mu.Unlock()
	n.save()
}

// save writes config, state and events (atomically). Safe to call often.
var saveMu sync.Mutex

func (n *Node) save() {
	saveMu.Lock()
	defer saveMu.Unlock()
	n.mu.Lock()
	cfg, _ := json.MarshalIndent(n.cfg, "", "  ")
	st, _ := json.MarshalIndent(n.st, "", "  ")
	ev, _ := json.Marshal(n.events)
	n.mu.Unlock()
	writeAtomic(filepath.Join(dataDir, "config.json"), cfg, 0o600)
	writeAtomic(filepath.Join(dataDir, "state.json"), st, 0o600)
	writeAtomic(filepath.Join(dataDir, "events.json"), ev, 0o600)
}

func (n *Node) saveLoop() {
	for range time.Tick(time.Minute) {
		n.mu.Lock()
		cut := time.Now().Add(-writeKeepDays*24*time.Hour).Unix() / 60
		for m := range n.st.Writes {
			if m < cut {
				delete(n.st.Writes, m)
			}
		}
		n.mu.Unlock()
		n.save()
	}
}

func readJSON(path string, v any) {
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, v)
	}
}

func writeAtomic(path string, b []byte, mode os.FileMode) error {
	tmp := path + ".tukor-tmp"
	if err := os.WriteFile(tmp, b, mode); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func randomSecret() string {
	b := make([]byte, 20)
	rand.Read(b)
	return base32.StdEncoding.EncodeToString(b) // 32 characters A-Z2-7
}

// groups "ABCDEFGH..." as "ABCD-EFGH-..." so it can be read out loud (Miller).
func grouped(s string) string {
	var parts []string
	for i := 0; i < len(s); i += 4 {
		j := min(i+4, len(s))
		parts = append(parts, s[i:j])
	}
	return strings.Join(parts, "-")
}

// tailscaleIP is this machine's 100.x address (the Umbrel Tailscale app runs in kernel mode).
func tailscaleIP() string {
	if tsOverride != "" {
		return tsOverride
	}
	ifc, err := net.InterfaceByName("tailscale0")
	if err != nil {
		return ""
	}
	addrs, _ := ifc.Addrs()
	for _, a := range addrs {
		if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil && cgnat.Contains(ipn.IP) {
			return ipn.IP.String()
		}
	}
	return ""
}

var _, cgnat, _ = net.ParseCIDR("100.64.0.0/10")

// internetOK tells whether this machine itself is online (so a dead link on our side is
// never mistaken for the main server being down).
func internetOK() bool {
	if skipNet {
		return true
	}
	for _, a := range []string{"1.1.1.1:443", "8.8.8.8:53", "9.9.9.9:443"} {
		if c, err := net.DialTimeout("tcp", a, 3*time.Second); err == nil {
			c.Close()
			return true
		}
	}
	return false
}

func sortedInts(m map[int]bool) []int {
	var out []int
	for k := range m {
		out = append(out, k)
	}
	sort.Ints(out)
	return out
}
