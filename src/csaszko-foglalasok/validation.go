// Csaszko Foglalások – input helpers: turn request values into clean strings, numbers and flags
// (cut, oneLine, isEmail, isPhone, clampMinutes…).

package main

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	_ "time/tzdata"
	"unicode/utf8"
)

/* ----------------------------------------------------------- validation */

var (
	reCtrl  = regexp.MustCompile("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
	reSpace = regexp.MustCompile(`\s+`)
	reEmail = regexp.MustCompile(`(?i)^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$`)
	rePhone = regexp.MustCompile(`^[0-9+()/.\-\s]{6,30}$`)
	reDigit = regexp.MustCompile(`\d`)
)

// asStr turns a decoded JSON value into a string the way JavaScript's String() would.
func asStr(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case json.Number:
		return x.String()
	case bool:
		if x {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprint(x)
	}
}

func cut(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return string(r[:max])
}

func str(v any, max int) string {
	return cut(strings.TrimSpace(reCtrl.ReplaceAllString(asStr(v), "")), max)
}
func oneLine(v any, max int) string {
	return reSpace.ReplaceAllString(str(v, max), " ")
}
func isEmail(s string) bool { return len(s) <= 120 && reEmail.MatchString(s) }
func isPhone(s string) bool {
	return rePhone.MatchString(s) && len(reDigit.FindAllString(s, -1)) >= 6
}

// num: a number from JSON (number or numeric string); NaN when it is neither.
func num(v any) float64 {
	switch x := v.(type) {
	case json.Number:
		f, err := x.Float64()
		if err != nil {
			return math.NaN()
		}
		return f
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		if err != nil {
			return math.NaN()
		}
		return f
	case bool:
		if x {
			return 1
		}
		return 0
	case nil:
		return math.NaN()
	}
	return math.NaN()
}

// parseInt like JavaScript's parseInt(v, 10): leading digits of the text, NaN if none.
var reLeadInt = regexp.MustCompile(`^\s*([+-]?\d+)`)

func parseInt(v any) (int, bool) {
	m := reLeadInt.FindStringSubmatch(asStr(v))
	if m == nil {
		return 0, false
	}
	n, err := strconv.Atoi(m[1])
	return n, err == nil
}

func clampMinutes(v any) int {
	n := num(v)
	if math.IsNaN(n) || n == 0 {
		n = 40
	}
	r := int(math.Round(n))
	if r < 10 {
		r = 10
	}
	if r > 240 {
		r = 240
	}
	return r
}

// truthy like JavaScript's !!v.
func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case json.Number:
		f, _ := x.Float64()
		return f != 0
	}
	return true
}
func isFalse(v any) bool { b, ok := v.(bool); return ok && !b }
