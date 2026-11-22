// Csaszko Foglalások – HTTP helpers: JSON answers, body reading, client IP.

package main

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"sort"
	"strings"
	_ "time/tzdata"
)

/* ------------------------------------------------------------ http utils */

func send(w http.ResponseWriter, status int, obj any) {
	b, _ := json.Marshal(obj)
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	w.Write(b)
}

type obj = map[string]any

var errTooLarge = errors.New("too large")

// readBody decodes a JSON object body (empty body = {}).
func readBody(w http.ResponseWriter, r *http.Request, limit int64) (obj, int, error) {
	b, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		return nil, 400, err
	}
	if int64(len(b)) > limit {
		return nil, 413, errTooLarge
	}
	out := obj{}
	if len(strings.TrimSpace(string(b))) == 0 {
		return out, 0, nil
	}
	d := json.NewDecoder(strings.NewReader(string(b)))
	d.UseNumber()
	var v any
	if err := d.Decode(&v); err != nil {
		return nil, 400, err
	}
	if m, ok := v.(map[string]any); ok {
		return m, 0, nil
	}
	return out, 0, nil
}

func clientIP(r *http.Request) string {
	if v := strings.TrimSpace(r.Header.Get("Cf-Connecting-Ip")); v != "" {
		return v
	}
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		if f := strings.TrimSpace(strings.Split(v, ",")[0]); f != "" {
			return f
		}
	}
	h, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return h
}

func sortedBookings() []*Booking {
	out := append([]*Booking{}, db.Bookings...) // never null in JSON
	sort.SliceStable(out, func(i, j int) bool { return out[i].Date+out[i].Time < out[j].Date+out[j].Time })
	return out
}
