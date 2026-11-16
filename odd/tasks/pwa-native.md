# ODD: make the installed PWA feel like a native app

Objective: on phones (installed standalone PWA, 390x844 reference) the app must feel native, not a
website in disguise. Four phases, one PR each. Runner `cd frontend && npm run test` (vitest), typecheck
`npx tsc --noEmit`, build `npm run build`. Delivery: one PR per phase (user-approved proposal, L2).

## Specs

User request (L1): "revisa todo el frontend y experiencia visual del pwa y ajustame responsive y que sea
lo mas similar posible a una app nativa y no una web camuflada". Binding constraints: D1-D10 in
`docs/design-system/POLISH_DECISIONS_2026_11.md`; mobile work targets the installed PWA (safe areas,
`dvh`, 44px touch targets); UI copy Spanish, sentence case, tú. Already done and not to be redone:
`odd/tasks/pwa-support.md` S10-S13 (overscroll, tap highlight, double-tap zoom, callout/selection,
safe areas on fixed surfaces, cart stepper and undo, iOS edge-swipe guard). "Mobile" below means
below the `lg` breakpoint unless a spec says `sm`.

- **S1 — App structure (F1).**
  - S1.1 Bottom tab bar on mobile only, 5 tabs: Panel (`/dashboard`), POS (`/pos`), Ventas (`/sales`),
    Inventario (`/inventory`), Más (opens the existing drawer with every other section). Tabs the role
    cannot open are not shown (reuse the existing role/route map). Pays `--safe-bottom`, 44px+ targets,
    active tab marked (`aria-current="page"`).
  - S1.2 Top bar on mobile shows the current section title, a back chevron on nested routes (detail,
    new, settings subpages), and the bell; the hamburger leaves the mobile top bar (Más replaces it).
    A page's primary action is no longer a full-width button on mobile (e.g. "Nuevo cliente").
  - S1.3 Scroll/height: no `min-h-screen`/`100vh`/`h-screen` in the shell (use `dvh`); content is padded
    so nothing hides under the top bar or the tab bar; the POS double scroll disappears and its floating
    cart bar sits above the tab bar. Decision (parent, L3): keep document scroll with fixed bars rather
    than an inner scroll container, because iOS standalone only scrolls-to-top on a status-bar tap for
    the document scroller and every window-scroll consumer keeps working.
  - S1.4 `<meta name="theme-color">` follows the in-app theme on toggle; `PWA_THEME_COLOR_LIGHT` and the
    dark value match their `--background` tokens.
- **S2 — Overlays (F2).**
  - S2.1 `Modal` below `sm` is a bottom sheet: slides up, drag handle, drag down to dismiss, actions
    fixed at the bottom of the sheet, stays above the iOS keyboard (visualViewport). Desktop unchanged.
    Dialog semantics, focus trap and Escape unchanged.
  - S2.2 `Select` below `sm` opens its options in a bottom sheet instead of an absolute dropdown, with the
    same listbox semantics and value contract; unchanged where `matchMedia` is unavailable (tests).
  - S2.3 `ConfirmDialog` below `sm` is an action sheet (full-width stacked actions).
  - S2.4 The AlertCenter mobile panel opens below the top bar using `--mobile-header` + `--safe-top`
    and pays left/right insets.
- **S3 — Lists and cards (F3).**
  - S3.1 Below `sm` collection pages always render cards, even with a persisted table preference
    (inventory, customers, categories, suppliers, purchase-orders, loans, employees, payroll).
  - S3.2 Row/card actions are at least 44px on touch; whole tappable cards/rows have a visible pressed
    state (`active:`), no hover-only feedback.
  - S3.3 Customer cards lose the empty gap; segment chips scroll horizontally instead of being cut;
    POS product cards are compact (6-8 per phone screen), without the nested "Productos" card.
- **S4 — Native details (F4).**
  - S4.1 Route transitions with the View Transitions API where supported, none elsewhere, respecting
    `prefers-reduced-motion`.
  - S4.2 Haptics (`navigator.vibrate`, Android only) on add to cart, payment confirmed, delete.
  - S4.3 Skeletons instead of spinners on Panel, Reportes, Perfil, Alertas.
  - S4.4 `enterKeyHint` on forms; login email without autocapitalize/autocorrect.
  - S4.5 Manifest shortcuts (POS, Nueva venta) and iOS startup images.
  - S4.6 Receipt printing inside the app (no `window.open` / popup-blocker message).

## Tasks

| ID | Specs | Route | Branch / worktree | Status |
|---|---|---|---|---|
| T1 | S1 | delegated worker (parallel with T2, disjoint surfaces) | `feat/pwa-native` / `MeperPOS-worktrees/pwa-native` | done, this PR |
| T2 | S2 | delegated worker (parallel with T1) | `feat/pwa-sheets` / `MeperPOS-worktrees/pwa-sheets` | done, PR #360 (`1c5c9f1`) |
| T3 | S3 | delegated worker, stacked on T1 (shares list pages and POS) | pending | pending |
| T4 | S4 | delegated worker | pending | pending |

