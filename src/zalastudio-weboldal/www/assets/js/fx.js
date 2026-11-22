/* Zala Studio – hardware-friendly 60fps scroll parallax, elastic pill thumbs,
   interactive spotlight lens and smooth accordions.
   Batched DOM reads/writes (zero reflow thrashing), compositor-only transforms,
   0% CPU when idle, works cleanly on older phones and under prefers-reduced-motion. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  /* ---------- Elastic sliding thumb helper (used by Hero switcher & Lens pills) ---------- */
  function moveThumb(bar, thumb, activeBtn) {
    if (!bar || !thumb || !activeBtn) return;
    thumb.style.width = activeBtn.offsetWidth + "px";
    thumb.style.transform = "translate3d(" + activeBtn.offsetLeft + "px, 0, 0)";
  }
  window.__zsMoveThumb = moveThumb;

  function wireTabKeys(list) {
    if (!list.length) return;
    list.forEach(function (btn, idx) {
      btn.addEventListener("keydown", function (e) {
        var next = -1;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % list.length;
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + list.length) % list.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = list.length - 1;
        if (next < 0) return;
        e.preventDefault();
        list[next].focus();
        list[next].click();
      });
    });
  }

  /* ---------- Sticky Showcase: chapter switcher (desktop) ---------- */
  var showcase = $("#showcase");
  var scTabs = showcase ? $$(".rail__tab", showcase) : [];
  var scStories = showcase ? $$(".story", showcase) : [];
  var scBgs = showcase ? $$(".backdrop", showcase) : [];
  var scScenes = showcase ? $$(".scene", showcase) : [];
  var scFill = $("#railFill");
  var activeChapter = 0;

  function setChapter(idx) {
    if (!showcase || idx === activeChapter) return;
    activeChapter = idx;
    showcase.setAttribute("data-active", String(idx));
    scTabs.forEach(function (t, i) {
      var on = i === idx;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    scStories.forEach(function (s, i) { s.classList.toggle("is-active", i === idx); });
    scBgs.forEach(function (b, i) { b.classList.toggle("is-active", i === idx); });
    scScenes.forEach(function (s, i) {
      s.classList.toggle("is-active", i === idx);
      s.classList.toggle("is-past", i < idx);
    });
  }

  scTabs.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var idx = parseInt(btn.getAttribute("data-chapter"), 10) || 0;
      if (reduced || window.innerWidth < 920) { setChapter(idx); return; }
      var rect = showcase.getBoundingClientRect();
      var top = rect.top + window.scrollY;
      var span = Math.max(1, showcase.offsetHeight - window.innerHeight);
      window.scrollTo({ top: Math.round(top + span * ((idx + 0.42) / 3)), behavior: "smooth" });
    });
  });
  wireTabKeys(scTabs);

  /* ---------- Hero pill switcher sliding thumb sync ---------- */
  var heroBar = $("#heroSwitch");
  var heroThumb = $("#heroThumb");
  var heroBtns = heroBar ? $$("button[data-demo]", heroBar) : [];
  function syncHeroThumb() {
    var on = heroBar && $(".is-on", heroBar);
    if (on) moveThumb(heroBar, heroThumb, on);
  }
  wireTabKeys(heroBtns);

  /* ---------- Interactive Spotlight Lens (#miert) ---------- */
  var lensBar = $("#lensBar");
  var lensThumb = $("#lensThumb");
  var lensFrame = $("#apertureFrame");
  var lensCap = $("#lensCap");
  var lensBtns = lensBar ? $$("button[data-lens]", lensBar) : [];
  var LENS_CAPS = {
    open: "Automatikusan mutatja, mikor vagytok nyitva.",
    order: "Hüvelykujjra méretezett gomb — egy koppintással indul a rendelés.",
    call: "Azonnali tárcsázás, nem kell kimásolni a számot."
  };
  function setLens(key) {
    if (!lensFrame || !LENS_CAPS[key]) return;
    lensFrame.setAttribute("data-lens-active", key);
    if (lensCap) lensCap.textContent = LENS_CAPS[key];
    var active = null;
    lensBtns.forEach(function (b) {
      var on = b.getAttribute("data-lens") === key;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      if (on) active = b;
    });
    if (active) moveThumb(lensBar, lensThumb, active);
  }
  lensBtns.forEach(function (b) {
    var k = b.getAttribute("data-lens");
    b.addEventListener("click", function () { setLens(k); });
  });
  if (lensFrame) {
    $$("[data-vv]", lensFrame).forEach(function (el) {
      el.addEventListener("click", function () {
        var k = el.getAttribute("data-vv");
        if (LENS_CAPS[k]) setLens(k);
      });
    });
  }
  wireTabKeys(lensBtns);

  function syncAllThumbs() {
    syncHeroThumb();
    var activeLens = lensBar && $(".is-on", lensBar);
    if (activeLens) moveThumb(lensBar, lensThumb, activeLens);
  }
  syncAllThumbs();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncAllThumbs);
  window.addEventListener("resize", syncAllThumbs, { passive: true });

  if (reduced) {
    $$("[data-pstep]").forEach(function (s) { s.classList.add("is-lit"); });
    return;
  }

  /* ---------- The Zala river (hero background canvas, 30fps, dpr=1, pauses off-screen) ---------- */
  (function () {
    var cv = document.getElementById("river");
    if (!cv || !cv.getContext) return;
    var cx = cv.getContext("2d"), W = 0, H = 0, visible = true, raf = 0, last = 0, t0 = performance.now();
    var phone = window.matchMedia && window.matchMedia("(max-width: 699px)").matches;
    var N = phone ? 13 : 20;
    var STEP = phone ? 22 : 18;
    var FPS = 30;
    var strands = [], grad = null;
    for (var i = 0; i < N; i++) {
      var u = i / (N - 1) * 2 - 1;
      strands.push({
        u: u,
        ph: Math.random() * 6.28,
        k: 0.006 + Math.random() * 0.006,
        sp: 0.25 + Math.random() * 0.35,
        amp: 2 + Math.random() * 5,
        a: (phone ? 1.6 : 1.25) * (0.05 + 0.2 * Math.pow(1 - Math.abs(u), 1.6))
      });
    }
    function size() {
      var r = cv.getBoundingClientRect();
      var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
      if (w === W && h === H) return false;
      W = w; H = h;
      cv.width = W; cv.height = H;
      grad = cx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, "rgba(246,164,111,0)");
      grad.addColorStop(0.18, "rgba(246,164,111,1)");
      grad.addColorStop(0.55, "rgba(248,186,104,1)");
      grad.addColorStop(0.85, "rgba(238,125,70,1)");
      grad.addColorStop(1, "rgba(238,125,70,0)");
      return true;
    }
    function centre(x, t) {
      return H * 0.52 + H * 0.16 * Math.sin(x * 0.0042 + t * 0.12) + H * 0.07 * Math.sin(x * 0.011 - t * 0.21 + 1.7);
    }
    function half(x, t) {
      return H * (0.13 + 0.07 * Math.sin(x * 0.0035 - t * 0.09 + 0.6) + 0.03 * Math.sin(x * 0.013 + t * 0.17));
    }
    function y(s, x, t) {
      return centre(x, t) + s.u * half(x, t) + s.amp * Math.sin(x * s.k + t * s.sp + s.ph);
    }
    function paint(now) {
      last = now;
      var t = (now - t0) / 1000;
      cx.clearRect(0, 0, W, H);
      cx.globalCompositeOperation = "lighter";
      cx.strokeStyle = grad; cx.lineCap = "round"; cx.lineJoin = "round";
      for (var i = 0; i < N; i++) {
        var s = strands[i];
        cx.globalAlpha = s.a * (0.85 + 0.15 * Math.sin(t * 0.8 + s.ph));
        cx.lineWidth = Math.abs(s.u) < 0.25 ? 1.3 : 0.9;
        cx.beginPath();
        var x = -STEP, py = y(s, x, t);
        cx.moveTo(x, py);
        for (x = 0; x <= W + STEP; x += STEP) {
          var ny = y(s, x, t), mx = x - STEP / 2;
          cx.quadraticCurveTo(x - STEP, py, mx, (py + ny) / 2);
          py = ny;
        }
        cx.lineTo(W + STEP, py);
        cx.stroke();
      }
      cx.globalAlpha = 1; cx.globalCompositeOperation = "source-over";
    }
    function frame(now) {
      raf = 0;
      if (!visible || document.hidden) return;
      raf = requestAnimationFrame(frame);
      if (now - last < 1000 / FPS - 2) return;
      paint(now);
    }
    function start() { if (!raf && visible && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } }
    size();
    window.addEventListener("resize", function () { if (size()) paint(performance.now()); start(); }, { passive: true });
    document.addEventListener("visibilitychange", start);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) { visible = es[0].isIntersecting; start(); }).observe(cv);
    }
    start();
    requestAnimationFrame(function () { cv.classList.add("is-on"); });
  })();

  /* ---------- Manifesto word-by-word scroll illumination ---------- */
  var manifesto = $('[data-scroll="manifesto"]');
  var manifestoWords = [];
  if (manifesto) {
    var mEl = $("[data-scrub-words]", manifesto);
    if (mEl) {
      var raw = mEl.textContent.replace(/\s+/g, " ").trim();
      mEl.setAttribute("aria-label", raw);
      mEl.textContent = "";
      var tokens = raw.split(" ");
      var hiFrom = tokens.indexOf("Nem");
      tokens.forEach(function (word, idx) {
        var span = document.createElement("span");
        span.className = "mw" + (hiFrom >= 0 && idx >= hiFrom && idx <= hiFrom + 2 ? " mw--hi" : "");
        span.textContent = word;
        span.setAttribute("aria-hidden", "true");
        mEl.appendChild(span);
        if (idx < tokens.length - 1) mEl.appendChild(document.createTextNode(" "));
        manifestoWords.push(span);
      });
    }
  }

  /* ---------- Scroll-drawn Zala river path (#folyamat) ---------- */
  var processSec = $('[data-scroll="process"]');
  var processPath = $("#processPath");
  var processVLine = $(".process__vline");
  var processVFill = $("#processVFill");
  var processSteps = processSec ? $$("[data-pstep]", processSec) : [];
  var pathLen = 0;
  if (processPath && processPath.getTotalLength) {
    pathLen = processPath.getTotalLength();
    processPath.style.strokeDasharray = String(pathLen);
    processPath.style.strokeDashoffset = String(pathLen);
  }
  function syncProcessVLine() {
    if (!processVLine || processSteps.length < 2) return;
    var first = $(".how__num", processSteps[0]);
    var last = $(".how__num", processSteps[processSteps.length - 1]);
    if (!first || !last) return;
    var host = processVLine.parentNode.getBoundingClientRect();
    var r1 = first.getBoundingClientRect();
    var r2 = last.getBoundingClientRect();
    var top = (r1.top + r1.height * 0.5) - host.top;
    var h = Math.max(0, (r2.top + r2.height * 0.5) - (r1.top + r1.height * 0.5));
    processVLine.style.top = Math.round(top) + "px";
    processVLine.style.height = Math.round(h) + "px";
    processVLine.style.bottom = "auto";
  }
  syncProcessVLine();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncProcessVLine);
  window.addEventListener("resize", syncProcessVLine, { passive: true });

  /* ---------- Cached scroll targets ---------- */
  var heroSec = $('[data-scroll="hero"]');
  var pCards = $$("[data-parallax-card]");
  var apertureSec = $('[data-scroll="aperture"]');
  var hearthSec = $('[data-scroll="hearth"]');
  var scrollBar = $("#scrollBar");
  var navLinks = $$(".nav a[data-nav]");
  var navSections = navLinks.map(function (a) { return { a: a, el: document.getElementById(a.getAttribute("data-nav")) }; }).filter(function (x) { return x.el; });

  /* ---------- Unified read-then-write scroll loop (zero forced reflows) ---------- */
  var scheduled = false;
  function updateScroll() {
    scheduled = false;
    var vh = window.innerHeight || 800;
    var vw = window.innerWidth || 390;
    var sy = window.scrollY || window.pageYOffset || 0;
    var docH = Math.max(1, document.documentElement.scrollHeight - vh);
    var isDesktop = vw >= 920;

    // --- PHASE 1: READ ALL GEOMETRY ---
    var hr = heroSec ? heroSec.getBoundingClientRect() : null;
    var sr = (showcase && isDesktop) ? showcase.getBoundingClientRect() : null;
    var scH = (showcase && isDesktop) ? showcase.offsetHeight : 0;
    var cardRects = !isDesktop ? pCards.map(function (c) { return c.getBoundingClientRect(); }) : null;
    var mr = manifesto ? manifesto.getBoundingClientRect() : null;
    var ar = apertureSec ? apertureSec.getBoundingClientRect() : null;
    var pr = processSec ? processSec.getBoundingClientRect() : null;
    var ctr = hearthSec ? hearthSec.getBoundingClientRect() : null;
    var navRects = navSections.length ? navSections.map(function (x) { return x.el.getBoundingClientRect(); }) : null;

    // --- PHASE 2: WRITE TRANSFORMS & VARS ONLY ---
    if (scrollBar) {
      scrollBar.style.transform = "scaleX(" + clamp(sy / docH, 0, 1).toFixed(4) + ")";
    }

    // 1. Hero parallax (phone + desktop)
    if (hr) {
      var hp = clamp(-hr.top / Math.max(1, hr.height * 0.85), 0, 1);
      heroSec.style.setProperty("--hp", hp.toFixed(4));
    }

    // 2A. Desktop sticky 3-project parallax showcase
    if (sr) {
      var span = Math.max(1, scH - vh);
      var sp = clamp(-sr.top / span, 0, 1);
      if (scFill) scFill.style.transform = "scaleY(" + Math.max(0.06, sp).toFixed(4) + ")";
      var ch = sp < 0.333 ? 0 : sp < 0.666 ? 1 : 2;
      setChapter(ch);
      for (var s = 0; s < scScenes.length; s++) {
        var lp = clamp((sp - s / 3) * 3, 0, 1);
        scScenes[s].style.setProperty("--lp", lp.toFixed(4));
      }
    }

    // 2B. Mobile scissor counter-parallax on portfolio cards (only when on screen!)
    if (cardRects) {
      for (var c = 0; c < pCards.length; c++) {
        var cr = cardRects[c];
        if (cr.bottom < -40 || cr.top > vh + 40) continue;
        // -1 entering from bottom -> 0 centered -> +1 leaving top
        var mp = clamp(((vh * 0.5) - (cr.top + cr.height * 0.5)) / (vh * 0.65), -1, 1);
        pCards[c].style.setProperty("--mp", mp.toFixed(3));
      }
    }

    // 3. Manifesto word-by-word scroll illumination
    if (mr && manifestoWords.length && mr.bottom > -40 && mr.top < vh + 40) {
      var mProg = clamp((vh * 0.86 - mr.top) / (vh * 0.52 + mr.height * 0.35), 0, 1);
      var total = manifestoWords.length;
      for (var i = 0; i < total; i++) {
        var start = (i / total) * 0.78;
        var wOn = clamp((mProg - start) / 0.22, 0, 1);
        manifestoWords[i].style.setProperty("--on", wOn.toFixed(3));
      }
    }

    // 4. Aperture scroll-scale & counter-parallax
    if (ar && ar.bottom > -40 && ar.top < vh + 40) {
      var ap = clamp((vh * 0.96 - ar.top) / (vh * 0.72), 0, 1);
      var drift = clamp(((vh * 0.5) - (ar.top + ar.height * 0.5)) / (vh * 0.75), -1, 1);
      apertureSec.style.setProperty("--ap", ap.toFixed(4));
      apertureSec.style.setProperty("--ad", drift.toFixed(3));
    }

    // 5. Scroll-drawn Zala river (desktop horizontal + phone vertical)
    if (pr && pr.bottom > -40 && pr.top < vh + 40) {
      var pp = clamp((vh * 0.8 - pr.top) / (vh * 0.52 + pr.height * 0.3), 0, 1);
      if (pathLen > 0) processPath.style.strokeDashoffset = (pathLen * (1 - pp)).toFixed(1);
      if (processVFill) processVFill.style.transform = "scaleY(" + pp.toFixed(4) + ")";
      var thresholds = [0.08, 0.42, 0.76];
      for (var k = 0; k < processSteps.length; k++) {
        processSteps[k].classList.toggle("is-lit", pp >= thresholds[k]);
      }
    }

    // 6. Hearth subtle scale lift (pure compositor transform, zero border-radius repaint)
    if (ctr && ctr.bottom > -40 && ctr.top < vh + 40) {
      var cp = clamp((vh * 0.96 - ctr.top) / (vh * 0.58), 0, 1);
      hearthSec.style.setProperty("--cp", cp.toFixed(4));
    }

    // 7. Nav scroll-spy
    if (navRects) {
      var focusY = vh * 0.36;
      var current = null;
      for (var j = 0; j < navRects.length; j++) {
        if (navRects[j].top <= focusY && navRects[j].bottom > 100) current = navSections[j].a;
      }
      navSections.forEach(function (x) { x.a.classList.toggle("is-cur", x.a === current); });
    }
  }

  function requestTick() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(updateScroll); }
  }
  window.addEventListener("scroll", requestTick, { passive: true });
  window.addEventListener("resize", requestTick, { passive: true });
  updateScroll();

  /* ---------- Subtle tactile magnetic pull on desktop primary CTAs ---------- */
  if (finePointer) {
    $$(".hero__cta .btn--primary, .hearth__cta .btn--primary").forEach(function (btn) {
      btn.addEventListener("pointermove", function (e) {
        var r = btn.getBoundingClientRect();
        var dx = ((e.clientX - r.left) / r.width - 0.5) * 8;
        var dy = ((e.clientY - r.top) / r.height - 0.5) * 5;
        btn.style.transform = "translate3d(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px,0)";
      }, { passive: true });
      btn.addEventListener("pointerleave", function () { btn.style.transform = ""; });
      btn.addEventListener("pointerdown", function () { btn.style.transform = ""; });
    });
  }

  /* ---------- Smooth spring height animation for native <details> ---------- */
  $$(".faq details, details.more").forEach(function (det) {
    var sum = $("summary", det);
    if (!sum || !det.animate) return;
    var anim = null, closing = false;
    sum.addEventListener("click", function (e) {
      e.preventDefault();
      det.style.overflow = "hidden";
      if (closing || !det.open) {
        if (anim) anim.cancel();
        closing = false;
        var startH = det.offsetHeight;
        det.open = true;
        var endH = det.offsetHeight;
        anim = det.animate({ height: [startH + "px", endH + "px"] }, { duration: 240, easing: "cubic-bezier(.22,1,.36,1)" });
        anim.onfinish = function () { det.style.height = det.style.overflow = ""; anim = null; };
        anim.oncancel = function () { det.style.height = det.style.overflow = ""; };
      } else {
        if (anim) anim.cancel();
        closing = true;
        var sH = det.offsetHeight;
        var eH = sum.offsetHeight;
        anim = det.animate({ height: [sH + "px", eH + "px"] }, { duration: 200, easing: "cubic-bezier(.22,1,.36,1)" });
        anim.onfinish = function () { det.open = false; closing = false; det.style.height = det.style.overflow = ""; anim = null; };
        anim.oncancel = function () { closing = false; det.style.height = det.style.overflow = ""; };
      }
    });
  });
})();
