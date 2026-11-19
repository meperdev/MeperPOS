# Arquitectura descubierta — MeperPOS (FASE 0)

Fuente: análisis estático del código en el worktree de auditoría (rama `audit/security`, base `fa79f06`). Todas las referencias son `archivo:línea` relativas a la raíz del repo. Este documento describe lo que **existe** en el código, no evaluaciones (ver `FINDINGS.md`).

## 1. Stack y despliegue

- **Backend**: NestJS 11 (Node), TypeScript, Prisma 6 ORM, PostgreSQL. Puerto 3001, prefix global `/api` (`backend/src/app-configuration.ts:43`). Escucha en `0.0.0.0`.
- **Frontend**: Next.js 16 App Router + React 19 + TailwindCSS 4, puerto 3000. Desplegado en Vercel (`frontend/vercel.json`; despliegues deshabilitados para ramas `audit/*`, `security/*`, `worktree-*`).
- **Infra declarada en el repo**: `backend/docker-compose.yml` (Postgres 15 + WAHA para WhatsApp). No hay config de Railway versionada en el repo.
- **Dependencias clave**: `helmet ^8.3.0` (CSP **desactivada** en `app-configuration.ts:38`), `@nestjs/throttler ^6.5.0`, `bcryptjs ^3.0.3` (costo 12, `security.constants.ts:9`), `@nestjs/jwt ^11.0.2`, `multer ^2.0.2`, `cloudinary ^2.9.0`, `exceljs ^4.4.0`, `saxes 5.0.1`.

## 2. Módulos backend (35 controladores)

`admin`, `alerts`, `auth`, `billing`, `business-modules` (admin + catálogo + público-org), `cash-registers`, `categories`, `cloudinary`, `customers`, `customer-vehicles`, `electronic-invoicing` (sin rutas), `expenses`, `expense-taxonomy`, `exports`, `imports`, `inventory-loans`, `loans`, `payroll` (employees + payroll), `plan-limits`, `products` (+ products-search), `purchase-orders`, `receipts`, `reports` (+ daily-report), `sales`, `seeding`, `settings`, `suppliers`, `tasks`, `users`, `whatsapp` (commercial, delivery, identity, intelligence, webhook).

### Patrón de protección por controlador

- **Sin ningún guard**: `app.controller.ts` (`/api`, `/api/health`), `whatsapp/whatsapp-webhook.controller.ts:69` (protegido solo por HMAC-SHA512 propio, `whatsapp/waha-signature.ts:5-33`).
- **JWT + Roles + OrgRequired** (la mayoría): products, sales, categories, customers, suppliers, expenses, tasks, alerts, cash-registers, purchase-orders, settings, exports, imports, loans, inventory-loans, expense-taxonomy, customer-vehicles.
- **JWT + Roles + OrgRequired + PlanLimitGuard**: users, products-create, customers-create.
- **OWNER/ADMIN estricto**: payroll (`payroll.controller.ts:71`), employees (`payroll/employees.controller.ts:49`), reports (`reports.controller.ts:19`).
- **SUPER_ADMIN**: admin.controller (`admin/admin.controller.ts:26-27`), whatsapp intelligence, business-modules admin.
- **JWT sin RolesGuard**: `business-modules.controller.ts:15`, `plan-limits.controller.ts:10`.
- **Rutas públicas de auth** (`auth.controller.ts`): login (:100), select-organization (:122), refresh (:217), logout (:247). **No existe** endpoint `/auth/register` (la exención CSRF para él queda muerta en `common/guards/cookie-csrf.guard.ts:22`).

No existe `JwtAuthGuard` global: la autenticación es por-ruta (`app.module.ts:88-92`). Guards globales: `ThrottlerGuard` (`:85`) y `CookieCsrfGuard` (`:98`), más `OrganizationStatusInterceptor` global (`:108`).

## 3. Flujo de autenticación

