/* Zala Studio – home page motion (index.html only).
   One requestAnimationFrame loop drives every scroll effect through transforms and CSS variables,
   with measurements cached on resize, and it sleeps when nothing moves. Canvases (stars, river,
   embers) draw at 30 fps and only while on screen. With "reduce motion" the page stays still.
   Exports window.__zsMoveThumb, used by site.js for the hero pills. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var mm = function (q) { return window.matchMedia ? window.matchMedia(q) : { matches: false }; };
  var out3 = function (t) { return 1 - Math.pow(1 - t, 3); };
  var inOut = function (t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  var outExpo = function (t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); };
  var html = document.documentElement;
  var motion = !mm("(prefers-reduced-motion: reduce)").matches;
  var fine = mm("(hover: hover) and (pointer: fine)").matches;
  var wideQ = mm("(min-width: 920px)");

  /* ---------- Sliding pill thumb (site.js calls this) + arrow keys on the hero pills ---------- */
  function moveThumb(bar, thumb, btn) {
    if (!bar || !thumb || !btn) return;
    thumb.style.width = btn.offsetWidth + "px";
    thumb.style.transform = "translate3d(" + btn.offsetLeft + "px,0,0)";
  }
  window.__zsMoveThumb = moveThumb;
  var pills = $$("#heroSwitch button[data-demo]");
  pills.forEach(function (b, i) {
    b.addEventListener("keydown", function (e) {
      var n = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: pills.length - 1 }[e.key];
      if (n == null) return;
      e.preventDefault();
      n = (n + pills.length) % pills.length;
      pills[n].focus(); pills[n].click();
    });
  });
  function resyncThumb() { moveThumb($("#heroSwitch"), $("#heroThumb"), $("#heroSwitch button.is-on")); }

  if (!document.body.classList.contains("home")) return;

  /* ---------- Cached style writes: touch the DOM only when a value really changes ---------- */
  function css(el, prop, v) {
    if (!el) return;
    var c = el.__fx || (el.__fx = {});
    if (c[prop] === v) return;
    c[prop] = v;
    if (prop.charCodeAt(0) === 45) el.style.setProperty(prop, v); else el.style[prop] = v;
  }
  function wipe(el, props) { if (!el) return; props.forEach(function (p) { if (p.charCodeAt(0) === 45) el.style.removeProperty(p); else el.style[p] = ""; }); el.__fx = {}; }
  var px = function (n) { return n.toFixed(1) + "px"; };
  var tr = function (x, y, s) { return "translate3d(" + px(x) + "," + px(y) + ",0)" + (s != null && s !== 1 ? " scale(" + s.toFixed(4) + ")" : ""); };

  /* ---------- Elements ---------- */
  var hero = $(".hero"), pin = $(".hero__pin"), grid = $(".hero__grid");
  var L = {};
  $$("[data-layer]").forEach(function (el) { L[el.getAttribute("data-layer")] = el; });
  var tilt = $("#heroTilt"), device = $("#heroDevice");
  var hz = $("#hz"), hzPin = $(".hz__pin"), track = $("#hzTrack"), cards = $$(".proj");
  var marqRows = $$("[data-marq]");
  var manifesto = $("#miert-h"), words = [];
  var steps = $(".steps"), stepsDraw = $("#stepsDraw"), stepEls = $$("[data-pstep]");
  var hearthEl = $(".hearth"), footWord = $(".foot__word"), footSpan = $(".foot__word span");
  var bar = $("#scrollBar");
  var navLinks = $$("[data-nav]");
  var headH = 64;

  /* ---------- Intro curtain (first visit of the session; boot.js decides and paints the black) ---------- */
  var sceneStart = 0, introOn = false;
  function intro() {
    if (!html.classList.contains("intro-pre")) { sceneStart = performance.now(); return; }
    if (!motion || window.scrollY > 40) { html.classList.remove("intro-pre"); sceneStart = performance.now(); return; }
    introOn = true;
    html.classList.add("intro-on");
    var el = document.createElement("div");
    el.className = "intro"; el.setAttribute("aria-hidden", "true");
    el.innerHTML = '<div class="intro__w"><span>zala</span><span>studio</span></div>';
    document.body.appendChild(el);
    html.classList.remove("intro-pre");
    var gone = false;
    function lift() {
      if (gone) return; gone = true;
      el.classList.add("is-out");
      html.classList.remove("intro-on");
      sceneStart = performance.now(); kick();
      setTimeout(function () { el.remove(); introOn = false; }, 650);
      ["wheel", "touchstart", "keydown"].forEach(function (t) { window.removeEventListener(t, lift); });
    }
    ["wheel", "touchstart", "keydown"].forEach(function (t) { window.addEventListener(t, lift, { passive: true }); });
    setTimeout(lift, 640);
  }

  /* ---------- Manifesto: split into words that light up with the scroll ---------- */
  if (manifesto && motion) {
    var txt = manifesto.textContent.trim().split(/\s+/);
    manifesto.setAttribute("aria-label", txt.join(" "));
    manifesto.innerHTML = txt.map(function (w, i) {
      return '<span class="mw' + (i >= txt.length - 2 ? " mw--hi" : "") + '" aria-hidden="true">' + w + "</span>";
    }).join(" ");
    words = $$(".mw", manifesto);
  }

  /* ---------- Measurements (on load, resize and any change of the page height) ---------- */
  var M = { vw: 0, vh: 0, docH: 0, wide: false, hero: null, hz: null, marq: null, man: null, steps: null, stepTops: [], hearth: null, foot: null, nav: [], stage: null };
  var mode = "";
  function box(el) { if (!el) return null; var r = el.getBoundingClientRect(); return { top: r.top + window.scrollY, h: r.height }; }
  function measure() {
    var vw = html.clientWidth, vh = window.innerHeight, wide = wideQ.matches;
    var newMode = (motion ? "m" : "s") + (wide ? "w" : "n");
    if (newMode !== mode) {
      // switching between phone and desktop layouts: clear the other layout's inline styles
      mode = newMode;
      wipe(track, ["transform"]); wipe(hz, ["height", "--hp"]);
      cards.forEach(function (c, i) { wipe(c, ["--lp", "--alp", "--gx", "--s", "--dim"]); c.style.setProperty("--i", i); });
      [L.copy, L.stage, tilt].forEach(function (el) { wipe(el, ["transform", "opacity", "pointerEvents"]); });
    }
    headH = ($("#head") || {}).offsetHeight || 64;
    // write phase: the horizontal gallery's scroll length
    var dist = 0;
    if (hz && track && hzPin) {
      if (motion && wide) {
        dist = Math.max(0, track.scrollWidth - vw);
        css(hz, "height", (hzPin.offsetHeight + dist) + "px");
      } else css(hz, "height", "");
    }
    // read phase
    M.vw = vw; M.vh = vh; M.wide = wide;
    M.docH = html.scrollHeight;
    M.hero = box(hero); if (M.hero) M.hero.pin = pin ? pin.offsetHeight : vh;
    if (L.stage && grid) M.stage = { top: grid.offsetTop + L.stage.offsetTop, h: L.stage.offsetHeight };
    M.hz = box(hz); if (M.hz) { M.hz.dist = dist; M.hz.pin = hzPin ? hzPin.offsetHeight : vh; M.hz.cx = cards.map(function (c) { return c.offsetLeft + c.offsetWidth / 2; }); }
    M.marq = box($(".marq"));
    marqRows.forEach(function (r) { var s = r.firstElementChild; r.__w = s ? s.offsetWidth : 0; });
    M.man = box(manifesto);
    M.steps = box(steps);
    M.stepTops = stepEls.map(function (s) { return box(s).top; });
    M.hearth = box(hearthEl);
    M.foot = box(footWord);
    M.nav = navLinks.map(function (a) { var t = document.getElementById(a.getAttribute("data-nav")); return t ? box(t).top : 1e9; });
    sizeCanvases();
    kick();
  }

  /* ---------- Main loop ---------- */
  var raf = 0, lastT = 0, ly = window.scrollY, vel = 0, svel = 0;
  var ptr = { x: 0, y: 0, lx: 0, ly: 0 }, cardRects = null;
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame(t) {
    raf = 0;
    var dt = lastT ? Math.min(64, t - lastT) : 16.7; lastT = t;
    var f = dt / 16.7;
    var sy = window.scrollY, prev = ly;
    ly += (sy - ly) * (1 - Math.pow(0.86, f));
    if (Math.abs(sy - ly) < 0.4) ly = sy;
    vel = (ly - prev) / f;
    svel += (vel - svel) * (1 - Math.pow(0.9, f));
    ptr.lx += (ptr.x - ptr.lx) * (1 - Math.pow(0.92, f));
    ptr.ly += (ptr.y - ptr.ly) * (1 - Math.pow(0.92, f));
    // reads before any write this frame (phone card stack needs live positions)
    cardRects = motion && !M.wide && M.hz && vis(M.hz, 200) ? cards.map(function (c) { return c.getBoundingClientRect(); }) : null;
    var busy = ly !== sy || Math.abs(ptr.x - ptr.lx) > 0.001 || Math.abs(ptr.y - ptr.ly) > 0.001 || Math.abs(svel) > 0.05;

    if (motion) {
      busy = heroFx(t) || busy;
      busy = marqFx(f) || busy;
      worksFx();
      manifestoFx(); stepsFx(); hearthFx(); footFx();
      busy = canvases(t) || busy;
      busy = cursorFx(f) || busy;
    }
    progressFx(sy);
    if (busy) raf = requestAnimationFrame(frame); else lastT = 0;
  }
  function vis(b, pad) { pad = pad || 0; return b && ly + M.vh + pad > b.top && ly - pad < b.top + b.h; }

  /* ---------- Hero: seven layers at different depths; the camera dives into the valley ---------- */
  function heroFx(t) {
    var H = M.hero;
    if (!H || ly > H.top + H.h + 50) return false;
    var vh = H.pin, p = clamp((ly - H.top) / Math.max(1, H.h - vh), 0, 1);
    var ip = sceneStart ? 1 - out3(clamp((t - sceneStart) / 1700, 0, 1)) : 1;
    var mx = fine ? ptr.lx : 0, my = fine ? ptr.ly : 0;
    function layer(el, depth, sink, s, x) {
      css(el, "transform", tr(-mx * depth + (x || 0), sink * vh + ip * vh * Math.abs(depth) * .009, s));
    }
    layer(L.stars, 4, -p * .05, 1);
    layer(L.sun, 10, p * .34, 1 + p * .35);
    css(L.sun, "opacity", (1 - ip * .6).toFixed(3));
    layer(L.word, 18, -p * .16, 1 + p * .95);
    css(L.word, "opacity", ((1 - p * .75) * (1 - ip)).toFixed(3));
    layer(L.far, 10, -p * .08, 1 + p * .06);
    layer(L.river, 14, -p * .19, 1);
    layer(L.mid, 18, -p * .21, 1 + p * .12);
    // the dive: the foreground stays low while the phone is on show, then rushes up over everything
    var dive = inOut(clamp((p - .55) / .45, 0, 1));
    layer(L.near, 28, -(p * .12 + dive * .3), 1 + p * .22);
    layer(L.reeds, 44, -(p * .08 + dive * .62), 1 + p * .1 + dive * .4);
    css(L.veil, "opacity", clamp((p - .72) / .28, 0, 1).toFixed(3));
    css(L.cue, "opacity", clamp(1 - p * 9, 0, 1).toFixed(3));

    var copyO, copyY, stY, stS = 1, rx, ry;
    if (M.wide) {
      var e1 = inOut(clamp(p / .5, 0, 1)), e2 = clamp((p - .5) / .5, 0, 1);
      copyY = -p * vh * .42; copyO = 1 - clamp(p * 1.9, 0, 1);
      css(L.copy, "transform", tr(mx * -8, copyY));
      stY = e2 * vh * .14 + ip * 140; stS = 1 + e1 * .12 - e2 * .08;
      css(L.stage, "transform", tr(-e1 * M.vw * .08 + mx * 10, stY, stS));
      ry = -20 + e1 * 20 + mx * 9; rx = 8 - e1 * 8 - my * 7 + ip * 30;
    } else {
      var shift = 0, S = M.stage;
      if (S) shift = Math.max(0, S.top - Math.max(headH + 6, headH + (vh - headH - S.h) / 2));
      var e = inOut(clamp(p / .7, 0, 1));
      copyY = -p * vh * .5; copyO = 1 - clamp(p * 2.6, 0, 1);
      css(L.copy, "transform", tr(0, copyY));
      css(L.stage, "transform", tr(0, -shift * e + ip * 90, .9 + e * .1));
      ry = 0; rx = (1 - e) * 26 + ip * 20;
    }
    css(L.copy, "opacity", copyO.toFixed(3));
    css(L.copy, "pointerEvents", copyO < .3 ? "none" : "");
    css(tilt, "transform", "rotateX(" + rx.toFixed(2) + "deg) rotateY(" + ry.toFixed(2) + "deg)");
    css(device, "--glare", (50 - ry * 2.2).toFixed(1) + "%");
    return ip > 0;
  }

  /* ---------- Marquee: runs on its own, faster (and backwards) with the scroll ---------- */
  var mq = { off: [0, 0], skew: 0 };
  function marqFx(f) {
    if (!marqRows.length || !vis(M.marq, 100)) return false;
    mq.skew += (clamp(-svel * .5, -14, 14) - mq.skew) * (1 - Math.pow(.85, f));
    marqRows.forEach(function (r, i) {
      var dir = parseFloat(r.getAttribute("data-marq")) || 1, w = r.__w || 1;
      mq.off[i] = (mq.off[i] + (1.1 + svel * .55) * dir * f) % w;
      var x = mq.off[i]; if (x > 0) x -= w;
      css(r, "transform", "translate3d(" + x.toFixed(1) + "px,0,0) skewX(" + mq.skew.toFixed(2) + "deg)");
    });
    return true;
  }

  /* ---------- Work: sideways gallery (desktop) or a stack of cards (phone) ---------- */
  function worksFx() {
    var Z = M.hz;
    if (!Z || !vis(Z, 200)) return;
    if (M.wide) {
      var hp = Z.dist ? clamp((ly - Z.top) / Z.dist, 0, 1) : 0, x = -hp * Z.dist;
      css(track, "transform", "translate3d(" + x.toFixed(1) + "px,0,0)");
      css(hz, "--hp", hp.toFixed(4));
      cards.forEach(function (c, i) {
        var lp = clamp((Z.cx[i] + x - M.vw / 2) / (M.vw * .8), -1, 1);
        css(c, "--lp", lp.toFixed(3)); css(c, "--alp", Math.abs(lp).toFixed(3));
        css(c, "--gx", (50 - lp * 40).toFixed(1) + "%");
      });
    } else if (cardRects) {
      var rs = cardRects;
      cards.forEach(function (c, i) {
        var lp = clamp((rs[i].top - M.vh * .3) / M.vh, -1, 1);
        css(c, "--lp", lp.toFixed(3));
        if (i === cards.length - 1) return;
        var stick = headH + 14 + (i + 1) * 10;
        var q = clamp(1 - (rs[i + 1].top - stick) / Math.max(1, M.vh - stick), 0, 1);
        css(c, "--s", (1 - q * .08).toFixed(4));
        css(c, "--dim", (q * .5).toFixed(3));
      });
    }
  }
  // keyboard: bring a focused card into view instead of letting the browser scroll the hidden overflow
  if (track) track.addEventListener("focusin", function (e) {
    if (!motion || !M.wide || !M.hz || !M.hz.dist) return;
    var c = e.target.closest(".proj"), i = cards.indexOf(c);
    if (i < 0) return;
    if (hzPin) hzPin.scrollLeft = 0;
    var hp = clamp((M.hz.cx[i] - M.vw / 2) / M.hz.dist, 0, 1);
    window.scrollTo(0, M.hz.top + hp * M.hz.dist);
  });

  // keyboard: a faded hero button that gets focus brings the hero back into view
  if (L.copy) L.copy.addEventListener("focusin", function () {
    if (motion && M.hero && window.scrollY > M.hero.top + 40) window.scrollTo(0, M.hero.top);
  });

  /* ---------- Manifesto, process river, CTA iris, footer word ---------- */
  function manifestoFx() {
    if (!words.length || !vis(M.man, 100)) return;
    var q = clamp((M.vh * .88 - (M.man.top - ly)) / (M.man.h + M.vh * .42), 0, 1), n = words.length;
    words.forEach(function (w, i) { css(w, "--on", clamp(q * (n + 2) - i, 0, 1).toFixed(2)); });
  }
  function stepsFx() {
    if (!steps || !vis(M.steps, 100)) return;
    var q = clamp((M.vh * .66 - (M.steps.top - ly)) / M.steps.h, 0, 1);
    css(stepsDraw, "clipPath", "inset(0 0 " + ((1 - q) * 100).toFixed(2) + "% 0)");
    stepEls.forEach(function (s, i) {
      var top = M.stepTops[i] - ly;
      if (top < M.vh * .62) s.classList.add("is-lit");
      else if (top > M.vh * .8) s.classList.remove("is-lit");
    });
  }
  function hearthFx() {
    if (!hearthEl || !vis(M.hearth, 100)) return;
    var q = clamp((M.vh - (M.hearth.top - ly)) / (M.vh * .78), 0, 1);
    css(hearthEl, "--iris", (8 + out3(q) * 112).toFixed(2) + "%");
  }
  function footFx() {
    if (!footSpan || !vis(M.foot, 50)) return;
    css(footSpan, "--fw", out3(clamp((M.vh - (M.foot.top - ly)) / (M.foot.h + M.vh * .2), 0, 1)).toFixed(3));
  }
  var curNav = -1;
  function progressFx(sy) {
    var max = Math.max(1, M.docH - M.vh);
    css(bar, "transform", "scaleX(" + clamp(sy / max, 0, 1).toFixed(4) + ")");
    var idx = -1;
    M.nav.forEach(function (top, i) { if (top - sy <= M.vh * .4) idx = i; });
    if (idx !== curNav) {
      curNav = idx;
      navLinks.forEach(function (a, i) { a.classList.toggle("is-cur", i === idx); if (i === idx) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
    }
  }

  /* ---------- Canvases ---------- */
  var DPR = Math.min(1.5, window.devicePixelRatio || 1);
  function makeCanvas(el) {
    if (!el || !el.getContext) return null;
    return { el: el, ctx: el.getContext("2d"), w: 0, h: 0, last: 0 };
  }
  function fit(c) {
    var w = c.el.clientWidth, h = c.el.clientHeight;
    if (!w || !h || (Math.abs(w - c.w) < 2 && Math.abs(h - c.h) < 90)) return false;
    c.w = w; c.h = h;
    c.el.width = Math.round(w * DPR); c.el.height = Math.round(h * DPR);
    c.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    return true;
  }
  var stars = makeCanvas($("#stars")), river = makeCanvas($("#river")), embers = makeCanvas($("#embers"));
  var starList = [], shoot = null, emberList = [];

  function seedStars() {
    var n = Math.min(380, Math.round(stars.w * stars.h / 4200));
    starList = [];
    for (var i = 0; i < n; i++) starList.push({ x: Math.random() * stars.w, y: Math.pow(Math.random(), 1.5) * stars.h * .78, r: Math.random() < .08 ? 1.1 + Math.random() * .8 : .35 + Math.random() * .7, ph: Math.random() * 6.28, sp: .0006 + Math.random() * .0022, a: .35 + Math.random() * .65 });
  }
  function drawStars(t) {
    var c = stars.ctx;
    c.clearRect(0, 0, stars.w, stars.h);
    for (var i = 0; i < starList.length; i++) {
      var s = starList[i], a = s.a * (motion ? .55 + .45 * Math.sin(t * s.sp + s.ph) : 1);
      c.fillStyle = "rgba(255,240,222," + a.toFixed(3) + ")";
      c.fillRect(s.x, s.y, s.r * 1.6, s.r * 1.6);
    }
    if (!motion) return;
    if (!shoot && Math.random() < .006) shoot = { x: Math.random() * stars.w * .7, y: Math.random() * stars.h * .3, t: t };
    if (shoot) {
      var k = (t - shoot.t) / 900;
      if (k >= 1) shoot = null;
      else {
        var x = shoot.x + k * 340, y = shoot.y + k * 120, g = c.createLinearGradient(x - 120, y - 42, x, y);
        g.addColorStop(0, "rgba(255,220,180,0)"); g.addColorStop(1, "rgba(255,236,214," + (1 - k).toFixed(2) + ")");
        c.strokeStyle = g; c.lineWidth = 1.6; c.beginPath(); c.moveTo(x - 120, y - 42); c.lineTo(x, y); c.stroke();
      }
    }
  }
  function drawRiver(t) {
    var c = river.ctx, w = river.w, h = river.h;
    c.clearRect(0, 0, w, h);
    c.globalCompositeOperation = "lighter";
    var g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, "rgba(255,106,43,0)"); g.addColorStop(.25, "rgba(255,106,43,.5)"); g.addColorStop(.55, "rgba(255,181,71,.65)"); g.addColorStop(.85, "rgba(255,77,126,.45)"); g.addColorStop(1, "rgba(255,77,126,0)");
    c.strokeStyle = g;
    var step = Math.max(10, w / 110);
    for (var i = 0; i < 9; i++) {
      c.globalAlpha = .1 + (i % 3) * .07;
      c.lineWidth = .8 + (i % 4) * .55;
      c.beginPath();
      for (var x = -step; x <= w + step; x += step) {
        var u = x / w;
        var y = h * (.52 + .2 * Math.sin(u * 5.2 + .6) * (1 - u * .4)) + Math.sin(x * .011 - t * .0011 * (1 + i * .13) + i * 1.7) * h * (.035 + i * .006) + (i - 4) * h * .018;
        if (x === -step) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
    // glints that drift along the water
    c.globalAlpha = 1;
    for (var j = 0; j < 14; j++) {
      var gx = ((t * .05 * (1 + j % 3 * .4) + j * 137) % (w + 80)) - 40, gu = gx / w;
      var gy = h * (.52 + .2 * Math.sin(gu * 5.2 + .6) * (1 - gu * .4)) + Math.sin(j * 2.1) * h * .06;
      var a = .35 + .35 * Math.sin(t * .003 + j);
      c.fillStyle = "rgba(255,230,190," + a.toFixed(2) + ")";
      c.fillRect(gx, gy, 10 + (j % 4) * 6, 1.4);
    }
    c.globalCompositeOperation = "source-over";
  }
  var EMBER_C = ["255,106,43", "255,181,71", "255,214,150", "255,77,126"];
  function drawEmbers() {
    var c = embers.ctx, w = embers.w, h = embers.h;
    c.clearRect(0, 0, w, h);
    while (emberList.length < Math.min(90, w / 9)) emberList.push({ x: Math.random() * w, y: h + Math.random() * h * .6, vy: .5 + Math.random() * 1.5, vx: (Math.random() - .5) * .5, r: .8 + Math.random() * 2.4, ph: Math.random() * 6.28, c: EMBER_C[(Math.random() * 4) | 0] });
    c.globalCompositeOperation = "lighter";
    for (var i = 0; i < emberList.length; i++) {
      var e = emberList[i];
      e.y -= e.vy; e.ph += .05; e.x += e.vx + Math.sin(e.ph) * .4;
      var life = clamp(e.y / h, 0, 1);
      if (e.y < -10) { e.y = h + 10; e.x = Math.random() * w; }
      c.fillStyle = "rgba(" + e.c + "," + (life * .18).toFixed(3) + ")";
      c.beginPath(); c.arc(e.x, e.y, e.r * 3.2, 0, 6.283); c.fill();
      c.fillStyle = "rgba(" + e.c + "," + (life * .9).toFixed(3) + ")";
      c.beginPath(); c.arc(e.x, e.y, e.r, 0, 6.283); c.fill();
    }
    c.globalCompositeOperation = "source-over";
  }
  function sizeCanvases() {
    if (stars && fit(stars)) { seedStars(); drawStars(performance.now()); stars.el.classList.add("is-on"); }
    if (river && fit(river)) { drawRiver(performance.now()); river.el.classList.add("is-on"); }
    if (embers && motion) fit(embers);
  }
  function canvases(t) {
    var any = false;
    var heroOn = M.hero && ly < M.hero.top + M.hero.h;
    if (heroOn && stars && stars.w) { any = true; if (t - stars.last > 33) { stars.last = t; drawStars(t); } }
    if (heroOn && river && river.w) { any = true; if (t - river.last > 33) { river.last = t; drawRiver(t); } }
    if (embers && embers.w && vis(M.hearth)) { any = true; if (t - embers.last > 33) { embers.last = t; drawEmbers(); } }
    return any;
  }

  /* ---------- Pointer: hero parallax, custom cursor, 3D tilt + spotlight, magnetic buttons ---------- */
  var cur = null, curPos = { x: -100, y: -100, rx: -100, ry: -100 };
  function cursorFx(f) {
    if (!cur) return false;
    curPos.rx += (curPos.x - curPos.rx) * (1 - Math.pow(.7, f));
    curPos.ry += (curPos.y - curPos.ry) * (1 - Math.pow(.7, f));
    css(cur.ring, "transform", "translate3d(" + curPos.rx.toFixed(1) + "px," + curPos.ry.toFixed(1) + "px,0)");
    return Math.abs(curPos.x - curPos.rx) + Math.abs(curPos.y - curPos.ry) > .3;
  }
  if (motion && fine) {
    cur = document.createElement("div");
    cur.className = "cur is-off"; cur.setAttribute("aria-hidden", "true");
    cur.innerHTML = '<i class="cur__ring"></i><i class="cur__dot"></i>';
    document.body.appendChild(cur);
    cur.ring = $(".cur__ring", cur); cur.dot = $(".cur__dot", cur);
    document.body.classList.add("has-cur");
    var HOT = "a, button, summary, label, [data-tilt], .plan";
    window.addEventListener("pointermove", function (e) {
      if (e.pointerType !== "mouse") { cur.classList.add("is-off"); return; }
      cur.classList.remove("is-off");
      curPos.x = e.clientX; curPos.y = e.clientY;
      cur.dot.style.transform = "translate3d(" + e.clientX + "px," + e.clientY + "px,0)";
      ptr.x = e.clientX / M.vw * 2 - 1; ptr.y = e.clientY / M.vh * 2 - 1;
      kick();
    }, { passive: true });
    document.addEventListener("pointerover", function (e) { cur.classList.toggle("is-on", !!(e.target.closest && e.target.closest(HOT))); });
    document.addEventListener("mouseout", function (e) { if (!e.relatedTarget) cur.classList.add("is-off"); });
    window.addEventListener("pointerdown", function () { cur.classList.add("is-down"); });
    window.addEventListener("pointerup", function () { cur.classList.remove("is-down"); });

    $$("[data-tilt], .plan").forEach(function (el) {
      var amp = el.classList.contains("plan") ? 5 : 9;
      el.addEventListener("pointermove", function (e) {
        if (e.pointerType !== "mouse") return;
        var r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        el.classList.add("is-tilting");
        el.style.setProperty("--mx", (x * 100).toFixed(1) + "%"); el.style.setProperty("--my", (y * 100).toFixed(1) + "%");
        el.style.setProperty("--rx", ((.5 - y) * amp).toFixed(2) + "deg"); el.style.setProperty("--ry", ((x - .5) * amp * 1.2).toFixed(2) + "deg");
      });
      el.addEventListener("pointerleave", function () {
        el.classList.remove("is-tilting");
        el.style.setProperty("--rx", "0deg"); el.style.setProperty("--ry", "0deg");
      });
    });

    $$(".btn--primary, .btn--ghost-dk, .btn--glass").forEach(function (b) {
      if (b.closest(".pl, .ck")) return;
      b.addEventListener("pointermove", function (e) {
        if (e.pointerType !== "mouse") return;
        var r = b.getBoundingClientRect();
        var dx = clamp((e.clientX - r.left - r.width / 2) * .28, -12, 12), dy = clamp((e.clientY - r.top - r.height / 2) * .4, -9, 9);
        b.classList.add("is-mag");
        b.style.translate = dx.toFixed(1) + "px " + dy.toFixed(1) + "px";
      });
      b.addEventListener("pointerleave", function () { b.classList.remove("is-mag"); b.style.translate = ""; });
    });
  }

  /* ---------- Little celebrations ---------- */
  var SPARK_C = ["#FF6A2B", "#FFB547", "#FF4D7E", "#FFD9A0", "#7C5CFF"];
  function sparks(x, y, n, spread) {
    if (!motion) return;
    for (var i = 0; i < n; i++) {
      var s = document.createElement("i");
      s.className = "spark";
      s.style.left = x + "px"; s.style.top = y + "px";
      s.style.setProperty("--c", SPARK_C[i % SPARK_C.length]);
      document.body.appendChild(s);
      var a = (i / n) * 6.283 + Math.random() * .5, d = spread * (.55 + Math.random() * .6);
      var an = s.animate([
        { transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
        { transform: "translate(calc(-50% + " + (Math.cos(a) * d).toFixed(0) + "px), calc(-50% + " + (Math.sin(a) * d).toFixed(0) + "px)) scale(0)", opacity: .2 }
      ], { duration: 560 + Math.random() * 260, easing: "cubic-bezier(.16,1,.3,1)" });
      an.onfinish = (function (el) { return function () { el.remove(); }; })(s);
    }
  }
  // the yearly switch: "2 months free" deserves a little burst (only the first two times)
  var yearBursts = 0, billY = $("#bill-y");
  if (billY) billY.addEventListener("change", function () {
    if (!billY.checked || yearBursts++ >= 2) return;
    var l = $('label[for="bill-y"]'), r = l.getBoundingClientRect();
    sparks(r.left + r.width / 2, r.top + r.height / 2, 14, 70);
  });

  function confetti() {
    var dlg = $("#planner");
    if (!motion || !dlg) return;
    var box = document.createElement("div");
    box.className = "confetti-box"; box.setAttribute("aria-hidden", "true");
    dlg.appendChild(box);
    var w = dlg.clientWidth, h = dlg.clientHeight;
    for (var i = 0; i < 70; i++) {
      var c = document.createElement("i");
      c.className = "confetti";
      c.style.background = SPARK_C[i % SPARK_C.length];
      c.style.left = (Math.random() * w).toFixed(0) + "px";
      box.appendChild(c);
      var drift = (Math.random() - .5) * 160, spin = (Math.random() * 900 - 450).toFixed(0);
      c.animate([
        { transform: "translate3d(0,-30px,0) rotate(0deg)", opacity: 1 },
        { transform: "translate3d(" + (drift * .6).toFixed(0) + "px," + (h * .5).toFixed(0) + "px,0) rotate(" + (spin / 2) + "deg)", opacity: 1, offset: .5 },
        { transform: "translate3d(" + drift.toFixed(0) + "px," + (h + 40) + "px,0) rotate(" + spin + "deg)", opacity: .6 }
      ], { duration: 1500 + Math.random() * 1100, delay: Math.random() * 280, easing: "cubic-bezier(.25,.46,.45,.94)", fill: "both" });
    }
    setTimeout(function () { box.remove(); }, 3100);
  }
  var doneStep = $('[data-step="done"]');
  if (doneStep && "MutationObserver" in window) {
    var wasOn = false;
    new MutationObserver(function () {
      var on = doneStep.classList.contains("is-on");
      if (on && !wasOn) setTimeout(confetti, 120);
      wasOn = on;
    }).observe(doneStep, { attributes: true, attributeFilter: ["class"] });
  }

  /* ---------- One-shot observers: count-up numbers, the tapping demo, the promise burst ---------- */
  if ("IntersectionObserver" in window) {
    var counted = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        if (!en.isIntersecting) return;
        counted.unobserve(en.target);
        var el = en.target, to = parseFloat(el.getAttribute("data-count")) || 0, from = parseFloat(el.getAttribute("data-from") || "0");
        if (!motion || from === to) return;
        var t0 = performance.now(), dur = 1500;
        var fmt = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " "); };
        (function step(t) {
          var k = clamp((t - t0) / dur, 0, 1);
          el.textContent = fmt(from + (to - from) * outExpo(k));
          if (k < 1) requestAnimationFrame(step);
          else { el.textContent = fmt(to); el.parentNode.classList.add("is-done"); }
        })(t0);
        el.textContent = fmt(from);
      });
    }, { threshold: .6 });
    $$("[data-count]").forEach(function (el) { counted.observe(el); });

    var once = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        if (!en.isIntersecting) return;
        once.unobserve(en.target);
        en.target.classList.add("is-vis");
        if (en.target.id === "promise") setTimeout(function () {
          var ok = $(".promise__ok"), r = ok && ok.getBoundingClientRect();
          if (r) sparks(r.left + r.width / 2, r.top + r.height / 2, 16, 80);
        }, 650);
      });
    }, { threshold: .55 });
    $$(".vv, #promise").forEach(function (el) { once.observe(el); });
  }

  /* ---------- Start ---------- */
  if (!motion) stepEls.forEach(function (st) { st.classList.add("is-lit"); });
  intro();
  measure();
  resyncThumb();
  var rq = 0;
  function remeasure() { if (rq) return; rq = requestAnimationFrame(function () { rq = 0; measure(); resyncThumb(); }); }
  window.addEventListener("scroll", kick, { passive: true });
  window.addEventListener("resize", remeasure);
  window.addEventListener("load", remeasure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(remeasure);
  if ("ResizeObserver" in window) new ResizeObserver(remeasure).observe(document.body);
  if (wideQ.addEventListener) wideQ.addEventListener("change", remeasure);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { lastT = 0; kick(); } });
  window.addEventListener("pageshow", function () { ly = window.scrollY; remeasure(); });
  ly = window.scrollY;
})();
