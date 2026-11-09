/* Zala Studio – motion effects (scroll, pointer, ribbon).
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

  /* ---------- Elements the scroll loop works on ---------- */
  var head = $("#head"), progress = $("#progress");
  var hero = $(".hero"), heroBg = $(".hero__bg"), heroCopy = $(".hero__copy"), device = $("#heroDevice");
  var medias = $$(".work__media");
  var steps = $$(".how li");
  var ribbon = $("#ribbon"), ribbonOn = false, rx = 0, rSet = 0, rDir = -1;
  var lastY = window.scrollY, vel = 0, running = false;

  // Ribbon: repeat the items until the track is wide enough to loop seamlessly.
  var perSet = ribbon ? ribbon.children.length : 0;
  function measureRibbon() {
    var k = ribbon.children;
    rSet = k[perSet] ? k[perSet].offsetLeft - k[0].offsetLeft : 0;
  }
  if (ribbon && perSet) {
    var set = ribbon.innerHTML;
    do { ribbon.insertAdjacentHTML("beforeend", set); } while (ribbon.scrollWidth < window.innerWidth * 3 && ribbon.children.length < perSet * 8);
    measureRibbon();
    window.addEventListener("resize", measureRibbon);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureRibbon);
    if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { ribbonOn = es[0].isIntersecting; if (ribbonOn) wake(); }).observe(ribbon.parentNode);
  }

  function frame() {
    running = false;
    var y = window.scrollY, vh = window.innerHeight;
    var dy = y - lastY; lastY = y;
    vel = vel * 0.88 + dy * 0.12;

    // reading progress
    if (progress) {
      var max = document.documentElement.scrollHeight - vh;
      progress.style.setProperty("--p", max > 0 ? (y / max).toFixed(4) : 0);
    }

    // hero: background drifts, text lifts and fades, the phone tips back
    if (hero && !phone) {
      var h = hero.offsetHeight;
      if (y < h + 100) {
        var p = clamp(y / h, 0, 1);
        if (heroBg) heroBg.style.transform = "translate3d(0," + (y * 0.4).toFixed(1) + "px,0)";
        if (heroCopy) { heroCopy.style.transform = "translate3d(0," + (y * 0.22).toFixed(1) + "px,0)"; heroCopy.style.opacity = (1 - p * 1.25).toFixed(3); }
        if (device) device.style.setProperty("--sp", p.toFixed(3));
      }
    }

    // reference phones drift in opposite directions
    if (!phone) medias.forEach(function (m) {
      var r = m.getBoundingClientRect();
      if (r.bottom < -50 || r.top > vh + 50) return;
      var k = clamp((r.top + r.height / 2) / vh - 0.5, -1, 1);
      var ph = m.children;
      if (ph[0]) ph[0].style.translate = "0 " + (k * -34).toFixed(1) + "px";
      if (ph[1]) ph[1].style.translate = "0 " + (k * 30).toFixed(1) + "px";
    });

    // steps light up as they pass the lower third of the screen
    steps.forEach(function (li) {
      var r = li.getBoundingClientRect();
      li.classList.toggle("lit", r.top + r.height / 2 < vh * 0.72);
    });

    // ribbon: always moving, faster while scrolling, and it follows the scroll direction
    if (ribbon && ribbonOn && rSet > 0) {
      if (Math.abs(dy) > 0.5) rDir = dy > 0 ? -1 : 1;
      rx += rDir * (0.9 + Math.min(24, Math.abs(vel) * 0.9));
      if (rx <= -rSet) rx += rSet;
      if (rx > 0) rx -= rSet;
      ribbon.style.transform = "translate3d(" + rx.toFixed(1) + "px,0,0)";
    }

    if ((ribbonOn && !document.hidden) || Math.abs(vel) > 0.05) wake();
  }
  function wake() { if (!running) { running = true; requestAnimationFrame(frame); } }
  window.addEventListener("scroll", wake, { passive: true });
  window.addEventListener("resize", wake);
  document.addEventListener("visibilitychange", wake);
  wake();

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

  /* ---------- Phones and tablets: a ripple where you tap a button or link ---------- */
  if (!finePointer) {
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
      if (navigator.vibrate && t.matches(".btn, [data-planner], button")) { try { navigator.vibrate(8); } catch (x) { /* ignore */ } }
    }, true);
  }

  if (!finePointer) return;

  /* ---------- Desktop only: pointer effects ---------- */
  // a short, soft white tail that follows the cursor and fades (no dot on the cursor itself).
  // The mouse points are smoothed with a Catmull-Rom spline and drawn as one tapered ribbon,
  // so the tail bends smoothly instead of in straight pieces.
  (function () {
    var cv = document.createElement("canvas"), cx = cv.getContext("2d");
    if (!cx) return;
    cv.className = "trail"; cv.setAttribute("aria-hidden", "true");
    document.body.appendChild(cv);
    var dpr = 1, W = 0, H = 0, pts = [], raf = 0, LIFE = 280, WIDTH = 2.6, ALPHA = 0.22;
    function size() {
      dpr = Math.min(2, window.devicePixelRatio || 1); W = window.innerWidth; H = window.innerHeight;
      cv.width = W * dpr; cv.height = H * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0); kick();
    }
    function kick() { if (!raf) raf = requestAnimationFrame(draw); }
    // Catmull-Rom: many small points between the recorded ones
    function smooth(p) {
      var out = [];
      for (var i = 0; i < p.length - 1; i++) {
        var p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
        var n = Math.max(2, Math.min(14, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2.5)));
        for (var j = 0; j < n; j++) {
          var t = j / n, t2 = t * t, t3 = t2 * t;
          out.push({
            x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
            y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
          });
        }
      }
      out.push(p[p.length - 1]);
      return out;
    }
    function draw() {
      raf = 0;
      var now = performance.now();
      while (pts.length && now - pts[0].t > LIFE) pts.shift();
      cx.clearRect(0, 0, W, H);
      if (pts.length < 2) { if (pts.length) kick(); return; }
      var s = smooth(pts), n = s.length, L = [], R = [];
      // the tail gets shorter as it ages: newest point is the head, width tapers to 0 at the end
      var fresh = Math.max(0, 1 - (now - pts[pts.length - 1].t) / LIFE);
      for (var i = 0; i < n; i++) {
        var a = s[Math.max(0, i - 1)], b = s[Math.min(n - 1, i + 1)];
        var tx = b.x - a.x, ty = b.y - a.y, len = Math.hypot(tx, ty) || 1;
        var w = WIDTH * 0.5 * Math.pow(i / (n - 1), 1.3) * (0.4 + 0.6 * fresh);
        var nx = -ty / len * w, ny = tx / len * w;
        L.push([s[i].x + nx, s[i].y + ny]); R.push([s[i].x - nx, s[i].y - ny]);
      }
      cx.beginPath();
      cx.moveTo(L[0][0], L[0][1]);
      for (i = 1; i < n; i++) cx.lineTo(L[i][0], L[i][1]);
      var h = s[n - 1], hw = Math.hypot(L[n - 1][0] - h.x, L[n - 1][1] - h.y);
      var ang = Math.atan2(L[n - 1][1] - h.y, L[n - 1][0] - h.x);
      cx.arc(h.x, h.y, hw, ang, ang + Math.PI, true); // rounded head
      for (i = n - 1; i >= 0; i--) cx.lineTo(R[i][0], R[i][1]);
      cx.closePath();
      var g = cx.createLinearGradient(s[0].x, s[0].y, h.x, h.y);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(1, "rgba(255,255,255," + (ALPHA * (0.5 + 0.5 * fresh)).toFixed(3) + ")");
      cx.fillStyle = g;
      cx.fill();
      kick(); // until the tail has faded
    }
    document.addEventListener("pointermove", function (e) {
      if (e.pointerType && e.pointerType !== "mouse") return;
      var list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (!list.length) list = [e];
      var now = performance.now();
      list.forEach(function (c) {
        var last = pts[pts.length - 1];
        if (last && Math.hypot(c.clientX - last.x, c.clientY - last.y) < 1.5) { last.t = Math.min(now, c.timeStamp || now); return; }
        pts.push({ x: c.clientX, y: c.clientY, t: Math.min(now, c.timeStamp || now) });
      });
      if (pts.length > 60) pts.splice(0, pts.length - 60);
      kick();
    }, { passive: true });
    var clear = function () { pts = []; kick(); };
    document.addEventListener("mouseout", function (e) { if (!e.relatedTarget) clear(); });
    window.addEventListener("blur", clear);
    window.addEventListener("resize", size);
    size();
  })();
  // glow inside the perk tiles
  $$(".perk").forEach(function (c) {
    c.addEventListener("pointermove", function (e) {
      var r = c.getBoundingClientRect();
      c.style.setProperty("--mx", (e.clientX - r.left) + "px");
      c.style.setProperty("--my", (e.clientY - r.top) + "px");
    });
  });
  // the main buttons lean towards the cursor
  $$("[data-magnet]").forEach(function (b) {
    b.addEventListener("pointermove", function (e) {
      var r = b.getBoundingClientRect();
      var x = (e.clientX - r.left - r.width / 2) * 0.22, y = (e.clientY - r.top - r.height / 2) * 0.35;
      b.style.translate = x.toFixed(1) + "px " + y.toFixed(1) + "px";
    });
    b.addEventListener("pointerleave", function () { b.style.translate = "0 0"; });
  });
})();
