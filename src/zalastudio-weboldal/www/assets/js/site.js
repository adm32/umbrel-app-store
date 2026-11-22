/* Zala Studio – zalastudio.hu
   Interactions: reveals, header, dock, pricing, hero demo, and the step-by-step planner.
   No dependencies. The page is fully usable without this file (see .no-js). */
(function () {
  "use strict";
  window.__admReady = true;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var mq = function (q) { return window.matchMedia(q); };
  var reduced = mq("(prefers-reduced-motion: reduce)").matches;
  var desktop = mq("(min-width: 900px)");
  var fmt = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " "); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  /* ---------- Statistics (counts; per visitor only with cookie consent, see consent.js and adatvedelem.html) ---------- */
  var seenSteps = {};
  function track(t, extra) {
    try {
      var d = { t: t, p: location.pathname };
      if (extra) for (var k in extra) d[k] = extra[k];
      var body = JSON.stringify(d);
      if (navigator.sendBeacon) navigator.sendBeacon("/api/e", new Blob([body], { type: "text/plain" }));
      else fetch("/api/e", { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "text/plain" } });
    } catch (e) { /* statistics must never break the page */ }
  }
  var ref = "";
  try { if (document.referrer) { var ru = new URL(document.referrer); if (ru.host !== location.host) ref = ru.host; } } catch (e) { /* ignore */ }
  track("pv", { r: ref, w: window.innerWidth });
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="tel:"], a[href^="mailto:"]');
    if (a) track(a.getAttribute("href").indexOf("tel:") === 0 ? "call" : "mail");
  });

  var P = window.CorePreview;
  var IC = P.IC, svg = P.svg, TYPES = P.TYPES, TYPE_ORDER = P.TYPE_ORDER, FEATURES = P.FEATURES, FEAT = P.FEAT,
    STYLES = P.STYLES, STYLE_ORDER = P.STYLE_ORDER, SITUATIONS = P.SITUATIONS, TIMINGS = P.TIMINGS, CALLS = P.CALLS,
    PLANS = P.PLANS, PLAN_ORDER = P.PLAN_ORDER, recommend = P.recommend, render = P.render;
  var spots = 5;
  var billing = "m", billSwitches = 0;

  /* ---------- Reveals ---------- */
  var rv = $$(".rv");
  if ("IntersectionObserver" in window && !reduced) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.08 });
    rv.forEach(function (el) { io.observe(el); });
  } else rv.forEach(function (el) { el.classList.add("in"); });

  /* ---------- Header + dock ---------- */
  var head = $("#head"), dock = $("#dock");
  var heroCta = $(".hero__cta"), hearth = $(".hearth"), foot = $(".foot");
  var vis = { hero: true, hearth: false, foot: false };
  var plOpen = false;
  function updateDock() {
    if (!dock) return;
    var on = !vis.hero && !vis.hearth && !vis.foot && !plOpen;
    dock.classList.toggle("is-on", on);
    if (on && !dock.__seen) { dock.__seen = true; setTimeout(function () { dock.classList.add("seen"); }, 600); }
    dock.setAttribute("aria-hidden", on ? "false" : "true");
    $$("a", dock).forEach(function (a) { a.tabIndex = on ? 0 : -1; });
  }
  if ("IntersectionObserver" in window) {
    var dio = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.target === heroCta) vis.hero = e.isIntersecting || e.boundingClientRect.top > 0;
        if (e.target === hearth) vis.hearth = e.isIntersecting;
        if (e.target === foot) vis.foot = e.isIntersecting;
      });
      updateDock();
    }, { threshold: 0 });
    [heroCta, hearth, foot].forEach(function (el) { if (el) dio.observe(el); });
  }
  // The header is light-on-dark while it is over the dark hero, and switches to the page colours after it.
  var heroEl = $(".hero");
  function headState() {
    head.classList.toggle("is-scrolled", window.scrollY > 8);
    if (heroEl) head.classList.toggle("on-hero", heroEl.getBoundingClientRect().bottom > head.offsetHeight + 4);
  }
  var ticking = false;
  window.addEventListener("scroll", function () {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () { ticking = false; headState(); });
  }, { passive: true });
  window.addEventListener("resize", headState);
  headState();

  /* ---------- Pricing: accordion on phones, monthly / yearly ---------- */
  var plans = $$(".plan");
  function syncPlans() {
    plans.forEach(function (p) {
      var b = $(".plan__top", p);
      if (desktop.matches) { b.setAttribute("aria-expanded", "true"); b.tabIndex = -1; }
      else { b.removeAttribute("tabindex"); b.setAttribute("aria-expanded", p.classList.contains("is-open") ? "true" : "false"); }
    });
  }
  plans.forEach(function (p) {
    $(".plan__top", p).addEventListener("click", function () {
      if (desktop.matches) return;
      var open = !p.classList.contains("is-open");
      plans.forEach(function (o) { o.classList.toggle("is-open", o === p ? open : false); });
      syncPlans();
      if (open) setTimeout(function () {
        var r = p.getBoundingClientRect();
        if (r.top < 70) window.scrollBy({ top: r.top - 80, behavior: reduced ? "auto" : "smooth" });
      }, 380);
    });
  });
  if (desktop.addEventListener) desktop.addEventListener("change", syncPlans);
  syncPlans();

  var roll = function (b, to) {
    var from = parseInt(b.textContent.replace(/\D/g, ""), 10) || 0;
    if (reduced || from === to) { b.textContent = fmt(to); return; }
    var t0 = performance.now(), dur = 650;
    (function f(now) {
      var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 4);
      b.textContent = fmt(Math.round((from + (to - from) * e) / 10) * 10);
      if (k < 1) requestAnimationFrame(f); else b.textContent = fmt(to);
    })(t0);
  };
  // Segmented controls: the dark thumb follows the checked label.
  function placeThumbs() {
    $$(".seg").forEach(function (sg) {
      var th = $(".seg__thumb", sg), on = $("input:checked + label", sg);
      if (th && on) { th.style.left = on.offsetLeft + "px"; th.style.width = on.offsetWidth + "px"; }
    });
  }
  placeThumbs();
  window.addEventListener("resize", placeThumbs);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeThumbs);
  $$(".seg input").forEach(function (i) { i.addEventListener("change", placeThumbs); });

  $$('input[name="bill"]').forEach(function (r) {
    r.addEventListener("change", function () {
      if (!r.checked) return;
      billing = r.value; billSwitches++;
      var plansBox = $("#plans");
      if (plansBox) plansBox.classList.toggle("is-yearly", billing === "y");
      $$(".plan").forEach(function (p) {
        var b = $(".amt b", p), s = $(".amt span", p), pd = $(".perday b", p);
        var v = parseInt(b.getAttribute("data-" + billing), 10);
        roll(b, v); s.textContent = s.getAttribute("data-" + billing);
        var amt = b.parentNode; amt.classList.remove("is-new");
        if (billSwitches < 3) { void amt.offsetWidth; amt.classList.add("is-new"); } // frequency decay
        if (pd) pd.textContent = fmt(v / (billing === "y" ? 365 : 30)) + " Ft";
      });
    });
  });

  /* ---------- Launch discount: remaining places come from the server ---------- */
  function applySpots(n) {
    spots = n;
    $$("[data-spots-n]").forEach(function (el) { el.textContent = String(n); });
    if (n <= 0) {
      var promo = $(".promo"); if (promo) promo.hidden = true;
      $$(".plan").forEach(function (p) {
        var key = p.getAttribute("data-plan-card"), pl = PLANS[key], el = $(".setup", p);
        if (pl && el) el.innerHTML = "Beállítás: <strong>" + fmt(pl.setup) + " Ft" + (pl.from ? "-tól" : "") + "</strong>";
      });
    }
  }
  fetch("/api/info", { headers: { Accept: "application/json" } }).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (j && typeof j.spots === "number") applySpots(j.spots);
    }).catch(function () { /* keep defaults */ });

  /* ---------- Hero demo phone + interactive industry switcher ---------- */
  var heroScreen = $("#heroScreen");
  var DEMOS = [
    { type: "etterem", style: "meleg", features: ["rendeles", "galeria"], word: "az éttermednek.", tint: "rgba(240,139,83,.26)" },
    { type: "szepseg", style: "lagy", features: ["arlista", "foglalas", "galeria"], word: "a szalonodnak.", tint: "rgba(208,118,154,.24)" },
    { type: "szaki", style: "friss", features: ["arlista", "ajanlat", "galeria"], word: "a cégednek.", tint: "rgba(92,150,248,.22)" },
    { type: "szallas", style: "termeszetes", features: ["foglalas", "galeria", "nyelv"], word: "a szállásodnak.", tint: "rgba(122,174,116,.24)" },
    { type: "bolt", style: "termeszetes", features: ["arlista", "galeria", "kozosseg"], word: "a boltodnak.", tint: "rgba(164,186,112,.22)" },
    { type: "egyeb", style: "elegans", features: ["arlista", "ajanlat"], word: "az irodádnak.", tint: "rgba(214,174,104,.24)" }
  ];
  var heroWord = $("#heroWord");
  var heroTry = $("#heroTry");
  var heroPills = $$("#heroSwitch button[data-demo]");
  var heroStageHalo = $(".stage__halo");
  var userPickedDemo = false;

  function setWord(w) {
    if (!heroWord) return;
    while (heroWord.children.length > 1) heroWord.firstElementChild.remove();
    var old = heroWord.firstElementChild;
    if (old && old.textContent === w) return;
    var neu = document.createElement("span"); neu.className = "serif"; neu.textContent = w;
    heroWord.appendChild(neu);
    if (reduced || !old || !old.animate) { if (old) old.remove(); return; }
    // crisp masked vertical slide: new word glides up out of the line mask as old lifts away
    neu.animate([{ opacity: 0, transform: "translateY(82%)" }, { opacity: 1, transform: "none" }], { duration: 280, delay: 50, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" });
    old.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-82%)" }], { duration: 200, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }).onfinish = function () { if (old.parentNode) old.remove(); };
    setTimeout(function () { if (old.parentNode) old.remove(); }, 450);
  }
  function syncHeroPills(idx) {
    var active = null;
    heroPills.forEach(function (b) {
      var on = parseInt(b.getAttribute("data-demo"), 10) === idx;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      if (on) active = b;
    });
    var bar = $("#heroSwitch"), th = $("#heroThumb");
    if (bar && th) {
      th.style.opacity = active ? "1" : "0";
      if (active && window.__zsMoveThumb) window.__zsMoveThumb(bar, th, active);
    }
    if (heroTry && DEMOS[idx]) heroTry.setAttribute("data-type", DEMOS[idx].type);
    if (heroStageHalo && DEMOS[idx]) heroStageHalo.style.setProperty("--halo", DEMOS[idx].tint);
  }
  if (heroScreen) {
    var di = 0, dtimer = null, dvisible = true;
    render(heroScreen, DEMOS[0]);
    syncHeroPills(0);
    var showDemo = function (idx) {
      if (idx === di) return;
      di = idx;
      var stale = $$(".ps", heroScreen);
      var old = heroScreen.__ps;
      stale.forEach(function (n) { if (n !== old) n.remove(); });
      heroScreen.__ps = null; heroScreen.__sig = null;
      render(heroScreen, DEMOS[di]);
      setWord(DEMOS[di].word);
      syncHeroPills(di);
      var neu = heroScreen.__ps;
      if (old && old.animate && !reduced) {
        old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: "ease-in", fill: "forwards" }).onfinish = function () { if (old.parentNode) old.remove(); };
        neu.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: 110, easing: "ease-out", fill: "backwards" });
        setTimeout(function () { if (old.parentNode) old.remove(); }, 600);
      } else if (old) old.remove();
    };
    heroPills.forEach(function (b) {
      b.addEventListener("click", function () {
        userPickedDemo = true;
        clearTimeout(dtimer);
        showDemo(parseInt(b.getAttribute("data-demo"), 10) || 0);
      });
    });
    // two full rounds, then it rests on the first one; stops immediately if user picks a pill
    var swaps = 0;
    var loop = function () {
      clearTimeout(dtimer);
      if (!reduced && !userPickedDemo && dvisible && !document.hidden && !plOpen && swaps < DEMOS.length * 2) {
        dtimer = setTimeout(function () { swaps++; showDemo((di + 1) % DEMOS.length); loop(); }, 3600);
      }
    };
    if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { dvisible = es[0].isIntersecting; loop(); }, { threshold: 0.25 }).observe($(".hero") || heroScreen);
    document.addEventListener("visibilitychange", loop);
    loop();
  }

  /* ---------- Links that leave for Stripe take a moment: show that they work ---------- */
  $$('a[href="/elofizetes"]').forEach(function (a) {
    a.addEventListener("click", function () {
      a.classList.add("is-busy"); a.setAttribute("aria-busy", "true");
      a.textContent = "Megnyitás…";
      setTimeout(function () { a.classList.remove("is-busy"); a.removeAttribute("aria-busy"); a.textContent = "Előfizetés kezelése"; }, 8000);
    });
  });
  // coming back with the browser's back button: the link is ready again
  window.addEventListener("pageshow", function (e) {
    if (!e.persisted) return;
    $$('a[href="/elofizetes"].is-busy').forEach(function (a) { a.classList.remove("is-busy"); a.removeAttribute("aria-busy"); a.textContent = "Előfizetés kezelése"; });
  });

  /* =========================================================
     Planner
     ========================================================= */
  var dlg = $("#planner");
  if (!dlg) return;
  var STEPS = ["type", "name", "features", "style", "situation", "contact", "done"];
  var DRAFT = "core-terv-v1";
  var S = blank();
  var stepIdx = 0, sending = false, closing = false;
  var el = {
    form: $("#plForm"), body: $("#plBody"), bar: $("#plBar"), count: $("#plCount"), prog: $(".pl__progress", dlg),
    back: $("#plBack"), close: $("#plClose"), next: $("#plNext"), nextTxt: $("#plNextTxt"), nextIco: $("#plNextIco"),
    peek: $("#plPeek"), mini: $("#plMini"), miniBtn: $("#plMiniBtn"), screen: $("#plScreen"),
    pv: $("#pvFull"), pvScreen: $("#pvScreen"), pvClose: $("#pvClose"),
    biz: $("#inBiz"), city: $("#inCity"), url: $("#inUrl"), fldUrl: $("#fldUrl"),
    name: $("#inName"), tel: $("#inTel"), mail: $("#inMail"), msg: $("#inMsg"), fldMsg: $("#fldMsg"), addMsg: $("#addMsg"),
    consent: $("#inConsent"), hp: $("#inHp"), errName: $("#errName"), errContact: $("#errContact"), sum: $("#sum")
  };
  function blank() {
    return { type: null, biz: "", city: "", features: null, featTouched: false, style: null, styleTouched: false, situation: null, url: "", timing: null,
      plan: null, nev: "", tel: "", email: "", call: null, msg: "", src: "", opened: 0 };
  }

  /* -- build options -- */
  function opt(name, type, value, inner, cls) {
    return '<label class="opt ' + (cls || "") + '"><input type="' + type + '" name="' + name + '" value="' + value + '"><span class="opt__box">' + inner + "</span></label>";
  }
  var tick = '<span class="opt__tick">' + svg("check", 2.6) + "</span>";
  $("#optTypes").innerHTML = TYPE_ORDER.map(function (k) {
    return opt("tipus", "radio", k, '<span class="opt__ico">' + svg(TYPES[k].icon) + '</span><span class="opt__txt"><b>' + esc(TYPES[k].label) + "</b></span>" + tick, "opt--type");
  }).join("");
  // Hick's law: fewer choices at once. The usual extras are shown; the rarer ones (and any of them
  // already ticked for this kind of business) wait behind one button.
  var MORE = ["tobb", "kozosseg", "kezeles"];
  $("#optFeatures").innerHTML = FEATURES.map(function (f) {
    return opt("funkcio", "checkbox", f.id, '<span class="opt__ico">' + svg(f.icon) + '</span><span class="opt__txt"><b>' + esc(f.label) + "</b>" + (f.sub ? "<small>" + esc(f.sub) + "</small>" : "") + "</span>" + tick, MORE.indexOf(f.id) > -1 ? "opt--more" : "");
  }).join("");
  (function () {
    var box = $("#optFeatures"), btn = document.createElement("button");
    btn.type = "button"; btn.className = "opts__more"; btn.innerHTML = '<svg aria-hidden="true"><use href="#i-plus"/></svg><span>További lehetőségek</span>';
    box.classList.add("is-short"); box.parentNode.insertBefore(btn, box.nextSibling);
    btn.addEventListener("click", function () { box.classList.remove("is-short"); var f = $(".opt--more input", box); if (f) f.focus({ preventScroll: true }); });
  })();
  $("#optStyles").innerHTML = STYLE_ORDER.map(function (k) {
    var s = STYLES[k];
    var sw = '<span class="swatch" style="background:' + s.bg + '"><i style="background:' + s.p + '"></i><u style="background:' + s.ink + ';opacity:.5"></u></span>';
    return opt("stilus", "radio", k, sw + '<span class="opt__txt"><b>' + esc(s.label) + "</b><small>" + esc(s.sub) + "</small></span>" + tick, "opt--style");
  }).join("");
  $("#optSituation").innerHTML = SITUATIONS.map(function (x) {
    return opt("helyzet", "radio", x.id, '<span class="opt__ico">' + svg(x.icon) + '</span><span class="opt__txt"><b>' + esc(x.label) + "</b></span>" + tick);
  }).join("");
  $("#optTiming").innerHTML = TIMINGS.map(function (x) { return opt("mikorra", "radio", x.id, esc(x.label), "opt--chip"); }).join("");
  $("#optCall").innerHTML = CALLS.map(function (x) { return opt("hivhato", "radio", x.id, esc(x.label), "opt--chip"); }).join("");
  // One-time setup fee next to each package, so there is no hidden cost (launch price while places last).
  function setupText(p) { return fmt(spots > 0 ? p.now : p.setup) + " Ft" + (p.from ? "-tól" : "") + " beáll."; }
  $("#optPlans").innerHTML = PLAN_ORDER.map(function (k) {
    return opt("csomag", "radio", k, esc(PLANS[k].short) + "<small>" + fmt(PLANS[k].m) + " Ft/hó</small><small data-setup=\"" + k + "\">+ " + setupText(PLANS[k]) + "</small>", "");
  }).join("");
  $("#optPlans").classList.add("mini-plans");

  var haptic = function () { try { if (navigator.vibrate && !reduced) navigator.vibrate(8); } catch (e) { /* ignore */ } };
  var curFeatures = function () { return S.features || (S.type ? TYPES[S.type].features.slice() : []); };

  /* -- sync state -> controls -- */
  function syncControls() {
    $$('input[name="tipus"]').forEach(function (i) { i.checked = i.value === S.type; });
    var f = curFeatures();
    $$('input[name="funkcio"]').forEach(function (i) { i.checked = f.indexOf(i.value) > -1; });
    var st = S.style || (S.type ? TYPES[S.type].style : null);
    $$('input[name="stilus"]').forEach(function (i) { i.checked = i.value === st; });
    $$('input[name="helyzet"]').forEach(function (i) { i.checked = i.value === S.situation; });
    $$('input[name="mikorra"]').forEach(function (i) { i.checked = i.value === S.timing; });
    $$('input[name="hivhato"]').forEach(function (i) { i.checked = i.value === S.call; });
    el.biz.value = S.biz; el.city.value = S.city; el.url.value = S.url;
    el.name.value = S.nev; el.tel.value = S.tel; el.mail.value = S.email; el.msg.value = S.msg;
    el.fldUrl.hidden = !(S.situation === "facebook" || S.situation === "regi");
    if (S.msg) { el.fldMsg.hidden = false; el.addMsg.hidden = true; }
    if (S.type) el.biz.placeholder = TYPES[S.type].sample;
  }
  function previewState() {
    var t = S.type || "etterem";
    return { type: t, biz: S.biz, city: S.city, features: curFeatures().length || S.featTouched ? curFeatures() : TYPES[t].features, style: S.style || TYPES[t].style };
  }
  var pvFullOn = false;
  function paint() {
    var ps = previewState();
    el.mini.style.setProperty("--mini-bg", (STYLES[ps.style] || STYLES.meleg).bg);
    render(el.screen, ps);
    render(el.mini, ps);
    if (pvFullOn) render(el.pvScreen, ps, { scroll: true });
    if (STEPS[stepIdx] === "contact") paintOffer();
    save();
  }

  /* -- offer step -- */
  function chosenPlan() { return S.plan || recommend(curFeatures()); }
  function paintOffer() {
    var rec = recommend(curFeatures()), k = chosenPlan(), p = PLANS[k];
    $("#rec .rec__k").textContent = k === rec ? "Ezt ajánljuk neked" : "A te választásod";
    $("#recName").textContent = p.name;
    $("#recPrice").textContent = fmt(billing === "y" ? p.y : p.m);
    $("#rec .amt span").textContent = billing === "y" ? "Ft / év" : "Ft / hó";
    $("#recWhy").textContent = k === rec ? p.why : "Bármikor válthatsz másik csomagra.";
    $("#recSetup").innerHTML = (spots > 0 ? "Bevezető beállítási díj (egyszeri): <strong>" + fmt(p.now) : "Egyszeri beállítási díj: <strong>" + fmt(p.setup)) + " Ft" + (p.from ? "-tól" : "") + "</strong>";
    $$("#optPlans [data-setup]").forEach(function (el) { el.textContent = "+ " + setupText(PLANS[el.getAttribute("data-setup")]); });
    $$('input[name="csomag"]').forEach(function (i) { i.checked = i.value === k; });
    var t = S.type ? TYPES[S.type] : null, st = STYLES[S.style || (t && t.style)];
    var bits = [];
    if (t) bits.push(t.label);
    if (S.biz) bits.push(S.biz);
    if (st) bits.push(st.label);
    curFeatures().forEach(function (id) { if (FEAT[id]) bits.push(FEAT[id].label); });
    el.sum.innerHTML = bits.map(function (b) { return "<span>" + esc(b) + "</span>"; }).join("");
  }

  /* -- step navigation -- */
  var stepMoves = 0;
  function setStep(i, dir) {
    stepIdx = Math.max(0, Math.min(STEPS.length - 1, i));
    if (++stepMoves > 4) dlg.classList.add("is-quick");
    var name = STEPS[stepIdx];
    $$(".pl__step", el.form).forEach(function (s) {
      var on = s.getAttribute("data-step") === name;
      s.classList.toggle("is-on", on);
      s.classList.toggle("from-left", on && dir < 0);
    });
    var total = STEPS.length - 1;
    var shown = Math.min(stepIdx + 1, total);
    el.bar.style.setProperty("--p", name === "done" ? 1 : Math.max(0.08, stepIdx / total + 0.06).toFixed(3));
    el.count.textContent = name === "done" ? "Kész" : shown + "/" + total;
    el.prog.setAttribute("aria-valuenow", String(shown));
    el.back.hidden = stepIdx === 0 || name === "done";
    el.peek.hidden = name === "type" || name === "contact" || name === "done";
    dlg.classList.toggle("has-mini", ["name", "features", "style", "situation"].indexOf(name) > -1);
    updateNext();
    el.nextIco.style.display = name === "done" ? "none" : "";
    el.next.classList.toggle("btn--dark", name === "done");
    el.next.classList.toggle("btn--primary", name !== "done");
    el.body.scrollTop = 0;
    if (name === "contact") paintOffer();
    if (!seenSteps[name]) { seenSteps[name] = 1; track("cfg_step", { s: name }); }
    var focusEl = name === "name" ? el.biz : name === "contact" ? (S.nev ? null : el.name) : null;
    if (focusEl && desktop.matches) setTimeout(function () { focusEl.focus({ preventScroll: true }); }, 350);
    else if (name === "done") $('[data-step="done"]').focus({ preventScroll: true });
    save();
  }
  function updateNext() {
    var name = STEPS[stepIdx];
    el.nextTxt.textContent = name === "contact" ? "Kérem az ingyenes bemutatót" : name === "done" ? "Bezárás" : name === "situation" && !S.situation && !S.timing ? "Kihagyom" : "Tovább";
  }
  function bad(fld, msgEl, msg) {
    if (fld) { fld.classList.remove("is-bad"); void fld.offsetWidth; fld.classList.add("is-bad"); }
    if (msgEl) msgEl.textContent = msg || "";
    haptic();
  }
  function clearBad() { $$(".fld.is-bad", dlg).forEach(function (f) { f.classList.remove("is-bad"); }); el.errName.textContent = ""; el.errContact.textContent = ""; }

  function next() {
    var name = STEPS[stepIdx];
    clearBad();
    if (name === "type" && !S.type) {
      var box = $("#optTypes"); box.animate && box.animate([{ transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "none" }], { duration: 300 });
      return;
    }
    if (name === "name" && S.biz.trim().length < 2) { bad($("#fldBiz"), el.errName, "Írd be a vállalkozás nevét (ha még nincs, egy munkanevet is)."); el.biz.focus(); return; }
    if (name === "contact") return submit();
    if (name === "done") return closePlanner();
    setStep(stepIdx + 1, 1);
  }
  function prev() { if (stepIdx > 0 && STEPS[stepIdx] !== "done") setStep(stepIdx - 1, -1); }

  /* -- input wiring -- */
  el.form.addEventListener("change", function (e) {
    var i = e.target;
    if (i.name === "tipus") {
      S.type = i.value;
      if (!S.featTouched) S.features = null;
      if (!S.styleTouched) S.style = null;
      syncControls(); paint(); haptic();
      if (STEPS[stepIdx] === "type") setTimeout(function () { if (STEPS[stepIdx] === "type") setStep(1, 1); }, reduced ? 0 : 340);
    } else if (i.name === "funkcio") {
      var f = curFeatures().filter(function (x) { return x !== i.value; });
      if (i.checked) f.push(i.value);
      S.features = f; S.featTouched = true; haptic(); paint();
    } else if (i.name === "stilus") { S.style = i.value; S.styleTouched = true; haptic(); paint(); }
    else if (i.name === "helyzet") { S.situation = i.value; el.fldUrl.hidden = !(i.value === "facebook" || i.value === "regi"); haptic(); updateNext(); save(); }
    else if (i.name === "mikorra") { S.timing = i.value; haptic(); updateNext(); save(); }
    else if (i.name === "hivhato") { S.call = i.value; haptic(); save(); }
    else if (i.name === "csomag") { S.plan = i.value === recommend(curFeatures()) ? null : i.value; haptic(); paintOffer(); save(); }
    else if (i === el.consent) clearBad();
  });
  var bindText = function (input, key, live) {
    input.addEventListener("input", function () { S[key] = input.value; if (live) paint(); else save(); var f = input.closest(".fld"); if (f && f.classList.contains("is-bad")) { f.classList.remove("is-bad"); el.errName.textContent = ""; el.errContact.textContent = ""; } });
  };
  bindText(el.biz, "biz", true); bindText(el.city, "city", true); bindText(el.url, "url");
  bindText(el.name, "nev"); bindText(el.tel, "tel"); bindText(el.mail, "email"); bindText(el.msg, "msg");

  /* -- Postel's law: take whatever people type, give back a tidy version when they leave the field -- */
  // Hungarian numbers in any common form (06 30…, +36 30…, 0036…, 30/123-4567) become "+36 30 123 4567";
  // anything else (a foreign number) stays as it was typed.
  function cleanPhone(v) {
    var t = v.trim(), d = t.replace(/\D/g, ""), n = null;
    if (!t) return t;
    if (/^00/.test(d)) d = d.slice(2);
    if (/^(36|06)/.test(d) && (d.length === 10 || d.length === 11)) n = d.slice(2);
    else if ((d.length === 8 || d.length === 9) && t.charAt(0) !== "+") n = d;
    if (!n) return t.replace(/\s+/g, " ");
    if (n.charAt(0) === "1" && n.length === 8) return "+36 1 " + n.slice(1, 4) + " " + n.slice(4); // Budapest
    return "+36 " + n.slice(0, 2) + " " + n.slice(2, 5) + " " + n.slice(5);                         // Miller: in chunks
  }
  var cleanText = function (v) { return v.replace(/\s+/g, " ").trim(); };
  var cleanMail = function (v) { return v.replace(/\s+/g, "").toLowerCase(); };
  var cleanCity = function (v) { v = cleanText(v); return v.charAt(0).toLocaleUpperCase("hu") + v.slice(1); };
  var cleanUrl = function (v) { v = v.trim(); return v && !/^[a-z][a-z0-9+.-]*:\/\//i.test(v) && /\./.test(v) && !/\s/.test(v) ? "https://" + v : v; };
  function tidy(input, key, fn) {
    input.addEventListener("blur", function () {
      var v = fn(input.value);
      if (v === input.value) return;
      input.value = v; S[key] = v; save();
      if (key === "biz" || key === "city") paint();
    });
  }
  tidy(el.tel, "tel", cleanPhone); tidy(el.mail, "email", cleanMail); tidy(el.url, "url", cleanUrl);
  tidy(el.biz, "biz", cleanText); tidy(el.city, "city", cleanCity); tidy(el.name, "nev", cleanText);
  el.form.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || e.target.tagName === "TEXTAREA" || e.isComposing) return;
    e.preventDefault();
    if (e.target === el.biz) { el.city.focus(); return; }
    if (e.target === el.name) { el.tel.focus(); return; }
    if (e.target === el.tel) { el.mail.focus(); return; }
    next();
  });
  el.form.addEventListener("submit", function (e) { e.preventDefault(); next(); });
  el.addMsg.addEventListener("click", function () { el.fldMsg.hidden = false; el.addMsg.hidden = true; el.msg.focus(); });
  el.next.addEventListener("click", next);
  el.back.addEventListener("click", function () { if (history.state && history.state.pl) history.back(); else prev(); });

  /* -- full preview (phones) -- */
  function openPv() {
    pvFullOn = true; el.pv.classList.add("is-on"); el.pv.setAttribute("aria-hidden", "false");
    render(el.pvScreen, previewState(), { scroll: true });
    track("cfg_preview");
    setTimeout(function () { el.pvClose.focus({ preventScroll: true }); }, 50);
  }
  function closePv() { pvFullOn = false; el.pv.classList.remove("is-on"); el.pv.setAttribute("aria-hidden", "true"); }
  el.peek.addEventListener("click", openPv);
  el.mini.addEventListener("click", openPv);
  el.pvClose.addEventListener("click", closePv);
  el.pv.addEventListener("click", function (e) { if (e.target === el.pv) closePv(); });

  /* -- draft (per visitor, in this browser only) -- */
  function save() {
    if (STEPS[stepIdx] === "done") return;
    var c = {}; for (var k in S) c[k] = S[k];
    c.step = stepIdx; c.at = Date.now();
    store.set(DRAFT, c);
  }
  function load() {
    var d = store.get(DRAFT);
    if (!d || !d.at || Date.now() - d.at > 14 * 864e5) return 0;
    var n = blank(); for (var k in n) if (k in d) n[k] = d[k];
    S = n;
    return Math.min(d.step || 0, STEPS.length - 2);
  }

  /* -- open / close -- */
  var vv = window.visualViewport;
  function fitViewport() {
    if (!plOpen || !vv || desktop.matches) { dlg.style.removeProperty("--pl-h"); dlg.style.transform = ""; return; }
    dlg.style.setProperty("--pl-h", vv.height + "px");
    dlg.style.transform = vv.offsetTop ? "translateY(" + vv.offsetTop + "px)" : "";
  }
  if (vv) { vv.addEventListener("resize", fitViewport); vv.addEventListener("scroll", fitViewport); }

  function openPlanner(src, plan, preType) {
    if (plOpen || closing) return;
    var at = load();
    if (plan && PLANS[plan]) S.plan = plan;
    if (preType && TYPES[preType] && !S.biz && at === 0) {
      S.type = preType;
      S.features = null;
      S.style = null;
      at = 1;
    }
    S.src = src || S.src || "";
    if (!S.opened) S.opened = Date.now();
    plOpen = true; updateDock();
    document.documentElement.classList.add("pl-open");
    dlg.classList.remove("is-closing");
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
    syncControls(); paint();
    setStep(at, 1);
    fitViewport();
    track("cfg_open", { src: S.src });
    try { history.pushState({ pl: 1 }, "", "#tervezo"); } catch (e) { /* ignore */ }
  }
  function closePlanner(fromHistory) {
    if (!plOpen || closing) return;
    closing = true;
    closePv();
    var wasDone = STEPS[stepIdx] === "done";
    if (wasDone) { store.del(DRAFT); S = blank(); stepIdx = 0; } else save();
    var finish = function () {
      if (dlg.close) dlg.close(); else dlg.removeAttribute("open");
      dlg.classList.remove("is-closing");
      document.documentElement.classList.remove("pl-open");
      plOpen = false; closing = false; updateDock(); fitViewport();
      if (heroScreen) loop && loop();
    };
    if (reduced) finish(); else { dlg.classList.add("is-closing"); setTimeout(finish, 300); }
    if (!fromHistory && history.state && history.state.pl) { try { history.back(); } catch (e) { /* ignore */ } }
    else if (location.hash === "#tervezo") { try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* ignore */ } }
  }
  dlg.addEventListener("cancel", function (e) { e.preventDefault(); if (pvFullOn) closePv(); else closePlanner(); });
  el.close.addEventListener("click", function () { closePlanner(); });
  window.addEventListener("popstate", function () {
    if (closing) return;
    if (!plOpen) { if (location.hash === "#tervezo") openPlanner("link"); return; }
    if (pvFullOn) { closePv(); try { history.pushState({ pl: 1 }, "", "#tervezo"); } catch (e) { /* ignore */ } return; }
    var name = STEPS[stepIdx];
    if (stepIdx > 0 && name !== "done") { prev(); try { history.pushState({ pl: 1 }, "", "#tervezo"); } catch (e) { /* ignore */ } }
    else closePlanner(true);
  });
  $$("[data-planner]").forEach(function (a) {
    a.addEventListener("click", function (e) { e.preventDefault(); openPlanner(a.getAttribute("data-src") || "", a.getAttribute("data-plan"), a.getAttribute("data-type")); });
  });
  if (location.hash === "#tervezo") setTimeout(function () { try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* ignore */ } openPlanner("link"); }, 300);

  /* -- submit -- */
  function submit() {
    if (sending) return;
    el.tel.value = S.tel = cleanPhone(S.tel); el.mail.value = S.email = cleanMail(S.email); el.name.value = S.nev = cleanText(S.nev);
    var nev = S.nev.trim(), tel = S.tel.trim(), mail = S.email.trim();
    if (nev.length < 2) { bad($("#fldName"), el.errContact, "Add meg a neved."); el.name.focus(); return; }
    if (!tel && !mail) { bad($("#fldTel"), el.errContact, "Adj meg egy telefonszámot vagy e-mail-címet, hogy elküldhessük a bemutatót."); el.tel.focus(); return; }
    if (tel && tel.replace(/\D/g, "").length < 8) { bad($("#fldTel"), el.errContact, "Ez a telefonszám túl rövidnek tűnik."); el.tel.focus(); return; }
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) { bad($("#fldMail"), el.errContact, "Az e-mail-cím formátuma nem megfelelő."); el.mail.focus(); return; }
    if (!el.consent.checked) { bad(null, el.errContact, "Fogadd el az adatkezelési tájékoztatót."); $("#fldConsent").animate && $("#fldConsent").animate([{ transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "none" }], { duration: 300 }); return; }
    sending = true; el.next.classList.add("is-loading"); el.next.disabled = true;
    var data = {
      v: 2, forras: "tervezo", src: S.src, tipus: S.type, vallalkozas: S.biz.trim(), telepules: S.city.trim(),
      funkciok: curFeatures(), stilus: S.style || TYPES[S.type || "etterem"].style, helyzet: S.situation, link: S.url.trim(), mikorra: S.timing,
      csomag: chosenPlan(), ajanlott: recommend(curFeatures()), fizetes: billing,
      nev: nev, telefon: tel, email: mail, hivhato: S.call, uzenet: S.msg.trim(), adatkezeles: "igen",
      weboldal: el.hp.value, t: S.opened
    };
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);
    fetch("/api/ajanlatkeres", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(data), signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok && j.ok, msg: j.message }; }); })
      .then(function (res) {
        clearTimeout(timer); sending = false; el.next.classList.remove("is-loading"); el.next.disabled = false;
        if (!res.ok) { el.errContact.textContent = (res.msg || "Most nem sikerült elküldeni.") + " Írj nekünk: info@zalastudio.hu."; return; }
        track("cfg_sent", { plan: data.csomag });
        store.del(DRAFT);
        var first = nev.split(/\s+/).pop();
        $("#doneTitle").innerHTML = "Köszönjük, " + esc(first) + '! <span class="serif">Megkaptuk.</span>';
        setStep(STEPS.length - 1, 1);
        haptic();
      })
      .catch(function () {
        clearTimeout(timer); sending = false; el.next.classList.remove("is-loading"); el.next.disabled = false;
        el.errContact.textContent = "Nem sikerült elküldeni. Ellenőrizd az internetkapcsolatot, vagy írj nekünk: info@zalastudio.hu.";
      });
  }

  // Phones with a back gesture: keep the planner state in sync with the URL.
  syncControls();
})();
