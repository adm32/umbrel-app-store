// Szikra – the progress file (DATA_DIR/progress.json), written atomically, with a daily copy.
package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type Day struct {
	A  int `json:"a"`  // answers
	C  int `json:"c"`  // correct
	XP int `json:"xp"` // XP earned
	R  int `json:"r"`  // rounds finished
	S  int `json:"s"`  // seconds spent in rounds
}

type Exam struct {
	Name string `json:"name"`
	At   string `json:"at"` // local time, "2006-01-02T15:04"
}

type Progress struct {
	V         int                   `json:"v"`
	Cards     map[string]*CardState `json:"cards"`
	Learn     map[string]int64      `json:"learn"`
	XP        int                   `json:"xp"`
	Days      map[string]*Day       `json:"days"`
	Badges    map[string]int64      `json:"badges"`
	BestCombo int                   `json:"bestCombo"`
	Rounds    int                   `json:"rounds"`
	Exam      Exam                  `json:"exam"`
}

type Store struct {
	mu   sync.Mutex
	dir  string
	p    *Progress
	last string // date of the last daily copy
}

var defaultExam = Exam{Name: "Magyar dolgozat – Ady", At: "2026-11-26T08:00"}

func newProgress() *Progress {
	return &Progress{V: 1, Cards: map[string]*CardState{}, Learn: map[string]int64{}, Days: map[string]*Day{},
		Badges: map[string]int64{}, Exam: defaultExam}
}

// openStore opens (or starts) the progress in dir; exam is the test date a new profile starts with.
func openStore(dir string, exam Exam) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	s := &Store{dir: dir, p: newProgress()}
	s.p.Exam = exam
	b, err := os.ReadFile(filepath.Join(dir, "progress.json"))
	if err == nil {
		p := newProgress()
		if err := json.Unmarshal(b, p); err != nil {
			return nil, err
		}
		if p.Cards == nil {
			p.Cards = map[string]*CardState{}
		}
		if p.Learn == nil {
			p.Learn = map[string]int64{}
		}
		if p.Days == nil {
			p.Days = map[string]*Day{}
		}
		if p.Badges == nil {
			p.Badges = map[string]int64{}
		}
		s.p = p
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	return s, nil
}

// update runs fn with the progress locked and saves it afterwards.
func (s *Store) update(fn func(p *Progress) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := fn(s.p); err != nil {
		return err
	}
	return s.saveLocked()
}

// view runs fn with the progress locked, without saving.
func (s *Store) view(fn func(p *Progress)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn(s.p)
}

func (s *Store) saveLocked() error {
	b, err := json.Marshal(s.p)
	if err != nil {
		return err
	}
	final := filepath.Join(s.dir, "progress.json")
	today := time.Now().In(loc).Format("2006-01-02")
	if s.last != today {
		s.last = today
		s.dailyCopy(final, today)
	}
	tmp := final + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, final)
}

// dailyCopy keeps yesterday's file (as it was before today's first save) for 7 days.
func (s *Store) dailyCopy(final, today string) {
	b, err := os.ReadFile(final)
	if err != nil {
		return
	}
	dir := filepath.Join(s.dir, "backups")
	if os.MkdirAll(dir, 0o755) != nil {
		return
	}
	name := filepath.Join(dir, "progress-"+today+".json")
	if _, err := os.Stat(name); err == nil {
		return
	}
	_ = os.WriteFile(name, b, 0o644)
	entries, _ := os.ReadDir(dir)
	var names []string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "progress-") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for len(names) > 7 {
		_ = os.Remove(filepath.Join(dir, names[0]))
		names = names[1:]
	}
}

func (p *Progress) day(t time.Time) *Day {
	k := t.In(loc).Format("2006-01-02")
	d := p.Days[k]
	if d == nil {
		d = &Day{}
		p.Days[k] = d
	}
	return d
}

func (p *Progress) examTime() time.Time {
	t, err := time.ParseInLocation("2006-01-02T15:04", p.Exam.At, loc)
	if err != nil {
		return time.Time{}
	}
	return t
}
