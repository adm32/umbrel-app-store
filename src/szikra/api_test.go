package main

import (
	"encoding/json"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func testServer(t *testing.T) (*server, http.Handler, *time.Time) {
	s, mux, now := testServerRaw(t)
	return s, s.guard(mux, false), now
}

func testServerRaw(t *testing.T) (*server, *http.ServeMux, *time.Time) {
	t.Helper()
	lib, err := loadLibrary(contentFS)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	profiles, err := openProfiles(dir)
	if err != nil {
		t.Fatal(err)
	}
	auth, err := openAuth(dir)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 23, 22, 30, 0, 0, loc)
	s := &server{lib: lib, profiles: profiles, auth: auth, libJSON: map[string][]byte{}, rng: rand.New(rand.NewPCG(3, 4))}
	s.now = func() time.Time { return now }
	mux := http.NewServeMux()
	s.routes(mux)
	mux.Handle("/", staticHandler())
	return s, mux, &now
}

func do(t *testing.T, mux http.Handler, method, path, body string, out any) int {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if !strings.Contains(path, "p=") {
		req.Header.Set("X-Profile", "adam")
	}
	req.Header.Set("X-Szikra", "1")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if out != nil && w.Code == 200 {
		if err := json.Unmarshal(w.Body.Bytes(), out); err != nil {
			t.Fatalf("%s %s: %v (%s)", method, path, err, w.Body.String())
		}
	}
	return w.Code
}

func TestAPIRoundTrip(t *testing.T) {
	_, mux, now := testServer(t)
	var sess Session
	if do(t, mux, "GET", "/api/session", "", &sess) != 200 || len(sess.Items) == 0 {
		t.Fatal("no session")
	}
	xp := 0
	for i, it := range sess.Items {
		if it.Kind != "card" {
			continue
		}
		var r struct {
			Gained int `json:"gained"`
			XP     int `json:"xp"`
			Box    int `json:"box"`
		}
		body, _ := json.Marshal(answerReq{ID: it.Card.ID, OK: true, Combo: i + 1})
		if do(t, mux, "POST", "/api/answer", string(body), &r) != 200 || r.Gained <= 0 || r.Box != 1 {
			t.Fatalf("answer %s: %+v", it.Card.ID, r)
		}
		xp = r.XP
	}
	var fin map[string]any
	if do(t, mux, "POST", "/api/finish", `{"answered":10,"correct":10,"maxCombo":10,"secs":300}`, &fin) != 200 {
		t.Fatal("finish failed")
	}
	if fin["streak"].(float64) != 1 || len(fin["badges"].([]any)) == 0 {
		t.Fatalf("finish: %v", fin)
	}
	var st StateResp
	do(t, mux, "GET", "/api/state", "", &st)
	if st.XP != xp || st.Rounds != 1 || !st.TodayDone || st.Subjects[0].Known <= 0 || st.NextDue == 0 {
		t.Fatalf("state after round: xp %d/%d rounds %d done %v known %v", st.XP, xp, st.Rounds, st.TodayDone, st.Subjects[0].Known)
	}
	// 30 minutes later the 20-minute cards are due and show up in a review round
	*now = now.Add(30 * time.Minute)
	var rev Session
	do(t, mux, "GET", "/api/session?mode=review", "", &rev)
	due := 0
	for _, it := range rev.Items {
		if it.Card != nil && it.Box == 1 {
			due++
		}
	}
	if due == 0 {
		t.Fatal("answered cards are not due again after 30 minutes")
	}
}

func TestAPIBadInput(t *testing.T) {
	_, mux, _ := testServer(t)
	if c := do(t, mux, "POST", "/api/answer", "{nope", nil); c != 400 {
		t.Fatalf("bad json: %d", c)
	}
	var r map[string]any
	if do(t, mux, "POST", "/api/answer", `{"id":"no-such-card","ok":true}`, &r) != 200 || r["unknown"] != true {
		t.Fatalf("unknown card: %v", r)
	}
	if c := do(t, mux, "PUT", "/api/exam", `{"name":"x","at":"holnap"}`, nil); c != 400 {
		t.Fatalf("bad date accepted: %d", c)
	}
	if c := do(t, mux, "POST", "/api/reset", `{"confirm":"igen"}`, nil); c != 400 {
		t.Fatalf("reset without the word: %d", c)
	}
	if c := do(t, mux, "POST", "/api/reset", `{"confirm":"törlés"}`, nil); c != 200 {
		t.Fatalf("reset with the word: %d", c)
	}
	if c := do(t, mux, "POST", "/api/answer", strings.Repeat("x", 70<<10), nil); c != 413 && c != 400 {
		t.Fatalf("huge body: %d", c)
	}
	for _, p := range []string{"/web/app.js", "/nope.js", "/index.html.bak", "/content/magyar/subject.json"} {
		if c := do(t, mux, "GET", p, "", nil); c != 404 {
			t.Fatalf("%s: %d, want 404", p, c)
		}
	}
	for _, p := range []string{"/", "/app.js?v=1", "/app.css", "/icon.svg", "/icon-180.png", "/manifest.webmanifest", "/api/library", "/api/export", "/api/profiles"} {
		if c := do(t, mux, "GET", p, "", nil); c != 200 {
			t.Fatalf("%s: %d", p, c)
		}
	}
}

