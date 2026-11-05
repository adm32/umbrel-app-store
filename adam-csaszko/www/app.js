(function () {
  "use strict";

  /* ---------- editable content ---------- */
  // min: how long it takes; price: null shows "hamarosan" until the real price is known
  var SERVICES = [
    { id: "haj", name: "Hajvágás", min: 40, price: 3500 },
    { id: "rovid", name: "Rövid hajvágás", min: 20, price: 3500 },
    { id: "hajszakall", name: "Haj + szakáll", min: 50, price: 5500 },
    { id: "szakall", name: "Szakálligazítás", min: 20, price: 2000 },
    { id: "gyerek", name: "Gyerek hajvágás", note: "13 éves korig", min: 30, price: 3000 }
  ];
  var OPEN_DAYS = [0, 2, 3, 4, 5, 6];      // 0 = vasárnap … 6 = szombat; hétfő zárva
  var FIRST = 15 * 60, LAST = 21 * 60;     // first and last start time, minutes
  var STEP = 20;                           // minutes between start times
  var LEAD = 30;                           // a same-day slot must be at least this far ahead
  var DAYS_AHEAD = 14;
  var DEMO = true;                         // demo: the request is not sent anywhere

  var WD = ["vasárnap", "hétfő", "kedd", "szerda", "csütörtök", "péntek", "szombat"];
  var WD_SHORT = ["V", "H", "K", "Sze", "Cs", "P", "Szo"];
  var MON = ["jan.", "febr.", "márc.", "ápr.", "máj.", "jún.", "júl.", "aug.", "szept.", "okt.", "nov.", "dec."];
  var $ = function (s) { return document.querySelector(s); };

  function ft(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0") + "\u00a0Ft"; }
  function hm(min) { return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0"); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // current date and time in Budapest, whatever the visitor's own time zone is
  function now() {
    var p = {};
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    var day = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
    return { day: day, min: (+p.hour) * 60 + (+p.minute) };
  }
  function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
  function isOpen(d) { return OPEN_DAYS.indexOf(d.getUTCDay()) !== -1; }
  function nextOpen(d) { var x = addDays(d, 1); while (!isOpen(x)) x = addDays(x, 1); return x; }
  function key(d) { return d.toISOString().slice(0, 10); }

  /* ---------- status line ---------- */
  function status() {
    var n = now(), d = n.day, txt, open = false;
    var nx = nextOpen(d), gap = Math.round((nx - d) / 86400000);
    var when = gap === 1 ? "holnap" : ["vasárnap", "", "kedden", "szerdán", "csütörtökön", "pénteken", "szombaton"][nx.getUTCDay()];
    if (!isOpen(d)) txt = "Ma zárva, " + when + " 15:00-tól nyitva.";
    else if (n.min < FIRST) txt = "Ma 15:00-tól nyitva, 21:00-ig foglalhatsz.";
    else if (n.min <= LAST) { txt = "Most nyitva, ma még 21:00-ig foglalhatsz."; open = true; }
    else txt = "Mára zárva, " + when + " 15:00-tól nyitva.";
    $("#statusText").textContent = txt;
    $("#pole").classList.toggle("is-open", open);
    var today = $('#week li[data-d="' + d.getUTCDay() + '"]');
    document.querySelectorAll("#week li").forEach(function (li) { li.classList.toggle("is-today", li === today); });
  }

  /* ---------- price board ---------- */
  function meta(s) { return (s.note ? s.note + ", " : "") + s.min + " perc"; }

  $("#board").innerHTML = SERVICES.map(function (s) {
    return '<li><span class="nm">' + esc(s.name) + "<small>" + esc(meta(s)) + '</small></span><span class="dots" aria-hidden="true"></span>' +
      (s.price == null ? '<span class="pr is-tbd">hamarosan</span>' : '<span class="pr">' + ft(s.price) + "</span>") + "</li>";
  }).join("");

  /* ---------- booking ---------- */
  var form = $("#book"), sel = { svc: null, day: null, time: null };

  $("#svcList").innerHTML = SERVICES.map(function (s) {
    return '<label class="opt"><input type="radio" name="svc" value="' + s.id + '"><span>' + esc(s.name) +
      "<small>" + s.min + " perc" + (s.price == null ? "" : ", " + ft(s.price)) + "</small></span></label>";
  }).join("");

  function slotsFor(d) {
    var n = now(), out = [];
    if (!isOpen(d)) return out;
    for (var m = FIRST; m <= LAST; m += STEP) {
      if (key(d) === key(n.day) && m < n.min + LEAD) continue;
      out.push(m);
    }
    return out;
  }

  function renderDays() {
    var n = now(), html = "";
    for (var i = 0; i < DAYS_AHEAD; i++) {
      var d = addDays(n.day, i), k = key(d), free = slotsFor(d).length > 0;
      var sub = !isOpen(d) ? "zárva" : !free ? "betelt" : i === 0 ? "ma" : i === 1 ? "holnap" : d.getUTCDate() === 1 || i === 2 ? MON[d.getUTCMonth()] : "";
      html += '<label class="opt"><input type="radio" name="day" value="' + k + '"' + (free ? "" : " disabled") + (sel.day === k ? " checked" : "") + '>' +
        '<span><span class="wd">' + WD_SHORT[d.getUTCDay()] + "</span><b>" + d.getUTCDate() + "</b><i>" + sub + "</i></span></label>";
    }
    $("#dayList").innerHTML = html;
  }

  function renderTimes() {
    var box = $("#timeList"), hint = $("#timeHint");
    if (!sel.day) { box.innerHTML = ""; hint.hidden = false; hint.textContent = "Előbb válassz napot."; return; }
    var d = new Date(sel.day + "T00:00:00Z"), slots = slotsFor(d);
    if (sel.time != null && slots.indexOf(sel.time) === -1) sel.time = null;
    box.innerHTML = slots.map(function (m) {
      return '<label class="opt"><input type="radio" name="time" value="' + m + '"' + (sel.time === m ? " checked" : "") + "><span>" + hm(m) + "</span></label>";
    }).join("");
    hint.hidden = slots.length > 0;
    hint.textContent = "Erre a napra már nincs szabad időpont.";
  }

  var ON_DAY = ["Vasárnap", "Hétfőn", "Kedden", "Szerdán", "Csütörtökön", "Pénteken", "Szombaton"];

  // hero: the next few start times, tap one to jump into the form with it selected
  function renderNext() {
    var n = now();
    for (var i = 0; i < DAYS_AHEAD; i++) {
      var d = addDays(n.day, i), slots = slotsFor(d);
      if (!slots.length) continue;
      $("#nextLabel").textContent = (i === 0 ? "Ma még" : i === 1 ? "Holnap" : ON_DAY[d.getUTCDay()]) + " foglalható például:";
      $("#nextTimes").innerHTML = slots.slice(0, 4).map(function (m) {
        return '<button type="button" data-day="' + key(d) + '" data-time="' + m + '">' + hm(m) + "</button>";
      }).join("");
      $("#next").hidden = false;
      return;
    }
    $("#next").hidden = true;
  }

  $("#nextTimes").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    sel.day = b.dataset.day; sel.time = +b.dataset.time;
    renderDays(); renderTimes(); summary();
    $("#foglalas").scrollIntoView({ block: "start" });
    var first = sel.svc ? $("#fName") : form.querySelector('[name="svc"]');
    if (first) first.focus({ preventScroll: true });
  });

  function dayLabel(k) {
    var d = new Date(k + "T00:00:00Z");
    return WD[d.getUTCDay()] + ", " + MON[d.getUTCMonth()] + " " + d.getUTCDate() + ".";
  }
  function svc() { return SERVICES.filter(function (s) { return s.id === sel.svc; })[0]; }

  function summary(msg) {
    var el = $("#summary");
    el.classList.remove("is-ready", "is-error");
    if (msg) { el.textContent = msg; el.classList.add("is-error"); return; }
    var s = svc();
    if (s && sel.day && sel.time != null) {
      el.innerHTML = "<strong>" + esc(s.name) + "</strong>, " + dayLabel(sel.day) + " <strong>" + hm(sel.time) + "–" + hm(sel.time + s.min) + "</strong>" + (s.price != null ? ", " + ft(s.price) : "") + ".";
      el.classList.add("is-ready");
    } else {
      var miss = [];
      if (!s) miss.push("mit kérsz");
      if (!sel.day) miss.push("melyik nap");
      if (sel.time == null) miss.push("hánykor");
      el.textContent = "Válaszd ki, " + miss.join(", ").replace(/, ([^,]*)$/, " és $1") + ".";
    }
  }

  form.addEventListener("change", function (e) {
    var t = e.target;
    if (t.name === "svc") sel.svc = t.value;
    if (t.name === "day") { sel.day = t.value; renderTimes(); }
    if (t.name === "time") sel.time = +t.value;
    if (t.id === "fName" || t.id === "fPhone") t.removeAttribute("aria-invalid");
    summary();
  });

  function phoneOk(v) { var d = v.replace(/\D/g, ""); return d.length >= 9 && d.length <= 13; }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    renderDays(); renderTimes(); // the clock may have moved on since the page was opened
    var name = $("#fName"), phone = $("#fPhone"), err = null, focus = null;
    if (!sel.svc) { err = "Válaszd ki, mit kérsz."; focus = form.querySelector('[name="svc"]'); }
    else if (!sel.day) { err = "Válassz napot."; focus = form.querySelector('[name="day"]:not(:disabled)'); }
    else if (sel.time == null) { err = "Válassz időpontot."; focus = form.querySelector('[name="time"]'); }
    else if (name.value.trim().length < 2) { err = "Írd be a neved."; focus = name; name.setAttribute("aria-invalid", "true"); }
    else if (!phoneOk(phone.value)) { err = "Írd be a telefonszámod, hogy Bence vissza tudja igazolni a foglalást."; focus = phone; phone.setAttribute("aria-invalid", "true"); }
    if (err) { summary(err); if (focus) focus.focus(); return; }

    var s = svc();
    var booking = { szolgaltatas: s.name, nap: sel.day, ido: hm(sel.time), nev: name.value.trim(), telefon: phone.value.trim(), megjegyzes: $("#fNote").value.trim() };
    if (!DEMO) { /* élesben: POST /api/foglalas */ }
    void booking;

    $("#doneText").innerHTML = "<strong>" + esc(s.name) + "</strong>, " + dayLabel(sel.day) + " <strong>" + hm(sel.time) + "–" + hm(sel.time + s.min) + "</strong>. Bence hamarosan visszaigazolja SMS-ben vagy telefonon a " + esc(phone.value.trim()) + " számon.";
    form.hidden = true;
    var done = $("#done"); done.hidden = false; done.focus({ preventScroll: true }); done.scrollIntoView({ block: "start" });
  });

  $("#again").addEventListener("click", function () {
    form.reset(); sel = { svc: null, day: null, time: null };
    renderDays(); renderTimes(); summary();
    $("#done").hidden = true; form.hidden = false;
    form.querySelector('[name="svc"]').focus();
  });

  status(); renderDays(); renderTimes(); renderNext(); summary();
  setInterval(function () { status(); renderNext(); }, 60000);
})();
