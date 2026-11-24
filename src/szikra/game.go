// Szikra – XP, levels, streak and badges.
package main

import (
	"math"
	"time"
)

// baseXP is the XP for a correct first answer, by how hard the exercise is.
func baseXP(c *Card) int {
	if c.K == "m-line" {
		return 15
	}
	switch c.T {
	case "tf":
		return 6
	case "mc", "flash":
		return 8
	case "cloze":
		return 10
	case "order", "match", "sort":
		return 12
	case "type":
		return 15
	}
	return 8
}

// comboMult: combo is the number of correct answers in a row, this one included.
func comboMult(combo int) float64 {
	switch {
	case combo >= 10:
		return 3
	case combo >= 6:
		return 2
	case combo >= 3:
		return 1.5
	}
	return 1
}

func gainedXP(c *Card, ok, retry bool, combo int) int {
	if !ok {
		return 0
	}
	if retry {
		return baseXP(c) / 2
	}
	return int(math.Round(float64(baseXP(c)) * comboMult(combo)))
}

var levelNames = []string{"Ugar-járó", "Rőzse-dalos", "Szürkék ellen", "Héja-fióka", "Új vizeken", "Holnap hőse",
	"Illés szekerén", "Góg és Magóg fia", "Vátesz", "Mégis-morál", "Titkok titka", "Csillag-sors", "Hunn legenda",
	"Nyugat csillaga", "Ady-szint"}

func xpNeed(level int) int { return 60 * (level - 1) * level }

type LevelInfo struct {
	Level int    `json:"level"`
	Name  string `json:"name"`
	From  int    `json:"from"` // XP where this level starts
	To    int    `json:"to"`   // XP where the next starts
}

func levelFor(xp int) LevelInfo {
	l := 1
	for xpNeed(l+1) <= xp {
		l++
	}
	name := levelNames[len(levelNames)-1]
	if l <= len(levelNames) {
		name = levelNames[l-1]
	}
	return LevelInfo{Level: l, Name: name, From: xpNeed(l), To: xpNeed(l + 1)}
}

func active(d *Day) bool { return d != nil && (d.R >= 1 || d.A >= 8) }

// streak counts the days in a row with at least one round (or 8 answers). Today counts once it
// is done; until then the streak from yesterday still stands.
func streak(p *Progress, now time.Time) (int, bool) {
	d := now.In(loc)
	done := active(p.Days[d.Format("2006-01-02")])
	if !done {
		d = d.AddDate(0, 0, -1)
	}
	n := 0
	for active(p.Days[d.Format("2006-01-02")]) {
		n++
		d = d.AddDate(0, 0, -1)
	}
	return n, done
}

type Badge struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon"`
	Desc string `json:"desc"`
	At   int64  `json:"at,omitempty"`
}

var fixedBadges = []Badge{
	{ID: "elso", Name: "Első szikra", Icon: "✨", Desc: "Az első kör megvan."},
	{ID: "hibatlan", Name: "Hibátlan kör", Icon: "💯", Desc: "Egy kör, minden válasz elsőre jó."},
	{ID: "kombo10", Name: "Lángoló", Icon: "🔥", Desc: "10-es kombó."},
	{ID: "kombo25", Name: "Tűzvihar", Icon: "🌋", Desc: "25-ös kombó."},
	{ID: "bagoly", Name: "Éjjeli bagoly", Icon: "🦉", Desc: "Kör este 10 után."},
	{ID: "pacsirta", Name: "Korai pacsirta", Icon: "🐦", Desc: "Kör reggel 7 előtt."},
	{ID: "szeria3", Name: "3 napos széria", Icon: "📅", Desc: "Három nap egymás után."},
	{ID: "szeria7", Name: "Hét lángja", Icon: "🗓️", Desc: "Hét nap egymás után."},
	{ID: "tizkor", Name: "Tíz kör", Icon: "🎯", Desc: "10 befejezett kör."},
	{ID: "szaz", Name: "Százas", Icon: "💪", Desc: "100 helyes válasz."},
	{ID: "ezer", Name: "Ezres", Icon: "🏆", Desc: "1000 helyes válasz."},
}

// allBadges lists the fixed badges plus one per memoriter poem and one per topic of the
// profile's own subjects.
func allBadges(subjects []*Subject) []Badge {
	out := append([]Badge(nil), fixedBadges...)
	for _, s := range subjects {
		for _, t := range s.Topics {
			for _, p := range t.Poems {
				if p.Memo {
					out = append(out, Badge{ID: "memo-" + p.ID, Name: p.Title, Icon: "🎭", Desc: "Memoriter: a gyakorlatok 90%-a megy."})
				}
			}
		}
		for _, t := range s.Topics {
			out = append(out, Badge{ID: "tema-" + t.ID, Name: t.Name + " mester", Icon: t.Icon, Desc: "A témakör 80%-a megy."})
		}
	}
	return out
}

type RoundStats struct {
	Answered int `json:"answered"`
	Correct  int `json:"correct"` // correct on the first try
	MaxCombo int `json:"maxCombo"`
	Secs     int `json:"secs"`
}

// awardBadges checks every badge after a round and returns the new ones.
func awardBadges(lib *Library, subjects []*Subject, p *Progress, r RoundStats, now time.Time) []Badge {
	has := func(id string) bool { _, ok := p.Badges[id]; return ok }
	var got []Badge
	give := func(b Badge, cond bool) {
		if cond && !has(b.ID) {
			p.Badges[b.ID] = now.Unix()
			b.At = now.Unix()
			got = append(got, b)
		}
	}
	totalCorrect := 0
	for _, d := range p.Days {
		totalCorrect += d.C
	}
	st, _ := streak(p, now)
	h := now.In(loc).Hour()
	for _, b := range allBadges(subjects) {
		switch b.ID {
		case "elso":
			give(b, p.Rounds >= 1)
		case "hibatlan":
			give(b, r.Answered >= 8 && r.Correct == r.Answered)
		case "kombo10":
			give(b, p.BestCombo >= 10)
		case "kombo25":
			give(b, p.BestCombo >= 25)
		case "bagoly":
			give(b, h >= 22 || h < 3)
		case "pacsirta":
			give(b, h >= 4 && h < 7)
		case "szeria3":
			give(b, st >= 3)
		case "szeria7":
			give(b, st >= 7)
		case "tizkor":
			give(b, p.Rounds >= 10)
		case "szaz":
			give(b, totalCorrect >= 100)
		case "ezer":
			give(b, totalCorrect >= 1000)
		default:
			if len(b.ID) > 5 && b.ID[:5] == "memo-" {
				give(b, poemMemoKnown(lib, p, b.ID[5:], now) >= 0.9)
			} else if len(b.ID) > 5 && b.ID[:5] == "tema-" {
				if t := lib.Topics[b.ID[5:]]; t != nil {
					give(b, topicKnown(t, p, now) >= 0.8)
				}
			}
		}
	}
	return got
}

func topicKnown(t *Topic, p *Progress, now time.Time) float64 {
	if len(t.Cards) == 0 {
		return 0
	}
	sum := 0.0
	for _, c := range t.Cards {
		sum += known(p.Cards[c.ID], now)
	}
	return sum / float64(len(t.Cards))
}

func poemMemoKnown(lib *Library, p *Progress, poem string, now time.Time) float64 {
	n, sum := 0, 0.0
	for _, c := range lib.All {
		if c.P == poem && len(c.K) > 2 && c.K[:2] == "m-" {
			n++
			sum += known(p.Cards[c.ID], now)
		}
	}
	if n == 0 {
		return 0
	}
	return sum / float64(n)
}
