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

- [x] **T1** — Branch, this document, Engram mirror, visible todo. S4. Route: parent inline (meta). Commit `9838efe`.
- [x] **T2** — Web app manifest, generated icons (192/512/maskable/180), install metadata in `layout.tsx`, single source of truth for theme colors and cache names. S1, S2. Route: parent inline. Commit `b7dc3fc`.
- [x] **T3** — Service worker with safe lifecycle + registration (production only) + offline fallback page. S1. Route: parent inline, risky artifact. Commit `221a714`.
- [x] **T4** — Install affordance for both platforms (`beforeinstallprompt` for Chromium, manual instructions for iOS, already-installed detection). S2, S3. Route: parent inline. Commit `d738bf9`.
- [x] **T5** — Session hygiene: page caches cleared on session teardown. S1. Route: parent inline. Commit `115c595`.
- [ ] **T6** — Blocked on a user decision: same-origin `/api` proxy for WebKit cookie persistence.

## Verification

All commands run from `frontend/`.

| Check | Command | Result |
| --- | --- | --- |
| Focused suites | `npx vitest run <each touched test>` | GREEN at each task; RED observed first where behaviour was new |
| Full suite | `npx vitest run` | 87 files, 721 tests, exit 0 |
| Types | `npx tsc --noEmit` | exit 0, 0 diagnostics |
| Lint (non-mutating) | `npx eslint <touched files>` | exit 0, 0 errors, 0 warnings |
| Production build | `npm run build` | exit 0; `/manifest.webmanifest`, `/offline` and `/settings/general` prerendered |

Not verified, and not claimed: any real browser install, any device behaviour, iOS or Android. No browser, emulator or device was exercised. Instrumented audits (Lighthouse installability, WebKit inspection) were not run.


## Log

- **L1** — "MIra que tal si hacemos a MeperPOS PWA y le damos soporte para ios y android. QUe tan complicado y lejos estamos?" (verbatim; originally an assessment request)
- **L2** — "Si, crea una rama para esto" (verbatim; authorizes the branch and the Level 0 implementation)
- **L3** — Assessment evidence gathered before implementation: no `manifest`/`serviceWorker` reference anywhere in `frontend/src`; `frontend/src/app/layout.tsx` already carries `viewportFit: "cover"` and light/dark `themeColor`; all 32 routes are client components, so cached navigation HTML carries no server-rendered data; `icon.png` is 256×256 and `apple-icon.png` is 180×180; 761 KB first-load JS on `/pos`; `openspec/config.yaml` sets `strict_tdd: true`; `review_budget.max_lines` is 400.
- **L4** — External evidence for the iOS cookie finding: WebKit's tracking-prevention policy document states cookies for cross-site resources are blocked by default across the board, and the iOS installed-PWA storage partition is isolated from Safari (one-time cookie copy at install). Chrome's installability criteria still require a manifest and a service worker with a `fetch` handler.
- **L5** — T2 evidence. RED: `npx vitest run src/lib/pwa.test.ts` failed to resolve `@/app/manifest`, 1 file failed, no tests. GREEN after implementation: 10/10 passed. `src/app/icon.png` was found to be transparent (corner pixel `srgba(0,0,0,0)`, `opaque=False`), so maskable icons were composited on the light background rather than resized from the source. First pass produced 16-bit PNGs with a 232 KB 512 icon; regenerated at 8-bit (55 KB). Full suite 677/677, `tsc --noEmit` 0 diagnostics. `npm run build` exit 0 with `/manifest.webmanifest` prerendered. Commit `b7dc3fc`.
- **L6** — T3 evidence. RED: `npx vitest run src/lib/sw-behavior.test.ts` reported `ENOENT: no such file or directory, open '.../public/sw.js'`, and `tsc` reported the four missing exports, exit 2. GREEN: 18 service-worker tests plus 5 contract tests, 28/28 across both files. The worker is exercised by evaluating the real `public/sw.js` inside a stubbed service-worker scope (`new Function` with injected `self`, `caches`, `fetch`, `Response`), not by asserting on its text. Full suite 701/701, `tsc` 0, build exit 0 with `/offline` prerendered. Commit `221a714`.
- **L7** — T4 evidence. RED: test resolution failure for both new modules. GREEN: 12 hook tests, 4 card tests. `eslint` rejected the first hook implementation with `react-hooks/set-state-in-effect` on `setIsInstalled(isStandaloneDisplay())`; that finding was correct, and display-mode state was moved to `useSyncExternalStore` with the `appinstalled` event latched separately, because Android installs into the launcher while the tab stays a browser tab and the display mode never changes. Full suite 717/717, `tsc` 0, `eslint` 0. Commit `d738bf9`.
- **L8** — T5 evidence. RED: `expected [] to include 'meperpos-pages-v1'` with the three regression tests already passing, which is the intended shape. GREEN: 4/4. Full suite 721/721, `tsc` 0, `eslint` 0. Commit `115c595`.
- **L9** — Diagnostic staleness, recorded because it cost real time and could mislead a future session. The pi-lens LSP reported `Cannot find module '@/app/manifest'` and `Cannot find module '@/lib/pwa'` in `src/lib/pwa.test.ts`, plus four cascading `implicitly any` on `PWA_ICONS.filter(...)`, and repeated them across several turns including an active `lens_diagnostics source=lsp` probe (6 diagnostics, 1 file with findings). They do not reproduce: `npx tsc --noEmit` exits 0 with zero diagnostics, `eslint` exits 0, and the full suite passes. Only the two files created mid-session failed to resolve while the pre-existing `@/lib/constants` resolved fine, which identifies stale tsserver file-watch state rather than a resolution or code defect. `tsc`, the runner and `eslint` were treated as the authority.
- **L10** — Final build after T5: exit 0, 34/34 static pages, `/manifest.webmanifest`, `/offline` and `/settings/general` prerendered. Nothing was pushed, and no pull request was opened. The six commits live on `feat/pwa-support` only.
