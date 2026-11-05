'use strict';
/* ==========================================================================
   Csaszko Foglalások – booking server for Csaszko Barbershop (no dependencies)
   Based on the Esszencia Foglalások app.

   Two listeners:
   • PUBLIC_PORT (published on the Umbrel as 4753) – only what the website
     needs: services, free times, creating a booking. Nothing private.
   • ADMIN_PORT – the admin app (behind Umbrel's login via app_proxy):
     bookings, confirm / decline / cancel, closures, services, settings.
   • REMOTE_PORT (published as 4754) – the same admin app for use through a
     Cloudflare Tunnel hostname, protected by its own password instead of the
     Umbrel login (which only works on the Umbrel's own address). The password
     can only be set from the Umbrel-protected address.
   Data lives in DATA_DIR as JSON (db.json, settings.json).
   All dates/times are Budapest wall-clock strings ("2026-11-03", "09:30").
   ========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const mail = require('./lib/mail');
const tpl = require('./lib/templates');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const ADMIN_PORT = +process.env.ADMIN_PORT || 8080;
const PUBLIC_PORT = +process.env.PUBLIC_PORT || 3001;
const REMOTE_PORT = +process.env.REMOTE_PORT || 0;
const TZ = 'Europe/Budapest';
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const ADMIN_DIR = path.join(__dirname, 'admin');

/* ---------------------------------------------------------------- storage */
const DEFAULT_SERVICES = [
  { id: 'haj', name: 'Hajvágás', note: '', minutes: 40, price: 3500 },
  { id: 'rovid', name: 'Rövid hajvágás', note: '', minutes: 20, price: 3500 },
  { id: 'hajszakall', name: 'Haj + szakáll', note: '', minutes: 50, price: 5500 },
  { id: 'szakall', name: 'Szakálligazítás', note: '', minutes: 20, price: 2000 },
  { id: 'gyerek', name: 'Gyerek hajvágás', note: '13 éves korig', minutes: 30, price: 3000 }
];
const DEFAULT_SETTINGS = {
  // JS weekday: 0 = vasárnap … 6 = szombat. null = zárva. The second time is the LAST START time.
  hours: { 0: ['15:00', '21:00'], 1: null, 2: ['15:00', '21:00'], 3: ['15:00', '21:00'], 4: ['15:00', '21:00'], 5: ['15:00', '21:00'], 6: ['15:00', '21:00'] },
  stepMinutes: 20,       // a kezdési időpontok lépésköze
  bufferMinutes: 0,      // szünet két vendég között
  minNoticeMinutes: 30,  // ennyi perccel előre lehet legkorábban foglalni
  horizonDays: 30,       // legfeljebb ennyi nappal előre
  autoConfirm: false,    // true: a weboldalas foglalás azonnal visszaigazolt
  services: DEFAULT_SERVICES,
  smtp: { host: 'smtp.gmail.com', port: 465, secure: true, user: '', pass: '', fromName: 'Csaszko Barbershop' },
  notifyEmail: 'csaszarb666@gmail.com',
  ntfyUrl: '',           // pl. https://ntfy.sh/csaszko-xxxx – értesítés a telefonra
  adminUrl: '',
  siteUrl: 'https://csaszko.admcore.hu'
};

fs.mkdirSync(DATA_DIR, { recursive: true });
const readJson = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return def; } };
function writeJson(f, obj) {
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, f);
}
function merge(base, over) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const k of Object.keys(over || {})) {
    const v = over[k];
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && base[k] && !Array.isArray(base[k])) ? merge(base[k], v) : v;
  }
  return out;
}

let db = readJson(DB_FILE, { bookings: [], blocks: [] });
db.bookings = db.bookings || [];
db.blocks = db.blocks || [];
let settings = merge(DEFAULT_SETTINGS, readJson(SETTINGS_FILE, {}));
const saveDb = () => writeJson(DB_FILE, db);
const saveSettings = () => writeJson(SETTINGS_FILE, settings);
if (!settings.secret) { settings.secret = crypto.randomBytes(24).toString('hex'); saveSettings(); }
if (!Array.isArray(settings.services) || !settings.services.length) settings.services = DEFAULT_SERVICES.slice();
const serviceById = (id) => settings.services.find((x) => x.id === id) || null;
const publicServices = () => settings.services.map((x) => ({ id: x.id, name: x.name, note: x.note || '', minutes: x.minutes, price: x.price == null ? null : x.price }));
const ft = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Ft';

/* ------------------------------------------------------------------- time */
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const fromMin = (n) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
const dayNum = (date) => { const [y, m, d] = date.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
const weekday = (date) => (dayNum(date) + 4) % 7; // 1970-01-01 was a Thursday
const addDays = (date, n) => new Date((dayNum(date) + n) * 86400000).toISOString().slice(0, 10);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(dayNum(s)) && addDays(s, 0) === s;
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
function now() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  const date = p.year + '-' + p.month + '-' + p.day;
  const min = (+p.hour % 24) * 60 + +p.minute;
  return { date, min, abs: dayNum(date) * 1440 + min };
}

/* ------------------------------------------------------------ availability */
const ACTIVE = { pending: 1, confirmed: 1 };

