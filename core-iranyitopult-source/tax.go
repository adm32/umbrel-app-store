package main

// Adó: a simple bookkeeping helper for átalányadózó egyéni vállalkozók (one entry per person,
// e.g. Orosz Ádám and Kánya Márk). It keeps the revenue log (bevételi nyilvántartás) that the
// law requires, and reminds through ntfy before the usual tax deadlines. The estimates are
// computed in the browser (web/app.js) from the parameters stored here; they are guidance,
// not tax advice.
//
// Data: DATA_DIR/ado.json

import (
	"encoding/csv"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type TaxPerson struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Registered string `json:"registered"` // date of registration as egyéni vállalkozó, "" = not yet
	Side       bool   `json:"side"`       // no minimum contribution base: full-time student or 36-hour job next to it (Tbj. 42. § (2))
	Skilled    bool   `json:"skilled"`    // minimum base: garantált bérminimum instead of minimálbér
}

type TaxInvoice struct {
	ID      string `json:"id"`
	Person  string `json:"person"`
	Date    string `json:"date"`   // YYYY-MM-DD, when the money was received
	Number  string `json:"number"` // invoice number
	Client  string `json:"client"`
	Amount  int    `json:"amount"` // Ft
	Note    string `json:"note,omitempty"`
	Created string `json:"created"`
}

type TaxYear struct {
	MinWage    int `json:"minWage"`    // monthly minimálbér
	Guaranteed int `json:"guaranteed"` // monthly garantált bérminimum
	VatLimit   int `json:"vatLimit"`   // alanyi adómentesség, Ft per year
}

type TaxData struct {
	People    []TaxPerson        `json:"people"`
	Invoices  []TaxInvoice       `json:"invoices"`
	Years     map[string]TaxYear `json:"years"`
	CostRatio int                `json:"costRatio"` // átalányadó költséghányad, %
	Remind    bool               `json:"remind"`
	Sent      map[string]string  `json:"sent"` // reminder key -> when sent
}

var (
	taxMu   sync.Mutex
	taxData TaxData
	reDate  = regexp.MustCompile(`^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$`)
)

// Known values; a later year without its own entry uses the latest one (it can be edited).
var taxDefaults = map[string]TaxYear{
	"2026": {MinWage: 322800, Guaranteed: 373200, VatLimit: 20000000},
	"2027": {MinWage: 322800, Guaranteed: 373200, VatLimit: 22000000},
	"2028": {MinWage: 322800, Guaranteed: 373200, VatLimit: 24000000},
}

func loadTax() {
	taxMu.Lock()
	defer taxMu.Unlock()
	if !readJSON("ado.json", &taxData) || len(taxData.People) == 0 {
		taxData = TaxData{
			People: []TaxPerson{
				{ID: "adam", Name: "Orosz Ádám", Side: true},
				{ID: "mark", Name: "Kánya Márk"},
			},
			Invoices:  []TaxInvoice{},
			CostRatio: 45,
			Remind:    true,
		}
	}
	if taxData.Invoices == nil {
		taxData.Invoices = []TaxInvoice{}
	}
	if taxData.Years == nil {
		taxData.Years = map[string]TaxYear{}
	}
	for y, v := range taxDefaults {
		if _, ok := taxData.Years[y]; !ok {
			taxData.Years[y] = v
		}
	}
	if taxData.Sent == nil {
		taxData.Sent = map[string]string{}
	}
	if taxData.CostRatio <= 0 || taxData.CostRatio >= 100 {
		taxData.CostRatio = 45
	}
}

// saveTax: callers hold taxMu.
func saveTax() {
	if err := writeJSON("ado.json", taxData); err != nil {
		log.Print("ado.json: ", err)
	}
}

/* ---------------------------------------------------------------- deadlines */

type deadline struct {
	Key   string `json:"key"`
	Date  string `json:"date"`
	Title string `json:"title"`
	What  string `json:"what"`
	Days  int    `json:"days"`
}

