// Tükör – standby logic: health checks of the main server, automatic takeover (failover),
// hand-back with three-way merge (failback), the 15-second data sync and the daily backup.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

var peerClient = &http.Client{Timeout: 4 * time.Second, Transport: &http.Transport{
	DialContext: (&net.Dialer{Timeout: 3 * time.Second}).DialContext, MaxIdleConnsPerHost: 4}}
var bulkClient = &http.Client{Timeout: 5 * time.Minute, Transport: &http.Transport{
	DialContext: (&net.Dialer{Timeout: 5 * time.Second}).DialContext}}

func (n *Node) peerReq(method, p string, body io.Reader, long bool) (*http.Response, error) {
	n.mu.Lock()
	peer, secret, mode := n.cfg.Peer, n.cfg.Secret, n.st.Mode
	n.mu.Unlock()
	if peer == "" {
		return nil, fmt.Errorf("nincs párosítva")
	}
	req, err := http.NewRequest(method, "http://"+peer+p, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Tukor-Key", secret)
	req.Header.Set("X-Tukor-Mode", mode)
	req.Header.Set("X-Tukor-Offset", strconv.Itoa(portShift))
	req.Header.Set("X-Tukor-Version", version)
	cl := peerClient
	if long {
		cl = bulkClient
	}
	resp, err := cl.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 300))
		resp.Body.Close()
		if resp.StatusCode == 403 {
			return nil, fmt.Errorf("a fő szerver nem fogadta el a párosító kódot")
		}
		return nil, fmt.Errorf("%s: %s", resp.Status, strings.TrimSpace(string(b)))
	}
	return resp, nil
}

