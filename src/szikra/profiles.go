// Szikra – profiles: everyone who studies on this Umbrel has their own progress, XP, streak and
// test date in DATA_DIR/profiles/<id>/. The list is DATA_DIR/profiles.json.
package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"
)

type Profile struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
	Theme  string `json:"theme"`
}

// avatars the page can draw, and its colour themes
var avatars = map[string]bool{"maci": true, "nyuszi": true, "roka": true, "cica": true}
var themes = map[string]bool{"szikra": true, "pink": true}

type Profiles struct {
	mu     sync.Mutex
	dir    string
	list   []Profile
	stores map[string]*Store
}

var defaultProfiles = []Profile{{ID: "adam", Name: "Ádám", Avatar: "maci", Theme: "szikra"}, {ID: "hanna", Name: "Hanna", Avatar: "nyuszi", Theme: "pink"}}

// examFor is the test date a new profile starts with: Ádám's Thursday test, for everyone else
// an érettségi without a date (they set it on the profile page).
func examFor(id string) Exam {
	if id == "adam" {
		return defaultExam
	}
	return Exam{Name: "Érettségi"}
}

func openProfiles(dir string) (*Profiles, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	ps := &Profiles{dir: dir, stores: map[string]*Store{}}
	b, err := os.ReadFile(filepath.Join(dir, "profiles.json"))
	switch {
	case err == nil:
		if err := json.Unmarshal(b, &ps.list); err != nil {
			return nil, err
		}
		for i := range ps.list {
			if !themes[ps.list[i].Theme] {
				ps.list[i].Theme = "szikra"
			}
		}
	case os.IsNotExist(err):
		ps.list = append([]Profile(nil), defaultProfiles...)
		if err := ps.saveLocked(); err != nil {
			return nil, err
		}
	default:
		return nil, err
	}
	// progress from before profiles existed belongs to the first profile
	old := filepath.Join(dir, "progress.json")
	if _, err := os.Stat(old); err == nil && len(ps.list) > 0 {
		pd := filepath.Join(dir, "profiles", ps.list[0].ID)
		if _, err := os.Stat(filepath.Join(pd, "progress.json")); os.IsNotExist(err) {
			if err := os.MkdirAll(pd, 0o755); err == nil {
				_ = os.Rename(old, filepath.Join(pd, "progress.json"))
			}
		}
	}
	return ps, nil
}

func (ps *Profiles) saveLocked() error {
	b, err := json.MarshalIndent(ps.list, "", " ")
	if err != nil {
		return err
	}
	final := filepath.Join(ps.dir, "profiles.json")
	if err := os.WriteFile(final+".tmp", b, 0o644); err != nil {
		return err
	}
	return os.Rename(final+".tmp", final)
}

func (ps *Profiles) all() []Profile {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	return append([]Profile(nil), ps.list...)
}

// store returns the progress of a profile, or nil if there is no such profile.
func (ps *Profiles) store(id string) (*Store, error) {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	if s := ps.stores[id]; s != nil {
		return s, nil
	}
	found := false
	for _, p := range ps.list {
		if p.ID == id {
			found = true
		}
	}
	if !found {
		return nil, nil
	}
	s, err := openStore(filepath.Join(ps.dir, "profiles", id), examFor(id))
	if err != nil {
		return nil, err
	}
	ps.stores[id] = s
	return s, nil
}

var errProfile = errors.New("bad profile")

func cleanName(n string) string {
	n = strings.Join(strings.Fields(n), " ")
	if utf8.RuneCountInString(n) > 24 {
		n = string([]rune(n)[:24])
	}
	return n
}

// add makes a new profile; the id is the name without accents (adam, hanna, hanna-2…).
func (ps *Profiles) add(name, avatar, theme string) (Profile, error) {
	name = cleanName(name)
	if name == "" || !avatars[avatar] {
		return Profile{}, errProfile
	}
	if !themes[theme] {
		theme = "szikra"
	}
	ps.mu.Lock()
	defer ps.mu.Unlock()
	if len(ps.list) >= 8 {
		return Profile{}, errProfile
	}
	base := strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			return r
		}
		if unicode.IsSpace(r) || r == '-' {
			return '-'
		}
		return -1
	}, fold(name))
	base = strings.Trim(base, "-")
	if base == "" {
		base = "profil"
	}
	id := base
	for n := 2; ps.has(id); n++ {
		id = base + "-" + itoa(n)
	}
	p := Profile{ID: id, Name: name, Avatar: avatar, Theme: theme}
	ps.list = append(ps.list, p)
	return p, ps.saveLocked()
}

func (ps *Profiles) has(id string) bool {
	for _, p := range ps.list {
		if p.ID == id {
			return true
		}
	}
	return false
}

func (ps *Profiles) edit(id, name, avatar, theme string) (Profile, error) {
	name = cleanName(name)
	ps.mu.Lock()
	defer ps.mu.Unlock()
	for i, p := range ps.list {
		if p.ID != id {
			continue
		}
		if name != "" {
			p.Name = name
		}
		if avatars[avatar] {
			p.Avatar = avatar
		}
		if themes[theme] {
			p.Theme = theme
		}
		ps.list[i] = p
		return p, ps.saveLocked()
	}
	return Profile{}, errProfile
}
