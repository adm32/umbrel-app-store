'use strict';
(() => {
// ================= helpers =================
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(9)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = k => Math.round((k || 0) * 100);
const ls = (k, d) => { try { const v = localStorage.getItem('sz.' + k); return v == null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem('sz.' + k, v); } catch {} };
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
const fold = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length; if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, i) => i), cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}
// Accepts messy input: case, accents, punctuation and a typo or two don't matter.
function matchText(input, answers) {
  const a = fold(input); if (!a) return false;
  return answers.some(t => { const b = fold(t); if (a === b) return true; const n = b.length; return lev(a, b) <= (n <= 4 ? 0 : n <= 8 ? 1 : 2); });
}
// Word-level match of a typed poem line: returns a 0..1 score and which target words were hit.
function lineScore(input, target) {
  const A = fold(input).split(' ').filter(Boolean), B = fold(target).split(' ').filter(Boolean);
  const eq = (x, y) => x === y || (y.length >= 5 && lev(x, y) <= 1);
  const dp = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = 1; i <= A.length; i++) for (let j = 1; j <= B.length; j++)
    dp[i][j] = eq(A[i - 1], B[j - 1]) ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const hit = new Array(B.length).fill(false);
  for (let i = A.length, j = B.length; i > 0 && j > 0;) {
    if (eq(A[i - 1], B[j - 1])) { hit[j - 1] = true; i--; j--; } else if (dp[i - 1][j] >= dp[i][j - 1]) i--; else j--;
  }
  const l = dp[A.length][B.length];
  return { score: (A.length + B.length) ? 2 * l / (A.length + B.length) : 0, hit };
}
function diffNode(target, hit) {
  const words = target.split(/\s+/); let k = 0;
  return h('div', { class: 'diff' }, words.map((w, i) => {
    const f = fold(w); const ok = f ? hit[k++] : true;
    return [h('span', { class: ok ? 'm' : 'x' }, w), i < words.length - 1 ? ' ' : ''];
  }));
}
const mq = matchMedia('(prefers-reduced-motion: reduce)');
const RM = () => S.motion === 'off' || (S.motion === 'auto' && mq.matches);
const buzz = p => { try { if (!RM() && navigator.vibrate) navigator.vibrate(p); } catch {} };
const HU_DAYS = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
const two = n => String(n).padStart(2, '0');
function fmtLeft(sec) {
  if (sec <= 0) return 'most';
  const d = Math.floor(sec / 86400), hr = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  if (d > 0) return `${d} nap ${hr} óra`;
  if (hr > 0) return `${hr} óra ${m} perc`;
  return `${Math.max(1, m)} perc`;
}
function fmtWhen(ts) {
  const d = new Date(ts * 1000), now = new Date();
  const day = Math.round((new Date(d.toDateString()) - new Date(now.toDateString())) / 864e5);
  const t = `${two(d.getHours())}:${two(d.getMinutes())}`;
  if (day === 0) return `ma ${t}`;
  if (day === 1) return `holnap ${t}`;
  return `${HU_DAYS[d.getDay()]} ${t}`;
}
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function ringSVG(p, { r = 52, w = 12, vb = 120, grad = ['var(--r1)', 'var(--r2)'] } = {}) {
  const id = 'g' + Math.random().toString(36).slice(2, 8), c = vb / 2;
  return `<svg viewBox="0 0 ${vb} ${vb}" class="ring" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:${grad[0]}"/><stop offset="1" style="stop-color:${grad[1]}"/></linearGradient></defs><circle class="trk" cx="${c}" cy="${c}" r="${r}" stroke-width="${w}"/><circle class="bar" cx="${c}" cy="${c}" r="${r}" stroke-width="${w}" stroke="url(#${id})" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" data-p="${p}"/></svg>`;
}
function bar(p, c, c2) {
  const i = h('i', { 'data-p': p }); if (c) i.style.setProperty('--c', c); if (c2) i.style.setProperty('--c2', c2);
  return h('div', { class: 'bar-o', role: 'progressbar', 'aria-valuenow': p, 'aria-valuemin': 0, 'aria-valuemax': 100 }, i);
}
function fillMeters(root) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $$('circle.bar[data-p]', root).forEach(c => c.style.strokeDashoffset = 100 - clamp(+c.dataset.p, 0, 100));
    $$('.bar-o>i[data-p]', root).forEach(i => i.style.width = clamp(+i.dataset.p, 0, 100) + '%');
  }));
}
function countUp(el, from, to, dur = 900, suffix = '') {
  if (RM() || from === to) { el.textContent = to + suffix; return; }
  const t0 = performance.now();
  const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(from + (to - from) * e) + suffix; if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function shake(el) { el && el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-11px)' }, { transform: 'translateX(9px)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: RM() ? 1 : 320, easing: 'ease-out' }); }
