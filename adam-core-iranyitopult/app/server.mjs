// core Irányítópult – requests (leads) and visitor statistics for admcore.hu.
// Node 22, no dependencies. Runs as an Umbrel app next to "core (admcore.hu)".
//
// Port 8080 (Umbrel app proxy): the dashboard, protected by its own password.
// Port 9097 (internal, other containers only): POST /ingest – the website hands over new requests here.
//
// Data in /data (never in the app store):
//   jelszo.json   salted scrypt hash of the password + session secret
//   leads.json    the requests, with status, notes and history
//   settings.json notifications and the launch-discount counter

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(HERE, "web");
const DATA = path.resolve(process.env.DATA_DIR || "/data");
const PORT = Number(process.env.PORT || 8080);
const INGEST_PORT = Number(process.env.INGEST_PORT || 9097);
const SITE = (process.env.SITE_INTERNAL || "http://adam-admcore_web_1:9095").replace(/\/+$/, "");
const VERSION = "1.0.0";
fs.mkdirSync(DATA, { recursive: true });

// ---------- storage ----------
const readJSON = (f, fb) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")); } catch { return fb; } };
function writeJSON(f, v) {
  const file = path.join(DATA, f), tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(v, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
let leads = readJSON("leads.json", []);
if (!Array.isArray(leads)) leads = [];
const saveLeads = () => writeJSON("leads.json", leads);
const DEFAULT_SETTINGS = { ntfyUrl: "", ntfyToken: "", notifyLeads: true, notifyDown: true, siteUrl: "https://admcore.hu", dashUrl: "", spots: 5 };
let settings = { ...DEFAULT_SETTINGS, ...readJSON("settings.json", {}) };
const saveSettings = () => writeJSON("settings.json", settings);
let auth = readJSON("jelszo.json", {});

// ---------- vocabulary (must match the website) ----------
const L = {
  tipus: { etterem: "Étterem, kávézó", szepseg: "Szépség, egészség", szaki: "Szaki, építőipar", szallas: "Szállás, vendégház", bolt: "Üzlet, bolt", egyeb: "Egyéb szolgáltatás" },
  funkciok: { arlista: "Árlista vagy étlap", galeria: "Képgaléria", ajanlat: "Ajánlatkérő űrlap", foglalas: "Online időpontfoglalás", rendeles: "Online rendelés", nyelv: "Német és angol nyelv", tobb: "Több aloldal", kozosseg: "Facebook és Instagram", kezeles: "Teljes körű kezelés" },
  stilus: { meleg: "Meleg, barátságos", lagy: "Lágy, elegáns", termeszetes: "Természetes", friss: "Friss, modern", elegans: "Prémium, sötét" },
  helyzet: { nincs: "Még nincs weboldala", facebook: "Csak Facebook-oldala van", regi: "Van, de megújítaná" },
  mikorra: { surgos: "Minél előbb", honap: "1–2 hónapon belül", erdeklodik: "Csak tájékozódik" },
  hivhato: { delelott: "Délelőtt", delutan: "Délután", barmikor: "Bármikor" },
  csomag: { nevjegy: "Névjegy", vallalkozas: "Vállalkozás", rendeles: "Rendelés & Foglalás", premium: "Prémium Partner" },
  status: { uj: "Új", hivtam: "Felhívtam", bemutato: "Bemutató készül", elkuldve: "Bemutató elküldve", megrendelte: "Megrendelte", elutasitotta: "Nem kérte" },
};
const PRICES = { nevjegy: 3490, vallalkozas: 6990, rendeles: 14990, premium: 39990 };
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/[ \t]+/g, " ").trim().slice(0, max);
const pick = (g, v) => (Object.prototype.hasOwnProperty.call(L[g], v) ? v : "");
const noteText = (v) => String(v ?? "").replace(/\r/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, 4000);
const isId = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ""));

