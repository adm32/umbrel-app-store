// Csaszko Foglalások – rate limits for the public booking API.

package main

import (
	"time"
	_ "time/tzdata"
)

/* ------------------------------------------------------------ rate limit */

var hits = map[string][]int64{}

// limited: true when key already used max times within the window. checkOnly does not count this call.
// Callers hold mu.
func limited(key string, max int, window time.Duration, checkOnly bool) bool {
	t := time.Now().UnixMilli()
	w := window.Milliseconds()
	arr := hits[key][:0:0]
	for _, x := range hits[key] {
		if t-x < w {
			arr = append(arr, x)
		}
	}
	hits[key] = arr
	if len(arr) >= max {
		return true
	}
	if !checkOnly {
		hits[key] = append(arr, t)
	}
	return false
}

func cleanHits() {
	for range time.Tick(10 * time.Minute) {
		mu.Lock()
		t := time.Now().UnixMilli()
		for k, v := range hits {
			keep := false
			for _, x := range v {
				if t-x < 3600000 {
					keep = true
					break
				}
			}
			if !keep {
				delete(hits, k)
			}
		}
		mu.Unlock()
	}
}