// Every way to start a round, for every topic and poem, gives a sensible round.
func TestAllRounds(t *testing.T) {
	s, mux, _ := testServer(t)
	check := func(q string, wantCards bool) {
		var sess Session
		if do(t, mux, "GET", "/api/session?"+q, "", &sess) != 200 {
			t.Fatalf("%s: failed", q)
		}
		seen := map[string]bool{}
		cards := 0
		for _, it := range sess.Items {
			switch it.Kind {
			case "card":
				cards++
				if seen[it.Card.ID] {
					t.Fatalf("%s: card %s twice", q, it.Card.ID)
				}
				seen[it.Card.ID] = true
			case "learn":
				if it.Learn == nil {
					t.Fatalf("%s: empty learn item", q)
				}
			case "read":
				if it.Read == nil || len(it.Read.Lines) == 0 {
					t.Fatalf("%s: empty read item", q)
				}
			default:
				t.Fatalf("%s: kind %q", q, it.Kind)
			}
		}
		if wantCards && (cards == 0 || cards > 12) {
			t.Fatalf("%s: %d cards", q, cards)
		}
	}
	check("", true)
	check("mode=review", false)
	for _, tp := range s.lib.Topics {
		check("mode=topic&topic="+tp.ID, true)
	}
	for _, p := range s.lib.Poems {
		if p.Text != "" {
			check("mode=poem&poem="+p.ID, true)
		}
		if p.Memo {
			for _, k := range []string{"", "m-order", "m-cloze", "m-line"} {
				check("mode=memo&poem="+p.ID+"&kind="+k, true)
			}
		}
	}
	check("mode=topic&topic=nincs", false)
}

// A realistic three days before the test: 12 rounds a day, two hours apart, everything right.
// Every round must bring new cards until all are seen, and the readiness must keep growing.
func TestThreeDaysOfRounds(t *testing.T) {
	_, mux, now := testServer(t)
	last := -1.0
	for day := 0; day < 3; day++ {
		*now = time.Date(2026, 11, 23+day, 8, 0, 0, 0, loc)
		for r := 0; r < 12; r++ {
			var sess Session
			do(t, mux, "GET", "/api/session", "", &sess)
			fresh := 0
			for _, it := range sess.Items {
				if it.Card != nil {
					if it.New {
						fresh++
					}
					body, _ := json.Marshal(answerReq{ID: it.Card.ID, OK: true})
					do(t, mux, "POST", "/api/answer", string(body), nil)
				}
			}
			var st StateResp
			do(t, mux, "GET", "/api/state", "", &st)
			if fresh < 3 && st.Subjects[0].Fresh > 0 {
				t.Fatalf("day %d round %d: only %d new cards while %d are unseen", day, r, fresh, st.Subjects[0].Fresh)
			}
			if st.Subjects[0].Known+0.02 < last {
				t.Fatalf("readiness fell from %.2f to %.2f", last, st.Subjects[0].Known)
			}
			last = st.Subjects[0].Known
			*now = now.Add(70 * time.Minute)
		}
	}
	t.Logf("after 36 rounds: readiness %.0f%%", last*100)
}

