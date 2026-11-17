package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// ---------- installed apps ----------

type LocalApp struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Version string `json:"version"`
	Ports   []int  `json:"ports"`
}

var (
	reName    = regexp.MustCompile(`(?m)^name:\s*"?([^"\n]+?)"?\s*$`)
	reVersion = regexp.MustCompile(`(?m)^version:\s*"?([^"\n]+?)"?\s*$`)
	rePort    = regexp.MustCompile(`(?m)^port:\s*(\d+)\s*$`)
	// "- "4773:8082"" style host port mappings in docker-compose.yml
	reMapped = regexp.MustCompile(`(?m)^\s*-\s*"?(?:[\d.]+:)?(\d{2,5}):\d{2,5}(?:/tcp)?"?\s*(?:#.*)?$`)
)

func scanApps() map[string]LocalApp {
	out := map[string]LocalApp{}
	ents, err := os.ReadDir(appsDir)
	if err != nil {
		return out
	}
	for _, e := range ents {
		if !e.IsDir() || e.Name() == selfID {
			continue
		}
		dir := filepath.Join(appsDir, e.Name())
		man, err := os.ReadFile(filepath.Join(dir, "umbrel-app.yml"))
		if err != nil {
			continue
		}
		a := LocalApp{ID: e.Name(), Name: e.Name()}
		if m := reName.FindSubmatch(man); m != nil {
			a.Name = string(m[1])
		}
		if m := reVersion.FindSubmatch(man); m != nil {
			a.Version = string(m[1])
		}
		seen := map[int]bool{}
		if m := rePort.FindSubmatch(man); m != nil {
			p, _ := strconv.Atoi(string(m[1]))
			seen[p] = true
		}
		if comp, err := os.ReadFile(filepath.Join(dir, "docker-compose.yml")); err == nil {
			for _, m := range reMapped.FindAllSubmatch(comp, -1) {
				p, _ := strconv.Atoi(string(m[1]))
				seen[p] = true
			}
		}
		for p := range seen {
			if p > 0 && p+portShift < 65536 {
				a.Ports = append(a.Ports, p)
			}
		}
		sort.Ints(a.Ports)
		out[a.ID] = a
	}
	return out
}

// defaultMode decides what a newly seen app does on the main server.
func defaultMode(id string) string {
	switch id {
	case "adam-router":
		return "off"
	case "adam-vitals":
		return "forward"
	}
	for _, p := range []string{"adam-", "vadvirag-", "adm-"} {
		if strings.HasPrefix(id, p) {
			return "sync"
		}
	}
	return "off"
}

func dataPath(app string) string { return filepath.Join(appsDir, app, "data") }

// ---------- files ----------

type FileInfo struct {
	Path  string `json:"path"`
	Size  int64  `json:"size"`
	Mode  uint32 `json:"mode"`
	MTime int64  `json:"mtime"`
	Hash  string `json:"hash"`
}

type hentry struct {
	size  int64
	mtime int64
	hash  string
}

var (
	hmu    sync.Mutex
	hcache = map[string]hentry{}
)

func hashFile(path string, fi os.FileInfo) (string, error) {
	key := path
	hmu.Lock()
	h, ok := hcache[key]
	hmu.Unlock()
	if ok && h.size == fi.Size() && h.mtime == fi.ModTime().UnixNano() {
		return h.hash, nil
	}
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	s := sha256.New()
	if _, err := io.Copy(s, f); err != nil {
		return "", err
	}
	sum := hex.EncodeToString(s.Sum(nil))
	hmu.Lock()
	hcache[key] = hentry{fi.Size(), fi.ModTime().UnixNano(), sum}
	hmu.Unlock()
	return sum, nil
}

func skipName(name string) bool {
	return strings.HasSuffix(name, ".tukor-tmp") || strings.HasSuffix(name, ".tmp") ||
		strings.HasSuffix(name, ".swp") || name == ".DS_Store"
}

