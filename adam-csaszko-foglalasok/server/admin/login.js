(function () {
  'use strict';
  var f = document.querySelector('[data-login]');
  var err = document.querySelector('[data-error]');
  var pw = f.password;
  fetch('/api/login-info', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
    if (!d.enabled) { f.hidden = true; document.querySelector('[data-off]').hidden = false; }
  }).catch(function () {});
  document.querySelector('[data-show]').addEventListener('change', function (e) { pw.type = e.target.checked ? 'text' : 'password'; });
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    err.hidden = true;
    if (!pw.value) { err.textContent = 'Írd be a jelszót.'; err.hidden = false; pw.focus(); return; }
    var btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Belépés…';
    fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Csaszko': '1' }, body: JSON.stringify({ password: pw.value }), credentials: 'same-origin' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (r) {
        if (r.ok) { location.replace('/'); return; }
        err.textContent = r.d.error || 'Nem sikerült belépni.'; err.hidden = false;
        pw.select();
      })
      .catch(function () { err.textContent = 'Nincs kapcsolat a szerverrel. Próbáld újra.'; err.hidden = false; })
      .then(function () { btn.disabled = false; btn.textContent = 'Belépés'; });
  });
})();
