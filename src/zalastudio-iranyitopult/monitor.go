// Zala Studio Irányítópult – monitoring: checks that the website and its outbox are healthy, and pushes
// the settings (discount places, VAT wording, Stripe portal) to the website.

package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
	_ "time/tzdata"
)

// ---------- monitoring ----------

type siteStatus struct {
	OK     *bool  `json:"ok"`
	At     string `json:"at"`
	Outbox int    `json:"outbox"`
	Error  string `json:"error"`
}
type pubStatus struct {
	OK      *bool  `json:"ok"`
	At      string `json:"at"`
	MS      int64  `json:"ms"`
	Error   string `json:"error"`
	Fails   int    `json:"fails"`
	Alerted bool   `json:"alerted"`
}
type statusT struct {
	Site   siteStatus `json:"site"`
	Public pubStatus  `json:"public"`
}

var (
	stMu    sync.Mutex
	status  statusT
	checkMu sync.Mutex
)

func bp(b bool) *bool { return &b }

// The website moved from admcore.hu to zalastudio.hu. While the saved address is still the old
// one, the monitor tries the new one, and switches over once it answers (DNS and tunnel ready).
const newSiteURL = "https://zalastudio.hu"

func moveToNewDomain(cur string) bool {
	c := strings.TrimRight(strings.ToLower(cur), "/")
	if c != "https://admcore.hu" && c != "https://www.admcore.hu" {
		return false
	}
	req, _ := http.NewRequest("GET", newSiteURL+"/healthz", nil)
	req.Header.Set("User-Agent", "zalastudio-iranyitopult-monitor")
	r, err := httpc.Do(req)
	if err != nil {
		return false
	}
	defer r.Body.Close()
	// Only our own website answers exactly "ok" (a parked domain may answer 200 to anything).
	b, _ := io.ReadAll(io.LimitReader(r.Body, 64))
	return r.StatusCode == 200 && strings.TrimSpace(string(b)) == "ok"
}

func check() {
	checkMu.Lock()
	defer checkMu.Unlock()
	site := siteStatus{At: nowISO()}
	if r, err := httpc.Get(siteURL + "/health"); err == nil {
		var j struct {
			Outbox int `json:"outbox"`
		}
		json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&j)
		r.Body.Close()
		site.OK, site.Outbox = bp(r.StatusCode == 200), j.Outbox
	} else {
		site.OK, site.Error = bp(false), "A weboldal app nem válaszol."
	}
	mu.Lock()
	s := settings
	mu.Unlock()
	stMu.Lock()
	status.Site = site
	pub := status.Public
	stMu.Unlock()
	if s.SiteURL == "" {
		return
	}
	if moveToNewDomain(s.SiteURL) {
		mu.Lock()
		settings.SiteURL = newSiteURL
		writeJSON("settings.json", settings)
		s = settings
		mu.Unlock()
		log.Print("site monitor: moved to ", newSiteURL)
	}
	t0 := time.Now()
	req, _ := http.NewRequest("GET", strings.TrimRight(s.SiteURL, "/")+"/healthz", nil)
	req.Header.Set("User-Agent", "zalastudio-iranyitopult-monitor")
	pub.At = nowISO()
	if r, err := httpc.Do(req); err == nil {
		r.Body.Close()
		pub.OK, pub.MS, pub.Error = bp(r.StatusCode == 200), time.Since(t0).Milliseconds(), ""
		if r.StatusCode != 200 {
			pub.Error = fmt.Sprintf("HTTP %d", r.StatusCode)
			if r.StatusCode == 530 {
				pub.Error += " (Cloudflare: az alagút nem fut, 1033-as hiba)"
			}
		}
	} else {
		msg := err.Error()
		var dnsErr *net.DNSError
		if errors.As(err, &dnsErr) {
			msg = "a domain nem található"
		} else if strings.Contains(msg, "Client.Timeout") || strings.Contains(msg, "deadline") {
			msg = "nem válaszolt 12 másodpercen belül"
		}
		pub.OK, pub.MS, pub.Error = bp(false), 0, "Nem érhető el: "+msg
	}
	if *pub.OK {
		if pub.Alerted && s.NotifyDown {
			go ntfy(ntfyMsg{Title: "A weboldal újra elérhető", Message: s.SiteURL, Tags: []string{"white_check_mark"}, Priority: 3})
		}
		pub.Fails, pub.Alerted = 0, false
	} else {
		pub.Fails++
		if pub.Fails >= 2 && !pub.Alerted && s.NotifyDown {
			pub.Alerted = true
			go ntfy(ntfyMsg{Title: "A weboldal nem érhető el", Message: s.SiteURL + "\n" + pub.Error + "\nNézd meg a Cloudflare Tunnel appot és a Zala Studio appot az Umbrelen.", Tags: []string{"warning"}, Priority: 5})
		}
	}
	stMu.Lock()
	status.Public = pub
	stMu.Unlock()
}

// pushConfig sends what the public website needs: discount places, VAT wording, customer-portal link.
func pushConfig() bool {
	mu.Lock()
	c := map[string]any{"spots": settings.Spots, "vat": settings.VatMode, "portal": settings.PortalURL}
	mu.Unlock()
	b, _ := json.Marshal(c)
	r, err := httpc.Post(siteURL+"/config", "application/json", bytes.NewReader(b))
	if err != nil {
		return false
	}
	r.Body.Close()
	return r.StatusCode == 200
}
