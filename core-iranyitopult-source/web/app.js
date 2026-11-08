/* Zala Studio Irányítópult – client. No dependencies; uses preview.js (shared with zalastudio.hu) for the design previews. */
(function () {
  "use strict";
  var P = window.CorePreview || null;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var nf = new Intl.NumberFormat("hu-HU");
  var num = function (n) { return nf.format(Math.round(n || 0)); };
  var ICON = function (d, cls) { return '<svg class="i ' + (cls || "") + '" viewBox="0 0 24 24">' + d + "</svg>"; };
  var I = {
    phone: '<path d="M5.2 4h3.3l1.7 4.3-2.2 1.5a11 11 0 0 0 6.2 6.2l1.5-2.2 4.3 1.7v3.3a1.6 1.6 0 0 1-1.7 1.6A16.5 16.5 0 0 1 3.6 5.7 1.6 1.6 0 0 1 5.2 4z"/>',
    sms: '<path d="M4 5.5h16v10H9l-5 4z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M4 7l8 6 8-6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
    inbox: '<path d="M4 13l2.5-7.5h11L20 13v5.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z"/><path d="M4 13h4.5l1 2.5h5l1-2.5H20"/>',
    folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2c-.5-.9-1.5-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2s1.1 1.7 2.8 2.1 2.9.9 2.9 2.2-1.3 2.1-2.9 2.1c-1.4 0-2.5-.6-3-1.6M12 6.2v1.6M12 16.2v1.6"/>',
    check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.7c1.6.6 2.7 2.2 3 4.8"/>',
    pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6h5"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
    card: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19M6.5 15h4"/>',
    share: '<path d="M12 3.5v11M7.5 8 12 3.5 16.5 8"/><path d="M5 12.5v5.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.5"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
    receipt: '<path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'
  };

  /* ---------- state ---------- */
  var S = { leads: [], L: null, prices: {}, setup: {}, stats: null, status: null, settings: null, stripe: null, tab: "attekintes", filter: "nyitott", q: "", open: null, known: null };
  // Online payment is switched off for now (also paymentsEnabled in pay.go): every payment part is hidden.
  var PAYMENTS = false;
  var PAY_STATE = { pending: "Fizetésre vár", active: "Aktív előfizetés", past_due: "Sikertelen fizetés", canceling: "Lemondva", canceled: "Megszűnt" };
  var PAY_EVENT = { elindult: "Előfizetés elindult", fizetve: "Befizetés", sikertelen: "Sikertelen levonás", lemondva: "Lemondva, az időszak végén megszűnik", visszavonva: "Lemondás visszavonva", megszunt: "Megszűnt" };
  var RUNNING = function (p) { return !!p && (p.state === "active" || p.state === "past_due" || p.state === "canceling"); };
  var OPEN = function (l) { return l.status !== "megrendelte" && l.status !== "elutasitotta"; };
  var STATUS_ORDER = ["uj", "hivtam", "bemutato", "elkuldve", "megrendelte", "elutasitotta"];
  var STATUS_COLOR = { uj: "var(--blue)", hivtam: "var(--indigo)", bemutato: "var(--orange)", elkuldve: "var(--teal)", megrendelte: "var(--green)", elutasitotta: "var(--gray)" };

  /* ---------- api ---------- */
  function api(path, opts) {
    opts = opts || {};
    var h = { Accept: "application/json" };
    if (opts.method && opts.method !== "GET") { h["X-Core"] = "1"; h["Content-Type"] = "application/json"; }
    return fetch(path, { method: opts.method || "GET", headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: "same-origin" })
      .then(function (r) {
        if (r.status === 401) { location.href = "/login"; throw new Error("auth"); }
        return r.json().catch(function () { return { ok: false }; }).then(function (j) { j._status = r.status; return j; });
      });
  }

  /* ---------- helpers ---------- */
  function ago(iso) {
    var d = new Date(iso), s = (Date.now() - d) / 1000;
    if (s < 60) return "most";
    if (s < 3600) return Math.floor(s / 60) + " perce";
    if (s < 86400) return Math.floor(s / 3600) + " órája";
    var days = Math.floor(s / 86400);
    if (days === 1) return "tegnap";
    if (days < 7) return days + " napja";
    return d.toLocaleDateString("hu-HU", { month: "short", day: "numeric" });
  }
  var fullDate = function (iso) { return new Date(iso).toLocaleString("hu-HU", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); };
  var lab = function (g, k) { return (S.L && S.L[g] && S.L[g][k]) || ""; };
  function avatar(l, big) {
    var color = "var(--tint)", icon = I.users;
    if (P && l.style && P.STYLES[l.style]) color = P.STYLES[l.style].p;
    if (P && l.type && P.TYPES[l.type]) icon = P.IC[P.TYPES[l.type].icon];
    return '<span class="av" style="background:' + color + '">' + ICON(icon) + (!l.seen && !big ? '<i class="new" aria-label="Új"></i>' : "") + "</span>";
  }
  function toast(msg) {
    var t = $("#toast"); t.textContent = msg; t.classList.add("on");
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove("on"); }, 2400);
  }
  function confirmBox(title, text, okLabel) {
    return new Promise(function (resolve) {
      var d = document.createElement("div"); d.className = "alert"; d.setAttribute("role", "alertdialog");
      d.innerHTML = "<div><h4>" + esc(title) + "</h4><p>" + esc(text) + '</p><div class="ab"><button data-v="0">Mégse</button><button data-v="1">' + esc(okLabel) + "</button></div></div>";
      document.body.appendChild(d);
      $("[data-v='0']", d).focus();
      d.addEventListener("click", function (e) {
        var b = e.target.closest("button"); if (!b && e.target !== d) return;
        d.remove(); resolve(!!b && b.getAttribute("data-v") === "1");
      });
    });
  }
  function haptic() { try { navigator.vibrate && navigator.vibrate(8); } catch (e) { /* ignore */ } }

  /* ---------- data loading ---------- */
  function loadLeads(silent) {
    return api("/api/leads").then(function (j) {
      if (!j.ok) return;
      var before = S.known;
      S.leads = j.leads;
      var ids = {}; S.leads.forEach(function (l) { ids[l.id] = 1; });
      if (before && silent) {
        var fresh = S.leads.filter(function (l) { return !before[l.id]; });
        if (fresh.length) toast("Új érdeklődő: " + (fresh[0].business || fresh[0].name));
      }
      S.known = ids;
      updateBadge();
      if (S.open) {
        var o = S.leads.find(function (x) { return x.id === S.open; });
        if (!o) closeSheet();
        else {
          // A webhook changed the payment while the sheet is open: redraw it, unless the user is typing.
          var ps = o.pay ? o.pay.state + o.pay.events.length + o.pay.code : "";
          var ae = document.activeElement;
          if (S.openPay !== undefined && ps !== S.openPay && !(ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))) refreshLead(o);
        }
      }
    });
  }
  function loadStats() { return api("/api/stats").then(function (j) { S.stats = j; }); }
  function loadStatus() { return api("/api/status").then(function (j) { S.status = j.status; }); }
  function loadSettings() { return api("/api/settings").then(function (j) { if (j.ok) { S.settings = j.settings; S.stripe = j.stripe; } }); }
  function updateBadge() {
    var n = S.leads.filter(function (l) { return l.status === "uj"; }).length;
    ["#badgeNew", "#badgeNew2"].forEach(function (id) { var b = $(id); if (b) { b.textContent = n; b.hidden = !n; } });
    document.title = (n ? "(" + n + ") " : "") + "Zala Studio Irányítópult";
  }
  function subline() {
    var parts = [];
    var st = S.status;
    if (st && st.public && st.public.ok !== null) parts.push('<span><i class="dot ' + (st.public.ok ? "g" : "r") + '"></i>' + (st.public.ok ? "Weboldal elérhető" : "Weboldal nem érhető el") + "</span>");
    else if (st && st.site && st.site.ok !== null) parts.push('<span><i class="dot ' + (st.site.ok ? "g" : "r") + '"></i>' + (st.site.ok ? "Weboldal app fut" : "Weboldal app nem válaszol") + "</span>");
    if (S.stats && S.stats.ok) parts.push('<span><i class="dot ' + (S.stats.live ? "live" : "") + '"></i>' + S.stats.live + " látogató most</span>");
    $("#subline").innerHTML = parts.join("") || '<span><i class="dot"></i>Betöltés…</span>';
  }

  /* ---------- stats math ---------- */
  function dayKeys(n) {
    var out = [], d = new Date();
    for (var i = n - 1; i >= 0; i--) {
      var x = new Date(d.getTime() - i * 864e5);
      out.push(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Budapest" }).format(x));
    }
    return out;
  }
  function sum(n) {
    var days = (S.stats && S.stats.days) || {}, keys = dayKeys(n);
    var r = { pv: 0, uv: 0, dev: {}, ref: {}, ev: {}, src: {} };
    keys.forEach(function (k) {
      var d = days[k]; if (!d) return;
      r.pv += d.pv || 0; r.uv += d.uv || 0;
      ["dev", "ref", "ev", "src"].forEach(function (g) { for (var x in (d[g] || {})) r[g][x] = (r[g][x] || 0) + d[g][x]; });
    });
    return r;
  }
  function barsHTML(n) {
    var days = (S.stats && S.stats.days) || {}, keys = dayKeys(n);
    var vals = keys.map(function (k) { return days[k] ? days[k].uv || 0 : 0; });
    var max = Math.max.apply(null, vals.concat([1]));
    var h = '<div class="bars" role="img" aria-label="Napi látogatók, ' + n + ' nap">' + vals.map(function (v, i) {
      var dt = new Date(keys[i] + "T12:00:00").toLocaleDateString("hu-HU", { month: "short", day: "numeric" });
      return '<i style="height:' + Math.max(2, v / max * 100) + "%;animation-delay:" + i * 12 + 'ms" class="' + (i === n - 1 ? "today" : "") + '" data-t="' + esc(dt + ": " + v) + '"></i>';
    }).join("") + "</div>";
    var first = new Date(keys[0] + "T12:00:00").toLocaleDateString("hu-HU", { month: "short", day: "numeric" });
    return h + '<div class="axis"><span>' + first + "</span><span>ma</span></div>";
  }
  function hbars(obj, total, limit, labels) {
    var entries = Object.keys(obj).map(function (k) { return [k, obj[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, limit || 6);
    if (!entries.length) return '<p class="note">Még nincs adat.</p>';
    var max = entries[0][1] || 1, tot = total || entries.reduce(function (s, e) { return s + e[1]; }, 0) || 1;
    return entries.map(function (e, i) {
      return '<div class="hbar"><span>' + esc(labels ? labels[e[0]] || e[0] : e[0]) + "</span><b>" + num(e[1]) + "<small>" + Math.round(e[1] / tot * 100) + '%</small></b><u><i style="width:' + (e[1] / max * 100) + "%;animation-delay:" + i * 60 + 'ms"></i></u></div>';
    }).join("");
  }
  function funnelHTML(r) {
    var steps = [
      ["Látogató", r.uv], ["Megnyitotta a tervezőt", r.ev.cfg_open || 0], ["Típust választott", r.ev.step_name || 0],
      ["Funkciókat választott", r.ev.step_features || 0], ["Stílust választott", r.ev.step_style || 0],
      ["Eljutott az ajánlatig", r.ev.step_contact || 0], ["Elküldte", r.ev.cfg_sent || 0]
    ];
    var max = Math.max(steps[0][1], 1);
    return steps.map(function (s, i) {
      var pct = i === 0 ? "" : "<small>" + (steps[i - 1][1] ? Math.min(100, Math.round(s[1] / steps[i - 1][1] * 100)) : 0) + "%</small>";
      return '<div class="hbar"><span>' + s[0] + "</span><b>" + num(s[1]) + pct + '</b><u><i style="width:' + (s[1] / max * 100) + "%;animation-delay:" + i * 60 + 'ms"></i></u></div>';
    }).join("") + '<p class="note">A százalék az előző lépéshez képest. Ahol nagy az esés, ott akadnak el a látogatók.</p>';
  }

  /* ---------- views ---------- */
  function kpi(color, icon, label, value, subText, action) {
    return "<" + (action ? 'button class="kpi" data-go="' + action + '"' : 'div class="kpi"') + '><div class="h"><span class="sq" style="background:' + color + '">' + ICON(icon) + "</span>" + label + '</div><div class="v">' + value + '</div><div class="s">' + (subText || "&nbsp;") + "</div></" + (action ? "button" : "div") + ">";
  }
  function leadRow(l) {
    var who = [l.name, l.city].filter(Boolean).join(" · ");
    return '<button class="row" data-lead="' + l.id + '">' + avatar(l) + '<span class="t"><b>' + esc(l.business || l.name) + "</b><span>" + esc(who || l.phone || l.email) + "</span></span>" +
      '<span class="r"><small>' + ago(l.created) + "</small>" + rowChip(l) + "</span></button>";
  }
  function rowChip(l) {
    var p = PAYMENTS && l.pay;
    if (p && (p.state === "past_due" || p.state === "pending" || p.state === "canceling")) return '<span class="chip c-pay-' + p.state + '">' + PAY_STATE[p.state] + "</span>";
    return '<span class="chip c-' + l.status + '">' + lab("status", l.status) + "</span>";
  }
  function toBill() {
    var out = [];
    S.leads.forEach(function (l) { ((l.pay && l.pay.events) || []).forEach(function (e) { if (e.kind === "fizetve" && !e.billed) out.push({ l: l, e: e }); }); });
    return out.sort(function (a, b) { return a.e.at < b.e.at ? 1 : -1; });
  }
  function billRow(x) {
    return '<div class="row billrow"><span class="t"><b>' + esc(x.l.business || x.l.name) + "</b><span>" + fullDate(x.e.at) + " · " + num(x.e.amount) + ' Ft</span></span><button class="sbtn small" data-bill="' + x.l.id + "|" + esc(x.e.id) + '">Kiszámlázva</button></div>';
  }
  function viewOverview() {
    var open = S.leads.filter(OPEN), won = S.leads.filter(function (l) { return l.status === "megrendelte"; });
    var nNew = S.leads.filter(function (l) { return l.status === "uj"; }).length;
    var pipe = open.reduce(function (s, l) { return s + (S.prices[l.plan] || 0); }, 0);
    var subs = PAYMENTS ? S.leads.filter(function (l) { return RUNNING(l.pay); }) : [];
    var failing = subs.filter(function (l) { return l.pay.state === "past_due"; });
    var mrr = subs.length ? subs.reduce(function (s, l) { return s + (l.pay.interval === "year" ? Math.round(l.pay.amount / 12) : l.pay.amount); }, 0)
      : won.reduce(function (s, l) { return s + (S.prices[l.plan] || 0); }, 0);
    var r30 = sum(30), r14 = sum(14);
    var conv = r30.uv ? ((r30.ev.cfg_sent || 0) / r30.uv * 100) : 0;
    var h = '<div class="kpis">' +
      kpi("var(--blue)", I.inbox, "Új érdeklődő", num(nNew), nNew ? "Hívd fel őket!" : "Nincs teendő", "uj") +
      kpi("var(--orange)", I.folder, "Folyamatban", num(open.length), "nyitott ügy", "nyitott") +
      kpi("var(--indigo)", I.coin, "Várható havidíj", num(pipe) + "<small>Ft</small>", "ha mind megrendeli", "nyitott") +
      (subs.length ? kpi(failing.length ? "var(--red)" : "var(--green)", I.card, "Havi bevétel", num(mrr) + "<small>Ft</small>", subs.length + " előfizető" + (failing.length ? " · " + failing.length + " sikertelen" : ""), "megrendelte")
        : kpi("var(--green)", I.check, "Megrendelt havidíj", num(mrr) + "<small>Ft</small>", won.length + " ügyfél", "megrendelte")) + "</div>";
    if (failing.length) h += '<div class="hdr"><h2>Sikertelen fizetés</h2></div><div class="list">' + failing.map(leadRow).join("") + "</div>";
    var bill = PAYMENTS ? toBill() : [];
    if (bill.length) h += '<div class="hdr"><h2>Kiszámlázandó</h2><span class="sp"></span><a href="/api/payments.csv" download>Táblázat</a></div><div class="list">' + bill.slice(0, 8).map(billRow).join("") + "</div>" + (bill.length > 8 ? '<p class="note" style="margin:8px 4px 0">És még ' + (bill.length - 8) + " befizetés. A táblázatban mind benne van.</p>" : "");
    h += '<div class="hdr"><h2>Legutóbbi érdeklődők</h2><span class="sp"></span><button data-go="osszes">Összes</button></div>';
    h += S.leads.length ? '<div class="list">' + S.leads.slice(0, 5).map(leadRow).join("") + "</div>"
      : '<div class="card empty"><b>Még nincs érdeklődő</b>Ha valaki kitölti a tervezőt a zalastudio.hu-n, itt jelenik meg, és értesítést is kapsz róla.</div>';
    h += '<div class="cols c2" style="margin-top:12px">';
    h += '<div class="card"><div class="hdr" style="margin:0 0 4px"><h2 style="font-size:17px">Látogatók, 14 nap</h2><span class="sp"></span><span class="note" style="margin:0">' + num(r14.uv) + " fő</span></div>" + (S.stats && S.stats.ok === false ? '<p class="note">' + esc(S.stats.error) + "</p>" : barsHTML(14)) + "</div>";
    h += '<div class="card"><div class="hdr" style="margin:0 0 4px"><h2 style="font-size:17px">Tervező, 30 nap</h2><span class="sp"></span><span class="note" style="margin:0">' + conv.toFixed(1).replace(".", ",") + "% konverzió</span></div>" + funnelHTML(r30) + "</div>";
    h += "</div>";
    return h;
  }
  function filtered() {
    var q = S.q.trim().toLowerCase();
    return S.leads.filter(function (l) {
      if (S.filter === "nyitott" && !OPEN(l)) return false;
      if (S.filter !== "nyitott" && S.filter !== "osszes" && l.status !== S.filter) return false;
      if (!q) return true;
      return [l.business, l.name, l.phone, l.email, l.city, l.note].join(" ").toLowerCase().indexOf(q) > -1;
    });
  }
  function viewLeads() {
    var count = function (f) { return S.leads.filter(f).length; };
    var pills = [["nyitott", "Nyitott", count(OPEN)], ["uj", "Új", count(function (l) { return l.status === "uj"; })], ["bemutato", "Bemutató készül", count(function (l) { return l.status === "bemutato"; })], ["elkuldve", "Elküldve", count(function (l) { return l.status === "elkuldve"; })], ["megrendelte", "Megrendelte", count(function (l) { return l.status === "megrendelte"; })], ["elutasitotta", "Nem kérte", count(function (l) { return l.status === "elutasitotta"; })], ["osszes", "Összes", S.leads.length]];
    var list = filtered();
    var h = '<div class="tools"><div class="pills" role="toolbar" aria-label="Szűrés">' + pills.map(function (p) {
      return '<button class="pill" data-filter="' + p[0] + '" aria-pressed="' + (S.filter === p[0]) + '">' + p[1] + '<span class="n">' + p[2] + "</span></button>";
    }).join("") + '</div><label class="search">' + ICON(I.search) + '<input id="q" type="search" placeholder="Keresés név, telefon…" value="' + esc(S.q) + '" aria-label="Keresés"></label></div>';
    h += '<div id="leadList">' + (list.length ? '<div class="list">' + list.map(leadRow).join("") + "</div>" : '<div class="card empty"><b>Nincs találat</b>' + (S.leads.length ? "Próbálj másik szűrőt." : "Még nem érkezett érdeklődő.") + "</div>") + "</div>";
    return h;
  }
  function viewVisitors() {
    if (!S.stats) return '<div class="card empty">Betöltés…</div>';
    if (S.stats.ok === false) return '<div class="card empty"><b>Nincs statisztika</b>' + esc(S.stats.error) + "</div>";
    var t = sum(1), w = sum(7), m = sum(30);
    var h = '<div class="kpis">' + kpi("var(--green)", I.pulse, "Most az oldalon", num(S.stats.live), "az elmúlt 5 percben") + kpi("var(--tint)", I.users, "Ma", num(t.uv), num(t.pv) + " oldalmegtekintés") + kpi("var(--orange)", I.cal, "7 nap", num(w.uv), num(w.pv) + " megtekintés") + kpi("var(--indigo)", I.cal, "30 nap", num(m.uv), num(m.pv) + " megtekintés") + "</div>";
    h += '<div class="card" style="margin-top:12px"><div class="hdr" style="margin:0 0 4px"><h2 style="font-size:17px">Napi látogatók, 30 nap</h2></div>' + barsHTML(30) + "</div>";
    var refs = m.ref, devs = m.dev;
    var clicks = { "Tervező megnyitva": m.ev.cfg_open || 0, "Előnézetet nézett": m.ev.cfg_preview || 0, "Hívás gomb": m.ev.call || 0, "E-mail gomb": m.ev.mail || 0, "Elküldött kérés": m.ev.cfg_sent || 0 };
    h += '<div class="cols c3" style="margin-top:12px">';
    h += '<div class="card"><h2 style="font-size:17px;margin-bottom:6px">Honnan jöttek</h2>' + hbars(refs, m.uv, 6) + "</div>";
    h += '<div class="card"><h2 style="font-size:17px;margin-bottom:6px">Eszköz</h2>' + hbars(devs, m.uv, 3, { mobil: "Telefon", asztali: "Számítógép", tablet: "Tablet" }) + "</div>";
    h += '<div class="card"><h2 style="font-size:17px;margin-bottom:6px">Kattintások</h2>' + hbars(clicks, 0, 5) + "</div>";
    h += "</div>";
    h += '<div class="cols c2" style="margin-top:12px"><div class="card"><h2 style="font-size:17px;margin-bottom:6px">Tervező tölcsér, 30 nap</h2>' + funnelHTML(m) + "</div>";
    var srcLabels = { hero: "Nyitóoldal gomb", fejlec: "Fejléc gomb", telefon: "Telefon alatti gomb", also: "Alsó sáv", dokk: "Mobil alsó gomb", lablec: "Lábléc", link: "Közvetlen link", "ar-nevjegy": "Ár: Névjegy", "ar-vallalkozas": "Ár: Vállalkozás", "ar-rendeles": "Ár: Rendelés", "ar-premium": "Ár: Prémium" };
    h += '<div class="card"><h2 style="font-size:17px;margin-bottom:6px">Melyik gombbal nyitották meg</h2>' + hbars(m.src, 0, 8, srcLabels) + "</div></div>";
    h += '<p class="note" style="margin:14px 4px 0">A számlálás sütik nélkül működik: a weboldal nem tárol IP-címet, a látogatót csak egy naponta cserélődő, visszafejthetetlen kóddal különbözteti meg.</p>';
    return h;
  }
  function sw(id, on) { return '<span class="sw"><input type="checkbox" id="' + id + '"' + (on ? " checked" : "") + '><i></i></span>'; }
  function viewSettings() {
    var s = S.settings || {}, st = S.status || { site: {}, public: {} };
    var dotc = function (ok) { return ok === null || ok === undefined ? "" : ok ? "g" : "r"; };
    var h = '<div class="lbl">Értesítések a telefonodra (ntfy)</div><div class="set">' +
      '<label class="stack"><span>Téma címe<small>Ugyanaz, amire az ntfy appban feliratkoztál</small></span><input type="url" id="sNtfy" value="' + esc(s.ntfyUrl) + '" placeholder="https://ntfy.sh/…" inputmode="url" autocomplete="off"></label>' +
      '<label class="stack"><span>Hozzáférési token<small>Csak saját ntfy szerverhez kell</small></span><input type="password" id="sToken" value="' + esc(s.ntfyToken) + '" placeholder="nem kötelező" autocomplete="off"></label>' +
      "<label><span>Új érdeklődő<small>Hívás gombbal az értesítésben</small></span>" + sw("sLeads", s.notifyLeads) + "</label>" +
      "<label><span>Ha a weboldal nem érhető el<small>5 percenként ellenőrzi</small></span>" + sw("sDown", s.notifyDown) + "</label>" +
      '</div><div class="btnrow"><button class="btn sec" id="bTest">Próbaértesítés küldése</button></div>';
    var si = S.stripe || {};
    h += '<div class="lbl">Árak</div><div class="set">' +
      '<label><span>Árak a weboldalon<small>' + esc(si.vatNote || "") + '</small></span><select class="selr" id="sVat"><option value="brutto"' + (s.vatMode === "brutto" ? " selected" : "") + '>Bruttó</option><option value="netto"' + (s.vatMode === "netto" ? " selected" : "") + '>Nettó + ÁFA</option><option value="mentes"' + (s.vatMode === "mentes" ? " selected" : "") + ">ÁFA nélkül</option></select></label>" + '</div>';
    if (PAYMENTS) {
    var hk = si.hook || {};
    var site = (s.siteUrl || "https://zalastudio.hu").replace(/\/$/, "");
    h += '<div class="lbl">Fizetés (Stripe)' + (si.keySet ? (si.live ? ' <span class="tag-live">ÉLES</span>' : ' <span class="tag-test">TESZT</span>') : "") + '</div><div class="set">' +
      '<label class="stack"><span>Titkos kulcs<small>Stripe → Fejlesztők → API-kulcsok. Teszteléshez az sk_test_ kezdetűt.</small></span><input type="password" id="sKey" value="' + esc(s.stripeKey) + '" placeholder="sk_test_…" autocomplete="off" spellcheck="false"></label>' +
      '<label class="stack"><span>Webhook aláíró kulcs<small>Webhook végpont: <b class="mono">' + esc(site) + '/stripe/webhook</b></small></span><input type="password" id="sHook" value="' + esc(s.stripeWebhook) + '" placeholder="whsec_…" autocomplete="off" spellcheck="false"></label>' +
      '<label class="stack"><span>Ügyfélportál linkje<small>Stripe → Beállítások → Számlázás → Ügyfélportál. Ide visz a zalastudio.hu/elofizetes.</small></span><input type="url" id="sPortal" value="' + esc(s.portalUrl) + '" placeholder="https://billing.stripe.com/p/login/…" inputmode="url" autocomplete="off"></label>' +
      "<label><span>Értesítés befizetésről és sikertelen fizetésről</span>" + sw("sPay", s.notifyPay) + "</label>" +
      '<div class="stat-li"><i class="dot ' + (hk.at ? (hk.error ? "r" : "g") : "") + '"></i><span>Webhook<small>' + (hk.at ? (hk.error ? esc(hk.error) : "Utoljára: " + esc(hk.type) + " · " + ago(hk.at)) : "Még nem jött üzenet a Stripe-tól") + "</small></span></div>" +
      '</div><div class="btnrow"><button class="btn sec" id="bStripe"' + (si.keySet ? "" : " disabled") + '>Kapcsolat ellenőrzése</button><a class="btn sec" href="/api/payments.csv" download>Befizetések (CSV)</a></div>';
    }
    h += '<div class="lbl">Induló kedvezmény</div><div class="set"><div class="li"><span>Szabad helyek<small>A weboldal ennyit mutat. 0-nál eltűnik a kedvezmény.</small></span><span class="stepper" style="flex:none"><button id="spMinus" aria-label="Kevesebb">−</button><b id="spVal">' + (s.spots ?? 5) + '</b><button id="spPlus" aria-label="Több">+</button></span></div></div>';
    h += '<div class="lbl">Címek</div><div class="set">' +
      '<label class="stack"><span>Weboldal<small>Ezt figyeli az Irányítópult</small></span><input type="url" id="sSite" value="' + esc(s.siteUrl) + '" placeholder="https://zalastudio.hu"></label>' +
      '<label class="stack"><span>Irányítópult címe<small>Ha kívülről is eléred, az értesítés ide visz</small></span><input type="url" id="sDash" value="' + esc(s.dashUrl) + '" placeholder="nem kötelező"></label></div>';
    h += '<div class="lbl">Állapot</div><div class="set">' +
      '<div class="stat-li"><i class="dot ' + dotc(st.public.ok) + '"></i><span>Nyilvános elérés' + (s.siteUrl ? " (" + esc(s.siteUrl.replace(/^https?:\/\//, "")) + ")" : "") + "<small>" + (st.public.ok ? "Elérhető, " + st.public.ms + " ms" : st.public.ok === false ? esc(st.public.error) : "Még nem ellenőrizte") + (st.public.at ? " · " + ago(st.public.at) : "") + "</small></span></div>" +
      '<div class="stat-li"><i class="dot ' + dotc(st.site.ok) + '"></i><span>Zala Studio weboldal app<small>' + (st.site.ok ? "Fut" + (st.site.outbox ? ", " + st.site.outbox + " kérés vár továbbításra" : "") : st.site.ok === false ? esc(st.site.error) : "Még nem ellenőrizte") + "</small></span></div>" +
      '</div><div class="btnrow"><button class="btn sec" id="bCheck">Ellenőrzés most</button></div>';
    h += '<div class="lbl">Adatok</div><div class="btnrow" style="margin-top:0"><a class="btn sec" href="/api/export.csv" download>Táblázat letöltése (CSV)</a><a class="btn sec" href="/api/backup.json" download>Biztonsági mentés</a></div>';
    h += '<div class="lbl">Jelszó</div><div class="set"><label><span>Jelenlegi</span><input type="password" id="pOld" autocomplete="current-password"></label><label><span>Új (min. 8 karakter)</span><input type="password" id="pNew" autocomplete="new-password"></label></div><div class="btnrow"><button class="btn sec" id="bPw">Jelszó módosítása</button></div>';
    h += '<form method="post" action="/logout" style="margin-top:26px"><button class="danger" style="margin-top:0">Kijelentkezés</button></form>';
    h += '<p class="note" style="text-align:center;margin-top:16px">Zala Studio Irányítópult · ' + esc(S.statusVersion || "") + "</p>";
    return h;
  }

  // Signature of what's on screen: polling only redraws when something actually changed.
  function sig() {
    var st = S.stats || {}, ps = (S.status && S.status.public) || {}, ss = (S.status && S.status.site) || {};
    return [S.tab, S.filter, S.leads.map(function (l) { return l.id + l.status + l.updated + (l.seen ? 1 : 0) + (l.pay ? l.pay.state + l.pay.events.length : ""); }).join(","),
      st.live, st.ok, JSON.stringify(st.days || {}).length, ps.ok, ss.ok, ss.outbox].join("|");
  }
  // Quiet redraw from polling: never while the user types, never under an open sheet, no entry animations.
  function softRender() {
    var ae = document.activeElement;
    if (!sheet.hidden || S.tab === "beallitasok" || (ae && $("#main").contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) || sig() === S.lastSig) { subline(); return; }
    render(true);
  }
  function render(quiet) {
    var main = $("#main");
    main.classList.toggle("quiet", !!quiet);
    S.lastSig = sig();
    var titles = { attekintes: "Áttekintés", erdeklodok: "Érdeklődők", latogatok: "Látogatók", beallitasok: "Beállítások" };
    $("#title").textContent = titles[S.tab];
    var html = S.tab === "attekintes" ? viewOverview() : S.tab === "erdeklodok" ? viewLeads() : S.tab === "latogatok" ? viewVisitors() : viewSettings();
    main.innerHTML = '<div class="view">' + html + "</div>";
    subline();
    if (S.tab === "beallitasok") bindSettings();
    if (S.tab === "erdeklodok") {
      var q = $("#q");
      q.addEventListener("input", function () {
        S.q = q.value;
        var list = filtered();
        $("#leadList").innerHTML = list.length ? '<div class="list">' + list.map(leadRow).join("") + "</div>" : '<div class="card empty"><b>Nincs találat</b>Próbálj másik keresést.</div>';
      });
    }
  }

  /* ---------- tabs ---------- */
  function setTab(t, keepScroll) {
    S.tab = t;
    $$("#tabs button, #tabbar button").forEach(function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-tab") === t)); });
    moveKnob();
    render();
    if (!keepScroll) window.scrollTo({ top: 0 });
    try { localStorage.setItem("core-dash-tab", t); } catch (e) { /* ignore */ }
    if (t === "latogatok" || t === "attekintes") loadStats().then(function () { if (S.tab === t) softRender(); });
    if (t === "beallitasok") Promise.all([loadSettings(), loadStatus()]).then(function () { if (S.tab === t && sheet.hidden) render(true); });
  }
  function moveKnob() {
    var b = $('#tabs button[aria-selected="true"]'), k = $("#knob");
    if (b) { k.style.left = b.offsetLeft + "px"; k.style.width = b.offsetWidth + "px"; }
  }
  ["#tabs", "#tabbar"].forEach(function (id) {
    $(id).addEventListener("click", function (e) { var b = e.target.closest("button[data-tab]"); if (b) { haptic(); if (S.tab === b.getAttribute("data-tab")) window.scrollTo({ top: 0, behavior: "smooth" }); else setTab(b.getAttribute("data-tab")); } });
  });
  window.addEventListener("resize", moveKnob);
  window.addEventListener("scroll", function () { $("#nav").classList.toggle("scrolled", window.scrollY > 4); }, { passive: true });

  /* ---------- main clicks ---------- */
  $("#main").addEventListener("click", function (e) {
    var go = e.target.closest("[data-go]");
    if (go) { var f = go.getAttribute("data-go"); S.filter = f === "osszes" ? "osszes" : f; setTab("erdeklodok"); return; }
    var bl = e.target.closest("[data-bill]");
    if (bl) { var parts = bl.getAttribute("data-bill").split("|"); markBilled(parts[0], parts[1], true); return; }
    var fl = e.target.closest("[data-filter]");
    if (fl) { S.filter = fl.getAttribute("data-filter"); haptic(); render(); return; }
    var row = e.target.closest("[data-lead]");
    if (row) openLead(row.getAttribute("data-lead"));
  });

  /* ---------- lead sheet ---------- */
  var sheet = $("#sheet"), scrim = $("#scrim");
  function openSheet(title, html, opts) {
    $("#shTitle").textContent = title;
    $("#shBody").innerHTML = html;
    $("#shBody").scrollTop = 0;
    sheet.hidden = false;
    requestAnimationFrame(function () { sheet.classList.add("on"); scrim.classList.add("on"); });
    document.body.style.overflow = "hidden";
    if (!opts || !opts.noHistory) { try { history.pushState({ sheet: 1 }, "", opts && opts.hash ? opts.hash : "#"); } catch (e) { /* ignore */ } }
    setTimeout(function () { $("#shClose").focus({ preventScroll: true }); }, 60);
  }
  function closeSheet(fromPop) {
    if (sheet.hidden || !sheet.classList.contains("on")) return;
    sheet.classList.remove("on"); scrim.classList.remove("on");
    document.body.style.overflow = "";
    S.open = null;
    setTimeout(function () { if (!sheet.classList.contains("on")) sheet.hidden = true; }, 450);
    if (!fromPop && history.state && history.state.sheet) history.back();
    render(true);
  }
  $("#shClose").addEventListener("click", function () { closeSheet(); });
  scrim.addEventListener("click", function () { closeSheet(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !sheet.hidden && !$(".alert")) closeSheet(); });
  window.addEventListener("popstate", function () { if (!sheet.hidden) closeSheet(true); });

  function telHref(p) { return "tel:" + String(p || "").replace(/[^\d+]/g, ""); }
  function firstName(n) { var p = String(n || "").trim().split(/\s+/); return p.length > 1 ? p[p.length - 1] : p[0] || ""; }
  function leadHTML(l) {
    var t = P && P.TYPES[l.type], st = P && P.STYLES[l.style];
    var hi = firstName(l.name) ? "Szia " + firstName(l.name) + "!" : "Szia!";
    var smsBody = l.demoUrl ? hi + " Elkészült a(z) " + (l.business || "vállalkozásod") + " weboldalának bemutatója: " + l.demoUrl + " – Orosz Ádám, Zala Studio, +36 20 328 2840" : hi + " Orosz Ádám vagyok a Zala Studiótól, a weboldal miatt írok. Mikor tudnánk pár percet beszélni? +36 20 328 2840";
    var mailSubj = "Weboldal bemutató – " + (l.business || l.name);
    var mailBody = hi + "\n\nKöszönöm az érdeklődésed. " + (l.demoUrl ? "Elkészült a bemutató, itt nézheted meg a telefonodon: " + l.demoUrl : "Hamarosan elkészül a bemutató, és elküldöm a linkjét.") + "\n\nÜdv:\nOrosz Ádám\nZala Studio · zalastudio.hu\n+36 20 328 2840";
    var h = '<div class="hero2">' + avatar(l, true) + "<div><h3>" + esc(l.business || l.name) + "</h3><p>" + esc([l.name, l.city].filter(Boolean).join(" · ")) + "</p></div></div>";
    h += '<div class="acts">' +
      '<a class="act" href="' + telHref(l.phone) + '" aria-disabled="' + !l.phone + '">' + ICON(I.phone) + "Hívás</a>" +
      '<a class="act" href="sms:' + String(l.phone || "").replace(/[^\d+]/g, "") + "?&body=" + encodeURIComponent(smsBody) + '" aria-disabled="' + !l.phone + '">' + ICON(I.sms) + "SMS</a>" +
      '<a class="act" href="mailto:' + esc(l.email) + "?subject=" + encodeURIComponent(mailSubj) + "&body=" + encodeURIComponent(mailBody) + '" aria-disabled="' + !l.email + '">' + ICON(I.mail) + "E-mail</a>" +
      '<button class="act" id="aCopy" aria-disabled="' + !(l.phone || l.email) + '">' + ICON(I.copy) + "Másolás</button></div>";
    h += '<div class="stpick" role="group" aria-label="Állapot">' + STATUS_ORDER.map(function (k) {
      return '<button data-st="' + k + '" style="--c:' + STATUS_COLOR[k] + '" aria-pressed="' + (l.status === k) + '">' + lab("status", k) + "</button>";
    }).join("") + "</div>";
    if (PAYMENTS) h += payHTML(l);
    if (l.source === "tervezo" && P) {
      var plan = l.plan || l.recommended;
      h += '<div class="card design"><div class="mini"><div class="scr" id="miniScr"></div></div><div class="planbox"><span class="note" style="margin:0">Ezt tervezte</span><b>' + esc(lab("csomag", plan) || "–") + '</b><div class="p">' + (plan ? num(S.prices[plan]) + " Ft / hó" + (l.billing === "y" ? " · éves fizetés" : "") : "") + "</div>" +
        (l.recommended && l.plan && l.recommended !== l.plan ? '<div class="rec">Az oldal a(z) ' + esc(lab("csomag", l.recommended)) + " csomagot ajánlotta.</div>" : "") +
        (st ? '<div class="rec"><span class="swatch" style="background:' + st.p + '"></span>' + esc(st.label) + "</div>" : "") + "</div></div>";
    }
    h += '<div class="lbl">Válaszok</div><div class="card"><dl class="kv">' +
      (l.phone ? "<dt>Telefon</dt><dd><a href=\"" + telHref(l.phone) + '">' + esc(l.phone) + "</a></dd>" : "") +
      (l.email ? "<dt>E-mail</dt><dd><a href=\"mailto:" + esc(l.email) + '">' + esc(l.email) + "</a></dd>" : "") +
      (l.callTime ? "<dt>Hívható</dt><dd>" + esc(lab("hivhato", l.callTime)) + "</dd>" : "") +
      (t ? "<dt>Típus</dt><dd>" + esc(t.label) + "</dd>" : "") +
      (l.features && l.features.length ? '<dt>Funkciók</dt><dd><span class="tags">' + l.features.map(function (f) { return "<span>" + esc(lab("funkciok", f)) + "</span>"; }).join("") + "</span></dd>" : "") +
      (l.situation ? "<dt>Most</dt><dd>" + esc(lab("helyzet", l.situation)) + "</dd>" : "") +
      (l.link ? "<dt>Link</dt><dd><a href=\"" + esc(/^https?:/.test(l.link) ? l.link : "https://" + l.link) + '" target="_blank" rel="noopener noreferrer">' + esc(l.link) + "</a></dd>" : "") +
      (l.timing ? "<dt>Mikorra</dt><dd>" + esc(lab("mikorra", l.timing)) + "</dd>" : "") +
      "<dt>Beérkezett</dt><dd>" + fullDate(l.created) + "</dd>" +
      "<dt>Honnan</dt><dd>" + (l.source === "kezi" ? "Kézzel felvéve" : l.source === "tervezo" ? "Tervező" + (l.device ? ", " + (l.device === "mobil" ? "telefonról" : "számítógépről") : "") : "Egyszerű űrlap") + "</dd></dl></div>";
    if (l.message) h += '<div class="lbl">Üzenet</div><div class="msg">' + esc(l.message) + "</div>";
    h += '<div class="lbl">Bemutató linkje <em id="demoSaved">Mentve</em></div><div class="inrow"><input class="inp" id="demoUrl" type="url" inputmode="url" placeholder="pl. ' + esc((P ? P.slug(l.business || l.name) : "nev")) + '.admcore.hu" value="' + esc(l.demoUrl) + '"><a class="sbtn" id="demoOpen" style="display:grid;place-items:center" target="_blank" rel="noopener noreferrer" href="' + esc(l.demoUrl ? (/^https?:/.test(l.demoUrl) ? l.demoUrl : "https://" + l.demoUrl) : "#") + '">Megnyitás</a></div>';
    h += '<div class="lbl">Jegyzet <em id="noteSaved">Mentve</em></div><textarea class="inp" id="note" placeholder="Pl. kedden hívni, fotókat küld e-mailben…">' + esc(l.note) + "</textarea>";
    h += '<div class="lbl">Előzmények</div><div class="card"><ul class="timeline">' + (l.history || []).slice().reverse().map(function (x) {
      return '<li><span class="chip c-' + x.status + '">' + lab("status", x.status) + "</span><span>" + fullDate(x.at) + "</span></li>";
    }).join("") + "</ul></div>";
    h += '<button class="danger" id="bDel">Érdeklődő törlése</button>';
    return h;
  }
  function openLead(id, noHistory) {
    var l = S.leads.find(function (x) { return x.id === id; });
    if (!l) return;
    S.open = id;
    S.openPay = l.pay ? l.pay.state + l.pay.events.length + l.pay.code : "";
    openSheet(l.business || l.name, leadHTML(l), { noHistory: noHistory });
    if (P && l.source === "tervezo") {
      var scr = $("#miniScr");
      P.render(scr, { type: l.type || "etterem", biz: l.business, city: l.city, features: l.features, style: l.style || undefined });
    }
    bindLead(l);
    if (!l.seen) api("/api/leads/" + l.id + "/seen", { method: "POST" }).then(function (j) { if (j.ok) { l.seen = true; updateBadge(); } });
  }
  function patch(l, body) {
    return api("/api/leads/" + l.id, { method: "PATCH", body: body }).then(function (j) {
      if (!j.ok) { toast(j.error || "Nem sikerült menteni."); return null; }
      var i = S.leads.findIndex(function (x) { return x.id === l.id; });
      if (i > -1) S.leads[i] = j.lead;
      updateBadge();
      return j.lead;
    });
  }
  function bindLead(l) {
    var body = $("#shBody");
    $$("[data-st]", body).forEach(function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-st"); if (k === l.status) return;
        haptic();
        $$("[data-st]", body).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        patch(l, { status: k }).then(function (n) {
          if (!n) return; l = n; toast(lab("status", k));
          var tl = $(".timeline", body);
          if (tl) tl.innerHTML = (n.history || []).slice().reverse().map(function (x) { return '<li><span class="chip c-' + x.status + '">' + lab("status", x.status) + "</span><span>" + fullDate(x.at) + "</span></li>"; }).join("");
        });
      });
    });
    if (PAYMENTS) bindPay(l);
    var copy = $("#aCopy");
    if (copy) copy.addEventListener("click", function () {
      var txt = [l.name, l.business, l.phone, l.email].filter(Boolean).join("\n");
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast("Kimásolva"); }, function () { toast("A másolás nem támogatott"); });
    });
    var note = $("#note"), nt = null;
    note.addEventListener("input", function () {
      clearTimeout(nt);
      nt = setTimeout(function () { patch(l, { note: note.value }).then(function (n) { if (n) { l = n; flash("#noteSaved"); } }); }, 700);
    });
    var demo = $("#demoUrl");
    demo.addEventListener("change", function () {
      patch(l, { demoUrl: demo.value }).then(function (n) {
        if (!n) return; l = n; flash("#demoSaved");
        var a = $("#demoOpen"); var v = n.demoUrl; a.href = v ? (/^https?:/.test(v) ? v : "https://" + v) : "#";
      });
    });
    $("#demoOpen").addEventListener("click", function (e) { if (!demo.value) { e.preventDefault(); demo.focus(); } });
    $("#bDel").addEventListener("click", function () {
      confirmBox("Törlöd az érdeklődőt?", (l.business || l.name) + " minden adata végleg törlődik. Ezt nem lehet visszavonni.", "Törlés").then(function (ok) {
        if (!ok) return;
        api("/api/leads/" + l.id, { method: "DELETE" }).then(function (j) {
          if (!j.ok) return toast(j.error || "Nem sikerült törölni.");
          S.leads = S.leads.filter(function (x) { return x.id !== l.id; });
          updateBadge(); closeSheet(); toast("Törölve");
        });
      });
    });
  }
  /* ---------- payments ---------- */
  function siteBase() { return ((S.settings && S.settings.siteUrl) || "https://zalastudio.hu").replace(/\/$/, ""); }
  function payLink(p) { return siteBase() + "/fizetes/" + p.code; }
  function suggest(plan, iv) {
    var m = S.prices[plan] || 0, st = S.setup[plan] || [0, 0];
    var f = S.settings && S.settings.vatMode === "netto" ? 1.27 : 1;
    var setup = S.settings && S.settings.spots > 0 ? st[1] : st[0];
    return { amount: Math.round((iv === "year" ? m * 10 : m) * f), setup: Math.round(setup * f) };
  }
  var digits = function (v) { return Number(String(v || "").replace(/[^\d]/g, "")) || 0; };
  function payForm(l) {
    var plan = l.plan || l.recommended || "vallalkozas", iv = l.billing === "y" ? "year" : "month", sg = suggest(plan, iv);
    var opts = ["nevjegy", "vallalkozas", "rendeles", "premium"].map(function (k) { return '<option value="' + k + '"' + (k === plan ? " selected" : "") + ">" + esc(lab("csomag", k)) + "</option>"; }).join("") + '<option value="">Egyedi</option>';
    return '<div class="payform">' +
      '<div class="frow"><label class="fl"><span>Csomag</span><select class="inp sel" id="pyPlan">' + opts + "</select></label>" +
      '<div class="fl"><span>Fizet</span><div class="seg2" role="group" aria-label="Gyakoriság"><button type="button" data-iv="month" aria-pressed="' + (iv === "month") + '">Havonta</button><button type="button" data-iv="year" aria-pressed="' + (iv === "year") + '">Évente</button></div></div></div>' +
      '<div class="frow"><label class="fl"><span id="pyAmtL">Díj (Ft / ' + (iv === "year" ? "év" : "hó") + ')</span><input class="inp" id="pyAmt" inputmode="numeric" autocomplete="off" value="' + num(sg.amount) + '"></label>' +
      '<label class="fl"><span>Egyszeri díj (Ft)</span><input class="inp" id="pySetup" inputmode="numeric" autocomplete="off" value="' + num(sg.setup) + '"></label></div>' +
      '<p class="note" id="pySum"></p>' +
      '<button class="btn" id="pyCreate" style="width:100%">' + ICON(I.link) + "Fizetési link készítése</button></div>";
  }
  function payHTML(l) {
    var p = l.pay, si = S.stripe || {};
    var tag = p ? (p.live ? "" : ' <span class="tag-test">TESZT</span>') : si.keySet && !si.live ? ' <span class="tag-test">TESZT</span>' : "";
    var h = '<div class="lbl">Fizetés' + tag + "</div>";
    if (!p && !si.keySet) return h + '<div class="card"><p class="note" style="margin:0">Add meg a Stripe kulcsot, és itt egy gombnyomással fizetési linket küldhetsz az ügyfélnek. A díjat utána havonta automatikusan levonjuk.</p><div class="btnrow"><button class="btn sec" id="pyGoSet">Beállítások</button></div></div>';
    if (!p || p.state === "canceled") return h + (p ? payStatus(l) : "") + '<div class="card">' + payForm(l) + "</div>";
    return h + payStatus(l);
  }
  function payStatus(l) {
    var p = l.pay, unit = p.interval === "year" ? "év" : "hó";
    var h = '<div class="card paycard"><div class="payhead"><span class="chip c-pay-' + p.state + '">' + PAY_STATE[p.state] + "</span><span class=\"sp\"></span><b>" + num(p.amount) + " Ft</b><small>/ " + unit + "</small></div>";
    if (p.state === "pending") {
      h += '<p class="note">Az ügyfél a linken elfogadja a feltételeket, és megadja a kártyáját. ' + (p.setup ? "Most " + num(p.amount + p.setup) + " Ft-ot fizet (benne " + num(p.setup) + " Ft egyszeri díj), utána " : "Utána ") + (p.interval === "year" ? "évente " : "havonta ") + num(p.amount) + " Ft-ot.</p>" +
        '<div class="paylink"><span>' + esc(payLink(p).replace(/^https?:\/\//, "")) + "</span></div>" +
        '<div class="acts acts4"><button class="act" id="pyCopy">' + ICON(I.copy) + "Másolás</button>" +
        '<a class="act" id="pySms" aria-disabled="' + !l.phone + '">' + ICON(I.sms) + "SMS</a>" +
        '<a class="act" id="pyMail" aria-disabled="' + !l.email + '">' + ICON(I.mail) + "E-mail</a>" +
        '<a class="act" href="' + esc(payLink(p)) + '" target="_blank" rel="noopener">' + ICON(I.open) + "Megnézem</a></div>" +
        '<button class="txtl" id="pyDel">Link visszavonása</button>';
    } else if (p.state !== "canceled") {
      var stripeUrl = "https://dashboard.stripe.com/" + (p.live ? "" : "test/") + "subscriptions/" + encodeURIComponent(p.subscription || "");
      h += '<dl class="kv">' +
        (p.state === "canceling" ? "<dt>Megszűnik</dt><dd>" + (p.cancelAt ? new Date(p.cancelAt).toLocaleDateString("hu-HU") : "az időszak végén") + "</dd>" : p.nextCharge ? "<dt>Következő levonás</dt><dd>" + new Date(p.nextCharge).toLocaleDateString("hu-HU") + "</dd>" : "") +
        "<dt>Eddig befizetve</dt><dd>" + num(p.paid) + " Ft</dd>" +
        (p.consent ? "<dt>Feltételeket elfogadta</dt><dd>" + fullDate(p.consent.split(" · ")[0]) + "</dd>" : "") + "</dl>" +
        '<div class="btnrow">' + (p.subscription ? '<a class="btn sec" href="' + esc(stripeUrl) + '" target="_blank" rel="noopener">' + ICON(I.open) + "Stripe</a>" : "") +
        (p.state === "canceling" ? '<button class="btn sec" id="pyResume">Lemondás visszavonása</button>' : '<button class="btn sec warn" id="pyCancel">Lemondás</button>') + "</div>";
    }
    var ev = (p.events || []).slice().reverse();
    if (ev.length) {
      h += '<ul class="paylog">' + ev.map(function (e) {
        var bill = e.kind === "fizetve" ? '<button class="billchk" data-billed="' + esc(e.id) + '" aria-pressed="' + !!e.billed + '">' + ICON(I.check) + (e.billed ? "Kiszámlázva" : "Számlázandó") + "</button>" : "";
        return '<li class="k-' + e.kind + '"><span><b>' + PAY_EVENT[e.kind] + (e.amount ? " · " + num(e.amount) + " Ft" : "") + "</b><small>" + fullDate(e.at) + (e.url ? ' · <a href="' + esc(e.url) + '" target="_blank" rel="noopener">Nyugta</a>' : "") + "</small></span>" + bill + "</li>";
      }).join("") + "</ul>";
    }
    return h + "</div>";
  }
  function refreshLead(n) {
    var i = S.leads.findIndex(function (x) { return x.id === n.id; });
    if (i > -1) S.leads[i] = n;
    if (S.open === n.id) {
      S.openPay = n.pay ? n.pay.state + n.pay.events.length + n.pay.code : "";
      var top = $("#shBody").scrollTop;
      $("#shBody").innerHTML = leadHTML(n);
      if (P && n.source === "tervezo" && $("#miniScr")) P.render($("#miniScr"), { type: n.type || "etterem", biz: n.business, city: n.city, features: n.features, style: n.style || undefined });
      bindLead(n);
      $("#shBody").scrollTop = top;
    }
  }
  function markBilled(id, evId, billed) {
    api("/api/leads/" + id + "/pay/billed", { method: "POST", body: { id: evId, billed: billed } }).then(function (j) {
      if (!j.ok) return toast("Nem sikerült menteni.");
      refreshLead(j.lead); haptic(); toast(billed ? "Kiszámlázva" : "Visszaállítva");
      if (S.tab === "attekintes" && sheet.hidden) render(true);
    });
  }
  function bindPay(l) {
    var body = $("#shBody"), p = l.pay;
    var go = $("#pyGoSet", body); if (go) go.addEventListener("click", function () { closeSheet(); setTimeout(function () { setTab("beallitasok"); }, 300); });
    var create = $("#pyCreate", body);
    if (create) {
      var iv = l.billing === "y" ? "year" : "month";
      var plan = $("#pyPlan", body), amt = $("#pyAmt", body), setup = $("#pySetup", body), sumEl = $("#pySum", body);
      var paint = function () {
        var a = digits(amt.value), s = digits(setup.value);
        sumEl.textContent = a ? "Az ügyfél most " + num(a + s) + " Ft-ot fizet, utána " + (iv === "year" ? "évente " : "havonta ") + num(a) + " Ft-ot. " + ((S.stripe && S.stripe.vatNote) || "") : "Add meg a díjat.";
      };
      var refill = function () { if (!plan.value) return paint(); var sg = suggest(plan.value, iv); amt.value = num(sg.amount); setup.value = num(sg.setup); paint(); };
      plan.addEventListener("change", refill);
      $$("[data-iv]", body).forEach(function (b) {
        b.addEventListener("click", function () {
          iv = b.getAttribute("data-iv"); haptic();
          $$("[data-iv]", body).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
          $("#pyAmtL", body).textContent = "Díj (Ft / " + (iv === "year" ? "év" : "hó") + ")";
          refill();
        });
      });
      [amt, setup].forEach(function (i) {
        i.addEventListener("input", paint);
        i.addEventListener("blur", function () { var v = digits(i.value); i.value = v ? num(v) : i === setup ? "0" : ""; });
      });
      paint();
      create.addEventListener("click", function () {
        var a = digits(amt.value), s = digits(setup.value);
        if (a < 175) return toast("A díj legalább 175 Ft legyen.");
        create.disabled = true;
        api("/api/leads/" + l.id + "/pay", { method: "POST", body: { plan: plan.value, amount: a, setup: s, interval: iv } }).then(function (j) {
          create.disabled = false;
          if (!j.ok) return toast(j.error || "Nem sikerült.");
          refreshLead(j.lead); haptic(); toast("Kész a link, küldd el az ügyfélnek");
        });
      });
    }
    if (!p) return;
    var link = p.code ? payLink(p) : "", who = l.business || "a weboldal";
    var hi = firstName(l.name) ? "Szia " + firstName(l.name) + "!" : "Szia!";
    var smsTxt = hi + " Itt tudod elindítani a(z) " + who + " előfizetését (" + num(p.amount) + " Ft/" + (p.interval === "year" ? "év" : "hó") + "): " + link + " – Orosz Ádám, Zala Studio, +36 20 328 2840";
    var sms = $("#pySms", body); if (sms) sms.href = "sms:" + String(l.phone || "").replace(/[^\d+]/g, "") + "?&body=" + encodeURIComponent(smsTxt);
    var mail = $("#pyMail", body);
    if (mail) mail.href = "mailto:" + encodeURIComponent(l.email || "") + "?subject=" + encodeURIComponent("Előfizetés indítása – " + who) + "&body=" + encodeURIComponent(hi + "\n\nKöszönöm, hogy minket választottál. Ezen a linken tudod elindítani az előfizetést, bankkártyával, Apple Pay-jel vagy Google Pay-jel:\n" + link + "\n\n" + (p.setup ? "Most " + num(p.amount + p.setup) + " Ft-ot fizetsz (benne az egyszeri beállítás), utána " : "Utána ") + (p.interval === "year" ? "évente " : "havonta ") + num(p.amount) + " Ft-ot vonunk le automatikusan. Minden befizetésről számlát küldünk.\n\nÜdv:\nOrosz Ádám\nZala Studio · zalastudio.hu\n+36 20 328 2840");
    var cp = $("#pyCopy", body);
    if (cp) cp.addEventListener("click", function () {
      var done = function () { haptic(); toast("Link kimásolva"); };
      if (navigator.share && /Mobi|Android|iPhone/i.test(navigator.userAgent)) navigator.share({ title: "Előfizetés – Zala Studio", text: smsTxt, url: link }).catch(function () { /* closed */ });
      else (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(done, function () { toast(link); });
    });
    var del = $("#pyDel", body);
    if (del) del.addEventListener("click", function () {
      confirmBox("Visszavonod a linket?", "A link nem fog működni. Később újat készíthetsz.", "Visszavonás").then(function (ok) {
        if (!ok) return;
        api("/api/leads/" + l.id + "/pay", { method: "DELETE" }).then(function (j) { if (!j.ok) return toast(j.error || "Nem sikerült."); refreshLead(j.lead); toast("Visszavonva"); });
      });
    });
    var cancel = $("#pyCancel", body), resume = $("#pyResume", body);
    var subCall = function (path, msg) {
      return api("/api/leads/" + l.id + "/pay/" + path, { method: "POST" }).then(function (j) { if (!j.ok) return toast(j.error || "Nem sikerült."); refreshLead(j.lead); toast(msg); });
    };
    if (cancel) cancel.addEventListener("click", function () {
      confirmBox("Lemondod az előfizetést?", "A fizetett időszak végéig működik, utána nem vonunk le több díjat. Ezt vissza lehet vonni, amíg meg nem szűnik.", "Lemondás").then(function (ok) { if (ok) subCall("cancel", "Lemondva az időszak végére"); });
    });
    if (resume) resume.addEventListener("click", function () { subCall("resume", "Az előfizetés folytatódik"); });
    $$("[data-billed]", body).forEach(function (b) {
      b.addEventListener("click", function () { markBilled(l.id, b.getAttribute("data-billed"), b.getAttribute("aria-pressed") !== "true"); });
    });
  }
  function flash(sel) { var e = $(sel); if (!e) return; e.classList.add("on"); clearTimeout(e._t); e._t = setTimeout(function () { e.classList.remove("on"); }, 1600); }

  /* ---------- manual lead ---------- */
  $("#btnAdd").addEventListener("click", function () {
    var plans = '<option value="">Csomag (nem kötelező)</option>' + ["nevjegy", "vallalkozas", "rendeles", "premium"].map(function (k) { return '<option value="' + k + '">' + esc(lab("csomag", k)) + " – " + num(S.prices[k]) + " Ft/hó</option>"; }).join("");
    openSheet("Új érdeklődő", '<form class="form" id="addForm" autocomplete="off"><p class="note" style="margin:0 4px 12px">Ha valaki telefonon vagy személyesen keresett, itt veheted fel.</p>' +
      '<input class="inp" name="business" placeholder="Vállalkozás neve" maxlength="120">' +
      '<input class="inp" name="name" placeholder="Kapcsolattartó neve" maxlength="80">' +
      '<input class="inp" name="phone" type="tel" placeholder="Telefonszám" maxlength="40" inputmode="tel">' +
      '<input class="inp" name="email" type="email" placeholder="E-mail" maxlength="120" inputmode="email">' +
      '<input class="inp" name="city" placeholder="Település" maxlength="60">' +
      '<select class="inp sel" name="plan">' + plans + "</select>" +
      '<textarea class="inp" name="note" placeholder="Jegyzet"></textarea>' +
      '<button class="btn" style="width:100%;margin-top:6px">Mentés</button></form>');
    $("#addForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var d = {}; new FormData(e.target).forEach(function (v, k) { d[k] = v; });
      api("/api/leads", { method: "POST", body: d }).then(function (j) {
        if (!j.ok) return toast(j.error || "Nem sikerült menteni.");
        S.leads.unshift(j.lead); S.known[j.lead.id] = 1; updateBadge();
        closeSheet(); toast("Felvéve");
        setTimeout(function () { openLead(j.lead.id); }, 480);
      });
    });
  });

  /* ---------- settings ---------- */
  function saveSetting(body, msg) {
    return api("/api/settings", { method: "PUT", body: body }).then(function (j) {
      if (!j.ok) { toast(j.error || "Nem sikerült menteni."); return; }
      S.settings = j.settings; if (j.stripe) S.stripe = j.stripe;
      toast(j.synced === false ? "Mentve, de a weboldal app most nem érhető el" : msg || "Mentve");
    });
  }
  function bindSettings() {
    var map = { sNtfy: "ntfyUrl", sToken: "ntfyToken", sSite: "siteUrl", sDash: "dashUrl" };
    Object.keys(map).forEach(function (id) {
      var i = $("#" + id); if (!i) return;
      i.addEventListener("change", function () { var b = {}; b[map[id]] = i.value.trim(); saveSetting(b); });
    });
    $("#sLeads").addEventListener("change", function (e) { saveSetting({ notifyLeads: e.target.checked }); });
    if ($("#sPay")) $("#sPay").addEventListener("change", function (e) { saveSetting({ notifyPay: e.target.checked }); });
    [["sKey", "stripeKey"], ["sHook", "stripeWebhook"], ["sPortal", "portalUrl"]].forEach(function (x) {
      var i = $("#" + x[0]); if (!i) return;
      i.addEventListener("change", function () { var b = {}; b[x[1]] = i.value.trim(); saveSetting(b).then(function () { if (S.tab === "beallitasok") render(true); }); });
    });
    $("#sVat").addEventListener("change", function (e) { saveSetting({ vatMode: e.target.value }, "A weboldal árai frissültek").then(function () { if (S.tab === "beallitasok") render(true); }); });
    if ($("#bStripe")) $("#bStripe").addEventListener("click", function () {
      var b = this; b.disabled = true; b.textContent = "Ellenőrzés…";
      api("/api/stripe/test", { method: "POST" }).then(function (j) {
        b.disabled = false; b.textContent = "Kapcsolat ellenőrzése";
        toast(j.ok ? "Kapcsolódva: " + j.name + (j.live ? "" : " (teszt mód)") + (j.live && !j.charges ? " – a fizetés még nincs engedélyezve" : "") : j.error || "Nem sikerült");
      });
    });
    $("#sDown").addEventListener("change", function (e) { saveSetting({ notifyDown: e.target.checked }); });
    var spv = $("#spVal"), spT = null;
    var setSp = function (d) {
      var v = Math.max(0, Math.min(99, Number(spv.textContent) + d)); spv.textContent = v; haptic();
      clearTimeout(spT); spT = setTimeout(function () { saveSetting({ spots: v }, v ? "A weboldalon: még " + v + " hely" : "A kedvezmény eltűnt a weboldalról"); }, 500);
    };
    $("#spMinus").addEventListener("click", function () { setSp(-1); });
    $("#spPlus").addEventListener("click", function () { setSp(1); });
    $("#bTest").addEventListener("click", function () {
      var b = this; b.disabled = true;
      api("/api/test-ntfy", { method: "POST" }).then(function (j) { b.disabled = false; toast(j.ok ? "Elküldve, nézd meg a telefonod" : j.error || "Nem sikerült"); });
    });
    $("#bCheck").addEventListener("click", function () {
      var b = this; b.disabled = true; b.textContent = "Ellenőrzés…";
      api("/api/check", { method: "POST" }).then(function (j) { S.status = j.status; render(true); });
    });
    $("#bPw").addEventListener("click", function () {
      var o = $("#pOld").value, n = $("#pNew").value;
      if (n.length < 8) return toast("Az új jelszó legalább 8 karakter legyen.");
      api("/api/password", { method: "POST", body: { old: o, new: n } }).then(function (j) {
        toast(j.ok ? "Jelszó módosítva" : j.error || "Nem sikerült");
        if (j.ok) { $("#pOld").value = ""; $("#pNew").value = ""; }
      });
    });
  }

  /* ---------- refresh + polling ---------- */
  function refreshAll(spin) {
    var b = $("#btnRefresh"); if (spin) b.classList.add("spin");
    return Promise.all([loadLeads(true), loadStats(), loadStatus()]).then(function () {
      b.classList.remove("spin");
      softRender();
    }, function () { b.classList.remove("spin"); });
  }
  $("#btnRefresh").addEventListener("click", function () { haptic(); refreshAll(true); });
  setInterval(function () { if (!document.hidden) loadLeads(true).then(softRender); }, 20000);
  setInterval(function () { if (!document.hidden) Promise.all([loadStats(), loadStatus()]).then(softRender); }, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refreshAll(); });

  /* ---------- start ---------- */
  api("/api/me").then(function (j) {
    S.L = j.labels; S.prices = j.prices; S.setup = j.setup || {}; S.statusVersion = j.version;
    var saved = null; try { saved = localStorage.getItem("core-dash-tab"); } catch (e) { /* ignore */ }
    if (saved && ["attekintes", "erdeklodok", "latogatok", "beallitasok"].indexOf(saved) > -1) S.tab = saved;
    return Promise.all([loadLeads(false), loadStats(), loadStatus(), loadSettings()]);
  }).then(function () {
    setTab(S.tab, true);
    var m = location.hash.match(/lead=([0-9a-f-]{36})/i);
    if (m) { try { history.replaceState(null, "", "/"); } catch (e) { /* ignore */ } openLead(m[1].toLowerCase()); }
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveKnob);
})();
