/* core – shared preview renderer.
   Draws a small example website inside a phone frame from the planner's answers.
   Used by the website (hero phone + planner) and by the core Irányítópult app. */
(function (root) {
  "use strict";
  var fmt = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0"); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  /* ---------- Icons used in generated markup ---------- */
  var IC = {
    fork: '<path d="M7 3v7a2 2 0 0 1-4 0V3M5 3v18M17 21V3c-2.5 1.5-4 4.5-4 8h4"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
    tool: '<path d="M14.5 6.5a4 4 0 0 0 5 5l-8.5 8.5a2.1 2.1 0 0 1-3-3l8.5-8.5a4 4 0 0 0-2-2z"/><path d="M14.5 6.5L17 4"/>',
    bed: '<path d="M3 19V6M3 14h18v5M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="1.6"/>',
    bag: '<path d="M5 8h14l-1.2 12H6.2zM9 8V6.5a3 3 0 0 1 6 0V8"/>',
    case: '<rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M9 7.5V5h6v2.5M3.5 13h17"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".9"/><circle cx="4.5" cy="12" r=".9"/><circle cx="4.5" cy="18" r=".9"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5.5-5.5L6 19"/>',
    form: '<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M9 9h6M9 13h6M9 17h3"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    cart: '<path d="M3 4h2.2l2.3 11h10.3L20 8H7"/><circle cx="10" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z"/>',
    pages: '<path d="M8.5 3.5h8l3 3v11h-11z"/><path d="M5 7v13.5h11"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/>',
    crown: '<path d="M4 18.5h16M5 15.5l-1.2-8.5 5.2 4 3-6 3 6 5.2-4-1.2 8.5z"/>',
    phone: '<path d="M5.2 4h3.3l1.7 4.3-2.2 1.5a11 11 0 0 0 6.2 6.2l1.5-2.2 4.3 1.7v3.3a1.6 1.6 0 0 1-1.7 1.6A16.5 16.5 0 0 1 3.6 5.7 1.6 1.6 0 0 1 5.2 4z"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    chat: '<path d="M4 5.5h16v10H9l-5 4z"/>',
    check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    rocket: '<path d="M12 15l-3-3c1.5-4.5 4.5-7.5 10-8-.5 5.5-3.5 8.5-8 10z"/><path d="M9 12l-4 1 2-4h4M12 15l-1 4 4-2v-4"/>',
    leaf: '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19l7-7"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    fresh: '<path d="M12 3v18M3 12h18"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>'
  };
  var svg = function (n, w) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (w || 1.9) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (IC[n] || "") + "</svg>"; };

  /* ---------- Content model ---------- */
  var TYPES = {
    etterem: { label: "Étterem, kávézó", icon: "fork", sample: "Kemencés Bisztró", city: "Zalaegerszeg", title: "Házias ízek, kemencés pizza.", sub: "Ebéd, vacsora és kiszállítás.", cta: "Asztalfoglalás", open: "Most nyitva · 22:00-ig", listT: "Étlap", list: [["Napi menü", "2 290 Ft"], ["Kemencés pizza", "3 190 Ft"], ["Házi limonádé", "990 Ft"]], galT: "Hangulat", bookT: "Asztalfoglalás", features: ["arlista", "galeria", "rendeles"], style: "meleg" },
    szepseg: { label: "Szépség, egészség", icon: "sparkle", sample: "Rózsakert Szalon", city: "Keszthely", title: "Szánj időt magadra.", sub: "Kozmetika, manikűr, masszázs.", cta: "Időpontot kérek", open: "Ma nyitva · 9:00–18:00", listT: "Árlista", list: [["Arctisztító kezelés", "12 900 Ft"], ["Géllakk", "7 500 Ft"], ["Frissítő masszázs", "9 900 Ft"]], galT: "Szalonunk", bookT: "Időpontfoglalás", features: ["arlista", "foglalas", "galeria"], style: "lagy" },
    szaki: { label: "Szaki, építőipar", icon: "tool", sample: "Horváth Villanyszerelés", city: "Veszprém", title: "Gyors kiszállás, tiszta munka.", sub: "Szerelés, javítás, hibaelhárítás.", cta: "Ajánlatot kérek", open: "Hívható · H–Szo 7–19", listT: "Szolgáltatások", list: [["Hibaelhárítás", "24 órán belül"], ["Lakásfelújítás", "egyedi ár"], ["Árajánlat fotó alapján", "ingyenes"]], galT: "Referenciák", bookT: "Időpont felmérésre", features: ["arlista", "galeria", "ajanlat"], style: "friss" },
    szallas: { label: "Szállás, vendégház", icon: "bed", sample: "Szőlőhegy Vendégház", city: "Hévíz", title: "Csend, kilátás, pihenés.", sub: "Vendégház a dombok között.", cta: "Szabad szobák", open: "Szabad szoba: nov. 14–16.", listT: "Árak", list: [["Kétágyas szoba", "22 000 Ft / éj"], ["Reggeli", "3 500 Ft / fő"], ["Wellness", "a házban"]], galT: "Szobák", bookT: "Szobafoglalás", features: ["galeria", "foglalas", "nyelv"], style: "termeszetes" },
    bolt: { label: "Üzlet, bolt", icon: "bag", sample: "Napfény Virágbolt", city: "Szombathely", title: "Friss virág minden nap.", sub: "Csokrok, kaspók, ajándékok.", cta: "Kínálatunk", open: "Most nyitva · 18:00-ig", listT: "Kínálat", list: [["Szezonális csokor", "5 900 Ft-tól"], ["Cserepes növény", "2 490 Ft-tól"], ["Kiszállítás", "a városban"]], galT: "Galéria", bookT: "Előrendelés", features: ["arlista", "galeria", "kozosseg"], style: "termeszetes" },
    egyeb: { label: "Egyéb szolgáltatás", icon: "case", sample: "Kovács Könyvelés", city: "Budapest", title: "Megbízható, személyes.", sub: "Könyvelés kis vállalkozásoknak.", cta: "Kapcsolatfelvétel", open: "Hívható · H–P 8–17", listT: "Szolgáltatások", list: [["Egyéni vállalkozók", "havidíjas"], ["Bérszámfejtés", "egyedi ár"], ["Első konzultáció", "ingyenes"]], galT: "Rólunk", bookT: "Időpontkérés", features: ["arlista", "ajanlat"], style: "elegans" }
  };
  var TYPE_ORDER = ["etterem", "szepseg", "szaki", "szallas", "bolt", "egyeb"];

  var FEATURES = [
    { id: "arlista", label: "Árlista vagy étlap", icon: "list" },
    { id: "galeria", label: "Képgaléria", icon: "image" },
    { id: "ajanlat", label: "Ajánlatkérő űrlap", icon: "form" },
    { id: "foglalas", label: "Online időpontfoglalás", icon: "cal" },
    { id: "rendeles", label: "Online rendelés", icon: "cart" },
    { id: "nyelv", label: "Német és angol nyelv", icon: "globe" },
    { id: "tobb", label: "Több aloldal", sub: "Például Rólunk, Szolgáltatások", icon: "pages" },
    { id: "kozosseg", label: "Facebook és Instagram", sub: "A legújabb bejegyzések az oldalon", icon: "heart" },
    { id: "kezeles", label: "Intézzetek el mindent ti", sub: "Google- és Facebook-kezelés, korlátlan módosítás", icon: "crown" }
  ];
  var FEAT = {}; FEATURES.forEach(function (f) { FEAT[f.id] = f; });

  var STYLES = {
    meleg: { label: "Meleg, barátságos", sub: "Földszínek, otthonos hangulat", p: "#C2501F", on: "#FFFFFF", bg: "#FFF7EF", card: "#FFFFFF", ink: "#2A1D15", ink2: "#7B6656", head: "serif" },
    lagy: { label: "Lágy, elegáns", sub: "Púderes színek, finom betűk", p: "#B4597A", on: "#FFFFFF", bg: "#FCF4F5", card: "#FFFFFF", ink: "#2E1A22", ink2: "#866F79", head: "serif" },
    termeszetes: { label: "Természetes", sub: "Zöld árnyalatok, nyugodt", p: "#557650", on: "#FFFFFF", bg: "#F4F3EA", card: "#FFFFFF", ink: "#1E2A1D", ink2: "#66705F", head: "serif" },
    friss: { label: "Friss, modern", sub: "Tiszta kék, határozott", p: "#2560E0", on: "#FFFFFF", bg: "#F4F7FD", card: "#FFFFFF", ink: "#0F1A2E", ink2: "#5B6B82", head: "sans" },
    elegans: { label: "Prémium, sötét", sub: "Fekete és arany", p: "#CDA765", on: "#17130F", bg: "#13100D", card: "#1E1915", ink: "#F4ECE1", ink2: "#A99A88", head: "serif", dark: true }
  };
  var STYLE_ORDER = ["meleg", "lagy", "termeszetes", "friss", "elegans"];

  var SITUATIONS = [
    { id: "nincs", label: "Még nincs weboldalunk", icon: "sun" },
    { id: "facebook", label: "Csak Facebook-oldalunk van", icon: "heart" },
    { id: "regi", label: "Van, de megújítanánk", icon: "rocket" }
  ];
  var TIMINGS = [{ id: "surgos", label: "Minél előbb" }, { id: "honap", label: "1–2 hónapon belül" }, { id: "erdeklodik", label: "Csak tájékozódom" }];
  var CALLS = [{ id: "delelott", label: "Délelőtt" }, { id: "delutan", label: "Délután" }, { id: "barmikor", label: "Bármikor" }];

  var PLANS = {
    nevjegy: { name: "Névjegy", short: "Névjegy", m: 3490, y: 34900, setup: 19900, now: 9950, from: false, why: "Egy átlátható, egyoldalas oldal mindent tud, amit kiválasztottál." },
    vallalkozas: { name: "Vállalkozás", short: "Vállalk.", m: 6990, y: 69900, setup: 39900, now: 19950, from: false, why: "A galériához, a több oldalhoz és a nyelvekhez ez a csomag való." },
    rendeles: { name: "Rendelés & Foglalás", short: "Rendelés", m: 12990, y: 129900, setup: 79000, now: 39500, from: true, why: "Az online rendeléshez vagy foglaláshoz kezelőprogram és értesítés is jár." },
    premium: { name: "Prémium Partner", short: "Prémium", m: 39990, y: 399900, setup: 349000, now: 174500, from: false, why: "Te a vevőkkel foglalkozol, minden mást mi intézünk." }
  };
  var PLAN_ORDER = ["nevjegy", "vallalkozas", "rendeles", "premium"];

  function recommend(features) {
    var has = function (id) { return features.indexOf(id) > -1; };
    if (has("kezeles")) return "premium";
    if (has("foglalas") || has("rendeles")) return "rendeles";
    if (has("galeria") || has("tobb") || has("nyelv") || has("kozosseg")) return "vallalkozas";
    return "nevjegy";
  }
  var slug = function (s) {
    return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " es ")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "vallalkozas";
  };

  /* ---------- Preview renderer (used by the hero phone and the planner) ---------- */
  function siteHTML(s, known) {
    var t = TYPES[s.type] || TYPES.etterem, st = STYLES[s.style] || STYLES[t.style];
    var f = s.features || t.features;
    var has = function (id) { return f.indexOf(id) > -1; };
    var name = (s.biz || "").trim() || t.sample;
    var city = (s.city || "").trim() || t.city;
    var keys = [];
    var sec = function (k, html) { keys.push(k); return '<section class="ps-sec' + (known && !known[k] ? " ps-new" : "") + '" data-k="' + k + '">' + html + "</section>"; };
    var cta = has("rendeles") ? "Rendelés online" : has("foglalas") ? (s.type === "etterem" ? "Asztalfoglalás" : t.cta) : t.cta;
    var third = has("rendeles") ? ["cart", "Rendelés"] : has("foglalas") ? ["cal", "Foglalás"] : has("arlista") ? ["list", t.listT] : ["chat", "Írj"];
    var h = "";
    h += '<div class="ps-bar"><span>9:41</span><i></i></div>';
    h += '<div class="ps-url">' + svg("lock", 2.6) + '<span data-ps="url">' + esc(slug(name)) + ".hu</span></div>";
    h += '<div class="ps-scroll">';
    h += '<header class="ps-head"><span class="ps-logo" data-ps="logo">' + esc(name.charAt(0).toUpperCase()) + '</span><b class="ps-name" data-ps="name">' + esc(name) + "</b>" + (has("nyelv") ? '<span class="ps-lang">HU·DE·EN</span>' : "") + '<span class="ps-burger"></span></header>';
    h += '<div class="ps-hero"><span class="ps-open"><i></i>' + esc(t.open) + '</span><p class="ps-title">' + esc(t.title) + '</p><p class="ps-sub">' + esc(t.sub) + '</p><span class="ps-cta">' + esc(cta) + " →</span></div>";
    h += '<div class="ps-quick"><span>' + svg("phone") + "Hívás</span><span>" + svg("pin") + "Útvonal</span><span>" + svg(third[0]) + esc(third[1]) + "</span></div>";
    if (has("rendeles")) {
      h += sec("rendeles", '<h4>Rendelés online <small>Kiszállítás</small></h4>' + t.list.slice(0, 2).map(function (r) { return '<div class="ps-item"><span>' + esc(r[0]) + "</span><b>" + esc(r[1]) + "</b><em>+</em></div>"; }).join("") + '<div class="ps-cart"><span>Kosár · 2 tétel</span><span>Tovább →</span></div>');
    } else if (has("arlista")) {
      h += sec("arlista", "<h4>" + esc(t.listT) + "</h4><ul class=\"ps-list\">" + t.list.map(function (r) { return "<li><span>" + esc(r[0]) + "</span><b>" + esc(r[1]) + "</b></li>"; }).join("") + "</ul>");
    }
    if (has("foglalas")) {
      h += sec("foglalas", "<h4>" + esc(t.bookT) + ' <small>Szabad időpontok</small></h4><div class="ps-days"><span>H<b>4</b></span><span class="on">K<b>5</b></span><span>Sze<b>6</b></span><span>Cs<b>7</b></span><span>P<b>8</b></span></div><div class="ps-slots"><span>9:00</span><span>10:30</span><span>14:00</span></div>');
    }
    if (has("galeria")) h += sec("galeria", "<h4>" + esc(t.galT) + '</h4><div class="ps-gal"><i></i><i></i><i></i></div>');
    if (has("ajanlat")) h += sec("ajanlat", '<h4>Kérjen ajánlatot</h4><div class="ps-field">Név</div><div class="ps-field">Telefonszám</div><span class="ps-btn">Ajánlatot kérek</span>');
    if (has("tobb")) h += sec("tobb", '<h4>Rólunk</h4><ul class="ps-list"><li><span>Csapatunk</span><b>›</b></li><li><span>Szolgáltatásaink</span><b>›</b></li></ul>');
    if (has("kozosseg")) h += sec("kozosseg", '<h4>Kövessen minket</h4><div class="ps-social"><span>' + svg("heart") + "Facebook</span><span>" + svg("image") + "Instagram</span></div>");
    if (has("kezeles")) h += sec("kezeles", '<h4>Friss hírek <small>Ma</small></h4><ul class="ps-list"><li><span>Új szezonális kínálat</span><b>›</b></li><li><span>Ünnepi nyitvatartás</span><b>›</b></li></ul>');
    h += '<div class="ps-map"><span data-ps="city">' + esc(city) + "</span></div>";
    h += '<p class="ps-foot">© 2026 <span data-ps="name2">' + esc(name) + "</span></p>";
    h += "</div>";
    return { html: h, keys: keys, st: st, sig: [s.type, s.style, f.slice().sort().join(",")].join("|") };
  }
  function applyTheme(el, st) {
    el.style.setProperty("--ps-p", st.p); el.style.setProperty("--ps-on", st.on); el.style.setProperty("--ps-bg", st.bg);
    el.style.setProperty("--ps-card", st.card); el.style.setProperty("--ps-ink", st.ink); el.style.setProperty("--ps-ink2", st.ink2);
    el.style.setProperty("--ps-line", st.dark ? "rgba(255,255,255,.1)" : "rgba(0,0,0,.08)");
    el.style.setProperty("--ps-head", st.head === "sans" ? "var(--font)" : "var(--serif)");
    el.classList.toggle("ps--sans", st.head === "sans");
    el.classList.toggle("ps--dark", !!st.dark);
  }
  // Renders into a screen element; re-uses the DOM when only text changed.
  function render(screen, s, opts) {
    if (!screen) return;
    var ps = screen.__ps;
    if (!ps) { ps = document.createElement("div"); ps.className = "ps"; screen.appendChild(ps); screen.__ps = ps; screen.__known = null; }
    if (opts && opts.scroll) ps.classList.add("is-scrollable");
    var out = siteHTML(s, screen.__known);
    applyTheme(ps, out.st);
    if (screen.__sig !== out.sig || !ps.firstChild) {
      var y = ps.querySelector(".ps-scroll") ? ps.querySelector(".ps-scroll").scrollTop : 0;
      ps.innerHTML = out.html;
      if (y) ps.querySelector(".ps-scroll").scrollTop = y;
      screen.__sig = out.sig;
      var k = {}; out.keys.forEach(function (x) { k[x] = 1; }); screen.__known = k;
    } else {
      var t = TYPES[s.type] || TYPES.etterem;
      var name = (s.biz || "").trim() || t.sample;
      var set = function (key, v) { var n = ps.querySelector('[data-ps="' + key + '"]'); if (n && n.textContent !== v) n.textContent = v; };
      set("name", name); set("name2", name); set("logo", name.charAt(0).toUpperCase()); set("url", slug(name) + ".hu");
      set("city", (s.city || "").trim() || t.city);
    }
  }


  root.CorePreview = {
    IC: IC, svg: svg, fmt: fmt, esc: esc, slug: slug, recommend: recommend,
    TYPES: TYPES, TYPE_ORDER: TYPE_ORDER, FEATURES: FEATURES, FEAT: FEAT, STYLES: STYLES, STYLE_ORDER: STYLE_ORDER,
    SITUATIONS: SITUATIONS, TIMINGS: TIMINGS, CALLS: CALLS, PLANS: PLANS, PLAN_ORDER: PLAN_ORDER,
    siteHTML: siteHTML, applyTheme: applyTheme, render: render
  };
})(window);