function pop(el, s = 1.08) { el && !RM() && el.animate([{ transform: 'scale(1)' }, { transform: `scale(${s},${2 - s})`, offset: .35 }, { transform: `scale(${2 - s * .98},${s * .98})`, offset: .7 }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' }); }
function bump(el) { if (!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
function center(el) { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }
function ghostFly(from, to, text) {
  if (RM() || !from || !to) return Promise.resolve();
  const [x0, y0] = center(from), [x1, y1] = center(to);
  const g = h('div', { class: 'flyghost' }, text);
  Object.assign(g.style, { left: x0 + 'px', top: y0 + 'px' });
  document.body.append(g);
  return g.animate([{ transform: 'translate(-50%,-50%) scale(1)' }, { transform: `translate(calc(-50% + ${(x1 - x0) / 2}px), calc(-50% + ${(y1 - y0) / 2 - 30}px)) scale(1.08)`, offset: .5 }, { transform: `translate(calc(-50% + ${x1 - x0}px), calc(-50% + ${y1 - y0}px)) scale(.96)` }], { duration: 260, easing: 'cubic-bezier(.3,.7,.4,1)' }).finished.then(() => g.remove());
}
function flyXP(from, to, text) {
  if (!from || !to) return;
  const [x0, y0] = center(from), [x1, y1] = center(to);
  if (RM()) { bump(to); return; }
  const o = h('div', { class: 'fly' }), s = h('span', {}, text); o.append(s); document.body.append(o);
  Object.assign(o.style, { left: x0 + 'px', top: y0 + 'px' });
  o.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${x1 - x0}px)` }], { duration: 650, easing: 'cubic-bezier(.45,0,.55,1)', fill: 'forwards' });
  s.animate([{ transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 }, { transform: `translate(-50%,calc(-50% - 70px)) scale(1.3)`, opacity: 1, offset: .35 }, { transform: `translate(-50%,calc(-50% + ${y1 - y0}px)) scale(.7)`, opacity: .9 }], { duration: 650, easing: 'cubic-bezier(.3,0,.6,1)', fill: 'forwards' }).onfinish = () => { o.remove(); bump(to); };
}
function banner(text) {
  if (RM()) { toast(text, 1200); return; }
  const b = h('div', { class: 'banner' }, text); document.body.append(b);
  b.animate([
    { transform: 'translate(-50%,0) scale(.2) rotate(-14deg)', opacity: 0 },
    { transform: 'translate(-50%,0) scale(1.28,.82) rotate(3deg)', opacity: 1, offset: .25 },
    { transform: 'translate(-50%,0) scale(.94,1.08) rotate(-1deg)', offset: .4 },
    { transform: 'translate(-50%,0) scale(1) rotate(0)', offset: .55 },
    { transform: 'translate(-50%,-60px) scale(1.05)', opacity: 0 }
  ], { duration: 1100, easing: 'ease-out' }).onfinish = () => b.remove();
}
function swipeable(el, { onMove, onCommit, threshold = 100 }) {
  let sx = 0, sy = 0, dx = 0, t0 = 0, id = null, on = false;
  el.addEventListener('pointerdown', e => {
    if (el.dataset.lock || e.button > 0) return;
    on = true; id = e.pointerId; sx = e.clientX; sy = e.clientY; dx = 0; t0 = performance.now();
    el.setPointerCapture(id); el.style.transition = 'none';
  });
  el.addEventListener('pointermove', e => {
    if (!on || e.pointerId !== id) return;
    dx = e.clientX - sx; const dy = (e.clientY - sy) * .15;
    el.style.transform = `translate(${dx}px,${dy}px) rotate(${dx / 16}deg)`;
    onMove && onMove(dx);
  });
  const end = () => {
    if (!on) return; on = false;
    const v = dx / Math.max(1, performance.now() - t0);
    if (Math.abs(dx) > threshold || (Math.abs(v) > .6 && Math.abs(dx) > 34)) onCommit(dx > 0 ? 1 : -1);
    else { el.style.transition = 'transform .4s cubic-bezier(.34,1.56,.64,1)'; el.style.transform = ''; onMove && onMove(0); }
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}

// ================= state, api =================
const S = { lib: null, state: null, topics: {}, poems: {}, learn: {}, sound: ls('sound', '1') === '1', motion: ls('motion', 'auto'), visits: 0, profile: ls('profile', ''), profiles: [] };
async function api(path, opts = {}, profile = S.profile) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Profile': profile || '' } });
  if (!r.ok) { const e = new Error(r.status + ' ' + path); e.status = r.status; throw e; }
  return r.json();
}
const post = (p, b, prof) => api(p, { method: 'POST', body: JSON.stringify(b) }, prof);
const put = (p, b) => api(p, { method: 'PUT', body: JSON.stringify(b) });
const me = () => S.profiles.find(p => p.id === S.profile);
const PINK = () => document.documentElement.dataset.theme === 'pink';
function applyTheme(t) {
  const pink = t === 'pink';
  if (pink) document.documentElement.dataset.theme = 'pink'; else delete document.documentElement.dataset.theme;
  $('meta[name=theme-color]')?.setAttribute('content', pink ? '#ffeaf5' : '#0e0a1b');
  lsSet('theme', pink ? 'pink' : 'szikra');
  window.FXtheme && window.FXtheme();
}
applyTheme(ls('theme', 'szikra'));
// Hand-drawn profile pictures (original, flat SVG).
const AVATARS = {
  maci: { name: 'Maci', svg: '<circle cx="32" cy="32" r="31" fill="#ffd9a8"/><circle cx="16" cy="18" r="8.5" fill="#9b6235"/><circle cx="48" cy="18" r="8.5" fill="#9b6235"/><circle cx="16" cy="18" r="4.2" fill="#e8a46a"/><circle cx="48" cy="18" r="4.2" fill="#e8a46a"/><ellipse cx="32" cy="35" rx="20" ry="19" fill="#b5763f"/><ellipse cx="32" cy="43" rx="9.5" ry="7.5" fill="#f4d3a4"/><ellipse cx="32" cy="39.6" rx="3.8" ry="2.7" fill="#3a2414"/><path d="M32 42.2v2.6M28.8 46c1.7 1.5 4.7 1.5 6.4 0" stroke="#3a2414" stroke-width="1.8" fill="none" stroke-linecap="round"/><circle cx="24.5" cy="31" r="2.6" fill="#2a1a10"/><circle cx="39.5" cy="31" r="2.6" fill="#2a1a10"/><circle cx="25.4" cy="30.1" r=".9" fill="#fff"/><circle cx="40.4" cy="30.1" r=".9" fill="#fff"/><ellipse cx="19.5" cy="38.5" rx="3.2" ry="2.1" fill="#ff8f8f" opacity=".55"/><ellipse cx="44.5" cy="38.5" rx="3.2" ry="2.1" fill="#ff8f8f" opacity=".55"/>' },
  nyuszi: { name: 'Nyuszi', svg: '<defs><radialGradient id="nyb" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#ffe9f4"/><stop offset="1" stop-color="#ffc4e1"/></radialGradient><radialGradient id="nyh" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#fff0f7"/></radialGradient></defs><circle cx="32" cy="32" r="31" fill="url(#nyb)"/><ellipse cx="21.5" cy="15.5" rx="6.8" ry="14.5" fill="#fff" stroke="#f6cfe1" stroke-width="1" transform="rotate(-12 21.5 15.5)"/><ellipse cx="21.5" cy="16.5" rx="3.3" ry="10" fill="#ffb6d6" transform="rotate(-12 21.5 16.5)"/><path d="M37 26c1-9 6-15 13-16 5-.6 7 3 5.2 6.6-2 4-7.5 6.2-12 10.4z" fill="#fff" stroke="#f6cfe1" stroke-width="1"/><path d="M40 24.5c1.6-6 5.2-10.2 9.6-11 2.6-.4 3.6 1.4 2.6 3.4-1.4 2.8-6 5-10.6 8.6z" fill="#ffb6d6"/><ellipse cx="32" cy="40.5" rx="21.5" ry="18.5" fill="url(#nyh)" stroke="#f6cfe1" stroke-width="1"/><circle cx="24" cy="40" r="3.9" fill="#3d2433"/><circle cx="40" cy="40" r="3.9" fill="#3d2433"/><circle cx="25.4" cy="38.5" r="1.5" fill="#fff"/><circle cx="41.4" cy="38.5" r="1.5" fill="#fff"/><circle cx="22.9" cy="41.5" r=".7" fill="#fff"/><circle cx="38.9" cy="41.5" r=".7" fill="#fff"/><ellipse cx="17.5" cy="46" rx="4" ry="2.5" fill="#ff9cc6" opacity=".75"/><ellipse cx="46.5" cy="46" rx="4" ry="2.5" fill="#ff9cc6" opacity=".75"/><path d="M30.4 43.6c.9-.8 2.3-.8 3.2 0-.2 1.1-.9 1.7-1.6 2-.7-.3-1.4-.9-1.6-2z" fill="#ff7fb2"/><path d="M29.2 47c1.4 1.5 2.8 1.2 2.8-.6 0 1.8 1.4 2.1 2.8.6" stroke="#3d2433" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><g transform="translate(5.5 1.8)"><path d="M14.5 25.5l-5.5-3.6c-1-.6-2.2.2-2 1.4l.8 5c.2 1.1 1.4 1.6 2.3 1z" fill="#ff5fa2"/><path d="M17.5 25.5l5.5-3.6c1-.6 2.2.2 2 1.4l-.8 5c-.2 1.1-1.4 1.6-2.3 1z" fill="#ff5fa2"/><circle cx="16" cy="26.4" r="2.4" fill="#ff3d8f"/><circle cx="15.3" cy="25.7" r=".7" fill="#fff" opacity=".8"/></g><path d="M52.5 33.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" fill="#fff"/><path d="M9.5 38l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" fill="#fff" opacity=".9"/>' },
  roka: { name: 'Róka', svg: '<circle cx="32" cy="32" r="31" fill="#ffe4c7"/><path d="M12 10l12 14-11 6z" fill="#f2782f"/><path d="M52 10L40 24l11 6z" fill="#f2782f"/><path d="M15 15l6 8-5 3z" fill="#ffd2b0"/><path d="M49 15l-6 8 5 3z" fill="#ffd2b0"/><path d="M12 27c0-6 9-9 20-9s20 3 20 9c0 10-9 22-20 25-11-3-20-15-20-25z" fill="#f2782f"/><path d="M14 31c6 1 12 6 18 17 6-11 12-16 18-17-2 9-9 18-18 21-9-3-16-12-18-21z" fill="#fff6ee"/><circle cx="24.5" cy="32" r="2.5" fill="#2b1a10"/><circle cx="39.5" cy="32" r="2.5" fill="#2b1a10"/><circle cx="25.3" cy="31.2" r=".8" fill="#fff"/><circle cx="40.3" cy="31.2" r=".8" fill="#fff"/><ellipse cx="32" cy="45" rx="3.2" ry="2.3" fill="#2b1a10"/>' },
  cica: { name: 'Cica', svg: '<circle cx="32" cy="32" r="31" fill="#e6dcff"/><path d="M13 12l13 9-12 9z" fill="#8f8aa6"/><path d="M51 12L38 21l12 9z" fill="#8f8aa6"/><path d="M16 17l6 5-5 4z" fill="#ffc2d9"/><path d="M48 17l-6 5 5 4z" fill="#ffc2d9"/><ellipse cx="32" cy="37" rx="20" ry="17.5" fill="#a7a2bd"/><path d="M26 22l2 6M32 21v6M38 22l-2 6" stroke="#8f8aa6" stroke-width="2.2" stroke-linecap="round"/><ellipse cx="25" cy="35" rx="2.6" ry="3.1" fill="#2c2540"/><ellipse cx="39" cy="35" rx="2.6" ry="3.1" fill="#2c2540"/><circle cx="25.8" cy="34" r=".9" fill="#fff"/><circle cx="39.8" cy="34" r=".9" fill="#fff"/><path d="M30.2 41h3.6l-1.8 2z" fill="#ff8fb5"/><path d="M32 43v1.5M29.6 45.6c1.4 1.2 3.4 1.2 4.8 0" stroke="#2c2540" stroke-width="1.4" fill="none" stroke-linecap="round"/><path d="M20 41l-8-1.5M20 43.5l-8 1M44 41l8-1.5M44 43.5l8 1" stroke="#ece8f7" stroke-width="1" stroke-linecap="round"/>' }
};
const avatarSVG = a => `<svg class="av" viewBox="0 0 64 64" aria-hidden="true">${(AVATARS[a] || AVATARS.maci).svg}</svg>`;
async function loadLib() {
  S.lib = await api('/api/library');
  for (const s of S.lib.subjects) for (const t of s.topics) {
    S.topics[t.id] = t;
    for (const p of t.poems || []) S.poems[p.id] = p;
    for (const l of t.learn || []) S.learn[l.id] = l;
  }
}
async function getState() {
  const st = await api('/api/state');
  if (S.lib && st.version !== S.lib.version) { location.reload(); await sleep(5000); }
  S.state = st; return st;
}
// Answers are sent in order; if the Umbrel can't be reached they wait in the browser and go later.
const Q = {
  list: (() => { try { return JSON.parse(ls('queue', '[]')); } catch { return []; } })(),
  busy: false,
  save() { lsSet('queue', JSON.stringify(this.list.slice(-800))); },
  push(a) { this.list.push({ ...a, p: S.profile }); this.save(); return this.flush(); },
  async flush() {
    if (this.busy) return; this.busy = true;
    try {
      while (this.list.length) {
        const { p, ...a } = this.list[0];
        try { await post('/api/answer', a, p); } catch (e) { if (e.status !== 404 && e.status !== 400) throw e; }
        this.list.shift(); this.save();
      }
      return true;
    } catch { return false; } finally { this.busy = false; }
  }
};
setInterval(() => Q.list.length && Q.flush(), 15000);
addEventListener('online', () => Q.flush());
document.addEventListener('visibilitychange', () => { if (!document.hidden && Q.list.length) Q.flush(); });
const stTopic = id => (S.state?.topics || []).find(t => t.id === id) || { known: 0, total: 0, fresh: 0, due: 0, learned: 0 };
const stPoem = id => (S.state?.poems || []).find(p => p.id === id) || { known: 0, memo: 0, cards: 0 };

// ================= sound =================
const SND = (() => {
  let ctx;
  const ac = () => { if (!ctx) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ctx = new A(); } if (ctx.state === 'suspended') ctx.resume(); return ctx; };
  function tone(f, t0, dur, type = 'sine', vol = .1, slide) {
    const c = ac(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + t0;
    o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .012); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + .03);
  }
  function noise(t0, dur, vol = .05, from = 1800, to = 400) {
    const c = ac(); if (!c) return;
    const n = c.sampleRate * dur | 0, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime + t0;
    f.type = 'bandpass'; f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.value = vol; s.buffer = b; s.connect(f).connect(g).connect(c.destination); s.start(t);
  }
  const P = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];
  const f = k => 523.25 * Math.pow(2, P[Math.min(k, P.length - 1)] / 12);
  const on = () => S.sound;
  return {
    unlock() { if (on()) ac(); },
    ok(combo) { if (!on()) return; const k = Math.min(combo, 10); tone(f(k), 0, .13, 'triangle', .09); tone(f(k + 2), .075, .2, 'sine', .08); if (combo >= 5) tone(f(k + 4), .15, .22, 'sine', .05); },
    bad() { if (!on()) return; tone(220, 0, .2, 'triangle', .1, 150); tone(165, .06, .26, 'sine', .07, 110); },
    tick() { if (on()) tone(1046, 0, .045, 'sine', .035); },
    whoosh() { if (on()) noise(0, .22, .06); },
    page() { if (on()) noise(0, .12, .025, 3000, 1200); },
    done() { if (!on()) return;[0, 4, 7, 12].forEach((s, i) => tone(523.25 * Math.pow(2, s / 12), i * .09, .5 - i * .05, 'triangle', .07)); },
    level() { if (!on()) return;[0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone(392 * Math.pow(2, s / 12), i * .07, .45, i % 2 ? 'sine' : 'triangle', .07)); noise(.45, .5, .04, 5000, 800); }
  };
})();

// ================= canvas fx: embers in the background, bursts and confetti on top =================
const FX = (() => {
  const bg = $('#bg'), fx = $('#fx'), bx = bg.getContext('2d'), fxx = fx.getContext('2d');
  let W = 0, H = 0, D = 1, emb = [], parts = [], heat = 0, raf = 0, last = 0, lastBg = 0, hidden = document.hidden;
  const base = () => W < 520 ? 24 : 38;
  function size() {
    D = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
    for (const [c, x] of [[bg, bx], [fx, fxx]]) { c.width = W * D | 0; c.height = H * D | 0; c.style.width = W + 'px'; c.style.height = H + 'px'; x.setTransform(D, 0, 0, D, 0, 0); }
  }
  const mk = y => ({ x: Math.random() * W, y: y ?? H + 10, r: .7 + Math.random() * 2, vy: -(9 + Math.random() * 26), ph: Math.random() * 6.3, sw: 6 + Math.random() * 18, a: .22 + Math.random() * .45, hue: PINK() ? 318 + Math.random() * 34 : 16 + Math.random() * 32, heart: Math.random() < .4 });
  function heart(x, y, r) {
    bx.beginPath(); bx.moveTo(x, y + r * .35);
    bx.bezierCurveTo(x, y - r * .25, x - r, y - r * .25, x - r, y + r * .25);
    bx.bezierCurveTo(x - r, y + r * .75, x, y + r, x, y + r * 1.3);
    bx.bezierCurveTo(x, y + r, x + r, y + r * .75, x + r, y + r * .25);
    bx.bezierCurveTo(x + r, y - r * .25, x, y - r * .25, x, y + r * .35);
    bx.fill();
  }
  function frame(t) {
    raf = 0;
    const dt = Math.min(.05, (t - last) / 1000 || .016); last = t;
    if (!RM() && t - lastBg > 30) {
      const bdt = Math.min(.08, (t - lastBg) / 1000); lastBg = t;
      bx.clearRect(0, 0, W, H);
      const want = base() + Math.round(heat * 46);
      while (emb.length < want) emb.push(mk());
      const pink = PINK();
      bx.globalCompositeOperation = pink ? 'source-over' : 'lighter';
      for (let i = emb.length - 1; i >= 0; i--) {
        const e = emb[i];
        e.y += e.vy * bdt * (1 + heat * 1.8); e.ph += bdt * 1.2;
        if (e.y < -20) { if (emb.length > want) { emb.splice(i, 1); continue; } Object.assign(e, mk()); }
        const x = e.x + Math.sin(e.ph) * e.sw, fl = .65 + .35 * Math.sin(t / 170 + e.ph * 3), a = e.a * fl * clamp((H - e.y) / 140 + .15, 0, 1);
        if (pink && e.heart) { bx.fillStyle = `hsla(${e.hue},95%,72%,${Math.min(.75, a * 1.3)})`; heart(x, e.y, e.r * 2.6 + 2); continue; }
        const g = bx.createRadialGradient(x, e.y, 0, x, e.y, e.r * 4.5);
        if (pink) { g.addColorStop(0, `hsla(${e.hue},100%,97%,${a * 1.4})`); g.addColorStop(.6, `hsla(${e.hue},100%,85%,${a * .7})`); g.addColorStop(1, `hsla(${e.hue},100%,80%,0)`); }
        else { g.addColorStop(0, `hsla(${e.hue},100%,72%,${a})`); g.addColorStop(1, `hsla(${e.hue},100%,50%,0)`); }
        bx.fillStyle = g; bx.beginPath(); bx.arc(x, e.y, e.r * 4.5, 0, 6.283); bx.fill();
      }
      bx.globalCompositeOperation = 'source-over';
      heat = Math.max(0, heat - bdt * .06);
    }
    fxx.clearRect(0, 0, W, H);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.vx *= 1 - p.drag * dt; p.vy = p.vy * (1 - p.drag * dt) + p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      const k = p.life / p.max; fxx.globalAlpha = Math.min(1, k * 1.8);
      if (p.kind === 'conf') {
        fxx.save(); fxx.translate(p.x, p.y); fxx.rotate(p.rot); fxx.scale(1, Math.cos(p.rot * 2.3));
        fxx.fillStyle = p.c; fxx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); fxx.restore();
      } else if (p.kind === 'ring') {
        fxx.strokeStyle = p.c; fxx.lineWidth = 4 * k + .5; fxx.beginPath(); fxx.arc(p.x, p.y, p.s + (1 - k) * p.grow, 0, 6.283); fxx.stroke();
      } else {
        fxx.fillStyle = p.c; fxx.beginPath(); fxx.arc(p.x, p.y, p.s * k + .4, 0, 6.283); fxx.fill();
        if (p.kind === 'spark') { fxx.strokeStyle = p.c; fxx.lineWidth = Math.max(.6, p.s * k * .7); fxx.beginPath(); fxx.moveTo(p.x, p.y); fxx.lineTo(p.x - p.vx * .04, p.y - p.vy * .04); fxx.stroke(); }
      }
    }
    fxx.globalAlpha = 1;
    if (!hidden && (!RM() || parts.length)) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && !hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  addEventListener('resize', () => { size(); emb = emb.filter(e => e.x < W); });
  document.addEventListener('visibilitychange', () => { hidden = document.hidden; if (!hidden) kick(); });
  size(); emb = Array.from({ length: base() }, () => mk(Math.random() * H)); kick();
  window.FXtheme = () => { emb = Array.from({ length: base() }, () => mk(Math.random() * H)); lastBg = 0; kick(); };
  return {
    kick,
    heat(v) { heat = clamp(heat + v, 0, 1); kick(); },
    cool() { heat = 0; },
    burst(x, y, { n = 26, colors, speed = 430, ring = true } = {}) {
      colors = colors || (PINK() ? ['#ff4fa3', '#2fe0a0', '#c9a8ff', '#ff8fc7'] : ['#2fe0a0', '#ffc94d', '#ffffff', '#ff7a3d']);
      if (RM()) n = Math.min(n, 5);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, v = speed * (.35 + Math.random() * .75), life = .45 + Math.random() * .5;
        parts.push({ kind: i % 3 ? 'dot' : 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, g: 900, drag: 2.4, life, max: life, s: 1.6 + Math.random() * 3.2, c: colors[i % colors.length], rot: 0, vr: 0 });
      }
      if (ring && !RM()) parts.push({ kind: 'ring', x, y, s: 12, grow: 80, c: colors[0], life: .45, max: .45, vx: 0, vy: 0, g: 0, drag: 0, rot: 0, vr: 0 });
      kick();
    },
    confetti(n = 140) {
      if (RM()) return;
      const cols = PINK() ? ['#ff4fa3', '#ffb5d8', '#c9a8ff', '#8fd3ff', '#ffd36b', '#ffffff', '#ff7ab8'] : ['#ff7a3d', '#ffc94d', '#2fe0a0', '#6cc7ff', '#b69cff', '#ff6fb5', '#ffffff'];
      for (let i = 0; i < n; i++) {
        const left = i % 2 === 0, x = left ? -10 : W + 10, a = (left ? -1 : -Math.PI) + (left ? 1 : -1) * (-.35 - Math.random() * .5);
        const v = 650 + Math.random() * 650, life = 2 + Math.random() * 1.4;
        parts.push({ kind: 'conf', x, y: H * .82, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 620, drag: 1.25, life, max: life, s: 7 + Math.random() * 7, c: cols[i % cols.length], rot: Math.random() * 6, vr: (Math.random() - .5) * 14 });
      }
      kick();
    }
  };
})();

// ================= router =================
const routes = [
  [/^#?\/?$/, viewHome],
  [/^#\/t\/([\w-]+)$/, viewTopic],
  [/^#\/p\/([\w-]+)$/, viewPoem],
  [/^#\/me$/, viewMe],
  [/^#\/who$/, viewWho],
  [/^#\/play\?(.*)$/, viewPlay]
];
let renderSeq = 0, P = null;
async function render() {
  const my = ++renderSeq, hash = location.hash || '#/';
  let fn, m;
  for (const [re, f] of routes) if ((m = hash.match(re))) { fn = f; break; }
  if (!fn) { location.hash = '#/'; return; }
  if (!me() && fn !== viewWho) { location.hash = '#/who'; return; }
  if (P && fn !== viewPlay) endPlayMode();
  if (Q.list.length) Q.flush();
  try {
    const el = await fn(...m.slice(1));
    if (my === renderSeq && el) swap(el);
  } catch (e) {
    if (e.status === 404 && fn !== viewWho) { S.profile = ''; lsSet('profile', ''); location.hash = '#/who'; return; }
    console.error(e);
    if (my === renderSeq) swap(h('div', { class: 'empty' }, h('div', { class: 'big-emoji' }, '🔌'), h('h2', {}, 'Nem érem el a szervert'), h('p', { class: 'sub' }, 'Nézd meg, hogy fut-e az Umbrel, aztán próbáld újra.'), h('button', { class: 'btn', onclick: () => render() }, 'Újra')));
  }
}
function swap(el) {
  const app = $('#app'), old = app.firstElementChild;
  el.classList.add('view');
  const go = () => { app.replaceChildren(el); scrollTo(0, 0); fillMeters(el); el._after && el._after(); };
  if (old && !RM() && !el.classList.contains('play-wrap')) { old.classList.add('out'); setTimeout(go, 120); } else go();
}
addEventListener('hashchange', render);
const goBack = to => h('button', { class: 'back', 'aria-label': 'Vissza', onclick: () => location.hash = to }, '←');

// ================= top bar =================
const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--logo1)"/><stop offset="1" style="stop-color:var(--logo2)"/></linearGradient></defs><path class="flick" fill="url(#lg)" d="M16 3c1.3 6.4 3.9 9 10.3 10.3C19.9 14.6 17.3 17.2 16 23.6 14.7 17.2 12.1 14.6 5.7 13.3 12.1 12 14.7 9.4 16 3z"/><circle cx="25.5" cy="24.5" r="2.4" fill="#ffc94d"/><circle cx="8" cy="25.5" r="1.6" fill="#ff7a3d"/></svg>';
function topBar(st) {
  const lv = st.level, into = st.xp - lv.from, need = lv.to - lv.from;
  const lvl = h('button', { class: 'pill lvl', 'aria-label': `${lv.level}. szint, profil`, onclick: () => location.hash = '#/me' },
    h('span', { class: 'lvlring', html: ringSVG(pct(into / need), { r: 13, w: 4, vb: 32 }) + `<b>${lv.level}</b>` }),
    h('span', {}, `${st.xp} XP`));
  const sk = h('button', { class: 'pill streak' + (st.todayDone ? ' on' : ''), 'aria-label': `${st.streak} napos széria`, onclick: () => location.hash = '#/me' },
    h('span', { class: 'ic' }, st.todayDone ? '🔥' : '🕯️'), h('span', {}, st.streak));
  const who = me();
  return h('header', { class: 'top' },
    h('button', { class: 'av-btn', 'aria-label': `${who?.name || ''} – profilváltás`, onclick: () => location.hash = '#/who', html: avatarSVG(who?.avatar) }),
    h('div', { class: 'logo', html: LOGO + '<span>Szikra</span>' }), sk, lvl);
}

// ================= home =================
async function viewHome() {
  const st = await getState();
  const subj = S.lib.subjects[0], ss = st.subjects.find(s => s.id === subj.id) || st.subjects[0];
  const first = S.visits++ === 0;
  const now = st.now, left = st.examTs - now;
  const examDate = st.examTs ? new Date(st.examTs * 1000) : null;
  const when = examDate ? `${HU_DAYS[examDate.getDay()]} ${two(examDate.getHours())}:${two(examDate.getMinutes())}` : '';
  const readiness = pct(ss.known);
  const ring = h('div', { class: 'ringbox', html: ringSVG(readiness, { r: 46, w: 12, vb: 120 }) + `<div class="lbl"><div><b class="rv">0</b><b>%</b><small>FELKÉSZÜLTSÉG</small></div></div>` });
  const exam = h('section', { class: 'exam' },
    h('div', { class: 'when' }, left > 0 ? when : 'Nincs közelgő számonkérés'),
    h('h2', {}, st.exam.name || 'Számonkérés'),
    h('div', { class: 'left' }, left > 0 ? ['még ', h('b', {}, fmtLeft(left))] : h('a', { href: '#/me' }, st.exam.at ? 'Állíts be új dátumot →' : 'Add meg, mikor lesz →')),
    ring,
    h('div', { class: 'meta' },
      h('span', { class: 'tag' + (st.todayDone ? ' ok' : '') }, st.todayDone ? '✓ Mai kör megvan' : '◎ Mai cél: 1 kör'),
      ss.due ? h('span', { class: 'tag warn' }, `↻ ${ss.due} ismétlésre vár`) : null,
      h('span', { class: 'tag' }, `${ss.total - ss.fresh}/${ss.total} kártya látva`)));
  const go = h('button', { class: 'go' + (st.todayDone ? '' : ' breathe'), onclick: () => start({ mode: 'smart' }) },
    h('span', { class: 'play', html: '<svg viewBox="0 0 24 24"><path fill="#fff" d="M7 4.5v15c0 .8.9 1.3 1.6.8l11-7.5c.6-.4.6-1.2 0-1.6l-11-7.5C7.9 3.2 7 3.7 7 4.5z"/></svg>' }),
    h('span', {}, h('b', {}, st.todayDone ? 'Még egy kör' : 'Indul a kör'), h('small', {}, '~5 perc · 10 kérdés')));
  const seenAny = ss.fresh < ss.total;
  const chips = h('div', { class: 'row' },
    h('button', { class: 'chip', disabled: !seenAny, onclick: () => start({ mode: 'review' }) }, '↻ Ismétlés', ss.due ? h('span', { class: 'n' }, ss.due) : null),
    h('button', { class: 'chip', onclick: () => $('#memos')?.scrollIntoView({ behavior: RM() ? 'auto' : 'smooth', block: 'center' }) }, '🎭 Memoriterek'));
  const memoPoems = subj.topics.flatMap(t => (t.poems || []).filter(p => p.memo));
  const memos = h('div', { class: 'memos', id: 'memos' }, memoPoems.map(p => {
    const sp = stPoem(p.id), n = (p.text || '').split(/\n\s*\n/).length;
    return h('button', { class: 'memo', onclick: () => location.hash = '#/p/' + p.id },
      h('div', { class: 'mr', html: ringSVG(pct(sp.memo), { r: 20, w: 6, vb: 52, grad: ['#b69cff', '#ff6fb5'] }) + `<b>${pct(sp.memo)}%</b>` }),
      h('div', { class: 't' }, p.title), h('div', { class: 's' }, `${n} versszak · ${S.topics[p.topic].name}`));
  }));
  const tiles = h('div', { class: 'tiles' }, subj.topics.map((t, i) => {
    const ts = stTopic(t.id);
    const el = h('button', { class: 'tile', style: { '--c': t.color }, onclick: () => location.hash = '#/t/' + t.id },
      h('span', { class: 'em' }, t.icon),
      h('span', {}, h('div', { class: 'nm' }, t.name), h('div', { class: 'sm' }, t.sum || ''), bar(pct(ts.known), t.color)),
      h('span', {}, h('span', { class: 'pc' }, pct(ts.known) + '%'), ts.due ? h('span', { class: 'due' }, `↻ ${ts.due}`) : null));
    el.style.setProperty('--c', t.color);
    if (first && !RM()) el.animate([{ opacity: 0, transform: 'translateY(18px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 120 + i * 45, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'backwards' });
    return el;
  }));
  const root = h('div', {}, topBar(st), exam, go, chips,
    memoPoems.length ? [h('h3', { class: 'sec' }, 'Memoriterek', h('span', {}, 'fejből kell tudni')), memos] : null,
    h('h3', { class: 'sec unit' }, subj.units[0]?.name || subj.name, h('span', {}, subj.units[0]?.sub || '')), tiles,
    h('p', { class: 'foot' }, `Szikra ${S.lib.version} · ${subj.topics.reduce((a, t) => a + t.cardCount, 0)} kártya · ${memoPoems.length} memoriter`));
  root._after = () => countUp($('.rv', root), 0, readiness, 1100);
  return root;
}

// ================= topic =================
async function viewTopic(id) {
  const t = S.topics[id]; if (!t) { location.hash = '#/'; return null; }
  const st = await getState(), ts = stTopic(id);
  const learn = (t.learn || []).map(l => h('article', { class: 'note' }, h('h4', {}, l.title), h('ul', {}, l.b.map(b => h('li', {}, b)))));
  const poems = (t.poems || []).map(p => {
    const sp = stPoem(p.id);
    return h('button', { class: 'prow', onclick: () => location.hash = '#/p/' + p.id },
      h('span', {}, h('span', { class: 't' }, p.title), p.memo ? h('span', { class: 'badge-memo' }, 'MEMORITER') : null),
      h('span', { class: 'y' }, `${p.year || ''} · ${pct(sp.known)}%`), bar(pct(sp.known), t.color));
  });
  const root = h('div', {},
    h('header', { class: 'top' }, goBack('#/'), h('div', { class: 'logo' }), h('button', { class: 'pill', onclick: () => location.hash = '#/me' }, `⭐ ${st.level.level}`)),
    h('section', { class: 'hero', style: { '--c': t.color } }, h('div', { class: 'em' }, t.icon), h('div', {}, h('h1', {}, t.name), h('p', {}, t.sum || ''))),
    bar(pct(ts.known), t.color),
    h('div', { class: 'stats' },
      h('span', { class: 'tag ok' }, `✓ ${ts.learned} megy`), ts.due ? h('span', { class: 'tag warn' }, `↻ ${ts.due} ismétlés`) : null,
      h('span', { class: 'tag' }, `✦ ${ts.fresh} új`), h('span', { class: 'tag' }, `${pct(ts.known)}%`)),
    h('div', { style: { margin: '16px 0 6px' } }, h('button', { class: 'btn', onclick: () => start({ mode: 'topic', topic: id }) }, '▶ Kör ebből a témából', h('small', {}, '~5 perc'))),
    poems.length ? [h('h3', { class: 'sec' }, 'Versek'), h('div', { class: 'plist' }, poems)] : null,
    h('h3', { class: 'sec' }, 'Jegyzet', h('span', {}, '1 perc átfutás')), h('div', { class: 'notes' }, learn),
    t.links?.length ? [h('h3', { class: 'sec' }, 'Videók, segédletek'), h('div', { class: 'links' }, t.links.map(l => h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.title)))] : null);
  root.style.setProperty('--c', t.color);
  return root;
}

// ================= poem =================
// A word for the first-letter view: the first letter (with any leading quote mark) stays visible.
function initialsWord(w) {
  if (!/\S/.test(w)) return w;
  const head = (w.match(/^[^\p{L}\p{N}]*./u) || [w[0]])[0];
  return h('span', { class: 'w' }, h('b', {}, head), w.slice(head.length));
}
async function viewPoem(id) {
  const p = S.poems[id]; if (!p) { location.hash = '#/'; return null; }
  await getState();
  const t = S.topics[p.topic], sp = stPoem(id);
  const stz = (p.text || '').split(/\n\s*\n/).map(s => s.split('\n'));
  const text = h('div', { class: 'poem' },
    p.ded ? h('p', { class: 'ded' }, p.ded) : null, p.motto ? h('p', { class: 'motto' }, p.motto) : null,
    stz.map(lines => h('p', { class: 'st' }, lines.map(l => h('span', { class: 'ln', onclick: e => e.currentTarget.classList.toggle('show') }, l.split(/(\s+)/).map(initialsWord))))));
  const tg = h('button', { class: 'toggle', 'aria-pressed': 'false', onclick: () => { const on = text.classList.toggle('initials'); tg.classList.toggle('on', on); tg.setAttribute('aria-pressed', on); $$('.ln.show', text).forEach(x => x.classList.remove('show')); SND.page(); } }, h('span', { class: 'sw' }), 'Kezdőbetűs nézet – koppints egy sorra a felfedéshez');
  const drills = p.memo ? h('div', {},
    h('h3', { class: 'sec' }, 'Memoriter-edző', h('span', {}, `${pct(sp.memo)}% megy`)),
    bar(pct(sp.memo), '#b69cff', '#ff6fb5'),
    h('div', { class: 'grid3', style: { marginTop: '12px' } },
      h('button', { class: 'drill', onclick: () => start({ mode: 'memo', poem: id, kind: 'm-order' }) }, h('span', { class: 'i' }, '🧩'), 'Sorrend', h('small', {}, 'rakd ki a sorokat')),
      h('button', { class: 'drill', onclick: () => start({ mode: 'memo', poem: id, kind: 'm-cloze' }) }, h('span', { class: 'i' }, '🕳️'), 'Lyukak', h('small', {}, 'hiányzó szavak')),
      h('button', { class: 'drill', onclick: () => start({ mode: 'memo', poem: id, kind: 'm-line' }) }, h('span', { class: 'i' }, '✍️'), 'Fejből', h('small', {}, 'írd be a sort'))),
    h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn lilac', onclick: () => start({ mode: 'memo', poem: id }) }, '🎭 Vegyes memoriter-kör'))) : null;
  const root = h('div', {},
    h('header', { class: 'top' }, goBack('#/t/' + p.topic), h('div', { class: 'logo' }), h('span', { class: 'tag' }, `${t.icon} ${t.name}`)),
    h('section', { class: 'hero', style: { '--c': t.color } }, h('div', {}, h('h1', {}, p.title, p.memo ? h('span', { class: 'badge-memo' }, 'MEMORITER') : null), h('p', {}, [p.year, p.vol].filter(Boolean).join(' · ')))),
    bar(pct(sp.known), t.color),
    h('div', { class: 'grid2', style: { margin: '14px 0 4px' } },
      h('button', { class: 'btn', onclick: () => start({ mode: 'poem', poem: id }) }, '▶ Kör a versből'),
      p.video ? h('a', { class: 'btn ghost', href: p.video, target: '_blank', rel: 'noopener noreferrer', style: { textDecoration: 'none' } }, '🎧 Meghallgatom') : h('button', { class: 'btn ghost', onclick: () => tg.click() }, '👀 Kezdőbetűk')),
    drills,
    h('h3', { class: 'sec' }, 'A vers'), tg, text,
    p.notes?.length ? [h('h3', { class: 'sec' }, 'Amit tudni kell róla'), h('article', { class: 'note' }, h('ul', {}, p.notes.map(n => h('li', {}, n))))] : null);
  return root;
}

// ================= me =================
async function viewMe() {
  const st = await getState(), lv = st.level, into = st.xp - lv.from, need = lv.to - lv.from, who = me();
  const saveProfile = async patch => {
    try {
      const p = await put('/api/profiles/' + encodeURIComponent(who.id), { name: who.name, avatar: who.avatar, theme: who.theme, ...patch });
      Object.assign(who, p); toast('Elmentve ✓');
      $$('.av-btn, .mehero .avin').forEach(el => el.innerHTML = avatarSVG(who.avatar));
      $('.mehero h1') && ($('.mehero h1').textContent = who.name);
    } catch { toast('Nem sikerült menteni'); }
  };
  const pname = h('input', { value: who.name, maxlength: 24, autocomplete: 'off', name: 'profile-name' });
  pname.addEventListener('change', () => pname.value.trim() ? saveProfile({ name: pname.value }) : (pname.value = who.name));
  const hist = st.history, maxXP = Math.max(30, ...hist.map(d => d.xp || 0));
  const a = hist.reduce((s, d) => s + (d.a || 0), 0), c = hist.reduce((s, d) => s + (d.c || 0), 0);
  const earned = st.badges.filter(b => b.at).sort((x, y) => y.at - x.at), locked = st.badges.filter(b => !b.at);
  const name = h('input', { value: st.exam.name, maxlength: 60, name: 'exam-name' }), at = h('input', { type: 'datetime-local', value: st.exam.at, name: 'exam-at' });
  const snd = h('button', { class: 'toggle' + (S.sound ? ' on' : ''), onclick: () => { S.sound = !S.sound; lsSet('sound', S.sound ? '1' : '0'); snd.classList.toggle('on', S.sound); SND.unlock(); SND.ok(3); } }, h('span', { class: 'sw' }), 'Hangok');
  const mot = h('button', { class: 'toggle' + (S.motion !== 'off' ? ' on' : ''), onclick: () => { S.motion = S.motion === 'off' ? 'auto' : 'off'; lsSet('motion', S.motion); mot.classList.toggle('on', S.motion !== 'off'); document.documentElement.classList.toggle('rm', RM()); FX.kick(); } }, h('span', { class: 'sw' }), 'Animációk és rezgés');
  const conf = h('input', { placeholder: 'írd be: TÖRLÉS', autocomplete: 'off' });
  const root = h('div', {},
    h('header', { class: 'top' }, goBack('#/'), h('div', { class: 'logo' })),
    h('section', { class: 'mehero' },
      h('div', { class: 'r', html: ringSVG(pct(into / need), { r: 58, w: 10, vb: 132 }) + `<div class="avin">${avatarSVG(who.avatar)}</div><b class="lv">${lv.level}</b>` }),
      h('h1', {}, who.name), h('p', {}, `${lv.name} · ${st.xp} XP · még ${lv.to - st.xp} XP a következő szintig`)),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('b', {}, `${st.todayDone ? '🔥' : '🕯️'} ${st.streak}`), h('small', {}, 'napos széria')),
      h('div', { class: 'kpi' }, h('b', {}, `⚡ ${st.bestCombo}`), h('small', {}, 'legjobb kombó')),
      h('div', { class: 'kpi' }, h('b', {}, `🎯 ${st.rounds}`), h('small', {}, 'befejezett kör')),
      h('div', { class: 'kpi' }, h('b', {}, a ? `${Math.round(c / a * 100)}%` : '–'), h('small', {}, 'pontosság (14 nap)'))),
    h('h3', { class: 'sec' }, 'Az elmúlt 14 nap', h('span', {}, 'XP naponta')),
    h('div', { class: 'panel' }, h('div', { class: 'hist' }, hist.map((d, i) => h('div', {}, h('i', { class: d.xp ? '' : 'zero', style: { height: Math.max(3, (d.xp || 0) / maxXP * 86) + 'px', animationDelay: i * 30 + 'ms' } }), h('span', {}, d.date.slice(8)))))),
    h('h3', { class: 'sec' }, 'Jelvények', h('span', {}, `${earned.length}/${st.badges.length}`)),
    h('div', { class: 'badges' }, [...earned, ...locked].map(b => h('div', { class: 'bdg' + (b.at ? '' : ' lock'), title: b.desc }, h('i', {}, b.icon), b.name, h('small', {}, b.desc)))),
    h('h3', { class: 'sec' }, 'Profil'),
    h('div', { class: 'panel' },
      h('div', { class: 'field' }, h('label', {}, 'Név'), pname),
      h('div', { class: 'field' }, h('label', {}, 'Profilkép')), avatarPicker(who.avatar, k => saveProfile({ avatar: k })),
      h('div', { class: 'field' }, h('label', {}, 'Téma')), themePicker(who.theme, k => { applyTheme(k); saveProfile({ theme: k }); }),
      h('button', { class: 'btn ghost', onclick: () => location.hash = '#/who' }, '⇄ Profilváltás')),
    h('h3', { class: 'sec' }, 'Következő számonkérés'),
    h('div', { class: 'panel' },
      h('div', { class: 'field' }, h('label', {}, 'Mi lesz?'), name),
      h('div', { class: 'field' }, h('label', {}, 'Mikor?'), at),
      h('button', { class: 'btn gold', onclick: async () => { try { await put('/api/exam', { name: name.value, at: at.value }); toast('Elmentve ✓ – az ismétlések ehhez igazodnak'); } catch { toast('Nem sikerült menteni'); } } }, 'Mentés'),
      h('p', { class: 'tip', style: { marginTop: '10px' } }, 'A Szikra úgy ütemezi az ismétléseket, hogy a dátum előtt mindent még legalább egyszer lásd.')),
    h('h3', { class: 'sec' }, 'Beállítások'),
    h('div', { class: 'panel' }, snd, mot,
      h('a', { class: 'btn ghost', href: '/api/export?p=' + encodeURIComponent(S.profile), style: { textDecoration: 'none', marginTop: '8px' } }, '⤓ Haladás letöltése (mentés)')),
    h('h3', { class: 'sec danger' }, 'Haladás törlése'),
    h('div', { class: 'panel' }, h('div', { class: 'field' }, h('label', {}, 'Minden haladás elvész (a jelvények és az XP is).'), conf),
      h('button', { class: 'btn coral', onclick: async () => { if (fold(conf.value) !== 'torles') { shake(conf); return; } try { await post('/api/reset', { confirm: conf.value }); lsSet('queue', '[]'); Q.list = []; toast('Tiszta lap ✓'); location.hash = '#/'; } catch { toast('Nem sikerült'); } } }, 'Törlés')),
    h('p', { class: 'foot' }, `Szikra ${S.lib.version} · a tanulás kutatások alapján: kikérdezés, szétszórt ismétlés, rövid körök.`));
  return root;
}

// ================= profiles =================
function themePicker(cur, onPick) {
  const box = h('div', { class: 'themes' });
  for (const [k, label] of [['szikra', '✦ Szikra'], ['pink', '♡ Pink']])
    box.append(h('button', { class: 'thm ' + k + (k === cur ? ' on' : ''), 'aria-pressed': k === cur, onclick: e => { $$('.thm', box).forEach(b => { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); }); e.currentTarget.classList.add('on'); e.currentTarget.setAttribute('aria-pressed', 'true'); SND.tick(); onPick(k); } }, label));
  return box;
}
function avatarPicker(cur, onPick) {
  const box = h('div', { class: 'picks' });
  for (const k of Object.keys(AVATARS))
    box.append(h('button', { class: 'pick' + (k === cur ? ' on' : ''), 'aria-label': AVATARS[k].name, html: avatarSVG(k), onclick: e => { $$('.pick', box).forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); pop(e.currentTarget, 1.12); SND.tick(); onPick(k); } }));
  return box;
}
async function viewWho() {
  S.profiles = await api('/api/profiles');
  const pinkCols = ['#ff4fa3', '#ffb5d8', '#c9a8ff', '#ffffff'];
  let busy = false;
  async function choose(p, card) {
    if (busy) return; busy = true;
    SND.unlock(); SND.ok(4); buzz(15);
    const face = $('.face', card); face.style.animation = 'none';
    if (!RM()) face.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.22,.82)', offset: .3 }, { transform: 'translateY(-16px) scale(.92,1.12)', offset: .6 }, { transform: 'scale(1)' }], { duration: 460, easing: 'ease-out' });
    const [x, y] = center(face); FX.burst(x, y, { n: 30, colors: p.theme === 'pink' ? pinkCols : undefined });
    S.profile = p.id; lsSet('profile', p.id); S.state = null; S.visits = 0;
    await sleep(RM() ? 0 : 430);
    applyTheme(p.theme);
    location.hash = '#/';
  }
  const cards = S.profiles.map(p => {
    const c = h('button', { class: 'wcard' + (p.theme === 'pink' ? ' pink' : ''), onclick: () => choose(p, c) },
      h('div', { class: 'face', html: avatarSVG(p.avatar) }), h('b', {}, p.name),
      h('small', {}, `⭐ ${p.level.level}. szint · ${p.todayDone ? '🔥' : '🕯️'} ${p.streak}`),
      bar(pct(p.known), p.theme === 'pink' ? '#ff4fa3' : null, p.theme === 'pink' ? '#c9a8ff' : null));
    return c;
  });
  let av = 'roka', th = 'szikra';
  const name = h('input', { maxlength: 24, placeholder: 'pl. Bence', autocomplete: 'off' });
  const form = h('div', { class: 'panel newp', hidden: true },
    h('div', { class: 'field' }, h('label', {}, 'Név'), name),
    h('div', { class: 'field' }, h('label', {}, 'Profilkép')), avatarPicker(av, k => av = k),
    h('div', { class: 'field' }, h('label', {}, 'Téma')), themePicker(th, k => th = k),
    h('button', { class: 'btn', onclick: async () => {
      if (!name.value.trim()) { shake(name); name.focus(); return; }
      try { const p = await post('/api/profiles', { name: name.value, avatar: av, theme: th }); toast(`${p.name} profilja kész ✓`); render(); } catch { toast('Nem sikerült létrehozni'); }
    } }, 'Létrehozás'));
  const add = h('button', { class: 'btn ghost', style: { marginTop: '18px' }, onclick: () => { form.hidden = false; add.hidden = true; setTimeout(() => name.focus(), 50); } }, '+ Új profil');
  return h('div', {},
    me() ? h('header', { class: 'top' }, goBack('#/'), h('div', { class: 'logo' })) : null,
    h('section', { class: 'who' },
      h('div', { class: 'logo', style: { justifyContent: 'center', margin: '0 0 14px' }, html: LOGO + '<span>Szikra</span>' }),
      h('h1', {}, 'Ki tanul most?'), h('p', { class: 'sub' }, 'Mindenkinek külön a haladása, a szériája és a dolgozat dátuma.'),
      h('div', { class: 'whos' }, cards), add, form));
}

// ================= play =================
function start(q) {
  SND.unlock();
  const p = new URLSearchParams({ ...q, r: Date.now().toString(36) });
  location.hash = '#/play?' + p;
}
function endPlayMode() { document.body.style.overflow = ''; P = null; FX.cool(); }
const OK_WORDS = ['Szuper!', 'Pontos!', 'Ez az!', 'Telitalálat!', 'Így kell!', 'Hibátlan!', 'Szép!', 'Megy ez!'];
const BAD_WORDS = ['Majdnem!', 'Nem egészen', 'Ez most nem jött be', 'Hoppá!'];
const COMBO_TXT = { 3: 'KOMBÓ ×1.5!', 6: 'KOMBÓ ×2! 🔥', 10: 'LÁNGOLSZ! ×3', 15: 'MEGÁLLÍTHATATLAN!', 20: 'TŰZVIHAR! 🌋', 30: 'ADY IS IRIGYELNÉ' };
const TIPS = [
  'A kikérdezés jobban rögzít, mint az újraolvasás – ezért kérdez folyton a Szikra. (Roediger & Karpicke, 2006)',
  'Ugyanannyi tanulás több rövid részre szétszórva többet ér, mint egyben. Egy kör most, egy este! (Cepeda és mtsai., 2006)',
  'Ami elsőre nem ment, a kör végén visszajön, aztán napokkal később is – így lesz belőle tartós tudás.',
  'Memoriter-tipp: mondd ki hangosan, és képzeld el a képet (héjapár, avar, Nyár → Ősz)!',
  'Szünet után jobban megy: a kör után 5 perc pihenő alatt is rendeződik az emlék.'
];
function baseXP(c) { if (c.k === 'm-line') return 15; return { tf: 6, mc: 8, flash: 8, cloze: 10, order: 12, match: 12, sort: 12, type: 15 }[c.t] || 8; }
function gained(c, ok, retry, combo) { if (!ok) return 0; if (retry) return baseXP(c) / 2 | 0; const m = combo >= 10 ? 3 : combo >= 6 ? 2 : combo >= 3 ? 1.5 : 1; return Math.round(baseXP(c) * m); }

async function viewPlay(qs) {
  const params = new URLSearchParams(qs); params.delete('r');
  const before = S.state || await getState();
  const sess = await api('/api/session?' + params);
  const wrap = h('div', { class: 'play-wrap' });
  if (!sess.items.length) {
    wrap.append(h('div', { class: 'phead' }, h('button', { class: 'x', 'aria-label': 'Bezárás', onclick: () => location.hash = '#/' }, '✕')),
      h('div', { class: 'stage' }, h('div', { class: 'empty card-in' }, h('div', { class: 'big-emoji' }, '🌙'), h('h2', {}, 'Itt most nincs mit ismételni'), h('p', { class: 'sub' }, 'Minden friss. Válassz egy témakört, vagy indíts egy napi kört!'), h('button', { class: 'btn', onclick: () => start({ mode: 'smart' }) }, '▶ Napi kör'))));
    return wrap;
  }
  document.body.style.overflow = 'hidden';
  const graded = sess.items.filter(i => i.kind === 'card').length;
  const segs = h('div', { class: 'segs', role: 'progressbar', 'aria-valuemax': graded }, Array.from({ length: graded }, () => h('div', { class: 'seg' }, h('i'))));
  const flame = h('span', { class: 'fl' }, '🔥'), comboN = h('span', {}, '0'), combo = h('div', { class: 'combo dim', 'aria-label': 'kombó' }, flame, '×', comboN);
  const sxp = h('div', { class: 'sxp' }, '+0 XP');
  const stage = h('div', { class: 'stage' }), foot = h('div', { class: 'pfoot' });
  const fb = h('div', { class: 'feedback', 'aria-live': 'polite' }), fbIn = h('div', { class: 'in' }); fb.append(fbIn);
  wrap.append(h('div', { class: 'phead' }, h('button', { class: 'x', 'aria-label': 'Kilépés', onclick: () => { Q.flush(); location.hash = '#/'; } }, '✕'), segs, combo), h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '-6px' } }, sxp), stage, foot, fb);

  const play = P = {
    items: sess.items.slice(), i: -1, seg: 0, combo: 0, maxCombo: 0, xp: 0, answered: 0, correct: 0, tries: {},
    t0: Date.now(), onKey: null, touched: new Set(), busy: false, celebrated: 0
  };
  const setCombo = n => {
    const prev = play.combo; play.combo = n; play.maxCombo = Math.max(play.maxCombo, n);
    comboN.textContent = n; combo.classList.toggle('dim', n < 2);
    flame.style.transform = `scale(${1 + Math.min(n, 15) * .045})`;
    if (n > prev) { pop(combo, 1.15); if (COMBO_TXT[n]) { banner(COMBO_TXT[n]); FX.heat(.35); } else FX.heat(.06); }
    else if (prev >= 3 && n === 0) { flame.animate([{ transform: flame.style.transform, filter: 'none' }, { transform: 'scale(.6) rotate(-20deg)', filter: 'grayscale(1)' }, { transform: 'scale(1)' }], { duration: 500, easing: 'ease-out' }); FX.cool(); }
  };

  function next() {
    hideFeedback();
    play.i++;
    if (play.i >= play.items.length) return finish();
    const it = play.items[play.i];
    $$('.seg', segs).forEach((s, k) => s.classList.toggle('cur', k === play.seg && it.kind === 'card' && !it.retry));
    let r;
    if (it.kind === 'learn') r = rLearn(it);
    else if (it.kind === 'read') r = rRead(it);
    else r = (R[it.card.t] || R.mc)(it, (ok, info) => answered(it, ok, info, card));
    const card = h('div', { class: 'qcard card-in' + (r.cls ? ' ' + r.cls : ''), 'data-id': it.card?.id || it.learn?.id || (it.read ? it.read.poem + '/' + it.read.stanza : '') }, r.tag !== false ? tagFor(it) : null, r.body);
    r.mount && r.mount(card);
    foot.replaceChildren(...(r.foot ? [r.foot] : []));
    play.onKey = r.keys || null;
    const old = stage.firstElementChild;
    const enter = () => {
      stage.replaceChildren(card); stage.scrollTop = 0;
      if (!RM()) card.animate([{ opacity: 0, transform: 'translateX(48px) rotate(1.5deg) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.34,1.45,.64,1)' });
      r.focus && setTimeout(r.focus, RM() ? 0 : 320);
    };
    if (old && !RM()) {
      old.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateX(10px) scale(1.01)', offset: .25 }, { transform: 'translateX(-70px) rotate(-3deg) scale(.95)', opacity: 0 }], { duration: 200, easing: 'cubic-bezier(.5,0,.75,0)' }).onfinish = enter;
      SND.whoosh();
    } else enter();
  }
  function tagFor(it) {
    const c = it.card, t = c ? S.topics[c.topic] : (it.learn ? S.topics[it.learn.topic] : S.topics[S.poems[it.read.poem]?.topic]);
    let badge = null;
    if (it.retry) badge = h('span', { class: 'again' }, 'ÚJRA');
    else if (c && it.new) badge = h('span', { class: 'new' }, 'ÚJ');
    else if (c) badge = h('span', { class: 'rep' }, 'ISMÉTLÉS');
    return h('div', { class: 'qtag' }, t ? `${t.icon} ${t.name}` : '', badge);
  }
  function answered(it, ok, info = {}, card) {
    if (play.busy) return; play.busy = true;
    const c = it.card, retry = !!it.retry;
    play.touched.add(c.topic);
    if (!retry) {
      play.answered++; if (ok) play.correct++;
      const s = $$('.seg', segs)[play.seg++]; if (s) { s.classList.remove('cur'); s.classList.add(ok ? 'ok' : 'bad'); }
    }
    setCombo(ok ? play.combo + 1 : 0);
    const g = gained(c, ok, retry, play.combo);
    play.xp += g;
    Q.push({ id: c.id, ok, retry, combo: play.combo, at: Math.floor(Date.now() / 1000) });
    const target = info.el || card;
    if (ok) {
      const [x, y] = center(target);
      const n = play.combo >= 6 ? 34 : Math.max(12, 26 - play.celebrated++ * 1.5);
      FX.burst(x, y, { n, colors: play.combo >= 6 ? (PINK() ? ['#ff4fa3', '#ffd36b', '#c9a8ff', '#ff8fc7'] : ['#ffc94d', '#ff7a3d', '#fff', '#ff6fb5']) : undefined });
      SND.ok(play.combo); buzz(12); pop(target, 1.06);
      if (g) setTimeout(() => { flyXP(target, sxp, `+${g}`); setTimeout(() => sxp.textContent = `+${play.xp} XP`, 640); }, 120);
    } else {
      SND.bad(); buzz([30, 40, 30]); if (!info.el || info.el === card) shake(card);
      play.tries[c.id] = (play.tries[c.id] || 0) + 1;
      if (play.tries[c.id] <= 2) play.items.splice(Math.min(play.i + 4, play.items.length), 0, { ...it, retry: true });
    }
    setTimeout(() => showFeedback(it, ok, info, g), ok ? 260 : 420);
  }
  function showFeedback(it, ok, info, g) {
    const c = it.card;
    const ans = ok ? null : (info.node || (info.ans != null ? h('div', {}, info.ans) : null));
    const willRetry = !ok && (play.tries[c.id] || 0) <= 2;
    const btn = h('button', { class: 'btn ' + (ok ? 'mint' : 'coral'), onclick: next }, ok ? 'Tovább' : 'Értem, tovább');
    fbIn.replaceChildren(...[
      h('div', { class: 'fbh' }, h('span', { class: 'ic' }, ok ? '✓' : '✕'), ok ? OK_WORDS[Math.random() * OK_WORDS.length | 0] : (info.near ? 'Majdnem megvan!' : BAD_WORDS[Math.random() * BAD_WORDS.length | 0]), g ? h('span', { class: 'xp' }, `+${g} XP`) : null),
      ans ? h('div', { class: 'fbans' }, h('span', { class: 'lab' }, 'Helyesen'), ans) : null,
      info.note ? h('div', { class: 'fbw' }, info.note) : null,
      c.w ? h('div', { class: 'fbw' }, c.w) : null,
      willRetry ? h('div', { class: 'fbw' }, '↻ Ez a kör végén még egyszer előjön.') : null,
      btn].filter(Boolean));
    fb.classList.toggle('bad', !ok); fb.classList.add('show');
    play.onKey = k => { if (k === 'Enter' || k === ' ') next(); };
    btn.focus({ preventScroll: true });
    play.busy = false;
  }
  function hideFeedback() { fb.classList.remove('show'); }
  function rLearn(it) {
    const l = it.learn;
    post('/api/seen', { id: l.id }).catch(() => {});
    const ul = h('ul', {}, l.b.map((b, i) => { const li = h('li', {}, b); if (!RM()) li.animate([{ opacity: 0, transform: 'translateX(-14px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 200 + i * 110, easing: 'cubic-bezier(.34,1.45,.64,1)', fill: 'backwards' }); return li; }));
    const btn = h('button', { class: 'btn gold', onclick: next }, 'Értem, jöhet! →');
    return { cls: 'learn', tag: h('div', { class: 'qtag' }, '💡 Tudtad?'), body: [h('h2', { class: 'big' }, l.title), ul], foot: btn, keys: k => { if (k === 'Enter' || k === ' ') next(); }, focus: () => btn.focus({ preventScroll: true }) };
  }
  function rRead(it) {
    const r = it.read;
    const lines = r.lines.map((l, i) => { const s = h('span', { class: 'ln' }, l); if (!RM()) s.animate([{ opacity: 0, filter: 'blur(6px)', transform: 'translateY(8px)' }, { opacity: 1, filter: 'blur(0)', transform: 'none' }], { duration: 420, delay: 150 + i * 160, easing: 'ease-out', fill: 'backwards' }); return s; });
    const btn = h('button', { class: 'btn lilac', onclick: next }, 'Megvan, jöhet a feladat →');
    return { cls: 'read', tag: h('div', { class: 'qtag' }, '🎭 Memoriter – olvasd el!'), body: [h('p', { class: 'q' }, r.title), h('p', { class: 'q2' }, `${r.stanza}. versszak`), h('div', { class: 'stanza' }, lines), h('p', { class: 'hint' }, 'Olvasd el kétszer, hangosan. Másodszorra próbáld csukott szemmel!')], foot: btn, keys: k => { if (k === 'Enter') next(); } };
  }
  async function finish() {
    play.onKey = null;
    const secs = Math.round((Date.now() - play.t0) / 1000);
    const stats = { answered: play.answered, correct: play.correct, maxCombo: play.maxCombo, secs };
    foot.replaceChildren(); stage.replaceChildren(h('div', { class: 'spin' }));
    const synced = await Q.flush();
    let fin = null, after = null;
    try { fin = await post('/api/finish', stats); after = await getState(); } catch {}
    if (P !== play) return;
    const showSummary = () => summary(play, stats, before, after, fin, synced !== false);
    if (after && after.level.level > before.level.level) levelUp(after.level, showSummary); else showSummary();
  }
  function summary(play, stats, before, after, fin, synced) {
    const acc = stats.answered ? Math.round(stats.correct / stats.answered * 100) : 0;
    const emoji = acc >= 90 ? '🏆' : acc >= 70 ? '🔥' : acc >= 40 ? '💪' : '🌱';
    const title = acc >= 90 ? 'Hibátlan kör!' : acc >= 70 ? 'Szép kör!' : acc >= 40 ? 'Haladsz!' : 'Jó kezdés!';
    const xpEl = h('b', {}, '0'), accEl = h('b', {}, '0%');
    const subj = S.lib.subjects[0];
    const rows = [];
    const bs = before.subjects.find(s => s.id === subj.id), as = after?.subjects.find(s => s.id === subj.id);
    if (bs && as) rows.push([subj.units[0]?.name || subj.name, bs.known, as.known, '#ff7a3d']);
    for (const id of [...play.touched].slice(0, 3)) {
      const b = before.topics.find(t => t.id === id), a = after?.topics.find(t => t.id === id);
      if (b && a) rows.push([`${S.topics[id].icon} ${S.topics[id].name}`, b.known, a.known, S.topics[id].color]);
    }
    const mast = h('div', { class: 'mast' }, rows.map(([n, b, a, col]) => {
      const i = h('i', { style: { width: pct(b) + '%' } }); i.style.setProperty('--c', col);
      const d = pct(a) - pct(b);
      const row = h('div', {}, h('div', { class: 'lbl' }, h('span', {}, n), h('span', {}, `${pct(a)}%`, d > 0 ? h('em', {}, ` +${d}`) : '')), h('div', { class: 'bar-o' }, i));
      setTimeout(() => i.style.width = pct(a) + '%', 500);
      return row;
    }));
    const nb = fin?.badges?.length ? h('div', { class: 'newb' }, fin.badges.map((b, k) => h('div', { style: { animationDelay: 700 + k * 150 + 'ms' } }, h('i', {}, b.icon), b.name))) : null;
    const nextDue = after?.nextDue ? h('p', { class: 'tip' }, `⏰ Következő ismétlés: ${fmtWhen(after.nextDue)} – akkor gyere vissza egy körre!`) : null;
    const long = after && after.today.s > 900 ? h('p', { class: 'tip' }, `Ma már ${Math.round(after.today.s / 60)} perce tanulsz – most jól jön 5 perc szünet. 🙂`) : null;
    const again = h('button', { class: 'btn', onclick: () => start(Object.fromEntries(params)) }, '▶ Még egy kör');
    const sheet = h('div', { class: 'sheet' },
      h('div', { class: 'big-emoji' }, emoji), h('h2', {}, title),
      h('p', { class: 'sub' }, fin ? `${fin.streak} napos széria ${fin.todayDone ? '🔥' : ''}` : 'Offline – a válaszok a következő csatlakozáskor mennek át.'),
      h('div', { class: 'sumgrid' }, h('div', { class: 'xpv' }, xpEl, h('small', {}, 'XP')), h('div', {}, accEl, h('small', {}, 'elsőre jó')), h('div', {}, h('b', {}, `${stats.maxCombo}`), h('small', {}, 'max kombó'))),
      mast, nb, nextDue, long || h('p', { class: 'tip' }, '💡 ' + TIPS[Math.random() * TIPS.length | 0]),
      h('div', { class: 'stack' }, again, h('button', { class: 'btn ghost', onclick: () => location.hash = '#/' }, 'Kész, vissza a főoldalra')));
    const ov = h('div', { class: 'ov' }, sheet);
    stage.replaceChildren(); wrap.append(ov);
    SND.done();
    if (acc >= 70 || fin?.badges?.length) setTimeout(() => FX.confetti(acc >= 90 ? 180 : 110), 250);
    setTimeout(() => { countUp(xpEl, 0, play.xp, 1000); countUp(accEl, 0, acc, 1000, '%'); }, 250);
    play.onKey = k => { if (k === 'Enter') again.click(); };
    setTimeout(() => again.focus({ preventScroll: true }), 400);
    if (!synced) toast('A szerver most nem elérhető – a válaszok elmentve a böngészőben.');
  }
  function levelUp(lv, then) {
    SND.level(); buzz([20, 60, 20, 60, 40]);
    const ov = h('div', { class: 'lvlup', role: 'dialog', 'aria-label': 'Szintlépés' }, h('div', { class: 'rays' }),
      h('div', { class: 'c' }, h('div', { class: 'k' }, 'Új szint'), h('div', { class: 'n' }, lv.level), h('div', { class: 'nm' }, lv.name), h('div', { class: 'tap' }, 'koppints a folytatáshoz')));
    const close = () => { ov.remove(); then(); };
    ov.addEventListener('click', close);
    wrap.append(ov);
    FX.confetti(200);
    play.onKey = k => { if (k === 'Enter' || k === ' ') close(); };
  }
  wrap._after = () => next();
  return wrap;
}

// ---------- question text ----------
function qText(c) {
  const [first, ...rest] = (c.q || '').split('\n');
  if (c.k === 'quote') return [h('p', { class: 'q2', style: { marginTop: 0 } }, first), h('p', { class: 'quote' }, rest.join(' '))];
  return [h('p', { class: 'q' }, first), rest.length ? h('p', { class: 'q2' }, rest.join(' · ')) : null];
}

// ---------- card renderers: (item, done) => { body, foot, mount, keys, focus } ----------
const R = {
  mc(it, done) {
    const c = it.card, opts = shuffle([c.a, ...(c.x || []).slice(0, 3)]);
    let locked = false;
    const btns = opts.map((o, i) => h('button', { class: 'opt', onclick: () => pick(i) }, h('span', { class: 'k' }, 'ABCD'[i]), h('span', {}, o)));
    function pick(i) {
      if (locked) return; locked = true;
      const ok = opts[i] === c.a;
      btns.forEach((b, j) => { b.disabled = true; b.classList.add(opts[j] === c.a ? 'ok' : j === i ? 'bad' : 'dim'); });
      if (!ok) shake(btns[i]);
      done(ok, { el: btns[i], ans: c.a });
    }
    return { body: [qText(c), h('div', { class: 'opts' }, btns)], keys: k => { const n = '1234abcd'.indexOf(k.toLowerCase()) % 4; if (n >= 0 && n < btns.length) pick(n); } };
  },
  tf(it, done) {
    const c = it.card; let locked = false, card;
    const st = h('div', { class: 'stamp t' }, 'IGAZ'), sf = h('div', { class: 'stamp f' }, 'HAMIS');
    function decide(v) {
      if (locked) return; locked = true; card.dataset.lock = '1';
      const dir = v ? 1 : -1;
      (v ? st : sf).style.opacity = 1; (v ? sf : st).style.opacity = 0;
      card.style.transition = 'transform .3s cubic-bezier(.34,1.56,.64,1)'; card.style.transform = `translateX(${dir * 12}px) rotate(${dir * 1.5}deg)`;
      const ok = v === c.ok;
      done(ok, { el: card, ans: `Az állítás ${c.ok ? 'IGAZ' : 'HAMIS'}.` });
    }
    return {
      cls: 'swipe',
      body: [st, sf, h('p', { class: 'q', style: { marginTop: '6px' } }, c.q)],
      mount: el => { card = el; swipeable(el, { onMove: dx => { st.style.opacity = clamp(dx / 100, 0, 1); sf.style.opacity = clamp(-dx / 100, 0, 1); }, onCommit: d => decide(d > 0) }); },
      foot: h('div', {}, h('div', { class: 'tfrow' }, h('button', { class: 'tfb f', onclick: () => decide(false) }, '✕ HAMIS'), h('button', { class: 'tfb t', onclick: () => decide(true) }, 'IGAZ ✓')), h('p', { class: 'hint' }, 'vagy húzd a kártyát balra / jobbra')),
      keys: k => { if (k === 'ArrowLeft' || k === 'h') decide(false); if (k === 'ArrowRight' || k === 'i') decide(true); }
    };
  },
  type(it, done) {
    const c = it.card, memo = c.k === 'm-line';
    const inp = h('input', { class: 'inp', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done', placeholder: memo ? 'a hiányzó sor…' : 'a válaszod…', 'aria-label': 'válasz' });
    let locked = false;
    const check = h('button', { class: 'btn', disabled: true, onclick: () => submit(false) }, 'Ellenőrzés');
    inp.addEventListener('input', () => check.disabled = !inp.value.trim());
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && inp.value.trim()) { e.preventDefault(); submit(false); } });
    function submit(giveUp) {
      if (locked) return; locked = true; inp.blur(); inp.readOnly = true; check.disabled = true;
      if (memo) {
        const r = giveUp ? { score: 0, hit: [] } : lineScore(inp.value, c.a);
        const ok = r.score >= .8;
        inp.classList.add(ok ? 'ok' : 'bad');
        done(ok, { el: inp, node: diffNode(c.a, r.hit), near: !ok && r.score >= .5, note: !giveUp && !ok ? `${Math.round(r.score * 100)}% egyezés – 80% kell.` : (ok && r.score < 1 ? 'Apró eltérés van, de elfogadom. Nézd meg a pontos sort!' : null) });
      } else {
        const ok = !giveUp && matchText(inp.value, [c.a, ...(c.alt || [])]);
        inp.classList.add(ok ? 'ok' : 'bad');
        if (ok && fold(inp.value) !== fold(c.a)) inp.value = c.a;
        done(ok, { el: inp, ans: c.a });
      }
    }
    const giveUp = h('button', { class: 'linkbtn', onclick: () => submit(true) }, 'Nem tudom – mutasd');
    let body;
    if (memo) {
      const lines = c.items.map((l, i) => i === c.hole - 1 ? h('span', { class: 'ln hole' }, inp) : h('span', { class: 'ln' }, l));
      body = [qText(c), h('div', { class: 'stanza' }, lines), giveUp];
    } else body = [qText(c), inp, giveUp];
    return { body, foot: check, focus: () => { if (!locked) inp.focus({ preventScroll: true }); } };
  },
  cloze(it, done) {
    const c = it.card, verse = c.k === 'm-cloze';
    const slots = [], answers = [];
    const sentence = h('div', { class: 'cloze' + (verse ? ' verse' : '') });
    (c.s || '').split('\n').forEach((line, li) => {
      if (li) sentence.append(h('br'));
      let last = 0;
      line.replace(/\[([^\]]+)\]/g, (m, a, idx) => {
        sentence.append(line.slice(last, idx));
        const s = h('button', { class: 'slot', 'aria-label': 'üres hely', onclick: () => tapSlot(s) }, ' ');
        s._ans = a; s._chip = null; slots.push(s); answers.push(a); sentence.append(s);
        last = idx + m.length; return m;
      });
      sentence.append(line.slice(last));
    });
    let locked = false, target = null;
    const chips = shuffle([...answers, ...(c.x || [])]).map(w => { const b = h('button', { class: 'wchip', onclick: () => tapChip(b) }, w); b._w = w; return b; });
    const mark = () => { const n = target || slots.find(s => !s._chip); slots.forEach(s => s.classList.toggle('next', s === n && !locked)); };
    async function tapChip(b) {
      if (locked) return;
      const s = (target && !target._chip) ? target : slots.find(x => !x._chip); if (!s) return;
      target = null; s._chip = b; b.classList.add('used'); SND.tick();
      await ghostFly(b, s, b._w);
      s.textContent = b._w; s.classList.add('f'); pop(s, 1.1); mark();
      if (slots.every(x => x._chip)) setTimeout(checkAll, 250);
    }
    function tapSlot(s) {
      if (locked) return;
      if (s._chip) { s._chip.classList.remove('used'); s._chip = null; s.textContent = ' '; s.classList.remove('f'); }
      target = s; mark();
    }
    function checkAll() {
      if (locked) return; locked = true;
      let ok = true;
      slots.forEach(s => { const good = fold(s._chip._w) === fold(s._ans); ok = ok && good; s.classList.add(good ? 'ok' : 'bad'); if (!good) shake(s); });
      chips.forEach(b => b.disabled = true); mark();
      const node = h('div', { class: verse ? 'cloze verse' : '', style: { lineHeight: 1.5, fontSize: '16px' } }, (c.s || '').split('\n').map((l, i) => [i ? h('br') : null, l.split(/\[([^\]]+)\]/).map((p, k) => k % 2 ? h('b', { style: { color: 'var(--gold)' } }, p) : p)]));
      done(ok, { el: sentence, node });
    }
    setTimeout(mark, 0);
    return { body: [c.q ? qText(c) : h('p', { class: 'q' }, 'Töltsd ki a hiányzó részt!'), sentence, h('div', { class: 'bank' }, chips)] };
  },
  order(it, done) {
    const c = it.card, verse = c.k === 'm-order';
    let items = shuffle(c.items); for (let k = 0; k < 6 && items.every((x, i) => x === c.items[i]); k++) items = shuffle(c.items);
    const slots = c.items.map(() => { const s = h('button', { class: 'oslot', onclick: () => tapSlot(s) }); s._chip = null; return s; });
    const pool = items.map(t => { const b = h('button', { class: 'wchip', onclick: () => tapChip(b) }, t); b._t = t; return b; });
    let locked = false;
    async function tapChip(b) {
      if (locked) return;
      const s = slots.find(x => !x._chip); if (!s) return;
      s._chip = b; b.classList.add('used'); SND.tick();
      await ghostFly(b, s, b._t);
      s.textContent = b._t; s.classList.add('f'); pop(s, 1.03);
      if (slots.every(x => x._chip)) setTimeout(check, 260);
    }
    function tapSlot(s) {
      if (locked || !s._chip) return;
      s._chip.classList.remove('used'); s._chip = null; s.textContent = ''; s.classList.remove('f');
    }
    function check() {
      if (locked) return; locked = true;
      let ok = true;
      slots.forEach((s, i) => { const good = s._chip._t === c.items[i]; ok = ok && good; setTimeout(() => { s.classList.add(good ? 'ok' : 'bad'); good ? pop(s, 1.03) : shake(s); }, RM() ? 0 : i * 70); });
      setTimeout(() => done(ok, { el: slots[slots.length - 1].parentNode, node: h('ol', { style: { margin: '4px 0 0', paddingLeft: '22px' } }, c.items.map(t => h('li', {}, t))) }), RM() ? 0 : slots.length * 70 + 60);
    }
    return { cls: verse ? 'verse' : '', body: [qText(c), h('div', { class: 'slots' }, slots), h('div', { class: 'pool' }, pool)] };
  },
  match(it, done) {
    const c = it.card;
    const L = shuffle(c.pairs.map(p => p[0])), Rr = shuffle(c.pairs.map(p => p[1]));
    const right = new Map(c.pairs.map(p => [p[0], p[1]]));
    let sel = null, mistakes = 0, left = c.pairs.length;
    const mk = (t, side) => { const b = h('button', { class: 'mi', onclick: () => tap(b) }, t); b._t = t; b._s = side; return b; };
    const lb = L.map(t => mk(t, 0)), rb = Rr.map(t => mk(t, 1));
    function tap(b) {
      if (b.classList.contains('done')) return;
      if (!sel || sel._s === b._s) { if (sel) sel.classList.remove('sel'); sel = b === sel ? null : b; if (sel) { sel.classList.add('sel'); SND.tick(); } return; }
      const a = sel._s === 0 ? sel : b, z = sel._s === 0 ? b : sel; sel.classList.remove('sel'); sel = null;
      if (right.get(a._t) === z._t) {
        a.classList.add('done'); z.classList.add('done'); pop(a, 1.06); pop(z, 1.06); SND.ok(c.pairs.length - left);
        const [x1, y1] = center(a), [x2, y2] = center(z); FX.burst((x1 + x2) / 2, (y1 + y2) / 2, { n: 12, ring: false });
        if (--left === 0) done(mistakes === 0, { el: z, node: h('ul', { style: { margin: '4px 0 0', paddingLeft: '20px' } }, c.pairs.map(p => h('li', {}, `${p[0]} → ${p[1]}`))), note: mistakes ? `${mistakes} hibás párosítás volt.` : null });
      } else {
        mistakes++; a.classList.add('bad'); z.classList.add('bad'); shake(a); shake(z); SND.bad(); buzz(25);
        setTimeout(() => { a.classList.remove('bad'); z.classList.remove('bad'); }, 450);
      }
    }
    return { body: [qText(c), h('div', { class: 'match' }, h('div', { class: 'col' }, lb), h('div', { class: 'col' }, rb))] };
  },
  sort(it, done) {
    const c = it.card;
    const deckItems = shuffle([...c.ca.map(t => [t, 0]), ...c.cb.map(t => [t, 1])]);
    const binA = h('div', { class: 'bin a' }, '◀ ' + c.cats[0], h('small', {}, '0')), binB = h('div', { class: 'bin b' }, c.cats[1] + ' ▶', h('small', {}, '0'));
    const cnt = [0, 0];
    const deck = h('div', { class: 'deck' });
    let idx = 0, mistakes = 0, locked = false, top = null;
    const wrong = [];
    function draw() {
      deck.replaceChildren();
      for (let k = Math.min(deckItems.length - 1, idx + 2); k >= idx; k--) {
        const d = h('div', { class: 'dcard' + (k === idx + 1 ? ' behind' : k === idx + 2 ? ' behind2' : '') }, deckItems[k][0]);
        deck.append(d);
        if (k === idx) { top = d; swipeable(d, { onMove: dx => { binA.classList.toggle('hot', dx < -40); binB.classList.toggle('hot', dx > 40); }, onCommit: dir => decide(dir > 0 ? 1 : 0) }); }
      }
      if (idx < deckItems.length && !RM()) top.animate([{ transform: 'translateY(8px) scale(.95)' }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    }
    function decide(cat) {
      if (locked || idx >= deckItems.length) return; locked = true;
      const [text, right] = deckItems[idx], ok = cat === right, bin = cat ? binB : binA;
      binA.classList.remove('hot'); binB.classList.remove('hot');
      const fly = top.animate([{ transform: top.style.transform || 'none', opacity: 1 }, { transform: `translate(${cat ? 120 : -120}px,-70px) rotate(${cat ? 18 : -18}deg) scale(.4)`, opacity: 0 }], { duration: RM() ? 1 : 260, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
      SND.whoosh();
      fly.onfinish = () => {
        cnt[cat]++; bin.lastChild.textContent = cnt[cat];
        if (ok) { pop(bin, 1.12); SND.tick(); } else { mistakes++; wrong.push(text); shake(bin); SND.bad(); buzz(25); bin.animate([{ background: 'rgba(255,90,110,.5)' }, { background: '' }], { duration: 500 }); toast(`„${text}” → ${c.cats[right]}`, 1600); }
        idx++; locked = false;
        if (idx >= deckItems.length) { deck.replaceChildren(h('div', { class: 'dcard', style: { opacity: .5 } }, mistakes ? `${mistakes} hiba` : 'Mind a helyén! ✓')); finish(); }
        else draw();
      };
    }
    function finish() {
      done(mistakes === 0, { el: deck, node: h('div', {}, h('div', {}, h('b', {}, c.cats[0] + ': '), c.ca.join(', ')), h('div', { style: { marginTop: '4px' } }, h('b', {}, c.cats[1] + ': '), c.cb.join(', '))), note: mistakes ? `Elrontva: ${wrong.join(', ')}` : null });
    }
    draw();
    return {
      body: [qText(c), h('div', { class: 'sorthead' }, binA, binB), deck],
      foot: h('div', { class: 'sortbtns' }, h('button', { class: 'btn sky', onclick: () => decide(0) }, '◀ ' + c.cats[0]), h('button', { class: 'btn lilac', onclick: () => decide(1) }, c.cats[1] + ' ▶')),
      keys: k => { if (k === 'ArrowLeft') decide(0); if (k === 'ArrowRight') decide(1); }
    };
  },
  flash(it, done) {
    const c = it.card; let flipped = false, locked = false;
    const f = h('div', { class: 'flip' }, h('div', { class: 'inner' }, h('div', { class: 'face' }, h('p', { class: 'q' }, c.q), h('p', { class: 'hint' }, 'gondold végig, aztán koppints')), h('div', { class: 'face bk' }, h('p', { class: 'q' }, c.a))));
    const yes = h('button', { class: 'btn mint', disabled: true, onclick: () => grade(true) }, 'Tudtam ✓'), no = h('button', { class: 'btn coral', disabled: true, onclick: () => grade(false) }, 'Nem ment');
    f.addEventListener('click', () => { if (flipped) return; flipped = true; f.classList.add('on'); yes.disabled = no.disabled = false; SND.page(); });
    function grade(ok) { if (locked) return; locked = true; done(ok, { el: f, ans: c.a }); }
    return { body: [f], foot: h('div', { class: 'grid2' }, no, yes) };
  }
};

// ================= boot =================
document.addEventListener('keydown', e => {
  if (!P || !P.onKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if ((tag === 'input' && !e.target.readOnly) || tag === 'textarea') return;
  if ((e.key === 'Enter' || e.key === ' ') && (tag === 'button' || tag === 'a')) return;
  if (e.key === ' ') e.preventDefault();
  P.onKey(e.key);
});
document.documentElement.classList.toggle('rm', RM());
mq.addEventListener?.('change', () => document.documentElement.classList.toggle('rm', RM()));
addEventListener('pointerdown', () => SND.unlock(), { once: true });
(async () => {
  $('#app').replaceChildren(h('div', { class: 'spin' }));
  for (let k = 0; ; k++) {
    try { await loadLib(); S.profiles = await api('/api/profiles'); break; } catch { await sleep(Math.min(8000, 800 * (k + 1))); }
  }
  if (me()) applyTheme(me().theme);
  render();
  Q.flush();
})();
})();
