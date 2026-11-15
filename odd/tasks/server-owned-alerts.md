# Server-owned alerts and low-stock notifications

Objective: replace the client-derived alert bell with a server-owned alert feed and add a real out-of-app low-stock notification channel (WhatsApp text), so a product that crosses into low stock notifies the organization's administrators once per episode.

Branch: `feat/server-owned-alerts` (worktree `/home/meper/Projects/MeperPOS-worktrees/server-alerts`, base `origin/master` 5e07d2e)
Delivery: single PR, work-unit commits.
Test runner: `cd backend && npx jest <path>`; `cd frontend && npx vitest run <path>`.

## Specs

- **S1** — `GET /api/alerts` returns the caller organization's alerts computed server-side, with the contract `{ id, category, severity, title, detail, href, revision }`. Ordering: severity `critical` < `warning` < `info`, then category `billing` < `limits` < `stock` < `loans` < `tasks`.
- **S2** — Every alert carries a `revision` that changes whenever the facts behind it change (the set of low products, the overdue loans, the plan counters, the trial end date). The client keeps a per-organization ledger of `id -> revision`; an alert is unread when its revision differs from the stored one. A new low-stock product therefore re-alerts even when the alert id is unchanged.
- **S3** — Visibility is decided on the server: billing and limits for `ADMIN` (OWNER inherits via the role hierarchy); stock for `ADMIN` and `INVENTORY_USER`; loans and tasks for `ADMIN`, `CASHIER` and `INVENTORY_USER`.
- **S4** — The alert feed does not depend on the browser session carrying an `organization` object. The current client early-return on a null `organization` is removed.
- **S5** — Low-stock detection stays the single authority `isLowStock` (`stock <= minStock`, tracked, active, `type = PRODUCT`). A product opens one `ProductStockAlert` episode when it enters that set and resolves it when it leaves. A new crossing opens a new episode.
- **S6** — On opening an episode, at most one WhatsApp text per scan per organization is sent, listing up to 10 newly opened products, to the organization's oldest verified `OWNER`/`ADMIN` identity, through the central `INTELLIGENCE` session. Delivery is at-most-once: the row is claimed before the provider is called and is never retried automatically.
- **S7** — A missing recipient or a provider failure is recorded on the row with a fixed code (`no_recipient`, `provider_rejected`, `send_failed`) and never thrown out of the scan. The stock alert stays visible in the feed.
- **S8** — The scan runs every 5 minutes and is idempotent: repeated runs keep one row per product and at most one send per episode.
- **S9** — `GET /api/products/low-stock` accepts `INVENTORY_USER`, matching the frontend capability that already enables stock alerts for that role. No other endpoint changes roles.
- **S10** — Existing behavior preserved: services and untracked products never alert; the low-stock filter, the dashboard KPI and the daily report keep using the same rule.

## Tasks

| ID | Spec | Route | Status | Evidence |
| -- | ---- | ----- | ------ | -------- |
| T1 | S1-S4 | inline | done | `backend/src/alerts/*`, commit `285b6ba`, 45 specs |
| T2 | S5-S8 | inline | done | schema, migration, scan service + specs, commit `3bf20cb` |
| T3 | S9 | inline | done | commit `af7d917`, `products.low-stock-roles.spec.ts` |
| T4 | S1-S2, S4 | inline | done | commit `779845f`, 10 specs |
| T5 | S6-S8 | inline | done | `docs/referencias/alertas.md`, commit `3cddb9e` |
| T6 | all | inline | pending | fix wiring, full suites, PR, native review |

## Log

- **L1** (verbatim): "quiero que mires por qué en la cuenta de Sandbox la demo que subimos para producción. Las alertas no le funcionan si acabo de poner si hoy puse un producto en estado que se supone que debería de marcar en estado de Stock bajo pero no me notificó"
- **L2** (verbatim): "no aparece nada, cual es la mejor opcion que podemos tomar aca?"
- **L3** (verbatim): "saca la 3 completa en uk worktree aparte de master actualizado y dejame un Pr revisado ;)"
- **L4** Diagnosis recorded before implementation: the bell was dead because `useAlerts` returned `[]` whenever `AuthContext.organization` was null, and `/auth/login`, `/auth/select-org` and `/auth/select-organization` never return an `organization` object (only `/auth/profile` does). The seen ledger keyed on the condition class (`stock:low`), so a new low product could never re-alert. No out-of-app notification existed.
- **L5** Scope decision: "option 3" from the analysis is implemented as (a) a server-owned feed with revisions, (b) `ProductStockAlert` episodes, (c) WhatsApp text delivery over the existing `WHATSAPP_TEXT_SENDER` port and central session. Reason: the repo has no mail or push transport, and WhatsApp is the only real out-of-app channel already wired, configured and covered by tests.
- **L6** Independent verifier (baseline `5e07d2e`) found one blocker: the split commits left `AlertsModule` with the feed providers only, so `StockAlertsService` and `StockAlertsScheduler` were never registered and S5-S8 were unreachable in the running app. Fixed by registering both providers and importing `WhatsAppModule`, with `alerts.module.spec.ts` as the regression test. Advisories accepted: the authorization-matrix row now cites `products.low-stock-roles.spec.ts`; the e2e config loads `test/setup-e2e.ts`, which sets `STOCK_ALERTS_ENABLED=false` so a test run never reaches the provider.
- **L7** Evidence at fix time: `npx jest src/alerts src/products --runInBand` green (9 suites, 67 tests). Full backend suite 235/235 suites and frontend 107/107 files were green before the wiring fix and are re-run after it; the app-boot e2e run is recorded in the PR report.
- **L8** (verbatim, new objective): "luego de terminar el goal que se esta ejecutando actualmenre correras otro para cubrir ll que hizo falta como la vista del historial de notificacion y lo que me comentaste en el ultimo /btw  :) cubrir los errored que quedaron." — deferred until this feature is closed.
- **L9** Native review (4 lenses) corroborated two critical findings and opened one bounded correction. `R3-1`: the feed query key was the constant `["alerts"]` while the payload is tenant-scoped, so an in-session organization switch could render the previous organization's alerts for up to the refetch window. Fixed by keying the query with `["alerts", organizationId]` and pinning it with a switch test. `R4-BOOT-SCAN-BLOCKS-LISTEN`: `onApplicationBootstrap` awaited a tenant-wide scan that calls the provider, gating readiness on WhatsApp. Fixed by launching the bootstrap scan in the background; the cron path was already non-blocking. Reviewers' WARNING/SUGGEST findings (duplicated low-stock predicate, `decideEpisode` contract, duplicated role table) are recorded as follow-ups, not part of the bounded correction.
