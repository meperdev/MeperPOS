# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
npm run test -- --testPathPattern=<file>  # Run single test file
npm run lint            # ESLint with auto-fix
npm run seed            # Seed database with faker data
npx prisma migrate dev  # Run migrations
npx prisma studio       # Open Prisma Studio GUI
```

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
- `auth/` — JWT authentication, user registration/login, role-based guards
- `products/` — Product CRUD + two controllers: `products.controller.ts` (standard CRUD) and `products-search.controller.ts` (search, quick-search, low-stock)
- `sales/` — Sale creation with multi-payment support (CASH/CARD/TRANSFER)
- `categories/`, `customers/`, `reports/`, `settings/`, `exports/`, `cloudinary/`
- `prisma/` — Singleton `PrismaService` shared across all modules

**Auth flow**: JWT Bearer token, stored in `localStorage` on the frontend. The `JwtAuthGuard` + `JwtStrategy` validate tokens. All protected routes use `@UseGuards(JwtAuthGuard)`.

**Role system**: Three roles — `ADMIN`, `CASHIER`, `INVENTORY_USER`. Route access is enforced both in the backend (guards/decorators) and frontend (`DashboardLayout` route-role map).

**Database**: PostgreSQL via Prisma. Key models: `User`, `Product`, `Category`, `Customer`, `Sale`, `SaleItem`, `InventoryMovement`, `Settings`, `AuditLog`. Products use optimistic concurrency (`version` field).

### Frontend Structure

Next.js App Router under `frontend/src/`:

**Pages** (`app/`): `login`, `register`, `dashboard`, `pos`, `inventory`, `sales`, `customers`, `reports`, `categories`, `profile`, `settings`

**Data fetching**: All server state via TanStack Query (React Query v5). Custom hooks in `hooks/` wrap `api` client calls (e.g., `useProducts`, `useSales`). The `api` singleton in `lib/api.ts` is an Axios instance with auto-JWT injection and 401-redirect handling.

**Layout**: `DashboardLayout` wraps all authenticated pages. It renders the `Sidebar` and enforces role-based redirects. Mobile uses a slide-over sidebar; desktop uses a fixed 256px sidebar with `lg:ml-64` main content offset.

**UI Components** (`components/ui/`): `Button`, `Input`, `Card`, `Modal`, `Select`, `Badge`, `ConfirmDialog`, `ImageUpload`. All accept a `className` prop and use the `cn()` utility (clsx + tailwind-merge).

**Styling**: TailwindCSS v4 with CSS variables for theming. Variables defined in `globals.css` under `:root` (light) and `.dark` (dark mode). Key tokens: `--primary` (teal), `--terracotta` (accent), `--card`, `--border`, `--muted`. Theme toggled via `ThemeContext` which sets a `dark` class on `<html>`.

**Fonts**: One family — Inter — self-hosted (latin subset) via `next/font/local` from `frontend/src/app/fonts/inter-latin.woff2`, exposed as `--font-sans-face`, so production builds never request Google Fonts. There is no mono family: `globals.css` declares no `--font-mono`, and identifiers (SKU, barcode, sale/PO/receipt numbers, NIT, phone, account and document numbers) ride Inter with tabular figures through `.id-text`; money, counts, percentages and dates use `.stat-number` / `tabular-nums`. The only fixed-width text is a literal command the reader may retype (`.code-text`), which borrows the platform stack. Scale: body and table cells `text-sm` (14px), labels/metadata/helpers `text-[13px]`, micro-labels (chips, badges, kbd hints, table header captions) `text-xs` (12px — the floor), summary values one step above their label (`text-xl`, `sm:text-[28px]`).

**POS module**: Maintains client-side cart state with favorites (persisted to `localStorage` under `pos_favorite_product_ids`), paused sales, multi-payment splits, and invoice printing via `useInvoice`.

**Contexts**: `AuthContext` (user + JWT), `ThemeContext` (dark/light), `ToastContext` (notifications).

## Key Conventions

- **Every authenticated, organization-scoped route MUST carry `@UseGuards(..., OrganizationRequiredGuard)` (plus `JwtAuthGuard` + `@Roles`).** This guard is the tenant boundary: without it, `user.organizationId` can arrive `undefined` and the Prisma fallback pattern `...(organizationId ? { organizationId } : {})` silently degrades into a **cross-tenant, all-organizations query** (see `docs/security/FINDINGS.md`, SEC-002). Only platform `SUPER_ADMIN` routes (`admin/*`, `whatsapp/intelligence`) and pre-auth routes (`auth/*`, WAHA webhook, health) may omit it. If you add a controller or endpoint, include the guard or there must be an explicit, commented reason; new services must scope every read AND every write (`where: { id, organizationId }`), never a conditional-org fallback. See `AGENTS.md` for the full convention set.
- `cn()` from `lib/utils.ts` for conditional Tailwind class merging — always use this instead of string concatenation
- `formatCurrency(amount)` for COP formatting; `formatDate/formatDateTime` for es-CO locale
- `getApiErrorMessage(error, fallback)` for extracting user-facing error messages from Axios errors
- Backend DTOs use `class-validator` decorators; global `ValidationPipe` is applied in `main.ts`
- All API endpoints are prefixed with `/api` (set in `main.ts` via `app.setGlobalPrefix('api')`)
- Prisma migrations live in `backend/prisma/migrations/`; seed script is `backend/prisma/seed.ts`
