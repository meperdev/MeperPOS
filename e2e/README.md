# Playwright smoke suite

End-to-end smoke tests for the critical MeperPOS flows, run in Chromium against
a real backend, a real frontend and a dedicated, freshly seeded PostgreSQL.

| Flow | Spec | What it proves |
| --- | --- | --- |
| Login | `tests/login.spec.ts` | A wrong password shows an error and stays on `/login`; the seeded owner signs in and lands on `/dashboard`. |
| POS cash checkout | `tests/pos-checkout.spec.ts` | A seeded product found by SKU reaches the cart at its server price, a cash payment completes the sale, the cart empties, and `/sales` lists the sale with the same number and total. |
| Inventory | `tests/inventory-create-product.spec.ts` | "Nuevo producto" creates a product with a unique name and SKU, and the catalogue search finds it. |
| Session restore after a browser restart | `tests/session-restart.spec.ts` | After sign-in, dropping every session-only cookie (as a browser restart does) keeps `refresh_token` and `csrf_token`; reloading `/dashboard` refreshes with 201 and stays signed in. |

## Run it locally

Prerequisites: Docker (your user in the `docker` group), Node 22+, and the
dependencies of all three packages:

```bash
(cd backend && npm ci) && (cd frontend && npm ci) && (cd e2e && npm ci)
cd e2e
npm run install:browsers   # Chromium into ~/.cache/ms-playwright, once
npm run smoke              # whole stack + suite, then tears everything down
```

`npm run smoke` (`scripts/run-smoke.mjs`):

1. recreates the smoke Postgres from `e2e/docker-compose.yml` and waits for it;
2. runs `prisma migrate deploy` and `backend/prisma/seed-e2e.ts` against it;
3. builds the backend (`nest build`) and the frontend (`next build --webpack`);
4. starts the backend on **3101** and the frontend on **3100**, and waits for
   `/api/health`, `/login` and the `/api` proxy to answer;
5. runs `playwright test`;
6. stops both servers and removes the smoke Postgres.

Arguments after `--` go to Playwright: `npm run smoke -- --headed`,
`npm run smoke -- -g "POS"`. A rerun can skip the builds with
`SMOKE_SKIP_BUILD=1 npm run smoke` when nothing in `backend/` or `frontend/`
changed since the last smoke build.

To iterate on a spec against a stack that stays up, keep the database
(`SMOKE_KEEP_DB=1`) and start the servers yourself, or run the orchestrator
once and then `npm run test:e2e:smoke` while it is up. Note that the backend
allows 5 logins per minute per address and a run signs in 3 times, so wait a
minute between back-to-back runs against the same backend process.

### The isolated database (hard rule)

The smoke stack never touches the developer database (`backend/docker-compose.yml`:
container `postgres-db`, port 5432, database `inventario_db`, volume `postgres_data`).
Do not run `npm run db:up` / `db:down` for the smoke suite.

| | Developer DB | Smoke DB |
| --- | --- | --- |
| Compose file | `backend/docker-compose.yml` | `e2e/docker-compose.yml` (project `meperpos-playwright`) |
| Container | `postgres-db` | `meperpos-playwright-postgres` |
| Host port | `127.0.0.1:5432` | `127.0.0.1:55433` |
| Database | `inventario_db` | `meperpos_playwright` |
| Storage | volume `postgres_data` | tmpfs, gone on `down` |

Two guards enforce it: `scripts/database-guard.mjs` (orchestrator, unit-tested
by `npm run test:scripts`) and the check at the top of
`backend/prisma/seed-e2e.ts`. Both refuse any URL whose database is not
`meperpos_playwright` or whose port is 5432. The orchestrator also pins
`DATABASE_URL` **and** `DIRECT_URL` for every backend command, because
`backend/prisma.config.ts` falls back to the developer database when
`DATABASE_URL` is unset and reads `DIRECT_URL` for migrations.

`npm run db:up` / `db:down` / `db:reset` inside `e2e/` manage only the smoke
container.

### Configuration

