// Szikra – the study material: loading content/<subject>/*.json, checking it, and generating the
// quote-recognition and memoriter cards from the poem texts.
package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"io/fs"
	"path"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

//go:embed content
var contentFS embed.FS

type Subject struct {
	ID     string   `json:"id"`
	For    []string `json:"for,omitempty"` // profile ids that study this subject; empty = everyone
	Name   string   `json:"name"`
	Icon   string   `json:"icon"`
	Color  string   `json:"color"`
	Units  []*Unit  `json:"units"`
	Topics []*Topic `json:"topics"`
}

type Unit struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Sub  string `json:"sub,omitempty"`
}

type Link struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}

type Learn struct {
	ID    string   `json:"id"` // topic/local after loading
	Title string   `json:"title"`
	B     []string `json:"b"`
	P     string   `json:"p,omitempty"`
	Topic string   `json:"topic"`
}

type Poem struct {
	ID    string   `json:"id"`
	Title string   `json:"title"`
	Year  string   `json:"year,omitempty"`
	Vol   string   `json:"vol,omitempty"`
	Memo  bool     `json:"memo,omitempty"`
	Video string   `json:"video,omitempty"`
	Ded   string   `json:"ded,omitempty"`
	Motto string   `json:"motto,omitempty"`
	Text  string   `json:"text,omitempty"`
	Notes []string `json:"notes,omitempty"`
	Topic string   `json:"topic"`
}

// Card is one exercise. Which fields are used depends on T:
// mc (A, X), tf (OK), type (A, Alt; Items+Hole for a memoriter line), cloze (S with [answers], X),
// order (Items in the right order), match (Pairs), sort (Cats, CA, CB), flash (A).
type Card struct {
	ID    string      `json:"id"`
	T     string      `json:"t"`
	Q     string      `json:"q,omitempty"`
	A     string      `json:"a,omitempty"`
	OK    *bool       `json:"ok,omitempty"`
	X     []string    `json:"x,omitempty"`
	Alt   []string    `json:"alt,omitempty"`
	S     string      `json:"s,omitempty"`
	Items []string    `json:"items,omitempty"`
	Hole  int         `json:"hole,omitempty"`
	Pairs [][2]string `json:"pairs,omitempty"`
	Cats  []string    `json:"cats,omitempty"`
	CA    []string    `json:"ca,omitempty"`
	CB    []string    `json:"cb,omitempty"`
	W     string      `json:"w,omitempty"`
	P     string      `json:"p,omitempty"`
	L     string      `json:"l,omitempty"`
	K     string      `json:"k,omitempty"` // generated: quote, m-order, m-cloze, m-line
	Topic string      `json:"topic"`
}

type Topic struct {
	Unit  string   `json:"unit"`
	ID    string   `json:"id"`
	Order int      `json:"order"`
	Name  string   `json:"name"`
	Icon  string   `json:"icon"`
	Color string   `json:"color"`
	Sum   string   `json:"sum,omitempty"`
	Links []Link   `json:"links,omitempty"`
	Learn []*Learn `json:"learn"`
	Poems []*Poem  `json:"poems,omitempty"`
	Cards []*Card  `json:"cards,omitempty"` // not sent to the page (see buildLibraryJSON)
	// filled for the client
	CardCount int    `json:"cardCount"`
	Subject   string `json:"subject"`
}

type Library struct {
	Subjects []*Subject
	Topics   map[string]*Topic
	Poems    map[string]*Poem
	Cards    map[string]*Card
	Learn    map[string]*Learn
	All      []*Card // stable order: subject, topic, content order, generated
}

