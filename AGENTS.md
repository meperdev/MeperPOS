# AGENTS.md

This file provides guidance to AI coding agents working in this repository.

## Project Overview

Full-stack inventory management system (MeperPOS) with a Point of Sale (POS) module. Built for a Colombian business context (currency: COP, locale: es-CO).

- **Backend**: NestJS 11 + Prisma 6 + PostgreSQL, running on port 3001
- **Frontend**: Next.js 16 (App Router) + React 19 + TailwindCSS v4, running on port 3000

## Commands

### Backend (`/backend`)
```bash
npm run start:dev       # Development with hot reload
npm run build           # Production build
npm run start:prod      # Run production build
npm run test            # Unit tests (Jest)
npm run test:e2e        # End-to-end tests
npm run test -- --testPathPatterns=<file> # Run single test file (Jest 30: plural)
npm run lint            # ESLint with auto-fix
npm run lint:ci         # ESLint without --fix (what CI runs)
npm run test:eslint-plugin # RuleTester suites of eslint-plugin-meperpos
npm run seed            # Dry-run of the two test orgs (Prueba PRO, Prueba BASIC); seed:apply writes, seed:verify counts
npm run cleanup:orgs    # Delete whole organizations by id (dry-run; --apply + CLEANUP_CONFIRM)
npx prisma migrate dev  # Run migrations
npx prisma studio       # Open Prisma Studio GUI
npm run db:up           # Start the local PostgreSQL container (docker compose)
npm run db:status       # Is the database container up?
npm run db:down         # Stop it
npm run db:logs         # Follow the server log
```

> ⚠️ `npm run lint` in the backend runs `eslint --fix` and will reformat ~80 unrelated files. To check without mutating the tree, use `npm run lint:ci` (or `npx eslint <file>`). The backend test suite also requires PostgreSQL on port 5432 (`npm run db:up` starts it): roughly 94 integration tests fail without it. Jest never writes to `inventario_db`: `test/global-setup.ts` moves a DATABASE_URL that names it to `meperpos_test` on the same server (the database CI uses) and runs `prisma migrate deploy` there first (`src/testing/test-database.ts`). The container is the `postgres` service of `backend/docker-compose.yml`; if Docker asks for a password, add your user to the group once (`sudo usermod -aG docker "$USER"`) and start a new session.

### Frontend (`/frontend`)
```bash
npm run dev    # Development server
npm run build  # Production build
npm run lint   # ESLint
npm run lint:ci            # same, as CI runs it
npm run test:eslint-plugin # RuleTester suites of eslint-plugin-meperpos
```

### E2E smoke (`/e2e`)
```bash
npm run smoke            # isolated Postgres + backend (3101) + frontend (3100) + Playwright, then teardown
npm run test:e2e:smoke   # Playwright only, against a stack that is already up
npm run test:scripts     # unit tests of the database guard and the explorer libs
npm run typecheck        # tsc over config, fixtures and specs
npm run explore          # exploratory bug bash on the same isolated stack; writes e2e/exploratory/reports/<run>/REPORT.md
```