function sanitizeLead(d, manual = false) {
  const feats = (Array.isArray(d.features) ? d.features : []).map(String).filter((f) => L.funkciok[f]);
  return {
    id: isId(d.id) ? String(d.id).toLowerCase() : crypto.randomUUID(),
    created: !manual && !Number.isNaN(Date.parse(d.created)) ? new Date(d.created).toISOString() : new Date().toISOString(),
    source: manual ? "kezi" : d.source === "tervezo" ? "tervezo" : "urlap",
    entry: clean(d.entry, 30),
    type: pick("tipus", d.type), business: clean(d.business, 120), city: clean(d.city, 60),
    features: [...new Set(feats)].slice(0, 12), style: pick("stilus", d.style), situation: pick("helyzet", d.situation),
    link: clean(d.link, 200), timing: pick("mikorra", d.timing), plan: pick("csomag", d.plan), recommended: pick("csomag", d.recommended),
    billing: d.billing === "y" ? "y" : "m", name: clean(d.name, 80), phone: clean(d.phone, 40), email: clean(d.email, 120),
    callTime: pick("hivhato", d.callTime), message: String(d.message ?? "").replace(/\r/g, "").trim().slice(0, 2000),
    device: d.device === "mobil" ? "mobil" : d.device === "asztali" ? "asztali" : "",
    status: "uj", note: manual ? noteText(d.note) : "", demoUrl: "", seen: manual, updated: new Date().toISOString(),
    history: [{ at: new Date().toISOString(), status: "uj" }],
  };
}

