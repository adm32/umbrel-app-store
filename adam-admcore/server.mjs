// core (admcore.hu) – web server for Umbrel. Node 22, no dependencies.
//
// Public (port 8080, behind Umbrel's app proxy / Cloudflare Tunnel):
//   GET  /...                 the website from ./www
//   POST /api/ajanlatkeres    request from the planner (JSON) or the no-JS form (urlencoded)
//   POST /api/e               cookieless page statistics (counts only)
//   GET  /api/info            { spots } – remaining launch-discount places
//
// Internal (port 9095, only reachable from other containers on the Umbrel, never published):
//   GET  /stats               aggregated statistics (no personal data) for the core Irányítópult app
//   GET  /health              status of the outbox
//   POST /config              { spots } – set by the Irányítópult
//
// Requests are saved to /data/outbox.json first, then handed to the Irányítópult app
// (DASH_INGEST). Until that succeeds they stay in the outbox and are retried every minute.
// If the Irányítópult can't be reached, a push notification goes out through ntfy instead
// (NTFY_URL or /data/ntfy-url.txt), so nothing is lost.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(process.env.WWW_DIR || "/app/www");
const DATA = path.resolve(process.env.DATA_DIR || "/data");
const PORT = Number(process.env.PORT || 8080);
const INTERNAL_PORT = Number(process.env.INTERNAL_PORT || 9095);
const DASH_INGEST = process.env.DASH_INGEST || "http://adam-core-iranyitopult_web_1:9097/ingest";
const TZ = "Europe/Budapest";

fs.mkdirSync(DATA, { recursive: true });

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml",
};
const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
};

// ---------- small helpers ----------
const readJSON = (file, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8")); } catch { return fallback; } };
function writeJSON(file, value) {
  const f = path.join(DATA, file), tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, f);
}
function setting(envName, file) {
  if (process.env[envName]) return process.env[envName].trim();
  try { return fs.readFileSync(path.join(DATA, file), "utf8").trim(); } catch { return ""; }
}
const dayKey = (d = new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const clientIp = (req) => String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
function readBody(req, max = 20000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > max) { reject(new Error("too big")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function json(res, status, obj, extra = {}) {
  res.writeHead(status, { ...SECURITY, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra });
  res.end(JSON.stringify(obj));
}
function limiter(max, windowMs) {
  const m = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of m) if (!v.some((t) => now - t < windowMs)) m.delete(k); }, windowMs).unref();
  return (key) => {
    const now = Date.now();
    const list = (m.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) { m.set(key, list); return false; }
    list.push(now); m.set(key, list); return true;
  };
}

// ---------- static files ----------
function cacheFor(p) {
  if (p.startsWith("/assets/fonts/")) return "public, max-age=31536000, immutable";
  if (p.startsWith("/assets/img/") || p.startsWith("/assets/logo/")) return "public, max-age=2592000";
  if (p.startsWith("/assets/") || /\.(png|ico|svg|jpg|webmanifest)$/.test(p)) return "public, max-age=86400";
  return "no-cache";
}
function serveFile(req, res, file, st, status = 200, urlPath = "/") {
  const ext = path.extname(file).toLowerCase();
  const lm = st.mtime.toUTCString();
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = { ...SECURITY, "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": cacheFor(urlPath), "Last-Modified": lm, ETag: etag };
  if (status === 200 && (req.headers["if-none-match"] === etag || (!req.headers["if-none-match"] && req.headers["if-modified-since"] === lm))) {
    res.writeHead(304, headers); return res.end();
  }
  headers["Content-Length"] = st.size;
  res.writeHead(status, headers);
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).on("error", () => res.end()).pipe(res);
}
function notFound(req, res) {
  const f = path.join(ROOT, "404.html");
  fs.stat(f, (err, st) => {
    if (err) { res.writeHead(404, SECURITY); return res.end("Not found"); }
    serveFile(req, res, f, st, 404, "/404.html");
  });
}

// ---------- configuration (set by the Irányítópult) ----------
let config = { spots: 5, ...readJSON("config.json", {}) };

