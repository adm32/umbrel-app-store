package main

import (
	"math/rand/v2"
	"regexp"
	"strings"
	"testing"
	"time"
)

// TestContent checks every card of the study material, so a mistake in a new JSON file fails
// the build instead of showing up as a broken question.
func TestContent(t *testing.T) {
	lib, err := loadLibrary(contentFS)
	if err != nil {
		t.Fatal(err)
	}
	if len(lib.All) < 100 {
		t.Fatalf("only %d cards", len(lib.All))
	}
	blank := regexp.MustCompile(`\[([^\[\]]+)\]`)
	types := map[string]bool{"mc": true, "tf": true, "type": true, "cloze": true, "order": true, "match": true, "sort": true, "flash": true}
	for _, c := range lib.All {
		where := c.ID + " (" + c.Q + c.S + ")"
		if lib.Topics[c.Topic] == nil {
			t.Errorf("%s: no topic", where)
		}
		if !types[c.T] {
			t.Errorf("%s: unknown type %q", where, c.T)
		}
		if c.P != "" && lib.Poems[c.P] == nil {
			t.Errorf("%s: unknown poem %q", where, c.P)
		}
		if c.L != "" && lib.Learn[c.L] == nil {
			t.Errorf("%s: unknown learn card %q", where, c.L)
		}
		switch c.T {
		case "mc":
			if c.A == "" || len(c.X) < 2 {
				t.Errorf("%s: mc needs an answer and 2+ distractors", where)
			}
			seen := map[string]bool{fold(c.A): true}
			for _, x := range c.X {
				if seen[fold(x)] {
					t.Errorf("%s: duplicate option %q", where, x)
				}
				seen[fold(x)] = true
			}
		case "tf":
			if c.OK == nil || c.Q == "" {
				t.Errorf("%s: tf needs q and ok", where)
			}
		case "type", "flash":
			if c.A == "" {
				t.Errorf("%s: no answer", where)
			}
			if c.K == "m-line" && (c.Hole < 1 || c.Hole > len(c.Items) || c.Items[c.Hole-1] != c.A) {
				t.Errorf("%s: bad hole", where)
			}
		case "cloze":
			m := blank.FindAllStringSubmatch(c.S, -1)
			if len(m) == 0 {
				t.Errorf("%s: cloze without [blanks]", where)
			}
			ans := map[string]bool{}
			for _, x := range m {
				ans[fold(x[1])] = true
			}
			for _, x := range c.X {
				if ans[fold(x)] {
					t.Errorf("%s: distractor %q is also an answer", where, x)
				}
			}
		case "order":
			if len(c.Items) < 3 {
				t.Errorf("%s: order needs 3+ items", where)
			}
			if dup(c.Items) {
				t.Errorf("%s: duplicate order items", where)
			}
		case "match":
			if len(c.Pairs) < 3 || len(c.Pairs) > 5 {
				t.Errorf("%s: match needs 3–5 pairs", where)
			}
			var l, r []string
			for _, p := range c.Pairs {
				l, r = append(l, p[0]), append(r, p[1])
			}
			if dup(l) || dup(r) {
				t.Errorf("%s: duplicate match side", where)
			}
		case "sort":
			if len(c.Cats) != 2 || len(c.CA) == 0 || len(c.CB) == 0 || len(c.CA)+len(c.CB) > 9 {
				t.Errorf("%s: sort needs 2 cats and 2–9 items", where)
			}
			if dup(append(append([]string(nil), c.CA...), c.CB...)) {
				t.Errorf("%s: duplicate sort items", where)
			}
		}
	}
	for _, p := range lib.Poems {
		if p.Memo && len(stanzas(p.Text)) == 0 {
			t.Errorf("memoriter %s has no text", p.ID)
		}
	}
	// every poem with text gets quote cards
	for _, p := range lib.Poems {
		if p.Text == "" {
			continue
		}
		n := 0
		for _, c := range lib.All {
			if c.P == p.ID && c.K == "quote" {
				n++
			}
		}
		if n == 0 {
			t.Errorf("poem %s: no quote card", p.ID)
		}
	}
}

func dup(s []string) bool {
	m := map[string]bool{}
	for _, x := range s {
		if m[fold(x)] {
			return true
		}
		m[fold(x)] = true
	}
	return false
}

func TestFold(t *testing.T) {
	if got := fold("Őrizem a  szemed!"); got != "orizem a szemed" {
		t.Fatalf("fold = %q", got)
	}
}

func TestScheduleBeforeExam(t *testing.T) {
	now := time.Date(2026, 11, 23, 23, 0, 0, 0, loc)
	exam := now.Add(56 * time.Hour)
	st := &CardState{}
	for i := 0; i < 5; i++ {
		schedule(st, true, now, exam)
		if d := time.Unix(st.Due, 0).Sub(now); d > exam.Sub(now)/2+time.Second {
			t.Fatalf("box %d: interval %v longer than half the time to the exam", st.Box, d)
		}
		now = time.Unix(st.Due, 0)
	}
	if st.Box != 5 || known(st, now) != 1 {
		t.Fatalf("box %d known %v", st.Box, known(st, now))
	}
	schedule(st, false, now, exam)
	if st.Box != 3 {
		t.Fatalf("wrong answer: box %d, want 3", st.Box)
	}
}

func TestSessions(t *testing.T) {
	lib, err := loadLibrary(contentFS)
	if err != nil {
		t.Fatal(err)
	}
	p := newProgress()
	now := time.Date(2026, 11, 23, 23, 0, 0, 0, loc)
	rng := rand.New(rand.NewPCG(1, 2))
	s := buildSession(lib, lib.Subjects, p, SessionQuery{}, now, rng)
	graded, learn := 0, 0
	for _, it := range s.Items {
		switch it.Kind {
		case "card":
			graded++
		case "learn":
			learn++
		}
	}
	if graded != roundSize || learn == 0 {
		t.Fatalf("first smart round: %d cards, %d notes", graded, learn)
	}
	memo := 0
	for _, it := range s.Items {
		if it.Card != nil && isMemo(it.Card) {
			memo++
		}
	}
	if memo != 2 {
		t.Fatalf("first smart round has %d memoriter cards, want 2", memo)
	}
	// answer everything right; the next round must bring new cards
	for _, it := range s.Items {
		if it.Card != nil {
			st := &CardState{}
			schedule(st, true, now, p.examTime())
			p.Cards[it.Card.ID] = st
		}
		if it.Learn != nil {
			p.Learn[it.Learn.ID] = now.Unix()
		}
	}
	s2 := buildSession(lib, lib.Subjects, p, SessionQuery{}, now.Add(time.Minute), rng)
	for _, it := range s2.Items {
		if it.Card != nil && p.Cards[it.Card.ID] != nil {
			t.Fatalf("second round repeats %s before it is due", it.Card.ID)
		}
	}
	// a memoriter round starts with the stanza to read
	m := buildSession(lib, lib.Subjects, newProgress(), SessionQuery{Mode: "memo", Poem: "gog"}, now, rng)
	if len(m.Items) == 0 || m.Items[0].Kind == "card" {
		t.Fatalf("memo round should start with a note or the stanza")
	}
	hasRead := false
	for _, it := range m.Items {
		if it.Kind == "read" {
			hasRead = true
			if !strings.HasPrefix(it.Read.Lines[0], "Góg és Magóg") {
				t.Fatalf("first stanza: %q", it.Read.Lines[0])
			}
			break
		}
	}
	if !hasRead {
		t.Fatal("no stanza to read in the memo round")
	}
}
