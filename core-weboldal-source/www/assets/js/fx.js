/* Zala Studio – motion effects (river, scroll, pointer).
   Everything here is decoration: the page works the same without it, and nothing runs
   when the visitor asked for reduced motion. One requestAnimationFrame loop drives all
   scroll-linked effects, and it sleeps when nothing moves. */
(function () {
  "use strict";
  if (!window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  // Phones: no scroll-linked hero or parallax effects (they made the hero stutter on iPhones).
  var phone = window.matchMedia("(max-width: 699px)").matches;
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  /* ---------- Headings: split into words that rise out of a mask ---------- */
  function splitWords(el) {
    var n = 0;
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (c) {
        if (c.nodeType === 3) {
          var frag = document.createDocumentFragment();
          c.textContent.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
            var w = document.createElement("span"), wi = document.createElement("span");
            w.className = "w"; wi.className = "wi"; wi.textContent = part; wi.style.setProperty("--w", n++);
            w.appendChild(wi); frag.appendChild(w);
          });
          node.replaceChild(frag, c);
        } else if (c.nodeType === 1) walk(c);
      });
    })(el);
  }
  $$(".sec__head h2, .hearth h2").forEach(function (h) {
    if (!h.getAttribute("aria-label")) h.setAttribute("aria-label", h.textContent.replace(/\s+/g, " ").trim());
    splitWords(h);
  });

  /* ---------- The river (hero background) ----------
     The Zala from the logo, drawn as a living current: a band of fine strands that meander,
     widen and narrow, with small glints drifting downstream. One canvas, one rAF loop; it
     sleeps while the hero is off screen or the tab is hidden. Phones draw fewer strands at
     30 fps. */
  (function () {
    var cv = document.getElementById("river");
    if (!cv || !cv.getContext) return;
    var cx = cv.getContext("2d"), W = 0, H = 0, dpr = 1, visible = true, raf = 0, last = 0, t0 = performance.now();
    var N = phone ? 13 : 20;            // strands
    var STEP = phone ? 22 : 18;         // px between points along a strand (curves smooth between them)
    var FPS = 30;          // the river moves slowly: more frames would only cost battery
    var strands = [], glints = [], grad = null;
    for (var i = 0; i < N; i++) {
      var u = i / (N - 1) * 2 - 1;      // -1 … 1 across the band
      strands.push({ u: u, ph: Math.random() * 6.28, k: 0.006 + Math.random() * 0.006, sp: 0.25 + Math.random() * 0.35, amp: 2 + Math.random() * 5,
        a: (phone ? 1.6 : 1.25) * (0.05 + 0.2 * Math.pow(1 - Math.abs(u), 1.6)) });
    }
    // one glint drawn once, then stamped: far cheaper than a new gradient per glint per frame
    var spr = document.createElement("canvas"), SR = 12;
    spr.width = spr.height = SR * 2;
    (function () {
      var c = spr.getContext("2d"), rg = c.createRadialGradient(SR, SR, 0, SR, SR, SR);
      rg.addColorStop(0, "rgba(255,236,210,.9)"); rg.addColorStop(0.3, "rgba(248,186,104,.35)"); rg.addColorStop(1, "rgba(248,186,104,0)");
      c.fillStyle = rg; c.fillRect(0, 0, SR * 2, SR * 2);
    })();
    function newGlint(g, anywhere) {
      g.s = Math.floor(Math.random() * N); g.x = anywhere ? Math.random() * W : -20 - Math.random() * W * 0.3;
      g.v = 18 + Math.random() * 30; g.r = 0.8 + Math.random() * 1.6; g.tw = Math.random() * 6.28; g.life = 0.6 + Math.random() * 0.4;
      return g;
    }
    // Only when the river's own size changes. iOS Safari fires "resize" every time its address
    // bar grows or shrinks during a scroll; resetting then made the river blink and the glints jump.
    function size() {
      var r = cv.getBoundingClientRect();
      var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
      if (w === W && h === H) return false;
      var widthChanged = Math.abs(w - W) > 40;
      dpr = 1; // soft strands don't need retina pixels: a quarter of the work on phones
      W = w; H = h;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // one warm gradient that fades out at both ends of the screen
      grad = cx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, "rgba(246,164,111,0)");
      grad.addColorStop(0.18, "rgba(246,164,111,1)");
      grad.addColorStop(0.55, "rgba(248,186,104,1)");
      grad.addColorStop(0.85, "rgba(238,125,70,1)");
      grad.addColorStop(1, "rgba(238,125,70,0)");
      if (!glints.length || widthChanged) {
        var n = phone ? 12 : 24;
        glints = []; for (var j = 0; j < n; j++) glints.push(newGlint({}, true));
      }
      return true;
    }
    // centre line and half-width of the river at x, time t (seconds)
    function centre(x, t) {
      return H * 0.52 + H * 0.16 * Math.sin(x * 0.0042 + t * 0.12) + H * 0.07 * Math.sin(x * 0.011 - t * 0.21 + 1.7);
    }
    function half(x, t) {
      return H * (0.13 + 0.07 * Math.sin(x * 0.0035 - t * 0.09 + 0.6) + 0.03 * Math.sin(x * 0.013 + t * 0.17));
    }
    function y(s, x, t) {
      return centre(x, t) + s.u * half(x, t) + s.amp * Math.sin(x * s.k + t * s.sp + s.ph);
    }
    function frame(now) {
      raf = 0;
      if (!visible || document.hidden) return;
      raf = requestAnimationFrame(frame);
      if (now - last < 1000 / FPS - 2) return;
      paint(now);
    }
    function paint(now) {
      var dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
      var t = (now - t0) / 1000;
      cx.clearRect(0, 0, W, H);
      cx.globalCompositeOperation = "lighter";
      cx.strokeStyle = grad; cx.lineCap = "round"; cx.lineJoin = "round";
      for (var i = 0; i < N; i++) {
        var s = strands[i];
        cx.globalAlpha = s.a * (0.85 + 0.15 * Math.sin(t * 0.8 + s.ph)); // a slow shimmer
        cx.lineWidth = Math.abs(s.u) < 0.25 ? 1.3 : 0.9;
        cx.beginPath();
        var x = -STEP, py = y(s, x, t);
        cx.moveTo(x, py);
        for (x = 0; x <= W + STEP; x += STEP) {
          var ny = y(s, x, t), mx = x - STEP / 2;
          cx.quadraticCurveTo(x - STEP, py, mx, (py + ny) / 2); // smooth through midpoints
          py = ny;
        }
        cx.lineTo(W + STEP, py);
        cx.stroke();
      }
      // glints: tiny lights carried by the current, twinkling
      for (var g = 0; g < glints.length; g++) {
        var q = glints[g];
        q.x += q.v * dt * (0.8 + 0.4 * (1 - Math.abs(strands[q.s].u)));
        if (q.x > W + 20) newGlint(q, false);
        var gy = y(strands[q.s], q.x, t), edge = Math.min(1, q.x / (W * 0.15), (W - q.x) / (W * 0.15));
        var al = Math.max(0, edge) * q.life * (0.35 + 0.65 * Math.abs(Math.sin(t * 1.6 + q.tw)));
        if (al <= 0.01) continue;
        var d = q.r * 10;
        cx.globalAlpha = al; cx.drawImage(spr, q.x - d / 2, gy - d / 2, d, d);
      }
      cx.globalAlpha = 1; cx.globalCompositeOperation = "source-over";
    }
    function start() { if (!raf && visible && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } }
    size();
    window.addEventListener("resize", function () { if (size()) paint(performance.now()); start(); });
    document.addEventListener("visibilitychange", start);
    if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; start(); }).observe(cv);
    start();
    requestAnimationFrame(function () { cv.classList.add("is-on"); });
  })();

  /* ---------- Scroll effects ----------
     Positions are measured once (and again on resize); each frame only reads scrollY and
     writes styles, so scrolling never forces the browser to recalculate the layout. */
  var progress = $("#progress");
  var hero = $(".hero"), heroBg = $(".hero__bg"), heroCopy = $(".hero__copy"), device = $("#heroDevice");
  var medias = phone ? [] : $$(".work__media");
  var steps = $$(".how li");
  var running = false, vh = 0, maxY = 0, heroH = 0, mPos = [], sPos = [], lit = [];
  function measure() {
    var y = window.scrollY;
    vh = window.innerHeight;
    maxY = document.documentElement.scrollHeight - vh;
    heroH = hero ? hero.offsetHeight : 0;
    mPos = medias.map(function (m) { var r = m.getBoundingClientRect(); return { top: r.top + y, h: r.height }; });
    sPos = steps.map(function (li) { var r = li.getBoundingClientRect(); return r.top + y + r.height / 2; });
    wake();
  }
  function frame() {
    running = false;
    var y = window.scrollY;
    if (progress) progress.style.setProperty("--p", maxY > 0 ? (y / maxY).toFixed(4) : 0);
    // hero (not on phones): background drifts, text lifts and fades, the phone tips back
    if (hero && !phone && y < heroH + 100) {
      var p = clamp(y / heroH, 0, 1);
      if (heroBg) heroBg.style.transform = "translate3d(0," + (y * 0.4).toFixed(1) + "px,0)";
      if (heroCopy) { heroCopy.style.transform = "translate3d(0," + (y * 0.22).toFixed(1) + "px,0)"; heroCopy.style.opacity = (1 - p * 1.25).toFixed(3); }
      if (device) device.style.setProperty("--sp", p.toFixed(3));
    }
    // reference phones drift in opposite directions
    mPos.forEach(function (mp, i) {
      var top = mp.top - y;
      if (top + mp.h < -50 || top > vh + 50) return;
      var k = clamp((top + mp.h / 2) / vh - 0.5, -1, 1), ph = medias[i].children;
      if (ph[0]) ph[0].style.translate = "0 " + (k * -34).toFixed(1) + "px";
      if (ph[1]) ph[1].style.translate = "0 " + (k * 30).toFixed(1) + "px";
    });
    // steps light up as they pass the lower third of the screen
    sPos.forEach(function (mid, i) {
      var on = mid - y < vh * 0.72;
      if (on !== lit[i]) { lit[i] = on; steps[i].classList.toggle("lit", on); }
    });
  }
  function wake() { if (!running) { running = true; requestAnimationFrame(frame); } }
  window.addEventListener("scroll", wake, { passive: true });
  window.addEventListener("resize", measure);
  window.addEventListener("load", measure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  // the page gets taller or shorter when a FAQ answer or a price card opens
  if ("ResizeObserver" in window) { var mt = 0; new ResizeObserver(function () { clearTimeout(mt); mt = setTimeout(measure, 120); }).observe(document.body); }
  measure();

  /* ---------- Prices count up the first time the plans come into view ---------- */
  var plans = $("#plans");
  if (plans && "IntersectionObserver" in window) {
    var once = new IntersectionObserver(function (es) {
      if (!es[0].isIntersecting) return;
      once.disconnect();
      var bill = ($('input[name="bill"]:checked') || {}).value || "m";
      $$(".amt b", plans).forEach(function (b, idx) {
        var to = parseInt(b.getAttribute("data-" + bill), 10);
        if (!to) return;
        var t0 = performance.now() + idx * 90, dur = 1100;
        b.textContent = "0";
        (function f(now) {
          var k = clamp((now - t0) / dur, 0, 1), e = 1 - Math.pow(1 - k, 4);
          var v = Math.round(to * e / 10) * 10;
          b.textContent = String(k < 1 ? v : to).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
          if (k < 1) requestAnimationFrame(f);
        })(performance.now());
      });
    }, { threshold: 0.25 });
    once.observe(plans);
  }

  /* ---------- Animations pause while their section is off screen ---------- */
  if ("IntersectionObserver" in window) {
    var offIO = new IntersectionObserver(function (es) {
      es.forEach(function (e) { e.target.classList.toggle("is-off", !e.isIntersecting); });
    }, { rootMargin: "100px 0px" });
    $$(".hero, .plan--featured, .hearth, .btn--shine").forEach(function (el) { offIO.observe(el); });
  }

  /* ---------- A ripple where you tap or click a button or link ---------- */
  {
    var TAP = 'a, button, label, summary, input, select, [role="button"], [data-planner], .chip, .opt';
    document.addEventListener("click", function (e) {
      if (!e.isTrusted || (e.clientX === 0 && e.clientY === 0)) return; // keyboard "clicks" have no position
      var t = e.target.closest && e.target.closest(TAP);
      if (!t) return;
      var host = t.closest("dialog[open]") || document.body;
      var r = document.createElement("span");
      r.className = "tap"; r.setAttribute("aria-hidden", "true");
      r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px";
      host.appendChild(r);
      var an = r.animate([
        { transform: "translate(-50%,-50%) scale(.25)", opacity: 0.9 },
        { transform: "translate(-50%,-50%) scale(1)", opacity: 0 }
      ], { duration: 520, easing: "cubic-bezier(.22,1,.36,1)" });
      an.onfinish = function () { r.remove(); };
      setTimeout(function () { if (r.parentNode) r.remove(); }, 900);
      // a tiny buzz on Android for the main buttons (iPhones ignore this)
      if (!finePointer && navigator.vibrate && t.matches(".btn, [data-planner], button")) { try { navigator.vibrate(8); } catch (x) { /* ignore */ } }
    }, true);
  }

  if (!finePointer) return;

  /* ---------- Desktop only: pointer effects ---------- */
  // glow inside the perk tiles
  $$(".perk").forEach(function (c) {
    c.addEventListener("pointermove", function (e) {
      var r = c.getBoundingClientRect();
      c.style.setProperty("--mx", (e.clientX - r.left) + "px");
      c.style.setProperty("--my", (e.clientY - r.top) + "px");
    });
  });
})();
