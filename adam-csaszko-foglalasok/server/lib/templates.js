'use strict';
/* E-mail texts (Hungarian, informal "te"): customer e-mails and the notification to Bence. */

const SHOP = {
  name: 'Csaszko Barbershop',
  owner: 'Császár Bence',
  address: '8790 Zalaszentgrót, Nefelejts u. 1.',
  phone: '+36 30 735 5077',
  phoneHref: '+36307355077',
  tz: 'Europe/Budapest'
};

const T = {
  greet: 'Szia {name}!',
  confirm_subject: 'Időpontod visszaigazolva – {date}, {time}',
  confirm_intro: 'Visszaigazolom az időpontodat:',
  confirm_outro: 'Ha mégsem tudsz jönni, szólj minél előbb telefonon vagy SMS-ben.',
  decline_subject: 'Időpontkérésed – {date}, {time}',
  decline_intro: 'Köszönöm, hogy időpontot kértél. Erre az időpontra sajnos nem tudlak fogadni:',
  decline_outro: 'Válassz egy másik időpontot a weboldalon, vagy hívj.',
  cancel_subject: 'Időpontod lemondva – {date}, {time}',
  cancel_intro: 'Sajnos le kell mondanom ezt az időpontodat:',
  cancel_outro: 'Válassz egy új időpontot a weboldalon, vagy hívj. Bocs a kellemetlenségért.',
  sign: 'Üdv,',
  l_service: 'Szolgáltatás', l_when: 'Időpont', l_dur: 'Időtartam', l_price: 'Ár', l_addr: 'Cím', l_phone: 'Telefon', l_msg: 'Üzenet',
  minutes: 'kb. {n} perc', web: 'Weboldal', ics: 'idopont.ics', cal_hint: 'A csatolt fájllal egy koppintással beteheted a naptáradba.'
};

const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (_, k) => (v[k] != null ? v[k] : ''));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ft = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Ft';

function dateLong(date) {
  const [y, m, d] = date.split('-').map(Number);
  const s = new Intl.DateTimeFormat('hu-HU', { timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    .format(new Date(Date.UTC(y, m - 1, d)));
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = (n) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
const endTime = (b) => fromMin(toMin(b.time) + b.minutes);

/** Offset (minutes) of Europe/Budapest from UTC at a given instant. */
function tzOffset(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: SHOP.tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ms) / 60000;
}
/** Local Budapest wall-clock → UTC timestamp. */
function localToUtc(date, minutes) {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d) + minutes * 60000;
  let utc = guess - tzOffset(guess) * 60000;
  utc = guess - tzOffset(utc) * 60000;
  return utc;
}
const icsStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function icsFold(line) {
  const out = [];
  let cur = '';
  for (const ch of Array.from(line)) {
    if (Buffer.byteLength(cur + ch, 'utf8') > 73) { out.push(cur); cur = ' '; }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}
function ics(b, serviceName) {
  const start = localToUtc(b.date, toMin(b.time));
  const end = start + b.minutes * 60000;
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Csaszko Barbershop//Foglalas//HU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + b.id + '@csaszko',
    'DTSTAMP:' + icsStamp(Date.now()),
    'DTSTART:' + icsStamp(start),
    'DTEND:' + icsStamp(end),
    'SUMMARY:' + icsEsc('Csaszko Barbershop – ' + serviceName),
    'LOCATION:' + icsEsc('Csaszko Barbershop, ' + SHOP.address),
    'DESCRIPTION:' + icsEsc(SHOP.owner + ', ' + SHOP.phone),
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEsc('Csaszko – ' + serviceName), 'TRIGGER:-PT1H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', ''
  ].map(icsFold).join('\r\n');
}

function htmlShell(inner) {
  return '<!doctype html><html><body style="margin:0;padding:0;background:#EDEAE4;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EDEAE4;padding:24px 12px;"><tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:10px;overflow:hidden;">' +
    '<tr><td style="padding:22px 28px;background:#000000;font-family:Arial,Helvetica,sans-serif;color:#F3EEE5;">' +
    '<div style="font-size:22px;font-weight:bold;letter-spacing:1px;">CSASZKO BARBERSHOP</div>' +
    '<div style="height:4px;margin-top:10px;background:#CDA75E;border-radius:2px;"></div></td></tr>' +
    '<tr><td style="padding:24px 28px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#1A1A1A;">' + inner + '</td></tr>' +
    '</table>' +
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#5E5A52;margin-top:14px;">' + esc(SHOP.address) + ' · ' + esc(SHOP.phone) + '</div>' +
    '</td></tr></table></body></html>';
}
function rowsHtml(rows) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:16px 0 18px;border-top:1px solid #E2DED6;">' +
    rows.map(([k, v]) => '<tr><td style="padding:9px 12px 9px 0;border-bottom:1px solid #E2DED6;color:#5E5A52;font-size:14px;white-space:nowrap;vertical-align:top;">' + esc(k) +
      '</td><td style="padding:9px 0;border-bottom:1px solid #E2DED6;font-weight:bold;color:#111111;">' + esc(v).replace(/\n/g, '<br>') + '</td></tr>').join('') +
    '</table>';
}

