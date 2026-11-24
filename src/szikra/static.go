// Szikra – serving the compiled-in web/ files (gzipped once, with ETag).
package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"net/http"
	"path"
	"strconv"
	"strings"
	"sync"
)

//go:embed web
var webFS embed.FS

type staticCopy struct {
	gz   []byte
	etag string
}

var staticCopies sync.Map // name -> *staticCopy

func sendStatic(w http.ResponseWriter, r *http.Request, name string, data []byte, ctype, cache string) {
	v, ok := staticCopies.Load(name)
	if !ok {
		sum := sha256.Sum256(data)
		var b bytes.Buffer
		zw, _ := gzip.NewWriterLevel(&b, gzip.BestCompression)
		zw.Write(data)
		zw.Close()
		v, _ = staticCopies.LoadOrStore(name, &staticCopy{gz: b.Bytes(), etag: `"` + hex.EncodeToString(sum[:8]) + `"`})
	}
	c := v.(*staticCopy)
	h := w.Header()
	h.Set("Content-Type", ctype)
	h.Set("Cache-Control", cache)
	h.Add("Vary", "Accept-Encoding")
	h.Set("ETag", c.etag)
	if m := r.Header.Get("If-None-Match"); m != "" && strings.Contains(m, c.etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	body := data
	if len(c.gz) < len(data) && strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		h.Set("Content-Encoding", "gzip")
		body = c.gz
	}
	h.Set("Content-Length", strconv.Itoa(len(body)))
	if r.Method != http.MethodHead {
		w.Write(body)
	}
}

var ctypes = map[string]string{
	".html":        "text/html; charset=utf-8",
	".js":          "text/javascript; charset=utf-8",
	".css":         "text/css; charset=utf-8",
	".svg":         "image/svg+xml",
	".png":         "image/png",
	".webmanifest": "application/manifest+json",
}

// staticHandler serves web/. index.html gets the version filled in so the asset URLs change
// with every release (and can be cached for long).
func staticHandler() http.HandlerFunc {
	index, _ := webFS.ReadFile("web/index.html")
	index = bytes.ReplaceAll(index, []byte("{{V}}"), []byte(version))
	return func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if p == "/" || p == "/index.html" {
			sendStatic(w, r, "index.html", index, ctypes[".html"], "no-cache")
			return
		}
		name := path.Clean("web" + p)
		if !strings.HasPrefix(name, "web/") || strings.Contains(name[4:], "/") {
			http.NotFound(w, r)
			return
		}
		data, err := webFS.ReadFile(name)
		ct := ctypes[path.Ext(name)]
		if err != nil || ct == "" || name == "web/index.html" {
			http.NotFound(w, r)
			return
		}
		cache := "no-cache"
		if r.URL.Query().Get("v") != "" {
			cache = "public, max-age=31536000, immutable"
		}
		sendStatic(w, r, name, data, ct, cache)
	}
}
