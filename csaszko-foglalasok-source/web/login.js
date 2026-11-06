(function () {
  'use strict';
  var f = document.querySelector('[data-login]');
  var err = document.querySelector('[data-error]');
  var lead = document.querySelector('[data-lead]');
  var btn = f.querySelector('button[type=submit]');
  var pw = f.password, pw2 = f.password2;
  var mode = 'login', canReset = false;
  var TEXT = {
    login: { btn: 'Belépés', busy: 'Belépés…', label: 'Jelszó', lead: '' },
    setup: { btn: 'Jelszó mentése', busy: 'Mentés…', label: 'Új jelszó', lead: 'Adj meg egy jelszót az apphoz. Ezentúl ezzel lehet belépni, az Umbrelen és a saját címén is.' },
    reset: { btn: 'Új jelszó mentése', busy: 'Mentés…', label: 'Új jelszó', lead: 'Adj meg új jelszót. Minden más eszközön újra be kell majd lépni vele.' }
  };
  function setMode(m) {
    mode = m;
    var t = TEXT[m], nw = m !== 'login';
    btn.textContent = t.btn;
    document.querySelector('[data-pw-label]').textContent = t.label;
    lead.textContent = t.lead; lead.hidden = !t.lead;
    document.querySelector('[data-pw2-row]').hidden = !nw;
    pw.autocomplete = nw ? 'new-password' : 'current-password';
    document.querySelector('[data-forgot]').hidden = !(m === 'login' && canReset);
    document.querySelector('[data-back]').hidden = m !== 'reset';
    err.hidden = true; pw.value = ''; pw2.value = '';
    pw.focus();
  }
  fetch('/api/login-info', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
    canReset = !!d.canReset;
    if (d.setup) return setMode('setup');
    if (!d.enabled) { f.hidden = true; document.querySelector('[data-off]').hidden = false; return; }
    setMode('login');
  }).catch(function () {});
  document.querySelector('[data-show]').addEventListener('change', function (e) { pw.type = pw2.type = e.target.checked ? 'text' : 'password'; });
  document.querySelector('[data-forgot]').addEventListener('click', function () { setMode('reset'); });
  document.querySelector('[data-back]').addEventListener('click', function () { setMode('login'); });
  function fail(msg) { err.textContent = msg; err.hidden = false; }
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    err.hidden = true;
    if (!pw.value) { fail('Írd be a jelszót.'); pw.focus(); return; }
    if (mode !== 'login') {
      if (pw.value.length < 8) { fail('A jelszó legyen legalább 8 karakter.'); pw.focus(); return; }
      if (pw.value !== pw2.value) { fail('A két jelszó nem egyezik.'); pw2.focus(); return; }
    }
    var url = mode === 'login' ? '/api/login' : mode === 'setup' ? '/api/setup' : '/api/reset';
    btn.disabled = true; btn.textContent = TEXT[mode].busy;
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Csaszko': '1' }, body: JSON.stringify({ password: pw.value }), credentials: 'same-origin' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (r) {
        if (r.ok) { location.replace('/'); return; }
        fail(r.d.error || 'Nem sikerült.');
        pw.select();
      })
      .catch(function () { fail('Nincs kapcsolat a szerverrel. Próbáld újra.'); })
      .then(function () { btn.disabled = false; btn.textContent = TEXT[mode].btn; });
  });
})();
