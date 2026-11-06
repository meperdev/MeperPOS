# Production sandbox seed

Objective: one deterministic, guarded seed that creates a single sandbox organization in a production database with representative data for every module (inventory, categories, customers, suppliers, purchase orders, sales, expenses, loans, employees, shifts, payroll and tasks). Branch `feat/prod-sandbox-seed`.
Base: `master` (`293f479` is the tip of the unrelated `feat/superadmin-password-reset` branch; this work starts from `master`).
Delivery: `single-pr`. One pull request; work-unit commits preserved inside the branch.
Runners: backend Jest (`npm run test`) for the pure plan; `npx tsc -p tsconfig.json --noEmit`; `npx eslint <touched files>` without `--fix`.

## Specs

S1. Entry point. New CLI `backend/prisma/seed-sandbox.ts`, wired as `sandbox:seed` (development env file) and `sandbox:seed:prod` (`.env.production`). It follows the `prisma/backfill-services.ts` shape: the decision logic lives in a pure, tested module under `backend/src/seeding/`, and the CLI only reads arguments/environment, runs one plan and reports it. The `sandbox:` prefix keeps the deployment guard that forbids naming a `npm run seed*` command as a production path untouched.

S2. Dry run is the default. A naked `npm run sandbox:seed` writes nothing and prints the dataset summary plus whether the target organization already exists. Only the exact `--apply` flag writes.

S3. Production guard. When `NODE_ENV` is neither `development` nor `test`, the CLI refuses unless `SEED_ALLOW_NON_DEV=true`. In that mode it also requires an explicit `SEED_SANDBOX_SLUG`; there is no production default slug. `--apply` additionally requires `SEED_DEMO_PASSWORD` with at least 12 characters. The password is hashed with `BCRYPT_ROUNDS` and never printed.

S4. Scope. The seed only creates or tops up the organization whose `slug` equals `SEED_SANDBOX_SLUG` (default `sandbox-demo` in development). It never updates or deletes rows belonging to any other organization, and it never updates existing products, customers, suppliers, employees, loans or sales.

S5. Organization. Creates the sandbox organization with `plan = PRO`, `status = ACTIVE`, `billingStatus = PAID`, `active = true`, country settings (`printHeader`, `printFooter`), the current-year `SALE` and `PO` sequences, and two cash registers (one default).

S6. Users and roles. Owner, admin, cashier, inventory user and member, all created with the `SEED_DEMO_PASSWORD` hash. The owner email is `SEED_OWNER_EMAIL` when provided, otherwise `owner@<slug>.demo`. Staff emails use `@<slug>.demo`. An existing user with the same email is reused and only its missing membership is added.

S7. Catalog. Six categories and twenty-six products (twenty-four stocked products plus two services) with deterministic names, SKUs, barcodes, costs, prices, stock, minimum stock, tax treatment and two promotions. SKUs and barcodes are unique. At least two products are at or below minimum stock. No existing product row is modified.

S8. Counterparties. Ten customers with unique document numbers and all four segments, and four suppliers with unique document numbers and bank data.

S9. Purchase orders. Four orders in `DRAFT`, `PENDING`, `PARTIAL_RECEIVED` and `RECEIVED`, with computed subtotals, taxes and totals, received quantities consistent with their status, and one `PURCHASE` inventory movement per received line ending at the product's current stock.

S10. Sales. Roughly seventy-five days of completed sales with one to three lines, cost-price snapshots, per-line tax, one or two payments, optional change for cash, optional customer, and the sale sequence advanced past the highest seeded number.

S11. Expenses. Eight expenses over the last two months using the default expense taxonomy, with `PAID` and `PARTIAL` statuses derived from their payments, one supplier link and one purchase-order link.

S12. Employees and shifts. Six employees (one inactive) with profile, modality and reference amount; deterministic shifts for the three day-rate employees over the last three weeks; no shift on an inactive employee and no duplicate employee/date.

S13. Payroll. Five obligations: three pending `SHIFT_GROUP`s covering each day-rate employee's shifts, one completed `FIXED_PERIOD` with a full `PayrollCashOutflow` plus `PayrollInstallment`, and one pending `FIXED_PERIOD`. Every stored status matches its cash: completed means paid equals total, pending means paid is lower.

