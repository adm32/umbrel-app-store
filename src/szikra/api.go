// Szikra – the JSON API the page talks to.
package main

import (
	"encoding/json"
	"errors"
	"math/rand/v2"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

type server struct {
	lib      *Library
	profiles *Profiles
	libJSON  []byte
	rngMu    sync.Mutex
	rng      *rand.Rand
	now      func() time.Time
}

func (s *server) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/library", s.library)
	mux.HandleFunc("GET /api/profiles", s.listProfiles)
	mux.HandleFunc("POST /api/profiles", s.addProfile)
	mux.HandleFunc("PUT /api/profiles/{id}", s.editProfile)
	mux.HandleFunc("GET /api/state", s.state)
	mux.HandleFunc("GET /api/session", s.session)
	mux.HandleFunc("POST /api/answer", s.answer)
	mux.HandleFunc("POST /api/seen", s.seen)
	mux.HandleFunc("POST /api/finish", s.finish)
	mux.HandleFunc("PUT /api/exam", s.exam)
	mux.HandleFunc("POST /api/reset", s.reset)
	mux.HandleFunc("GET /api/export", s.export)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })
}

func (s *server) library(w http.ResponseWriter, r *http.Request) {
	sendStatic(w, r, "library.json", s.libJSON, "application/json; charset=utf-8", "no-cache")
}

// buildLibraryJSON is everything the page shows outside a round: subjects, topics, notes, poems.
// The cards themselves only travel in rounds.
func buildLibraryJSON(lib *Library) ([]byte, error) {
	var subs []Subject
	for _, s := range lib.Subjects {
		c := *s
		c.Topics = nil
		for _, t := range s.Topics {
			tc := *t
			tc.Cards = nil
			c.Topics = append(c.Topics, &tc)
		}
		subs = append(subs, c)
	}
	return json.Marshal(map[string]any{"version": version, "subjects": subs})
}

// ---- state ----

type TopicState struct {
	ID      string  `json:"id"`
	Known   float64 `json:"known"`
	Total   int     `json:"total"`
	Fresh   int     `json:"fresh"`
	Due     int     `json:"due"`
	Learned int     `json:"learned"` // box 3 or higher
}

type PoemState struct {
	ID    string  `json:"id"`
	Known float64 `json:"known"`
	Memo  float64 `json:"memo,omitempty"`
	Cards int     `json:"cards"`
}

type SubjectState struct {
	ID    string  `json:"id"`
	Known float64 `json:"known"`
	Total int     `json:"total"`
	Fresh int     `json:"fresh"`
	Due   int     `json:"due"`
}

type HistDay struct {
	Date string `json:"date"`
	Day
}

type StateResp struct {
	Version   string         `json:"version"`
	Now       int64          `json:"now"`
	XP        int            `json:"xp"`
	Level     LevelInfo      `json:"level"`
	Streak    int            `json:"streak"`
	TodayDone bool           `json:"todayDone"`
	Today     Day            `json:"today"`
	Exam      Exam           `json:"exam"`
	ExamTS    int64          `json:"examTs"`
	Subjects  []SubjectState `json:"subjects"`
	Topics    []TopicState   `json:"topics"`
	Poems     []PoemState    `json:"poems"`
	Badges    []Badge        `json:"badges"`
	BestCombo int            `json:"bestCombo"`
	Rounds    int            `json:"rounds"`
	NextDue   int64          `json:"nextDue"`
	History   []HistDay      `json:"history"`
}

func (s *server) buildState(p *Progress, now time.Time) StateResp {
	out := StateResp{Version: version, Now: now.Unix(), XP: p.XP, Level: levelFor(p.XP), Exam: p.Exam, BestCombo: p.BestCombo, Rounds: p.Rounds}
	if et := p.examTime(); !et.IsZero() {
		out.ExamTS = et.Unix()
	}
	out.Streak, out.TodayDone = streak(p, now)
	if d := p.Days[now.In(loc).Format("2006-01-02")]; d != nil {
		out.Today = *d
	}
	poemCards := map[string][]*Card{}
	for _, c := range s.lib.All {
		if c.P != "" {
			poemCards[c.P] = append(poemCards[c.P], c)
		}
	}
	for _, subj := range s.lib.Subjects {
		ss := SubjectState{ID: subj.ID}
		sum := 0.0
		for _, t := range subj.Topics {
			ts := TopicState{ID: t.ID, Total: len(t.Cards)}
			tsum := 0.0
			for _, c := range t.Cards {
				st := p.Cards[c.ID]
				k := known(st, now)
				tsum += k
				switch {
				case st == nil || st.Box == 0:
					ts.Fresh++
				case isDue(st, now):
					ts.Due++
				}
				if st != nil && st.Box >= 3 {
					ts.Learned++
				}
				if st != nil && st.Box > 0 && st.Due > now.Unix() && (out.NextDue == 0 || st.Due < out.NextDue) {
					out.NextDue = st.Due
				}
			}
			if ts.Total > 0 {
				ts.Known = round3(tsum / float64(ts.Total))
			}
			sum += tsum
			ss.Total += ts.Total
			ss.Fresh += ts.Fresh
			ss.Due += ts.Due
			out.Topics = append(out.Topics, ts)
			for _, po := range t.Poems {
				cards := poemCards[po.ID]
				ps := PoemState{ID: po.ID, Cards: len(cards)}
				psum := 0.0
				for _, c := range cards {
					psum += known(p.Cards[c.ID], now)
				}
				if len(cards) > 0 {
					ps.Known = round3(psum / float64(len(cards)))
				}
				if po.Memo {
					ps.Memo = round3(poemMemoKnown(s.lib, p, po.ID, now))
				}
				out.Poems = append(out.Poems, ps)
			}
		}
		if ss.Total > 0 {
			ss.Known = round3(sum / float64(ss.Total))
		}
		out.Subjects = append(out.Subjects, ss)
	}
	for _, b := range allBadges(s.lib) {
		b.At = p.Badges[b.ID]
		out.Badges = append(out.Badges, b)
	}
	d := now.In(loc)
	for i := 13; i >= 0; i-- {
		k := d.AddDate(0, 0, -i).Format("2006-01-02")
		h := HistDay{Date: k}
		if x := p.Days[k]; x != nil {
			h.Day = *x
		}
		out.History = append(out.History, h)
	}
	return out
}

