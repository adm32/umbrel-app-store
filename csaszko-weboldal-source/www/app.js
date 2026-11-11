(function () {
  "use strict";

  /* ---------- content used until (or unless) the booking app answers ---------- */
  var FALLBACK = {
    services: [
      { id: "haj", name: "Hajvágás", note: "", minutes: 40, price: 3500 },
      { id: "rovid", name: "Rövid hajvágás", note: "", minutes: 20, price: 3500 },
      { id: "hajszakall", name: "Haj + szakáll", note: "", minutes: 50, price: 5500 },
      { id: "szakall", name: "Szakálligazítás", note: "", minutes: 20, price: 2000 },
      { id: "gyerek", name: "Gyerek hajvágás", note: "13 éves korig", minutes: 30, price: 3000 }
    ],
    // 0 = vasárnap … 6 = szombat; the second time is the last START time
    hours: { 0: ["15:00", "21:00"], 1: null, 2: ["15:00", "21:00"], 3: ["15:00", "21:00"], 4: ["15:00", "21:00"], 5: ["15:00", "21:00"], 6: ["15:00", "21:00"] },
    stepMinutes: 20,
    autoConfirm: false,
    sameDay: false                  // false: online booking starts tomorrow
  };
  // Photos of cuts: { src: "img/vagas-1.webp", alt: "Skin fade oldalról" }. The section stays hidden while empty.
  var GALLERY = [];
  var DAYS_SHOWN = 14, LEAD = 30;
  var PREVIEW = false;              // true only in the shareable preview copy, where nothing can be sent
  var PHONE = "+36 30 735 5077";

  var WD = ["vasárnap", "hétfő", "kedd", "szerda", "csütörtök", "péntek", "szombat"];
  var WD_SHORT = ["V", "H", "K", "Sze", "Cs", "P", "Szo"];
  var ON_DAY = ["vasárnap", "hétfőn", "kedden", "szerdán", "csütörtökön", "pénteken", "szombaton"];
  var MON = ["jan.", "febr.", "márc.", "ápr.", "máj.", "jún.", "júl.", "aug.", "szept.", "okt.", "nov.", "dec."];
  var ORDER = [1, 2, 3, 4, 5, 6, 0];
  var $ = function (s) { return document.querySelector(s); };

  var cfg = JSON.parse(JSON.stringify(FALLBACK));
  var live = false;                 // true once the booking app answered
  var lastDay = null;               // last bookable day according to the app
  var avail = {};                   // service id -> { days: { "2026-11-10": ["15:00", …] } }
  var sel = { svc: null, day: null, time: null };
  var startedAt = 0, opened = false, sending = false;

  function ft(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " Ft"; }
  function toMin(t) { var p = t.split(":"); return +p[0] * 60 + +p[1]; }
  function hm(m) { return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // date and time in Budapest, whatever the visitor's own time zone is
  function now() {
    var p = {};
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return { day: p.year + "-" + p.month + "-" + p.day, min: (+p.hour % 24) * 60 + (+p.minute) };
  }
  function dobj(k) { return new Date(k + "T00:00:00Z"); }
  function addDays(k, n) { return new Date(dobj(k).getTime() + n * 86400000).toISOString().slice(0, 10); }
  function wd(k) { return dobj(k).getUTCDay(); }
  function hoursOf(k) { return cfg.hours[wd(k)] || null; }
  function dayLabel(k) { var d = dobj(k); return WD[d.getUTCDay()] + ", " + MON[d.getUTCMonth()] + " " + d.getUTCDate() + "."; }
  function firstOffset() { return cfg.sameDay ? 0 : 1; }
  function svc(id) { return cfg.services.filter(function (s) { return s.id === id; })[0] || null; }

  /* ---------- stats (only when the booking app is there; anonymous, no cookies) ---------- */
  function hit(body) {
    if (!live) return;
    try { fetch("/api/hit", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(function () {}); } catch (e) {}
  }
  var sentEv = {};
  function ev(name, once) { if (once && sentEv[name]) return; sentEv[name] = 1; hit({ t: "event", e: name }); }
  document.addEventListener("click", function (e) { var a = e.target.closest("[data-ev]"); if (a) ev(a.getAttribute("data-ev"), a.getAttribute("data-ev") === "book_open"); });

  /* ---------- api ---------- */
  function getJSON(url, ms) {
    var ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 5000);
    return fetch(url, { cache: "no-store", signal: ctl ? ctl.signal : undefined }).then(function (r) {
      clearTimeout(t);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }, function (e) { clearTimeout(t); throw e; });
  }
  function loadAvail(id) {
    return getJSON("/api/availability?service=" + encodeURIComponent(id) + "&days=" + (DAYS_SHOWN + 1), 6000).then(function (d) {
      avail[id] = { days: d.days || {} };
      if (d.lastDay) lastDay = d.lastDay;
      return avail[id];
    });
  }

  /* ---------- slots ---------- */
  function slotsFor(k, id) {
    var s = svc(id);
    if (!s || !hoursOf(k)) return [];
    if (live) return (avail[id] && avail[id].days[k]) || [];
    var h = hoursOf(k), n = now(), out = [];
    if (k <= n.day && !cfg.sameDay) return [];
    for (var m = toMin(h[0]); m <= toMin(h[1]); m += cfg.stepMinutes || 20) {
      if (k === n.day && m < n.min + LEAD) continue;
      out.push(hm(m));
    }
    return out;
  }

  /* ---------- static parts that follow the app's settings ---------- */
  function renderBoard() {
    $("#board").innerHTML = cfg.services.map(function (s) {
      var meta = (s.note ? s.note + ", " : "") + s.minutes + " perc";
      return '<li><span class="nm">' + esc(s.name) + "<small>" + esc(meta) + "</small></span>" +
        (s.price == null ? '<span class="pr is-tbd">kérdezd</span>' : '<span class="pr">' + ft(s.price) + "</span>") + "</li>";
    }).join("");
    var first = cfg.services[0];
    if (first) { $("#factPrice").previousElementSibling.textContent = first.name; $("#factPrice").textContent = first.price == null ? "kérdezd" : ft(first.price); }
  }

  function renderServices() {
    $("#svcList").innerHTML = cfg.services.map(function (s) {
      return '<label class="opt"><input type="radio" name="svc" value="' + esc(s.id) + '"' + (sel.svc === s.id ? " checked" : "") + "><span>" + esc(s.name) +
        "<small>" + s.minutes + " perc" + (s.price == null ? "" : ", " + ft(s.price)) + (s.note ? ", " + esc(s.note) : "") + "</small></span></label>";
    }).join("");
  }

  function renderWeek() {
    var lasts = {};
    $("#week").innerHTML = ORDER.map(function (d) {
      var h = cfg.hours[d];
      if (h) lasts[h[1]] = 1;
      return '<li data-d="' + d + '"><span>' + cap(WD[d]) + "</span><span>" + (h ? h[0] + " – " + h[1] : "zárva") + "</span></li>";
    }).join("");
    var l = Object.keys(lasts);
    $("#lastStart").textContent = l.length === 1 ? "Az utolsó időpont " + l[0] + "-kor kezdődik." : "A záró időpont az utolsó kezdés.";
    // hero facts: open days as one range when they follow each other and share the same hours
    var open = ORDER.filter(function (d) { return cfg.hours[d]; }), closed = ORDER.filter(function (d) { return !cfg.hours[d]; });
    var facts = document.querySelectorAll(".facts div");
    var same = open.every(function (d) { return cfg.hours[d][0] === cfg.hours[open[0]][0] && cfg.hours[d][1] === cfg.hours[open[0]][1]; });
    var contiguous = open.length && ORDER.indexOf(open[open.length - 1]) - ORDER.indexOf(open[0]) === open.length - 1;
    if (open.length && same) {
      facts[0].querySelector("dt").textContent = open.length === 7 ? "Minden nap" : contiguous ? cap(WD[open[0]]) + " – " + WD[open[open.length - 1]] : open.map(function (d) { return WD_SHORT[d]; }).join(", ");
      facts[0].querySelector("dd").textContent = cfg.hours[open[0]][0] + " – " + cfg.hours[open[0]][1];
    } else {
      facts[0].querySelector("dt").textContent = "Nyitva";
      facts[0].querySelector("dd").textContent = open.length + " nap a héten";
    }
    facts[1].hidden = !closed.length;
    if (closed.length) {
      facts[1].querySelector("dt").textContent = closed.length === 1 ? cap(WD[closed[0]]) : closed.map(function (d) { return cap(WD_SHORT[d]); }).join(", ");
      facts[1].querySelector("dd").textContent = "zárva";
    }
  }

  function status() {
    var n = now(), h = hoursOf(n.day), txt, open = false;
    var nx = addDays(n.day, 1), gap = 1;
    while (!hoursOf(nx) && gap < 8) { nx = addDays(nx, 1); gap++; }
    var nh = hoursOf(nx);
    var when = gap === 1 ? "holnap" : ON_DAY[wd(nx)];
    var next = nh ? when + " " + nh[0] + "-tól nyitva." : "Hívj, és megbeszéljük.";
    if (!h) txt = "Ma zárva, " + next;
    else if (!cfg.sameDay && n.min < toMin(h[0])) txt = "Ma " + h[0] + "-tól nyitva. Online holnaptól foglalhatsz.";
    else if (!cfg.sameDay && n.min <= toMin(h[1])) { txt = "Most nyitva, " + h[1] + "-ig. Online holnaptól foglalhatsz."; open = true; }
    else if (n.min < toMin(h[0])) txt = "Ma " + h[0] + "-tól nyitva, " + h[1] + "-ig foglalhatsz.";
    else if (n.min <= toMin(h[1])) { txt = "Most nyitva, ma még " + h[1] + "-ig foglalhatsz."; open = true; }
    else txt = "Mára zárva, " + next;
    $("#statusText").textContent = txt;
    $("#pole").classList.toggle("is-open", open);
    document.querySelectorAll("#week li").forEach(function (li) { li.classList.toggle("is-today", +li.getAttribute("data-d") === wd(n.day)); });
  }

  /* ---------- hero: next free times for the first service ---------- */
  function renderNext() {
    var s = cfg.services[0], n = now();
    if (!s) { $("#next").hidden = true; return; }
    // the real free times are still on their way: keep what is shown, so the page doesn't jump
    if (live && !avail[s.id]) return;
    for (var i = firstOffset(); i < firstOffset() + DAYS_SHOWN; i++) {
      var k = addDays(n.day, i), slots = slotsFor(k, s.id);
      if (!slots.length) continue;
      $("#nextLabel").textContent = s.name + (i === 0 ? " ma még szabad:" : i === 1 ? " holnap szabad:" : " " + ON_DAY[wd(k)] + " szabad:");
      $("#nextTimes").innerHTML = slots.slice(0, 4).map(function (t) {
        return '<button type="button" data-svc="' + esc(s.id) + '" data-day="' + k + '" data-time="' + t + '">' + t + "</button>";
      }).join("");
      $("#next").hidden = false;
      return;
    }
    $("#next").hidden = true;
  }
  $("#nextTimes").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    ev("next_time"); ev("book_open", true); begin();
    sel.svc = b.dataset.svc; sel.day = b.dataset.day; sel.time = b.dataset.time;
    renderServices(); pickService(sel.svc);
    $("#foglalas").scrollIntoView({ block: "start" });
    $("#fName").focus({ preventScroll: true });
  });

  /* ---------- booking form ---------- */
  var form = $("#book");

  function renderDays() {
    var n = now(), html = "";
    for (var i = firstOffset(); i < firstOffset() + DAYS_SHOWN; i++) {
      var k = addDays(n.day, i), d = dobj(k), open = !!hoursOf(k), later = !!(lastDay && k > lastDay);
      // until the free times for the chosen service have arrived, judge by opening hours only
      var known = sel.svc && (!live || avail[sel.svc]);
      var free = !open || later ? false : known ? slotsFor(k, sel.svc).length > 0 : !(i === 0 && n.min > toMin(hoursOf(k)[1]) - LEAD);
      if (!free && sel.day === k && known) { sel.day = null; sel.time = null; }
      var sub = !open ? "zárva" : later ? "később" : !free ? "betelt" : i === 0 ? "ma" : i === 1 ? "holnap" : d.getUTCDate() === 1 || i === 2 ? MON[d.getUTCMonth()] : "";
      html += '<label class="opt"><input type="radio" name="day" value="' + k + '"' + (free ? "" : " disabled") + (sel.day === k ? " checked" : "") + ">" +
        '<span><span class="wd">' + WD_SHORT[d.getUTCDay()] + "</span><b>" + d.getUTCDate() + "</b><i>" + sub + "</i></span></label>";
    }
    $("#dayList").innerHTML = html;
  }

  function renderTimes() {
    var box = $("#timeList"), hint = $("#timeHint");
    if (!sel.svc || !sel.day) {
      box.innerHTML = ""; hint.hidden = false;
      hint.textContent = !sel.svc ? "Előbb válaszd ki, mit kérsz." : "Válassz napot.";
      return;
    }
    if (live && !avail[sel.svc]) { box.innerHTML = ""; hint.hidden = false; hint.textContent = "Szabad időpontok betöltése…"; return; }
    var slots = slotsFor(sel.day, sel.svc);
    if (sel.time && slots.indexOf(sel.time) === -1) sel.time = null;
    box.innerHTML = slots.map(function (t) {
      return '<label class="opt"><input type="radio" name="time" value="' + t + '"' + (sel.time === t ? " checked" : "") + "><span>" + t + "</span></label>";
    }).join("");
    hint.hidden = slots.length > 0;
    hint.textContent = "Erre a napra már nincs szabad időpont ilyen hosszú vágásra. Válassz másik napot.";
  }

  function summary(msg) {
    var el = $("#summary");
    el.classList.remove("is-ready", "is-error");
    if (msg) { el.textContent = msg; el.classList.add("is-error"); return; }
    var s = svc(sel.svc);
    if (s && sel.day && sel.time) {
      el.innerHTML = "<strong>" + esc(s.name) + "</strong>, " + dayLabel(sel.day) + " <strong>" + sel.time + "–" + hm(toMin(sel.time) + s.minutes) + "</strong>" + (s.price != null ? ", " + ft(s.price) : "") + ".";
      el.classList.add("is-ready");
    } else {
      var miss = [];
      if (!s) miss.push("mit kérsz");
      if (!sel.day) miss.push("melyik nap");
      if (!sel.time) miss.push("hánykor");
      el.textContent = "Válaszd ki, " + miss.join(", ").replace(/, ([^,]*)$/, " és $1") + ".";
    }
  }

  function begin() { if (!startedAt) startedAt = Date.now(); }
  form.addEventListener("focusin", function () { begin(); if (!opened) { opened = true; ev("book_open", true); } });

  function pickService(id) {
    sel.svc = id; ev("book_service", true);
    if (live && !avail[id]) {
      renderDays(); renderTimes(); summary();
      loadAvail(id).then(function () { if (sel.svc === id) { renderDays(); renderTimes(); summary(); } })
        .catch(function () { $("#timeHint").textContent = "Nem sikerült betölteni a szabad időpontokat. Frissítsd az oldalt, vagy hívd Bencét: " + PHONE + "."; });
      return;
    }
    renderDays(); renderTimes(); summary();
  }

  form.addEventListener("change", function (e) {
    var t = e.target;
    if (t.name === "svc") return pickService(t.value);
    if (t.name === "day") { sel.day = t.value; renderTimes(); }
    if (t.name === "time") { sel.time = t.value; ev("book_time", true); }
    if (t.id === "fName" || t.id === "fPhone" || t.id === "fEmail") t.removeAttribute("aria-invalid");
    summary();
  });

  function phoneOk(v) { var d = v.replace(/\D/g, ""); return d.length >= 9 && d.length <= 13; }
  function emailOk(v) { return !v || /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(v); }

  function showDone(status) {
    var s = svc(sel.svc), phone = $("#fPhone").value.trim(), email = $("#fEmail").value.trim();
    var what = "<strong>" + esc(s.name) + "</strong>, " + dayLabel(sel.day) + " <strong>" + sel.time + "–" + hm(toMin(sel.time) + s.minutes) + "</strong>.";
    if (status === "confirmed") {
      $("#doneTitle").textContent = "Lefoglaltad az időpontot";
      $("#doneText").innerHTML = what + " Várlak a Nefelejts utca 1.-ben. A visszaigazolást a " + esc(email) + " címre küldjük. Ha mégsem tudsz jönni, szólj a " + PHONE + " számon.";
    } else {
      $("#doneTitle").textContent = "Foglalás elküldve";
      $("#doneText").innerHTML = what + " Bence hamarosan visszaigazolja e-mailben a " + esc(email) + " címen.";
    }
    $("#doneDemo").hidden = !PREVIEW;
    form.hidden = true;
    var done = $("#done"); done.hidden = false; done.focus({ preventScroll: true }); done.scrollIntoView({ block: "start", behavior: "instant" });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (sending) return;
    renderDays(); renderTimes(); // the clock may have moved on since the page was opened
    var name = $("#fName"), phone = $("#fPhone"), email = $("#fEmail"), err = null, focus = null;
    if (!sel.svc) { err = "Válaszd ki, mit kérsz."; focus = form.querySelector('[name="svc"]'); }
    else if (!sel.day) { err = "Válassz napot."; focus = form.querySelector('[name="day"]:not(:disabled)'); }
    else if (!sel.time) { err = "Válassz időpontot."; focus = form.querySelector('[name="time"]'); }
    else if (name.value.trim().length < 2) { err = "Írd be a neved."; focus = name; name.setAttribute("aria-invalid", "true"); }
    else if (!phoneOk(phone.value)) { err = "Írd be a telefonszámod, hogy Bence el tudjon érni."; focus = phone; phone.setAttribute("aria-invalid", "true"); }
    else if (!email.value.trim()) { err = "Írd be az e-mail címed, ide küldjük a visszaigazolást."; focus = email; email.setAttribute("aria-invalid", "true"); }
    else if (!emailOk(email.value.trim())) { err = "Az e-mail cím hibás. Nézd át, például: nev@gmail.com"; focus = email; email.setAttribute("aria-invalid", "true"); }
    if (err) { summary(err); if (focus) focus.focus(); return; }

    if (PREVIEW) { showDone(cfg.autoConfirm ? "confirmed" : "pending"); return; }

    var btn = $("#submitBtn"); sending = true; btn.disabled = true; btn.textContent = "Küldés…";
    var body = { service: sel.svc, date: sel.day, time: sel.time, name: name.value.trim(), phone: phone.value.trim(), email: email.value.trim(), note: $("#fNote").value.trim(), website: $("#fWeb").value, elapsed: startedAt ? Date.now() - startedAt : 0 };
    fetch("/api/bookings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, d: d }; }); })
      .then(function (r) {
        if (r.status === 201 || r.status === 200) {
          ev("book_sent");
          showDone(r.d.booking && r.d.booking.status);
          // the booked time is gone now: refresh what the hero and the form offer
          var ids = [cfg.services[0].id]; if (ids.indexOf(sel.svc) < 0) ids.push(sel.svc);
          Promise.all(ids.map(loadAvail)).then(renderNext).catch(function () {});
          return;
        }
        if (r.status === 409) {
          sel.time = null;
          summary("Ezt az időpontot közben valaki lefoglalta. Válassz másikat.");
          return loadAvail(sel.svc).then(function () { renderDays(); renderTimes(); renderNext(); }).catch(function () {});
        }
        if (r.status === 429) return summary("Most túl sok foglalás jött erről az eszközről. Hívd Bencét: " + PHONE + ".");
        var f = (r.d && r.d.fields) || {};
        if (f.phone) { phone.setAttribute("aria-invalid", "true"); phone.focus(); return summary("A telefonszám hibás. Írd be így: +36 30 123 4567."); }
        if (f.email) { email.setAttribute("aria-invalid", "true"); email.focus(); return summary("Az e-mail cím hibás. Nézd át, például: nev@gmail.com"); }
        if (f.name) { name.setAttribute("aria-invalid", "true"); name.focus(); return summary("Írd be a neved."); }
        if (r.status >= 500) return summary("Az online foglalás most nem érhető el. Hívd Bencét: " + PHONE + ".");
        summary("Nem sikerült elküldeni a foglalást. Próbáld újra, vagy hívd Bencét: " + PHONE + ".");
      })
      .catch(function () { summary("Nincs kapcsolat. Próbáld újra, vagy hívd Bencét: " + PHONE + "."); })
      .then(function () { sending = false; btn.disabled = false; btn.textContent = "Időpont foglalása"; });
  });

  $("#again").addEventListener("click", function () {
    form.reset(); sel = { svc: null, day: null, time: null }; startedAt = 0;
    renderServices(); renderDays(); renderTimes(); summary();
    $("#done").hidden = true; form.hidden = false;
    renderNext();
    form.querySelector('[name="svc"]').focus();
  });

  /* ---------- gallery ---------- */
  function renderGallery() {
    if (!GALLERY.length) return;
    $("#galleryGrid").innerHTML = GALLERY.map(function (g, i) {
      return '<button type="button" class="gallery__item" data-g="' + i + '"><img src="' + esc(g.src) + '" alt="' + esc(g.alt || "Vágás") + '" loading="lazy" decoding="async"' + (g.w ? ' width="' + g.w + '" height="' + g.h + '"' : "") + "></button>";
    }).join("");
    $("#vagasok").hidden = false;
  }
  var lb = $("#lightbox");
  $("#galleryGrid").addEventListener("click", function (e) {
    var b = e.target.closest("[data-g]"); if (!b) return;
    var g = GALLERY[+b.getAttribute("data-g")];
    openLb(g.full || g.src, g.alt || "Vágás", null, b);
  });
  function openLb(src, alt, post, from) {
    $("#lbImg").src = src; $("#lbImg").alt = alt;
    $("#lbMeta").hidden = !post;
    if (post) { $("#lbCap").textContent = post.caption || ""; $("#lbLink").href = post.link || profile; $("#lbLink").textContent = post.video ? "Videó megnézése az Instagramon ↗" : "Megnyitás az Instagramon ↗"; }
    lb.hidden = false; lb._from = from; $("#lbClose").focus(); ev("gallery");
  }
  function closeLb() { if (lb.hidden) return; lb.hidden = true; $("#lbImg").removeAttribute("src"); if (lb._from) lb._from.focus(); }

  /* ---------- instagram: latest posts, served by the booking app (no requests to Instagram from here) ---------- */
  var profile = $("#instaHandle").href, posts = [];
  function loadInsta() {
    getJSON("/api/instagram", 5000).then(function (d) {
      if (d.user && /^[A-Za-z0-9._]{1,30}$/.test(d.user)) {
        profile = "https://www.instagram.com/" + d.user + "/";
        ["#instaHandle", "#instaCard", "#instaMore"].forEach(function (s) { $(s).href = profile; });
        $("#instaHandle").textContent = "@" + d.user; $("#instaCard small").textContent = "@" + d.user;
      }
      posts = (d.posts || []).filter(function (p) { return p && /^\/api\/ig\/[0-9]+$/.test(p.img); });
      if (!posts.length) return;
      $("#instaGrid").innerHTML = posts.map(function (p, i) {
        var alt = p.caption ? p.caption.slice(0, 90) : "Instagram poszt";
        return '<button type="button" class="insta__item" data-p="' + i + '"><img src="' + esc(p.img) + '" alt="' + esc(alt) + '" loading="lazy" decoding="async">' +
          (p.video ? '<span class="play" aria-label="Videó">▶</span>' : "") + "</button>";
      }).join("");
      $("#instaGrid").hidden = false; $("#instaMore").hidden = false; $("#instaCard").hidden = true;
    }).catch(function () {}); // no feed: the link card stays
  }
  $("#instaGrid").addEventListener("click", function (e) {
    var b = e.target.closest("[data-p]"); if (!b) return;
    var p = posts[+b.getAttribute("data-p")]; if (!p) return;
    openLb(p.img, b.querySelector("img").alt, p, b);
  });
  lb.addEventListener("click", function (e) { if (e.target === lb || e.target.closest("#lbClose")) closeLb(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeLb(); });

  /* ---------- start ---------- */
  function renderAll() { renderBoard(); renderServices(); renderWeek(); status(); renderDays(); renderTimes(); renderNext(); summary(); }
  renderAll(); renderGallery(); if (!PREVIEW) loadInsta();

  getJSON("/api/info", 4000).then(function (d) {
    if (!d || !Array.isArray(d.services) || !d.services.length) throw new Error("no services");
    live = true;
    $("#offline").hidden = true;
    cfg = { services: d.services, hours: d.hours || FALLBACK.hours, stepMinutes: d.stepMinutes || 20, autoConfirm: !!d.autoConfirm, sameDay: !!d.sameDay };
    if (sel.svc && !svc(sel.svc)) sel = { svc: null, day: null, time: null };
    var ref = ""; try { var r = document.referrer && new URL(document.referrer); if (r && r.hostname !== location.hostname) ref = r.hostname; } catch (e) {}
    hit({ t: "view", w: window.innerWidth, ref: ref, internal: !!(document.referrer && !ref) });
    renderAll();
    var jobs = [loadAvail(cfg.services[0].id)];
    if (sel.svc && sel.svc !== cfg.services[0].id) jobs.push(loadAvail(sel.svc));
    return Promise.all(jobs).then(function () { renderDays(); renderTimes(); renderNext(); summary(); });
  }).catch(function () {
    // the booking app did not answer: keep the built-in list and point people to the phone
    live = false;
    if (!PREVIEW) $("#offline").hidden = false;
  });

  setInterval(function () {
    status();
    if (!live) { renderNext(); return; }
    // keep free times fresh while the page stays open
    var ids = [cfg.services[0].id]; if (sel.svc && ids.indexOf(sel.svc) < 0) ids.push(sel.svc);
    Promise.all(ids.map(loadAvail)).then(function () { renderNext(); if (!form.hidden) { renderDays(); renderTimes(); summary(); } }).catch(function () {});
  }, 120000);
})();