S14. Money loans. Five loans (customer, supplier and user counterparties; `MONEY` and `SERVICE`) in `OPEN` and `CLOSED` states with append-only events (`CREATED`, `COLLECTED`, `CLOSED`) whose request keys are unique per loan and whose stored results match the running collected/balance totals. No `REVERSED` or `CANCELLED` events.

S15. Tasks. Five tasks covering every status with `CREATED` events and `STATUS_CHANGED` events where the status differs from `PENDING`, assigned to seeded users.

S16. Idempotence. A second `--apply` run skips every entity it can identify (slug, email, category name, SKU, document number, identification, label, notes marker, loan reason, task title, sale presence) and never duplicates activity. All writes of one run happen inside one transaction.

S17. Verification. The pure plan has RED-first Jest tests for every invariant the runner relies on: unique keys, money totals, payment sums, received quantities, payroll balances, loan balances, shift uniqueness and sale numbering. Closure runs the backend test suite, `npx tsc --noEmit` and eslint on the touched files.

## Tasks

| ID | Spec | Route | Status |
| --- | --- | --- | --- |
| T1 | S1, S2, S3, S17 | inline | done (`86dadc8`, `e9ed94c`, `374d7a2`) |
| T2 | S5, S6, S7, S8 | inline | done (`e9ed94c`) |
| T3 | S9, S10, S11 | inline | done (`e9ed94c`) |
| T4 | S12, S13, S14, S15 | inline | done (`e9ed94c`) |
| T5 | S16 | inline | done (`e9ed94c`, `374d7a2`) |
| T6 | docs + scripts | inline | done (`b1d048e`) |

## Log

L1. User request, verbatim: "Necesito que me prepares una seed para prod con una org. que tenga de otod un poquito, inventario, categorias, clientes, prestamos, empelados, ordenes de compra, nominas, etc."

L2. Destination decision (user answer): "Crear org sandbox nueva" — the script creates a dedicated sandbox organization (org, owner, users, sequences, cash registers and the full dataset) and never touches other organizations.

L3. Evidence: the deployment runbook states that production does not use demo data and that `seed:org:prod` only loads a catalog for a sandbox organization. This seed keeps that boundary: it is opt-in, dry-run by default and scope-limited to one explicit sandbox slug.

L4. Scratch-database verification. A throwaway `sandbox_seed_verify` database was created, migrated with `prisma migrate deploy` and seeded with `--apply`. Written: organization=1, users=5, categories=6, products=26, customers=10, suppliers=4, purchaseOrders=4, inventoryMovements=28, sales=181, expenses=8, employees=6, shifts=45, payrollObligations=5, payrollPayments=1, moneyLoans=5, loanEvents=9, tasks=5. SQL checks returned zero mismatches for sale totals, sale lines, payment sums, change, PO totals/items, expense status, movement chain, product stock chain, payroll status, loan status and request-key uniqueness. A second `--apply` reported "nothing new" and every count was unchanged. The owner password hash verified with bcrypt and the membership is OWNER with `isPrimaryOwner=true`.

L5. Verification evidence. Focused plan suite: 14 passed. Full backend suite: 200 suites passed, 2 skipped, 4242 tests passed, 17 skipped. One first run showed a `reports.golden` failure that passed in isolation and on the next full run; it is a pre-existing parallel-database flake, not caused by this change. `npx eslint` on the three touched files is clean. `npx tsc -p tsconfig.json --noEmit` reports only pre-existing spec errors, none in the new files.

L6. Guard verification. `NODE_ENV=production` without `SEED_ALLOW_NON_DEV` refuses before touching the database; with the flag but without `SEED_SANDBOX_SLUG` it refuses; `--apply` without a 12+ character password refuses. The `deployment-runbook.content.spec.ts` contract forbids naming a `npm run seed*` command as a production path, so the scripts are `sandbox:seed` and `sandbox:seed:prod`; the guard test was left untouched rather than weakened.

L7. Independent verification (`gentle-ai-verify`): PASS, no change-caused blocker. Its probes ran in a scratch copy and confirmed the focused suite 14/14, eslint clean, the tsc filter empty, all four guard refusals, the dry run writing zero rows, and 10 negative plan mutations rejected. Advisories accepted: the S7 arithmetic was corrected (twenty-four stocked plus two services), and the cash-register default is now only set when the organization has no default yet. The verifier's durable probes were materialized as `src/seeding/seed-sandbox.guards.spec.ts` and three contract tests in `sandbox-seed.plan.spec.ts`; the full suite then passed 201 suites / 4249 tests.


