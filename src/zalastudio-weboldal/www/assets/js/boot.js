/* Runs before first paint (home page only).
   "js": scroll reveals may start hidden. "mo": motion allowed (no reduce-motion setting), so sections
   can be pinned for the scroll animations. "intro-pre": first visit of this session, paint black until
   fx.js lifts the intro curtain. If the scripts never run, everything falls back to plain visible content. */
(function (d) {
  var h = d.documentElement;
  h.classList.replace("no-js", "js");
  var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!still) {
    h.classList.add("mo");
    try {
      if (!sessionStorage.getItem("zsIntro") && !location.hash) { h.classList.add("intro-pre"); sessionStorage.setItem("zsIntro", "1"); }
    } catch (e) { /* storage blocked: no intro */ }
  }
  setTimeout(function () { h.classList.remove("intro-pre"); }, 1500);
  setTimeout(function () { if (!window.__admReady) h.classList.remove("js", "mo"); }, 2500);
})(document);