// The usual yearly calendar of an átalányadózó egyéni vállalkozó. Approximate: always check
// the exact dates on nav.gov.hu and at the local council.
func deadlinesFrom(now time.Time, n int) []deadline {
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	var out []deadline
	for _, y := range []int{now.Year(), now.Year() + 1} {
		add := func(m time.Month, d int, key, title, what string) {
			t := time.Date(y, m, d, 0, 0, 0, 0, time.Local)
			if t.Before(today) {
				return
			}
			out = append(out, deadline{Key: fmt.Sprintf("%d-%s", y, key), Date: t.Format("2006-01-02"), Title: title, What: what, Days: int(t.Sub(today).Hours() / 24)})
		}
		add(1, 12, "q4", "Negyedéves adó és járulék", fmt.Sprintf("A %d. IV. negyedévi adóelőleg, járulékok és szocho befizetése, főállásúaknál a 2658-as bevallás.", y-1))
		add(3, 15, "ipa1", "Iparűzési adóelőleg", "Az első félévi iparűzésiadó-előleg a székhely szerinti önkormányzatnak (ha van fizetnivaló).")
		add(3, 31, "kamara", "Kamarai hozzájárulás", "5 000 Ft a területi kereskedelmi és iparkamarának.")
		add(4, 12, "q1", "Negyedéves adó és járulék", "Az I. negyedévi adóelőleg, járulékok és szocho, főállásúaknál a 2658-as bevallás.")
		add(5, 20, "szja", "Éves SZJA-bevallás", fmt.Sprintf("A %d. évi személyijövedelemadó-bevallás (53-as) a NAV-nak, egyéni vállalkozóként.", y-1))
		add(5, 31, "ipa", "Iparűzési adó bevallása", fmt.Sprintf("A %d. évi helyi iparűzési adó bevallása és befizetése az önkormányzatnak.", y-1))
		add(7, 12, "q2", "Negyedéves adó és járulék", "A II. negyedévi adóelőleg, járulékok és szocho, főállásúaknál a 2658-as bevallás.")
		add(9, 15, "ipa2", "Iparűzési adóelőleg", "A második félévi iparűzésiadó-előleg az önkormányzatnak (ha van fizetnivaló).")
		add(10, 12, "q3", "Negyedéves adó és járulék", "A III. negyedévi adóelőleg, járulékok és szocho, főállásúaknál a 2658-as bevallás.")
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Date < out[j].Date })
	if len(out) > n {
		out = out[:n]
	}
	return out
}

// taxReminders sends an ntfy message 7 days and 1 day before each deadline, once.
// Only when somebody is already registered as egyéni vállalkozó.
func taxReminders() {
	taxMu.Lock()
	on := taxData.Remind
	reg := []string{}
	for _, p := range taxData.People {
		if p.Registered != "" {
			reg = append(reg, p.Name)
		}
	}
	taxMu.Unlock()
	if !on || len(reg) == 0 {
		return
	}
	for _, d := range deadlinesFrom(time.Now(), 6) {
		for _, before := range []int{7, 1} {
			if d.Days > before || d.Days < before-1 {
				continue
			}
			key := fmt.Sprintf("%s-%d", d.Key, before)
			taxMu.Lock()
			_, done := taxData.Sent[key]
			taxMu.Unlock()
			if done {
				continue
			}
			when := "egy hét múlva"
			if before == 1 {
				when = "holnap"
			}
			msg := d.What + "\nHatáridő: " + strings.ReplaceAll(d.Date, "-", ". ") + "."
			if err := ntfy(ntfyMsg{Title: d.Title + " – " + when, Message: msg, Tags: []string{"spiral_calendar"}, Priority: 4}); err != nil {
				log.Print("ado reminder: ", err)
				continue
			}
			taxMu.Lock()
			taxData.Sent[key] = nowISO()
			saveTax()
			taxMu.Unlock()
		}
	}
}

/* ---------------------------------------------------------------- API */

func taxState() map[string]any {
	taxMu.Lock()
	defer taxMu.Unlock()
	inv := append([]TaxInvoice{}, taxData.Invoices...)
	sort.Slice(inv, func(i, j int) bool {
		if inv[i].Date != inv[j].Date {
			return inv[i].Date > inv[j].Date
		}
		return inv[i].Created > inv[j].Created
	})
	return map[string]any{"ok": true, "people": taxData.People, "invoices": inv, "years": taxData.Years,
		"costRatio": taxData.CostRatio, "remind": taxData.Remind, "deadlines": deadlinesFrom(time.Now(), 8),
		"today": time.Now().Format("2006-01-02")}
}

func findPerson(id string) *TaxPerson {
	for i := range taxData.People {
		if taxData.People[i].ID == id {
			return &taxData.People[i]
		}
	}
	return nil
}

type invoiceIn struct {
	Person string `json:"person"`
	Date   string `json:"date"`
	Number string `json:"number"`
	Client string `json:"client"`
	Amount any    `json:"amount"`
	Note   string `json:"note"`
}