function busy(date, excludeId) {
  const buf = settings.bufferMinutes || 0;
  const out = [];
  for (const b of db.bookings) {
    if (b.date === date && ACTIVE[b.status] && b.id !== excludeId) out.push([toMin(b.time) - buf, toMin(b.time) + b.minutes + buf]);
  }
  for (const k of db.blocks) {
    if (date >= k.date && date <= (k.dateTo || k.date)) out.push(k.allDay ? [0, 1440] : [toMin(k.from), toMin(k.to)]);
  }
  return out;
}

/** Start times a client may book on `date` for a treatment of `minutes`. */
function freeStarts(date, minutes, opts) {
  opts = opts || {};
  const h = settings.hours[weekday(date)];
  if (!h) return [];
  const t = now();
  if (!opts.admin) {
    if (date < t.date || date > addDays(t.date, settings.horizonDays)) return [];
  }
  const open = toMin(h[0]);
  const close = toMin(h[1]);
  const earliest = opts.admin ? -Infinity : t.abs + (settings.minNoticeMinutes || 0);
  const b = busy(date, opts.excludeId);
  const step = settings.stepMinutes || 30;
  const res = [];
  // The closing time is the last possible START: a treatment may run past closing.
  for (let s = open; s <= close; s += step) {
    if (dayNum(date) * 1440 + s < earliest) continue;
    const e = s + minutes;
    if (b.some(([a, z]) => s < z && e > a)) continue;
    res.push(fromMin(s));
  }
  return res;
}

function overlaps(date, time, minutes, excludeId) {
  const s = toMin(time);
  const e = s + minutes;
  return busy(date, excludeId).some(([a, z]) => s < z && e > a);
}

/* ------------------------------------------------------------- validation */
const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const oneLine = (v, max) => str(v, max).replace(/\s+/g, ' ');
const isEmail = (s) => /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(s) && s.length <= 120;
const isPhone = (s) => /^[0-9+()\/.\-\s]{6,30}$/.test(s) && (s.match(/\d/g) || []).length >= 6;
const clampMinutes = (n) => { n = Math.round(+n || 40); return Math.min(240, Math.max(10, n)); };

/* -------------------------------------------------------------- rate limit */
const hits = new Map();
function limited(ip, max, windowMs, checkOnly) {
  const t = Date.now();
  const arr = (hits.get(ip) || []).filter((x) => t - x < windowMs);
  hits.set(ip, arr);
  if (arr.length >= max) return true;
  if (!checkOnly) arr.push(t);
  return false;
}
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (!v.some((x) => t - x < 3600000)) hits.delete(k); }, 600000).unref();

/* ------------------------------------------------------------------ e-mail */
function smtpConfigured() { return !!(settings.smtp && settings.smtp.host && settings.smtp.user && settings.smtp.pass); }

async function sendCustomer(b, kind, message) {
  const m = tpl.customerEmail(kind, b, { message, siteUrl: settings.siteUrl });
  const rec = { kind, at: new Date().toISOString(), ok: false, error: '' };
  try {
    await mail.send(settings.smtp, { from: settings.smtp.user, fromName: settings.smtp.fromName, to: b.email, replyTo: settings.notifyEmail || settings.smtp.user, ...m });
    rec.ok = true;
  } catch (e) {
    rec.error = mail.explain(e);
    console.error('[mail] ' + kind + ' → ' + b.email + ' failed:', e.message);
  }
  b.mail = rec;
  return rec;
}

// Push notification through ntfy (https://ntfy.sh): the ntfy app on the phone subscribes to the same topic.
function ntfy(title, message, click) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(settings.ntfyUrl); } catch (e) { return resolve(false); }
    if (u.protocol !== 'https:') return resolve(false);
    // all ntfy parameters may be query parameters, which keeps the UTF-8 title intact
    u.searchParams.set('title', title);
    u.searchParams.set('tags', 'scissors');
    if (click) u.searchParams.set('click', click);
    const req = https.request(u, { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, timeout: 8000 }, (res) => { res.resume(); resolve(res.statusCode < 300); });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => { console.error('[ntfy] failed:', e.message); resolve(false); });
    req.end(message);
  });
}

async function notifyAdmin(b) {
  const when = b.date.replace(/-/g, '.') + '. ' + b.time;
  if (settings.ntfyUrl) ntfy((b.status === 'confirmed' ? 'Új foglalás' : 'Új időpontkérés') + ': ' + when, b.name + ' · ' + ((b.service && b.service.hu) || '') + ' · ' + b.phone, settings.adminUrl || undefined);
  if (!smtpConfigured() || !settings.notifyEmail) return;
  try {
    const m = tpl.adminNotification(b, settings.adminUrl);
    await mail.send(settings.smtp, { from: settings.smtp.user, fromName: 'Csaszko · Foglalás', to: settings.notifyEmail, replyTo: b.email || undefined, ...m });
  } catch (e) {
    console.error('[mail] notification failed:', e.message);
  }
}

