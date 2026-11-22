// Zala Studio Irányítópult – storage: leads.json, settings.json and jelszo.json in DATA_DIR.

package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
	_ "time/tzdata"
)

// ---------- storage ----------

type Hist struct {
	At     string `json:"at"`
	Status string `json:"status"`
}
type Lead struct {
	ID          string   `json:"id"`
	Created     string   `json:"created"`
	Source      string   `json:"source"`
	Entry       string   `json:"entry"`
	Type        string   `json:"type"`
	Business    string   `json:"business"`
	City        string   `json:"city"`
	Features    []string `json:"features"`
	Style       string   `json:"style"`
	Situation   string   `json:"situation"`
	Link        string   `json:"link"`
	Timing      string   `json:"timing"`
	Plan        string   `json:"plan"`
	Recommended string   `json:"recommended"`
	Billing     string   `json:"billing"`
	Name        string   `json:"name"`
	Phone       string   `json:"phone"`
	Email       string   `json:"email"`
	CallTime    string   `json:"callTime"`
	Message     string   `json:"message"`
	Device      string   `json:"device"`
	Status      string   `json:"status"`
	Note        string   `json:"note"`
	DemoURL     string   `json:"demoUrl"`
	Seen        bool     `json:"seen"`
	Updated     string   `json:"updated"`
	History     []Hist   `json:"history"`
	Pay         *Payment `json:"pay,omitempty"`
	Journey     *Journey `json:"journey,omitempty"`
}

// Journey: how the visitor used the website before the request. Only sent by the website when
// the visitor accepted its cookie (see src/zalastudio-weboldal/cookies.go).
type Journey struct {
	First  string `json:"first"`
	Visits int    `json:"visits"`
	Views  int    `json:"views"`
	Source string `json:"source"`
	Entry  string `json:"entry"`
	Device string `json:"device"`
	Trail  []Step `json:"trail"`
}
type Step struct {
	At string `json:"at"`
	T  string `json:"t"`
	V  string `json:"v,omitempty"`
}

var stepTypes = map[string]bool{"visit": true, "pv": true, "cfg_open": true, "cfg_step": true, "cfg_preview": true, "cfg_sent": true, "call": true, "mail": true, "lead": true}

func cleanJourney(j *Journey) *Journey {
	if j == nil {
		return nil
	}
	ts := func(s string) string {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			return t.UTC().Format(time.RFC3339)
		}
		return ""
	}
	out := &Journey{First: ts(j.First), Visits: max(0, min(j.Visits, 100000)), Views: max(0, min(j.Views, 1000000)),
		Source: clean(j.Source, 60), Entry: clean(j.Entry, 60), Device: clean(j.Device, 10), Trail: []Step{}}
	tr := j.Trail
	if len(tr) > 30 {
		tr = tr[len(tr)-30:]
	}
	for _, s := range tr {
		if at := ts(s.At); at != "" && stepTypes[s.T] {
			out.Trail = append(out.Trail, Step{At: at, T: s.T, V: clean(s.V, 60)})
		}
	}
	return out
}

type Settings struct {
	NtfyURL       string `json:"ntfyUrl"`
	NtfyToken     string `json:"ntfyToken"`
	NotifyLeads   bool   `json:"notifyLeads"`
	NotifyDown    bool   `json:"notifyDown"`
	SiteURL       string `json:"siteUrl"`
	DashURL       string `json:"dashUrl"`
	Spots         int    `json:"spots"`
	NotifyPay     bool   `json:"notifyPay"`
	StripeKey     string `json:"stripeKey"`
	StripeWebhook string `json:"stripeWebhook"`
	VatMode       string `json:"vatMode"` // brutto | netto | mentes
	PortalURL     string `json:"portalUrl"`
}
type Auth struct {
	Algo   string `json:"algo"`
	Salt   string `json:"salt"`
	Hash   string `json:"hash"`
	Secret string `json:"secret"`
	Set    string `json:"set"`
}

var (
	mu       sync.Mutex
	leads    []*Lead
	settings = Settings{NotifyLeads: true, NotifyDown: true, NotifyPay: true, SiteURL: "https://zalastudio.hu", Spots: 5, VatMode: "mentes"}
	auth     Auth
)

func readJSON(name string, v any) bool {
	b, err := os.ReadFile(filepath.Join(dataDir, name))
	if err != nil {
		return false
	}
	return json.Unmarshal(b, v) == nil
}
func writeJSON(name string, v any) error {
	b, err := json.MarshalIndent(v, "", " ")
	if err != nil {
		return err
	}
	f := filepath.Join(dataDir, name)
	if err := os.WriteFile(f+".tmp", b, 0o600); err != nil {
		return err
	}
	return os.Rename(f+".tmp", f)
}
func saveLeads() {
	if err := writeJSON("leads.json", leads); err != nil {
		log.Print("leads: could not save: ", err)
	}
}