func TestProfiles(t *testing.T) {
	_, mux, _ := testServer(t)
	var list []ProfileCard
	do(t, mux, "GET", "/api/profiles", "", &list)
	if len(list) != 2 || list[0].Avatar != "maci" || list[1].Name != "Hanna" || list[1].Avatar != "nyuszi" || list[1].Theme != "pink" || list[0].Theme != "szikra" {
		t.Fatalf("default profiles: %+v", list)
	}
	// Ádám answers; Hanna's progress stays empty
	var sess Session
	do(t, mux, "GET", "/api/session", "", &sess)
	for _, it := range sess.Items {
		if it.Card != nil {
			body, _ := json.Marshal(answerReq{ID: it.Card.ID, OK: true})
			do(t, mux, "POST", "/api/answer", string(body), nil)
		}
	}
	var a, h StateResp
	do(t, mux, "GET", "/api/state", "", &a)
	do(t, mux, "GET", "/api/state?p=hanna", "", &h)
	if a.XP == 0 || h.XP != 0 {
		t.Fatalf("profiles not separate: adam %d xp, hanna %d xp", a.XP, h.XP)
	}
	// Hanna studies other things: the Ady material is Ádám's only
	if len(a.Subjects) != 1 || len(h.Subjects) != 0 || len(h.Topics) != 0 {
		t.Fatalf("subjects: adam %d, hanna %d", len(a.Subjects), len(h.Subjects))
	}
	var hs Session
	do(t, mux, "GET", "/api/session?p=hanna", "", &hs)
	var ht Session
	do(t, mux, "GET", "/api/session?p=hanna&mode=topic&topic=ady-ars", "", &ht)
	if len(hs.Items) != 0 || len(ht.Items) != 0 {
		t.Fatalf("hanna got Ady cards: %d / %d", len(hs.Items), len(ht.Items))
	}
	var hl struct{ Subjects []Subject }
	do(t, mux, "GET", "/api/library?p=hanna", "", &hl)
	var al struct{ Subjects []Subject }
	do(t, mux, "GET", "/api/library", "", &al)
	if len(hl.Subjects) != 0 || len(al.Subjects) != 1 {
		t.Fatalf("library: hanna %d, adam %d subjects", len(hl.Subjects), len(al.Subjects))
	}
	if a.Exam.At == "" || h.Exam.At != "" || h.Exam.Name != "Érettségi" {
		t.Fatalf("exams: %+v / %+v", a.Exam, h.Exam)
	}
	if c := do(t, mux, "GET", "/api/state?p=senki", "", nil); c != 404 {
		t.Fatalf("unknown profile: %d", c)
	}
	var np Profile
	if do(t, mux, "POST", "/api/profiles", `{"name":"  Ádám  ","avatar":"roka"}`, &np) != 200 || np.ID != "adam-2" || np.Name != "Ádám" {
		t.Fatalf("new profile: %+v", np)
	}
	if c := do(t, mux, "POST", "/api/profiles", `{"name":"x","avatar":"sarkany"}`, nil); c != 400 {
		t.Fatalf("unknown avatar accepted: %d", c)
	}
	var ed Profile
	if do(t, mux, "PUT", "/api/profiles/hanna", `{"name":"Hanna","avatar":"cica","theme":"szikra"}`, &ed) != 200 || ed.Avatar != "cica" || ed.Theme != "szikra" {
		t.Fatalf("edit: %+v", ed)
	}
}

// The public address asks for the password; only the Umbrel address can set it.
func TestRemoteAuth(t *testing.T) {
	s, mux, _ := testServerRaw(t)
	local, remote := s.guard(mux, false), s.guard(mux, true)
	req := func(h http.Handler, method, path, body, cookie string, csrf bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("X-Profile", "adam")
		r.RemoteAddr = "203.0.113.5:1234"
		if csrf {
			r.Header.Set("X-Szikra", "1")
		}
		if cookie != "" {
			r.Header.Set("Cookie", cookie)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if c := req(remote, "GET", "/api/state", "", "", false).Code; c != 401 {
		t.Fatalf("remote without login: %d", c)
	}
	if c := req(remote, "GET", "/", "", "", false).Code; c != 200 {
		t.Fatalf("remote page itself: %d", c)
	}
	if c := req(remote, "POST", "/api/login", `{"password":"x"}`, "", true).Code; c != 403 {
		t.Fatalf("login before a password exists: %d", c)
	}
	if c := req(remote, "POST", "/api/password", `{"password":"titkos123"}`, "", true).Code; c != 403 {
		t.Fatalf("password set from the internet: %d", c)
	}
	if c := req(local, "POST", "/api/password", `{"password":"titkos123"}`, "", false).Code; c != 403 {
		t.Fatalf("write without X-Szikra: %d", c)
	}
	if c := req(local, "POST", "/api/password", `{"password":"rov"}`, "", true).Code; c != 400 {
		t.Fatalf("too short password: %d", c)
	}
	if c := req(local, "POST", "/api/password", `{"password":"titkos123"}`, "", true).Code; c != 200 {
		t.Fatalf("set password: %d", c)
	}
	if c := req(local, "GET", "/api/state", "", "", false).Code; c != 200 {
		t.Fatalf("Umbrel address needs no app password: %d", c)
	}
	if c := req(remote, "POST", "/api/login", `{"password":"rossz"}`, "", true).Code; c != 401 {
		t.Fatalf("wrong password: %d", c)
	}
	w := req(remote, "POST", "/api/login", `{"password":"titkos123"}`, "", true)
	if w.Code != 200 {
		t.Fatalf("login: %d", w.Code)
	}
	cookie := strings.Split(w.Header().Get("Set-Cookie"), ";")[0]
	if c := req(remote, "GET", "/api/state", "", cookie, false).Code; c != 200 {
		t.Fatalf("remote with session: %d", c)
	}
	var st map[string]bool
	json.Unmarshal(req(remote, "GET", "/api/auth", "", cookie, false).Body.Bytes(), &st)
	if !st["remote"] || !st["enabled"] || !st["loggedIn"] {
		t.Fatalf("auth status: %v", st)
	}
	// a new password logs out every device
	req(local, "POST", "/api/password", `{"password":"masik456"}`, "", true)
	if c := req(remote, "GET", "/api/state", "", cookie, false).Code; c != 401 {
		t.Fatalf("old session after a new password: %d", c)
	}
	// too many wrong guesses
	for i := 0; i < 8; i++ {
		req(remote, "POST", "/api/login", `{"password":"nem"}`, "", true)
	}
	if c := req(remote, "POST", "/api/login", `{"password":"masik456"}`, "", true).Code; c != 429 {
		t.Fatalf("no lockout after 8 wrong guesses: %d", c)
	}
}
