/* Marks the page as script-enabled before first paint, so scroll reveals can start hidden.
   If the main script never runs, the page falls back to fully visible content. */
(function (d) {
  d.documentElement.classList.replace("no-js", "js");
  setTimeout(function () { if (!window.__admReady) d.documentElement.classList.remove("js"); }, 2500);
})(document);
