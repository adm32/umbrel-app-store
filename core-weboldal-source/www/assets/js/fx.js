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

  if (!finePointer) return;

  /* ---------- Desktop only: pointer effects ---------- */
  // a small glow on the cursor with a short tail that follows it and fades
  (function () {
    var cv = document.createElement("canvas"), cx = cv.getContext("2d");
    if (!cx) return;
    cv.className = "trail"; cv.setAttribute("aria-hidden", "true");
    document.body.appendChild(cv);
    var dpr = 1, W = 0, H = 0, pts = [], head = null, on = false, raf = 0, LIFE = 280;
    function size() {
      dpr = Math.min(2, window.devicePixelRatio || 1); W = window.innerWidth; H = window.innerHeight;
      cv.width = W * dpr; cv.height = H * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0); kick();
    }
    function kick() { if (!raf) raf = requestAnimationFrame(draw); }
    function draw() {
      raf = 0;
      var now = performance.now();
      while (pts.length && now - pts[0].t > LIFE) pts.shift();
      cx.clearRect(0, 0, W, H);
      if (!on || !head) return;
      // tail: segments get thinner and fainter towards the end
      for (var i = 1; i < pts.length; i++) {
        var a = pts[i - 1], b = pts[i], k = 1 - (now - b.t) / LIFE;
        if (k <= 0) continue;
        cx.strokeStyle = "rgba(238,125,70," + (k * 0.55).toFixed(3) + ")";
        cx.lineWidth = 1 + k * 5; cx.lineCap = "round";
        cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); cx.stroke();
      }
      // head: a soft glow with a bright centre
      var g = cx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 16);
      g.addColorStop(0, "rgba(248,180,76,.55)"); g.addColorStop(.35, "rgba(238,125,70,.28)"); g.addColorStop(1, "rgba(238,125,70,0)");
      cx.fillStyle = g; cx.beginPath(); cx.arc(head.x, head.y, 16, 0, 6.2832); cx.fill();
      if (pts.length > 1) kick(); // keep animating until the tail has faded
    }
    document.addEventListener("pointermove", function (e) {
      if (e.pointerType && e.pointerType !== "mouse") return;
      var list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (!list.length) list = [e];
      var now = performance.now();
      list.forEach(function (c) { pts.push({ x: c.clientX, y: c.clientY, t: Math.min(now, c.timeStamp || now) }); });
      if (pts.length > 80) pts.splice(0, pts.length - 80);
      head = { x: e.clientX, y: e.clientY }; on = true; kick();
    }, { passive: true });
    document.addEventListener("mouseout", function (e) { if (!e.relatedTarget) { on = false; pts = []; kick(); } });
    window.addEventListener("blur", function () { on = false; pts = []; kick(); });
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
