// Szikra – interactive study app for the érettségi: short rounds, spaced repetition, memoriter
// drills. One static program: the page and the study material are compiled in, progress is a
// small JSON file in DATA_DIR.
package main

import (
	"context"
	"log"
	"math/rand/v2"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata"
)

const version = "1.1.0"

var loc = time.UTC

func main() {
	if l, err := time.LoadLocation(env("TZ", "Europe/Budapest")); err == nil {
		loc = l
	}
	lib, err := loadLibrary(contentFS)
	if err != nil {
		log.Fatalf("content: %v", err)
	}
	profiles, err := openProfiles(env("DATA_DIR", "data"))
	if err != nil {
		log.Fatalf("data: %v", err)
	}
	auth, err := openAuth(env("DATA_DIR", "data"))
	if err != nil {
		log.Fatalf("auth: %v", err)
	}
	s := &server{lib: lib, profiles: profiles, auth: auth, libJSON: map[string][]byte{}, now: time.Now,
		rng: rand.New(rand.NewPCG(uint64(time.Now().UnixNano()), 0x5a1c))}

	mux := http.NewServeMux()
	s.routes(mux)
	mux.Handle("/", staticHandler())

	// PORT: behind Umbrel's login. REMOTE_PORT: the public address, with the app's own password.
	servers := []*http.Server{newServer(env("PORT", "8080"), secure(s.guard(mux, false)))}
	if rp := os.Getenv("REMOTE_PORT"); rp != "" {
		servers = append(servers, newServer(rp, secure(s.guard(mux, true))))
	}
	go func() {
		ch := make(chan os.Signal, 1)
		signal.Notify(ch, syscall.SIGTERM, os.Interrupt)
		<-ch
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()
		for _, srv := range servers {
			srv.Shutdown(ctx)
		}
	}()
	log.Printf("Szikra %s: %d cards", version, len(lib.All))
	errc := make(chan error, len(servers))
	for _, srv := range servers {
		log.Printf("listening on %s", srv.Addr)
		go func(srv *http.Server) { errc <- srv.ListenAndServe() }(srv)
	}
	if err := <-errc; err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func newServer(port string, h http.Handler) *http.Server {
	return &http.Server{
		Addr:              ":" + port,
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
}

func secure(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hd := w.Header()
		hd.Set("X-Content-Type-Options", "nosniff")
		hd.Set("Referrer-Policy", "no-referrer")
		hd.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'")
		h.ServeHTTP(w, r)
	})
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