// ---------- statistics (no cookies, no IP addresses stored) ----------
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|node-fetch|go-http/i;
let stats = readJSON("stats.json", { days: {}, salt: null, seen: [] });
if (!stats.days) stats = { days: {}, salt: null, seen: [] };
let seen = new Set(stats.seen || []);
const live = new Map(); // visitor hash -> last seen (ms)
let statsDirty = false;
function salt() {
  const d = dayKey();
  if (!stats.salt || stats.salt.day !== d) { stats.salt = { day: d, value: crypto.randomBytes(16).toString("hex") }; seen = new Set(); }
  return stats.salt.value;
}
function today() {
  const d = dayKey();
  if (!stats.days[d]) stats.days[d] = { pv: 0, uv: 0, dev: {}, ref: {}, pages: {}, ev: {}, src: {} };
  return stats.days[d];
}
function refName(host) {
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  if (!h) return "Közvetlen";
  if (/(^|\.)google\./.test(h)) return "Google";
  if (/facebook\.com$|(^|\.)fb\.(com|me)$/.test(h)) return "Facebook";
  if (/instagram\.com$/.test(h)) return "Instagram";
  if (/bing\.com$/.test(h)) return "Bing";
  if (/duckduckgo\.com$/.test(h)) return "DuckDuckGo";
  if (/tiktok\.com$/.test(h)) return "TikTok";
  if (/youtube\.com$/.test(h)) return "YouTube";
  if (/admcore\.hu$/.test(h)) return "Közvetlen";
  return h.slice(0, 60);
}
const bump = (obj, k, n = 1) => { obj[k] = (obj[k] || 0) + n; };
const EVENTS = new Set(["pv", "cfg_open", "cfg_step", "cfg_sent", "cfg_preview", "call", "mail"]);
const STEP_NAMES = new Set(["type", "name", "features", "style", "situation", "contact", "done"]);
const evLimit = limiter(400, 10 * 60 * 1000);

async function handleEvent(req, res) {
  res.writeHead(204, { ...SECURITY, "Cache-Control": "no-store" }); res.end();
  const ua = String(req.headers["user-agent"] || "");
  if (!ua || BOT.test(ua)) return;
  const ip = clientIp(req);
  if (!evLimit(ip)) return;
  let e;
  try { e = JSON.parse(await readBody(req, 2048)); } catch { return; }
  if (!e || !EVENTS.has(e.t)) return;
  const day = today();
  const visitor = crypto.createHash("sha256").update(salt() + "|" + ip + "|" + ua).digest("hex").slice(0, 16);
  live.set(visitor, Date.now());
  if (e.t === "pv") {
    bump(day, "pv");
    if (!seen.has(visitor)) {
      seen.add(visitor); bump(day, "uv");
      const mobile = /Mobi|Android|iPhone|iPod/i.test(ua), tablet = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobi/i.test(ua));
      bump(day.dev, tablet ? "tablet" : mobile ? "mobil" : "asztali");
      bump(day.ref, refName(e.r));
    }
    bump(day.pages, String(e.p || "/").slice(0, 60));
  } else if (e.t === "cfg_step") {
    const s = String(e.s || "");
    if (STEP_NAMES.has(s)) bump(day.ev, "step_" + s);
  } else {
    bump(day.ev, e.t);
    if (e.t === "cfg_open" && e.src) bump(day.src, String(e.src).slice(0, 30));
  }
  statsDirty = true;
}
function saveStats() {
  if (!statsDirty) return;
  const keys = Object.keys(stats.days).sort();
  while (keys.length > 400) delete stats.days[keys.shift()];
  stats.seen = [...seen];
  try { writeJSON("stats.json", stats); statsDirty = false; } catch (e) { console.error("stats: could not save:", e.message); }
}
setInterval(saveStats, 60 * 1000).unref();
function liveCount() {
  const now = Date.now();
  let n = 0;
  for (const [k, t] of live) { if (now - t < 5 * 60 * 1000) n++; else live.delete(k); }
  return n;
}

// ---------- requests (leads) ----------
const LABELS = {
  tipus: { etterem: "Étterem, kávézó", szepseg: "Szépség, egészség", szaki: "Szaki, építőipar", szallas: "Szállás, vendégház", bolt: "Üzlet, bolt", egyeb: "Egyéb szolgáltatás" },
  funkciok: { arlista: "Árlista vagy étlap", galeria: "Képgaléria", ajanlat: "Ajánlatkérő űrlap", foglalas: "Online időpontfoglalás", rendeles: "Online rendelés", nyelv: "Német és angol nyelv", tobb: "Több aloldal", kozosseg: "Facebook és Instagram", kezeles: "Teljes körű kezelés" },
  stilus: { meleg: "Meleg, barátságos", lagy: "Lágy, elegáns", termeszetes: "Természetes", friss: "Friss, modern", elegans: "Prémium, sötét" },
  helyzet: { nincs: "Még nincs weboldala", facebook: "Csak Facebook-oldala van", regi: "Van, de megújítaná" },
  mikorra: { surgos: "Minél előbb", honap: "1–2 hónapon belül", erdeklodik: "Csak tájékozódik" },
  hivhato: { delelott: "Délelőtt", delutan: "Délután", barmikor: "Bármikor" },
  csomag: { nevjegy: "Névjegy", vallalkozas: "Vállalkozás", rendeles: "Rendelés & Foglalás", premium: "Prémium Partner" },
};
const PRICES = { nevjegy: 3490, vallalkozas: 6990, rendeles: 14990, premium: 39990 };
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/[ \t]+/g, " ").trim().slice(0, max);
const pick = (group, v) => (Object.prototype.hasOwnProperty.call(LABELS[group], v) ? v : "");
const formLimit = limiter(5, 10 * 60 * 1000);