func (n *Node) checkPeer() error {
	resp, err := n.peerReq("GET", "/api/health", nil, false)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var h struct {
		Role    string `json:"role"`
		Version string `json:"version"`
		Offset  int    `json:"offset"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&h); err != nil {
		return err
	}
	if h.Role != "primary" {
		return fmt.Errorf("a másik gép nem fő szerver")
	}
	n.mu.Lock()
	n.peerVersion = h.Version
	if h.Offset > 0 {
		n.st.PeerOffset = h.Offset
	}
	n.mu.Unlock()
	return nil
}

// ---------- standby: health and automatic takeover ----------

func (n *Node) healthLoop() {
	warnedTS := false
	for range time.Tick(healthEvery) {
		n.mu.Lock()
		role, peer, busy, mode, auto := n.cfg.Role, n.cfg.Peer, n.busy, n.st.Mode, n.cfg.Auto
		n.mu.Unlock()
		if role != "standby" || peer == "" || busy != "" {
			continue
		}
		err := n.checkPeer()
		n.mu.Lock()
		n.peerChecked = time.Now()
		wasOK := n.peerOK
		if err == nil {
			n.peerOK, n.peerErr = true, ""
			n.peerFails = 0
			n.peerStreak++
		} else {
			n.peerOK, n.peerErr = false, err.Error()
			n.peerFails++
			n.peerStreak = 0
		}
		fails, streak := n.peerFails, n.peerStreak
		n.mu.Unlock()

		if err != nil && wasOK && mode == "forward" {
			n.event("warn", "Nem érem el a fő szervert: "+err.Error())
		}
		if err == nil && !wasOK && mode == "forward" && fails == 0 && streak == 1 {
			n.event("ok", "A fő szerver elérhető.")
		}

		switch mode {
		case "forward":
			if fails < failAfter || !auto {
				continue
			}
			if tailscaleIP() == "" {
				if !warnedTS {
					n.event("bad", "Ezen a gépen nem fut a Tailscale, ezért nem tudom eldönteni, hogy a fő szerver tényleg leállt-e. Nem veszem át az oldalakat.")
					warnedTS = true
				}
				continue
			}
			warnedTS = false
			if !internetOK() {
				continue // our own internet is down: nothing to take over
			}
			n.failover(fmt.Sprintf("A fő szerver %d másodperce nem válaszol.", int(float64(fails)*healthEvery.Seconds())), false)
		case "active":
			n.mu.Lock()
			manual := n.st.Manual
			n.mu.Unlock()
			if streak >= returnAfter && auto && !manual {
				n.failback()
			}
		case "returning": // interrupted by a restart
			if err == nil {
				n.failback()
			} else {
				n.resumeActive()
			}
		}
	}
}

func (n *Node) syncedApps() []string {
	n.mu.Lock()
	defer n.mu.Unlock()
	seen := map[string]bool{}
	var out []string
	for _, r := range n.st.Routes {
		if r.Mode == "sync" && r.App != "" && !seen[r.App] {
			seen[r.App] = true
			out = append(out, r.App)
		}
	}
	// apps without any port still sync (e.g. back-end only)
	for _, a := range n.peerApps {
		if a.Mode == "sync" && !seen[a.ID] {
			seen[a.ID] = true
			out = append(out, a.ID)
		}
	}
	sort.Strings(out)
	return out
}

func installed(app string) bool {
	_, err := os.Stat(filepath.Join(appsDir, app, "umbrel-app.yml"))
	return err == nil
}

// failover: start our copies of the apps and serve them.
func (n *Node) failover(reason string, manual bool) {
	n.mu.Lock()
	if n.busy != "" || n.st.Mode != "forward" {
		n.mu.Unlock()
		return
	}
	n.busy = "failover"
	n.mu.Unlock()
	defer func() { n.mu.Lock(); n.busy = ""; n.mu.Unlock() }()

	n.event("warn", reason+" Átveszem az oldalakat.")
	base := map[string]string{}
	apps := n.syncedApps()
	for _, a := range apps {
		for p, h := range hashesOf(a) {
			base[a+"/"+p] = h
		}
	}
	n.mu.Lock()
	n.st.Base = base
	n.st.FailoverAt = time.Now()
	n.st.Manual = manual
	n.peerStreak = 0
	n.st.Mode = "returning" // requests wait while the apps start
	n.mu.Unlock()
	n.save()

	var failed []string
	for _, a := range apps {
		if !installed(a) {
			failed = append(failed, a+" (nincs telepítve)")
			continue
		}
		if err := n.ctl.Start(a); err != nil {
			failed = append(failed, a+": "+err.Error())
		}
	}
	n.mu.Lock()
	var ports []int
	for _, r := range n.st.Routes {
		if r.Mode == "sync" {
			ports = append(ports, r.Port)
		}
	}
	n.mu.Unlock()
	for _, p := range ports {
		n.refreshEndpoints() // the started containers have new addresses
		waitUp(n.localAddr(p), 45*time.Second)
	}
	n.mu.Lock()
	n.st.Mode = "active"
	n.mu.Unlock()
	n.save()
	if len(failed) > 0 {
		n.event("bad", "Néhány app nem indult el: "+strings.Join(failed, "; "))
	}
	if manual {
		n.event("bad", "A tartalék szerver viszi az oldalakat (kézi átvétel). Visszaadni a „Visszaadás most” gombbal tudod.")
	} else {
		n.event("bad", "A tartalék szerver viszi az oldalakat. Ha a fő szerver visszajön, egy perc után automatikusan visszaadom.")
	}
}

type FailbackFile struct {
	App     string `json:"app"`
	Path    string `json:"path"`
	Base    string `json:"base"`
	Hash    string `json:"hash"`
	Deleted bool   `json:"deleted"`
	Mode    uint32 `json:"mode"`
	Data    []byte `json:"data"`
}

type FailbackReq struct {
	FailoverAt time.Time      `json:"failover_at"`
	Files      []FailbackFile `json:"files"`
}

type FailbackReport struct {
	Applied   int        `json:"applied"`
	Same      int        `json:"same"`
	Conflicts []Conflict `json:"conflicts"`
	Backup    string     `json:"backup"`
}

// failback: stop our copies, hand the changed files to the main server, go back to forwarding.
func (n *Node) failback() {
	n.mu.Lock()
	if n.busy != "" || (n.st.Mode != "active" && n.st.Mode != "returning") {
		n.mu.Unlock()
		return
	}
	n.busy = "failback"
	n.st.Mode = "returning"
	base, at := n.st.Base, n.st.FailoverAt
	n.mu.Unlock()
	n.save()
	defer func() { n.mu.Lock(); n.busy = ""; n.mu.Unlock() }()
	n.event("info", "A fő szerver újra elérhető. Visszaadom az oldalakat.")

	apps := n.syncedApps()
	for _, a := range apps {
		if installed(a) {
			n.ctl.Stop(a)
		}
	}
	req := FailbackReq{FailoverAt: at}
	for _, a := range apps {
		files, _ := listFiles(a)
		have := map[string]bool{}
		for _, f := range files {
			k := a + "/" + f.Path
			have[k] = true
			if base[k] == f.Hash {
				continue
			}
			p, _ := safeJoin(a, f.Path)
			b, err := os.ReadFile(p)
			if err != nil {
				continue
			}
			req.Files = append(req.Files, FailbackFile{App: a, Path: f.Path, Base: base[k], Hash: f.Hash, Mode: f.Mode, Data: b})
		}
		for k, h := range base {
			if strings.HasPrefix(k, a+"/") && !have[k] {
				req.Files = append(req.Files, FailbackFile{App: a, Path: strings.TrimPrefix(k, a+"/"), Base: h, Deleted: true})
			}
		}
	}
	body, _ := json.Marshal(req)
	resp, err := n.peerReq("POST", "/api/failback", bytes.NewReader(body), true)
	if err != nil {
		n.event("bad", "Nem sikerült visszaadni az adatokat ("+err.Error()+"). Tovább viszem az oldalakat, később újra próbálom.")
		for _, a := range apps {
			if installed(a) {
				n.ctl.Start(a)
			}
		}
		n.mu.Lock()
		n.st.Mode = "active"
		n.peerStreak = 0
		n.mu.Unlock()
		n.save()
		return
	}
	var rep FailbackReport
	json.NewDecoder(resp.Body).Decode(&rep)
	resp.Body.Close()

	n.mu.Lock()
	n.st.Mode = "forward"
	n.st.Base = nil
	n.st.Manual = false
	n.st.Conflicts = append(n.st.Conflicts, rep.Conflicts...)
	n.mu.Unlock()
	n.save()
	n.event(conflictLevel(rep.Conflicts), "Visszaadva: "+summary(rep))
	n.kickSync()
}

// resumeActive starts our copies again (after an interrupted hand-back).
func (n *Node) resumeActive() {
	for _, a := range n.syncedApps() {
		if installed(a) {
			n.ctl.Start(a)
		}
	}
	n.mu.Lock()
	n.st.Mode = "active"
	n.mu.Unlock()
	n.save()
	n.event("warn", "Újraindulás után: a fő szerver még nem érhető el, tovább viszem az oldalakat.")
}

// ---------- main server: receiving the hand-back ----------

func (n *Node) writesSince(t time.Time) int {
	n.mu.Lock()
	defer n.mu.Unlock()
	from := t.Unix() / 60
	c := 0
	for m, k := range n.st.Writes {
		if m >= from {
			c += k
		}
	}
	return c
}

func (n *Node) apiFailback(w http.ResponseWriter, r *http.Request) {
	if !n.authAPI(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "POST", 405)
		return
	}
	var req FailbackReq
	if err := json.NewDecoder(io.LimitReader(r.Body, 2<<30)).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	rep, err := n.applyFailback(req)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, rep)
}

func (n *Node) applyFailback(req FailbackReq) (FailbackReport, error) {
	var rep FailbackReport
	// Did visitors change anything here while the standby was in charge? Then a file changed
	// on both sides is a real conflict; otherwise our changes were only background work.
	public := n.writesSince(req.FailoverAt.Add(-slackBeforeTak))
	ts := time.Now().Format("2006-01-02_15-04-05")
	byApp := map[string][]FailbackFile{}
	for _, f := range req.Files {
		if !n.syncMode(f.App) {
			continue
		}
		if _, err := safeJoin(f.App, f.Path); err != nil {
			continue
		}
		byApp[f.App] = append(byApp[f.App], f)
	}
	if len(byApp) == 0 {
		n.mu.Lock()
		n.st.StandbyMode = "forward"
		n.mu.Unlock()
		n.event("ok", "A tartalék szerver visszaadta az oldalakat, nem változott semmi.")
		return rep, nil
	}
	rep.Backup = "failback-" + ts
	bdir := filepath.Join(dataDir, "backups", rep.Backup)
	for app := range byApp {
		copyTree(dataPath(app), filepath.Join(bdir, app))
	}
	prune("failback-", keepOther)
	for app := range byApp {
		if err := n.ctl.Stop(app); err != nil {
			n.event("warn", "Nem tudtam leállítani: "+app+": "+err.Error())
		}
	}
	for app, files := range byApp {
		for _, f := range files {
			p, _ := safeJoin(app, f.Path)
			cur := ""
			if fi, err := os.Stat(p); err == nil {
				cur, _ = hashFile(p, fi)
			}
			theirs := f.Hash
			if f.Deleted {
				theirs = ""
			}
			switch {
			case cur == theirs:
				rep.Same++
				continue
			case cur == f.Base:
				// unchanged here: take the standby's version
			case public == 0:
				// Changed here too, but no visitor reached this machine while the standby was in
				// charge (e.g. the last seconds before a power cut, or the app's own background
				// work). The standby's version covers the whole outage, so it wins; ours is in the backup.
				rep.Conflicts = append(rep.Conflicts, Conflict{time.Now(), app, f.Path, "tartalék",
					filepath.Join("backups", rep.Backup, app, filepath.FromSlash(f.Path))})
			default:
				saved := filepath.Join("conflicts", ts, app, filepath.FromSlash(f.Path))
				if !f.Deleted {
					dst := filepath.Join(dataDir, saved)
					os.MkdirAll(filepath.Dir(dst), 0o700)
					os.WriteFile(dst, f.Data, 0o600)
				} else {
					saved = "(a tartalékon törölve volt)"
				}
				rep.Conflicts = append(rep.Conflicts, Conflict{time.Now(), app, f.Path, "fő", saved})
				continue
			}
			if f.Deleted {
				os.Remove(p)
			} else if err := putFile(p, f.Data, f.Mode); err != nil {
				n.event("bad", fmt.Sprintf("Nem tudtam visszaírni: %s/%s: %v", app, f.Path, err))
				continue
			}
			rep.Applied++
		}
	}
	for app := range byApp {
		if err := n.ctl.Start(app); err != nil {
			n.event("bad", "Nem indult újra: "+app+": "+err.Error())
		}
	}
	n.mu.Lock()
	n.st.StandbyMode = "forward" // serve locally again right away
	n.st.Conflicts = append(n.st.Conflicts, rep.Conflicts...)
	n.mu.Unlock()
	n.event(conflictLevel(rep.Conflicts), "A tartalék visszaadta az oldalakat: "+summary(rep)+" Mentés a korábbi állapotról: "+rep.Backup+".")
	return rep, nil
}

func conflictLevel(cs []Conflict) string {
	lvl := "ok"
	for _, c := range cs {
		if c.Kept == "fő" || c.Kept == "fő szerver" {
			return "bad"
		}
		lvl = "warn"
	}
	return lvl
}

func summary(rep FailbackReport) string {
	real, soft := 0, 0
	for _, c := range rep.Conflicts {
		if c.Kept == "tartalék" {
			soft++
		} else {
			real++
		}
	}
	s := fmt.Sprintf("%d megváltozott fájl került vissza a fő szerverre.", rep.Applied)
	if soft > 0 {
		s += fmt.Sprintf(" %d fájlt a fő szerver is módosított közben látogató nélkül (pl. statisztika vagy az utolsó másodpercek a kiesés előtt); a tartalék változata maradt, a régi a mentésben van.", soft)
	}
	if real > 0 {
		s += fmt.Sprintf(" %d fájl mindkét gépen látogatói módosítást kapott: a fő szerver változata maradt, a tartalékét elmentettem (lásd: Ütközések).", real)
	}
	return s
}

// ---------- standby: pulling the data every minute ----------

func (n *Node) kickSync() {
	select {
	case n.syncNow <- struct{}{}:
	default:
	}
}

func (n *Node) syncLoop() {
	t := time.NewTicker(syncEvery)
	first := true
	for {
		if !first {
			select {
			case <-t.C:
			case <-n.syncNow:
			}
		}
		first = false
		n.mu.Lock()
		role, peer, mode, busy := n.cfg.Role, n.cfg.Peer, n.st.Mode, n.busy
		n.mu.Unlock()
		if role != "standby" || peer == "" || mode != "forward" || busy != "" {
			continue
		}
		err := n.pull()
		n.mu.Lock()
		prevErr := n.st.LastSyncErr
		if err != nil {
			n.st.LastSyncErr = err.Error()
		} else {
			n.st.LastSyncErr = ""
		}
		n.mu.Unlock()
		if err != nil && prevErr == "" {
			n.event("warn", "A szinkronizálás nem sikerült: "+err.Error())
		}
		if err == nil && prevErr != "" {
			n.event("ok", "A szinkronizálás újra működik.")
		}
		n.dailyBackup()
		n.save()
	}
}

// invalidSeen remembers broken JSON files once (only used by the sync goroutine).
var invalidSeen = map[string]string{}

func (n *Node) pull() error {
	resp, err := n.peerReq("GET", "/api/manifest", nil, true)
	if err != nil {
		return err
	}
	var m Manifest
	err = json.NewDecoder(resp.Body).Decode(&m)
	resp.Body.Close()
	if err != nil {
		return err
	}
	n.mu.Lock()
	first := len(n.st.Routes) == 0
	n.st.Routes = m.Routes
	if m.Offset > 0 {
		n.st.PeerOffset = m.Offset
	}
	n.peerApps = m.Apps
	n.peerVersion = m.Version
	n.mu.Unlock()
	if first {
		n.refreshRoutes()
	}

	files, bytesN := 0, int64(0)
	var problems []string
	for _, a := range m.Apps {
		if a.Mode != "sync" || !installed(a.ID) {
			continue
		}
		// Our copy must stay stopped while we only forward, or it could overwrite the data.
		if run, err := n.ctl.Running(a.ID); err == nil && run {
			n.ctl.Stop(a.ID)
		}
		local := map[string]string{}
		lf, _ := listFiles(a.ID)
		for _, f := range lf {
			local[f.Path] = f.Hash
		}
		remote := map[string]bool{}
		for _, f := range a.Files {
			remote[f.Path] = true
			if local[f.Path] == f.Hash {
				continue
			}
			dst, err := safeJoin(a.ID, f.Path)
			if err != nil {
				continue
			}
			b, err := n.fetch(a.ID, f.Path)
			if err != nil {
				problems = append(problems, a.ID+"/"+f.Path+": "+err.Error())
				continue
			}
			sum := sha256.Sum256(b)
			if hex.EncodeToString(sum[:]) != f.Hash {
				continue // changed while we read it; next round
			}
			if !validContent(f.Path, b) {
				// Maybe caught mid-write. If it is still the same broken file next round, take it as it is.
				k := a.ID + "/" + f.Path
				if invalidSeen[k] != f.Hash {
					invalidSeen[k] = f.Hash
					continue
				}
			}
			if err := putFile(dst, b, f.Mode); err != nil {
				problems = append(problems, a.ID+"/"+f.Path+": "+err.Error())
				continue
			}
			files++
			bytesN += int64(len(b))
		}
		for p := range local {
			if !remote[p] {
				if dst, err := safeJoin(a.ID, p); err == nil {
					os.Remove(dst)
					files++
				}
			}
		}
	}
	n.mu.Lock()
	n.st.LastSync = time.Now()
	n.st.SyncFiles += files
	n.st.SyncBytes += bytesN
	n.mu.Unlock()
	if len(problems) > 0 {
		return fmt.Errorf("%d fájl nem jött át (%s)", len(problems), problems[0])
	}
	return nil
}

func (n *Node) fetch(app, p string) ([]byte, error) {
	resp, err := n.peerReq("GET", "/api/file?app="+url.QueryEscape(app)+"&path="+url.QueryEscape(p), nil, true)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(io.LimitReader(resp.Body, maxFileSize+1))
}

// dailyBackup keeps a dated copy of the synced data on the standby (an off-site backup).
func (n *Node) dailyBackup() {
	day := time.Now().Format("2006-01-02")
	n.mu.Lock()
	done := n.st.LastBackup == day
	n.mu.Unlock()
	if done {
		return
	}
	dir := filepath.Join(dataDir, "backups", "daily-"+day)
	for _, a := range n.syncedApps() {
		if installed(a) {
			copyTree(dataPath(a), filepath.Join(dir, a))
		}
	}
	prune("daily-", keepDaily)
	n.mu.Lock()
	n.st.LastBackup = day
	n.mu.Unlock()
}