- **The smoke suite must pass** before a PR that touches a covered flow (login, POS checkout, `/sales`, inventory create). CI runs it as the `E2E smoke (Playwright)` job.
- **It never touches the dev database.** It runs on its own Postgres (`e2e/docker-compose.yml`: container `meperpos-playwright-postgres`, `127.0.0.1:55433`, database `meperpos_playwright`, tmpfs). Never point it at `inventario_db` or port 5432, and never use `npm run db:up`/`db:down` for it; the orchestrator and `backend/prisma/seed-e2e.ts` refuse any other database.
- **Adding a flow:** a new `e2e/tests/<flow>.spec.ts` using `test` from `e2e/fixtures/test.ts` (signed-in) and the deterministic data in `e2e/fixtures/seed.ts`; anything the test creates gets a unique name. Adding a `data-testid` is test infrastructure; changing product behaviour for a test is not. Details, traces and the seed in `e2e/README.md`.
- **Exploratory bug bash (`npm run explore`)** is not a gate: it exits 0 when the run completes, whatever it found. It reuses the smoke stack and its database guard, stops after `--max-actions` (default 60) or `--max-minutes` (default 15), and writes a gitignored report with repro steps, evidence and a suggested trust-stack layer per finding, plus drafted GitHub issues. Agents never pass `--file-issues`: filing is a human decision (`npm run explore:file-issues -- <report dir> --dry-run` first). `--agent` (an optional LLM pass through the developer's OpenCode, browser-only and hard-capped) is off by default. See `e2e/README.md`, "Exploratory bug bash".

## Environment Setup

Backend requires a `.env` file in `/backend/`:
```
DATABASE_URL="postgresql://admin:admin123@localhost:5432/inventario_db"
JWT_SECRET="your-jwt-secret"
SUPER_ADMIN_PASSWORD=""  # seed-only: SUPER_ADMIN bootstrap requires an explicit >=10-char password (never defaulted or printed)
SEED_TEST_ORG_PASSWORD=""  # seed-only: password of the two test-org admins, >=12 chars (or a 0600 SEED_TEST_ORG_PASSWORD_FILE)
PORT=3001
CORS_ORIGIN="http://localhost:3000"
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
```

`CORS_ORIGIN` is also the pre-auth login allowlist (SEC-007): every production frontend Origin must be listed, and `backend/src/config/required-production-origins.json` is the committed set a boot warning, the unit tests and the daily production probe check (`docs/bug-rules/2026-11-22-cors-origin-pwa.md`).

Frontend uses `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:3001/api`).

## Architecture

### Backend Structure

NestJS modules under `backend/src/`:

- `auth/` — JWT authentication, login/refresh, cookies, CSRF, role guards
- `products/` — Product CRUD + `products.controller.ts` (CRUD) and `products-search.controller.ts` (search, quick-search, low-stock)
- `sales/` — Sale creation with multi-payment support (CASH/CARD/TRANSFER)
- `purchase-orders/` — PO creation, receiving, and a state machine
- `expenses/` — expenses plus an expense taxonomy (groups/labels)
- `suppliers/`, `customers/`, `categories/`, `tasks/`, `users/`
- `reports/` — financial reporting; `exports/` — export endpoints
- `cash-registers/`, `billing/`, `plan-limits/`, `provisioning/`, `admin/`
- `imports/` — multi-sheet importer; `backfill/` — CLI backfill planners
- `receipts/`, `settings/`, `cloudinary/`, `config/`, `common/`
- `prisma/` — singleton `PrismaService` shared across all modules
- `testing/` — shared test fixtures/helpers

**Auth flow**: Access and refresh tokens both ride **httpOnly cookies**. The refresh token is cookie-ONLY and is stripped from every response body. `applyAuthCookies` / `clearAuthCookies` in `auth/cookies.helper.ts` own that; a CSRF cookie + `cookie-csrf.guard.ts` protect the mutating routes. `JwtAuthGuard` + `JwtStrategy` validate the access token. **The frontend does not keep the access token in `localStorage`** — `setAccessToken`/`clearAccessToken` in `lib/session.ts` hold it in memory for the session, and `refreshSession()` in `lib/api.ts` dedupes concurrent refreshes. `localStorage` is used only for `selectedOrganizationId` and UI preferences.

