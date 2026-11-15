# Alert history and follow-up hardening

Objective: expose the stock-alert notification history (a view, an endpoint and append-only events) and close the errors and review findings left open by `feat/server-owned-alerts` (PR #351/#352): the overwritten episode record, the miscounted skipped batch, the duplicated low-stock predicate, the unsanitized WhatsApp text, the unguarded scan overlap, the shared cache key fallback, the lying `minStock` field and the auth payload that omits the organization.

Branch: `feat/alerts-history`, based on `feat/server-owned-alerts` (`d3a3f16`) and rebased on `master` before the PR.
Delivery: single PR, work-unit commits.
Test runner: `cd backend && npx jest <path>`; `cd frontend && npx vitest run <path>`.

## Specs

- **H1** — Every episode transition appends an immutable `ProductStockAlertEvent`: `OPENED`, `RESOLVED`, `NOTIFIED`, `FAILED`, `SKIPPED`, carrying organization, product, episode number, the fixed failure code when it applies and the instant. Re-crossing an episode never destroys the previous one's record.
- **H2** — `GET /api/alerts/notifications?page=&limit=` returns the organization's events newest first, paginated, each with product `{ id, name, sku }`, episode, kind, failure code and timestamp. Roles: `ADMIN` (OWNER inherits) and `INVENTORY_USER`. The tenant comes from the token.
- **H3** — The frontend `/alerts` page renders that history with a kind filter, pagination, and loading, empty and error states; the alert panel links to it. Route map: `ADMIN`, `INVENTORY_USER`.
- **H4** — The low-stock predicate exists exactly once (`lowStockProductWhere` / `lowStockSweepWhere` in `backend/src/alerts/low-stock.where.ts`) and is used by the feed, the tenant sweep and the per-organization scan.
- **H5** — A batch recorded as `SKIPPED/no_recipient` reports the real number of episodes in `StockAlertScanSummary.failed`, not a constant.
- **H6** — The WhatsApp text normalizes product name and SKU (control characters, whitespace, length) before rendering, so a catalog name cannot fabricate lines or inject a link.
- **H7** — The scan is single-flight: a trigger that fires while a pass is running is skipped with a log line, and the cron expression is pinned by a test.
- **H8** — The bell's feed query fails closed when the session has no organization id: no request and no shared cache key.
- **H9** — The inventory form shows the stored `minStock`; a value of `0` renders `0`, never `5`.
- **H10** — `POST /auth/login`, `POST /auth/select-org` and `POST /auth/select-organization` include the organization object in the user payload, so `AuthContext.organization` is populated without a full reload.

## Tasks

| ID | Spec | Route | Status | Evidence |
| -- | ---- | ----- | ------ | -------- |
| T1 | H1-H2 | inline | done | `ProductStockAlertEvent`, migration `20261115120000`, `/alerts/notifications`, 58 alert specs |
| T2 | H3 | inline | done | `hooks/useAlertNotifications.ts`, `app/alerts/page.tsx`, route map, bell footer link, 5 page specs |
| T3 | H4-H7 | inline | done | `low-stock.where.ts`, skipped-batch count, `cleanCatalogText`, single-flight + cron test |
| T4 | H8-H10 | inline | done | fail-closed query, `minStock ?? 0`, organization in the token payload |
| T5 | H1-H10 | inline | pending | docs, full suites, PR, native review |

## Log

- **L1** (verbatim): "luego de terminar el goal que se esta ejecutando actualmenre correras otro para cubrir ll que hizo falta como la vista del historial de notificacion y lo que me comentaste en el ultimo /btw  :) cubrir los errored que quedaron."
- **L2** Scope decision: the "errors left over" are the review findings that were informational on the approved candidate (`R1-stock-episode-history`, `R2-1`, `R2-6`, `R1-WA-TEXT-INJECTION`, `R4-SCAN-NO-SINGLE-FLIGHT`, `R1-CACHE-KEY-TENANT`, `R2-7` tracker) plus the two defects found while diagnosing the original incident (`minStock` display, auth payload without the organization). Each gets a spec so the follow-up is closed with evidence instead of prose.