/* -------------------------------------------------------------- http utils */
function send(res, status, obj, headers) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, headers || {}));
  res.end(body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(Object.assign(new Error('bad json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
const clientIp = (req) => String(req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim();

const publicBooking = (b) => ({ id: b.id, date: b.date, time: b.time, minutes: b.minutes, status: b.status, service: b.service.hu });

/* ============================================================ PUBLIC API */
async function publicApi(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/\/+$/, '');

  if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true });

  if (req.method === 'GET' && p === '/api/info') {
    return send(res, 200, { hours: settings.hours, stepMinutes: settings.stepMinutes, horizonDays: settings.horizonDays, autoConfirm: !!settings.autoConfirm, services: publicServices(), today: now().date, nowMin: now().min });
  }

  if (req.method === 'GET' && p === '/api/availability') {
    if (limited('av:' + clientIp(req), 120, 600000)) return send(res, 429, { error: 'rate' });
    const t = now();
    let from = url.searchParams.get('from');
    if (!isDate(from)) from = t.date;
    const days = Math.min(62, Math.max(1, parseInt(url.searchParams.get('days'), 10) || 14));
    const svc = serviceById(url.searchParams.get('service'));
    if (!svc) return send(res, 400, { error: 'service' });
    const out = {};
    for (let i = 0; i < days; i++) {
      const d = addDays(from, i);
      const s = freeStarts(d, svc.minutes);
      if (s.length) out[d] = s;
    }
    return send(res, 200, { today: t.date, lastDay: addDays(t.date, settings.horizonDays), hours: settings.hours, days: out });
  }

  if (req.method === 'POST' && p === '/api/hit') {
    if (limited('hit:' + clientIp(req), 300, 3600000)) { res.writeHead(204); return res.end(); }
    let body = {};
    try { body = await readBody(req, 2048); } catch (e) { body = {}; }
    try { recordHit(req, body || {}); } catch (e) { /* never break the site for stats */ }
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    return res.end();
  }

  if (req.method === 'POST' && p === '/api/bookings') {
    const ip = clientIp(req);
    let body;
    try { body = await readBody(req, 16384); } catch (e) { return send(res, e.status || 400, { error: 'invalid' }); }

    // Spam traps: hidden field must be empty, and a human needs a few seconds to fill the form.
    if (str(body.website, 200) || (+body.elapsed > 0 && +body.elapsed < 2500)) return send(res, 200, { ok: true, id: 'x' });
    // mobile networks put many phones behind one address, so the per-address limits are generous
    if (limited('ip:' + ip, 20, 3600000)) return send(res, 429, { error: 'rate' });
    if (limited('ok:' + ip, 8, 3600000, true) || limited('all', 40, 3600000, true)) return send(res, 429, { error: 'rate' });

    const svc = serviceById(str(body.service, 40));
    const b = {
      id: crypto.randomBytes(6).toString('hex'),
      status: settings.autoConfirm ? 'confirmed' : 'pending',
      source: 'web',
      date: str(body.date, 10),
      time: str(body.time, 5),
      minutes: svc ? svc.minutes : 0,
      service: { id: svc ? svc.id : '', hu: svc ? svc.name : '', price: svc ? svc.price : null },
      note: str(body.note, 500),
      name: oneLine(body.name, 80),
      phone: oneLine(body.phone, 30),
      email: oneLine(body.email, 120).toLowerCase(),
      createdAt: new Date().toISOString()
    };
    const errors = {};
    if (!svc) errors.service = 1;
    if (!isDate(b.date)) errors.date = 1;
    if (!isTime(b.time)) errors.time = 1;
    if (b.name.length < 2) errors.name = 1;
    if (!isPhone(b.phone)) errors.phone = 1;
    if (!isEmail(b.email)) errors.email = 1; // the confirmation goes to this address
    if (Object.keys(errors).length) return send(res, 400, { error: 'invalid', fields: errors });

    // Final check happens here, in one synchronous step – two people can never get the same time.
    if (freeStarts(b.date, b.minutes).indexOf(b.time) < 0) return send(res, 409, { error: 'taken' });
    db.bookings.push(b);
    saveDb();
    limited('ok:' + ip, 8, 3600000); limited('all', 40, 3600000); // count successful requests only
    send(res, 201, { ok: true, booking: publicBooking(b) });
    notifyAdmin(b);
    if (b.status === 'confirmed' && b.email && smtpConfigured()) sendCustomer(b, 'confirm', '').then(saveDb);
    return;
  }

  return send(res, 404, { error: 'not found' });
}

/* ============================================================ STATISTICS
   Anonymous, cookie-free website statistics. Only daily counters are kept.
   Unique visitors are counted with a hash of (IP + browser) and a random salt
   that is thrown away every day, so nobody can be recognised or followed. */
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const TODAY_FILE = path.join(DATA_DIR, 'stats-today.json');
let stats = readJson(STATS_FILE, { days: {} });
stats.days = stats.days || {};
let todayVis = readJson(TODAY_FILE, null);
let seen = new Set(todayVis && todayVis.seen || []);
let statsDirty = false;
const EVENTS = ['book_open', 'book_service', 'book_time', 'book_sent', 'call', 'map', 'instagram', 'tiktok', 'gallery', 'next_time'];
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|lighthouse|pingdom|uptime|monitor|curl|wget|python|java\/|go-http|node-fetch|axios|headless/i;

function visitorDay() {
  const d = now().date;
  if (!todayVis || todayVis.date !== d) { todayVis = { date: d, salt: crypto.randomBytes(16).toString('hex'), seen: [] }; seen = new Set(); statsDirty = true; }
  return todayVis;
}
function dayRec(d) { return stats.days[d] || (stats.days[d] = { views: 0, visitors: 0, dev: {}, ref: {}, ev: {} }); }
const bump = (o, k, n) => { o[k] = (o[k] || 0) + (n || 1); };
function refSource(host) {
  host = String(host || '').toLowerCase().replace(/^www\./, '').slice(0, 80);
  if (!host) return 'Közvetlen';
  if (/(^|\.)facebook\.com$|(^|\.)fb\.(com|me)$|messenger\.com$/.test(host)) return 'Facebook';
  if (/instagram\.com$/.test(host)) return 'Instagram';
  if (/tiktok\.com$/.test(host)) return 'TikTok';
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return 'Google';
  if (/bing\.com$|duckduckgo\.com$|yahoo\.|ecosia\.org$/.test(host)) return 'Más keresők';
  if (/maps\.apple\.com$|waze\.com$/.test(host)) return 'Térkép';
  return host;
}
function recordHit(req, body) {
  const ua = String(req.headers['user-agent'] || '');
  if (!ua || BOT_UA.test(ua)) return;
  const isView = body.t === 'view';
  if (!isView && !(body.t === 'event' && EVENTS.indexOf(body.e) >= 0)) return;
  const v = visitorDay();
  const rec = dayRec(v.date);
  if (isView) {
    const id = crypto.createHmac('sha256', v.salt).update(clientIp(req) + '|' + ua).digest('hex').slice(0, 16);
    if (!seen.has(id)) { seen.add(id); v.seen.push(id); rec.visitors++; }
    rec.views++;
    const w = +body.w || 0;
    bump(rec.dev, w && w < 760 ? 'mobile' : w && w < 1100 ? 'tablet' : 'desktop');
    const host = oneLine(body.ref, 120);
    if (!body.internal) {
      const src = refSource(host);
      bump(rec.ref, rec.ref[src] || Object.keys(rec.ref).length < 25 ? src : 'Egyéb');
    }
  } else if (body.t === 'event' && EVENTS.indexOf(body.e) >= 0) {
    bump(rec.ev, body.e);
  }
  statsDirty = true;
}
function flushStats() {
  if (!statsDirty) return;
  statsDirty = false;
  const cutoff = addDays(now().date, -400);
  for (const d of Object.keys(stats.days)) if (d < cutoff) delete stats.days[d];
  writeJson(STATS_FILE, stats);
  writeJson(TODAY_FILE, todayVis || {});
}
setInterval(flushStats, 30000).unref();

const budapestDate = (iso) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return p.year + '-' + p.month + '-' + p.day;
};
function statsReport(days) {
  const t = now().date;
  const from = addDays(t, -(days - 1));
  const prevFrom = addDays(from, -days);
  const empty = { views: 0, visitors: 0, dev: {}, ref: {}, ev: {} };
  const series = [];
  const sum = { views: 0, visitors: 0, dev: {}, ref: {}, ev: {} };
  const prev = { views: 0, visitors: 0 };
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    const r = stats.days[d] || empty;
    series.push({ d, visitors: r.visitors, views: r.views });
    sum.views += r.views; sum.visitors += r.visitors;
    for (const k of ['dev', 'ref', 'ev']) for (const [a, n] of Object.entries(r[k] || {})) bump(sum[k], a, n);
    const pr = stats.days[addDays(prevFrom, i)];
    if (pr) { prev.views += pr.views; prev.visitors += pr.visitors; }
  }
  const inRange = (d, a, b) => d >= a && d <= b;
  const reqs = db.bookings.filter((b) => b.source !== 'manual' && b.createdAt && inRange(budapestDate(b.createdAt), from, t));
  const prevReqs = db.bookings.filter((b) => b.source !== 'manual' && b.createdAt && inRange(budapestDate(b.createdAt), prevFrom, addDays(from, -1)));
  const status = {};
  reqs.forEach((b) => bump(status, b.status));
  const services = {};
  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  const hours = {};
  db.bookings.filter((b) => (b.status === 'confirmed' || b.status === 'pending') && b.createdAt && inRange(budapestDate(b.createdAt), from, t))
    .forEach((b) => { bump(services, (b.service && b.service.hu) || 'Szolgáltatás'); weekdays[weekday(b.date)]++; bump(hours, b.time.slice(0, 2)); });
  const upcoming = db.bookings.filter((b) => b.status === 'confirmed' && b.date >= t && b.date <= addDays(t, 6)).length;
  let revenue = 0, done = 0;
  db.bookings.filter((b) => b.status === 'confirmed' && inRange(b.date, from, t)).forEach((b) => { done++; revenue += +(b.service && b.service.price) || 0; });
  return {
    today: t, from, days, series, totals: sum, prev, upcoming, revenue, done,
    bookings: { requests: reqs.length, prevRequests: prevReqs.length, status, services, weekdays, hours }
  };
}

