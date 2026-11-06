package main

// Latest Instagram posts for the website, through the Instagram API with Instagram Login
// (needs a professional – creator or business – account and a long-lived access token).
// The app fetches the posts every hour, keeps copies of the pictures in data/ig/ and serves
// them itself, so visitors of the website never load anything from Instagram (no cookies,
// no tracking). The token lasts 60 days; it is refreshed once a week, which keeps it alive.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	igMaxPosts       = 12
	igDefaultUser    = "csaszkobarbershop69"
	igRefreshEvery   = 7 * 24 * time.Hour
	igSyncEvery      = time.Hour
	igMaxImageBytes  = 12 << 20
	igCaptionRunes   = 220
	igTokenMinLength = 20
)

var (
	igAPI    = strings.TrimRight(envOr("IG_API", "https://graph.instagram.com"), "/")
	igMu     sync.Mutex // guards igFeed and the files in data/ig
	igFeed   = &IGFeed{Posts: []IGPost{}}
	reIGID   = regexp.MustCompile(`^[0-9]{3,40}$`)
	reIGUser = regexp.MustCompile(`^[A-Za-z0-9._]{1,30}$`)
	igClient = &http.Client{Timeout: 20 * time.Second}
)

type IGPost struct {
	ID      string `json:"id"`
	Link    string `json:"link"`
	Caption string `json:"caption,omitempty"`
	Video   bool   `json:"video,omitempty"`
	Date    string `json:"date,omitempty"`
	Type    string `json:"type"` // content type of the stored picture
}

type IGFeed struct {
	FetchedAt string   `json:"fetchedAt,omitempty"`
	Error     string   `json:"error,omitempty"`
	ErrorAt   string   `json:"errorAt,omitempty"`
	Posts     []IGPost `json:"posts"`
}

func igDir() string      { return filepath.Join(dataDir, "ig") }
func igFeedFile() string { return filepath.Join(dataDir, "instagram.json") }

func loadIG() {
	igMu.Lock()
	defer igMu.Unlock()
	readJSON(igFeedFile(), igFeed)
	if igFeed.Posts == nil {
		igFeed.Posts = []IGPost{}
	}
}

// igUser: callers hold mu.
func igUser() string {
	if settings.IGUser != "" {
		return settings.IGUser
	}
	return igDefaultUser
}

// igStatus is shown in the admin app. Callers hold mu.
func igStatus() obj {
	igMu.Lock()
	defer igMu.Unlock()
	return obj{"connected": settings.IGToken != "", "user": igUser(), "count": len(igFeed.Posts),
		"fetchedAt": igFeed.FetchedAt, "error": igFeed.Error, "errorAt": igFeed.ErrorAt, "refreshedAt": settings.IGRefreshedAt}
}

/* ------------------------------------------------------------ public */

func igPublic(w http.ResponseWriter) {
	mu.Lock()
	user, connected := igUser(), settings.IGToken != ""
	mu.Unlock()
	igMu.Lock()
	posts := []obj{}
	if connected {
		for _, p := range igFeed.Posts {
			posts = append(posts, obj{"id": p.ID, "img": "/api/ig/" + p.ID, "link": p.Link, "caption": p.Caption, "video": p.Video, "date": p.Date})
		}
	}
	igMu.Unlock()
	w.Header().Set("Cache-Control", "no-store")
	send(w, 200, obj{"user": user, "profile": "https://www.instagram.com/" + user + "/", "posts": posts})
}

func igImage(w http.ResponseWriter, r *http.Request, id string) {
	if !reIGID.MatchString(id) {
		send(w, 404, obj{"error": "not found"})
		return
	}
	igMu.Lock()
	var post *IGPost
	for i := range igFeed.Posts {
		if igFeed.Posts[i].ID == id {
			post = &igFeed.Posts[i]
		}
	}
	var b []byte
	var err error
	if post != nil {
		b, err = os.ReadFile(filepath.Join(igDir(), id))
	}
	ctype := "image/jpeg"
	if post != nil && post.Type != "" {
		ctype = post.Type
	}
	igMu.Unlock()
	if post == nil || err != nil {
		send(w, 404, obj{"error": "not found"})
		return
	}
	h := w.Header()
	h.Set("Content-Type", ctype)
	h.Set("Cache-Control", "public, max-age=86400")
	h.Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(200)
	if r.Method != "HEAD" {
		w.Write(b)
	}
}

/* ------------------------------------------------------------ fetching */

type igErr struct {
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    int    `json:"code"`
	} `json:"error"`
}

func igGet(u string, v any) error {
	res, err := igClient.Get(u)
	if err != nil {
		return errors.New("Az Instagram nem érhető el (nincs internet?).")
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if res.StatusCode != 200 {
		var e igErr
		if json.Unmarshal(b, &e) == nil && e.Error != nil {
			if e.Error.Code == 190 || e.Error.Type == "OAuthException" {
				return errors.New("Az Instagram nem fogadta el a tokent (lejárt vagy hibás). Kérj újat, és mentsd el.")
			}
			return errors.New("Instagram hiba: " + cut(e.Error.Message, 160))
		}
		return fmt.Errorf("Instagram hiba (HTTP %d).", res.StatusCode)
	}
	if err := json.Unmarshal(b, v); err != nil {
		return errors.New("Érthetetlen válasz az Instagramtól.")
	}
	return nil
}

type igMedia struct {
	ID        string `json:"id"`
	Type      string `json:"media_type"`
	URL       string `json:"media_url"`
	Thumb     string `json:"thumbnail_url"`
	Permalink string `json:"permalink"`
	Caption   string `json:"caption"`
	Timestamp string `json:"timestamp"`
}

func downloadImage(src, dst string) (string, error) {
	u, err := url.Parse(src)
	if err != nil || (u.Scheme != "https" && !strings.HasPrefix(igAPI, "http://")) {
		return "", errors.New("bad image url")
	}
	res, err := igClient.Get(src)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	ct := strings.ToLower(strings.TrimSpace(strings.Split(res.Header.Get("Content-Type"), ";")[0]))
	if res.StatusCode != 200 || !(ct == "image/jpeg" || ct == "image/png" || ct == "image/webp" || ct == "image/heic") {
		return "", fmt.Errorf("image: HTTP %d %s", res.StatusCode, ct)
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, igMaxImageBytes+1))
	if err != nil || len(b) > igMaxImageBytes || len(b) == 0 {
		return "", errors.New("image too large or empty")
	}
	tmp := dst + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return "", err
	}
	return ct, os.Rename(tmp, dst)
}

