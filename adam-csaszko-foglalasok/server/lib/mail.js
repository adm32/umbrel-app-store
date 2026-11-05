'use strict';
/* Minimal SMTP client (no dependencies).
   Gmail: host smtp.gmail.com, port 465, secure (TLS), user = Gmail address,
   pass = a 16-character Google "app password". */
const tls = require('tls');
const net = require('net');
const crypto = require('crypto');

const clean = (s) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();
const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n');

/** RFC 2047 encoded word(s), split so each stays short. */
function encodeHeader(value) {
  value = clean(value);
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const chars = Array.from(value);
  const parts = [];
  let cur = '';
  for (const ch of chars) {
    if (Buffer.byteLength(cur + ch, 'utf8') > 42) { parts.push(cur); cur = ''; }
    cur += ch;
  }
  if (cur) parts.push(cur);
  return parts.map((p) => '=?UTF-8?B?' + b64(p) + '?=').join('\r\n ');
}

function addr(email, name) {
  email = clean(email);
  return name ? encodeHeader(name) + ' <' + email + '>' : '<' + email + '>';
}

function buildMessage(m) {
  const id = crypto.randomBytes(9).toString('hex');
  const domain = (clean(m.from).split('@')[1] || 'localhost');
  const alt = 'alt-' + id;
  const mix = 'mix-' + id;
  const to = [].concat(m.to).map((t) => addr(t)).join(', ');
  const head = [
    'From: ' + addr(m.from, m.fromName),
    'To: ' + to,
    m.replyTo ? 'Reply-To: ' + addr(m.replyTo) : null,
    'Subject: ' + encodeHeader(m.subject),
    'Date: ' + new Date().toUTCString().replace('GMT', '+0000'),
    'Message-ID: <' + id + '.' + Date.now() + '@' + domain + '>',
    'MIME-Version: 1.0'
  ].filter(Boolean);

  const altBody =
    '--' + alt + '\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + wrap76(b64(m.text || '')) +
    '--' + alt + '\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + wrap76(b64(m.html || '')) +
    '--' + alt + '--\r\n';

  const atts = m.attachments || [];
  if (!atts.length) {
    head.push('Content-Type: multipart/alternative; boundary="' + alt + '"');
    return head.join('\r\n') + '\r\n\r\n' + altBody;
  }
  head.push('Content-Type: multipart/mixed; boundary="' + mix + '"');
  let body = '--' + mix + '\r\nContent-Type: multipart/alternative; boundary="' + alt + '"\r\n\r\n' + altBody;
  for (const a of atts) {
    const name = clean(a.filename).replace(/"/g, '');
    body += '--' + mix + '\r\nContent-Type: ' + a.contentType + '; name="' + name + '"\r\n' +
      'Content-Disposition: attachment; filename="' + name + '"\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
      wrap76(Buffer.from(a.content, 'utf8').toString('base64'));
  }
  body += '--' + mix + '--\r\n';
  return head.join('\r\n') + '\r\n\r\n' + body;
}

/** Turns an SMTP error into a short Hungarian explanation for the admin screen. */
function explain(err) {
  const msg = String(err && err.message || err);
  if (/^SMTP 535|Username and Password not accepted|BadCredentials/i.test(msg)) return 'A Gmail nem fogadta el a belépést – ellenőrizd az e-mail címet és az alkalmazásjelszót.';
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return 'Nem érhető el a levelezőszerver (nincs internet vagy hibás szervernév).';
  if (/ECONNREFUSED|ETIMEDOUT|időtúllépés/i.test(msg)) return 'A levelezőszerver nem válaszol – próbáld újra később.';
  if (/^SMTP 55[0-4]/.test(msg)) return 'A címzett e-mail címe nem létezik vagy elutasította a levelet.';
  return msg.slice(0, 200);
}

function send(cfg, m) {
  return new Promise((resolve, reject) => {
    if (!cfg || !cfg.host || !cfg.user || !cfg.pass) return reject(new Error('Az e-mail küldés nincs beállítva.'));
    const raw = buildMessage(m);
    const rcpts = [].concat(m.to).map(clean);
    const sock = cfg.secure === false
      ? net.connect({ host: cfg.host, port: cfg.port })
      : tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host });
    let buf = '';
    let waiter = null;
    let finished = false;
    const fail = (e) => { if (finished) return; finished = true; sock.destroy(); reject(e); };
    sock.setTimeout(25000, () => fail(new Error('SMTP időtúllépés')));
    sock.on('error', fail);
    sock.on('data', (d) => { buf += d.toString('utf8'); pump(); });
    function pump() {
      if (!waiter) return;
      const lines = buf.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3}(?: |$)/.test(lines[i])) {
          const resp = lines.slice(0, i + 1).join('\n');
          buf = lines.slice(i + 1).join('\r\n');
          const w = waiter; waiter = null; w(resp);
          return;
        }
      }
    }
    const read = () => new Promise((res) => { waiter = res; pump(); });
    async function cmd(line, ok) {
      if (line !== null) sock.write(line + '\r\n');
      const r = await read();
      const last = r.split('\n').pop();
      const code = parseInt(last.slice(0, 3), 10);
      if (ok.indexOf(code) < 0) throw new Error('SMTP ' + code + ': ' + r.replace(/\n/g, ' ').slice(0, 300));
      return r;
    }
    (async () => {
      await cmd(null, [220]);
      await cmd('EHLO csaszko.local', [250]);
      await cmd('AUTH PLAIN ' + Buffer.from('\0' + cfg.user + '\0' + cfg.pass, 'utf8').toString('base64'), [235]);
      await cmd('MAIL FROM:<' + clean(m.from) + '>', [250]);
      for (const r of rcpts) await cmd('RCPT TO:<' + r + '>', [250, 251]);
      await cmd('DATA', [354]);
      const data = raw.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
      await cmd(data + '\r\n.', [250]);
      finished = true;
      sock.end('QUIT\r\n');
      resolve();
    })().catch(fail);
  });
}

module.exports = { send, explain, buildMessage };
