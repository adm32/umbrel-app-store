package main

import (
	"testing"
	"time"
)

func TestDeadlines(t *testing.T) {
	d := deadlinesFrom(time.Date(2027, 1, 5, 15, 0, 0, 0, time.Local), 3)
	if len(d) != 3 || d[0].Date != "2027-01-12" || d[0].Days != 7 || d[1].Date != "2027-03-15" {
		t.Fatalf("unexpected: %+v", d)
	}
	d = deadlinesFrom(time.Date(2026, 12, 20, 0, 0, 0, 0, time.Local), 1)
	if d[0].Date != "2027-01-12" || d[0].Key != "2027-q4" {
		t.Fatalf("year rollover: %+v", d)
	}
	if d := deadlinesFrom(time.Date(2026, 5, 20, 9, 0, 0, 0, time.Local), 1); d[0].Days != 0 || d[0].Key != "2026-szja" {
		t.Fatalf("same day: %+v", d)
	}
}

func TestParseAmount(t *testing.T) {
	for in, want := range map[any]int{"39 500": 39500, "12 990 Ft": 12990, 6990.0: 6990, "": 0} {
		if got := parseAmount(in); got != want {
			t.Fatalf("%v: got %d want %d", in, got, want)
		}
	}
}
