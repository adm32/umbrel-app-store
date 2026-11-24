// Szikra – spaced repetition: when a card comes back, and how well a card / topic / poem is known.
package main

import (
	"time"
)

// CardState is what we remember about one card. Box goes up by one for every correct first
// answer in a round and down by two for a wrong one (Leitner boxes). Due is when it should come
// back.
type CardState struct {
	Box   int   `json:"b"`
	Due   int64 `json:"d"`
	Seen  int   `json:"n"`
	Right int   `json:"r"`
	Wrong int   `json:"w"`
	Last  int64 `json:"l"`
}

const maxBox = 7

// intervals[box]: how long after a correct answer the card comes back.
var intervals = [maxBox + 1]time.Duration{
	0,
	20 * time.Minute,
	6 * time.Hour,
	24 * time.Hour,
	3 * 24 * time.Hour,
	7 * 24 * time.Hour,
	16 * 24 * time.Hour,
	35 * 24 * time.Hour,
}

// weights[box]: how much a card counts as "known" for the progress bars. Four spaced correct
// answers make a card fully known, which is reachable within a few days before a test.
var weights = [maxBox + 1]float64{0, 0.4, 0.7, 0.9, 1, 1, 1, 1}

const wrongAgain = 10 * time.Minute

// schedule applies one first-try answer. Before a test (exam in the future) no interval is
// longer than half the time left, so every card is seen again before the test.
func schedule(st *CardState, ok bool, now, exam time.Time) {
	st.Seen++
	st.Last = now.Unix()
	var iv time.Duration
	if ok {
		st.Right++
		if st.Box < maxBox {
			st.Box++
		}
		iv = intervals[st.Box]
	} else {
		st.Wrong++
		st.Box -= 2
		if st.Box < 1 {
			st.Box = 1
		}
		iv = wrongAgain
	}
	if exam.After(now) {
		limit := exam.Sub(now) / 2
		if limit < 20*time.Minute {
			limit = 20 * time.Minute
		}
		if iv > limit {
			iv = limit
		}
	}
	st.Due = now.Add(iv).Unix()
}

// known returns 0..1: how well the card is known now. A card well past its due time fades one
// box (only from box 2 up, and only after at least half a day), so the bars show what needs
// repeating without punishing a fresh card.
func known(st *CardState, now time.Time) float64 {
	if st == nil || st.Box <= 0 {
		return 0
	}
	b := st.Box
	if b >= 2 {
		grace := intervals[b]
		if grace < 12*time.Hour {
			grace = 12 * time.Hour
		}
		if now.Unix() > st.Due+int64(grace/time.Second) {
			b--
		}
	}
	return weights[b]
}

func isDue(st *CardState, now time.Time) bool {
	return st != nil && st.Box > 0 && st.Due <= now.Unix()
}
