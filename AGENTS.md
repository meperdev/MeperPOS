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
npm run seed            # Seed database with faker data
npx prisma migrate dev  # Run migrations
npx prisma studio       # Open Prisma Studio GUI
```

> ⚠️ `npm run lint` in the backend runs `eslint --fix` and will reformat ~80 unrelated files. To check without mutating the tree, use `npx eslint <file>`. The backend test suite also requires PostgreSQL on port 5432: roughly 94 integration tests fail without it.

### Frontend (`/frontend`)
```bash
npm run dev    # Development server
npm run build  # Production build
npm run lint   # ESLint
```

## Environment Setup

Backend requires a `.env` file in `/backend/`:
```
DATABASE_URL="postgresql://admin:admin123@localhost:5432/inventario_db"
JWT_SECRET="your-jwt-secret"
PORT=3001
CORS_ORIGIN="http://localhost:3000"
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
```

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

**Role system**: `OrgRole` (`prisma/schema.prisma`) is the single role enum — `OWNER`, `ADMIN`, `MEMBER`, `CASHIER`, `INVENTORY_USER`. `SUPER_ADMIN` is a non-persisted pseudo-role carried on `RequestUser`, not a column. `RolesGuard.getInheritedRoles` nests them: `OWNER ⊃ ADMIN ⊃ MEMBER ⊃ CASHIER`; `INVENTORY_USER` inherits nothing. Enforce authorization with `@Roles(...)` on the route — the `DashboardLayout` route map and per-page role checks in the frontend are display only and are never a security boundary.

**Database**: PostgreSQL via Prisma. Key models: `User`, `Product`, `Category`, `Customer`, `Sale`, `SaleItem`, `Payment`, `InventoryMovement`, `Settings`, `AuditLog`, `Organization`, `OrgUser`.

`Product` carries `version Int @default(0)` and it **is** used for optimistic concurrency: `ProductsService` updates with `where: { id, version: existingProduct.version, active: true }` plus `version: { increment: 1 }`, `PurchaseOrdersService` does the same when receiving stock, and `SettingsService` writes `Organization` under the same guard, answering 409 when the update matches nothing. Separately, the **stock quantity** is a compare-and-swap: `updateMany({ id, active: true, stock: { gte: qty } })` inside a transaction at `Prisma.TransactionIsolationLevel.Serializable`, rejecting when `count === 0`. The two mechanisms coexist — the version guard protects field-level edits, the CAS protects the stock quantity — so neither can be dropped on the assumption that the other covers it.

### Frontend Structure

Next.js App Router under `frontend/src/`:

**Pages** (`app/`): `login`, `register`, `dashboard`, `pos`, `inventory`, `sales`, `customers`, `reports`, `categories`, `profile`, `settings`, `admin`, `expenses`, `suppliers`, `tasks`, `users`, `purchase-orders`

**Data fetching**: All server state via TanStack Query (React Query v5). Custom hooks in `hooks/` wrap `api` client calls (e.g., `useProducts`, `useSales`). The `api` singleton in `lib/api.ts` is an Axios instance with auto-JWT injection and 401-redirect handling.

**Layout**: `DashboardLayout` wraps all authenticated pages. It renders the `Sidebar` and enforces role-based redirects. Mobile uses a slide-over sidebar; on desktop the sidebar is fixed and the main content column is offset with `lg:ml-[320px]`, so the two numbers must be changed together.

**UI Components** (`components/ui/`): `Badge`, `BentoSelect`, `Button`, `Card`, `ConfirmDialog`, `CurrencyInput`, `DynamicFallback`, `EmptyState`, `ErrorState`, `FilterBar`, `ImageUpload`, `Input`, `LoadingState`, `MetricCard`, `Modal`, `Pagination`, `Select`, `Stepper`, `Table`. All accept a `className` prop and use the `cn()` utility (clsx + tailwind-merge).

**Styling**: TailwindCSS v4 with CSS variables for theming. Variables defined in `globals.css` under `:root` (light) and `.dark` (dark mode). Key tokens: `--primary` (teal), `--terracotta` (accent), `--card`, `--border`, `--muted`. Theme toggled via `ThemeContext` which sets a `dark` class on `<html>`.

**Fonts**: Geist (sans) + JetBrains Mono (mono) via `next/font/google`, exposed as CSS variables `--font-geist` and `--font-jetbrains-mono`.

**POS module**: Maintains client-side cart state with favorites (persisted to `localStorage` under `pos_favorite_product_ids`), paused sales, multi-payment splits, and invoice printing through `printReceipt` from `useReceipt`.

**Contexts**: `AuthContext` (user + JWT), `ThemeContext` (dark/light), `ToastContext` (notifications).

## Key Conventions

- **The server owns every number that becomes money.** Tax rate (`resolveEffectiveTaxRate`), effective sale price (`computeEffectiveSalePrice`), sale totals, change and low-stock classification are all derived in the backend and sent down as fields. The client *reads* them; it never re-derives them. A client-supplied `unitPrice` is a **request to override**, not a default — it requires ADMIN/OWNER/CASHIER/SUPER_ADMIN and is recorded in `AuditLog` as `SALE_PRICE_OVERRIDE` inside the sale transaction. This permits raising or lowering the charged POS price, not editing catalog prices; MEMBER and INVENTORY_USER cannot override it. A financed sale's agreed total remains fixed after POS initiation. See `SalesService.create` and `canOverridePrice`.
- `cn()` from `lib/utils.ts` for conditional Tailwind class merging — always use this instead of string concatenation
- `formatCurrency(amount)` for COP formatting; `formatDate/formatDateTime` for es-CO locale
- `getApiErrorMessage(error, fallback)` for extracting user-facing error messages from Axios errors
- Backend DTOs use `class-validator` decorators; global `ValidationPipe` is applied in `main.ts`
- All API endpoints are prefixed with `/api` (set in `main.ts` via `app.setGlobalPrefix('api')`)
- Prisma migrations live in `backend/prisma/migrations/`; seed script is `backend/prisma/seed.ts`
- Derived product fields go through the single `enrichProduct` funnel in `ProductsService`, so a new field cannot reach only some endpoints
