/* Zala Studio – home page motion (index.html only).
   One requestAnimationFrame loop drives every scroll effect through transforms and CSS variables,
   with measurements cached on resize, and it sleeps when nothing moves. The river canvases draw at
   30 fps and only while on screen. With "reduce motion" the page stays still.
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
  var head = $("#head");
  var hero = $(".hero"), pin = $(".hero__pin"), grid = $(".hero__grid");
  var L = {};
  $$("[data-layer]").forEach(function (el) { L[el.getAttribute("data-layer")] = el; });
  var tilt = $("#heroTilt"), device = $("#heroDevice");
  var hz = $("#hz"), hzPin = $(".hz__pin"), track = $("#hzTrack"), cards = $$(".proj");
  var marqRows = $$("[data-marq]");
  var manifesto = $("#miert-h"), words = [];
  var steps = $(".steps"), stepsSvg = $("#stepsSvg"), stepsBase = $("#stepsBase"), stepsLine = $("#stepsLine"), stepEls = $$("[data-pstep]");
  var process = $("#folyamat"), foot = $(".foot");
  var hearthEl = $(".hearth"), footWord = $(".foot__word"), footSpan = $(".foot__word span");
  var vv = $(".vv");
  var bar = $("#scrollBar");
  var navLinks = $$("[data-nav]");
  var headH = 64;

  /* ---------- Intro curtain (first visit of the session; boot.js decides and paints it) ---------- */
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

  /* ---------- Process line: drawn to the real pixel size, so both ends stay round ---------- */
  var lineLen = 0;
  function stepsGeometry() {
    if (!stepsSvg || !stepsLine) return;
    var w = stepsSvg.clientWidth, h = stepsSvg.clientHeight;
    if (!w || !h) return;
    var pad = 8, n = 4, seg = (h - pad * 2) / n, cx = w / 2, a = w * .34;
    var xs = [cx, cx + a, cx - a, cx + a, cx];
    var d = "M" + xs[0].toFixed(1) + " " + pad;
    for (var k = 0; k < n; k++) {
      var y0 = pad + seg * k, y1 = y0 + seg;
      d += " C" + xs[k].toFixed(1) + " " + (y0 + seg * .5).toFixed(1) + " " + xs[k + 1].toFixed(1) + " " + (y1 - seg * .5).toFixed(1) + " " + xs[k + 1].toFixed(1) + " " + y1.toFixed(1);
    }
    stepsSvg.setAttribute("viewBox", "0 0 " + w + " " + h);
    stepsSvg.removeAttribute("preserveAspectRatio");
    stepsBase.setAttribute("d", d); stepsLine.setAttribute("d", d);
    lineLen = stepsLine.getTotalLength ? stepsLine.getTotalLength() : 0;
    stepsLine.style.strokeDasharray = lineLen.toFixed(1) + " " + (lineLen + 20).toFixed(1);
    stepsLine.__fx = {};
    if (!motion) stepsLine.style.strokeDashoffset = "0";
  }

  /* ---------- Measurements (on load, resize and any change of the page height) ---------- */
  var M = { vw: 0, vh: 0, docH: 0, wide: false, hero: null, hz: null, marq: null, man: null, steps: null, stepTops: [], hearth: null, foot: null, nav: [], stage: null, dark: [] };
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
    headH = head ? head.offsetHeight : 64;
    // write phase: the sideways gallery's scroll length, the process line's shape
    var dist = 0;
    if (hz && track && hzPin) {
      if (motion && wide) {
        dist = Math.max(0, track.scrollWidth - vw);
        css(hz, "height", (hzPin.offsetHeight + dist) + "px");
      } else css(hz, "height", "");
    }
    stepsGeometry();
    // read phase
    M.vw = vw; M.vh = vh; M.wide = wide;
    M.docH = html.scrollHeight;
    M.hero = box(hero); if (M.hero) M.hero.pin = pin ? pin.offsetHeight : vh;
    if (L.stage && grid) M.stage = { top: grid.offsetTop + L.stage.offsetTop, h: L.stage.offsetHeight };
    M.hz = box(hz); if (M.hz) { M.hz.dist = dist; M.hz.cx = cards.map(function (c) { return c.offsetLeft + c.offsetWidth / 2; }); }
    M.marq = box($(".marq"));
    marqRows.forEach(function (r) { var s = r.firstElementChild; r.__w = s ? s.offsetWidth : 0; });
    M.man = box(manifesto);
    M.steps = box(steps);
    M.stepTops = stepEls.map(function (s) { return box(s).top; });
    M.hearth = box(hearthEl);
    M.foot = box(footWord);
    M.dark = [box(process), box(foot)].filter(Boolean);
    M.nav = navLinks.map(function (a) { var t = document.getElementById(a.getAttribute("data-nav")); return t ? box(t).top : 1e9; });
    // the tap demo aims at the real buttons
    if (vv) [1, 2, 3].forEach(function (n) {
      var t = $('[data-tap="' + n + '"]', vv);
      if (!t) return;
      vv.style.setProperty("--t" + n + "x", Math.round(t.offsetLeft + t.offsetWidth * (n === 2 ? .38 : .5)) + "px");
      vv.style.setProperty("--t" + n + "y", Math.round(t.offsetTop + t.offsetHeight / 2) + "px");
    });
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
    }
    progressFx(sy);
    if (busy) raf = requestAnimationFrame(frame); else lastT = 0;
  }
  function vis(b, pad) { pad = pad || 0; return b && ly + M.vh + pad > b.top && ly - pad < b.top + b.h; }

  /* ---------- Hero: copy lifts away, the phone turns to face you, the river rises and widens ---------- */
  var heroP = 0;
  function heroFx(t) {
    var H = M.hero;
    if (!H || ly > H.top + H.h + 50) return false;
    var vh = H.pin, p = clamp((ly - H.top) / Math.max(1, H.h - vh), 0, 1);
    heroP = p;
    var ip = sceneStart ? 1 - out3(clamp((t - sceneStart) / 1600, 0, 1)) : 1;
    var mx = fine ? ptr.lx : 0, my = fine ? ptr.ly : 0;
    css(L.glow, "transform", tr(-mx * 14, -p * vh * .08));
    css(L.river, "transform", tr(-mx * 22, -p * vh * .16 + ip * vh * .08));
    css(L.veil, "transform", "translate3d(0," + ((1 - inOut(clamp((p - .62) / .38, 0, 1))) * 104).toFixed(2) + "%,0)");
    css(L.cue, "opacity", clamp(1 - p * 9, 0, 1).toFixed(3));

    var copyO, rx, ry;
    if (M.wide) {
      var e1 = inOut(clamp(p / .5, 0, 1)), e2 = clamp((p - .5) / .5, 0, 1);
      copyO = 1 - clamp(p * 1.9, 0, 1);
      css(L.copy, "transform", tr(mx * -8, -p * vh * .42));
      css(L.stage, "transform", tr(-e1 * M.vw * .08 + mx * 10, e2 * vh * .14 + ip * 140, 1 + e1 * .12 - e2 * .08));
      ry = -20 + e1 * 20 + mx * 9; rx = 8 - e1 * 8 - my * 7 + ip * 30;
    } else {
      var shift = 0, S = M.stage;
      if (S) shift = Math.max(0, S.top - Math.max(headH + 6, headH + (vh - headH - S.h) / 2));
      var e = inOut(clamp(p / .7, 0, 1));
      copyO = 1 - clamp(p * 2.6, 0, 1);
      css(L.copy, "transform", tr(0, -p * vh * .5));
      css(L.stage, "transform", tr(0, -shift * e + ip * 90, .9 + e * .1));
      ry = 0; rx = (1 - e) * 26 + ip * 20;
    }
    css(L.copy, "opacity", copyO.toFixed(3));
    css(L.copy, "pointerEvents", copyO < .3 ? "none" : "");
    css(tilt, "transform", "rotateX(" + rx.toFixed(2) + "deg) rotateY(" + ry.toFixed(2) + "deg)");
    css(device, "--glare", (50 - ry * 2.2).toFixed(1) + "%");
    return ip > 0;
  }
  // keyboard: a faded hero button that gets focus brings the hero back into view
  if (L.copy) L.copy.addEventListener("focusin", function () {
    if (motion && M.hero && window.scrollY > M.hero.top + 40) window.scrollTo(0, M.hero.top);
  });

  /* ---------- Marquee: runs on its own, faster (and backwards) with the scroll ---------- */
  var mq = { off: [0, 0], skew: 0 };
  function marqFx(f) {
    if (!marqRows.length || !vis(M.marq, 100)) return false;
    mq.skew += (clamp(-svel * .5, -12, 12) - mq.skew) * (1 - Math.pow(.85, f));
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
        css(c, "--lp", clamp((rs[i].top - M.vh * .3) / M.vh, -1, 1).toFixed(3));
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
    var i = cards.indexOf(e.target.closest(".proj"));
    if (i < 0) return;
    if (hzPin) hzPin.scrollLeft = 0;
    window.scrollTo(0, M.hz.top + clamp((M.hz.cx[i] - M.vw / 2) / M.hz.dist, 0, 1) * M.hz.dist);
  });

  /* ---------- Manifesto, process line, CTA iris, footer word ---------- */
  function manifestoFx() {
    if (!words.length || !vis(M.man, 100)) return;
    var q = clamp((M.vh * .88 - (M.man.top - ly)) / (M.man.h + M.vh * .42), 0, 1), n = words.length;
    words.forEach(function (w, i) { css(w, "--on", clamp(q * (n + 2) - i, 0, 1).toFixed(2)); });
  }
  function stepsFx() {
    if (!steps || !vis(M.steps, 100)) return;
    var q = clamp((M.vh * .66 - (M.steps.top - ly)) / M.steps.h, 0, 1);
    if (stepsLine && lineLen) {
      css(stepsLine, "strokeDashoffset", (lineLen * (1 - q)).toFixed(1));
      css(stepsLine, "visibility", q < .003 ? "hidden" : "");
    }
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
  var curNav = -1, onDk = null;
  function progressFx(sy) {
    css(bar, "transform", "scaleX(" + clamp(sy / Math.max(1, M.docH - M.vh), 0, 1).toFixed(4) + ")");
    var idx = -1;
    M.nav.forEach(function (top, i) { if (top - sy <= M.vh * .4) idx = i; });
    if (idx !== curNav) {
      curNav = idx;
      navLinks.forEach(function (a, i) { a.classList.toggle("is-cur", i === idx); if (i === idx) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
    }
    // the header turns graphite while it sits over a dark section
    var y = sy + headH / 2, dk = M.dark.some(function (b) { return y > b.top && y < b.top + b.h; });
    if (head && dk !== onDk) { onDk = dk; head.classList.toggle("on-dk", dk); }
  }

  /* ---------- River canvases: a ribbon of fine lines, cool steel with one warm reflection ---------- */
  var DPR = Math.min(1.5, window.devicePixelRatio || 1);
  function makeCanvas(el, opt) {
    if (!el || !el.getContext) return null;
    return { el: el, ctx: el.getContext("2d"), w: 0, h: 0, last: 0, o: opt };
  }
  function fit(c) {
    var w = c.el.clientWidth, h = c.el.clientHeight;
    if (!w || !h || (Math.abs(w - c.w) < 2 && Math.abs(h - c.h) < 90)) return false;
    c.w = w; c.h = h;
    c.el.width = Math.round(w * DPR); c.el.height = Math.round(h * DPR);
    c.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var g = c.ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, "rgba(142,160,186,0)");
    g.addColorStop(.16, "rgba(142,160,186,1)");
    g.addColorStop(.34, "rgba(178,186,198,1)");
    g.addColorStop(c.o.warm, "rgba(240,120,58,1)");
    g.addColorStop(Math.min(.9, c.o.warm + .2), "rgba(170,178,192,1)");
    g.addColorStop(1, "rgba(142,160,186,0)");
    c.grad = g;
    return true;
  }
  function ribbon(c, t, spreadK, yK, mx) {
    var ctx = c.ctx, w = c.w, h = c.h, o = c.o;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = c.grad;
    var n = M.wide ? o.lines : Math.round(o.lines * .65), step = Math.max(8, w / 110), ph = t * o.speed + (mx || 0) * .35;
    var amp = h * o.amp, spread = h * o.spread * spreadK, cy = h * (o.y + yK);
    for (var i = 0; i < n; i++) {
      var k = i / (n - 1), mid = 1 - Math.abs(k - .5) * 2;
      ctx.globalAlpha = o.alpha * (.2 + .8 * mid * mid);
      ctx.lineWidth = .6 + mid * .7;
      ctx.beginPath();
      for (var x = -step; x <= w + step; x += step) {
        var u = x / w;
        var c0 = cy + Math.sin(u * 3.6 + ph * .9) * amp * .6 + Math.sin(u * 8.2 - ph * 1.2 + 1.3) * amp * .16;
        var wd = spread * (.16 + .84 * Math.sin(u * 2.4 - ph * .55 + 1.1));
        var y = c0 + (k - .5) * wd + Math.sin(u * 12 + ph * 1.6 + k * 5) * h * .003;
        if (x === -step) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
  var river = makeCanvas($("#river"), { lines: 48, amp: .2, spread: .4, alpha: .78, y: .5, speed: .00026, warm: .44 });
  var hRiver = makeCanvas($("#hearthRiver"), { lines: 30, amp: .14, spread: .42, alpha: .6, y: .7, speed: .0002, warm: .62 });
  function drawRiver(t) { ribbon(river, t, 1 + heroP * .9, -heroP * .1, fine ? ptr.lx : 0); }
  function sizeCanvases() {
    var now = performance.now();
    if (river && fit(river)) { drawRiver(now); river.el.classList.add("is-on"); }
    if (hRiver && fit(hRiver)) ribbon(hRiver, now, 1, 0, 0);
  }
  function canvases(t) {
    var any = false;
    if (river && river.w && M.hero && ly < M.hero.top + M.hero.h) { any = true; if (t - river.last > 33) { river.last = t; drawRiver(t); } }
    if (hRiver && hRiver.w && vis(M.hearth)) { any = true; if (t - hRiver.last > 33) { hRiver.last = t; ribbon(hRiver, t, 1, 0, 0); } }
    return any;
  }

  /* ---------- Pointer (mouse only): hero depth, 3D tilt with a soft light, magnetic buttons ---------- */
  if (motion && fine) {
    window.addEventListener("pointermove", function (e) {
      if (e.pointerType !== "mouse") return;
      ptr.x = e.clientX / M.vw * 2 - 1; ptr.y = e.clientY / M.vh * 2 - 1;
      if (M.hero && window.scrollY < M.hero.top + M.hero.h) kick();
    }, { passive: true });

    $$("[data-tilt], .plan").forEach(function (el) {
      var amp = el.classList.contains("plan") ? 4 : 8;
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
        var dx = clamp((e.clientX - r.left - r.width / 2) * .25, -10, 10), dy = clamp((e.clientY - r.top - r.height / 2) * .35, -8, 8);
        b.classList.add("is-mag");
        b.style.translate = dx.toFixed(1) + "px " + dy.toFixed(1) + "px";
      });
      b.addEventListener("pointerleave", function () { b.classList.remove("is-mag"); b.style.translate = ""; });
    });
  }

  /* ---------- Little celebrations ---------- */
  var SPARK_C = ["#E8622A", "#F2A66E", "#8EA0BA", "#14161A"];
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
  // the yearly switch: "2 months free" earns a small burst (only the first two times)
  var yearBursts = 0, billY = $("#bill-y");
  if (billY) billY.addEventListener("change", function () {
    if (!billY.checked || yearBursts++ >= 2) return;
    var l = $('label[for="bill-y"]'), r = l.getBoundingClientRect();
    sparks(r.left + r.width / 2, r.top + r.height / 2, 12, 64);
  });

  var CONF_C = ["#E8622A", "#F2A66E", "#14161A", "#8EA0BA", "#E9DCCB"];
  function confetti() {
    var dlg = $("#planner");
    if (!motion || !dlg) return;
    var holder = document.createElement("div");
    holder.className = "confetti-box"; holder.setAttribute("aria-hidden", "true");
    dlg.appendChild(holder);
    var w = dlg.clientWidth, h = dlg.clientHeight;
    for (var i = 0; i < 64; i++) {
      var c = document.createElement("i");
      c.className = "confetti";
      c.style.background = CONF_C[i % CONF_C.length];
      c.style.left = (Math.random() * w).toFixed(0) + "px";
      holder.appendChild(c);
      var drift = (Math.random() - .5) * 160, spin = Math.round(Math.random() * 900 - 450);
      c.animate([
        { transform: "translate3d(0,-30px,0) rotate(0deg)", opacity: 1 },
        { transform: "translate3d(" + (drift * .6).toFixed(0) + "px," + (h * .5).toFixed(0) + "px,0) rotate(" + (spin / 2) + "deg)", opacity: 1, offset: .5 },
        { transform: "translate3d(" + drift.toFixed(0) + "px," + (h + 40) + "px,0) rotate(" + spin + "deg)", opacity: .6 }
      ], { duration: 1500 + Math.random() * 1100, delay: Math.random() * 280, easing: "cubic-bezier(.25,.46,.45,.94)", fill: "both" });
    }
    setTimeout(function () { holder.remove(); }, 3100);
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
          if (k < 1) requestAnimationFrame(step); else el.textContent = fmt(to);
        })(t0);
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
          if (r) sparks(r.left + r.width / 2, r.top + r.height / 2, 12, 70);
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
