// Szikra – putting a round together: due repeats, new cards, a short note before new material,
// and the stanza to read before a new memoriter stanza.
package main

import (
	"math/rand/v2"
	"sort"
	"strings"
	"time"
)

type ReadItem struct {
	Poem   string   `json:"poem"`
	Title  string   `json:"title"`
	Stanza int      `json:"stanza"`
	Lines  []string `json:"lines"`
}

type Item struct {
	Kind  string    `json:"kind"` // learn, read, card
	Learn *Learn    `json:"learn,omitempty"`
	Read  *ReadItem `json:"read,omitempty"`
	Card  *Card     `json:"card,omitempty"`
	New   bool      `json:"new,omitempty"`
	Box   int       `json:"box,omitempty"`
}

type Session struct {
	Mode  string `json:"mode"`
	Title string `json:"title"`
	Items []Item `json:"items"`
}

type SessionQuery struct {
	Mode, Subject, Topic, Poem, Kind string
}

const roundSize = 10

func isMemo(c *Card) bool { return strings.HasPrefix(c.K, "m-") }

func buildSession(lib *Library, subjects []*Subject, p *Progress, q SessionQuery, now time.Time, rng *rand.Rand) Session {
	if len(subjects) == 0 {
		return Session{Mode: q.Mode, Items: []Item{}}
	}
	subj := subjects[0]
	for _, s := range subjects {
		if s.ID == q.Subject {
			subj = s
		}
	}
	inSubject := map[string]bool{}
	for _, t := range subj.Topics {
		inSubject[t.ID] = true
	}
	mine := topicSet(subjects) // a topic or poem round only for the profile's own material
	st := func(c *Card) *CardState { return p.Cards[c.ID] }
	fresh := func(c *Card) bool { s := st(c); return s == nil || s.Box == 0 }

	var pool []*Card
	title := "Napi kör"
	n := roundSize
	switch q.Mode {
	case "topic":
		if t := lib.Topics[q.Topic]; t != nil && mine[t.ID] {
			pool, title = t.Cards, t.Name
		}
	case "poem":
		if po := lib.Poems[q.Poem]; po != nil && mine[po.Topic] {
			title = po.Title
			for _, c := range lib.All {
				if c.P == po.ID && !isMemo(c) {
					pool = append(pool, c)
				}
			}
		}
	case "memo":
		if po := lib.Poems[q.Poem]; po != nil && mine[po.Topic] {
			title, n = "Memoriter: "+po.Title, 12
			for _, c := range lib.All {
				if c.P == po.ID && isMemo(c) && (q.Kind == "" || c.K == q.Kind) {
					pool = append(pool, c)
				}
			}
		}
	case "review":
		title = "Ismétlés"
		fallthrough
	default:
		for _, c := range lib.All {
			if inSubject[c.Topic] {
				pool = append(pool, c)
			}
		}
	}

	var due, fresh_, seen []*Card
	for _, c := range pool {
		switch {
		case fresh(c):
			fresh_ = append(fresh_, c)
		case isDue(st(c), now):
			due = append(due, c)
		default:
			seen = append(seen, c)
		}
	}
	sort.SliceStable(due, func(i, j int) bool {
		a, b := st(due[i]), st(due[j])
		if a.Box != b.Box {
			return a.Box < b.Box
		}
		return a.Due < b.Due
	})
	weakest := func(list []*Card, k int, taken map[string]bool) []*Card {
		var c []*Card
		for _, x := range list {
			if !taken[x.ID] {
				c = append(c, x)
			}
		}
		sort.SliceStable(c, func(i, j int) bool {
			ki, kj := known(st(c[i]), now), known(st(c[j]), now)
			if ki != kj {
				return ki < kj
			}
			return st(c[i]).Last < st(c[j]).Last
		})
		if len(c) > 3*k {
			c = c[:3*k]
		}
		rng.Shuffle(len(c), func(i, j int) { c[i], c[j] = c[j], c[i] })
		if len(c) > k {
			c = c[:k]
		}
		return c
	}

	taken := map[string]bool{}
	var reviews, news []*Card
	takeR := func(c *Card) { reviews = append(reviews, c); taken[c.ID] = true }
	takeN := func(c *Card) { news = append(news, c); taken[c.ID] = true }
	total := func() int { return len(reviews) + len(news) }

	switch q.Mode {
	case "topic", "poem", "memo":
		maxDue := 5
		if q.Mode == "memo" {
			maxDue = 6
		}
		for _, c := range due {
			if len(reviews) < maxDue {
				takeR(c)
			}
		}
		// non-memoriter new cards first in a topic round; a memo round is all memoriter
		for _, c := range fresh_ {
			if total() < n && !isMemo(c) {
				takeN(c)
			}
		}
		for _, c := range fresh_ {
			if total() < n && isMemo(c) && !taken[c.ID] {
				takeN(c)
			}
		}
		for _, c := range due {
			if total() < n && !taken[c.ID] {
				takeR(c)
			}
		}
		for _, c := range weakest(seen, n-total(), taken) {
			takeR(c)
		}
	case "review":
		for _, c := range due {
			if len(reviews) < 12 {
				takeR(c)
			}
		}
		if len(reviews) < n {
			for _, c := range weakest(seen, n-len(reviews), taken) {
				takeR(c)
			}
		}
	default: // smart
		// 1) up to two memoriter cards, from the memoriter that is least known
		memoPoem, memoBest := "", 2.0
		for _, s := range []*Subject{subj} {
			for _, t := range s.Topics {
				for _, po := range t.Poems {
					if !po.Memo {
						continue
					}
					has := false
					for _, c := range pool {
						if c.P == po.ID && isMemo(c) && (fresh(c) || isDue(st(c), now)) {
							has = true
							break
						}
					}
					if k := poemMemoKnown(lib, p, po.ID, now); has && k < memoBest {
						memoPoem, memoBest = po.ID, k
					}
				}
			}
		}
		memo := 0
		for _, c := range due {
			if memo < 2 && isMemo(c) && c.P == memoPoem {
				takeR(c)
				memo++
			}
		}
		for _, c := range fresh_ {
			if memo < 2 && isMemo(c) && c.P == memoPoem {
				takeN(c)
				memo++
			}
		}
		// 2) due repeats, at most 6
		for _, c := range due {
			if len(reviews) < 6 && !taken[c.ID] && !isMemo(c) {
				takeR(c)
			}
		}
		// 3) new cards from the least known topic that still has new cards
		var target *Topic
		best := 2.0
		for _, t := range subj.Topics {
			hasNew := false
			for _, c := range t.Cards {
				if fresh(c) && !isMemo(c) {
					hasNew = true
					break
				}
			}
			if k := topicKnown(t, p, now); hasNew && k < best {
				target, best = t, k
			}
		}
		if target != nil {
			title = "Napi kör · " + target.Name
			for _, c := range target.Cards {
				if total() < n && fresh(c) && !isMemo(c) && !taken[c.ID] {
					takeN(c)
				}
			}
		}
		for _, c := range due {
			if total() < n && !taken[c.ID] {
				takeR(c)
			}
		}
		if total() < n {
			for _, c := range weakest(seen, n-total(), taken) {
				takeR(c)
			}
		}
	}

	rng.Shuffle(len(reviews), func(i, j int) { reviews[i], reviews[j] = reviews[j], reviews[i] })
	// a memoriter stanza's cards keep their order (order → gaps → lines), so they stay together
	var seq []*Card
	ri, ni := 0, 0
	if len(reviews) > 0 && len(news) > 0 {
		seq = append(seq, reviews[0]) // warm-up: something already known
		ri = 1
	}
	for ri < len(reviews) || ni < len(news) {
		for k := 0; k < 2 && ni < len(news); k++ {
			seq = append(seq, news[ni])
			ni++
		}
		if ri < len(reviews) {
			seq = append(seq, reviews[ri])
			ri++
		}
	}

	var items []Item
	shownLearn := map[string]bool{}
	shownRead := map[string]bool{}
	for _, c := range seq {
		isNew := fresh(c)
		if isNew && c.L != "" && p.Learn[c.L] == 0 && !shownLearn[c.L] {
			if l := lib.Learn[c.L]; l != nil {
				shownLearn[c.L] = true
				items = append(items, Item{Kind: "learn", Learn: l})
			}
		}
		if isNew && isMemo(c) {
			if r := readFor(lib, c); r != nil {
				key := r.Poem + "/" + itoa(r.Stanza)
				if !shownRead[key] && !stanzaStarted(lib, p, c) {
					shownRead[key] = true
					items = append(items, Item{Kind: "read", Read: r})
				}
			}
		}
		box := 0
		if s := st(c); s != nil {
			box = s.Box
		}
		items = append(items, Item{Kind: "card", Card: c, New: isNew, Box: box})
	}
	if items == nil {
		items = []Item{}
	}
	return Session{Mode: q.Mode, Title: title, Items: items}
}

// readFor returns the stanza a memoriter card belongs to (ids end in -<stanza>-<o|c|lN>).
func readFor(lib *Library, c *Card) *ReadItem {
	po := lib.Poems[c.P]
	if po == nil {
		return nil
	}
	parts := strings.Split(c.ID, "-")
	if len(parts) < 2 {
		return nil
	}
	n := atoi(parts[len(parts)-2])
	sts := stanzas(po.Text)
	if n < 1 || n > len(sts) {
		return nil
	}
	return &ReadItem{Poem: po.ID, Title: po.Title, Stanza: n, Lines: sts[n-1]}
}

// stanzaStarted reports whether any card of the same stanza has been answered before.
func stanzaStarted(lib *Library, p *Progress, c *Card) bool {
	prefix := c.ID[:strings.LastIndex(c.ID, "-")+1]
	for id, s := range p.Cards {
		if strings.HasPrefix(id, prefix) && s.Seen > 0 {
			return true
		}
	}
	return false
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

func atoi(s string) int {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0
		}
		n = n*10 + int(r-'0')
	}
	return n
}
