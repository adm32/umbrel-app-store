// Csaszko Foglalások – storage: db.json and settings.json in DATA_DIR, plus small lookups.

package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strconv"
	_ "time/tzdata"
)

/* -------------------------------------------------------------- storage */

var (
	db       = &DB{}
	settings = defaultSettings()
)

func dbFile() string       { return filepath.Join(dataDir, "db.json") }
func settingsFile() string { return filepath.Join(dataDir, "settings.json") }

func readJSON(file string, v any) bool {
	b, err := os.ReadFile(file)
	if err != nil {
		return false
	}
	if err := json.Unmarshal(b, v); err != nil {
		log.Printf("%s: %v", file, err)
		return false
	}
	return true
}

func writeJSON(file string, v any) {
	b, err := json.MarshalIndent(v, "", " ")
	if err != nil {
		log.Print(err)
		return
	}
	tmp := file + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		log.Print(err)
		return
	}
	if err := os.Rename(tmp, file); err != nil {
		log.Print(err)
	}
}

func saveDB()       { writeJSON(dbFile(), db) }
func saveSettings() { writeJSON(settingsFile(), settings) }

func loadAll() {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		log.Fatal(err)
	}
	readJSON(dbFile(), db)
	if db.Bookings == nil {
		db.Bookings = []*Booking{}
	}
	if db.Blocks == nil {
		db.Blocks = []*Block{}
	}
	readJSON(settingsFile(), settings) // fills over the defaults, like the old deep merge
	if settings.Hours == nil {
		settings.Hours = defaultSettings().Hours
	}
	if len(settings.Services) == 0 {
		settings.Services = defaultServices()
	}
	if settings.SMTP.Port == 0 {
		settings.SMTP.Port = 465
	}
	if settings.StepMinutes == 0 {
		settings.StepMinutes = 20
	}
	if settings.HorizonDays == 0 {
		settings.HorizonDays = 30
	}
	if settings.Secret == "" {
		settings.Secret = randHex(24)
		saveSettings()
	}
	loadStats()
}

func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func serviceByID(id string) *Service {
	for i := range settings.Services {
		if settings.Services[i].ID == id {
			return &settings.Services[i]
		}
	}
	return nil
}

func ft(n int) string {
	s := strconv.Itoa(n)
	var out []byte
	for i := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, ' ')
		}
		out = append(out, s[i])
	}
	return string(out) + " Ft"
}