## Log

- **L1 (2026-11-15, verbatim).** "BUeno ahora revisa todo el frontend y experiencia visual del pwa y ajustame responsive y que sea lo mas similar posible a una app nativa y no una web camuflada :)"
- **L2 (2026-11-15, verbatim).** "Si dale con toda" — approval of the 4-phase proposal with the 5 tabs (Panel, POS, Ventas, Inventario, Más). Evidence base: read-only code audit (explorer) and 48 captures at 390x844 in `/tmp/opencode/pwa/` (standalone display-mode could not be emulated in headless Chromium; installed-device check stays with the user).
- **L3 (2026-11-15).** Parent decision on S1.3: document scroll with fixed bars, not an inner scroll container (iOS status-bar tap-to-top and window-scroll consumers). The proposal said "lo que hace scroll es el contenido"; this is the reason it changed.
- **L4 (2026-11-15, T1, S1.1-S1.4 implemented).** Evidence: `frontend` focused vitest RED first — 18 failed / 59 passed across 9 suites (2 of them new files that did not resolve yet, plus the theme-color, content-padding, Pagination offset, cart-bar offset and POS panel assertions); GREEN after implementation. Final: `npm run test` 141 files / 1326 tests passed, `npx tsc --noEmit` clean, `npx eslint` on every changed file shows only the 3 pre-existing `app/pos/page.tsx` errors plus one pre-existing `page.behavior.test.tsx` warning. Captures (390x844 dark, 1440x900 dark) in `/tmp/opencode/pwa-f1/`: POS now measures 844/844 with a single inner scroll and the pager 25px above the bar; the tab bar occupies 60px at y=784; the desktop tab bar measures 0 (hidden at `lg`). One real-browser defect the captures exposed and the unit tests had missed: Next re-emits the viewport metadata on every client-side navigation, restoring the light/dark boot pair, so a dark session flipped back to a light status bar after the first soft nav; `ThemeContext` now watches `<head>` and repaints the active color (pinned by "repaints tags that a later metadata emission puts back", RED observed by temporarily removing the observer: expected `['#111114','#111114']`, got `['#FAFAF9','#111114']`). Not changed, and why: no `fixed bottom-0` / `sticky bottom-0` surface exists in `app/expenses/page.tsx`, `app/purchase-orders/new/page.tsx` or `app/purchase-orders/[id]/page.tsx` (their only sticky element is a top-anchored summary card), so the bars to lift were `Pagination` and the POS cart bar; the expense action bar lives inside `ExpenseFormModal`, which the spec excludes as a Modal. `AppShellSkeleton` and the separate `/admin` SuperAdmin shell keep their own geometry (out of scope, and the admin console is not the tenant shell).
  - **Follow-up on this same entry (2026-11-15, parent review of the captures: four corrections).** (1) The drawer is now the "everything else" surface below `lg`: a row whose href the tab bar already offers takes `hidden lg:flex` and a group whose whole list is tabs takes `hidden lg:block`, both derived from `mobileTabsFor(role)` so no rule is copied; the rail is unchanged at `lg`. (2) The drawer gained a 44px `Cerrar menú` control in its brand row and closes on Escape; the 280px drawer could no longer fit logo + wordmark + that control, so the lockup steps down to `w-10`/`text-2xl` below `lg` and keeps `w-14`/`30px` on the rail. (3) The in-content `Volver` on `app/sales/[id]`, `app/purchase-orders/[id]` and `app/purchase-orders/new` is `hidden lg:inline-flex` (the top bar's chevron is the phone's only back), added through `cn()` so `hidden` actually wins. (4) `AppShellSkeleton` now reserves the top bar at `--mobile-header`, a five-slot tab bar strip at `--mobile-tabbar` and the same content padding as the real shell, desktop untouched. RED first: 12 failed / 58 passed across 6 suites (sidebar drawer filtering x4, close control, Escape, sales back button, PO detail back link, PO new back link, skeleton x4); when the third suite first went green the cashier case failed on my own wrong premise — a CASHIER cannot open `/dashboard`, so `Panel` is absent by the role filter, not hidden by the tab rule — and the test was corrected to assert that absence explicitly (1 failed / 69 passed, then green). Final: focused suites 70/70, `npm run test` 143 files / 1340 tests, `npx tsc --noEmit` clean, `npx eslint` clean on every changed file. Re-captured in `/tmp/opencode/pwa-f1/`: `08-drawer-from-mas-phone.png` (no Panel/POS/Ventas/Inventario rows, `MeperPOS` no longer truncated), `06-sale-detail-phone.png` and `12-po-new-phone.png` (no `Volver` in content, chevron in the bar).