/* ============================================================= ADMIN API */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

function serveStatic(req, res, p) {
  const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
  const file = path.normalize(path.join(ADMIN_DIR, rel));
  if (!file.startsWith(ADMIN_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
    });
    res.end(data);
  });
}

function settingsForClient() {
  const s = JSON.parse(JSON.stringify(settings));
  s.smtp.hasPass = !!settings.smtp.pass;
  delete s.smtp.pass;
  delete s.secret;
  s.remote = { enabled: remoteEnabled(), setAt: (settings.remote && settings.remote.setAt) || null };
  return s;
}

function state() {
  const t = now();
  const bookings = db.bookings.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const blocks = db.blocks.slice().sort((a, b) => a.date.localeCompare(b.date));
  return { today: t.date, nowMin: t.min, bookings, blocks, mailConfigured: smtpConfigured(), ntfyConfigured: !!settings.ntfyUrl, settings: settingsForClient() };
}

function manualService(body) {
  const svc = serviceById(str(body.serviceId, 40));
  if (svc) return { id: svc.id, hu: svc.name, price: svc.price };
  return { id: '', hu: oneLine(body.serviceHu, 160) || 'Szolgáltatás', price: null };
}

async function adminApi(req, res, ctx) {
  ctx = ctx || {};
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/\/+$/, '') || '/';

  if (!p.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method' });
    return serveStatic(req, res, p);
  }

  // Simple CSRF guard: browsers can't add custom headers on cross-site form posts.
  if (req.method !== 'GET' && req.headers['x-csaszko'] !== '1') return send(res, 403, { error: 'forbidden' });

  let body = {};
  if (req.method === 'POST' || req.method === 'PUT') {
    try { body = await readBody(req, 65536); } catch (e) { return send(res, e.status || 400, { error: 'invalid' }); }
  }

  if (req.method === 'GET' && p === '/api/admin/state') return send(res, 200, Object.assign(state(), { remoteSession: !!ctx.remote }));

  // Remote-access password: only from the Umbrel-protected address, never through the tunnel.
  if (p === '/api/admin/remote' && req.method === 'POST') {
    if (ctx.remote) return send(res, 403, { error: 'A távoli jelszót csak az Umbrelen keresztül lehet módosítani.' });
    if (body.disable) { settings.remote = { ver: ((settings.remote && settings.remote.ver) || 0) + 1 }; saveSettings(); }
    else if (body.logoutAll) { if (remoteEnabled()) { settings.remote.ver++; saveSettings(); } }
    else {
      const pw = String(body.password || '');
      if (pw.length < 10) return send(res, 400, { error: 'A jelszó legyen legalább 10 karakter.' });
      if (pw.length > 200) return send(res, 400, { error: 'Túl hosszú jelszó.' });
      setRemotePassword(pw);
    }
    return send(res, 200, { ok: true, settings: settingsForClient() });
  }

  if (req.method === 'GET' && p === '/api/admin/services') {
    return send(res, 200, { source: 'settings', categories: [{ name: 'Szolgáltatások', items: settings.services.map((x) => ({ id: x.id, name: x.name, price: x.price == null ? '' : ft(x.price), minutes: x.minutes })) }] });
  }

  if (req.method === 'GET' && p === '/api/admin/stats') {
    const days = Math.min(365, Math.max(7, parseInt(url.searchParams.get('days'), 10) || 30));
    return send(res, 200, statsReport(days));
  }

  if (req.method === 'GET' && p === '/api/admin/slots') {
    const date = url.searchParams.get('date');
    if (!isDate(date)) return send(res, 400, { error: 'date' });
    return send(res, 200, { times: freeStarts(date, clampMinutes(url.searchParams.get('minutes')), { admin: true, excludeId: url.searchParams.get('exclude') || undefined }) });
  }

  let m = p.match(/^\/api\/admin\/bookings\/([a-f0-9]+)\/(confirm|decline|cancel|resend)$/);
  if (m && req.method === 'POST') {
    const b = db.bookings.find((x) => x.id === m[1]);
    if (!b) return send(res, 404, { error: 'Nincs ilyen foglalás.' });
    const action = m[2];
    const message = str(body.message, 1000);
    const notify = body.sendEmail !== false && !!b.email;
    if (action === 'confirm') {
      if (b.status !== 'confirmed' && overlaps(b.date, b.time, b.minutes, b.id) && !body.force) {
        return send(res, 409, { error: 'Ez az időpont ütközik egy másik foglalással vagy zárással.' });
      }
      b.status = 'confirmed';
    } else if (action === 'decline') {
      b.status = 'declined';
    } else if (action === 'cancel') {
      b.status = 'cancelled';
    }
    if (action !== 'resend') { b.message = message; b.updatedAt = new Date().toISOString(); }
    saveDb();
    let mailRec = null;
    if (notify) {
      const kind = action === 'resend' ? ({ confirmed: 'confirm', declined: 'decline', cancelled: 'cancel' }[b.status]) : action;
      if (kind) {
        if (!smtpConfigured()) mailRec = b.mail = { kind, at: new Date().toISOString(), ok: false, error: 'Az e-mail küldés még nincs beállítva (Beállítások).' };
        else mailRec = await sendCustomer(b, kind, action === 'resend' ? b.message : message);
        saveDb();
      }
    }
    return send(res, 200, { ok: true, booking: b, mail: mailRec });
  }

  m = p.match(/^\/api\/admin\/bookings\/([a-f0-9]+)$/);
  if (m && req.method === 'DELETE') {
    const i = db.bookings.findIndex((x) => x.id === m[1]);
    if (i < 0) return send(res, 404, { error: 'Nincs ilyen foglalás.' });
    db.bookings.splice(i, 1);
    saveDb();
    return send(res, 200, { ok: true });
  }
  if (m && req.method === 'PUT') {
    // Move / edit a booking (date, time, minutes, service, note, contact).
    const b = db.bookings.find((x) => x.id === m[1]);
    if (!b) return send(res, 404, { error: 'Nincs ilyen foglalás.' });
    const date = body.date != null ? str(body.date, 10) : b.date;
    const time = body.time != null ? str(body.time, 5) : b.time;
    const minutes = body.minutes != null ? clampMinutes(body.minutes) : b.minutes;
    if (!isDate(date) || !isTime(time)) return send(res, 400, { error: 'Hibás dátum vagy idő.' });
    if (ACTIVE[b.status] && overlaps(date, time, minutes, b.id) && !body.force) return send(res, 409, { error: 'Ez az időpont ütközik egy másik foglalással vagy zárással.' });
    Object.assign(b, { date, time, minutes, updatedAt: new Date().toISOString() });
    if (body.serviceId != null || body.serviceHu != null) b.service = manualService(body);
    if (body.note != null) b.note = str(body.note, 1000);
    if (body.name != null) b.name = oneLine(body.name, 80) || b.name;
    if (body.phone != null) b.phone = oneLine(body.phone, 30);
    if (body.email != null) b.email = oneLine(body.email, 120).toLowerCase();
    saveDb();
    return send(res, 200, { ok: true, booking: b });
  }

  if (p === '/api/admin/bookings' && req.method === 'POST') {
    // Manual booking (e.g. taken over the phone) – confirmed straight away.
    const b = {
      id: crypto.randomBytes(6).toString('hex'), status: 'confirmed', source: 'manual',
      date: str(body.date, 10), time: str(body.time, 5), minutes: clampMinutes(body.minutes),
      service: manualService(body),
      note: str(body.note, 1000), name: oneLine(body.name, 80), phone: oneLine(body.phone, 30),
      email: oneLine(body.email, 120).toLowerCase(),
      createdAt: new Date().toISOString()
    };
    if (!isDate(b.date) || !isTime(b.time)) return send(res, 400, { error: 'Hibás dátum vagy idő.' });
    if (b.name.length < 2) return send(res, 400, { error: 'Add meg a vendég nevét.' });
    if (b.email && !isEmail(b.email)) return send(res, 400, { error: 'Hibás e-mail cím.' });
    if (overlaps(b.date, b.time, b.minutes) && !body.force) return send(res, 409, { error: 'Ez az időpont ütközik egy másik foglalással vagy zárással.' });
    db.bookings.push(b);
    saveDb();
    let mailRec = null;
    if (body.sendEmail && b.email) {
      mailRec = smtpConfigured() ? await sendCustomer(b, 'confirm', '') : (b.mail = { kind: 'confirm', at: new Date().toISOString(), ok: false, error: 'Az e-mail küldés még nincs beállítva (Beállítások).' });
      saveDb();
    }
    return send(res, 201, { ok: true, booking: b, mail: mailRec });
  }

  if (p === '/api/admin/blocks' && req.method === 'POST') {
    const k = {
      id: crypto.randomBytes(6).toString('hex'),
      date: str(body.date, 10), dateTo: str(body.dateTo || body.date, 10),
      allDay: body.allDay !== false, from: str(body.from, 5), to: str(body.to, 5),
      note: oneLine(body.note, 120), createdAt: new Date().toISOString()
    };
    if (!isDate(k.date) || !isDate(k.dateTo) || k.dateTo < k.date) return send(res, 400, { error: 'Hibás dátum.' });
    if (!k.allDay && (!isTime(k.from) || !isTime(k.to) || toMin(k.to) <= toMin(k.from))) return send(res, 400, { error: 'Hibás időtartam.' });
    if (k.allDay) { k.from = ''; k.to = ''; }
    db.blocks.push(k);
    saveDb();
    return send(res, 201, { ok: true, block: k });
  }
  m = p.match(/^\/api\/admin\/blocks\/([a-f0-9]+)$/);
  if (m && req.method === 'DELETE') {
    const i = db.blocks.findIndex((x) => x.id === m[1]);
    if (i < 0) return send(res, 404, { error: 'Nincs ilyen zárás.' });
    db.blocks.splice(i, 1);
    saveDb();
    return send(res, 200, { ok: true });
  }

  if (p === '/api/admin/settings' && req.method === 'PUT') {
    const s = body || {};
    const next = JSON.parse(JSON.stringify(settings));
    if (s.hours) {
      for (let d = 0; d < 7; d++) {
        const v = s.hours[d];
        if (v === null || v === false) next.hours[d] = null;
        else if (Array.isArray(v) && isTime(v[0]) && isTime(v[1]) && toMin(v[1]) > toMin(v[0])) next.hours[d] = [v[0], v[1]];
        else if (v !== undefined) return send(res, 400, { error: 'Hibás nyitvatartás (' + ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'][d] + ').' });
      }
    }
    const num = (v, lo, hi, def) => { v = parseInt(v, 10); return isNaN(v) ? def : Math.min(hi, Math.max(lo, v)); };
    if (s.stepMinutes != null) next.stepMinutes = [10, 15, 20, 30, 60].indexOf(+s.stepMinutes) >= 0 ? +s.stepMinutes : 20;
    if (s.bufferMinutes != null) next.bufferMinutes = num(s.bufferMinutes, 0, 120, 0);
    if (s.minNoticeMinutes != null) next.minNoticeMinutes = num(s.minNoticeMinutes, 0, 10080, 30);
    if (s.autoConfirm != null) next.autoConfirm = !!s.autoConfirm;
    if (s.horizonDays != null) next.horizonDays = num(s.horizonDays, 7, 365, 30);
    if (s.ntfyUrl != null) {
      const u = oneLine(s.ntfyUrl, 200);
      if (u && !/^https:\/\/[^\s/]+\/[\w-]{6,64}$/.test(u)) return send(res, 400, { error: 'Hibás ntfy cím. Formátum: https://ntfy.sh/egyedi-nev' });
      next.ntfyUrl = u;
    }
    if (s.services != null) {
      if (!Array.isArray(s.services) || !s.services.length || s.services.length > 30) return send(res, 400, { error: 'Legalább egy szolgáltatás kell.' });
      const seen = new Set();
      const list = [];
      for (const x of s.services) {
        const name = oneLine(x && x.name, 60);
        const minutes = parseInt(x && x.minutes, 10);
        const price = x && x.price !== '' && x.price != null ? parseInt(String(x.price).replace(/\D/g, ''), 10) : null;
        if (!name) return send(res, 400, { error: 'Minden szolgáltatásnak legyen neve.' });
        if (!(minutes >= 5 && minutes <= 240)) return send(res, 400, { error: 'Hibás időtartam: ' + name + ' (5–240 perc).' });
        if (price != null && !(price >= 0 && price <= 1000000)) return send(res, 400, { error: 'Hibás ár: ' + name + '.' });
        let id = /^[a-z0-9-]{1,40}$/.test(x.id || '') ? x.id : name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'szolg';
        while (seen.has(id)) id = id.slice(0, 36) + '-' + crypto.randomBytes(1).toString('hex');
        seen.add(id);
        list.push({ id, name, note: oneLine(x.note, 60), minutes, price });
      }
      next.services = list;
    }
    if (s.notifyEmail != null) { const e = oneLine(s.notifyEmail, 120); if (e && !isEmail(e)) return send(res, 400, { error: 'Hibás értesítési e-mail cím.' }); next.notifyEmail = e; }
    if (s.adminUrl != null) next.adminUrl = oneLine(s.adminUrl, 200);
    if (s.siteUrl != null) next.siteUrl = oneLine(s.siteUrl, 200);
    if (s.smtp) {
      if (s.smtp.user != null) { const u = oneLine(s.smtp.user, 120); if (u && !isEmail(u)) return send(res, 400, { error: 'Hibás Gmail cím.' }); next.smtp.user = u; }
      if (s.smtp.pass) next.smtp.pass = String(s.smtp.pass).replace(/\s+/g, '').slice(0, 200); // Google shows app passwords with spaces
      if (s.smtp.clearPass) next.smtp.pass = '';
      if (s.smtp.fromName != null) next.smtp.fromName = oneLine(s.smtp.fromName, 80);
      if (s.smtp.host != null) next.smtp.host = oneLine(s.smtp.host, 120) || 'smtp.gmail.com';
      if (s.smtp.port != null) next.smtp.port = num(s.smtp.port, 1, 65535, 465);
      if (s.smtp.secure != null) next.smtp.secure = !!s.smtp.secure;
    }
    settings = next;
    saveSettings();
    return send(res, 200, { ok: true, settings: settingsForClient(), mailConfigured: smtpConfigured() });
  }

  if (p === '/api/admin/test-ntfy' && req.method === 'POST') {
    if (!settings.ntfyUrl) return send(res, 400, { error: 'Előbb add meg és mentsd el az ntfy címet.' });
    const ok = await ntfy('Csaszko Foglalások – teszt', 'Ha ezt látod a telefonodon, az értesítés működik.', settings.adminUrl || undefined);
    return ok ? send(res, 200, { ok: true }) : send(res, 502, { error: 'Nem sikerült elküldeni. Ellenőrizd az ntfy címet.' });
  }

  if (p === '/api/admin/test-email' && req.method === 'POST') {
    if (!smtpConfigured()) return send(res, 400, { error: 'Előbb add meg a Gmail címet és az alkalmazásjelszót, és mentsd el.' });
    const to = oneLine(body.to, 120) || settings.notifyEmail || settings.smtp.user;
    try {
      await mail.send(settings.smtp, { from: settings.smtp.user, fromName: settings.smtp.fromName, to, ...tpl.testEmail() });
      return send(res, 200, { ok: true, to });
    } catch (e) {
      return send(res, 502, { error: mail.explain(e) });
    }
  }

  return send(res, 404, { error: 'not found' });
}


