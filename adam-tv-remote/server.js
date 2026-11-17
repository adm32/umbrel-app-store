'use strict';
/*
 * Samsung legacy-TV web remote — single file, zero dependencies.
 * Holds ONE persistent TCP connection to the TV (port 55000) and reuses it,
 * so after the ~7s cold handshake every keypress lands in ~0.2s.
 *
 * Config via env:
 *   TV_HOST  (default 10.0.0.157)   TV IP address
 *   TV_PORT  (default 55000)        legacy remote port
 *   TV_NAME  (default "iPhone Remote")  name shown in the TV's Allow dialog
 *   TV_MAC   (default 0c:89:10:84:7b:df) for Wake-on-LAN power-on
 *   PORT     (default 3000)         web server port
 */
const http = require('http');
const net = require('net');
const dgram = require('dgram');

const CFG = {
  host: process.env.TV_HOST || '10.0.0.157',
  port: parseInt(process.env.TV_PORT || '55000', 10),
  name: process.env.TV_NAME || 'iPhone Remote',
  desc: process.env.TV_DESC || 'remote',
  mac:  process.env.TV_MAC  || '0c:89:10:84:7b:df',
  webPort: parseInt(process.env.PORT || '3000', 10),
};

// ---------- Samsung legacy protocol ----------
function serialize(input, raw) {
  let b = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  if (!raw) b = Buffer.from(b.toString('base64'), 'utf8');
  return Buffer.concat([Buffer.from([b.length & 0xff, 0x00]), b]);
}
function handshakePacket() {
  const payload = Buffer.concat([
    Buffer.from([0x64, 0x00]),
    serialize(CFG.desc), serialize(''), serialize(CFG.name),
  ]);
  return Buffer.concat([Buffer.from([0, 0, 0]), serialize(payload, true)]);
}
function keyPacket(key) {
  const payload = Buffer.concat([Buffer.from([0, 0, 0]), serialize(key)]);
  return Buffer.concat([Buffer.from([0, 0, 0]), serialize(payload, true)]);
}

/*
 * TvConnection: one warm socket, a FIFO of pending commands.
 * Incoming bytes are parsed into frames: [1b][2b nameLen LE][name][2b respLen LE][resp].
 * resp \x64\x00\x01\x00 = access granted, \x00\x00\x00\x00 = control accepted,
 * leading \x0a = "waiting for authorization" (intermediate, ignored),
 * \x64\x00\x00\x00 / leading \x65 = denied/cancelled.
 */
class TvConnection {
  constructor() {
    this.sock = null;
    this.buf = Buffer.alloc(0);
    this.queue = [];          // { resolve, reject, kind }
    this.connecting = null;   // promise while handshaking
    this.state = 'idle';      // idle | connecting | ready | error
    this.lastError = null;
  }

  _reset(err) {
    if (this.sock) { try { this.sock.destroy(); } catch (_) {} }
    this.sock = null;
    this.buf = Buffer.alloc(0);
    this.state = err ? 'error' : 'idle';
    this.lastError = err ? String(err.message || err) : null;
    const pending = this.queue.splice(0);
    pending.forEach(p => p.reject(err || new Error('connection reset')));
    this.connecting = null;
  }

  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    // Parse as many complete frames as are buffered.
    for (;;) {
      if (this.buf.length < 3) return;
      const nameLen = this.buf.readUInt16LE(1);
      if (this.buf.length < 3 + nameLen + 2) return;
      const respLen = this.buf.readUInt16LE(3 + nameLen);
      const frameEnd = 3 + nameLen + 2 + respLen;
      if (this.buf.length < frameEnd) return;
      const resp = this.buf.slice(3 + nameLen + 2, frameEnd);
      this.buf = this.buf.slice(frameEnd);
      this._handleResp(resp);
    }
  }

  _handleResp(resp) {
    const head = resp[0];
    if (head === 0x0a) return;                 // waiting for authorization — intermediate
    const head4 = resp.toString('hex');
    const denied = head4 === '64000000' || head === 0x65;
    const granted = head4 === '64000100';
    const accepted = head4 === '00000000';
    const job = this.queue[0];
    if (!job) return;
    if (denied) {
      this.queue.shift();
      job.reject(new Error('TV denied authorization — press Allow on the TV'));
      this._reset(new Error('authorization denied'));
      return;
    }
    if (job.kind === 'handshake' && granted) {
      this.queue.shift(); this.state = 'ready'; job.resolve();
      return;
    }
    if (job.kind === 'key' && (accepted || granted)) {
      this.queue.shift(); job.resolve();
      return;
    }
  }

  connect() {
    if (this.state === 'ready' && this.sock) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.state = 'connecting';
    this.connecting = new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: CFG.host, port: CFG.port });
      this.sock = sock;
      sock.setTimeout(15000);
      sock.on('connect', () => {
        this.queue.push({ resolve, reject, kind: 'handshake' });
        sock.write(handshakePacket());
      });
      sock.on('data', d => this._onData(d));
      sock.on('timeout', () => this._reset(new Error('TV connection timed out')));
      sock.on('error', e => this._reset(e));
      sock.on('close', () => { if (this.state !== 'error') this._reset(new Error('connection closed')); });
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async sendKey(key) {
    if (!/^KEY_[A-Z0-9_]+$/.test(key)) throw new Error('invalid key');
    await this.connect();
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('key timed out')), 10000);
      this.queue.push({
        resolve: () => { clearTimeout(to); resolve(); },
        reject: e => { clearTimeout(to); reject(e); },
        kind: 'key',
      });
      try { this.sock.write(keyPacket(key)); }
      catch (e) { clearTimeout(to); reject(e); }
    });
  }
}
const tv = new TvConnection();

