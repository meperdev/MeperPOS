# PWA support for MeperPOS (iOS + Android)

Make the Next.js frontend installable as a Progressive Web App with iOS and Android support: manifest, app icons, a service worker with a safe cache lifecycle, and an install affordance for both platforms.

Branch: `feat/pwa-support`. Base: `53b2272` (`master`).
Authorized surfaces: `frontend/src/app/manifest.ts`, `frontend/src/app/layout.tsx`, `frontend/src/app/offline/**`, `frontend/src/components/pwa/**`, `frontend/src/hooks/useInstallPrompt.ts`, `frontend/src/lib/pwa.ts`, `frontend/src/lib/session.ts`, `frontend/public/sw.js`, `frontend/public/icons/**`, and the matching `*.test.ts(x)` files, plus this document.
Risk tier: high. A service worker is delivery/runtime surface for every installed client, is hard to undo once cached, and no jsdom test can prove real browser install behavior.

## Specs

- **S1 — PWA.** The user said: "hacemos a MeperPOS PWA". The frontend MUST be installable: a valid web app manifest (`name`, `short_name`, `start_url`, `scope`, `display: standalone`, `theme_color`, `background_color`) plus at least one 192px and one 512px icon, one of them `maskable`, and a registered service worker with a `fetch` handler (Chrome installability criteria).
- **S2 — iOS.** The user said: "le damos soporte para ios". iOS/WebKit MUST be able to install and run the app standalone: `apple-mobile-web-app-capable` and status-bar metadata, a 180×180 `apple-touch-icon`, and an install affordance that shows "Add to Home Screen" instructions, because WebKit never fires `beforeinstallprompt`. The installed app MUST be told apart from a browser tab so the UI does not offer an install that cannot happen.
- **S3 — Android.** The user said: "y android". Chromium MUST be able to install through the captured `beforeinstallprompt` event, and the install affordance MUST disappear once the app is already installed.
- **S4 — Isolated branch.** The user said: "crea una rama para esto". All of this work MUST live on `feat/pwa-support`, never on `master`.

## Non-goals (parent-scoped, pending user confirmation)

- **Offline writes / offline POS.** Selling without connectivity needs backend idempotency keys (none exist today: `POST /sales` accepts no client key) and an explicit product decision on stock conflicts and on whether a client-computed price may override the server-owned price. Not in this branch.
- **Offline reads.** Persisting the React Query cache to IndexedDB is a separate work unit; it must be user/organization scoped before it can ship, because `X-Organization-Id` is multi-tenant state.
- **Same-origin API proxy.** The frontend calls `meperpos-api.up.railway.app` cross-site while `backend/src/auth/cookies.helper.ts` sets `SameSite=None; Secure` in production, and WebKit blocks third-party cookies "across the board". The httpOnly `refresh_token` therefore does not round-trip on WebKit, so an installed iOS app asks for login on every launch. Fixing it changes production API routing and needs a Vercel env change, so it is a separate decision — see T6.
- **Web push notifications, background sync.** Out of scope.

## Tasks

- [ ] **T1** — Branch, this document, Engram mirror, visible todo. S4. Route: parent inline (meta).
- [ ] **T2** — Web app manifest, generated icons (192/512/maskable/180), install metadata in `layout.tsx`, single source of truth for theme colors and cache names. S1, S2. Route: parent inline. Commit: `feat(pwa): add web app manifest, icons and install metadata`.
- [ ] **T3** — Service worker with safe lifecycle + registration (production only) + offline fallback page. S1. Route: parent inline, risky artifact. Commit: `feat(pwa): add service worker with offline shell fallback`.
- [ ] **T4** — Install affordance for both platforms (`beforeinstallprompt` for Chromium, manual instructions for iOS, already-installed detection). S2, S3. Route: parent inline. Commit: `feat(pwa): add platform-aware install affordance`.
- [ ] **T5** — Session hygiene: page caches cleared on session teardown. S1. Route: parent inline. Commit: `fix(pwa): clear page caches on session teardown`.
- [ ] **T6** — Blocked on a user decision: same-origin `/api` proxy for WebKit cookie persistence.

## Log

- **L1** — "MIra que tal si hacemos a MeperPOS PWA y le damos soporte para ios y android. QUe tan complicado y lejos estamos?" (verbatim; originally an assessment request)
- **L2** — "Si, crea una rama para esto" (verbatim; authorizes the branch and the Level 0 implementation)
- **L3** — Assessment evidence gathered before implementation: no `manifest`/`serviceWorker` reference anywhere in `frontend/src`; `frontend/src/app/layout.tsx` already carries `viewportFit: "cover"` and light/dark `themeColor`; all 32 routes are client components, so cached navigation HTML carries no server-rendered data; `icon.png` is 256×256 and `apple-icon.png` is 180×180; 761 KB first-load JS on `/pos`; `openspec/config.yaml` sets `strict_tdd: true`; `review_budget.max_lines` is 400.
- **L4** — External evidence for the iOS cookie finding: WebKit's tracking-prevention policy document states cookies for cross-site resources are blocked by default across the board, and the iOS installed-PWA storage partition is isolated from Safari (one-time cookie copy at install). Chrome's installability criteria still require a manifest and a service worker with a `fetch` handler.