/* ========================================================== REMOTE LOGIN
   Password: scrypt hash in settings.remote. Session: signed cookie
   "<version>.<expiry>.<hmac>"; bumping the version logs out every device. */
const COOKIE = 'csaszko_remote';
const SESSION_DAYS = 60;
const remoteEnabled = () => !!(settings.remote && settings.remote.hash);
function hashPassword(pw, salt) { return crypto.scryptSync(String(pw), salt, 64).toString('hex'); }
function setRemotePassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const ver = ((settings.remote && settings.remote.ver) || 0) + 1;
  settings.remote = { hash: hashPassword(pw, salt), salt, ver, setAt: new Date().toISOString() };
  saveSettings();
}
function checkPassword(pw) {
  if (!remoteEnabled() || typeof pw !== 'string' || !pw || pw.length > 200) return false;
  const a = Buffer.from(hashPassword(pw, settings.remote.salt), 'hex');
  const b = Buffer.from(settings.remote.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sign = (v) => crypto.createHmac('sha256', settings.secret + '|remote').update(v).digest('hex');
function makeSession() {
  const v = settings.remote.ver + '.' + (Date.now() + SESSION_DAYS * 86400000);
  return v + '.' + sign(v);
}
function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((c) => { const i = c.indexOf('='); if (i > 0) out[c.slice(0, i).trim()] = c.slice(i + 1).trim(); });
  return out;
}
function validSession(req) {
  if (!remoteEnabled()) return false;
  const t = cookies(req)[COOKIE];
  if (!t) return false;
  const parts = t.split('.');
  if (parts.length !== 3) return false;
  const v = parts[0] + '.' + parts[1];
  const sig = Buffer.from(parts[2]);
  const good = Buffer.from(sign(v));
  if (sig.length !== good.length || !crypto.timingSafeEqual(sig, good)) return false;
  return +parts[0] === settings.remote.ver && +parts[1] > Date.now();
}
function isHttps(req) {
  return req.headers['x-forwarded-proto'] === 'https' || /"scheme":"https"/.test(String(req.headers['cf-visitor'] || ''));
}
function sessionCookie(req, value, maxAge) {
  // Lax (not Strict): the session must survive opening the app from the link in a notification e-mail.
  // Cross-site writes are still blocked by the X-Csaszko header check.
  return COOKIE + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (isHttps(req) ? '; Secure' : '');
}
const loginFails = new Map();
function tooManyFails(key, max, windowMs) {
  const t = Date.now();
  const arr = (loginFails.get(key) || []).filter((x) => t - x < windowMs);
  loginFails.set(key, arr);
  return arr.length >= max;
}
const addFail = (key) => { const a = loginFails.get(key) || []; a.push(Date.now()); loginFails.set(key, a); };

const LOGIN_FILES = { '/login': 'login.html', '/login.js': 'login.js', '/admin.css': 'admin.css', '/icon.svg': 'icon.svg', '/icon-192.png': 'icon-192.png', '/icon-512.png': 'icon-512.png', '/manifest.webmanifest': 'manifest.webmanifest' };

async function remoteApi(req, res) {
  res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/\/+$/, '') || '/';

  if (p === '/api/login-info' && req.method === 'GET') return send(res, 200, { enabled: remoteEnabled() });
  if (p === '/api/login' && req.method === 'POST') {
    if (req.headers['x-csaszko'] !== '1') return send(res, 403, { error: 'forbidden' });
    const ip = clientIp(req);
    if (!remoteEnabled()) return send(res, 403, { error: 'A távoli belépés nincs bekapcsolva. Az Umbrelen, a Beállításoknál lehet bekapcsolni.' });
    if (tooManyFails('ip:' + ip, 8, 15 * 60000) || tooManyFails('all', 40, 3600000)) return send(res, 429, { error: 'Túl sok sikertelen próbálkozás. Próbáld újra 15 perc múlva.' });
    let body = {};
    try { body = await readBody(req, 4096); } catch (e) { return send(res, 400, { error: 'invalid' }); }
    if (!checkPassword(body.password)) {
      addFail('ip:' + ip); addFail('all');
      await new Promise((r) => setTimeout(r, 600));
      return send(res, 401, { error: 'Hibás jelszó.' });
    }
    loginFails.delete('ip:' + ip);
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, makeSession(), SESSION_DAYS * 86400) });
  }
  if (p === '/api/logout' && req.method === 'POST') {
    if (req.headers['x-csaszko'] !== '1') return send(res, 403, { error: 'forbidden' });
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }
  if (LOGIN_FILES[p] && (req.method === 'GET' || req.method === 'HEAD') && (p !== '/login' || !validSession(req))) {
    return serveStatic(req, res, '/' + LOGIN_FILES[p]);
  }
  if (!validSession(req)) {
    if (p.startsWith('/api/')) return send(res, 401, { error: 'Jelentkezz be újra.', login: true });
    res.writeHead(302, { Location: '/login', 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (p === '/login') { res.writeHead(302, { Location: '/' }); return res.end(); }
  return adminApi(req, res, { remote: true });
}

/* ------------------------------------------------------------ housekeeping */
function purge() {
  // Personal data is not kept forever: bookings older than a year are removed.
  const cutoff = addDays(now().date, -365);
  const before = db.bookings.length + db.blocks.length;
  db.bookings = db.bookings.filter((b) => b.date >= cutoff);
  db.blocks = db.blocks.filter((k) => (k.dateTo || k.date) >= cutoff);
  if (db.bookings.length + db.blocks.length !== before) saveDb();
}
purge();
setInterval(purge, 12 * 3600000).unref();

/* ------------------------------------------------------------------ start */
function wrap(handler, name) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch((e) => {
      console.error('[' + name + ']', e);
      if (!res.headersSent) send(res, 500, { error: 'Szerverhiba.' });
    });
  };
}
const publicServer = http.createServer(wrap(publicApi, 'public'));
const adminServer = http.createServer(wrap((req, res) => adminApi(req, res), 'admin'));
const remoteServer = REMOTE_PORT ? http.createServer(wrap(remoteApi, 'remote')) : null;
publicServer.requestTimeout = adminServer.requestTimeout = 30000;
if (remoteServer) { remoteServer.requestTimeout = 30000; remoteServer.listen(REMOTE_PORT, () => console.log('Remote admin (own password) on :' + REMOTE_PORT)); }
publicServer.listen(PUBLIC_PORT, () => console.log('Public booking API on :' + PUBLIC_PORT));
adminServer.listen(ADMIN_PORT, () => console.log('Admin app on :' + ADMIN_PORT));
['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, () => { try { flushStats(); } catch (e) {} publicServer.close(); adminServer.close(); if (remoteServer) remoteServer.close(); process.exit(0); }));

module.exports = { freeStarts, weekday, now, addDays };
