// admcore.hu – tiny web server for Umbrel (Node 22, no dependencies).
// Serves ./www and handles the contact form at POST /api/ajanlatkeres,
// which is forwarded to your phone through ntfy.
//
// ntfy topic URL is read from (first match wins):
//   1. environment variable NTFY_URL
//   2. the file /data/ntfy-url.txt   (= <app data folder>/data/ntfy-url.txt on the Umbrel)
// Optional access token: NTFY_TOKEN or /data/ntfy-token.txt

import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("/app/www");
const PORT = 8080;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml",
};

const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
};

function cacheFor(p) {
  if (p.startsWith("/assets/fonts/")) return "public, max-age=31536000, immutable";
  if (p.startsWith("/assets/img/") || p.startsWith("/assets/logo/")) return "public, max-age=2592000";
  if (p.startsWith("/assets/")) return "public, max-age=86400";
  return "no-cache";
}

function setting(envName, file) {
  if (process.env[envName]) return process.env[envName].trim();
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

function serveFile(res, file, status = 200, urlPath = "/") {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(status, { ...SECURITY, "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": cacheFor(urlPath) });
  fs.createReadStream(file).pipe(res);
}

function notFound(res) {
  const f = path.join(ROOT, "404.html");
  if (fs.existsSync(f)) return serveFile(res, f, 404);
  res.writeHead(404, SECURITY); res.end("Not found");
}

// ---------- contact form ----------
const LIMITS = { nev: 80, vallalkozas: 120, telepules: 60, telefon: 40, email: 120, tipus: 40, uzenet: 2000 };
const LABELS = {
  bemutato: "Ingyenes bemutatót kér", nevjegy: "Névjegy csomag", vallalkozas: "Vállalkozás csomag",
  rendeles: "Rendelés & Foglalás csomag", premium: "Prémium Partner csomag", zene: "Zenei szolgáltatás", kerdes: "Kérdése van",
};
const hits = new Map(); // ip -> [timestamps], simple rate limit

function readBody(req, max = 20000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > max) { reject(new Error("too big")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleForm(req, res) {
  const wantsJson = (req.headers["content-type"] || "").includes("application/json");
  const reply = (status, message) => {
    if (wantsJson) {
      res.writeHead(status, { ...SECURITY, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ ok: status === 200, message }));
    }
    if (status === 200) { res.writeHead(303, { Location: "/koszonom.html" }); return res.end(); }
    res.writeHead(status, { ...SECURITY, "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hiba</title><link rel="stylesheet" href="/assets/css/site.css?v=4"><main class="doc"><div class="wrap"><div class="doc__card glass center-card"><h1>Nem sikerült elküldeni</h1><p>${message.replace(/[<>&]/g, "")}</p><a class="btn" href="/#kapcsolat">Vissza az űrlaphoz</a></div></div></main></html>`);
  };

  const ip = String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (recent.length >= 5) return reply(429, "Túl sok üzenet rövid idő alatt. Próbálja újra később, vagy hívjon telefonon.");
  recent.push(now); hits.set(ip, recent);

  let data = {};
  try {
    const raw = await readBody(req);
    data = wantsJson ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
  } catch { return reply(400, "Hibás kérés."); }

  if (data.weboldal) return reply(200, "ok"); // honeypot
  const t = Number(data.t || 0);
  if (t && now - t < 2500) return reply(200, "ok"); // sent too fast = bot

  const f = {};
  for (const k of Object.keys(LIMITS)) f[k] = String(data[k] ?? "").replace(/\s+/g, " ").trim().slice(0, LIMITS[k]);
  f.uzenet = String(data.uzenet ?? "").trim().slice(0, LIMITS.uzenet);

  if (!f.nev || !f.vallalkozas) return reply(422, "Adja meg a nevét és a vállalkozás nevét.");
  if (!f.telefon && !f.email) return reply(422, "Adjon meg egy telefonszámot vagy e-mail-címet.");
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) return reply(422, "Az e-mail-cím formátuma nem megfelelő.");
  if (data.adatkezeles !== "igen") return reply(422, "Kérem, fogadja el az adatkezelési tájékoztatót.");

  const ntfyUrl = setting("NTFY_URL", "/data/ntfy-url.txt");
  if (!ntfyUrl) { console.error("Contact form: NTFY_URL / data/ntfy-url.txt is not set"); return reply(500, "Az űrlap még nincs beállítva."); }
  const token = setting("NTFY_TOKEN", "/data/ntfy-token.txt");

  const lines = [
    `${f.nev} · ${f.vallalkozas}`,
    f.telepules && `Település: ${f.telepules}`,
    f.telefon && `Telefon: ${f.telefon}`,
    f.email && `E-mail: ${f.email}`,
    `Mit szeretne: ${LABELS[f.tipus] || f.tipus || "–"}`,
    f.uzenet && `\n${f.uzenet}`,
  ].filter(Boolean);

  try {
    const u = new URL(ntfyUrl);
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(`${u.origin}/`, {
      method: "POST", headers,
      body: JSON.stringify({ topic: u.pathname.replace(/^\/+/, ""), title: `Új ajánlatkérés: ${f.vallalkozas}`, message: lines.join("\n"), tags: ["globe_with_meridians"], priority: 4 }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`ntfy ${r.status}`);
  } catch (e) {
    console.error("Contact form: could not reach ntfy:", e.message);
    return reply(502, "Most nem sikerült továbbítani az üzenetet.");
  }
  console.log(`Contact form: request from ${f.vallalkozas}`);
  return reply(200, "ok");
}

// ---------- server ----------
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    let p = decodeURIComponent(url.pathname);

    if (p === "/api/ajanlatkeres") {
      if (req.method === "POST") return await handleForm(req, res);
      res.writeHead(405, { Allow: "POST" }); return res.end();
    }
    if (p === "/healthz") { res.writeHead(200); return res.end("ok"); }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }); return res.end(); }

    if (p.endsWith("/")) p += "index.html";
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT + path.sep)) return notFound(res);
    fs.stat(file, (err, st) => (err || !st.isFile() ? notFound(res) : serveFile(res, file, 200, p)));
  } catch {
    notFound(res);
  }
}).listen(PORT, () => console.log(`admcore.hu listening on :${PORT}`));