func loadLibrary(fsys fs.FS) (*Library, error) {
	lib := &Library{Topics: map[string]*Topic{}, Poems: map[string]*Poem{}, Cards: map[string]*Card{}, Learn: map[string]*Learn{}}
	dirs, err := fs.ReadDir(fsys, "content")
	if err != nil {
		return nil, err
	}
	for _, d := range dirs {
		if !d.IsDir() {
			continue
		}
		dir := path.Join("content", d.Name())
		var s Subject
		if err := readJSON(fsys, path.Join(dir, "subject.json"), &s); err != nil {
			return nil, err
		}
		files, _ := fs.ReadDir(fsys, dir)
		for _, f := range files {
			if f.IsDir() || f.Name() == "subject.json" || !strings.HasSuffix(f.Name(), ".json") {
				continue
			}
			var t Topic
			if err := readJSON(fsys, path.Join(dir, f.Name()), &t); err != nil {
				return nil, err
			}
			if t.ID == "" {
				return nil, fmt.Errorf("%s: topic without id", f.Name())
			}
			if lib.Topics[t.ID] != nil {
				return nil, fmt.Errorf("%s: duplicate topic id %q", f.Name(), t.ID)
			}
			t.Subject = s.ID
			tp := &t
			s.Topics = append(s.Topics, tp)
			lib.Topics[t.ID] = tp
		}
		unitOrder := map[string]int{}
		for i, u := range s.Units {
			unitOrder[u.ID] = i
		}
		sort.SliceStable(s.Topics, func(i, j int) bool {
			a, b := s.Topics[i], s.Topics[j]
			if unitOrder[a.Unit] != unitOrder[b.Unit] {
				return unitOrder[a.Unit] < unitOrder[b.Unit]
			}
			return a.Order < b.Order
		})
		sp := s
		lib.Subjects = append(lib.Subjects, &sp)
	}
	sort.SliceStable(lib.Subjects, func(i, j int) bool { return lib.Subjects[i].ID < lib.Subjects[j].ID })

	// Poems and learn cards first, so cards can refer to them.
	for _, s := range lib.Subjects {
		for _, t := range s.Topics {
			for _, p := range t.Poems {
				if lib.Poems[p.ID] != nil {
					return nil, fmt.Errorf("topic %s: duplicate poem id %q", t.ID, p.ID)
				}
				p.Topic = t.ID
				p.Text = strings.TrimSpace(strings.ReplaceAll(p.Text, "\r", ""))
				lib.Poems[p.ID] = p
			}
			for _, l := range t.Learn {
				l.Topic = t.ID
				l.ID = t.ID + "/" + l.ID
				if lib.Learn[l.ID] != nil {
					return nil, fmt.Errorf("duplicate learn id %q", l.ID)
				}
				lib.Learn[l.ID] = l
			}
		}
	}
	for _, s := range lib.Subjects {
		for _, t := range s.Topics {
			for _, c := range t.Cards {
				c.Topic = t.ID
				if c.L != "" {
					c.L = t.ID + "/" + c.L
				}
				if c.ID == "" {
					c.ID = t.ID + "-" + hashID(c.T, c.Q, c.S, c.A, first(c.Items), firstPair(c.Pairs), first(c.CA))
				}
			}
			t.Cards = append(t.Cards, quoteCards(t, s)...)
			t.Cards = append(t.Cards, memoCards(t)...)
			t.CardCount = len(t.Cards)
			for _, c := range t.Cards {
				c.Topic = t.ID
				if lib.Cards[c.ID] != nil {
					return nil, fmt.Errorf("topic %s: duplicate card id %q (q: %q)", t.ID, c.ID, c.Q)
				}
				lib.Cards[c.ID] = c
				lib.All = append(lib.All, c)
			}
		}
	}
	return lib, nil
}

// subjectsFor is the study material of one profile (everyone has their own subjects).
func (lib *Library) subjectsFor(profile string) []*Subject {
	var out []*Subject
	for _, s := range lib.Subjects {
		if len(s.For) == 0 {
			out = append(out, s)
			continue
		}
		for _, f := range s.For {
			if f == profile {
				out = append(out, s)
				break
			}
		}
	}
	return out
}

// topicSet is the ids of every topic in the given subjects.
func topicSet(subjects []*Subject) map[string]bool {
	m := map[string]bool{}
	for _, s := range subjects {
		for _, t := range s.Topics {
			m[t.ID] = true
		}
	}
	return m
}

