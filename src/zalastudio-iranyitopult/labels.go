// Zala Studio Irányítópult – vocabulary: the planner's codes and their Hungarian labels.
// Must match the website (src/zalastudio-weboldal/www/assets/js/preview.js).

package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
	"time"
	_ "time/tzdata"
	"unicode/utf8"
)

// ---------- vocabulary (must match the website) ----------

var L = map[string]map[string]string{
	"tipus":    {"etterem": "Étterem, kávézó", "szepseg": "Szépség, egészség", "szaki": "Szaki, építőipar", "szallas": "Szállás, vendégház", "bolt": "Üzlet, bolt", "egyeb": "Egyéb szolgáltatás"},
	"funkciok": {"arlista": "Árlista vagy étlap", "galeria": "Képgaléria", "ajanlat": "Ajánlatkérő űrlap", "foglalas": "Online időpontfoglalás", "rendeles": "Online rendelés", "nyelv": "Német és angol nyelv", "tobb": "Több aloldal", "kozosseg": "Facebook és Instagram", "kezeles": "Korlátlan módosítás"},
	"stilus":   {"meleg": "Meleg, barátságos", "lagy": "Lágy, elegáns", "termeszetes": "Természetes", "friss": "Friss, modern", "elegans": "Prémium, sötét"},
	"helyzet":  {"nincs": "Még nincs weboldala", "facebook": "Csak Facebook-oldala van", "regi": "Van, de megújítaná"},
	"mikorra":  {"surgos": "Minél előbb", "honap": "1–2 hónapon belül", "erdeklodik": "Csak tájékozódik"},
	"hivhato":  {"delelott": "Délelőtt", "delutan": "Délután", "barmikor": "Bármikor"},
	"csomag":   {"nevjegy": "Névjegy", "vallalkozas": "Vállalkozás", "rendeles": "Rendelés & Foglalás", "premium": "Prémium Partner"},
	"status":   {"uj": "Új", "hivtam": "Felhívtam", "bemutato": "Bemutató készül", "elkuldve": "Bemutató elküldve", "megrendelte": "Megrendelte", "elutasitotta": "Nem kérte"},
}
var prices = map[string]int{"nevjegy": 3490, "vallalkozas": 6990, "rendeles": 12990, "premium": 39990}

func pick(g, v string) string {
	if _, ok := L[g][v]; ok {
		return v
	}
	return ""
}

var ctrl = regexp.MustCompile("[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]")
var spaces = regexp.MustCompile(`[ \t]+`)
var idRe = regexp.MustCompile(`^[0-9a-f-]{36}$`)

func cut(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return string(r[:max])
}
func clean(s string, max int) string {
	s = strings.ToValidUTF8(s, "")
	s = ctrl.ReplaceAllString(s, "")
	s = spaces.ReplaceAllString(s, " ")
	return cut(strings.TrimSpace(s), max)
}
func noteText(s string) string {
	s = strings.ToValidUTF8(strings.ReplaceAll(s, "\r", ""), "")
	return cut(ctrl.ReplaceAllString(s, ""), 4000)
}
func nowISO() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }
func uuid() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func randHex(n int) string { b := make([]byte, n); rand.Read(b); return hex.EncodeToString(b) }
