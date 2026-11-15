/* Payment page: after "Tovább" the browser waits for Stripe's page to open.
   Show that it is working, and stop a second tap from sending the form again. */
(function () {
  "use strict";
  var f = document.querySelector(".pay__form"), b = f && f.querySelector(".pay__go");
  if (!b) return;
  var label = b.querySelector("span"), idle = label ? label.textContent : "";
  function busy(on) {
    b.classList.toggle("is-loading", on); b.disabled = on;
    if (label) label.textContent = on ? "Átirányítás a Stripe-hoz…" : idle;
  }
  // after the browser has taken the form data, so the click still counts
  f.addEventListener("submit", function () { setTimeout(function () { busy(true); }, 0); });
  // back from Stripe with the back button: the page comes from the cache, the button works again
  window.addEventListener("pageshow", function (e) { if (e.persisted) busy(false); });
})();
