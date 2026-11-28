# MeperPOS

Sistema full-stack de gestión de inventario con módulo Point of Sale (POS), diseñado para el contexto de negocio colombiano (moneda COP, locale es-CO).

> Read this file in English: [README.en.md](./README.en.md)

![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=flat&logo=nestjs&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-000000?style=flat&logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=flat&logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-06B6D4?style=flat&logo=tailwindcss&logoColor=white)

## Tabla de contenidos

- [Características principales](#características-principales)
- [Stack tecnológico](#stack-tecnológico)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Requisitos previos](#requisitos-previos)
- [Puesta en marcha](#puesta-en-marcha)
- [Scripts útiles](#scripts-útiles)
- [Roles y permisos](#roles-y-permisos)
- [Arquitectura](#arquitectura)

## Características principales

### Inventario
- CRUD completo de productos con búsqueda, búsqueda rápida y alertas de stock bajo.
- Movimientos de inventario: `PURCHASE`, `SALE`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `DAMAGE` y `RETURN`.
- Categorías de productos.
- Concurrencia optimista en productos (campo `version`).
- Importación de productos y subida de imágenes a Cloudinary.

### Ventas / POS
- Módulo Point of Sale (POS) con carrito del lado del cliente, favoritos, ventas pausadas y división de pagos múltiples.
- Pagos mixtos: efectivo (`CASH`), tarjeta (`CARD`) y transferencia (`TRANSFER`).
- Impresión de facturas desde el navegador.
- Numeración de ventas por secuencias por organización (`OrganizationSequence`).

### Compras / Proveedores
- Órdenes de compra con estados: `DRAFT`, `PENDING`, `PARTIAL_RECEIVED`, `RECEIVED` y `CANCELLED`.
- Gestión de proveedores.

### Finanzas / Gastos
- Gastos con pagos parciales y categorías de gastos.
- Gestión de cajas registradoras.
- Reportes.

### Administración / Multi-tenant
- Multi-tenant por organización (`Organization`), con roles por organización (`OrganizationUser`).
- Planes `BASIC` y `PRO` (enum `PlanType`) con estados de facturación (`PENDING`, `PAID`, `OVERDUE`), período de prueba (`trial`) y estados de organización (`TRIAL`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`).
- Límites por plan y panel de administración.
- Auditoría de eventos (`AuditLog`) y registro de actividades (`Task` / `TaskEvent`).
- Gestión de usuarios y permisos por rol.

### Otros
- Autenticación JWT con refresh tokens (`RefreshToken`, `tokenVersion`) y bcryptjs.
- Guard global de estado de organización (`OrganizationStatusGuard`) y rate limiting (`ThrottlerGuard`, 100 solicitudes / 60 s).
- Exportación de datos en CSV, Excel y PDF.
- Tareas programadas (`@nestjs/schedule`).
- Documentación de API con Swagger.

## Stack tecnológico

| Capa       | Tecnología                                                              |
| ---------- | ----------------------------------------------------------------------- |
| Frontend   | Next.js 16 (App Router), React 19, TypeScript                           |
| Backend    | NestJS 11, TypeScript                                                   |
| ORM        | Prisma 6                                                                |
| Base de datos | PostgreSQL                                                            |
| Estilos    | TailwindCSS v4, CSS variables (temas claro/oscuro)                      |
| Estado     | TanStack Query v5, React Context (Auth, Theme, Toast)                   |
| Formularios | React Hook Form + Zod                                                   |
| Testing    | Vitest + Testing Library (frontend), Jest (backend)                     |
| Otros      | Axios, lucide-react, clsx + tailwind-merge                              |

## Estructura del repositorio

```
MeperPOS/
├── backend/    # API REST NestJS + Prisma + PostgreSQL (puerto 3001)
└── frontend/   # SPA Next.js App Router (puerto 3000)
```

## Requisitos previos

- **Node.js** (versión compatible con Next.js 16 y NestJS 11).
- **npm** (incluido con Node.js).
- **PostgreSQL** en ejecución, con una base de datos creada para el proyecto.

## Puesta en marcha

### 1. Base de datos

Crea la base de datos en PostgreSQL, por ejemplo `inventario_db`.

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env  # o crea el archivo .env manualmente (ver variables)
npx prisma migrate dev
npm run seed:apply
npm run start:dev
```

Variables de entorno del backend (`.env`):

```env
DATABASE_URL="postgresql://admin:admin123@localhost:5432/inventario_db"
JWT_SECRET="tu-jwt-secret"
PORT=3001
CORS_ORIGIN="http://localhost:3000"
CLOUDINARY_CLOUD_NAME="..."
CLOUDINARY_API_KEY="..."
CLOUDINARY_API_SECRET="..."
```

La API queda disponible en `http://localhost:3001/api`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Variables de entorno del frontend (`.env.local`):

```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

La aplicación queda disponible en `http://localhost:3000`.

## Scripts útiles

### Backend (`backend/`)

| Script                 | Descripción                                             |
| ---------------------- | ------------------------------------------------------- |
| `npm run start:dev`    | Servidor de desarrollo con recarga automática           |
| `npm run start:debug`  | Servidor de desarrollo con modo debug                   |
| `npm run start:prod`   | Ejecuta la build de producción (`dotenv -e`)            |
| `npm run build`        | Compila la aplicación                                   |
| `npm run lint`         | ESLint con auto-corrección                              |
| `npm run format`       | Formatea el código                                      |
| `npm run test`         | Pruebas unitarias (Jest)                                |
| `npm run test:e2e`     | Pruebas end-to-end                                      |
| `npm run test:cov`     | Pruebas con cobertura                                   |
| `npm run seed`         | Dry-run de las dos organizaciones de prueba (`seed:apply` las crea) |
| `npm run migrate:dev`  | Ejecuta migraciones en desarrollo                       |
| `npm run migrate:prod` | Ejecuta migraciones en producción                       |
| `npm run studio`       | Abre Prisma Studio                                      |

### Frontend (`frontend/`)

| Script        | Descripción                     |
| ------------- | ------------------------------- |
| `npm run dev` | Servidor de desarrollo          |
| `npm run build` | Build de producción           |
| `npm run lint`  | ESLint                       |
| `npm run test`  | Pruebas (Vitest)             |

## Roles y permisos

El sistema distingue entre el rol global `SUPER_ADMIN` (administrador del sistema) y los roles por organización (`OrgRole`): `OWNER`, `ADMIN`, `MEMBER`, `CASHIER` e `INVENTORY_USER`. Los roles por organización tienen herencia de permisos: `OWNER` hereda los permisos de `ADMIN`, `MEMBER` y `CASHIER`; `ADMIN` hereda de `MEMBER` y `CASHIER`; `MEMBER` hereda de `CASHIER`. El acceso a rutas se controla tanto en el backend (guards y decoradores) como en el frontend (`DashboardLayout` y mapeo de rutas por rol).

## Arquitectura

Aplicación web compuesta por una API REST (NestJS + Prisma + PostgreSQL) y una SPA (Next.js App Router) que consume la API mediante un cliente Axios con inyección automática de JWT y redirección en respuestas `401`.

El backend es multi-tenant: cada organización aísla sus datos, con numeración propia de secuencias, roles por organización y límites según el plan contratado. La autenticación usa JWT con refresh tokens; el frontend almacena el token en `localStorage`. Todos los endpoints están prefijados con `/api` y los DTOs se validan con `class-validator` mediante un `ValidationPipe` global.