// syncIG fetches the latest posts and their pictures. Safe to call any time; one at a time.
var igSyncing sync.Mutex

func syncIG() error {
	igSyncing.Lock()
	defer igSyncing.Unlock()
	mu.Lock()
	token := settings.IGToken
	mu.Unlock()
	if token == "" {
		return nil
	}
	fail := func(err error) error {
		igMu.Lock()
		igFeed.Error, igFeed.ErrorAt = err.Error(), isoNow()
		writeJSON(igFeedFile(), igFeed)
		igMu.Unlock()
		log.Print("[instagram] ", err)
		return err
	}
	var list struct {
		Data []igMedia `json:"data"`
	}
	q := url.Values{"fields": {"id,media_type,media_url,thumbnail_url,permalink,caption,timestamp"}, "limit": {"20"}, "access_token": {token}}
	if err := igGet(igAPI+"/me/media?"+q.Encode(), &list); err != nil {
		return fail(err)
	}
	if err := os.MkdirAll(igDir(), 0o755); err != nil {
		return fail(err)
	}
	igMu.Lock()
	have := map[string]IGPost{}
	for _, p := range igFeed.Posts {
		have[p.ID] = p
	}
	igMu.Unlock()

	posts := []IGPost{}
	seen := map[string]bool{}
	for _, m := range list.Data {
		if len(posts) >= igMaxPosts {
			break
		}
		if !reIGID.MatchString(m.ID) || seen[m.ID] {
			continue
		}
		seen[m.ID] = true
		src := m.URL
		if m.Type == "VIDEO" {
			src = m.Thumb // the website shows the cover picture and links to the video
		}
		if src == "" {
			continue
		}
		p := IGPost{ID: m.ID, Video: m.Type == "VIDEO", Caption: cut(strings.TrimSpace(m.Caption), igCaptionRunes)}
		if strings.HasPrefix(m.Permalink, "https://www.instagram.com/") {
			p.Link = m.Permalink
		}
		if t, err := time.Parse("2006-01-02T15:04:05-0700", m.Timestamp); err == nil {
			p.Date = t.In(loc).Format("2006-01-02")
		}
		file := filepath.Join(igDir(), m.ID)
		if old, ok := have[m.ID]; ok && fileExists(file) {
			p.Type = old.Type
		} else {
			ct, err := downloadImage(src, file)
			if err != nil {
				log.Printf("[instagram] picture %s: %v", m.ID, err)
				continue
			}
			p.Type = ct
		}
		posts = append(posts, p)
	}

	igMu.Lock()
	igFeed.Posts, igFeed.FetchedAt, igFeed.Error, igFeed.ErrorAt = posts, isoNow(), "", ""
	writeJSON(igFeedFile(), igFeed)
	keep := map[string]bool{}
	for _, p := range posts {
		keep[p.ID] = true
	}
	if entries, err := os.ReadDir(igDir()); err == nil {
		for _, e := range entries {
			if !keep[e.Name()] {
				os.Remove(filepath.Join(igDir(), e.Name()))
			}
		}
	}
	igMu.Unlock()
	return nil
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

// refreshIGToken extends the 60-day token. Instagram only refreshes tokens that are at least a day old.
func refreshIGToken(force bool) {
	mu.Lock()
	token, last := settings.IGToken, settings.IGRefreshedAt
	mu.Unlock()
	if token == "" {
		return
	}
	if t, err := time.Parse(time.RFC3339Nano, last); err == nil && !force && time.Since(t) < igRefreshEvery {
		return
	}
	var out struct {
		Token     string `json:"access_token"`
		ExpiresIn int64  `json:"expires_in"`
	}
	q := url.Values{"grant_type": {"ig_refresh_token"}, "access_token": {token}}
	if err := igGet(igAPI+"/refresh_access_token?"+q.Encode(), &out); err != nil {
		log.Print("[instagram] token refresh: ", err)
		return
	}
	mu.Lock()
	if settings.IGToken == token && out.Token != "" { // not replaced in the meantime
		settings.IGToken, settings.IGRefreshedAt = out.Token, isoNow()
		saveSettings()
	}
	mu.Unlock()
	log.Print("[instagram] token refreshed")
}

// clearIG forgets the posts and pictures (when the token is removed).
func clearIG() {
	igMu.Lock()
	igFeed.Posts, igFeed.FetchedAt, igFeed.Error, igFeed.ErrorAt = []IGPost{}, "", "", ""
	writeJSON(igFeedFile(), igFeed)
	os.RemoveAll(igDir())
	igMu.Unlock()
}

func igLoop() {
	time.Sleep(15 * time.Second)
	for {
		refreshIGToken(false)
		syncIG()
		time.Sleep(igSyncEvery)
	}
}