All optional; the defaults are what CI and the docs assume.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SMOKE_DATABASE_URL` | `postgresql://playwright:playwright@127.0.0.1:55433/meperpos_playwright` | Smoke database (guarded as above). |
| `SMOKE_BACKEND_PORT` | `3101` | Backend port, away from the dev API on 3001. |
| `SMOKE_FRONTEND_PORT` | `3100` | Frontend port, away from the dev app on 3000. |
| `SMOKE_JWT_SECRET` | a smoke-only dummy | Signing secret for the smoke backend; never a real secret. |
| `SMOKE_EXTERNAL_DB` | unset | `1`: the database already runs (CI service); start no container. |
| `SMOKE_KEEP_DB` | unset | `1`: leave the smoke Postgres running afterwards. |
| `SMOKE_SKIP_BUILD` | unset | `1`: reuse the previous smoke builds. |
| `SMOKE_BASE_URL` | `http://127.0.0.1:3100` | Read by `playwright.config.ts`; set by the orchestrator. |

The frontend is built with `NEXT_PUBLIC_API_URL=/api` and
`BACKEND_ORIGIN=http://127.0.0.1:3101`, the same same-origin proxy shape as the
deployed app, so the auth cookies stay first-party and the CSP `connect-src
'self'` holds on any port. The backend runs with `NODE_ENV=test`, stock alerts
off and no Redis, WhatsApp or Cloudinary configuration, so a run has no
outbound side effects.

## Seed data

`backend/prisma/seed-e2e.ts` writes fixed data (no faker, no randomness) into a
fresh database; `fixtures/seed.ts` mirrors the values the specs use. Keep them
in sync.

- Organization `Tienda Smoke E2E` (`tienda-smoke-e2e`), plan PRO, active and paid.
- Owner `owner@smoke-e2e.test` / `smoke-e2e-owner` (role OWNER). These are
  smoke-only credentials for a throwaway database. No SuperAdmin is created,
  so `SUPER_ADMIN_PASSWORD` is not needed.
- Category `Bebidas E2E` (untaxed).
- Products, untaxed so the charged total equals the sale price:
  - `Café americano E2E`, SKU `E2E-CAFE-001`, sale price 5.000, stock 1000
  - `Agua con gas E2E`, SKU `E2E-AGUA-002`, sale price 3.000, stock 1000
- Sale and purchase-order sequences, the default cash register and the default
  expense taxonomy, like an organization created from the admin panel.

## Add a flow

1. Add `tests/<flow>.spec.ts`. Import `test` and `expect` from
   `../fixtures/test` for a signed-in owner, or from `@playwright/test` with
   `test.use({ storageState: { cookies: [], origins: [] } })` for a signed-out
   flow (see `login.spec.ts`).
2. Locate by role and accessible name, or by an existing `data-testid`. Adding
   a `data-testid` to the UI is fine; changing product behaviour for a test is not.
3. Use seeded data from `fixtures/seed.ts`; anything the test creates gets a
   unique name (see the inventory spec), so the suite never depends on run order.
4. Keep the number of UI logins low: signed-in specs reuse one session.
   The refresh token rotates on every page load, so `fixtures/test.ts` saves the
   rotated session after each test; that only works because the suite runs on
   one worker.
5. Run `npm run typecheck` and `npm run smoke` twice in a row before opening the PR.

## Look at a failure

Failures keep a trace, a screenshot and a video under `test-results/artifacts/`,
and the stack logs under `test-results/smoke-logs/` (`backend.log`, `frontend.log`).

```bash
npm run report                                   # HTML report in playwright-report/
npm run trace -- test-results/artifacts/<test>/trace.zip
```

In CI the job `E2E smoke (Playwright)` uploads `playwright-report/` and
`test-results/` as the artifact `playwright-smoke-<run id>-<attempt>` when it
fails. Download it and open the trace with `npx playwright show-trace trace.zip`
or at https://trace.playwright.dev.

## CI

`.github/workflows/ci.yml`, job `e2e-smoke`, on every pull request and every
push to `master` (the workflow's triggers). It starts a `postgres:17` service
with database `meperpos_playwright` on port 55433, installs the three packages
and Chromium (`npx playwright install --with-deps chromium`), runs the guard
tests, then `npm run smoke` with `SMOKE_EXTERNAL_DB=1` so the orchestrator uses
the service instead of Docker Compose. The job is not a required check.