**Role system**: `OrgRole` (`prisma/schema.prisma`) is the single role enum and holds exactly three roles — `ADMIN` (Propietario/Admin), `CASHIER` and `INVENTORY_USER` (Bodega). `SUPER_ADMIN` is a non-persisted pseudo-role carried on `RequestUser`, not a column. `effectiveRoles` in `common/guards/role-hierarchy.ts` (read by `RolesGuard` and the alert feed; table in `role-hierarchy.table.json`, mirrored by `frontend/src/lib/role-hierarchy.table.json` under a contract test) nests them: `ADMIN ⊃ CASHIER`; `INVENTORY_USER` inherits nothing. `common/guards/permission-matrix.spec.ts` pins who passes `RolesGuard` on every route; a permission change updates its snapshot (`-u`) and the snapshot diff is what review reads. `OWNER` and `MEMBER` no longer exist: `20261127120000_retire_member_role` moved every member to `CASHIER`, `20261127130000_collapse_owner_into_admin` moved every owner membership to `ADMIN`, and `20261127200000_drop_owner_member_roles` recreated the type without either label, so `@IsEnum(OrgRole)` refuses both literals everywhere and no route, DTO, seed or frontend type may name them. The primary owner is an `ADMIN` membership with `isPrimaryOwner`, and only it (or a `SUPER_ADMIN`) may create `ADMIN` users or edit, deactivate, remove or reset the password of the primary owner or any other `ADMIN` (`assertMayManageAdminAccount` in `UsersService`; editing or resetting one's own account is exempt, deactivating oneself never is). The column still defaults to `CASHIER`. Enforce authorization with `@Roles(...)` on the route — the `DashboardLayout` route map and per-page role checks in the frontend are display only and are never a security boundary.

**Database**: PostgreSQL via Prisma. Key models: `User`, `Product`, `Category`, `Customer`, `Sale`, `SaleItem`, `Payment`, `InventoryMovement`, `Settings`, `AuditLog`, `Organization`, `OrgUser`.

`Product` carries `version Int @default(0)` and it **is** used for optimistic concurrency: `ProductsService` updates with `where: { id, version: existingProduct.version, active: true }` plus `version: { increment: 1 }`, `PurchaseOrdersService` does the same when receiving stock, and `SettingsService` writes `Organization` under the same guard, answering 409 when the update matches nothing. Separately, the **stock quantity** is a compare-and-swap: `updateMany({ id, active: true, stock: { gte: qty } })` inside a transaction at `Prisma.TransactionIsolationLevel.Serializable`, rejecting when `count === 0`. The two mechanisms coexist — the version guard protects field-level edits, the CAS protects the stock quantity — so neither can be dropped on the assumption that the other covers it.

### Frontend Structure

Next.js App Router under `frontend/src/`:

**Pages** (`app/`): `login`, `register`, `dashboard`, `pos`, `inventory`, `sales`, `customers`, `reports`, `categories`, `profile`, `settings`, `admin`, `expenses`, `suppliers`, `tasks`, `users`, `purchase-orders`

**Data fetching**: All server state via TanStack Query (React Query v5). Custom hooks in `hooks/` wrap `api` client calls (e.g., `useProducts`, `useSales`). The `api` singleton in `lib/api.ts` is an Axios instance with auto-JWT injection and 401-redirect handling.

**Layout**: `DashboardLayout` wraps all authenticated pages. It renders the `Sidebar` and enforces role-based redirects. Mobile uses a slide-over sidebar; on desktop the sidebar is fixed (`lg:w-[256px]`, `lg:w-[72px]` collapsed) and the main content column is offset with `lg:ml-[256px]` / `lg:ml-[72px]`, so the width and the margin must be changed together — including in `AppShellSkeleton`, which mirrors the same geometry for the first paint.

**UI Components** (`components/ui/`): `Badge`, `Button`, `Card`, `ConfirmDialog`, `CurrencyInput`, `DynamicFallback`, `EmptyState`, `ErrorState`, `FilterBar`, `ImageUpload`, `Input`, `LoadingState`, `MetricCard`, `Modal`, `Pagination`, `Select`, `Stepper`, `Table`. All accept a `className` prop and use the `cn()` utility (clsx + tailwind-merge).

**Styling**: TailwindCSS v4 with CSS variables for theming. Variables defined in `globals.css` under `:root` (light) and `.dark` (dark mode). Key tokens: `--primary` (teal), `--terracotta` (accent), `--card`, `--border`, `--muted`. Theme toggled via `ThemeContext` which sets a `dark` class on `<html>`.

**Fonts**: One family — Inter — self-hosted via `next/font/local` from `frontend/src/app/fonts/inter-latin.woff2`, exposed as `--font-sans-face`; this keeps production builds independent of any Google Fonts request. It is Inter 4.1 subset to latin with `pyftsubset` keeping both variable axes (`opsz` 14-32, `wght` 100-900) and the features the UI uses (`tnum`, `calt`, `cv11`, `ss01`); its licence ships as `Inter-OFL.txt`. No second family is loaded, and `globals.css` declares no `--font-mono`: **identifiers** — SKU, barcode, sale/purchase-order/receipt numbers, NIT, phone, account and document numbers — ride Inter with tabular figures through `.id-text` (tabular nums, `tnum`, a hair of tracking), and money, counts and percentages through `.stat-number` / `tabular-nums`. **Dates and times are the exception: they render in proportional figures**, in the same face with no `tabular-nums`, no `.stat-number` and no `.id-text`, so the digits space as text reads instead of lining up like a mono column; only a line that mixes a date with money or a count keeps tabular figures. The subset keeps `tnum` but not `zero`, so no slashed zero is drawn. The only place that keeps a fixed-width face is a literal command the reader may retype (`<code>` in the admin panel), which borrows the platform stack through `.code-text` instead of loading a font. Body and table cells sit at `text-sm` (14px); labels, metadata and helper text at `text-[13px]`; true micro-labels — chips, badges, kbd hints, table header captions — at `text-xs` (12px), which is the floor, so no `text-[10px]` or `text-[11px]` survives anywhere. Summary and metric values take one step above their label (`text-xl` on phones, `sm:text-[28px]` on desktop), and headings use `letter-spacing: -0.015em`.

**POS module**: Maintains client-side cart state with favorites (persisted to `localStorage` under `pos_favorite_product_ids`), paused sales, multi-payment splits, and invoice printing through `printReceipt` from `useReceipt`.

**Contexts**: `AuthContext` (user + JWT), `ThemeContext` (dark/light), `ToastContext` (notifications).

## Key Conventions

- **Every authenticated, organization-scoped route MUST carry `@UseGuards(..., OrganizationRequiredGuard)` (plus `JwtAuthGuard` + `@Roles`).** This guard is the tenant boundary: without it, `user.organizationId` can arrive `undefined` and the Prisma fallback pattern `...(organizationId ? { organizationId } : {})` silently degrades into a **cross-tenant, all-organizations query** (see `docs/security/FINDINGS.md`, SEC-002 — security audit FASE 2). Only platform `SUPER_ADMIN` routes (`admin/*`, `whatsapp/intelligence`) and pre-auth routes (`auth/*`, WAHA webhook, health) may omit it. If you add a controller or endpoint, include the guard or there must be an explicit, commented reason; new services must scope every read AND every write (`where: { id, organizationId }`), never a conditional-org fallback.
- **The server owns every number that becomes money.** Tax rate (`resolveEffectiveTaxRate`), effective sale price (`computeEffectiveSalePrice`), sale totals, change and low-stock classification are all derived in the backend and sent down as fields. The client *reads* them; it never re-derives them. A client-supplied `unitPrice` is a **request to override**, not a default — it requires ADMIN/CASHIER/SUPER_ADMIN and is recorded in `AuditLog` as `SALE_PRICE_OVERRIDE` inside the sale transaction. This permits raising or lowering the charged POS price, not editing catalog prices; INVENTORY_USER cannot override it. A financed sale's agreed total remains fixed after POS initiation. See `SalesService.create` and `canOverridePrice`.
- **The alert feed is server-owned.** `GET /api/alerts` (`backend/src/alerts/`) returns the whole feed with a `revision` per alert; the bell only renders it and keeps a per-organization `id -> revision` ledger, so a changed condition re-alerts without a new id. Low-stock episodes live in `ProductStockAlert`, every transition is appended to `ProductStockAlertEvent`, and their WhatsApp text goes through `WHATSAPP_TEXT_SENDER` on the central `INTELLIGENCE` session — one attempt per episode, no automatic retry. The history is served at `GET /api/alerts/notifications` and rendered at `/alerts`. See `docs/referencias/alertas.md`.
- **A sent purchase order is a frozen document.** The first `POST /api/purchase-orders/:id/send` stores `documentSnapshot` (business, supplier, template, item names); every later `GET /api/purchase-orders/:id/pdf` renders from it, so the supplier's copy never changes. Sending adds no status: a `PENDING` order with `sentAt` reads "Enviada", and `overdue` is server-computed by `isPurchaseOrderOverdue`. See `docs/referencias/ordenes-de-compra.md`.
- **UI copy is sentence case, in Spanish**: actions, titles and labels capitalize only the first word and proper nouns (`Nuevo cliente`, `Registrar pago`, `Editar producto`), never Title Case (`Nuevo Cliente`). No exclamation marks or emoji in chrome; an action reads verb + object.
- **Notifications are one component and one API.** `useToast()` from `contexts/ToastContext.tsx` offers `success/error/warning/info(message, options?)`, where `message` is the title and `options` is either a number (duration) or `{ description, duration, action }` — existing `toast.success("…")` calls need no change. Cards render in `components/ui/ToastStack.tsx`: top-centre, under the mobile header below `lg` and under `--app-header-height` at `lg`, newest first, three visible with the next two peeking behind; hover, keyboard focus or a tap opens the stack and pauses every countdown. Errors outlive confirmations (6000ms vs 4000ms) and a toast with an action never leaves before 8000ms.
- **Integer counters use `Stepper`** (`components/ui/Stepper.tsx`, the POS "− 1 +" control): cart quantity, stock, minimum stock, ordered and received units. Pass `label` (with `hideLabel` inside a table cell) so the field and its buttons are named after it. Decimal values (tax rates, percentages) stay on `Input type="number"`, and money goes through `CurrencyInput`.
- `cn()` from `lib/utils.ts` for conditional Tailwind class merging — always use this instead of string concatenation
- `formatCurrency(amount)` for COP formatting; `formatDate/formatCalendarDay` for a day, `formatDateTime` for the compact row wording (`16 nov 2026, 4:21 p. m.`), and `formatDateTimeLong` (`16 de noviembre de 2026 a las 04:21 p. m.`) for anything printed or sent — the receipt preview, an export, a WhatsApp text
- `getApiErrorMessage(error, fallback)` for extracting user-facing error messages from Axios errors
- Backend DTOs use `class-validator` decorators; global `ValidationPipe` is applied in `main.ts`
- All API endpoints are prefixed with `/api` (set in `main.ts` via `app.setGlobalPrefix('api')`)
- Prisma migrations live in `backend/prisma/migrations/`; the only seed is `backend/prisma/seed-test-orgs.ts` (two test organizations, «Prueba PRO» on PlanType.PRO and «Prueba BASIC» on PlanType.BASIC, one ADMIN each, identical locally and in production; never add another seed — extend its plan in `src/seeding/test-orgs-seed.plan.ts`)
- Derived product fields go through the single `enrichProduct` funnel in `ProductsService`, so a new field cannot reach only some endpoints

## Bug → rule loop (trust stack)

Push every fix as high up the stack as it will go, and prefer the higher layer:

1. **01 types/boundaries** — make the bug unrepresentable: Prisma schema, TypeScript types, `class-validator` DTOs, guards, Nest module limits.
2. **02 lint/test** — when the type system cannot hold it, add a rule to the local ESLint plugin (`backend/eslint-plugin-meperpos/`, `frontend/eslint-plugin-meperpos/`, with RuleTester fixtures: the broken pattern fails, the fix passes) or a regression test.
3. **03 prose** — only what cannot be checked mechanically goes into this file or a skill.

Human review comes last, never first.

- Every `fix:` PR names the layer it raised the fix to and adds one entry file under `docs/bug-rules/` (append-only; how to in `docs/bug-rule-log.md`).
- CI blocks on `npm run lint:ci` (ESLint without `--fix`) and `npm run test:eslint-plugin` in both `backend/` and `frontend/`. Run them locally before opening a PR. `meperpos/*` rules are always errors; silencing one needs `// eslint-disable-next-line <rule> -- <reason>` on that line.
- `meperpos/require-string-length-bound` makes every `@IsString()` field in a backend `*.dto.ts` carry `@MaxLength`/`@Length` (`{ each: true }` on arrays) unless a format decorator already caps it; size the bound to the column or its consumer (receipt, PDF, sibling DTO).
- Pre-existing stock-rule debt is frozen in a file-scoped baseline (`backend/eslint.baseline.mjs`, the baseline block in `frontend/eslint.config.mjs`) that may only shrink. Never add a file to it.
- **Agents never merge.** They open a PR with `.github/pull_request_template.md` filled in and leave the merge to a human.
- **The semáforo label is automatic.** `.github/workflows/semaforo.yml` labels every PR (`semaforo:verde|amarillo|rojo`) and keeps one summary comment from `.github/semaforo/config.json`; it never blocks or becomes a required check, and `semaforo:manual` or a semáforo label set by a person wins over it. When it mislabels one, the fix is a rule in that config plus a test in `classify.test.mjs` (bug → rule).