func parseAmount(v any) int {
	switch x := v.(type) {
	case float64:
		return int(x + 0.5)
	case string:
		s := strings.Map(func(r rune) rune {
			if r >= '0' && r <= '9' {
				return r
			}
			return -1
		}, x)
		n, _ := strconv.Atoi(s)
		return n
	}
	return 0
}

// checkInvoice validates and fills inv from d; callers hold taxMu.
func checkInvoice(d invoiceIn, inv *TaxInvoice) string {
	if findPerson(d.Person) == nil {
		return "Válaszd ki, kié a bevétel."
	}
	if !reDate.MatchString(d.Date) {
		return "Adj meg egy dátumot."
	}
	n := parseAmount(d.Amount)
	if n <= 0 || n > 1000000000 {
		return "Adj meg egy összeget forintban."
	}
	inv.Person, inv.Date, inv.Amount = d.Person, d.Date, n
	inv.Number, inv.Client, inv.Note = clean(d.Number, 60), clean(d.Client, 120), clean(d.Note, 300)
	return ""
}

func taxAPI(w http.ResponseWriter, r *http.Request, p string) {
	switch {
	case p == "/api/ado" && r.Method == "GET":
		sendJSON(w, 200, taxState())

	case p == "/api/ado/szamla" && r.Method == "POST":
		var d invoiceIn
		if !readBody(r, 16<<10, &d) {
			sendJSON(w, 400, map[string]any{"ok": false})
			return
		}
		taxMu.Lock()
		inv := TaxInvoice{ID: uuid(), Created: nowISO()}
		if e := checkInvoice(d, &inv); e != "" {
			taxMu.Unlock()
			sendJSON(w, 422, map[string]any{"ok": false, "error": e})
			return
		}
		taxData.Invoices = append(taxData.Invoices, inv)
		saveTax()
		taxMu.Unlock()
		sendJSON(w, 200, taxState())

	case strings.HasPrefix(p, "/api/ado/szamla/") && (r.Method == "PUT" || r.Method == "DELETE"):
		id := strings.TrimPrefix(p, "/api/ado/szamla/")
		var d invoiceIn
		if r.Method == "PUT" && !readBody(r, 16<<10, &d) {
			sendJSON(w, 400, map[string]any{"ok": false})
			return
		}
		taxMu.Lock()
		idx := -1
		for i := range taxData.Invoices {
			if taxData.Invoices[i].ID == id {
				idx = i
			}
		}
		if idx < 0 {
			taxMu.Unlock()
			sendJSON(w, 404, map[string]any{"ok": false, "error": "Nincs ilyen tétel."})
			return
		}
		if r.Method == "DELETE" {
			taxData.Invoices = append(taxData.Invoices[:idx], taxData.Invoices[idx+1:]...)
		} else if e := checkInvoice(d, &taxData.Invoices[idx]); e != "" {
			taxMu.Unlock()
			sendJSON(w, 422, map[string]any{"ok": false, "error": e})
			return
		}
		saveTax()
		taxMu.Unlock()
		sendJSON(w, 200, taxState())

	case strings.HasPrefix(p, "/api/ado/szemely/") && r.Method == "PUT":
		var d struct {
			Name       *string `json:"name"`
			Registered *string `json:"registered"`
			Side       *bool   `json:"side"`
			Skilled    *bool   `json:"skilled"`
		}
		if !readBody(r, 8<<10, &d) {
			sendJSON(w, 400, map[string]any{"ok": false})
			return
		}
		taxMu.Lock()
		pp := findPerson(strings.TrimPrefix(p, "/api/ado/szemely/"))
		if pp == nil {
			taxMu.Unlock()
			sendJSON(w, 404, map[string]any{"ok": false})
			return
		}
		if d.Name != nil && clean(*d.Name, 60) != "" {
			pp.Name = clean(*d.Name, 60)
		}
		if d.Registered != nil {
			if *d.Registered != "" && !reDate.MatchString(*d.Registered) {
				taxMu.Unlock()
				sendJSON(w, 422, map[string]any{"ok": false, "error": "Érvénytelen dátum."})
				return
			}
			pp.Registered = *d.Registered
		}
		if d.Side != nil {
			pp.Side = *d.Side
		}
		if d.Skilled != nil {
			pp.Skilled = *d.Skilled
		}
		saveTax()
		taxMu.Unlock()
		sendJSON(w, 200, taxState())

	case p == "/api/ado/beallitas" && r.Method == "PUT":
		var d struct {
			Year       string `json:"year"`
			MinWage    *int   `json:"minWage"`
			Guaranteed *int   `json:"guaranteed"`
			VatLimit   *int   `json:"vatLimit"`
			CostRatio  *int   `json:"costRatio"`
			Remind     *bool  `json:"remind"`
		}
		if !readBody(r, 8<<10, &d) {
			sendJSON(w, 400, map[string]any{"ok": false})
			return
		}
		taxMu.Lock()
		if d.Year != "" {
			if !regexp.MustCompile(`^20\d\d$`).MatchString(d.Year) {
				taxMu.Unlock()
				sendJSON(w, 422, map[string]any{"ok": false, "error": "Érvénytelen év."})
				return
			}
			y := taxData.Years[d.Year]
			if y.MinWage == 0 {
				y = latestYear(d.Year)
			}
			if d.MinWage != nil && *d.MinWage > 50000 && *d.MinWage < 5000000 {
				y.MinWage = *d.MinWage
			}
			if d.Guaranteed != nil && *d.Guaranteed > 50000 && *d.Guaranteed < 5000000 {
				y.Guaranteed = *d.Guaranteed
			}
			if d.VatLimit != nil && *d.VatLimit > 1000000 && *d.VatLimit < 1000000000 {
				y.VatLimit = *d.VatLimit
			}
			taxData.Years[d.Year] = y
		}
		if d.CostRatio != nil && *d.CostRatio > 0 && *d.CostRatio < 100 {
			taxData.CostRatio = *d.CostRatio
		}
		if d.Remind != nil {
			taxData.Remind = *d.Remind
		}
		saveTax()
		taxMu.Unlock()
		sendJSON(w, 200, taxState())

	case p == "/api/ado/bevetelek.csv" && r.Method == "GET":
		year, who := r.URL.Query().Get("ev"), r.URL.Query().Get("szemely")
		taxMu.Lock()
		name := "osszes"
		if pp := findPerson(who); pp != nil {
			name = pp.Name
		}
		rows := [][]string{{"Sorszám", "Dátum", "Számla száma", "Ügyfél", "Összeg (Ft)", "Megjegyzés", "Kié"}}
		inv := append([]TaxInvoice{}, taxData.Invoices...)
		sort.Slice(inv, func(i, j int) bool { return inv[i].Date < inv[j].Date })
		n, sum := 0, 0
		for _, t := range inv {
			if (year != "" && !strings.HasPrefix(t.Date, year)) || (who != "" && t.Person != who) {
				continue
			}
			n++
			sum += t.Amount
			owner := t.Person
			if pp := findPerson(t.Person); pp != nil {
				owner = pp.Name
			}
			rows = append(rows, []string{strconv.Itoa(n), t.Date, csvCell(t.Number), csvCell(t.Client), strconv.Itoa(t.Amount), csvCell(t.Note), csvCell(owner)})
		}
		rows = append(rows, []string{"", "", "", "Összesen", strconv.Itoa(sum), "", ""})
		taxMu.Unlock()
		fn := "bevetelek-" + slug(name) + "-" + firstNonEmpty(year, "osszes") + ".csv"
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="`+fn+`"`)
		w.Write([]byte{0xEF, 0xBB, 0xBF}) // so Excel reads the accents
		c := csv.NewWriter(w)
		c.Comma = ';'
		c.WriteAll(rows)

	default:
		sendJSON(w, 404, map[string]any{"ok": false, "error": "Nincs ilyen végpont."})
	}
}

// latestYear: the newest stored parameters up to the given year (used for years without data).
func latestYear(y string) TaxYear {
	best, out := "", TaxYear{MinWage: 322800, Guaranteed: 373200, VatLimit: 20000000}
	for k, v := range taxData.Years {
		if k <= y && k > best && v.MinWage > 0 {
			best, out = k, v
		}
	}
	return out
}

func slug(s string) string {
	r := strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ö", "o", "ő", "o", "ú", "u", "ü", "u", "ű", "u", "Á", "a", "É", "e", "Í", "i", "Ó", "o", "Ö", "o", "Ő", "o", "Ú", "u", "Ü", "u", "Ű", "u")
	s = strings.ToLower(r.Replace(s))
	s = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}

func taxLoop() {
	time.Sleep(20 * time.Second)
	for {
		taxReminders()
		time.Sleep(time.Hour)
	}
}
