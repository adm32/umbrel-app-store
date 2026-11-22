// Csaszko Foglalások – booking server for Csaszko Barbershop (Go, standard library only).
//
// A port of the earlier Node.js version (itself based on Esszencia Foglalások), with the same
// HTTP API and the same data files, so an update keeps every booking and setting.
//
// Three listeners:
//   - PUBLIC_PORT (3001): only what the website needs – services, free times, new bookings,
//     anonymous statistics. Reached by the website app over Umbrel's internal network.
//   - ADMIN_PORT (8080): the admin app, behind Umbrel's login through app_proxy.
//   - REMOTE_PORT (8082, published as 4773): the same admin app with its own password, for a
//     Cloudflare Tunnel hostname. Stays locked until a password is set from the Umbrel address.
//
// Data lives in DATA_DIR as JSON (db.json, settings.json, stats.json, stats-today.json).
// All dates and times are Budapest wall-clock strings ("2026-11-03", "09:30").
package main

import (
	"embed"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
	_ "time/tzdata"
)

//go:embed web
var webFS embed.FS

var (
	dataDir    = envOr("DATA_DIR", "data")
	adminPort  = envOr("ADMIN_PORT", "8080")
	publicPort = envOr("PUBLIC_PORT", "3001")
	remotePort = os.Getenv("REMOTE_PORT")
	loc        *time.Location
	mu         sync.Mutex // guards db, settings, stats and the limiters
)

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

/* ---------------------------------------------------------- housekeeping */

func purge() {
	mu.Lock()
	defer mu.Unlock()
	// personal data is not kept forever: bookings older than a year are removed
	cutoff := addDays(now().date, -365)
	before := len(db.Bookings) + len(db.Blocks)
	bk := db.Bookings[:0]
	for _, b := range db.Bookings {
		if b.Date >= cutoff {
			bk = append(bk, b)
		}
	}
	db.Bookings = bk
	bl := db.Blocks[:0]
	for _, k := range db.Blocks {
		to := k.DateTo
		if to == "" {
			to = k.Date
		}
		if to >= cutoff {
			bl = append(bl, k)
		}
	}
	db.Blocks = bl
	if len(db.Bookings)+len(db.Blocks) != before {
		saveDB()
	}
}

/* ----------------------------------------------------------------- start */

func serve(port string, h http.HandlerFunc, name string) *http.Server {
	srv := &http.Server{
		Addr: ":" + port,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if e := recover(); e != nil {
					log.Printf("[%s] panic: %v", name, e)
					send(w, 500, obj{"error": "Szerverhiba."})
				}
			}()
			h(w, r)
		}),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	return srv
}

func main() {
	var err error
	loc, err = time.LoadLocation("Europe/Budapest")
	if err != nil {
		log.Fatal(err)
	}
	loadAll()
	loadIG()
	purge()
	go igLoop()
	go func() {
		for range time.Tick(12 * time.Hour) {
			purge()
		}
	}()
	go cleanHits()
	go func() {
		for range time.Tick(30 * time.Second) {
			flushStats()
		}
	}()

	servers := []*http.Server{
		serve(publicPort, publicAPI, "public"),
		serve(adminPort, guarded(false), "admin"),
	}
	log.Print("Public booking API on :" + publicPort)
	log.Print("Admin app on :" + adminPort)
	if remotePort != "" {
		servers = append(servers, serve(remotePort, guarded(true), "remote"))
		log.Print("Remote admin (own password) on :" + remotePort)
	}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
	<-sig
	flushStats()
	for _, s := range servers {
		s.Close()
	}
}
