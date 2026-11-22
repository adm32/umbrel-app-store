// Zala Studio weboldal – static files: www/ is compiled in, gzipped once at start, served with cache headers.

package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	_ "time/tzdata"
)

// ---------- static files ----------

type file struct {
	data  []byte
	etag  string
	ctype string
	gz    []byte // gzip version of text files (made once at start), nil when not worth it
}

var files = map[string]*file{}

func loadFiles() {
	fs.WalkDir(wwwFS, "www", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		b, _ := wwwFS.ReadFile(p)
		sum := sha256.Sum256(b)
		ct := mime.TypeByExtension(path.Ext(p))
		switch path.Ext(p) {
		case ".html":
			ct = "text/html; charset=utf-8"
		case ".css":
			ct = "text/css; charset=utf-8"
		case ".js":
			ct = "text/javascript; charset=utf-8"
		case ".webmanifest":
			ct = "application/manifest+json"
		case ".woff":
			ct = "font/woff"
		case ".woff2":
			ct = "font/woff2"
		case ".txt":
			ct = "text/plain; charset=utf-8"
		case ".xml":
			ct = "application/xml"
		case ".ico":
			ct = "image/x-icon"
		}
		if ct == "" {
			ct = "application/octet-stream"
		}
		f := &file{data: b, etag: `"` + hex.EncodeToString(sum[:8]) + `"`, ctype: ct}
		if len(b) > 1024 && (strings.HasPrefix(ct, "text/") || strings.Contains(ct, "json") || strings.Contains(ct, "xml") || strings.Contains(ct, "svg")) {
			var buf bytes.Buffer
			zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
			zw.Write(b)
			zw.Close()
			if buf.Len() < len(b)*9/10 {
				f.gz = buf.Bytes()
			}
		}
		files[strings.TrimPrefix(p, "www")] = f
		return nil
	})
}
func cacheFor(p string) string {
	switch {
	case strings.HasPrefix(p, "/assets/fonts/"):
		return "public, max-age=31536000, immutable"
	case strings.HasPrefix(p, "/assets/img/"), strings.HasPrefix(p, "/assets/logo/"):
		return "public, max-age=2592000"
	case strings.HasPrefix(p, "/assets/"), strings.HasSuffix(p, ".png"), strings.HasSuffix(p, ".ico"), strings.HasSuffix(p, ".svg"), strings.HasSuffix(p, ".jpg"), strings.HasSuffix(p, ".webmanifest"):
		return "public, max-age=86400"
	}
	return "no-cache"
}
func serveFile(w http.ResponseWriter, r *http.Request, p string, f *file, code int) {
	h := w.Header()
	h.Set("Content-Type", f.ctype)
	cc := cacheFor(p)
	if strings.HasPrefix(p, "/assets/") && strings.HasPrefix(r.URL.RawQuery, "v=") {
		cc = "public, max-age=31536000, immutable" // the ?v= changes with every release
	}
	h.Set("Cache-Control", cc)
	body, etag := f.data, f.etag
	if f.gz != nil {
		h.Set("Vary", "Accept-Encoding")
		if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			body, etag = f.gz, strings.TrimSuffix(f.etag, `"`)+`-gz"`
			h.Set("Content-Encoding", "gzip")
		}
	}
	h.Set("ETag", etag)
	if code == 200 && r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(304)
		return
	}
	h.Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(code)
	if r.Method != "HEAD" {
		w.Write(body)
	}
}
func notFound(w http.ResponseWriter, r *http.Request) {
	if f := files["/404.html"]; f != nil {
		serveFile(w, r, "/404.html", f, 404)
		return
	}
	http.NotFound(w, r)
}
