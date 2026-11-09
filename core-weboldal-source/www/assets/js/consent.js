/* Zala Studio – cookie banner.
   Nothing is stored until the visitor answers. "Rendben" asks the server for a visitor-ID cookie
   (zs_id, HttpOnly); "Nem kérem" only remembers the answer (zs_c=0) and deletes any ID.
   Any element with [data-cookie-settings] reopens the banner, so the choice can be changed. */
(function () {
  "use strict";
  var choice = (document.cookie.match(/(?:^|;\s*)zs_c=([01])/) || [])[1];
  var box = null;

  function ref() {
    try { if (document.referrer) { var u = new URL(document.referrer); if (u.host !== location.host) return u.host; } } catch (e) { /* ignore */ }
    return "";
  }
  function answer(ok) {
    choice = ok ? "1" : "0";
    try {
      fetch("/api/consent", { method: "POST", credentials: "same-origin", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: ok, p: location.pathname, r: ref() }) });
    } catch (e) {
      document.cookie = "zs_c=" + choice + ";path=/;max-age=31536000;samesite=lax";
    }
    close();
  }
  function close() {
    if (!box) return;
    var b = box; box = null;
    b.classList.remove("is-in");
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 400);
  }
  function open(again) {
    if (box) return;
    box = document.createElement("section");
    box.className = "ck";
    box.setAttribute("aria-label", "Sütik");
    var now = choice === "1" ? "Most: engedélyezve." : choice === "0" ? "Most: nincs süti." : "";
    box.innerHTML =
      '<p><b>Megjegyezhetünk?</b> Egy sütivel látjuk, ha visszatérsz, és mit néztél meg az oldalon. Csak nálunk marad, reklámra nem használjuk. ' +
      (again && now ? "<em>" + now + "</em> " : "") + '<a href="/adatvedelem.html#sutik">Részletek</a></p>' +
      '<div class="ck__btns"><button type="button" class="btn ck__b" data-ck="0">Nem kérem</button><button type="button" class="btn ck__b" data-ck="1">Rendben</button></div>';
    box.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-ck]");
      if (b) answer(b.getAttribute("data-ck") === "1");
    });
    document.body.appendChild(box);
    requestAnimationFrame(function () { requestAnimationFrame(function () { if (box) box.classList.add("is-in"); }); });
    if (again) { var f = box.querySelector("[data-ck]"); if (f) f.focus({ preventScroll: true }); }
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-cookie-settings]");
    if (t) { e.preventDefault(); open(true); }
  });
  if (!choice) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(function () { open(false); }, 900); });
    else setTimeout(function () { open(false); }, 900);
  }
})();