func readJSON(fsys fs.FS, name string, v any) error {
	b, err := fs.ReadFile(fsys, name)
	if err != nil {
		return err
	}
	dec := json.NewDecoder(strings.NewReader(string(b)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	return nil
}

func hashID(parts ...string) string {
	h := fnv.New64a()
	for _, p := range parts {
		h.Write([]byte(p))
		h.Write([]byte{0})
	}
	return fmt.Sprintf("%010x", h.Sum64())[:10]
}

func first(s []string) string {
	if len(s) > 0 {
		return s[0]
	}
	return ""
}

func firstPair(p [][2]string) string {
	if len(p) > 0 {
		return p[0][0]
	}
	return ""
}

// stanzas splits a poem text into stanzas of trimmed, non-empty lines.
func stanzas(text string) [][]string {
	var out [][]string
	for _, block := range strings.Split(text, "\n\n") {
		var lines []string
		for _, l := range strings.Split(block, "\n") {
			if l = strings.TrimSpace(l); l != "" {
				lines = append(lines, l)
			}
		}
		if len(lines) > 0 {
			out = append(out, lines)
		}
	}
	return out
}

// fold lowercases and strips accents and punctuation, for comparing text loosely.
func fold(s string) string {
	var b strings.Builder
	space := false
	for _, r := range strings.ToLower(s) {
		if f, ok := accentFold[r]; ok {
			r = f
		}
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			space = false
		} else if !space && b.Len() > 0 {
			b.WriteByte(' ')
			space = true
		}
	}
	return strings.TrimSpace(b.String())
}

var accentFold = map[rune]rune{'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ö': 'o', 'ő': 'o', 'ú': 'u', 'ü': 'u', 'ű': 'u', 'à': 'a', 'è': 'e', 'ô': 'o'}

// quoteCards makes two „Melyik versből való?” cards per poem from distinctive lines.
func quoteCards(t *Topic, s *Subject) []*Card {
	// every line of every poem of the subject, folded, to skip lines that occur in two poems
	owner := map[string]string{}
	for _, tt := range s.Topics {
		for _, p := range tt.Poems {
			for _, st := range stanzas(p.Text) {
				for _, l := range st {
					f := fold(l)
					if o, ok := owner[f]; ok && o != p.ID {
						owner[f] = "*"
					} else {
						owner[f] = p.ID
					}
				}
			}
		}
	}
	var out []*Card
	for _, p := range t.Poems {
		st := stanzas(p.Text)
		if len(st) == 0 {
			continue
		}
		title := fold(p.Title)
		type cand struct {
			line   string
			stanza int
			key    string
		}
		var cands []cand
		dupLine := map[string]bool{}
		for si, lines := range st {
			for _, l := range lines {
				f := fold(l)
				if dupLine[f] {
					continue
				}
				dupLine[f] = true
				n := utf8.RuneCountInString(l)
				if n < 16 || n > 64 || len(strings.Fields(f)) < 3 || owner[f] != p.ID {
					continue
				}
				if strings.Contains(f, title) || strings.Contains(title, f) {
					continue
				}
				cands = append(cands, cand{l, si, hashID(p.ID, l)})
			}
		}
		sort.Slice(cands, func(i, j int) bool { return cands[i].key < cands[j].key })
		var picked []cand
		for _, c := range cands {
			if len(picked) == 2 {
				break
			}
			if len(picked) == 1 && picked[0].stanza == c.stanza && len(st) > 1 {
				continue
			}
			picked = append(picked, c)
		}
		if len(picked) < 2 && len(cands) > 1 && len(picked) == 1 {
			for _, c := range cands {
				if c.line != picked[0].line {
					picked = append(picked, c)
					break
				}
			}
		}
		others := otherTitles(p, t, s)
		if len(others) < 3 {
			continue
		}
		learn := learnFor(t, p.ID)
		for _, c := range picked {
			line := strings.Trim(strings.TrimRight(c.line, ",;:"), "„”\"'")
			out = append(out, &Card{
				ID: t.ID + "-q-" + hashID(p.ID, c.line), T: "mc", K: "quote", P: p.ID, L: learn,
				Q: "Melyik versből való?\n„" + line + "”", A: p.Title, X: others[:3],
				W: p.Title + titleYear(p),
			})
		}
	}
	return out
}

func titleYear(p *Poem) string {
	if p.Year != "" {
		return " (" + p.Year + ")"
	}
	return ""
}

// otherTitles returns other poem titles: the same topic first, then the rest of the unit, in a
// stable pseudo-random order that differs per poem.
func otherTitles(p *Poem, t *Topic, s *Subject) []string {
	var same, rest []*Poem
	for _, tt := range s.Topics {
		if tt.Unit != t.Unit {
			continue
		}
		for _, q := range tt.Poems {
			if q.ID == p.ID || q.Title == p.Title {
				continue
			}
			if tt.ID == t.ID {
				same = append(same, q)
			} else {
				rest = append(rest, q)
			}
		}
	}
	key := func(q *Poem) string { return hashID(p.ID, q.ID) }
	sort.Slice(same, func(i, j int) bool { return key(same[i]) < key(same[j]) })
	sort.Slice(rest, func(i, j int) bool { return key(rest[i]) < key(rest[j]) })
	var out []string
	for _, q := range append(same, rest...) {
		out = append(out, q.Title)
	}
	return out
}

func learnFor(t *Topic, poem string) string {
	for _, l := range t.Learn {
		if l.P == poem {
			return l.ID
		}
	}
	return ""
}

// memoCards makes the memoriter drills for poems marked memo: per stanza a line-order card, a
// fill-the-gap card and one "type the missing line" card per line. Repeated stanzas (a refrain
// stanza) are drilled once.
func memoCards(t *Topic) []*Card {
	var out []*Card
	for _, p := range t.Poems {
		if !p.Memo {
			continue
		}
		st := stanzas(p.Text)
		seen := map[string]bool{}
		learn := learnFor(t, p.ID)
		for si, lines := range st {
			key := strings.Join(lines, "\n")
			if seen[key] {
				continue
			}
			seen[key] = true
			n := si + 1
			where := fmt.Sprintf("%s – %d. versszak", p.Title, n)
			base := fmt.Sprintf("%s-m-%s-%d", t.ID, p.ID, n)
			if len(lines) >= 3 {
				out = append(out, &Card{ID: base + "-o", T: "order", K: "m-order", P: p.ID, L: learn,
					Q: "Rakd sorba a sorokat!\n" + where, Items: append([]string(nil), lines...)})
			}
			if s, ans := clozeStanza(lines); len(ans) > 0 {
				out = append(out, &Card{ID: base + "-c", T: "cloze", K: "m-cloze", P: p.ID, L: learn,
					Q: "Töltsd ki a hiányzó szavakat!\n" + where, S: s, X: distractorWords(st, si, ans, 3)})
			}
			for li, l := range lines {
				out = append(out, &Card{ID: fmt.Sprintf("%s-l%d", base, li+1), T: "type", K: "m-line", P: p.ID, L: learn,
					Q: "Írd be a hiányzó sort!\n" + where, A: l, Items: append([]string(nil), lines...), Hole: li + 1})
			}
		}
	}
	return out
}

// clozeStanza brackets the longest word of up to three different lines.
func clozeStanza(lines []string) (string, []string) {
	type pick struct{ line, word int }
	var picks []pick
	var ans []string
	used := map[string]bool{}
	order := make([]int, len(lines))
	for i := range order {
		order[i] = i
	}
	// prefer the middle and last lines: the first line is the easiest to remember
	sort.SliceStable(order, func(a, b int) bool { return (order[a] == 0) == false && order[b] == 0 })
	for _, li := range order {
		if len(picks) == 3 || (len(lines) <= 3 && len(picks) == 2) {
			break
		}
		words := strings.Fields(lines[li])
		best, bestLen := -1, 3
		for wi, w := range words {
			core := coreWord(w)
			n := utf8.RuneCountInString(core)
			if n > bestLen && !used[fold(core)] {
				best, bestLen = wi, n
			}
		}
		if best >= 0 {
			core := coreWord(words[best])
			used[fold(core)] = true
			picks = append(picks, pick{li, best})
			ans = append(ans, core)
		}
	}
	out := make([]string, len(lines))
	for li, l := range lines {
		words := strings.Fields(l)
		for _, p := range picks {
			if p.line == li {
				w := words[p.word]
				core := coreWord(w)
				i := strings.Index(w, core)
				words[p.word] = w[:i] + "[" + core + "]" + w[i+len(core):]
			}
		}
		out[li] = strings.Join(words, " ")
	}
	return strings.Join(out, "\n"), ans
}

// coreWord strips punctuation and quote marks from both ends of a word.
func coreWord(w string) string {
	return strings.TrimFunc(w, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '-' })
}

func distractorWords(st [][]string, skip int, ans []string, n int) []string {
	bad := map[string]bool{}
	for _, a := range ans {
		bad[fold(a)] = true
	}
	var cands []string
	for si, lines := range st {
		if si == skip {
			continue
		}
		for _, l := range lines {
			for _, w := range strings.Fields(l) {
				c := coreWord(w)
				if utf8.RuneCountInString(c) >= 4 && !bad[fold(c)] {
					bad[fold(c)] = true
					cands = append(cands, c)
				}
			}
		}
	}
	sort.Slice(cands, func(i, j int) bool { return hashID(cands[i], ans[0]) < hashID(cands[j], ans[0]) })
	if len(cands) > n {
		cands = cands[:n]
	}
	return cands
}
