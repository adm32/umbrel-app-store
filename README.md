# Adam's Apps – Umbrel community app store

This repository is an [Umbrel](https://umbrel.com) community app store (store id `adam`). Umbrel
installs the `adam-*` folders. The program code lives in `src/`. Each Go program is built into
the matching app folder's `bin/`.

```
adam-admcore/              Zala Studio website (zalastudio.hu)              ← built from src/zalastudio-weboldal
adam-core-iranyitopult/    Zala Studio Irányítópult (leads, payments, tax)  ← built from src/zalastudio-iranyitopult
adam-csaszko/              Csaszko Barbershop website                       ← built from src/csaszko-weboldal
adam-csaszko-foglalasok/   Csaszko Foglalások (bookings back office + API)  ← built from src/csaszko-foglalasok
adam-tukor/                Tükör (standby server, failover)                 ← built from src/tukor
adam-szikra/               Szikra (érettségi study app, profiles)           ← built from src/szikra
adam-router/               Router (opens the home router's admin page; nginx, no own code)
adam-tv-remote/            TV Remote (single Node.js file: adam-tv-remote/server.js)
adam-vitals/               Vitals (image built from the adm32/umbrel_apps repository)
src/                       source code of the Go programs, one folder per program
check.sh                   builds and tests every program without touching bin/
```

The app folder names (`adam-admcore`, `adam-core-iranyitopult`) date from when the business was
called "core". Umbrel uses the folder name as the app id, so they can't be renamed without
reinstalling the apps.

## What's in an app folder

| File | Purpose |
|---|---|
| `umbrel-app.yml` | Name, version, port and release notes. Umbrel offers an update when `version` changes. |
| `docker-compose.yml` | How Umbrel runs the app: ports, data folder, `APP_VERSION`. |
| `Dockerfile` | `FROM scratch` plus the prebuilt program from `bin/`. It builds on the Umbrel with no internet. |
| `hooks/pre-start` | Copies the fresh `bin/` and `Dockerfile` from the store before every start, so an update really runs the new program. |
| `bin/` | The compiled programs (amd64 and arm64). **Never edit by hand.** Run `src/<app>/build.sh` instead. |
| `data/` | Only placeholders are in git. The real data (orders, passwords, Stripe keys) stays on the Umbrel. |

## Making a change (every Go app)

1. `git pull --rebase` first. Other sessions push to this repo too.
2. Edit the source in `src/<app>/`.
3. Run `sh src/<app>/build.sh`. It vets, tests and writes `adam-<app>/bin/`.
4. Raise `version` in `adam-<app>/umbrel-app.yml`. Raise `APP_VERSION` in its `docker-compose.yml` too, if it has one (Zala Studio, Tükör). Also raise `const version` in `main.go` for the Irányítópult. Add a short Hungarian release note at the top of `releaseNotes`.
5. Run `./check.sh`, then commit and push. On **both** Umbrels (main and standby), press Update.

## Where to look

### Zala Studio website – `src/zalastudio-weboldal` → `adam-admcore` (port 4760, zalastudio.hu)

| File | What it does |
|---|---|
| `main.go` | Settings from the environment, the two servers (public :8080, internal :9095), routing (`public()`, `internal()`), redirects from old addresses |
| `files.go` | Serving `www/`, which is compiled in: gzip, cache headers, 404 |
| `helpers.go` | JSON files in DATA_DIR, client IP, text cleaning, security headers, rate limiter |
| `leads.go` | Planner and no-JS form requests (`POST /api/ajanlatkeres`), the outbox, handing over to the Irányítópult, ntfy fallback |
| `stats.go` | Page statistics (`POST /api/e`) and the settings the Irányítópult pushes (`POST /config`) |
| `cookies.go` | Cookie consent (`POST /api/consent`) and the per-visitor record that is kept only with consent |
| `pay.go` | Payment pages `/fizetes/{kod}` and `/elofizetes`, consumer withdrawal `/elallas`, and the Stripe webhook relay (the Irányítópult holds the keys) |
| `www/index.html` | The whole home page: hero, work, perks, process, **packages and prices** (`#arak`), FAQ (`#kerdesek`) and the planner dialog (`#planner`) |
| `www/assets/js/preview.js` | **Package data** (`PLANS`: prices, setup fees), planner choices (`FEATURES`, `TYPES`, `STYLES`) and the phone preview. If you change a price, change it here **and** in `index.html`. |
| `www/assets/js/site.js` | Page behaviour: menu, monthly/yearly price switch, launch-discount counter, the planner steps and sending the request |
| `www/assets/js/fx.js` | Home page motion: one scroll loop (pinned hero with the river canvas, sideways work gallery, word-by-word manifesto, scroll-drawn process line, CTA iris, footer word), header colour over dark sections, tilt, magnetic buttons, intro curtain, confetti. Also `window.__zsMoveThumb` for site.js. |
| `www/assets/js/consent.js` | Cookie banner |
| `www/assets/js/boot.js` | Before first paint: `js` (script on), `mo` (motion allowed, sections may pin) and `intro-pre` (first visit of the session) |
| `www/assets/js/pay.js` | Payment page button behaviour |
| `www/assets/css/site.css` | Shared styles for every page: tokens, buttons, header, phone frame + preview (between `@preview-start/end`, copied to the Irányítópult), footer, dock, cookie banner, legal and payment pages, planner |
| `www/assets/css/home.css` | Home page only: paper (light) sections with graphite `.dk` sections, brand orange used sparingly; hero river, marquee, work gallery, bento with the Vadvirág demo (uses `fonts/lora-latin.woff2` and `img/vadvirag-logo.webp`), process line, pricing cards, CTA, FAQ, footer word, intro. Driven by CSS variables that fx.js sets. |
| `www/aszf.html`, `www/adatvedelem.html` | Terms (ÁSZF) and privacy notice/impresszum. Legal text: change only when Ádám asks. |
| `www/koszonom.html`, `www/404.html` | Thank-you page after the no-JS form, and the not-found page |
| `brand/` | Logo files that are **not** served (kept for later use) |

### Zala Studio Irányítópult – `src/zalastudio-iranyitopult` → `adam-core-iranyitopult` (port 4761)

| File | What it does |
|---|---|
| `main.go` | Version, settings, the main HTTP handler, `main()` |
| `api.go` | The dashboard API `/api/...`: leads, statuses, notes, statistics, settings, export |
| `ingest.go` | Internal `POST /ingest` (port 9097). The website hands new requests over here. |
| `storage.go` | `leads.json`, `settings.json`, `jelszo.json` |
| `labels.go` | Planner codes and their Hungarian labels. They must match `preview.js` on the website. |
| `auth.go` | Password, sessions, login rate limit |
| `monitor.go` | Health check of the website, and pushing settings to it |
| `ntfy.go` | Push notifications (no personal data in them) |
| `pay.go` | Stripe: payment links, subscriptions, webhooks, "Kiszámlázandó" list |
| `tax.go` | The "Adó" tab: revenue log, deadlines, estimates |
| `httputil.go`, `static.go`, `certs.go` | HTTP helpers, serving `web/`, built-in root certificates |
| `web/app.js`, `web/index.html` | The dashboard UI |
| `web/preview.js` | **Generated** by `build.sh` from the website's `preview.js`. Don't edit it here. |
| `web/preview.css` | A copy of the preview part of the website's `site.css` |

### Csaszko Barbershop – `src/csaszko-weboldal` → `adam-csaszko` (port 4770)

`main.go` serves the one-page site from `www/` (`index.html`, `app.js`, `styles.css`) and passes `/api/` through to Csaszko Foglalások (`BOOKING_API`).

### Csaszko Foglalások – `src/csaszko-foglalasok` → `adam-csaszko-foglalasok` (ports 4771, 4773)

| File | What it does |
|---|---|
| `main.go` | The three listeners (public API :3001, admin :8080, remote admin :8082→4773), housekeeping, `main()` |
| `public.go` | Public booking API for the website, and the ntfy notification to the barber |
| `admin.go` | Admin API: bookings, blocks, services, settings |
| `remote.go` | Own-password login on the remote address |
| `availability.go` | Opening hours, blocks and bookings turned into free times |
| `types.go`, `storage.go` | Data types and defaults; `db.json` and `settings.json` |
| `timeutil.go`, `validation.go`, `ratelimit.go`, `httputil.go` | Helpers |
| `mail.go`, `templates.go` | E-mail sending and texts |
| `stats.go` | Anonymous visitor statistics |
| `instagram.go` | Latest Instagram posts for the website |
| `web/` | The admin app (`admin.js`, `admin.css`, `stats.js`, `login.*`) |

### Tükör – `src/tukor` → `adam-tukor` (port 4790, host network)

| File | What it does |
|---|---|
| `main.go` | Configuration, state, the `Node`, `main()` |
| `apps.go` | Installed apps, their ports and data files, starting and stopping them through Docker |
| `proxy.go` | Per-port proxy (+10000), routing decisions, machine-to-machine API |
| `sync.go` | Health checks, failover, failback with merge, the 15-second sync, daily backup |
| `ui.go`, `www/index.html` | Admin page and its API |

### Szikra – `src/szikra` → `adam-szikra` (port 4780 behind Umbrel login, 4781 public with own password)

Study app for the érettségi: 5-minute rounds, spaced repetition, memoriter drills, XP/streak/badges,
profiles (Ádám 🐻 dark "szikra" theme, Hanna 🐰 "pink" theme), each with its own progress and test date.

| File | What it does |
|---|---|
| `content/<subject>/*.json` | **The study material.** `subject.json` + one file per topic (notes, poems, cards). Format: `content/README.md`. New material = new topic file, then build. `go test` checks every card. |
| `content.go` | Loading the material; generates the „Melyik versből való?” cards and the memoriter drills from poem texts |
| `srs.go` | Spaced repetition: Leitner boxes, intervals capped before the test date, how "known" a card is |
| `session.go` | Putting a round together (smart / topic / poem / memo / review) |
| `game.go` | XP, combo, levels, streak, badges |
| `profiles.go`, `store.go` | `DATA_DIR/profiles.json`, `DATA_DIR/profiles/<id>/progress.json` (+ daily backups) |
| `api.go` | JSON API; every call names its profile (`X-Profile` header or `?p=`). Each profile only gets the subjects whose `subject.json` lists it in `for`. |
| `auth.go`, `scrypt.go` | Password of the public port (REMOTE_PORT 8082 → 4781); set only from the Umbrel address |
| `web/app.js`, `web/app.css` | The whole page: views, card types, canvas effects, sounds, themes, avatars |

Every Cloudflare public hostname points to `http://host.docker.internal:1<port>` (Tükör), not to
the app directly. Both Umbrels must run the same versions of every app.

## Rules for every site

- Never put Stripe keys, webhook secrets, tunnel tokens or passwords in git or in chat. They live only in each app's `data/` on the Umbrel.
- Ádám's phone number never appears on any site. His name appears only on the legal pages.
- No site mentions who hosts the standby server, or that the sites run on home servers.
- Motion and UI follow the "20 principles of UX & animation": snappy (<300 ms), eased, big tap targets (≥44 px), few choices.
- Keep sites fast. Don't add libraries or external scripts or fonts. Everything is served from the app itself.