1. **Login** (`auth.controller.ts:100`, `auth.service.ts:66-78`): bcrypt compare; mensaje uniforme "Invalid credentials" (no enumeración de usuarios). Multi-org → JWT `pre-auth` de 5 min (`auth.service.ts:131-146`).
2. **Cookies** (`auth/cookies.helper.ts:60-88`): `access_token` httpOnly 30 min (`auth.constants.ts:12`); `refresh_token` httpOnly **cookie-only** 7 días, path `/api/auth`, **stripped de todo body** (`auth.controller.ts:82-92`); `csrf_token` legible por JS. Producción: `SameSite=None; Secure`; dev: `Lax`.
3. **JWT**: se lee **solo** de `Authorization: Bearer` (`jwt.strategy.ts:17`); la cookie `access_token` no se consume para auth. `RequestUser` se reconstruye **desde la fila de DB**, no desde claims (`jwt.strategy.ts:56-99`), e incluye `tokenVersion` (revocación por bump, `auth.service.ts:433-448`).
4. **Refresh** (`auth.service.ts:298-336`): token hasheado SHA-256 en tabla `RefreshToken`, **rotación + revocación** del anterior; ventana de gracia de reuso de 60 s que rellena desde la fila activa más nueva (`:265-292`). No hay detección de "familia" de tokens más allá de esa ventana.
5. **CSRF**: double-submit cookie con `timingSafeEqual` (`cookie-csrf.guard.ts:74-86`). Exenciones: 4 rutas de auth (`:20-25`), webhook WAHA (`:68-70`) y **todo request con header `Authorization: Bearer`** (`:57-62`).
6. **Contraseñas**: bcryptjs costo 12; política min 10 / max 128 + denylist (`common/validators/password.policy.ts:10-11`). No hay flujo de recuperación de contraseña.

## 4. Modelo de roles y origen del tenant

- `OrgRole = OWNER, ADMIN, MEMBER, CASHIER, INVENTORY_USER` (`schema.prisma:1233-1236`); `SUPER_ADMIN` es pseudo-rol no persistido (`User.isSuperAdmin`).
- `RolesGuard` hereda: OWNER ⊃ ADMIN ⊃ MEMBER ⊃ CASHIER; INVENTORY_USER no hereda nada (`common/guards/roles.guard.ts:36-38,66-84`).
- `organizationId` **solo proviene del payload del JWT** (`auth.service.ts:230-238`); los parámetros del controlador se ignoran. Única excepción: `AdminOrganizationInterceptor` sobrescribe `user.organizationId` desde header `x-organization-id` o query `?organizationId=` (`common/interceptors/admin-organization.interceptor.ts:9-13`).
- `OrganizationRequiredGuard` rechaza org indefinida, **pero bypass para SUPER_ADMIN** (`common/guards/organization-required.guard.ts:17-19`).

## 5. Aislamiento multi-tenant (patrones Prisma)

- 56 modelos; ~48 con `organizationId` (Product, Sale, SaleItem, Payment, FiscalDocument, CashRegister, Category, Customer, Task, Supplier, PurchaseOrder, Expense*, Loans, Payroll*, AuditLog, WhatsApp*, ProductStockAlert*...).
- **Sin `organizationId`**: `Organization` (raíz), `User` (`schema.prisma:368`), `RefreshToken` (nullable), `WhatsAppProcessedEvent/Message/Delivery`. Org-nullable: `WhatsAppConnection/Conversation/Identity`.
- Patrón dominante: `where: { id, organizationId }` en lectura y mutación. Casos verificados: products (`products.service.ts:476,594-618,686,724`), sales (`:828`), reports (`:794-799,807`).
- **Patrón débil detectado** (ver FINDINGS): fallback condicional `...(organizationId ? { organizationId } : {})` (`products.service.ts:332,450,789,835`; `sales.service.ts:511,598`; `reports.service.ts:922`) y writes post-check `where: { id }` a secas (`sales.service.ts:786-789,840-846`; `products.service.ts:1036-1038`; `users.service.ts:128,192,221`).
- Cascadas: `onDelete: Cascade` en la mayoría de filas tenant; payroll/loans usan `Restrict`.

## 6. Controles de seguridad existentes (inventario)

