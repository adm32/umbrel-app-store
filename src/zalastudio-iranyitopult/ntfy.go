// Zala Studio Irányítópult – ntfy push notifications (no names, phone numbers or e-mails in them).

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	_ "time/tzdata"
)

// ---------- ntfy ----------

type ntfyMsg struct {
	Topic    string           `json:"topic"`
	Title    string           `json:"title"`
	Message  string           `json:"message"`
	Tags     []string         `json:"tags,omitempty"`
	Priority int              `json:"priority"`
	Click    string           `json:"click,omitempty"`
	Actions  []map[string]any `json:"actions,omitempty"`
}

func ntfy(m ntfyMsg) error {
	mu.Lock()
	s := settings
	mu.Unlock()
	if s.NtfyURL == "" {
		return fmt.Errorf("Nincs megadva ntfy-cím.")
	}
	u, err := url.Parse(s.NtfyURL)
	if err != nil {
		return fmt.Errorf("Az ntfy-cím nem érvényes.")
	}
	m.Topic = strings.TrimLeft(u.Path, "/")
	b, _ := json.Marshal(m)
	req, _ := http.NewRequest("POST", u.Scheme+"://"+u.Host+"/", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if s.NtfyToken != "" {
		req.Header.Set("Authorization", "Bearer "+s.NtfyToken)
	}
	r, err := httpc.Do(req)
	if err != nil {
		return fmt.Errorf("Az ntfy nem érhető el: %v", err)
	}
	r.Body.Close()
	if r.StatusCode >= 300 {
		return fmt.Errorf("Az ntfy %d hibát adott.", r.StatusCode)
	}
	return nil
}

func huNum(n int) string {
	s := strconv.Itoa(n)
	var out []byte
	for i := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, ' ')
		}
		out = append(out, s[i])
	}
	return string(out)
}

func notifyLead(l Lead) {
	mu.Lock()
	s := settings
	mu.Unlock()
	if !s.NotifyLeads || s.NtfyURL == "" {
		return
	}
	// No personal data goes to ntfy (an outside service): only that a request came in.
	// The details are in the Irányítópult, behind its own password.
	m := ntfyMsg{Title: "Új ajánlatkérés", Message: "Új ajánlatkérés érkezett a zalastudio.hu-ról.", Tags: []string{"house"}, Priority: 4}
	if l.Timing == "surgos" {
		m.Priority = 5
	}
	if s.DashURL != "" {
		link := strings.TrimRight(s.DashURL, "/") + "/#lead=" + l.ID
		m.Click = link
		m.Actions = append(m.Actions, map[string]any{"action": "view", "label": "Megnyitás", "url": link, "clear": true})
	}
	if err := ntfy(m); err != nil {
		log.Print("ntfy: ", err)
	}
}
func firstNonEmpty(a ...string) string {
	for _, s := range a {
		if s != "" {
			return s
		}
	}
	return ""
}
