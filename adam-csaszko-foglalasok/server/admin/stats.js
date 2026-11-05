/* Csaszko · Foglalások – statistics dashboard (a second view of the same app) */
(function () {
  'use strict';
  var A = window.CsaszkoAdmin;
  if (!A) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = A.esc;
  var view = $('[data-view="stats"]');
  var on = false, days = 30, data = null, loading = false, err = '';
  try { days = +localStorage.getItem('csaszko-stats-days') || 30; } catch (e) {}
  if ([7, 30, 90, 365].indexOf(days) < 0) days = 30;

  var RANGES = [[7, '7 nap'], [30, '30 nap'], [90, '3 hónap'], [365, '1 év']];
  var WD = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];
  var WD_LONG = ['hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat', 'vasárnap'];
  var DEV = { mobile: 'Telefon', tablet: 'Tablet', desktop: 'Számítógép' };
  var CLICKS = [['call', 'Hívás gomb'], ['map', 'Térkép / útvonal'], ['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['next_time', 'Gyors időpont a nyitóképen'], ['gallery', 'Galéria képek']];
  var nf = new Intl.NumberFormat('hu-HU');
  var n = function (x) { return nf.format(x || 0); };

  function d2(d) { var p = d.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function fmt(d, o) { return new Intl.DateTimeFormat('hu-HU', Object.assign({ timeZone: 'UTC' }, o)).format(d2(d)); }

  /* ---------- mode switch ---------- */
  function setMode(next) {
    on = next;
    document.body.classList.toggle('is-stats', on);
    $('[data-mode]').setAttribute('aria-pressed', String(on));
    $('[data-mode-label]').textContent = on ? 'Foglalások' : 'Statisztika';
    $('[data-mode-icon]').innerHTML = on
      ? '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
      : '<path d="M4 20h16M7 16v-5M12 16V6M17 16v-8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
    $('[data-brand-sub]').textContent = on ? 'Statisztika' : 'Foglalások';
    $('[data-tabs]').hidden = on;
    $('[data-fab]').hidden = on;
    document.querySelectorAll('[data-view]').forEach(function (v) { if (on) v.hidden = v !== view; });
    if (on) { $('[data-mail-banner]').hidden = true; render(); reload(); }
    else { view.hidden = true; A.render(); A.load(); }
    window.scrollTo(0, 0);
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-mode]')) return setMode(!on);
    var r = e.target.closest('[data-range]');
    if (r) {
      days = +r.getAttribute('data-range');
      try { localStorage.setItem('csaszko-stats-days', days); } catch (x) {}
      reload();
    }
  });

  function reload(spin) {
    if (spin) { var b = $('[data-refresh]'); b.classList.remove('is-spinning'); void b.offsetWidth; b.classList.add('is-spinning'); }
    loading = true; render();
    return A.api('/api/admin/stats?days=' + days).then(function (d) { data = d; err = ''; })
      .catch(function () { err = 'Nem sikerült betölteni a statisztikát. Újrapróbálom…'; })
      .then(function () { loading = false; render(); });
  }

  /* ---------- pieces ---------- */
  function delta(cur, prev) {
    if (!prev) return '<small class="kpi__d">' + (cur ? 'új időszak' : '&nbsp;') + '</small>';
    var p = Math.round((cur - prev) / prev * 100);
    var cls = p > 0 ? 'up' : p < 0 ? 'down' : '';
    var arrow = p > 0 ? '▲' : p < 0 ? '▼' : '•';
    return '<small class="kpi__d ' + cls + '"><span aria-hidden="true">' + arrow + '</span> ' + (p > 0 ? '+' : '') + p + '% az előzőhöz</small>';
  }
  function kpi(label, value, sub) {
    return '<div class="kpi"><span class="kpi__l">' + esc(label) + '</span><strong class="kpi__v">' + value + '</strong>' + sub + '</div>';
  }
  // horizontal bar list: [label, value] – values labelled directly, one hue
  function bars(rows, opts) {
    opts = opts || {};
    rows = rows.filter(function (r) { return r[1] > 0 || opts.keepZero; });
    if (!rows.length) return '<p class="muted">' + esc(opts.empty || 'Még nincs adat.') + '</p>';
    var total = opts.total || rows.reduce(function (s, r) { return s + r[1]; }, 0);
    var max = Math.max.apply(null, rows.map(function (r) { return r[1]; })) || 1;
    return '<ul class="hbars">' + rows.map(function (r) {
      var pct = total ? Math.round(r[1] / total * 100) : 0;
      var w = Math.max(r[1] ? 2 : 0, r[1] / max * 100);
      return '<li title="' + esc(r[0] + ': ' + n(r[1]) + (opts.noPct ? '' : ' (' + pct + '%)')) + '"><span class="hbars__l">' + esc(r[0]) + '</span>' +
        '<span class="hbars__v">' + n(r[1]) + (opts.noPct ? '' : ' <small>' + pct + '%</small>') + '</span>' +
        '<span class="hbars__t"><i style="width:' + w.toFixed(1) + '%"></i></span></li>';
    }).join('') + '</ul>';
  }
  function sorted(obj, map, limit) {
    var rows = Object.keys(obj || {}).map(function (k) { return [map ? (map[k] || k) : k, obj[k]]; });
    rows.sort(function (a, b) { return b[1] - a[1]; });
    if (limit && rows.length > limit) {
      var rest = rows.slice(limit - 1).reduce(function (s, r) { return s + r[1]; }, 0);
      rows = rows.slice(0, limit - 1).concat([['Egyéb', rest]]);
    }
    return rows;
  }

  // group the daily series into weeks / months for longer ranges
  function buckets() {
    var s = data.series;
    if (days <= 31) return s.map(function (x) { return { from: x.d, to: x.d, v: x.visitors, views: x.views }; });
    var out = [], cur = null;
    s.forEach(function (x) {
      var key = days > 120 ? x.d.slice(0, 7) : Math.floor(s.indexOf(x) / 7);
      if (!cur || cur.key !== key) { cur = { key: key, from: x.d, to: x.d, v: 0, views: 0 }; out.push(cur); }
      cur.to = x.d; cur.v += x.visitors; cur.views += x.views;
    });
    return out;
  }
  function bucketLabel(b, long) {
    if (days > 120) return fmt(b.from, long ? { year: 'numeric', month: 'long' } : { month: 'short' });
    if (b.from === b.to) {
      if (long) return fmt(b.from, { month: 'long', day: 'numeric', weekday: 'long' });
      return days <= 7 ? WD[(d2(b.from).getUTCDay() + 6) % 7] + ' ' + fmt(b.from, { day: 'numeric' }) : fmt(b.from, { day: 'numeric' });
    }
    if (!long) return fmt(b.from, { month: 'short', day: 'numeric' });
    return fmt(b.from, { month: 'short', day: 'numeric' }) + ' – ' + fmt(b.to, { month: 'short', day: 'numeric' });
  }

  /* column chart of visitors – single series, hover/tap tooltip */
  function chart() {
    var box = $('[data-chart]', view);
    if (!box || !data) return;
    var bs = buckets();
    var W = Math.max(280, box.clientWidth), H = 190, L = 30, R = 4, T = 10, B = 24;
    var max = Math.max.apply(null, bs.map(function (b) { return b.v; }));
    if (!max) { box.innerHTML = '<p class="chart-empty">Ebben az időszakban még nem volt látogató.</p>'; return; }
    var raw = Math.max(1, max / 4), mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    var step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
    var top = Math.ceil(max / step) * step;
    var pw = W - L - R, ph = H - T - B, slot = pw / bs.length, gap = Math.max(2, Math.min(8, slot * 0.25)), bw = Math.max(2, slot - gap);
    var y = function (v) { return T + ph - v / top * ph; };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Látogatók ' + esc(RANGES.filter(function (r) { return r[0] === days; })[0][1]) + ' alatt">';
    for (var g = 0; g <= top; g += step) {
      svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(g).toFixed(1) + '" y2="' + y(g).toFixed(1) + '" class="grid' + (g === 0 ? ' grid--base' : '') + '"/>' +
        '<text x="' + (L - 6) + '" y="' + (y(g) + 4).toFixed(1) + '" class="axis" text-anchor="end">' + g + '</text>';
    }
    var minGap = days <= 7 ? 44 : days <= 31 ? 30 : days > 120 ? 40 : 64;
    var every = Math.max(1, Math.ceil(minGap / slot));
    bs.forEach(function (b, i) {
      var x = L + i * slot + gap / 2, h = b.v / top * ph, r = Math.min(4, bw / 2, h);
      if (b.v > 0) {
        var y0 = T + ph, y1 = y0 - h;
        svg += '<path class="bar" data-i="' + i + '" d="M' + x.toFixed(1) + ' ' + y0 + 'V' + (y1 + r).toFixed(1) + 'Q' + x.toFixed(1) + ' ' + y1.toFixed(1) + ' ' + (x + r).toFixed(1) + ' ' + y1.toFixed(1) +
          'H' + (x + bw - r).toFixed(1) + 'Q' + (x + bw).toFixed(1) + ' ' + y1.toFixed(1) + ' ' + (x + bw).toFixed(1) + ' ' + (y1 + r).toFixed(1) + 'V' + y0 + 'Z"/>';
      }
      if (i % every === 0) {
        var lab = bucketLabel(b), cx = x + bw / 2, half = lab.length * 3.3, anchor = 'middle';
        if (cx + half > W - R) { anchor = 'end'; cx = W - R; } else if (cx - half < 0) { anchor = 'start'; cx = 0; }
        svg += '<text x="' + cx.toFixed(1) + '" y="' + (H - 6) + '" class="axis" text-anchor="' + anchor + '">' + esc(lab) + '</text>';
      }
      svg += '<rect class="hit" data-i="' + i + '" x="' + (L + i * slot).toFixed(1) + '" y="' + T + '" width="' + slot.toFixed(1) + '" height="' + ph + '"/>';
    });
    svg += '</svg><div class="tip" data-tip hidden></div>';
    box.innerHTML = svg;
    var tip = $('[data-tip]', box), svgEl = box.querySelector('svg');
    function show(i) {
      var b = bs[i];
      box.querySelectorAll('.bar').forEach(function (p) { p.classList.toggle('is-dim', +p.getAttribute('data-i') !== i); });
      tip.innerHTML = '<strong>' + esc(bucketLabel(b, true)) + '</strong><span>' + n(b.v) + ' látogató</span><span class="muted">' + n(b.views) + ' oldalmegnyitás</span>';
      tip.hidden = false;
      var cx = L + i * slot + slot / 2, tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(W - tw, cx - tw / 2)) + 'px';
      tip.style.top = Math.max(0, y(b.v) - tip.offsetHeight - 10) + 'px';
    }
    function hide() { tip.hidden = true; box.querySelectorAll('.bar').forEach(function (p) { p.classList.remove('is-dim'); }); }
    svgEl.addEventListener('pointermove', function (e) { var h = e.target.closest('.hit'); if (h) show(+h.getAttribute('data-i')); });
    svgEl.addEventListener('pointerdown', function (e) { var h = e.target.closest('.hit'); if (h) show(+h.getAttribute('data-i')); });
    svgEl.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hide(); });
  }

  /* ---------- the page ---------- */
  function render() {
    if (!on) return;
    view.hidden = false;
    var head = '<div class="range" role="group" aria-label="Időszak">' + RANGES.map(function (r) {
      return '<button type="button" data-range="' + r[0] + '" aria-pressed="' + (r[0] === days) + '">' + r[1] + '</button>';
    }).join('') + '</div>';
    if (!data) { view.innerHTML = head + (err ? '<p class="err-line">' + esc(err) + '</p>' : '<p class="muted center">Betöltés…</p>'); return; }
    var t = data.totals, b = data.bookings, ev = t.ev || {};
    var st = b.status || {};
    var period = fmt(data.from, { month: 'long', day: 'numeric' }) + ' – ' + fmt(data.today, { month: 'long', day: 'numeric' });
    var conv = t.visitors ? Math.min(100, Math.round(b.requests / t.visitors * 1000) / 10) : 0;

    var html = head + '<p class="stats-period">' + esc(period) + (loading ? ' · frissítés…' : '') + '</p>' +
      (err ? '<p class="err-line">' + esc(err) + '</p>' : '') +
      '<div class="kpis">' +
        kpi('Látogatók', n(t.visitors), delta(t.visitors, data.prev.visitors)) +
        kpi('Foglalás a weboldalról', n(b.requests), delta(b.requests, b.prevRequests)) +
        kpi('Elfogadva', n(st.confirmed || 0), '<small class="kpi__d">' + (b.requests ? Math.round((st.confirmed || 0) / b.requests * 100) + '% a kérésekből' : '&nbsp;') + '</small>') +
        kpi('Becsült bevétel', n(data.revenue) + ' Ft', '<small class="kpi__d">' + n(data.done) + ' vendég az időszakban</small>') +
      '</div>' +
      '<section class="panel"><h3>Látogatók ' + (days <= 31 ? 'naponta' : days > 120 ? 'havonta' : 'hetente') + '</h3>' +
        '<p>Érintsd meg az oszlopot a részletekért. A következő 7 napra ' + n(data.upcoming) + ' elfogadott foglalás van.</p>' +
        '<div class="chart" data-chart></div>' +
        '<details class="tbl"><summary>Táblázatként</summary><table><thead><tr><th>Időszak</th><th>Látogató</th><th>Megnyitás</th></tr></thead><tbody>' +
          buckets().slice().reverse().map(function (x) { return '<tr><td>' + esc(bucketLabel(x, true)) + '</td><td>' + n(x.v) + '</td><td>' + n(x.views) + '</td></tr>'; }).join('') +
        '</tbody></table></details>' +
      '</section>' +
      '<section class="panel"><h3>Foglalás útja</h3><p>Hányan jutottak el az egyes lépésekig. ' + (t.visitors ? 'A látogatók ' + String(conv).replace('.', ',') + '%-a foglalt.' : '') + '</p>' +
        bars([['Látogató', t.visitors], ['Megnyitotta a foglalást', ev.book_open || 0], ['Szolgáltatást választott', ev.book_service || 0], ['Időpontot választott', ev.book_time || 0], ['Elküldte a foglalást', ev.book_sent || 0]], { keepZero: true, total: t.visitors, noPct: false, empty: 'Még nincs adat.' }) +
      '</section>' +
      '<div class="grid2">' +
        '<section class="panel"><h3>Honnan jöttek</h3>' + bars(sorted(t.ref, null, 6), { empty: 'Még nincs adat.' }) + '</section>' +
        '<section class="panel"><h3>Eszköz</h3>' + bars(sorted(t.dev, DEV)) + '</section>' +
        '<section class="panel"><h3>Kattintások</h3>' + bars(CLICKS.map(function (c) { return [c[1], ev[c[0]] || 0]; }), { noPct: true, empty: 'Még senki nem kattintott ezekre.' }) + '</section>' +
      '</div>' +
      '<div class="grid2">' +
        '<section class="panel"><h3>Legkeresettebb szolgáltatások</h3>' + bars(sorted(b.services, null, 6), { noPct: true, empty: 'Ebben az időszakban nem jött foglalás.' }) + '</section>' +
        '<section class="panel"><h3>Melyik napra foglalnak</h3>' + bars(WD.map(function (w, i) { return [WD_LONG[i], b.weekdays[(i + 1) % 7]]; }), { noPct: true, empty: 'Ebben az időszakban nem jött kérés.' }) + '</section>' +
      '</div>' +
      '<section class="panel"><h3>Kérések állapota</h3>' +
        bars([['Elfogadva', st.confirmed || 0], ['Válaszra vár', st.pending || 0], ['Elutasítva', st.declined || 0], ['Lemondva', st.cancelled || 0]], { total: b.requests }) +
      '</section>' +
      '<p class="stats-note">Anonim statisztika, sütik nélkül: a weboldal nem ment el semmit a látogatókról, csak napi összesítéseket. Egy látogató naponta egyszer számít, a keresőrobotokat a rendszer kiszűri. Az adatok 400 napig maradnak meg.</p>';
    view.innerHTML = html;
    chart();
  }

  var rt;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (on && data) chart(); }, 150); });
  setInterval(function () { if (on && !document.hidden) reload(); }, 60000);

  window.CsaszkoDash = { active: function () { return on; }, reload: reload };
})();