| Control | Estado | Ubicación |
|---|---|---|
| Rate limiting | Global 100/60 s; login 5, refresh 30, change-password 5. Redis si `REDIS_URL`, si no memoria local | `common/throttling/throttle-limits.ts:33-39`, `throttler-storage.factory.ts:56-73` |
| Helmet | Activado **sin CSP** | `app-configuration.ts:38` |
| ValidationPipe | `whitelist + forbidNonWhitelisted + transform` global | `app-configuration.ts:58-66` |
| Manejo de errores | `HttpExceptionFilter` colapsa errores desconocidos a `{code,message,requestId}`; no filtra stack | `http-exception.filter.ts:31-72` |
| CORS | Orígenes por `CORS_ORIGIN`, defaults localhost, `credentials: true` | `main.ts:24-38` |
| Swagger | Solo fuera de producción | `main.ts:37-39` |
| JWT secret | Validación fail-fast ≥32 chars en producción | `config/runtime-env.ts:19-34` |
| Trust proxy | 1 hop | `common/config/proxy-trust.ts:21` |
| Uploads | Products/expenses: 5 MB + regex de tipo; **settings logo sin límite ni validación de tipo**; imports: solo tamaño | `products.controller.ts:218-223`, `settings.controller.ts:66-72`, `imports.controller.ts:79-83` |
| SQL crudo | Solo tagged templates (`sequence.service.ts:17-26`); sin `$executeRaw` en src | — |
| Webhook WAHA | HMAC-SHA512, cap 256 KB, clave derivada por sesión | `whatsapp/waha-signature.ts:5-33` |
| Frontend tokens | Access token solo en memoria; refresh cookie-only; CSRF cookie→header | `frontend/src/lib/session.ts:12`, `api.ts:143-152,161-181` |
| CSP frontend | HSTS, X-Frame-Options DENY, referrer, permissions; `script-src` con `'unsafe-inline'` en producción | `frontend/next.config.ts:110-112,222-234` |
| Headers cache | `no-store` en 15 prefijos autenticados (omite `alerts`, `loans`, `employees`, `payroll`) | `frontend/next.config.ts:207-222,236-253` |
| CI | backend+frontend con Postgres de servicio; asserts de headers de seguridad; sin `secrets.*`, sin deploy | `.github/workflows/ci.yml:5-7,22-37,67-190` |

## 7. Límites de confianza

```
[Navegador]  access token en memoria + cookies httpOnly (SameSite=None en prod)
    │  Bearer header (auth) + x-csrf-token (mutaciones cookie)
    ▼
[Next.js / Vercel]  client-side; sin middleware.ts; protección de rutas solo display
    ▼
[NestJS / Railway]  JwtAuthGuard por-ruta → RolesGuard → OrganizationRequiredGuard
    │               → OrganizationStatusInterceptor → CookieCsrfGuard global
    ▼
[PostgreSQL]  Prisma; aislamiento por organizationId en cada where (patrón mayoritario)
```

Confianzas clave: (1) el JWT es la única fuente de `organizationId` (excepto interceptor SUPER_ADMIN); (2) `RequestUser` se relee de DB por request; (3) el cliente POS **recalcula** totales para display (`frontend/src/app/pos/page.tsx:804-811`) — el servidor deriva los números de dinero (`SalesService`), pendiente de verificación en FASE 4.

## 8. Matriz de riesgos (FASE 0 → fases de verificación)

| # | Riesgo (hipótesis priorizada) | Área | Severidad preliminar | Fase |
|---|---|---|---|---|
| SEC-001 | ADMIN crea usuarios con rol OWNER → escalamiento vertical | AuthZ | CRÍTICA | 1 |
| SEC-002 | Fallbacks Prisma sin scoping de tenant + writes post-check por id | Multi-tenant | ALTA | 2 |
| SEC-003 | Path traversal en borrado de imágenes + uploads sin validar | Archivos | ALTA | 3 |
| SEC-004 | Credenciales por defecto (seed super-admin + compose) y Postgres expuesto en todas las interfaces | Infra | ALTA (CRÍTICA si aplica a prod) | 6 |
| SEC-005 | Debilitamiento del refresh: CSRF-exento + SameSite=None + ventana de reuso 60 s | Sesiones | ALTA | 1 |
| SEC-006 | CSP inoperante (`unsafe-inline` prod; helmet sin CSP en API) | Frontend | MEDIA | 5 |
| SEC-007 | Login CSRF (ruta exenta) permite "session fixation" a cuenta del atacante | Sesiones | MEDIA | 1 |
| SEC-008 | Imports: upload sin validación de extensión/MIME (solo tamaño) | Archivos | MEDIA | 3 |
| SEC-009 | Sin límite de tamaño de body observable | API | MEDIA | 3 |
| SEC-010 | Throttler en memoria (sin Redis) → evadible multi-instancia | API | BAJA | 3 |