/** kind: 'confirm' | 'decline' | 'cancel' */
function customerEmail(kind, b, opts) {
  const t = T;
  const service = (b.service && b.service.hu) || '';
  const date = dateLong(b.date);
  const when = date + ', ' + b.time + '–' + endTime(b);
  const v = { name: String(b.name || '').split(' ').slice(-1)[0] || b.name, date, time: b.time };
  const rows = [[t.l_service, service], [t.l_when, when]];
  if (kind === 'confirm') {
    rows.push([t.l_dur, fill(t.minutes, { n: b.minutes })]);
    if (b.service && b.service.price != null) rows.push([t.l_price, ft(b.service.price)]);
    rows.push([t.l_addr, SHOP.address]);
  }
  const message = (opts && opts.message || '').trim();
  const intro = t[kind + '_intro'];
  const outro = t[kind + '_outro'];
  const site = (opts && opts.siteUrl) || '';

  const text = [
    fill(t.greet, v), '', intro, '',
    ...rows.map(([k, val]) => k + ': ' + val),
    ...(message ? ['', t.l_msg + ': ' + message] : []),
    '', outro,
    ...(kind === 'confirm' ? [t.cal_hint] : []),
    '', t.l_phone + ': ' + SHOP.phone,
    ...(site && kind !== 'confirm' ? [t.web + ': ' + site] : []),
    '', t.sign, SHOP.owner, SHOP.name
  ].join('\n');

  const html = htmlShell(
    '<p style="margin:0 0 12px;">' + esc(fill(t.greet, v)) + '</p>' +
    '<p style="margin:0;">' + esc(intro) + '</p>' + rowsHtml(rows) +
    (message ? '<p style="margin:0 0 14px;padding:12px 14px;background:#F3EFE6;border-radius:6px;"><b>' + esc(t.l_msg) + ':</b> ' + esc(message).replace(/\n/g, '<br>') + '</p>' : '') +
    '<p style="margin:0 0 10px;">' + esc(outro) + '</p>' +
    (kind === 'confirm' ? '<p style="margin:0 0 10px;font-size:13px;color:#5E5A52;">' + esc(t.cal_hint) + '</p>' : '') +
    '<p style="margin:0 0 18px;">' + esc(t.l_phone) + ': <a href="tel:' + SHOP.phoneHref + '" style="color:#111111;font-weight:bold;">' + esc(SHOP.phone) + '</a>' +
    (site && kind !== 'confirm' ? '<br><a href="' + esc(site) + '" style="color:#111111;">' + esc(site.replace(/^https?:\/\//, '')) + '</a>' : '') + '</p>' +
    '<p style="margin:0;">' + esc(t.sign) + '<br><b>' + esc(SHOP.owner) + '</b><br><span style="color:#5E5A52;font-size:14px;">' + esc(SHOP.name) + '</span></p>'
  );

  const out = { subject: fill(t[kind + '_subject'], v), text, html, attachments: [] };
  if (kind === 'confirm') out.attachments.push({ filename: t.ics, contentType: 'text/calendar; charset=UTF-8; method=PUBLISH', content: ics(b, service) });
  return out;
}

function adminNotification(b, adminUrl) {
  const date = dateLong(b.date);
  const service = (b.service && b.service.hu) || '';
  const confirmed = b.status === 'confirmed';
  const rows = [
    ['Szolgáltatás', service + (b.service && b.service.price != null ? ' (' + ft(b.service.price) + ')' : '')],
    ['Időpont', date + ', ' + b.time + '–' + endTime(b) + ' (' + b.minutes + ' perc)'],
    ['Név', b.name], ['Telefon', b.phone]
  ];
  if (b.email) rows.push(['E-mail', b.email]);
  if (b.note) rows.push(['Megjegyzés', b.note]);
  const subject = (confirmed ? 'Új foglalás: ' : 'Új időpontkérés: ') + b.name + ' – ' + b.date.replace(/-/g, '.') + '. ' + b.time;
  const action = confirmed ? 'A foglalás automatikusan visszaigazolt. Az appban áthelyezheted vagy lemondhatod:' : 'Elfogadás vagy elutasítás a Csaszko Foglalások appban:';
  const text = [(confirmed ? 'Új foglalás' : 'Új időpontkérés') + ' érkezett a weboldalról:', '', ...rows.map(([k, v]) => k + ': ' + v), '', action, adminUrl || ''].join('\n');
  const html = htmlShell(
    '<p style="margin:0;font-size:18px;"><b>' + (confirmed ? 'Új foglalás' : 'Új időpontkérés') + ' érkezett</b></p>' + rowsHtml(rows) +
    (adminUrl ? '<p style="margin:0;text-align:center;"><a href="' + esc(adminUrl) + '" style="display:inline-block;padding:13px 24px;background:#000000;color:#F3EEE5;text-decoration:none;border-radius:999px;font-weight:bold;">Megnyitás az appban</a></p>' : '') +
    '<p style="margin:16px 0 0;font-size:13px;color:#5E5A52;">' + (confirmed ? '' : 'A vendég csak akkor kap értesítést, amikor elfogadod vagy elutasítod. ') + 'Ha megadott e-mail címet, erre a levélre válaszolva közvetlenül neki írsz.</p>'
  );
  return { subject, text, html };
}

function testEmail() {
  return {
    subject: 'Csaszko Foglalások – teszt e-mail',
    text: 'Ez egy teszt e-mail. Ha megkaptad, az e-mail küldés működik.',
    html: htmlShell('<p style="margin:0 0 10px;"><b>Teszt e-mail</b></p><p style="margin:0;">Ha megkaptad, az e-mail küldés működik.</p>')
  };
}

module.exports = { customerEmail, adminNotification, testEmail, dateLong, localToUtc, SHOP };
