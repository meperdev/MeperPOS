# Reports redesign + daily report + Economía fixes

Objective: turn `/reports` into a clearer reports page with a "Hoy" daily-report section, fix the audited Economía calculation gaps, and redesign the analysis blocks.
Branch: `feat/reports-redesign` · Delivery: `single-pr` ("TOdo junto, solo separada por commits") · Runners: backend `npm run test -- --testPathPatterns=<file>` (Jest 30, Postgres on 5432 is up), frontend `npx vitest run <file>`.

## Specs

- **S1 — Daily report on the page.** User: "Tambien me interesa el generador del reporte diario que se usaria para el intelligence usarlo para poder generar el reporte diario ahi mismo en la pagina de reports." Chosen option: "Opcion 1 si", meaning **view it on screen and download it**: a "Hoy" section fed by `GET /api/reports/daily-report` (pulse: sales total and count, expenses, cutoff time, refresh; pending items with counts, the first 3 and a link: low stock → `/inventory`, pending purchase orders → `/purchase-orders`, overdue or due loans → `/loans`; a collapsible list of today's sales with number, time, customer and total) plus a "Reporte del día (PDF)" button using `GET /api/reports/daily-report/pdf`. It always shows today, independent of the period filter, and says so. The backend daily report is reused unchanged.
- **S2 — Page structure** (approved: "Me sirve"): header (PDF button and a direct export button; the export strip that rendered `( → )` is removed) → Hoy → Análisis del período, with the period filter placed above Análisis because it only applies there. Análisis = Economía, Caja e inventario, Ventas (top products, categories, customers, payment methods) + **ventas por vendedor** (`GET /api/reports/users/performance`, currently unused).
- **S3 — Visualizations.** User: "mira opciones de mostrar la info [Image 1] distinta a esa, me gusta esa, pro no para todos los graficos". Agreed mapping: top products = ranked bar list (the style the user likes); categories = one 100% stacked bar + legend sorted desc (top 5 + "Otras"); payment methods = one segmented bar + figures, without $0 rows; top customers = compact table of 5 without the walk-in bucket; new "Ganancia por producto" table from the existing `products[]` margins; ventas por vendedor = table (sales, total, average ticket).
- **S4 — No floating cards.** User: "mira que las cards no queden medio volando con informacion que nunca se llenara porque es minima." Cards size to their content (no stretching to match a neighbour); a block that rarely fills becomes one line of text or merges with another block.
- **S5 — Economía audit fixes.** User: "quiero que solicites los calculos de Economia y revises tu personalmente como estan y si hay algun hueco o mejora para ellos." Fix each audited gap with a test:
  - S5.1 Expense dates (stored at UTC midnight) filtered with the Bogotá timestamp window — probable off-by-one day; confirm with a RED test first (`expenses.service.ts` `findForReports`; also check `ExpensePayment.date` in cash flow and the economic export).
  - S5.2 "Todo" means current month in Economía but all time in the operational reports — the page always sends an explicit range (default "Este mes").
  - S5.3 Delta percentage divides by a signed previous value (inverted sign when previous < 0) and reports 100% when previous = 0 — use |previous|, and `null` when previous is 0 and current is not.
  - S5.4 The breakdown does not reconcile when items lack a cost snapshot — expose `attributableRevenue` and make the breakdown add up.
  - S5.5 Operational reports (top products, categories, payment methods, customers) drop `RETURNED_PARTIAL` sales entirely while Economía nets returns — make them consistent.
  - S5.6 Net cash flow is computed in the browser (`page.tsx:626`) — the server returns `netFlow`.
  - Also: categories sorted by total desc; the walk-in "Guest" bucket (sales without a customer) is excluded from the top customers ranking.
- **S6 — Design rules.** User: "recuerda que todo el frontend tiene que llevar reglas de la skill unslop-ai-ui e impeccable que tengo en el sistema. Tu tambien ayudame con el front, pero sin salirse como del diseño central". Stay inside the existing design system (tokens in `globals.css`, `SectionShell`, `MetricCard`, `Table`, `cn()`, `formatCurrency`), sentence case Spanish copy, `tabular-nums`, no pills/emoji, 4/8px grid. Run the impeccable detector on the changed UI.
- **S7 — Delivery.** User: "TOdo junto, solo separada por commits" — one PR, one Conventional Commit per work unit.

## Tasks

| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1 | S5.1 | delegated (backend writer, parallel) | done (RED 5/5 → GREEN) | 2d4f667 |
| T2 | S5.3, S5.4 | delegated (backend writer, parallel) | done (RED delta/attributableRevenue → GREEN) | 82f2a3d |
| T3 | S5.5 | delegated (backend writer, parallel) + parent correction | done (RED 5/6 → GREEN; verifier blocker fixed) | 7185d4f, e9a6921 |
| T4 | S5.6, S5 extras | delegated (backend writer, parallel) | done (RED netFlow/order/Guest → GREEN) | c9a031d |
| T5 | S1, S2 (header + Hoy) | delegated (frontend writer, parallel) | done (RED helpers/component → GREEN) | 2a8b527 |
| T6 | S2, S3, S4, S5.2, S6 (Análisis) | delegated (frontend writer, parallel) | done (RED helpers/hooks → GREEN) | c1bd4a1 |
| T7 | all | parent: commits, suites, verifier, native review, visual check | done except the visual check (browser not connected) | |

Route evidence: Writer trigger (a) parallelism — backend (`backend/**`) and frontend (`frontend/**`) are independent units with disjoint edit surfaces, each several hundred lines; the frontend codes against the backend contract below. The parent owns git and builds the commits from the backend writer's per-task checkpoints.

Backend → frontend contract:
- `GET /reports/economic`: `current|previous.attributableRevenue: string`; `deltas.*.percentage: number | null` (computed over |previous|, `null` when previous is 0 and current is not, `0` when both are 0).
- `GET /reports/economic/cash`: adds `netFlow: string` = collections total − expense payments total.
- `GET /reports/sales/category`: `data` sorted by total desc.
- `GET /reports/customers/statistics`: `topCustomers` excludes sales without a customer.
- The operational endpoints count `RETURNED_PARTIAL` sales net of returned quantities.

## Log

- L1 (2026-11-16, user): "Hola necesito hacr un cambio en Reports, necesito cambiarlo y se vuelva una mejor pagina de reportes. Pero no se como sumarle o ajustarle el valor que ya tiene para que sea mejor visto o mas facil de mostrar. Tambien me interesa el generador del reporte diario que se usaria para el intelligence usarlo para poder generar el reporte diario ahi mismo en la pagina de reports."
- L2 (user): "Opcion 1 si. Y que mas piensas ajustar, agregar o mover de reports?"
- L3 (user): "Me sirve, pero unas anotaciones mira opciones de mostrar la info [Image 1] distinta a esa, me gusta esa, pro no para todos los graficos, tambien mira que las cards no queden medio volando con informacion que nunca se llenara porque es minima. Tambien quiero que solicites los calculos de Economia y revises tu personalmente como estan y si hay algun hueco o mejora para ellos. Y recuerda que todo el frontend tiene que llevar reglas de la skill unslop-ai-ui e impeccable que tengo en el sistema. Tu tambien ayudame con el front, pero sin salirse como del diseño central, va?"
- L4 (user): "TOdo junto, solo separada por commits"
- L5 (parent audit): findings in S5; verified correct: global discount allocation (item.subtotal is already net of the item discount, `sale-pricing.ts:97`). "Guest" = `customerId` null bucket (`reports.service.ts:1206`). "Todo" = current month (`reports.service.ts:222`). `MetricCard` already renders `percentage: null` as no baseline.
- L6 (writers): both units done. Backend: new `buildStoredDateWindow` (expenses.service.ts) used by `findForReports`, the reports expense fallback and the cash-flow expense-payment filter; partial returns go through one loader/expander shared by the operational reports; payment methods count payments gross on partial returns because the model has no refund row (open product question). Frontend: page split into `components/reports/*`, `useDailyReport`, `useUserPerformance`; impeccable detector `[]`.
- L7 (parent): `npx prisma generate` refreshed a stale local client (37 tests and 141 tsc errors failed on base without it). Regenerated the report goldens (`npm run fixtures:reports-golden`) per commit; the expense-payment rows had no `orderBy`, so the per-method order followed the query plan — added `orderBy: [date, id]` (in commit 2d4f667), goldens proven deterministic by two identical captures. Full suites on the final bytes: backend 4833 passed / 17 skipped (240/242 suites); frontend 1527 passed, `tsc` clean. Each commit: reports+expenses specs green.
- L8 (parent): review assess over d1b7b93..HEAD → medium, `under_budget`. Risk line names item 3: shared report code also feeds the Excel economic export (expense window) and other consumers of the operational endpoints. Follow-ups out of scope: `ExpensesService.findAll` month filter and `getMonthlySummary` have the same UTC-midnight off-by-one; `getSalesByCategoryDaily` (dashboard chart) still reads COMPLETED only.
- L9 (verifier): S1–S4, S5.1–S5.4, S5.6, S6 met; S5.5 blocker — customer ranking ignored a return dated after the sale's period (`returnedSaleRevenue` early return). Fixed in 9196b74 (RED: customer revenue 200 instead of 100 → GREEN); recheck: resolved, customer 100 agrees with Economía and products. A customer whose only activity in the period is a return is not listed in the ranking (accepted presentation). Advisories: payment methods count partial-return payments gross (product question for the user); cash-flow collections still read COMPLETED only; `categoryShares` hides negative categories; legacy last-day timestamps after 00:00Z of the next UTC day are dropped (unreachable through the app).
- L10 (parent, native review): the full range exceeded the reviewer context budget (`lens_context_budget_exceeded`), so the local commits were reordered to keep the backend contiguous (tree unchanged) and the backend slice d1b7b93..e9a6921 (11 files, item 3) was reviewed alone with lenses risk + reliability: consent granted, approved, acknowledged (lineage review-2ba9f4dc32d174fa, authority burned). Frontend slice: medium, no named high-risk item, not due. Advisory findings (non-blocking follow-ups): top products and customer rankings lost their database `take` and now aggregate the whole period in memory; the customer path runs the same groupBy twice; a fully returned customer keeps a 0 row; payroll cash returns have no stable order; `buildStoredDateWindow` assumes Bogotá day bounds.
- Commits after the reorder: 2d4f667 T1, 82f2a3d T2, 7185d4f T3, c9a031d T4, e9a6921 T3 fix, 2a8b527 T5, c1bd4a1 T6.
- Next: visual check in the browser (browse extension not connected); product decision on partial-return payments.