func round3(f float64) float64 { return float64(int(f*1000+0.5)) / 1000 }

func (s *server) state(w http.ResponseWriter, r *http.Request) {
	store := s.storeFor(w, r)
	if store == nil {
		return
	}
	var out StateResp
	store.view(func(p *Progress) { out = s.buildState(p, s.now()) })
	writeJSON(w, out)
}

// ---- rounds ----

func (s *server) session(w http.ResponseWriter, r *http.Request) {
	store := s.storeFor(w, r)
	if store == nil {
		return
	}
	q := SessionQuery{Mode: r.URL.Query().Get("mode"), Subject: r.URL.Query().Get("subject"),
		Topic: r.URL.Query().Get("topic"), Poem: r.URL.Query().Get("poem"), Kind: r.URL.Query().Get("kind")}
	var out Session
	store.view(func(p *Progress) {
		s.rngMu.Lock()
		out = buildSession(s.lib, p, q, s.now(), s.rng)
		s.rngMu.Unlock()
	})
	writeJSON(w, out)
}

type answerReq struct {
	ID    string `json:"id"`
	OK    bool   `json:"ok"`
	Retry bool   `json:"retry"`
	Combo int    `json:"combo"`
	At    int64  `json:"at"` // when it was answered (queued answers arrive late)
}