let outbox = readJSON("outbox.json", []);
if (!Array.isArray(outbox)) outbox = [];
const saveOutbox = () => writeJSON("outbox.json", outbox);

async function handleLead(req, res) {
  const isJson = (req.headers["content-type"] || "").includes("application/json");
  const reply = (status, message) => {
    if (isJson) return json(res, status, { ok: status === 200, message });
    if (status === 200) { res.writeHead(303, { ...SECURITY, Location: "/koszonom.html" }); return res.end(); }
    res.writeHead(status, { ...SECURITY, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(`<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nem sikerült elküldeni</title><link rel="stylesheet" href="/assets/css/site.css?v=6"><main class="doc"><div class="wrap"><div class="doc__card center-card"><h1>Nem sikerült elküldeni</h1><p>${String(message).replace(/[<>&]/g, "")}</p><p>Hívjon minket: <a href="tel:+36203282840">+36 20 328 2840</a></p><a class="btn btn--primary" href="/#tervezes">Vissza</a></div></div></main></html>`);
  };

  const ip = clientIp(req);
  if (!formLimit(ip)) return reply(429, "Túl sok kérés rövid idő alatt. Próbálja újra később, vagy hívjon minket.");

  let d;
  try {
    const raw = await readBody(req);
    d = isJson ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
  } catch { return reply(400, "Hibás kérés."); }
  if (!d || typeof d !== "object") return reply(400, "Hibás kérés.");

  const now = Date.now();
  if (d.weboldal) return reply(200, "ok");                       // honeypot filled = bot
  const t = Number(d.t || 0);
  if (t && now - t < 2500) return reply(200, "ok");               // faster than a human

  const features = (Array.isArray(d.funkciok) ? d.funkciok : []).map(String).filter((f) => LABELS.funkciok[f]).slice(0, 12);
  const lead = {
    id: crypto.randomUUID(),
    created: new Date(now).toISOString(),
    source: d.forras === "tervezo" ? "tervezo" : "urlap",
    entry: clean(d.src, 30),
    type: pick("tipus", d.tipus),
    business: clean(d.vallalkozas, 120),
    city: clean(d.telepules, 60),
    features: [...new Set(features)],
    style: pick("stilus", d.stilus),
    situation: pick("helyzet", d.helyzet),
    link: clean(d.link, 200),
    timing: pick("mikorra", d.mikorra),
    plan: pick("csomag", d.csomag),
    recommended: pick("csomag", d.ajanlott),
    billing: d.fizetes === "y" ? "y" : "m",
    name: clean(d.nev, 80),
    phone: clean(d.telefon, 40),
    email: clean(d.email, 120),
    callTime: pick("hivhato", d.hivhato),
    message: String(d.uzenet ?? "").replace(/\r/g, "").trim().slice(0, 2000),
    device: /Mobi|Android|iPhone/i.test(String(req.headers["user-agent"] || "")) ? "mobil" : "asztali",
  };

  if (lead.name.length < 2) return reply(422, "Adja meg a nevét.");
  if (!lead.phone && !lead.email) return reply(422, "Adjon meg egy telefonszámot vagy e-mail-címet.");
  if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lead.email)) return reply(422, "Az e-mail-cím formátuma nem megfelelő.");
  if (d.adatkezeles !== "igen" && d.adatkezeles !== true) return reply(422, "Kérjük, fogadja el az adatkezelési tájékoztatót.");
  if (!lead.business && lead.source === "urlap") return reply(422, "Adja meg a vállalkozás nevét.");

  try {
    outbox.push({ lead, tries: 0, notified: false });
    saveOutbox();
  } catch (e) {
    console.error("lead: could not save:", e.message);
    return reply(500, "Most nem sikerült elmenteni a kérést.");
  }
  console.log(`lead: ${lead.business || lead.name} (${lead.source})`);
  reply(200, "ok");
  flush();
}

