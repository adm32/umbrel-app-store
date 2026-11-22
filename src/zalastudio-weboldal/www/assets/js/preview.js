/* Zala Studio – shared preview renderer and package data (PLANS, FEATURES, TYPES).
   Draws a small example website inside a phone frame from the planner's answers.
   Used by the website (hero phone + planner) and by the Irányítópult app, whose copy
   (src/zalastudio-iranyitopult/web/preview.js) is made from this file by its build.sh. Edit only this one. */
(function (root) {
  "use strict";
  var fmt = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0"); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  /* ---------- Icons used in generated markup ---------- */
  var IC = {
    fork: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
    sparkle: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>',
    tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    bed: '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>',
    bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    case: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
    list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    form: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    cal: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
    cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    pages: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    crown: '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    fresh: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>'
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
    { id: "foglalas", label: "Online időpontfoglalás", sub: "Valódi szabad időpontokkal", icon: "cal" },
    { id: "rendeles", label: "Online rendelés", sub: "Étlapról vagy kisebb kínálatból", icon: "cart" },
    { id: "nyelv", label: "Német és angol nyelv", icon: "globe" },
    { id: "tobb", label: "Több aloldal", sub: "Például Rólunk, Szolgáltatások", icon: "pages" },
    { id: "kozosseg", label: "Facebook- és Instagram-linkek", sub: "Megosztás és követés gombok", icon: "heart" },
    { id: "kezeles", label: "Korlátlan módosítás", sub: "Bármit kérsz, 1\u00a0munkanapon belül", icon: "crown" }
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
    rendeles: { name: "Rendelés & Foglalás", short: "Rendelés", m: 12990, y: 129900, setup: 79000, now: 39500, from: true, why: "Az online rendeléshez és foglaláshoz kezelőprogram és értesítés is jár." },
    premium: { name: "Prémium Partner", short: "Prémium", m: 39990, y: 399900, setup: 349000, now: 174500, from: false, why: "Bármit kérsz, egy munkanapon belül átírjuk, és havonta jelentést kapsz." }
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
    if (has("kozosseg")) h += sec("kozosseg", '<h4>Kövess minket</h4><div class="ps-social"><span>' + svg("heart") + "Facebook</span><span>" + svg("image") + "Instagram</span></div>");
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
