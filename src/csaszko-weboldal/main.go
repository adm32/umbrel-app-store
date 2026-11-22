// Csaszko Barbershop – website server (Go, standard library only).
//
// Serves the one-page site compiled into the program, and passes /api/ through to the
// "Csaszko Foglalások" app (services, free times, bookings, anonymous statistics) over
// Umbrel's internal network. If that app is not running, /api/ answers 502 and the page
// shows its built-in price list and asks visitors to call.
package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"strings"
	"time"
)

//go:embed www
var wwwFS embed.FS

const csp = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"

var types = map[string]string{
	".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8",
	".svg": "image/svg+xml", ".woff": "font/woff", ".woff2": "font/woff2", ".webp": "image/webp", ".jpg": "image/jpeg",
	".jpeg": "image/jpeg", ".png": "image/png", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon",
}

type file struct {
	body, gz []byte
	ctype    string
	etag     string
	long     bool // fonts and images: cached for a week
}

var files = map[string]*file{}

func load() {
	err := fs.WalkDir(wwwFS, "www", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, err := fs.ReadFile(wwwFS, p)
		if err != nil {
			return err
		}
		ext := strings.ToLower(path.Ext(p))
		f := &file{body: b, ctype: types[ext]}
		if f.ctype == "" {
			f.ctype = "application/octet-stream"
		}
		sum := sha256.Sum256(b)
		f.etag = `"` + hex.EncodeToString(sum[:8]) + `"`
		f.long = !(ext == ".html" || ext == ".css" || ext == ".js" || ext == ".txt")
		if strings.HasPrefix(f.ctype, "text/") || ext == ".js" || ext == ".svg" || ext == ".woff" {
			var buf bytes.Buffer
			zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
			zw.Write(b)
			zw.Close()
			if buf.Len() < len(b) {
				f.gz = buf.Bytes()
			}
		}
		files["/"+strings.TrimPrefix(p, "www/")] = f
		return nil
	})
	if err != nil {
		log.Fatal(err)
	}
	// Cache busting: the page asks for styles.css?v=<hash> and app.js?v=<hash>, so a browser or
	// Cloudflare copy of an older version can never be combined with a newer page.
	if idx := files["/index.html"]; idx != nil {
		b := string(idx.body)
		for _, name := range []string{"styles.css", "app.js"} {
			if f := files["/"+name]; f != nil {
				b = strings.ReplaceAll(b, `"`+name+`"`, `"`+name+`?v=`+strings.Trim(f.etag, `"`)+`"`)
			}
		}
		setBody(idx, []byte(b))
	}
}

func setBody(f *file, b []byte) {
	f.body = b
	sum := sha256.Sum256(b)
	f.etag = `"` + hex.EncodeToString(sum[:8]) + `"`
	f.gz = nil
	var buf bytes.Buffer
	zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	zw.Write(b)
	zw.Close()
	if buf.Len() < len(b) {
		f.gz = buf.Bytes()
	}
}

func securityHeaders(h http.Header) {
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()")
	h.Set("Content-Security-Policy", csp)
}

func static(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" && r.Method != "HEAD" {
		w.Header().Set("Allow", "GET, HEAD")
		w.WriteHeader(405)
		return
	}
	p := r.URL.Path
	if p == "/" || p == "" {
		p = "/index.html"
	}
	f := files[path.Clean(p)]
	if f == nil {
		// unknown addresses go to the front page
		w.Header().Set("Location", "/")
		w.WriteHeader(302)
		return
	}
	h := w.Header()
	securityHeaders(h)
	h.Set("Content-Type", f.ctype)
	h.Set("ETag", f.etag)
	h.Set("Vary", "Accept-Encoding")
	if r.URL.Query().Get("v") != "" && p != "/index.html" {
		// styles.css?v=<hash> and app.js?v=<hash>: the address changes with the content
		h.Set("Cache-Control", "public, max-age=31536000, immutable")
	} else if f.long {
		h.Set("Cache-Control", "public, max-age=604800")
	} else {
		h.Set("Cache-Control", "no-cache") // always revalidate (cheap 304), so an update shows at once
	}
	if match := r.Header.Get("If-None-Match"); match != "" && strings.Contains(match, f.etag) {
		w.WriteHeader(304)
		return
	}
	body := f.body
	if f.gz != nil && strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		h.Set("Content-Encoding", "gzip")
		body = f.gz
	}
	w.WriteHeader(200)
	if r.Method != "HEAD" {
		w.Write(body)
	}
}

func apiProxy(target string) http.Handler {
	u, err := url.Parse(target)
	if err != nil {
		log.Fatal("BOOKING_API: ", err)
	}
	rp := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(u)
			// keep the chain (Cloudflare → Umbrel proxy → here) so the booking app sees the visitor's address
			if v := pr.In.Header.Get("X-Forwarded-For"); v != "" {
				pr.Out.Header.Set("X-Forwarded-For", v)
			}
			pr.SetXForwarded()
			pr.Out.Host = pr.In.Host
		},
		Transport: &http.Transport{
			DialContext:           (&net.Dialer{Timeout: 3 * time.Second}).DialContext,
			ResponseHeaderTimeout: 20 * time.Second,
			MaxIdleConns:          20,
			IdleConnTimeout:       60 * time.Second,
		},
		ModifyResponse: func(res *http.Response) error {
			// Instagram pictures may be cached; everything else (free times, bookings) never
			if !strings.HasPrefix(res.Header.Get("Cache-Control"), "public") || !strings.HasPrefix(res.Header.Get("Content-Type"), "image/") {
				res.Header.Set("Cache-Control", "no-store")
			}
			res.Header.Set("X-Content-Type-Options", "nosniff")
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			log.Print("booking app not reachable: ", err)
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(502)
			w.Write([]byte(`{"error":"unavailable"}`))
		},
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 32<<10)
		rp.ServeHTTP(w, r)
	})
}

func main() {
	load()
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	api := os.Getenv("BOOKING_API")
	if api == "" {
		api = "http://adam-csaszko-foglalasok_web_1:3001"
	}
	proxy := apiProxy(api)
	mux := http.NewServeMux()
	mux.Handle("/api/", proxy)
	mux.HandleFunc("/", static)
	srv := &http.Server{
		Addr: ":" + port, Handler: mux,
		ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 40 * time.Second, IdleTimeout: 120 * time.Second,
	}
	log.Printf("Csaszko Barbershop on :%s, bookings via %s", port, api)
	log.Fatal(srv.ListenAndServe())
}