// ---------- Wake-on-LAN (power on) ----------
// Sends the magic packet as a UNICAST to the TV's last-known IP (this leaves a
// bridged Docker container, e.g. on Umbrel) and as a broadcast (best effort for
// host-networked setups). Ports 9 and 7 are both standard WoL ports.
function wakeOnLan(mac, host) {
  return new Promise((resolve, reject) => {
    const clean = mac.replace(/[^0-9a-fA-F]/g, '');
    if (clean.length !== 12) return reject(new Error('bad MAC'));
    const macBuf = Buffer.from(clean, 'hex');
    const magic = Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(macBuf)]);
    const targets = [];
    for (const p of [9, 7]) {
      targets.push([p, '255.255.255.255']);
      if (host) targets.push([p, host]);
    }
    const s = dgram.createSocket('udp4');
    s.on('error', e => { try { s.close(); } catch (_) {} reject(e); });
    s.bind(() => {
      try { s.setBroadcast(true); } catch (_) {}
      let left = targets.length, unicastErr = null;
      targets.forEach(([p, addr]) => {
        s.send(magic, 0, magic.length, p, addr, err => {
          if (err && addr === host) unicastErr = err; // only the unicast must succeed
          if (--left === 0) { try { s.close(); } catch (_) {} unicastErr ? reject(unicastErr) : resolve(); }
        });
      });
    });
  });
}

// ---------- HTTP server ----------
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && u.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(PAGE);
    }
    if (req.method === 'GET' && u.pathname === '/manifest.webmanifest') {
      res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
      return res.end(MANIFEST);
    }
    if (req.method === 'GET' && u.pathname === '/api/status') {
      return json(res, 200, { state: tv.state, error: tv.lastError, tv: CFG.host });
    }
    if (req.method === 'POST' && u.pathname === '/api/power-on') {
      await wakeOnLan(CFG.mac, CFG.host);
      return json(res, 200, { ok: true, action: 'wol' });
    }
    const m = u.pathname.match(/^\/api\/key\/(KEY_[A-Z0-9_]+)$/);
    if (req.method === 'POST' && m) {
      await tv.sendKey(m[1]);
      return json(res, 200, { ok: true, key: m[1] });
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 502, { ok: false, error: String(e.message || e) });
  }
});
server.listen(CFG.webPort, () => {
  console.log(`TV remote on :${CFG.webPort} -> ${CFG.host}:${CFG.port} (${CFG.name})`);
});

