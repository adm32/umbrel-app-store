// Csaszko Foglalások – availability: opening hours, blocks and existing bookings → free times.

package main

import (
	"math"
	"strconv"
	_ "time/tzdata"
)

/* --------------------------------------------------------- availability */

func active(status string) bool { return status == "pending" || status == "confirmed" }

func hoursFor(d string) []string {
	h := settings.Hours[strconv.Itoa(weekday(d))]
	if len(h) != 2 {
		return nil
	}
	return h
}

func busy(date, excludeID string) [][2]int {
	buf := settings.BufferMinutes
	var out [][2]int
	for _, b := range db.Bookings {
		if b.Date == date && active(b.Status) && b.ID != excludeID {
			out = append(out, [2]int{toMin(b.Time) - buf, toMin(b.Time) + b.Minutes + buf})
		}
	}
	for _, k := range db.Blocks {
		to := k.DateTo
		if to == "" {
			to = k.Date
		}
		if date >= k.Date && date <= to {
			if k.AllDay {
				out = append(out, [2]int{0, 1440})
			} else {
				out = append(out, [2]int{toMin(k.From), toMin(k.To)})
			}
		}
	}
	return out
}

// freeStarts: start times that can be booked on date for a service of the given length.
// The closing time is the last possible START: a cut may run past it.
func freeStarts(date string, minutes int, admin bool, excludeID string) []string {
	h := hoursFor(date)
	res := []string{}
	if h == nil {
		return res
	}
	t := now()
	if !admin && (date < t.date || (date == t.date && !settings.SameDay) || date > addDays(t.date, settings.HorizonDays)) {
		return res
	}
	earliest := math.MinInt
	if !admin {
		earliest = t.abs + settings.MinNoticeMinutes
	}
	b := busy(date, excludeID)
	step := settings.StepMinutes
	if step <= 0 {
		step = 20
	}
	dn := dayNum(date) * 1440
	for s := toMin(h[0]); s <= toMin(h[1]); s += step {
		if dn+s < earliest {
			continue
		}
		e := s + minutes
		clash := false
		for _, z := range b {
			if s < z[1] && e > z[0] {
				clash = true
				break
			}
		}
		if !clash {
			res = append(res, fromMin(s))
		}
	}
	return res
}

func overlaps(date, tm string, minutes int, excludeID string) bool {
	s := toMin(tm)
	e := s + minutes
	for _, z := range busy(date, excludeID) {
		if s < z[1] && e > z[0] {
			return true
		}
	}
	return false
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}