// listFiles returns every regular file in an app's data folder.
func listFiles(app string) ([]FileInfo, error) {
	root := dataPath(app)
	var out []FileInfo
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			if p == root && os.IsNotExist(err) {
				return filepath.SkipAll
			}
			return nil
		}
		if d.IsDir() || !d.Type().IsRegular() || skipName(d.Name()) {
			return nil
		}
		fi, err := d.Info()
		if err != nil || fi.Size() > maxFileSize {
			return nil
		}
		h, err := hashFile(p, fi)
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(root, p)
		out = append(out, FileInfo{filepath.ToSlash(rel), fi.Size(), uint32(fi.Mode().Perm()), fi.ModTime().Unix(), h})
		return nil
	})
	return out, err
}

func hashesOf(app string) map[string]string {
	m := map[string]string{}
	files, _ := listFiles(app)
	for _, f := range files {
		m[f.Path] = f.Hash
	}
	return m
}

// safeJoin rejects paths that would leave the app's data folder.
func safeJoin(app, rel string) (string, error) {
	if app == "" || strings.ContainsAny(app, `/\`) || app == "." || app == ".." {
		return "", fmt.Errorf("bad app")
	}
	if !filepath.IsLocal(filepath.FromSlash(rel)) {
		return "", fmt.Errorf("bad path")
	}
	return filepath.Join(dataPath(app), filepath.FromSlash(rel)), nil
}

// ownerOf returns uid/gid of the nearest existing folder, so written files belong to whoever
// owns the app's data (1000:1000 for most apps) and the app can still write them.
func ownerOf(dir string) (int, int) {
	for d := dir; ; d = filepath.Dir(d) {
		if fi, err := os.Stat(d); err == nil {
			if st, ok := fi.Sys().(*syscall.Stat_t); ok {
				return int(st.Uid), int(st.Gid)
			}
			return -1, -1
		}
		if d == filepath.Dir(d) {
			return -1, -1
		}
	}
}

func mkdirOwned(dir string) error {
	if _, err := os.Stat(dir); err == nil {
		return nil
	}
	uid, gid := ownerOf(dir)
	if err := mkdirOwned(filepath.Dir(dir)); err != nil {
		return err
	}
	if err := os.Mkdir(dir, 0o755); err != nil && !os.IsExist(err) {
		return err
	}
	if uid >= 0 {
		os.Chown(dir, uid, gid)
	}
	return nil
}

// putFile writes a file atomically, keeping the owner of the target (or its folder).
func putFile(path string, data []byte, mode uint32) error {
	dir := filepath.Dir(path)
	if err := mkdirOwned(dir); err != nil {
		return err
	}
	uid, gid := ownerOf(dir)
	if fi, err := os.Stat(path); err == nil {
		if st, ok := fi.Sys().(*syscall.Stat_t); ok {
			uid, gid = int(st.Uid), int(st.Gid)
		}
	}
	if mode == 0 {
		mode = 0o644
	}
	tmp := path + ".tukor-tmp"
	if err := os.WriteFile(tmp, data, os.FileMode(mode)); err != nil {
		return err
	}
	os.Chmod(tmp, os.FileMode(mode))
	if uid >= 0 {
		os.Chown(tmp, uid, gid)
	}
	return os.Rename(tmp, path)
}

// copyTree copies a folder (used for backups).
func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(src, p)
		t := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(t, 0o700)
		}
		if !d.Type().IsRegular() || skipName(d.Name()) {
			return nil
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return nil
		}
		return os.WriteFile(t, b, 0o600)
	})
}

// prune keeps the newest `keep` folders in dataDir/backups that start with prefix.
func prune(prefix string, keep int) {
	root := filepath.Join(dataDir, "backups")
	ents, _ := os.ReadDir(root)
	var names []string
	for _, e := range ents {
		if e.IsDir() && strings.HasPrefix(e.Name(), prefix) {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for len(names) > keep {
		os.RemoveAll(filepath.Join(root, names[0]))
		names = names[1:]
	}
}

// validContent refuses half-written JSON files (an app may be saving at the moment we read).
func validContent(path string, b []byte) bool {
	if strings.HasSuffix(strings.ToLower(path), ".json") {
		return json.Valid(b)
	}
	return true
}

// ---------- starting and stopping the apps ----------

type controller interface {
	Stop(app string) error
	Start(app string) error
	Running(app string) (bool, error)
}

func newController() controller {
	if c := os.Getenv("CONTROL_CMD"); c != "" {
		return execCtl{c}
	}
	sock := env("DOCKER_SOCK", "/var/run/docker.sock")
	return &dockerCtl{client: &http.Client{
		Timeout: 90 * time.Second,
		Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", sock)
		}},
	}}
}

// execCtl runs "<cmd> start|stop|running <app>" (used by the tests).
type execCtl struct{ cmd string }

func (e execCtl) run(op, app string) ([]byte, error) {
	return exec.Command(e.cmd, op, app).CombinedOutput()
}
func (e execCtl) Stop(app string) error  { _, err := e.run("stop", app); return err }
func (e execCtl) Start(app string) error { _, err := e.run("start", app); return err }
func (e execCtl) Running(app string) (bool, error) {
	out, err := e.run("running", app)
	return strings.TrimSpace(string(out)) == "yes", err
}

type dockerCtl struct{ client *http.Client }

type ctr struct {
	ID     string            `json:"Id"`
	State  string            `json:"State"`
	Labels map[string]string `json:"Labels"`
}

// containers of one Umbrel app (compose project = app id), without its app_proxy.
func (d *dockerCtl) list(app string) ([]ctr, error) {
	f, _ := json.Marshal(map[string][]string{"label": {"com.docker.compose.project=" + app}})
	resp, err := d.client.Get("http://docker/containers/json?all=1&filters=" + url.QueryEscape(string(f)))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("docker: %s", resp.Status)
	}
	var all, out []ctr
	if err := json.NewDecoder(resp.Body).Decode(&all); err != nil {
		return nil, err
	}
	for _, c := range all {
		if c.Labels["com.docker.compose.service"] != "app_proxy" {
			out = append(out, c)
		}
	}
	return out, nil
}

func (d *dockerCtl) post(path string) error {
	resp, err := d.client.Post("http://docker"+path, "application/json", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 && resp.StatusCode != 304 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 300))
		return fmt.Errorf("docker %s: %s %s", path, resp.Status, strings.TrimSpace(string(b)))
	}
	return nil
}

func (d *dockerCtl) Stop(app string) error {
	cs, err := d.list(app)
	if err != nil {
		return err
	}
	for _, c := range cs {
		if c.State == "running" || c.State == "restarting" {
			if err := d.post("/containers/" + c.ID + "/stop?t=15"); err != nil {
				return err
			}
		}
	}
	return nil
}

func (d *dockerCtl) Start(app string) error {
	cs, err := d.list(app)
	if err != nil {
		return err
	}
	if len(cs) == 0 {
		return fmt.Errorf("nincs ilyen app telepítve: %s", app)
	}
	for _, c := range cs {
		if c.State != "running" {
			if err := d.post("/containers/" + c.ID + "/start"); err != nil {
				return err
			}
		}
	}
	return nil
}

func (d *dockerCtl) Running(app string) (bool, error) {
	cs, err := d.list(app)
	if err != nil {
		return false, err
	}
	for _, c := range cs {
		if c.State == "running" || c.State == "restarting" {
			return true, nil
		}
	}
	return false, nil
}

// waitUp waits until the app answers on its port with something other than a gateway error
// (Umbrel's app_proxy answers even while the app itself is still starting).
func waitUp(port int, limit time.Duration) bool {
	cl := &http.Client{Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	end := time.Now().Add(limit)
	for time.Now().Before(end) {
		resp, err := cl.Get(fmt.Sprintf("http://127.0.0.1:%d/", port+localShift))
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode < 500 {
				return true
			}
		}
		time.Sleep(time.Second)
	}
	return false
}