// ---------- notifications (ntfy) ----------
async function ntfy({ title, message, tags = [], priority = 3, click = "", actions = [] }) {
  if (!settings.ntfyUrl) return { ok: false, error: "Nincs megadva ntfy-cím." };
  try {
    const u = new URL(settings.ntfyUrl);
    const headers = { "Content-Type": "application/json" };
    if (settings.ntfyToken) headers.Authorization = `Bearer ${settings.ntfyToken}`;
    const body = { topic: u.pathname.replace(/^\/+/, ""), title, message, tags, priority };
    if (click) body.click = click;
    if (actions.length) body.actions = actions;
    const r = await fetch(`${u.origin}/`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    return r.ok ? { ok: true } : { ok: false, error: `Az ntfy ${r.status} hibát adott.` };
  } catch (e) { return { ok: false, error: "Az ntfy nem érhető el: " + e.message }; }
}
function leadSummary(l) {
  return [
    `${l.name}${l.business ? " · " + l.business : ""}${l.city ? " (" + l.city + ")" : ""}`,
    l.phone && `Telefon: ${l.phone}`, l.email && `E-mail: ${l.email}`,
    l.plan && `Csomag: ${L.csomag[l.plan]} – ${PRICES[l.plan].toLocaleString("hu-HU")} Ft/hó`,
    l.features.length && `Kér: ${l.features.map((f) => L.funkciok[f]).join(", ")}`,
    l.timing && `Mikorra: ${L.mikorra[l.timing]}`, l.callTime && `Hívható: ${L.hivhato[l.callTime]}`,
    l.message && `„${l.message.slice(0, 300)}”`,
  ].filter(Boolean).join("\n");
}
function notifyLead(l) {
  if (!settings.notifyLeads) return;
  const actions = [];
  if (l.phone) actions.push({ action: "view", label: "Hívás", url: "tel:" + l.phone.replace(/[^\d+]/g, ""), clear: false });
  if (settings.dashUrl) actions.push({ action: "view", label: "Megnyitás", url: settings.dashUrl.replace(/\/+$/, "") + "/#lead=" + l.id, clear: true });
  ntfy({ title: `Új érdeklődő: ${l.business || l.name}`, message: leadSummary(l), tags: ["house"], priority: l.timing === "surgos" ? 5 : 4, click: settings.dashUrl ? settings.dashUrl.replace(/\/+$/, "") + "/#lead=" + l.id : "", actions })
    .then((r) => { if (!r.ok) console.error("ntfy:", r.error); });
}

// ---------- monitoring ----------
const status = { site: { ok: null, at: null, outbox: 0, error: "" }, public: { ok: null, at: null, ms: 0, error: "", fails: 0, alerted: false } };
async function check() {
  try {
    const r = await fetch(SITE + "/health", { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    status.site = { ok: r.ok, at: new Date().toISOString(), outbox: j.outbox || 0, error: "" };
  } catch (e) { status.site = { ok: false, at: new Date().toISOString(), outbox: 0, error: "A weboldal app nem válaszol." }; }
  if (settings.siteUrl) {
    const t0 = Date.now();
    try {
      const r = await fetch(settings.siteUrl.replace(/\/+$/, "") + "/healthz", { signal: AbortSignal.timeout(12000), headers: { "User-Agent": "core-iranyitopult-monitor" } });
      const ok = r.ok;
      status.public = { ...status.public, ok, at: new Date().toISOString(), ms: Date.now() - t0, error: ok ? "" : `HTTP ${r.status}${r.status === 530 ? " (Cloudflare: az alagút nem fut, 1033-as hiba)" : ""}` };
    } catch (e) { status.public = { ...status.public, ok: false, at: new Date().toISOString(), ms: 0, error: "Nem érhető el: " + (e.cause?.code || e.message) }; }
    if (status.public.ok) {
      if (status.public.alerted && settings.notifyDown) ntfy({ title: "A weboldal újra elérhető", message: settings.siteUrl, tags: ["white_check_mark"], priority: 3 });
      status.public.fails = 0; status.public.alerted = false;
    } else {
      status.public.fails++;
      if (status.public.fails >= 2 && !status.public.alerted && settings.notifyDown) {
        status.public.alerted = true;
        ntfy({ title: "A weboldal nem érhető el", message: `${settings.siteUrl}\n${status.public.error}\nNézd meg a Cloudflare Tunnel appot és a core appot az Umbrelen.`, tags: ["warning"], priority: 5 });
      }
    }
  }
}
setInterval(check, 5 * 60 * 1000).unref();
setTimeout(check, 4000).unref();
async function pushSpots() {
  try { await fetch(SITE + "/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spots: settings.spots }), signal: AbortSignal.timeout(5000) }); return true; }
  catch { return false; }
}
setTimeout(pushSpots, 5000).unref();

// ---------- auth ----------
const COOKIE = "core_dash";
const MAX_AGE = 180 * 24 * 3600;
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
const hasPassword = () => !!auth.hash;
function setPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  auth = { salt, hash: hashPw(pw, salt), secret: crypto.randomBytes(32).toString("hex"), set: new Date().toISOString() };
  writeJSON("jelszo.json", auth);
}
function checkPassword(pw) {
  if (!auth.hash) return false;
  const a = Buffer.from(hashPw(String(pw), auth.salt), "hex"), b = Buffer.from(auth.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sign = (ts) => crypto.createHmac("sha256", auth.secret).update("core-dash|" + ts).digest("hex");
function cookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach((p) => { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function authed(req) {
  if (!auth.secret) return false;
  const v = cookies(req)[COOKIE] || "";
  const [ts, mac] = v.split(".");
  if (!ts || !mac || !/^\d+$/.test(ts) || Date.now() / 1000 - Number(ts) > MAX_AGE) return false;
  const want = Buffer.from(sign(ts)), got = Buffer.from(mac);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
const secure = (req) => req.headers["x-forwarded-proto"] === "https" || !!req.headers["cf-connecting-ip"];
function sessionCookie(req) {
  const ts = Math.floor(Date.now() / 1000);
  return `${COOKIE}=${ts}.${sign(ts)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; SameSite=Lax${secure(req) ? "; Secure" : ""}`;
}
const clearCookie = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
const clientIp = (req) => String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
// Requests through Cloudflare carry cf-connecting-ip. The first password may only be set from home (local network / Tailscale).
const fromInternet = (req) => !!req.headers["cf-connecting-ip"];
const fails = new Map();
function loginAllowed(ip) {
  const now = Date.now(); const list = (fails.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000); fails.set(ip, list);
  const all = [...fails.values()].reduce((n, l) => n + l.filter((t) => now - t < 15 * 60 * 1000).length, 0);
  return list.length < 8 && all < 40;
}
const failLogin = (ip) => { const l = fails.get(ip) || []; l.push(Date.now()); fails.set(ip, l); };

// ---------- http helpers ----------
const SEC = {
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
};
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff": "font/woff", ".webmanifest": "application/manifest+json" };
function send(res, status, body, type = "text/plain; charset=utf-8", extra = {}) { res.writeHead(status, { ...SEC, "Content-Type": type, "Cache-Control": "no-store", ...extra }); res.end(body); }
const sendJSON = (res, status, obj, extra) => send(res, status, JSON.stringify(obj), "application/json; charset=utf-8", extra);
const redirect = (res, to, extra = {}) => { res.writeHead(303, { ...SEC, Location: to, "Cache-Control": "no-store", ...extra }); res.end(); };
function readBody(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0; const c = [];
    req.on("data", (d) => { n += d.length; if (n > max) { reject(new Error("too big")); req.destroy(); } else c.push(d); });
    req.on("end", () => resolve(Buffer.concat(c).toString("utf8"))); req.on("error", reject);
  });
}
function page(file, vars = {}) {
  let html = fs.readFileSync(path.join(WEB, file), "utf8");
  for (const [k, v] of Object.entries(vars)) html = html.replaceAll(`{{${k}}}`, String(v).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]));
  return html.replace(/\{\{\w+\}\}/g, "");
}
function serveStatic(req, res, p) {
  const file = path.join(WEB, path.normalize(p));
  if (!file.startsWith(WEB + path.sep) || p.endsWith(".html")) return false;
  let st; try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  res.writeHead(200, { ...SEC, "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": p.startsWith("/fonts/") ? "public, max-age=31536000, immutable" : "no-cache", "Content-Length": st.size });
  if (req.method === "HEAD") res.end(); else fs.createReadStream(file).pipe(res);
  return true;
}
// Cells that start with = + - @ would run as formulas in Excel, so they get a leading apostrophe.
const csv = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

// ---------- API ----------
const STAT_KEYS = Object.keys(L.status);
async function api(req, res, p) {
  const method = req.method;
  if (method !== "GET" && req.headers["x-core"] !== "1") return sendJSON(res, 403, { ok: false, error: "Hiányzó fejléc." });

  if (p === "/api/me" && method === "GET") return sendJSON(res, 200, { ok: true, version: VERSION, labels: L, prices: PRICES });

  if (p === "/api/leads" && method === "GET") return sendJSON(res, 200, { ok: true, leads });
  if (p === "/api/leads" && method === "POST") {
    let d; try { d = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { ok: false }); }
    const l = sanitizeLead(d, true);
    if (!l.name && !l.business) return sendJSON(res, 422, { ok: false, error: "Adj meg legalább egy nevet." });
    leads.unshift(l); saveLeads();
    return sendJSON(res, 200, { ok: true, lead: l });
  }
  const m = p.match(/^\/api\/leads\/([0-9a-f-]{36})(\/seen)?$/i);
  if (m) {
    const l = leads.find((x) => x.id === m[1].toLowerCase());
    if (!l) return sendJSON(res, 404, { ok: false, error: "Nincs ilyen érdeklődő." });
    if (m[2] && method === "POST") { if (!l.seen) { l.seen = true; saveLeads(); } return sendJSON(res, 200, { ok: true, lead: l }); }
    if (method === "PATCH") {
      let d; try { d = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { ok: false }); }
      if (d.status !== undefined) {
        if (!STAT_KEYS.includes(d.status)) return sendJSON(res, 422, { ok: false });
        if (d.status !== l.status) { l.status = d.status; l.history = [...(l.history || []), { at: new Date().toISOString(), status: d.status }].slice(-50); }
      }
      if (d.note !== undefined) l.note = noteText(d.note);
      if (d.demoUrl !== undefined) l.demoUrl = clean(d.demoUrl, 300);
      if (d.plan !== undefined) l.plan = pick("csomag", d.plan);
      for (const k of ["name", "business", "phone", "email", "city"]) if (d[k] !== undefined) l[k] = clean(d[k], k === "business" ? 120 : k === "email" ? 120 : 80);
      l.seen = true; l.updated = new Date().toISOString();
      saveLeads();
      return sendJSON(res, 200, { ok: true, lead: l });
    }
    if (method === "DELETE") { leads = leads.filter((x) => x !== l); saveLeads(); return sendJSON(res, 200, { ok: true }); }
  }

  if (p === "/api/stats" && method === "GET") {
    try {
      const r = await fetch(SITE + "/stats", { signal: AbortSignal.timeout(6000) });
      const j = await r.json();
      const keys = Object.keys(j.days || {}).sort().slice(-120);
      const days = {}; keys.forEach((k) => { days[k] = j.days[k]; });
      return sendJSON(res, 200, { ok: true, days, live: j.live || 0, today: j.today });
    } catch { return sendJSON(res, 200, { ok: false, error: "A weboldal app nem érhető el, ezért most nincs statisztika.", days: {}, live: 0 }); }
  }
  if (p === "/api/status" && method === "GET") return sendJSON(res, 200, { ok: true, status, version: VERSION });
  if (p === "/api/check" && method === "POST") { await check(); return sendJSON(res, 200, { ok: true, status }); }

  if (p === "/api/settings" && method === "GET") return sendJSON(res, 200, { ok: true, settings: { ...settings, ntfyToken: settings.ntfyToken ? "••••••" : "" } });
  if (p === "/api/settings" && method === "PUT") {
    let d; try { d = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { ok: false }); }
    const url = (v) => { const s = clean(v, 300); if (!s) return ""; try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? u.toString().replace(/\/$/, "") : null; } catch { return null; } };
    if (d.ntfyUrl !== undefined) { const v = url(d.ntfyUrl); if (v === null) return sendJSON(res, 422, { ok: false, error: "Az ntfy-cím nem érvényes (pl. https://ntfy.sh/titkos-nev)." }); settings.ntfyUrl = v; }
    if (d.ntfyToken !== undefined && d.ntfyToken !== "••••••") settings.ntfyToken = clean(d.ntfyToken, 200);
    if (d.siteUrl !== undefined) { const v = url(d.siteUrl); if (v === null) return sendJSON(res, 422, { ok: false, error: "A weboldal címe nem érvényes." }); settings.siteUrl = v; }
    if (d.dashUrl !== undefined) { const v = url(d.dashUrl); if (v === null) return sendJSON(res, 422, { ok: false, error: "Az Irányítópult címe nem érvényes." }); settings.dashUrl = v; }
    for (const k of ["notifyLeads", "notifyDown"]) if (d[k] !== undefined) settings[k] = !!d[k];
    let synced = true;
    if (d.spots !== undefined && Number.isFinite(Number(d.spots))) { settings.spots = Math.max(0, Math.min(99, Math.round(Number(d.spots)))); synced = await pushSpots(); }
    saveSettings();
    return sendJSON(res, 200, { ok: true, synced, settings: { ...settings, ntfyToken: settings.ntfyToken ? "••••••" : "" } });
  }
  if (p === "/api/test-ntfy" && method === "POST") {
    const r = await ntfy({ title: "core Irányítópult", message: "Működik! Innen kapod majd az új érdeklődőket.", tags: ["tada"], priority: 3 });
    return sendJSON(res, r.ok ? 200 : 502, r);
  }
  if (p === "/api/password" && method === "POST") {
    let d; try { d = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { ok: false }); }
    if (!checkPassword(d.old || "")) return sendJSON(res, 403, { ok: false, error: "A jelenlegi jelszó nem jó." });
    if (String(d.new || "").length < 8) return sendJSON(res, 422, { ok: false, error: "Az új jelszó legalább 8 karakter legyen." });
    setPassword(String(d.new));
    return sendJSON(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req) });
  }
  if (p === "/api/export.csv" && method === "GET") {
    const head = ["Beérkezett", "Állapot", "Vállalkozás", "Név", "Telefon", "E-mail", "Település", "Típus", "Csomag", "Havidíj", "Funkciók", "Stílus", "Helyzet", "Link", "Mikorra", "Hívható", "Üzenet", "Jegyzet", "Bemutató", "Forrás"];
    const rows = leads.map((l) => [l.created, L.status[l.status], l.business, l.name, l.phone, l.email, l.city, L.tipus[l.type] || "", L.csomag[l.plan] || "", PRICES[l.plan] || "", l.features.map((f) => L.funkciok[f]).join(", "), L.stilus[l.style] || "", L.helyzet[l.situation] || "", l.link, L.mikorra[l.timing] || "", L.hivhato[l.callTime] || "", l.message, l.note, l.demoUrl, l.source]);
    const body = "﻿" + [head, ...rows].map((r) => r.map(csv).join(";")).join("\r\n");
    return send(res, 200, body, "text/csv; charset=utf-8", { "Content-Disposition": `attachment; filename="erdeklodok-${new Date().toISOString().slice(0, 10)}.csv"` });
  }
  if (p === "/api/backup.json" && method === "GET") {
    return send(res, 200, JSON.stringify({ version: VERSION, exported: new Date().toISOString(), leads, settings: { ...settings, ntfyToken: "" } }, null, 1), "application/json; charset=utf-8", { "Content-Disposition": `attachment; filename="core-mentes-${new Date().toISOString().slice(0, 10)}.json"` });
  }
  return sendJSON(res, 404, { ok: false, error: "Nincs ilyen végpont." });
}

