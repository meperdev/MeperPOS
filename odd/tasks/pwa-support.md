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
- [x] **V1** — Independent verification of the T1-T5 candidate (`gentle-ai-verify`, read-only). Verdict: **do not approve yet**. Six findings, four of them real, all four fixed below. The verifier independently confirmed the icon dimensions, the manifest contents, the iPadOS detection and that no existing teardown action was removed.
- [x] **T7** — Capture the install prompt from app boot rather than from the card. Fixes **finding 1** (high) and finding 6. Commit `03ff36a`.
- [x] **T8** — Emit the vendor-prefixed `apple-mobile-web-app-capable` tag. Fixes **finding 2**. Commit `bf8919c`.
- [x] **T9** — Never let a cache write decide a request's fate, refuse a followed redirect, and stop overclaiming in the worker header. Fixes **finding 5** and finding 3. Commit `d3f1ae8`.
- [x] **T10** — Isolate each service worker guard in its own test. Fixes **finding 4**. Commit `a53d12c`.
- [ ] **T6** — Blocked on a user decision: same-origin `/api` proxy for WebKit cookie persistence.

## Verification

All commands run from `frontend/`.

| Check | Command | Result |
| --- | --- | --- |
| Focused suites | `npx vitest run <each touched test>` | GREEN at each task; RED observed first where behaviour was new |
| Full suite | `npx vitest run` | 87 files, 733 tests, exit 0 (721 before remediation) |
| Types | `npx tsc --noEmit` | exit 0, 0 diagnostics |
| Lint (non-mutating) | `npx eslint <touched files>` | exit 0, 0 errors, 0 warnings |
| Production build | `npm run build` | exit 0, 34/34 static pages; `/manifest.webmanifest`, `/offline` and `/settings/general` prerendered |
| Emitted HTML | `grep` on `.next/server/app/*.html` | both `mobile-web-app-capable` and `apple-mobile-web-app-capable` present on `/dashboard` and `/login` |
| Guard mutation | delete one routing guard, rerun `sw-behavior.test.ts` | method guard → 1 test fails; origin guard → 1 test fails; `/api/` guard → 2 tests fail; baseline 20/20. The worker was restored from the committed revision afterwards. |

Not verified, and not claimed: any real browser install, any device behaviour, iOS or Android. No browser, emulator or device was exercised. Instrumented audits (Lighthouse installability, WebKit inspection) were not run. The `/api` proxy that WebKit login persistence depends on is not implemented (T6).


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
- **L11** — Independent verification verdict (V1). `gentle-ai-verify` was asked to find what was wrong and returned **do not approve yet**, with all four commands passing (87 files / 721 tests, `tsc` 0, `eslint` 0, build 0) and four real defects in the source. The parent reproduced the metadata one directly before acting on it: `.next/server/app/dashboard.html` contained `mobile-web-app-capable` but no `apple-mobile-web-app-capable`, matching `node_modules/next/dist/lib/metadata/generate/basic.js:263`. The verifier's independently confirmed positives: all four committed icons are genuine 8-bit PNGs at the declared sizes, `apple-icon.png` is genuinely 180×180, the manifest body carries every required field, and no pre-existing teardown action was removed.
- **L12** — Finding 1 was the serious one and it was correct. The install listener lived in a hook that only the settings card mounted, so a `beforeinstallprompt` fired on `/login`, `/dashboard` or `/pos` was never captured and the Android install path could not work. Capture moved to `src/contexts/InstallPromptContext.tsx`, mounted in the root layout above the router, and the lifetime is now covered by tests that render a non-consuming page, fire the event, and then swap in the card.
- **L13** — T7 secondary fix: `eslint` rejected reading the consumed-event ref during render (`react-hooks/refs`). That was correct, so `canPromptInstall` derives from state alone and the ref is read only inside the callback, which is the only place the synchronous single-use guarantee is needed.
- **L14** — T8 verification was done against the built artifact, not the metadata object: after `npm run build`, both capability tags are present in `.next/server/app/dashboard.html` and `.next/server/app/login.html`. The unit test pins the legacy tag so a Next upgrade cannot silently drop it again.
- **L15** — T9 RED was four failures (`failPut` on all three strategies plus the followed redirect), with the 13 pre-existing worker tests still green. T10 was verified by mutation rather than assertion: deleting the method guard fails exactly 1 test, the origin guard exactly 1, and the `/api/` guard exactly 2, against a 20/20 baseline. `sw.js` was restored from `/tmp/sw.control` and `git diff --stat` confirmed it matched the committed revision. Before T10, deleting any of those guards left the suite fully green.