let flushing = false;
async function flush() {
  if (flushing || !outbox.length) return;
  flushing = true;
  try {
    for (const item of [...outbox]) {
      let delivered = false;
      try {
        const r = await fetch(DASH_INGEST, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item.lead), signal: AbortSignal.timeout(6000) });
        delivered = r.ok;
      } catch { delivered = false; }
      if (delivered) {
        outbox = outbox.filter((x) => x.lead.id !== item.lead.id);
        saveOutbox();
        continue;
      }
      item.tries++;
      if (!item.notified && (await notifyFallback(item.lead))) item.notified = true;
      saveOutbox();
    }
  } finally { flushing = false; }
}
setInterval(flush, 60 * 1000).unref();
setTimeout(flush, 3000).unref();

function leadText(l) {
  const L = LABELS;
  return [
    `${l.name}${l.business ? " · " + l.business : ""}`,
    l.city && `Település: ${l.city}`,
    l.phone && `Telefon: ${l.phone}`,
    l.email && `E-mail: ${l.email}`,
    l.type && `Típus: ${L.tipus[l.type]}`,
    l.plan && `Csomag: ${L.csomag[l.plan]} (${PRICES[l.plan]} Ft/hó)`,
    l.features.length && `Funkciók: ${l.features.map((f) => L.funkciok[f]).join(", ")}`,
    l.timing && `Mikorra: ${L.mikorra[l.timing]}`,
    l.callTime && `Hívható: ${L.hivhato[l.callTime]}`,
    l.message && `\n${l.message}`,
  ].filter(Boolean).join("\n");
}
async function notifyFallback(lead) {
  const url = setting("NTFY_URL", "ntfy-url.txt");
  if (!url) return false;
  const token = setting("NTFY_TOKEN", "ntfy-token.txt");
  try {
    const u = new URL(url);
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(`${u.origin}/`, {
      method: "POST", headers, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ topic: u.pathname.replace(/^\/+/, ""), title: `Új érdeklődő: ${lead.business || lead.name}`, message: leadText(lead) + "\n\n(Az Irányítópult nem érhető el, a kérés a weboldal appban vár.)", tags: ["house"], priority: 4 }),
    });
    return r.ok;
  } catch (e) { console.error("ntfy:", e.message); return false; }
}

// ---------- public server ----------
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    let p = decodeURIComponent(url.pathname);

    if (p === "/api/ajanlatkeres") {
      if (req.method === "POST") return await handleLead(req, res);
      res.writeHead(405, { Allow: "POST" }); return res.end();
    }
    if (p === "/api/e") {
      if (req.method === "POST") return await handleEvent(req, res);
      res.writeHead(405, { Allow: "POST" }); return res.end();
    }
    if (p === "/api/info") return json(res, 200, { spots: Math.max(0, Number(config.spots) || 0) }, { "Cache-Control": "public, max-age=60" });
    if (p === "/healthz") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("ok"); }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }); return res.end(); }

    if (p.endsWith("/")) p += "index.html";
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT + path.sep)) return notFound(req, res);
    fs.stat(file, (err, st) => (err || !st.isFile() ? notFound(req, res) : serveFile(req, res, file, st, 200, p)));
  } catch {
    notFound(req, res);
  }
}).listen(PORT, () => console.log(`core: website on :${PORT}`));

// ---------- internal server (other Umbrel apps only) ----------
http.createServer(async (req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  if (p === "/stats" && req.method === "GET") {
    saveStats();
    return json(res, 200, { days: stats.days, live: liveCount(), today: dayKey(), spots: config.spots });
  }
  if (p === "/health" && req.method === "GET") {
    return json(res, 200, { ok: true, outbox: outbox.length, oldest: outbox[0] ? outbox[0].lead.created : null, ntfyFallback: !!setting("NTFY_URL", "ntfy-url.txt"), version: process.env.APP_VERSION || "" });
  }
  if (p === "/config" && req.method === "POST") {
    try {
      const c = JSON.parse(await readBody(req, 1000));
      if (c && Number.isFinite(Number(c.spots))) config.spots = Math.max(0, Math.min(99, Math.round(Number(c.spots))));
      writeJSON("config.json", config);
      return json(res, 200, { ok: true, config });
    } catch { return json(res, 400, { ok: false }); }
  }
  res.writeHead(404); res.end();
}).listen(INTERNAL_PORT, () => console.log(`core: internal data on :${INTERNAL_PORT}`));

function shutdown() { try { saveStats(); } catch { /* ignore */ } process.exit(0); }
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
