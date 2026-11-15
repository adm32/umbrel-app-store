/* Zala Studio – the little motion the page keeps: headings rise in, and the river from
   the logo flows behind the hero. The page works the same without it, and nothing runs
   when the visitor asked for reduced motion. */
(function () {
  "use strict";
  if (!window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var phone = window.matchMedia("(max-width: 699px)").matches;

  /* ---------- Headings: split into words that rise out of a mask ---------- */
  function splitWords(el) {
    var n = 0;
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (c) {
        if (c.nodeType === 3) {
          var frag = document.createDocumentFragment();
          // split on ordinary spaces only: a no-break space ("3\u00a0490\u00a0Ft") keeps its words together
          c.textContent.split(/([ \t\n\r]+)/).forEach(function (part) {
            if (!part) return;
            if (/^[ \t\n\r]+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
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
     The Zala from the logo: a band of fine strands that meander, widen and narrow. One
     canvas, one rAF loop; it sleeps while the hero is off screen or the tab is hidden.
     Phones draw fewer strands. */
  (function () {
    var cv = document.getElementById("river");
    if (!cv || !cv.getContext) return;
    var cx = cv.getContext("2d"), W = 0, H = 0, dpr = 1, visible = true, raf = 0, last = 0, t0 = performance.now();
    var N = phone ? 13 : 20;            // strands
    var STEP = phone ? 22 : 18;         // px between points along a strand (curves smooth between them)
    var FPS = 30;          // the river moves slowly: more frames would only cost battery
    var strands = [], grad = null;
    for (var i = 0; i < N; i++) {
      var u = i / (N - 1) * 2 - 1;      // -1 … 1 across the band
      strands.push({ u: u, ph: Math.random() * 6.28, k: 0.006 + Math.random() * 0.006, sp: 0.25 + Math.random() * 0.35, amp: 2 + Math.random() * 5,
        a: (phone ? 1.6 : 1.25) * (0.05 + 0.2 * Math.pow(1 - Math.abs(u), 1.6)) });
    }
    // Only when the river's own size changes. iOS Safari fires "resize" every time its address
    // bar grows or shrinks during a scroll; resetting then made the river blink.
    function size() {
      var r = cv.getBoundingClientRect();
      var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
      if (w === W && h === H) return false;
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
      last = now;
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

  /* ---------- Animations pause while the hero is off screen ---------- */
  if ("IntersectionObserver" in window) {
    var hero = $(".hero");
    if (hero) new IntersectionObserver(function (es) { hero.classList.toggle("is-off", !es[0].isIntersecting); }, { rootMargin: "100px 0px" }).observe(hero);
  }
})();
