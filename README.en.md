# Inventory Management System

Full-stack inventory management system with a Point of Sale (POS) module, built for a Colombian business context (currency: COP, locale: es-CO).

![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=flat&logo=nestjs&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-000000?style=flat&logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=flat&logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-06B6D4?style=flat&logo=tailwindcss&logoColor=white)

> This file is the English version of the project README. The primary documentation is available in Spanish: [README.md](./README.md).

## Table of contents

- [Key features](#key-features)
- [Tech stack](#tech-stack)
- [Repository structure](#repository-structure)
- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Useful scripts](#useful-scripts)
- [Roles and permissions](#roles-and-permissions)
- [Architecture](#architecture)

## Key features

### Inventory
- Full product CRUD with search, quick search, and low-stock alerts.
- Inventory movements: `PURCHASE`, `SALE`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `DAMAGE`, and `RETURN`.
- Product categories.
- Optimistic concurrency for products (`version` field).
- Product import and image upload to Cloudinary.

### Sales / POS
- Point of Sale (POS) module with client-side cart, favorites, paused sales, and multiple payment splits.
- Mixed payments: cash (`CASH`), card (`CARD`), and transfer (`TRANSFER`).
- Invoice printing from the browser.
- Sale numbering through per-organization sequences (`OrganizationSequence`).

### Purchasing / Suppliers
- Purchase orders with states: `DRAFT`, `PENDING`, `PARTIAL_RECEIVED`, `RECEIVED`, and `CANCELLED`.
- Supplier management.

### Finance / Expenses
- Expenses with partial payments and expense categories.
- Cash register management.
- Reports.

### Administration / Multi-tenant
- Multi-tenancy per organization (`Organization`), with per-organization roles (`OrganizationUser`).
- `BASIC` and `PRO` plans (`PlanType` enum) with billing states (`PENDING`, `PAID`, `OVERDUE`), trial period, and organization states (`TRIAL`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`).
- Per-plan limits and an admin panel.
- Event audit (`AuditLog`) and activity records (`Task` / `TaskEvent`).
- User management and role-based permissions.

### Other
- JWT authentication with refresh tokens (`RefreshToken`, `tokenVersion`) and bcryptjs.
- Global organization status guard (`OrganizationStatusGuard`) and rate limiting (`ThrottlerGuard`, 100 requests / 60 s).
- Data export to CSV, Excel, and PDF.
- Scheduled tasks (`@nestjs/schedule`).
- Swagger API documentation.

## Tech stack

| Layer       | Technology                                                             |
| ----------- | ---------------------------------------------------------------------- |
| Frontend    | Next.js 16 (App Router), React 19, TypeScript                          |
| Backend     | NestJS 11, TypeScript                                                  |
| ORM         | Prisma 6                                                               |
| Database    | PostgreSQL                                                             |
| Styling     | TailwindCSS v4, CSS variables (light/dark themes)                      |
| State       | TanStack Query v5, React Context (Auth, Theme, Toast)                  |
| Forms       | React Hook Form + Zod                                                  |
| Testing     | Vitest + Testing Library (frontend), Jest (backend)                    |
| Other       | Axios, lucide-react, clsx + tailwind-merge                             |

## Repository structure

```
MeperPOS/
├── backend/    # NestJS + Prisma + PostgreSQL REST API (port 3001)
└── frontend/   # Next.js App Router SPA (port 3000)
```

## Prerequisites

- **Node.js** (version compatible with Next.js 16 and NestJS 11).
- **npm** (bundled with Node.js).
- **PostgreSQL** running, with a database created for the project.

## Getting started

### 1. Database

Create the database in PostgreSQL, for example `inventario_db`.

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env  # or create the .env file manually (see variables)
npx prisma migrate dev
npm run seed:apply
npm run start:dev
```

Backend environment variables (`.env`):

```env
DATABASE_URL="postgresql://admin:admin123@localhost:5432/inventario_db"
JWT_SECRET="your-jwt-secret"
PORT=3001
CORS_ORIGIN="http://localhost:3000"
CLOUDINARY_CLOUD_NAME="..."
CLOUDINARY_API_KEY="..."
CLOUDINARY_API_SECRET="..."
```

The API will be available at `http://localhost:3001/api`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend environment variables (`.env.local`):

```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

The app will be available at `http://localhost:3000`.

## Useful scripts

### Backend (`backend/`)

| Script               | Description                                          |
| -------------------- | ---------------------------------------------------- |
| `npm run start:dev`  | Development server with hot reload                   |
| `npm run start:debug` | Development server in debug mode                   |
| `npm run start:prod` | Runs the production build (`dotenv -e`)              |
| `npm run build`      | Compiles the application                             |
| `npm run lint`       | ESLint with auto-fix                                 |
| `npm run format`     | Formats the code                                     |
| `npm run test`       | Unit tests (Jest)                                    |
| `npm run test:e2e`   | End-to-end tests                                     |
| `npm run test:cov`   | Tests with coverage                                  |
| `npm run seed`       | Dry-run of the two test organizations (`seed:apply` creates them) |
| `npm run migrate:dev` | Runs migrations in development                      |
| `npm run migrate:prod` | Runs migrations in production                      |
| `npm run studio`     | Opens Prisma Studio                                  |

### Frontend (`frontend/`)

| Script        | Description           |
| ------------- | --------------------- |
| `npm run dev` | Development server    |
| `npm run build` | Production build   |
| `npm run lint`  | ESLint            |
| `npm run test`  | Tests (Vitest)   |

## Roles and permissions

The system distinguishes between the global `SUPER_ADMIN` role (system administrator) and per-organization roles (`OrgRole`): `OWNER`, `ADMIN`, `MEMBER`, `CASHIER`, and `INVENTORY_USER`. Per-organization roles inherit permissions: `OWNER` inherits the permissions of `ADMIN`, `MEMBER`, and `CASHIER`; `ADMIN` inherits from `MEMBER` and `CASHIER`; `MEMBER` inherits from `CASHIER`. Route access is enforced both on the backend (guards and decorators) and on the frontend (`DashboardLayout` and the route-role map).

## Architecture

A web application composed of a REST API (NestJS + Prisma + PostgreSQL) and an SPA (Next.js App Router) that consumes the API through an Axios client with automatic JWT injection and redirects on `401` responses.

The backend is multi-tenant: each organization isolates its data, with its own sequence numbering, per-organization roles, and limits based on the contracted plan. Authentication uses JWT with refresh tokens; the frontend stores the token in `localStorage`. All endpoints are prefixed with `/api` and DTOs are validated with `class-validator` through a global `ValidationPipe`.