// ---------- Web UI (inlined) ----------
const MANIFEST = JSON.stringify({
  name: 'TV Remote', short_name: 'TV', display: 'standalone',
  background_color: '#0b0d10', theme_color: '#0b0d10', start_url: '/',
  icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
});

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0b0d10">
<title>TV Remote</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icon.svg">
<style>
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;margin:0}
  html,body{height:100%}
  body{
    min-height:100%; color:#eef3fb; position:relative; overflow-x:hidden;
    background:#0a0c10;
    font:600 16px/1.2 -apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",Roboto,sans-serif;
    padding:max(18px,env(safe-area-inset-top)) 16px max(24px,env(safe-area-inset-bottom));
    display:flex; flex-direction:column; align-items:center; gap:16px;
    user-select:none; -webkit-user-select:none;
  }
  .wrap{width:100%;max-width:392px;display:flex;flex-direction:column;gap:15px;z-index:1}
  header{display:flex;align-items:center;justify-content:space-between;padding:0 4px}
  header h1{font-size:18px;font-weight:700;margin:0;letter-spacing:.3px;text-shadow:0 2px 14px rgba(0,0,0,.55)}
  #status{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:rgba(255,255,255,.72);
    background:rgba(255,255,255,.08);backdrop-filter:blur(16px) saturate(160%);-webkit-backdrop-filter:blur(16px) saturate(160%);
    border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:6px 12px;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 4px 14px rgba(0,0,0,.3)}
  #dot{width:9px;height:9px;border-radius:50%;background:#7d8694;transition:.3s}
  #dot.ready{background:#38e08b;box-shadow:0 0 10px #38e08b}
  #dot.connecting{background:#ffd23f;animation:pulse 1s infinite}
  #dot.error{background:#ff5a5f;box-shadow:0 0 10px #ff5a5f}
  @keyframes pulse{50%{opacity:.3}}
  .row{display:flex;gap:12px}
  .grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}

  /* ----- the liquid glass ----- */
  button{
    position:relative; color:#f2f6fd; border:0; cursor:pointer; overflow:hidden;
    font:700 15px/1 -apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif;
    min-height:60px; border-radius:24px;
    display:flex; align-items:center; justify-content:center; touch-action:manipulation;
    background:linear-gradient(158deg,rgba(255,255,255,.19),rgba(255,255,255,.055));
    backdrop-filter:blur(22px) saturate(165%); -webkit-backdrop-filter:blur(22px) saturate(165%);
    box-shadow:
      inset 0 1px 1px rgba(255,255,255,.5),
      inset 0 -8px 16px rgba(255,255,255,.04),
      inset 0 0 0 1px rgba(255,255,255,.12),
      0 10px 26px rgba(0,0,0,.42),
      0 2px 6px rgba(0,0,0,.35);
    transition:transform .11s cubic-bezier(.2,.9,.25,1), box-shadow .18s, background .18s;
  }
  button::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
    background:radial-gradient(130% 80% at 26% -5%,rgba(255,255,255,.5),rgba(255,255,255,0) 54%);
    opacity:.75;mix-blend-mode:screen}
  button:active{transform:scale(.93);
    background:linear-gradient(158deg,rgba(255,255,255,.28),rgba(255,255,255,.1));
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.32),inset 0 2px 10px rgba(0,0,0,.28),0 4px 12px rgba(0,0,0,.4)}
  button.flash{background:linear-gradient(158deg,rgba(96,156,255,.6),rgba(70,120,255,.32));
    box-shadow:inset 0 1px 1px rgba(255,255,255,.55),0 0 26px rgba(90,150,255,.65),0 8px 20px rgba(0,0,0,.4)}
  .ico{width:23px;height:23px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;
    filter:drop-shadow(0 1px 1px rgba(0,0,0,.35))}
  .pill{flex:1}
  .power{background:linear-gradient(158deg,rgba(255,90,95,.3),rgba(255,90,95,.08));color:#ffd7d9}
  .on{background:linear-gradient(158deg,rgba(56,224,139,.32),rgba(56,224,139,.08));color:#d6ffe6;font-weight:800;letter-spacing:1px}
  .muted{color:rgba(255,255,255,.74);font-weight:600}

  /* glass slab base for grouped controls */
  .slab{border-radius:28px;overflow:hidden;
    background:linear-gradient(158deg,rgba(255,255,255,.12),rgba(255,255,255,.04));
    backdrop-filter:blur(22px) saturate(165%);-webkit-backdrop-filter:blur(22px) saturate(165%);
    box-shadow:inset 0 1px 1px rgba(255,255,255,.4),inset 0 0 0 1px rgba(255,255,255,.1),0 12px 28px rgba(0,0,0,.42)}
  .slab button{background:transparent;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;border-radius:0}
  .slab button::before{display:none}
  .slab button:active{transform:none;background:rgba(255,255,255,.14)}

  /* rocker (vol/ch) */
  .rocker{flex:1;display:flex;flex-direction:column}
  .rocker button{min-height:66px;flex:1}
  .rocker .lbl{font-size:10px;color:rgba(255,255,255,.62);text-align:center;padding:5px 0;font-weight:800;letter-spacing:2px}
  .rocker button:first-child{box-shadow:inset 0 -1px 0 rgba(255,255,255,.1)}

  /* dpad as a round glass disc */
  .dpad{position:relative;width:216px;height:216px;margin:4px auto;flex:0 0 auto;border-radius:50%;
    background:linear-gradient(158deg,rgba(255,255,255,.1),rgba(255,255,255,.03));
    backdrop-filter:blur(22px) saturate(165%);-webkit-backdrop-filter:blur(22px) saturate(165%);
    box-shadow:inset 0 1px 2px rgba(255,255,255,.4),inset 0 0 0 1px rgba(255,255,255,.1),0 16px 34px rgba(0,0,0,.46)}
  .dpad button{position:absolute;background:transparent;min-height:0;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none}
  .dpad button::before{display:none}
  .dpad .up{top:6px;left:72px;width:72px;height:74px;border-radius:30px 30px 14px 14px}
  .dpad .down{bottom:6px;left:72px;width:72px;height:74px;border-radius:14px 14px 30px 30px}
  .dpad .left{left:6px;top:71px;width:74px;height:74px;border-radius:30px 14px 14px 30px}
  .dpad .right{right:6px;top:71px;width:74px;height:74px;border-radius:14px 30px 30px 14px}
  .dpad button:active{transform:none;background:rgba(255,255,255,.14)}
  .dpad .ok{left:62px;top:62px;width:92px;height:92px;border-radius:50%;font-weight:800;font-size:16px;z-index:2;
    background:linear-gradient(158deg,rgba(255,255,255,.34),rgba(255,255,255,.12));
    box-shadow:inset 0 1px 2px rgba(255,255,255,.65),inset 0 0 0 1px rgba(255,255,255,.18),0 8px 18px rgba(0,0,0,.42)}
  .dpad .ok::before{content:"";position:absolute;inset:0;border-radius:50%;pointer-events:none;
    background:radial-gradient(120% 80% at 30% 0%,rgba(255,255,255,.55),rgba(255,255,255,0) 55%);mix-blend-mode:screen}
  .dpad .ok:active{transform:scale(.95);background:linear-gradient(158deg,rgba(255,255,255,.42),rgba(255,255,255,.18))}

  /* playback bar */
  .seg{display:grid;grid-template-columns:repeat(3,1fr)}
  .seg button{min-height:62px;box-shadow:inset -1px 0 0 rgba(255,255,255,.07),inset 0 -1px 0 rgba(255,255,255,.07)}

  .numgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  #numpad{display:none}
  #numpad.show{display:grid}
  .toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(18px + env(safe-area-inset-bottom));
    background:rgba(28,32,40,.6);backdrop-filter:blur(20px) saturate(160%);-webkit-backdrop-filter:blur(20px) saturate(160%);
    border:1px solid rgba(255,255,255,.18);color:#eef3fb;padding:10px 16px;border-radius:14px;
    font-size:13px;font-weight:600;opacity:0;transition:.25s;pointer-events:none;max-width:90%;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 10px 30px rgba(0,0,0,.5)}
  .toast.show{opacity:1}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Living Room TV</h1>
    <div id="status"><span id="dot"></span><span id="stxt">—</span></div>
  </header>

  <div class="row">
    <button class="pill power" data-power-off aria-label="Power off">
      <svg class="ico" viewBox="0 0 24 24"><path d="M12 3v9"/><path d="M6.6 6.6a9 9 0 1 0 10.8 0"/></svg>
    </button>
    <button class="pill on" data-power-on aria-label="Power on">ON</button>
    <button class="pill" data-key="KEY_SOURCE">Source</button>
  </div>

  <div class="grid3">
    <button data-key="KEY_MENU">Menu</button>
    <button data-key="KEY_HOME">Home</button>
    <button data-key="KEY_INFO">Info</button>
  </div>

  <div class="dpad">
    <button class="up"    data-key="KEY_UP"    aria-label="Up"><svg class="ico" viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg></button>
    <button class="left"  data-key="KEY_LEFT"  aria-label="Left"><svg class="ico" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
    <button class="ok"    data-key="KEY_ENTER">OK</button>
    <button class="right" data-key="KEY_RIGHT" aria-label="Right"><svg class="ico" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>
    <button class="down"  data-key="KEY_DOWN"  aria-label="Down"><svg class="ico" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>
  </div>

  <div class="grid3">
    <button data-key="KEY_RETURN">Return</button>
    <button data-key="KEY_EXIT">Exit</button>
    <button data-key="KEY_TOOLS">Tools</button>
  </div>

  <div class="row">
    <div class="rocker slab">
      <button data-key="KEY_VOLUP" aria-label="Volume up"><svg class="ico" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
      <div class="lbl">VOL</div>
      <button data-key="KEY_VOLDOWN" aria-label="Volume down"><svg class="ico" viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;gap:10px">
      <button style="flex:1" data-key="KEY_MUTE">
        <svg class="ico" viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>
      </button>
      <button style="flex:1" data-key="KEY_CH_LIST" class="muted">Ch List</button>
    </div>
    <div class="rocker slab">
      <button data-key="KEY_CHUP" aria-label="Channel up"><svg class="ico" viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg></button>
      <div class="lbl">CH</div>
      <button data-key="KEY_CHDOWN" aria-label="Channel down"><svg class="ico" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>
    </div>
  </div>

  <div class="seg slab">
    <button data-key="KEY_REWIND" aria-label="Rewind"><svg class="ico" viewBox="0 0 24 24"><path d="M11 19 2 12l9-7v14zM22 19l-9-7 9-7v14z"/></svg></button>
    <button data-key="KEY_PLAY" aria-label="Play"><svg class="ico" viewBox="0 0 24 24"><path d="M6 4l14 8-14 8V4z"/></svg></button>
    <button data-key="KEY_FF" aria-label="Fast forward"><svg class="ico" viewBox="0 0 24 24"><path d="M13 5l9 7-9 7V5zM2 5l9 7-9 7V5z"/></svg></button>
    <button data-key="KEY_STOP" aria-label="Stop"><svg class="ico" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2"/></svg></button>
    <button data-key="KEY_PAUSE" aria-label="Pause"><svg class="ico" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg></button>
    <button id="numToggle" class="muted">123</button>
  </div>

  <div class="numgrid" id="numpad">
    <button data-key="KEY_1">1</button><button data-key="KEY_2">2</button><button data-key="KEY_3">3</button>
    <button data-key="KEY_4">4</button><button data-key="KEY_5">5</button><button data-key="KEY_6">6</button>
    <button data-key="KEY_7">7</button><button data-key="KEY_8">8</button><button data-key="KEY_9">9</button>
    <button data-key="KEY_PRECH" class="muted">Prev</button><button data-key="KEY_0">0</button><button data-key="KEY_ENTER" class="muted">Enter</button>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const dot = document.getElementById('dot'), stxt = document.getElementById('stxt'), toastEl = document.getElementById('toast');
let toastT;
function toast(msg){ toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>toastEl.classList.remove('show'),1800); }
function setState(s, err){
  dot.className = s;
  stxt.textContent = s==='ready'?'Connected':s==='connecting'?'Connecting…':s==='error'?'Off / unreachable':'Idle';
}
async function poll(){
  try{ const r = await fetch('/api/status'); const j = await r.json(); setState(j.state); }
  catch(_){ setState('error'); }
}
setInterval(poll, 4000); poll();

function buzz(){ if(navigator.vibrate) navigator.vibrate(12); }
async function send(url, btn){
  buzz();
  if(btn){ btn.classList.add('flash'); setTimeout(()=>btn.classList.remove('flash'),150); }
  setState('connecting');
  try{
    const r = await fetch(url, {method:'POST'});
    const j = await r.json();
    if(!j.ok && j.error){ toast(j.error); setState('error'); }
    else { setState('ready'); }
  }catch(e){ toast('No response from server'); setState('error'); }
}

document.body.addEventListener('click', e=>{
  const b = e.target.closest('button'); if(!b) return;
  if(b.dataset.key) send('/api/key/'+b.dataset.key, b);
  else if(b.hasAttribute('data-power-off')) send('/api/key/KEY_POWEROFF', b);
  else if(b.hasAttribute('data-power-on')){ send('/api/power-on', b); toast('Wake signal sent'); }
  else if(b.id==='numToggle') document.getElementById('numpad').classList.toggle('show');
});
</script>
</body>
</html>`;
