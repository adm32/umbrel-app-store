/* admcore.hu – small, dependency-free enhancements. The page works without this file. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var SPRING = "linear(0, .009, .035 2.1%, .141 4.4%, .723 12.9%, .938 16.7%, 1.017 19.4%, 1.067, 1.099 24.3%, 1.108 26%, 1.104 27.9%, 1.061 34.2%, 1.031 39.6%, 1.002 50%, .993 58.4%, 1.001 84.6%, 1)";

  /* ---------- 1. Live demo phone ---------- */
  var TYPES = {
    etterem: {
      name: "Kemencés Bisztró",
      tag: "Házias ebéd és kemencés pizza, kiszállítással.",
      open: "Most nyitva, 21:00-ig",
      cta: "Rendelés online",
      quick: ["Étlap", "Kiszállítás", "Asztal", "Útvonal"],
      list: [["Napi menü (leves + főétel)", "1 990 Ft"], ["Kemencés pizza, 32 cm", "2 600 Ft"], ["Kiszállítás Zalaszentgróton", "ingyenes"]]
    },
    szepseg: {
      name: "Rózsakert Szépségszalon",
      tag: "Arcápolás, manikűr és pedikűr, bejelentkezéssel.",
      open: "Ma nyitva: 9:00–17:00",
      cta: "Időpontot kérek",
      quick: ["Árlista", "Időpont", "Galéria", "Útvonal"],
      list: [["Arctisztító kezelés", "9 500 Ft"], ["Géllakk", "6 500 Ft"], ["Pedikűr", "7 000 Ft"]]
    },
    iparos: {
      name: "Horváth Villanyszerelés",
      tag: "Hibaelhárítás és szerelés, Zalaszentgrót 30 km-es körzetében.",
      open: "Hívható: H–Szo 7:00–19:00",
      cta: "Hívjon most",
      quick: ["Munkák", "Körzet", "Képek", "Ajánlat"],
      list: [["Kiszállás 15 km-en belül", "ingyenes"], ["Hibaelhárítás", "24 órán belül"], ["Árajánlat fotó alapján", "díjmentes"]]
    },
    szallas: {
      name: "Szőlőhegy Vendégház",
      tag: "Csendes vendégház a szőlőhegyen, Hévíztől 25 percre.",
      open: "Szabad szoba: nov. 14–16.",
      cta: "Szabad szobák",
      quick: ["Szobák", "Árak", "Környék", "Útvonal"],
      list: [["Kétágyas szoba", "18 000 Ft / éj"], ["Reggeli", "3 500 Ft / fő"], ["Hévízi tófürdő", "25 perc"]]
    }
  };

  var phone = $("#phone");
  var nameInput = $("#demoName");
  if (phone && nameInput) {
    var el = {
      url: $("#mUrl"), logo: $("#mLogo"), name: $("#mName"), tag: $("#mTag"), open: $("#mOpen"),
      cta: $("#mCta"), quick: $("#mQuick"), list: $("#mList"), screen: $("#phoneScreen")
    };
    var current = "etterem";

    var slug = function (s) {
      return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
        .replace(/&/g, " es ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 34) || "vallalkozas";
    };
    var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };

    var renderName = function () {
      var t = TYPES[current];
      var n = nameInput.value.trim() || t.name;
      el.name.textContent = n;
      el.logo.textContent = n.charAt(0).toUpperCase();
      el.url.textContent = slug(n) + ".admcore.hu";
    };
    var renderType = function () {
      var t = TYPES[current];
      phone.dataset.type = current;
      nameInput.placeholder = "pl. " + t.name;
      el.tag.textContent = t.tag;
      el.open.textContent = t.open;
      el.cta.textContent = t.cta;
      el.quick.innerHTML = t.quick.map(function (q) { return "<span>" + esc(q) + "</span>"; }).join("");
      el.list.innerHTML = t.list.map(function (r) { return "<li><span>" + esc(r[0]) + "</span><b>" + esc(r[1]) + "</b></li>"; }).join("");
      renderName();
      if (!reduced && el.screen.animate) {
        try {
          el.screen.animate(
            [{ transform: "scale(.94)", filter: "blur(6px)", opacity: .35 }, { transform: "none", filter: "none", opacity: 1 }],
            { duration: 700, easing: SPRING }
          );
        } catch (e) {
          el.screen.animate([{ opacity: .3 }, { opacity: 1 }], { duration: 400, easing: "ease-out" });
        }
      }
    };

    nameInput.addEventListener("input", renderName);
    document.querySelectorAll('input[name="demoType"]').forEach(function (r) {
      r.addEventListener("change", function () { if (r.checked) { current = r.value; renderType(); } });
    });
    var checked = $('input[name="demoType"]:checked');
    if (checked && checked.value !== current) { current = checked.value; renderType(); } else { renderName(); }
  }

  /* ---------- 2. Specular highlight that follows the pointer ---------- */
  if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    var raf = 0, lastEv = null;
    document.addEventListener("pointermove", function (e) {
      lastEv = e;
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        var g = lastEv.target.closest && lastEv.target.closest(".glass");
        if (!g) return;
        var b = g.getBoundingClientRect();
        g.style.setProperty("--mx", (lastEv.clientX - b.left) + "px");
        g.style.setProperty("--my", (lastEv.clientY - b.top) + "px");
      });
    }, { passive: true });
  }

  /* ---------- 3. Plan buttons preselect the form ---------- */
  document.querySelectorAll("[data-plan]").forEach(function (a) {
    a.addEventListener("click", function () {
      var sel = $("#f-tipus");
      if (sel) sel.value = a.getAttribute("data-plan");
    });
  });

  /* ---------- 4. Close the mobile menu after picking a link ---------- */
  var sheet = $("#menu");
  if (sheet && sheet.hidePopover) {
    sheet.addEventListener("click", function (e) { if (e.target.closest("a")) sheet.hidePopover(); });
  }

  /* ---------- 5. Contact form ---------- */
  var form = $("#form");
  if (form) {
    var stamp = $("#f-t");
    if (stamp) stamp.value = String(Date.now());
    var status = $("#formStatus");
    var setStatus = function (state, msg) { status.dataset.state = state; status.textContent = msg; };
    var phoneFallback = form.getAttribute("data-fallback") || "";

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var tel = $("#f-telefon").value.trim(), mail = $("#f-email").value.trim();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      if (!tel && !mail) {
        setStatus("err", "Adjon meg egy telefonszámot vagy e-mail-címet, hogy vissza tudjam hívni.");
        $("#f-telefon").focus();
        return;
      }
      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = v; });
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      setStatus("", "Küldés…");
      var ctrl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 12000);
      fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(data),
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok && j.ok, msg: j.message }; });
      }).then(function (res) {
        clearTimeout(timer);
        if (res.ok) {
          form.classList.add("is-sent");
          setStatus("ok", "");
          var t = $("#thanks"); if (t) t.focus();
        } else {
          btn.disabled = false;
          setStatus("err", (res.msg || "Nem sikerült elküldeni az üzenetet.") + " " + phoneFallback);
        }
      }).catch(function () {
        clearTimeout(timer);
        btn.disabled = false;
        setStatus("err", "Nem sikerült elküldeni az üzenetet. " + phoneFallback);
      });
    });
  }
})();