// ---------- dashboard server ----------
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const p = decodeURIComponent(url.pathname);
    const ip = clientIp(req);

    if (p === "/healthz") return send(res, 200, "ok");
    if (req.method === "GET" || req.method === "HEAD") {
      if (p !== "/" && serveStatic(req, res, p)) return;
    }

    if (p === "/setup") {
      if (hasPassword()) return redirect(res, "/login");
      if (fromInternet(req)) return send(res, 403, page("setup.html", { error: "Biztonsági okból az első jelszót otthonról kell beállítani: nyisd meg az appot az Umbrel kezdőképernyőjéről vagy Tailscale-en keresztül.", disabled: "disabled" }), MIME[".html"]);
      if (req.method === "POST") {
        const f = new URLSearchParams(await readBody(req, 4000));
        const a = f.get("jelszo") || "", b = f.get("jelszo2") || "";
        if (a.length < 8) return send(res, 422, page("setup.html", { error: "A jelszó legalább 8 karakter legyen." }), MIME[".html"]);
        if (a !== b) return send(res, 422, page("setup.html", { error: "A két jelszó nem egyezik." }), MIME[".html"]);
        setPassword(a);
        return redirect(res, "/", { "Set-Cookie": sessionCookie(req) });
      }
      return send(res, 200, page("setup.html"), MIME[".html"]);
    }
    if (!hasPassword()) return p.startsWith("/api/") ? sendJSON(res, 401, { ok: false }) : redirect(res, "/setup");

    if (p === "/login") {
      if (req.method === "POST") {
        if (!loginAllowed(ip)) return send(res, 429, page("login.html", { error: "Túl sok próbálkozás. Várj 15 percet." }), MIME[".html"]);
        const f = new URLSearchParams(await readBody(req, 4000));
        if (!checkPassword(f.get("jelszo") || "")) { failLogin(ip); await new Promise((r) => setTimeout(r, 600)); return send(res, 401, page("login.html", { error: "Hibás jelszó." }), MIME[".html"]); }
        fails.delete(ip);
        return redirect(res, "/", { "Set-Cookie": sessionCookie(req) });
      }
      if (authed(req)) return redirect(res, "/");
      return send(res, 200, page("login.html"), MIME[".html"]);
    }
    if (p === "/logout" && req.method === "POST") return redirect(res, "/login", { "Set-Cookie": clearCookie });

    if (!authed(req)) return p.startsWith("/api/") ? sendJSON(res, 401, { ok: false, error: "Jelentkezz be újra." }) : redirect(res, "/login");
    if (p.startsWith("/api/")) return await api(req, res, p);
    if (p === "/" || p === "/index.html") return send(res, 200, fs.readFileSync(path.join(WEB, "index.html")), MIME[".html"]);
    return send(res, 404, "Nem található");
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJSON(res, 500, { ok: false, error: "Szerverhiba." });
  }
}).listen(PORT, () => console.log(`core Irányítópult on :${PORT}`));

// ---------- ingest (internal only) ----------
const ingestLimit = new Map();
http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/ingest") { res.writeHead(404); return res.end(); }
  const ip = req.socket.remoteAddress || "";
  const now = Date.now(); const list = (ingestLimit.get(ip) || []).filter((t) => now - t < 60 * 1000);
  if (list.length > 60) { res.writeHead(429); return res.end(); }
  list.push(now); ingestLimit.set(ip, list);
  try {
    const d = JSON.parse(await readBody(req, 32 * 1024));
    if (isId(d.id) && leads.some((x) => x.id === String(d.id).toLowerCase())) { res.writeHead(200); return res.end("dup"); }
    const l = sanitizeLead(d);
    if (!l.name || (!l.phone && !l.email)) { res.writeHead(422); return res.end(); }
    leads.unshift(l); saveLeads();
    console.log(`new lead: ${l.business || l.name}`);
    notifyLead(l);
    res.writeHead(200); res.end("ok");
  } catch { res.writeHead(400); res.end(); }
}).listen(INGEST_PORT, () => console.log(`ingest on :${INGEST_PORT}`));