func (s *server) answer(w http.ResponseWriter, r *http.Request) {
	store := s.storeFor(w, r)
	if store == nil {
		return
	}
	var req answerReq
	if !readBody(w, r, &req) {
		return
	}
	c := s.lib.Cards[req.ID]
	if c == nil {
		// content changed since the page loaded: nothing to record, but no reason to fail
		writeJSON(w, map[string]any{"gained": 0, "unknown": true})
		return
	}
	now := s.now()
	at := now
	if req.At > 0 && req.At <= now.Unix() && now.Unix()-req.At < 7*24*3600 {
		at = time.Unix(req.At, 0)
	}
	if req.Combo < 0 || req.Combo > 1000 {
		req.Combo = 0
	}
	var resp map[string]any
	err := store.update(func(p *Progress) error {
		st := p.Cards[c.ID]
		if st == nil {
			st = &CardState{}
			p.Cards[c.ID] = st
		}
		if !req.Retry {
			schedule(st, req.OK, at, p.examTime())
			d := p.day(at)
			d.A++
			if req.OK {
				d.C++
			}
		}
		g := gainedXP(c, req.OK, req.Retry, req.Combo)
		p.XP += g
		p.day(at).XP += g
		if req.Combo > p.BestCombo {
			p.BestCombo = req.Combo
		}
		resp = map[string]any{"gained": g, "xp": p.XP, "level": levelFor(p.XP), "box": st.Box, "due": st.Due}
		return nil
	})
	if err != nil {
		http.Error(w, "save failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, resp)
}

func (s *server) seen(w http.ResponseWriter, r *http.Request) {
	store := s.storeFor(w, r)
	if store == nil {
		return
	}
	var req struct {
		ID string `json:"id"`
	}
	if !readBody(w, r, &req) {
		return
	}
	if s.lib.Learn[req.ID] == nil {
		writeJSON(w, map[string]bool{"ok": false})
		return
	}
	_ = store.update(func(p *Progress) error {
		if p.Learn[req.ID] == 0 {
			p.Learn[req.ID] = s.now().Unix()
		}
		return nil
	})
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *server) finish(w http.ResponseWriter, r *http.Request) {
	store := s.storeFor(w, r)
	if store == nil {
		return
	}
	var req RoundStats
	if !readBody(w, r, &req) {
		return
	}
	if req.Secs < 0 || req.Secs > 3600 {
		req.Secs = 0
	}
	now := s.now()
	var resp map[string]any
	err := store.update(func(p *Progress) error {
		p.Rounds++
		d := p.day(now)
		d.R++
		d.S += req.Secs
		if req.MaxCombo > p.BestCombo && req.MaxCombo <= 1000 {
			p.BestCombo = req.MaxCombo
		}
		got := awardBadges(s.lib, p, req, now)
		st, done := streak(p, now)
		resp = map[string]any{"badges": got, "streak": st, "todayDone": done, "xp": p.XP, "level": levelFor(p.XP), "rounds": p.Rounds}
		return nil
	})
	if err != nil {
		http.Error(w, "save failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, resp)
}

func (s *server) exam(w http.ResponseWriter, r *http.Request) {
	store := s.storeFor(w, r)
	if store == nil {
		return
	}
	var req Exam
	if !readBody(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if utf8.RuneCountInString(req.Name) > 60 {
		req.Name = string([]rune(req.Name)[:60])
	}
	if req.Name == "" {
		req.Name = "Számonkérés"
	}
	if req.At != "" {
		if _, err := time.ParseInLocation("2006-01-02T15:04", req.At, loc); err != nil {
			http.Error(w, "bad date", http.StatusBadRequest)
			return
		}
	}
	_ = store.update(func(p *Progress) error { p.Exam = req; return nil })
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *server) reset(w http.ResponseWriter, r *http.Request) {
	store := s.storeFor(w, r)
	if store == nil {
		return
	}
	var req struct {
		Confirm string `json:"confirm"`
	}
	if !readBody(w, r, &req) {
		return
	}
	if fold(req.Confirm) != "torles" {
		http.Error(w, "type TÖRLÉS to confirm", http.StatusBadRequest)
		return
	}
	_ = store.update(func(p *Progress) error {
		exam := p.Exam
		*p = *newProgress()
		p.Exam = exam
		return nil
	})
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *server) export(w http.ResponseWriter, r *http.Request) {
	store := s.storeFor(w, r)
	if store == nil {
		return
	}
	var b []byte
	store.view(func(p *Progress) { b, _ = json.MarshalIndent(p, "", " ") })
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", `attachment; filename="szikra-haladas-`+r.URL.Query().Get("p")+`.json"`)
	w.Write(b)
}

// ---- profiles ----

// storeFor finds the profile of a request (X-Profile header, or ?p= for plain links). It
// answers 404 itself when there is none, and the page then shows the profile picker.
func (s *server) storeFor(w http.ResponseWriter, r *http.Request) *Store {
	id := r.URL.Query().Get("p")
	if id == "" {
		id = r.Header.Get("X-Profile")
	}
	st, err := s.profiles.store(id)
	if err != nil {
		http.Error(w, "data error", http.StatusInternalServerError)
		return nil
	}
	if st == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(`{"error":"profile"}`))
		return nil
	}
	return st
}

type ProfileCard struct {
	Profile
	XP        int       `json:"xp"`
	Level     LevelInfo `json:"level"`
	Streak    int       `json:"streak"`
	TodayDone bool      `json:"todayDone"`
	Known     float64   `json:"known"`
}

func (s *server) listProfiles(w http.ResponseWriter, r *http.Request) {
	now := s.now()
	var out []ProfileCard
	for _, pr := range s.profiles.all() {
		pc := ProfileCard{Profile: pr}
		if st, err := s.profiles.store(pr.ID); err == nil && st != nil {
			st.view(func(p *Progress) {
				pc.XP, pc.Level = p.XP, levelFor(p.XP)
				pc.Streak, pc.TodayDone = streak(p, now)
				n, sum := 0, 0.0
				for _, c := range s.lib.All {
					n++
					sum += known(p.Cards[c.ID], now)
				}
				if n > 0 {
					pc.Known = round3(sum / float64(n))
				}
			})
		}
		out = append(out, pc)
	}
	writeJSON(w, out)
}

func (s *server) addProfile(w http.ResponseWriter, r *http.Request) {
	var req Profile
	if !readBody(w, r, &req) {
		return
	}
	p, err := s.profiles.add(req.Name, req.Avatar, req.Theme)
	if err != nil {
		http.Error(w, "bad profile", http.StatusBadRequest)
		return
	}
	writeJSON(w, p)
}

func (s *server) editProfile(w http.ResponseWriter, r *http.Request) {
	var req Profile
	if !readBody(w, r, &req) {
		return
	}
	p, err := s.profiles.edit(r.PathValue("id"), req.Name, req.Avatar, req.Theme)
	if err != nil {
		http.Error(w, "bad profile", http.StatusBadRequest)
		return
	}
	writeJSON(w, p)
}

// ---- helpers ----

func readBody(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			http.Error(w, "too large", http.StatusRequestEntityTooLarge)
		} else {
			http.Error(w, "bad json", http.StatusBadRequest)
		}
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(v)
}
