// Csaszko Foglalások – time helpers: Budapest wall-clock dates and times ("2026-11-03", "09:30").

package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata"
)

/* ----------------------------------------------------------------- time */

var (
	reDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	reTime = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)
)

func toMin(t string) int {
	p := strings.SplitN(t, ":", 2)
	if len(p) != 2 {
		return 0
	}
	h, _ := strconv.Atoi(p[0])
	m, _ := strconv.Atoi(p[1])
	return h*60 + m
}
func fromMin(n int) string { return fmt.Sprintf("%02d:%02d", n/60, n%60) }

func parseDate(d string) (time.Time, bool) {
	t, err := time.Parse("2006-01-02", d)
	return t, err == nil
}
func dayNum(d string) int {
	t, ok := parseDate(d)
	if !ok {
		return 0
	}
	return int(t.Unix() / 86400)
}
func weekday(d string) int {
	t, _ := parseDate(d)
	return int(t.Weekday())
}
func addDays(d string, n int) string {
	t, _ := parseDate(d)
	return t.AddDate(0, 0, n).Format("2006-01-02")
}
func isDate(s string) bool {
	if !reDate.MatchString(s) {
		return false
	}
	t, ok := parseDate(s)
	return ok && t.Format("2006-01-02") == s
}
func isTime(s string) bool { return reTime.MatchString(s) }

type nowT struct {
	date string
	min  int
	abs  int
}

func now() nowT {
	t := time.Now().In(loc)
	d := t.Format("2006-01-02")
	m := t.Hour()*60 + t.Minute()
	return nowT{d, m, dayNum(d)*1440 + m}
}

func isoNow() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }

func budapestDate(iso string) string {
	t, err := time.Parse(time.RFC3339Nano, iso)
	if err != nil {
		return ""
	}
	return t.In(loc).Format("2006-01-02")
}
