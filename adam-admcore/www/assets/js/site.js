/* admcore.hu – interactions. No dependencies; the page works without this file. */
(function () {
  "use strict";
  window.__admReady = true;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var SPRING = "linear(0, .009, .035 2.1%, .141 4.4%, .723 12.9%, .938 16.7%, 1.017 19.4%, 1.067, 1.099 24.3%, 1.108 26%, 1.104 27.9%, 1.061 34.2%, 1.031 39.6%, 1.002 50%, .993 58.4%, 1.001 84.6%, 1)";
  var fmt = function (n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " "); };

  /* ---------- Scroll reveals ---------- */
  var rv = $$(".rv");
  if ("IntersectionObserver" in window && !reduced) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    rv.forEach(function (el) { io.observe(el); });
  } else {
    rv.forEach(function (el) { el.classList.add("in"); });
  }

  /* ---------- Header: glass on scroll, progress bar, active section ---------- */
  var head = $(".site-head"), nav = $(".nav");
  var links = $$("#navLinks a"), pill = $(".nav__pill");
  var sections = links.map(function (a) { return $(a.getAttribute("href")); });
  var movePill = function (a) {
    if (!pill) return;
    if (!a) { pill.style.opacity = "0"; return; }
    pill.style.opacity = "1";
    pill.style.width = a.offsetWidth + "px";
    pill.style.transform = "translateX(" + a.offsetLeft + "px)";
  };
  var ticking = false;
  var onScroll = function () {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var y = window.scrollY, max = document.documentElement.scrollHeight - innerHeight;
      head.classList.toggle("is-scrolled", y > 12);
      nav.style.setProperty("--sp", max > 0 ? (y / max).toFixed(4) : 0);
      var active = null;
      sections.forEach(function (s, i) { if (s && s.getBoundingClientRect().top < innerHeight * 0.4) active = links[i]; });
      links.forEach(function (a) { a.classList.toggle("is-active", a === active); });
      movePill(active);
      updateSteps();
    });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);

  /* ---------- Process line ---------- */
  var steps = $("#steps"), stepEls = $$(".step");
  function updateSteps() {
    if (!steps) return;
    var r = steps.getBoundingClientRect();
    var p = (innerHeight * 0.62 - r.top) / r.height;
    p = Math.max(0, Math.min(1, p));
    steps.style.setProperty("--p", reduced ? 1 : p.toFixed(3));
    stepEls.forEach(function (s) {
      var d = s.querySelector(".step__dot").getBoundingClientRect();
      s.classList.toggle("is-on", reduced || d.top < innerHeight * 0.62);
    });
  }
  onScroll();

  /* ---------- Mobile menu ---------- */
  var sheet = $("#menu");
  if (sheet && sheet.hidePopover) sheet.addEventListener("click", function (e) { if (e.target.closest("a")) sheet.hidePopover(); });

  /* ---------- Live demo phone ---------- */
  var TYPES = {
    etterem: { name: "Kemencés Bisztró", tag: "Házias ebéd és kemencés pizza, kiszállítással.", open: "Most nyitva, 21:00-ig", cta: "Rendelés online", quick: ["Étlap", "Kiszállítás", "Asztal", "Útvonal"], list: [["Napi menü (leves + főétel)", "1 990 Ft"], ["Kemencés pizza, 32 cm", "2 600 Ft"], ["Kiszállítás Zalaszentgróton", "ingyenes"]] },
    szepseg: { name: "Rózsakert Szépségszalon", tag: "Arcápolás, manikűr és pedikűr, bejelentkezéssel.", open: "Ma nyitva: 9:00–17:00", cta: "Időpontot kérek", quick: ["Árlista", "Időpont", "Galéria", "Útvonal"], list: [["Arctisztító kezelés", "9 500 Ft"], ["Géllakk", "6 500 Ft"], ["Pedikűr", "7 000 Ft"]] },
    iparos: { name: "Horváth Villanyszerelés", tag: "Hibaelhárítás és szerelés, Zalaszentgrót 30 km-es körzetében.", open: "Hívható: H–Szo 7:00–19:00", cta: "Hívjon most", quick: ["Munkák", "Körzet", "Képek", "Ajánlat"], list: [["Kiszállás 15 km-en belül", "ingyenes"], ["Hibaelhárítás", "24 órán belül"], ["Árajánlat fotó alapján", "díjmentes"]] },
    szallas: { name: "Szőlőhegy Vendégház", tag: "Csendes vendégház a szőlőhegyen, Hévíztől 25 percre.", open: "Szabad szoba: nov. 14–16.", cta: "Szabad szobák", quick: ["Szobák", "Árak", "Környék", "Útvonal"], list: [["Kétágyas szoba", "18 000 Ft / éj"], ["Reggeli", "3 500 Ft / fő"], ["Hévízi tófürdő", "25 perc"]] }
  };
  var ORDER = ["etterem", "szepseg", "iparos", "szallas"];
  var phone = $("#phone"), nameInput = $("#demoName");
  if (phone && nameInput) {
    var el = { url: $("#mUrl"), logo: $("#mLogo"), name: $("#mName"), tag: $("#mTag"), open: $("#mOpen"), cta: $("#mCta"), quick: $("#mQuick"), list: $("#mList"), screen: $("#phoneScreen") };
    var current = "etterem";
    var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
    var slug = function (s) {
      return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " es ")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 34) || "vallalkozas";
    };
    var renderName = function () {
      var n = nameInput.value.trim() || TYPES[current].name;
      el.name.textContent = n;
      el.logo.textContent = n.charAt(0).toUpperCase();
      el.url.textContent = slug(n) + ".admcore.hu";
    };
    var renderType = function (animate) {
      var t = TYPES[current];
      phone.dataset.type = current;
      nameInput.placeholder = t.name;
      el.tag.textContent = t.tag; el.open.textContent = t.open; el.cta.textContent = t.cta;
      el.quick.innerHTML = t.quick.map(function (q) { return "<span>" + esc(q) + "</span>"; }).join("");
      el.list.innerHTML = t.list.map(function (r) { return "<li><span>" + esc(r[0]) + "</span><b>" + esc(r[1]) + "</b></li>"; }).join("");
      renderName();
      if (animate !== false && !reduced && el.screen.animate) {
        try {
          el.screen.animate([{ transform: "scale(.95)", filter: "blur(6px)", opacity: .4 }, { transform: "none", filter: "none", opacity: 1 }], { duration: 700, easing: SPRING });
        } catch (e) { /* older browsers: no animation */ }
      }
    };
    var setType = function (key, animate) {
      current = key;
      var r = $("#t-" + key); if (r) r.checked = true;
      renderType(animate);
    };

    // Autoplay: types example names until the visitor touches the controls.
    var auto = !reduced, autoTimer = null, autoIdx = 0;
    var stopAuto = function () {
      if (!auto) return;
      auto = false; clearTimeout(autoTimer);
      nameInput.value = ""; renderName();
    };
    var typeName = function (text, done) {
      var i = 0;
      (function step() {
        if (!auto) return;
        nameInput.value = text.slice(0, ++i); renderName();
        autoTimer = setTimeout(i < text.length ? step : done, i < text.length ? 55 + Math.random() * 60 : 1900);
      })();
    };
    var eraseName = function (done) {
      (function step() {
        if (!auto) return;
        nameInput.value = nameInput.value.slice(0, -1); renderName();
        autoTimer = setTimeout(nameInput.value ? step : done, 22);
      })();
    };
    var loop = function () {
      if (!auto) return;
      var key = ORDER[autoIdx % ORDER.length]; autoIdx++;
      setType(key);
      autoTimer = setTimeout(function () { typeName(TYPES[key].name, function () { eraseName(loop); }); }, 450);
    };

    nameInput.addEventListener("input", function () { if (!auto) renderName(); });
    ["pointerdown", "focusin", "keydown"].forEach(function (ev) { $(".demo__controls").addEventListener(ev, stopAuto, { once: false }); });
    $$('input[name="demoType"]').forEach(function (r) {
      r.addEventListener("change", function () { if (r.checked) { stopAuto(); setType(r.value); } });
    });

    if (auto && "IntersectionObserver" in window) {
      var started = false;
      var dio = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting && !started) { started = true; nameInput.value = ""; autoTimer = setTimeout(loop, 900); }
          if (!e.isIntersecting && started && auto) { clearTimeout(autoTimer); started = false; }
        });
      }, { threshold: 0.4 });
      dio.observe(phone);
    } else { renderName(); }

    // Phone follows the pointer a little (desktop only)
    if (finePointer && !reduced) {
      var stage = $(".demo");
      stage.addEventListener("pointermove", function (e) {
        var b = phone.getBoundingClientRect();
        var x = (e.clientX - b.left) / b.width - 0.5, y = (e.clientY - b.top) / b.height - 0.5;
        phone.style.setProperty("--ry", (x * 10).toFixed(2) + "deg");
        phone.style.setProperty("--rx", (-y * 8).toFixed(2) + "deg");
      });
      stage.addEventListener("pointerleave", function () { phone.style.setProperty("--ry", "0deg"); phone.style.setProperty("--rx", "0deg"); });
    }
  }

  /* ---------- Pointer effects (desktop): tile spotlight, magnetic button, case tilt ---------- */
  if (finePointer && !reduced) {
    $$(".tile").forEach(function (t) {
      t.addEventListener("pointermove", function (e) {
        var b = t.getBoundingClientRect();
        t.style.setProperty("--mx", (e.clientX - b.left) + "px");
        t.style.setProperty("--my", (e.clientY - b.top) + "px");
      });
    });
    $$(".magnetic").forEach(function (m) {
      m.addEventListener("pointermove", function (e) {
        var b = m.getBoundingClientRect();
        var x = e.clientX - b.left - b.width / 2, y = e.clientY - b.top - b.height / 2;
        m.style.transform = "translate(" + (x * 0.12).toFixed(1) + "px," + (y * 0.25).toFixed(1) + "px)";
      });
      m.addEventListener("pointerleave", function () { m.style.transform = ""; });
    });
    $$(".case__media").forEach(function (c) {
      var s = c.querySelector(".tilt");
      c.addEventListener("pointermove", function (e) {
        var b = c.getBoundingClientRect();
        var x = (e.clientX - b.left) / b.width - 0.5, y = (e.clientY - b.top) / b.height - 0.5;
        s.style.setProperty("--ry", (x * 12).toFixed(2) + "deg");
        s.style.setProperty("--rx", (-y * 10).toFixed(2) + "deg");
      });
      c.addEventListener("pointerleave", function () { s.style.setProperty("--ry", "0deg"); s.style.setProperty("--rx", "0deg"); });
    });
  }

  /* ---------- Bento: search typing, live opening hours ---------- */
  var q = $("#searchQ");
  if (q && "IntersectionObserver" in window && !reduced) {
    var full = q.textContent; q.textContent = "";
    var sres = $(".sres"); sres.style.opacity = "0"; sres.style.translate = "0 10px"; sres.style.transition = "opacity .6s, translate .8s " + "cubic-bezier(.22,1,.36,1)";
    var sio = new IntersectionObserver(function (es) {
      if (!es[0].isIntersecting) return; sio.disconnect();
      var i = 0;
      (function t() {
        q.textContent = full.slice(0, ++i);
        if (i < full.length) setTimeout(t, 45 + Math.random() * 50);
        else setTimeout(function () { sres.style.opacity = "1"; sres.style.translate = "0 0"; $(".sres__map .pin").style.setProperty("--play", "running"); }, 350);
      })();
    }, { threshold: 0.5 });
    sio.observe(q.closest(".viz-search"));
  } else { var pin = $(".sres__map .pin"); if (pin) pin.style.setProperty("--play", "running"); }

  var openText = $("#openText"), openDot = $("#openDot"), nowBar = $("#hoursNow");
  var updateOpen = function () {
    if (!openText) return;
    var d = new Date(), h = d.getHours() + d.getMinutes() / 60;
    var hh = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    var isOpen = h >= 11 && h < 21;
    openText.textContent = isOpen ? "Most " + hh + " · nyitva 21:00-ig" : "Most " + hh + " · zárva, " + (h < 11 ? "ma" : "holnap") + " 11:00-kor nyit";
    openDot.classList.toggle("is-closed", !isOpen);
    nowBar.style.setProperty("--now", (h / 24 * 100).toFixed(2) + "%");
  };
  updateOpen(); setInterval(updateOpen, 30000);

  /* ---------- Pricing: monthly / yearly with rolling numbers ---------- */
  var roll = function (b, to) {
    var from = parseInt(b.textContent.replace(/\D/g, ""), 10) || 0;
    if (reduced || from === to) { b.textContent = fmt(to); return; }
    var t0 = performance.now(), dur = 700;
    b.classList.add("is-rolling");
    (function f(now) {
      var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 4);
      b.textContent = fmt(Math.round(from + (to - from) * e / 10) * 10 || to);
      if (k < 1) requestAnimationFrame(f); else { b.textContent = fmt(to); b.classList.remove("is-rolling"); }
    })(t0);
  };
  $$('input[name="bill"]').forEach(function (r) {
    r.addEventListener("change", function () {
      var k = r.value;
      $$(".amt").forEach(function (a) {
        var b = a.querySelector("b"), s = a.querySelector("span");
        roll(b, parseInt(b.getAttribute("data-" + k), 10));
        s.textContent = s.getAttribute("data-" + k);
        var pd = a.parentNode.querySelector(".perday span");
        if (pd) pd.textContent = fmt(Math.round(parseInt(b.getAttribute("data-" + k), 10) / (k === "y" ? 365 : 30)));
      });
    });
  });

  /* ---------- Music: "Hamarosan" dialog ---------- */
  var dlg = $("#soonDlg");
  $$("[data-soon]").forEach(function (b) {
    b.addEventListener("click", function () {
      if (dlg && dlg.showModal) dlg.showModal();
      else alert("Hamarosan! A zenei szolgáltatások rendelése még nem elérhető.");
    });
  });
  if (dlg) {
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    $$("[data-close]", dlg).forEach(function (a) { a.addEventListener("click", function () { dlg.close(); }); });
  }

  /* ---------- Plan buttons preselect the form ---------- */
  $$("[data-plan]").forEach(function (a) {
    a.addEventListener("click", function () { var sel = $("#f-tipus"); if (sel) sel.value = a.getAttribute("data-plan"); });
  });

  /* ---------- Contact form ---------- */
  var form = $("#form");
  if (form) {
    var stamp = $("#f-t"); if (stamp) stamp.value = String(Date.now());
    var status = $("#formStatus");
    var setStatus = function (state, msg) { status.dataset.state = state; status.textContent = msg; };
    var fallback = form.getAttribute("data-fallback") || "";
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      if (!$("#f-telefon").value.trim() && !$("#f-email").value.trim()) {
        setStatus("err", "Adjon meg egy telefonszámot vagy e-mail-címet, hogy vissza tudjam hívni."); $("#f-telefon").focus(); return;
      }
      var data = {}; new FormData(form).forEach(function (v, k) { data[k] = v; });
      var btn = form.querySelector('button[type="submit"]'); btn.disabled = true;
      setStatus("", "Küldés…");
      var ctrl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 12000);
      fetch(form.action, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(data), signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok && j.ok, msg: j.message }; }); })
        .then(function (res) {
          clearTimeout(timer);
          if (res.ok) { form.classList.add("is-sent"); setStatus("ok", ""); var t = $("#thanks"); if (t) t.focus(); }
          else { btn.disabled = false; setStatus("err", (res.msg || "Nem sikerült elküldeni az üzenetet.") + " " + fallback); }
        })
        .catch(function () { clearTimeout(timer); btn.disabled = false; setStatus("err", "Nem sikerült elküldeni az üzenetet. " + fallback); });
    });
  }
})();
