# Plan — Multi-Tenant Completo (SaaS)

**Proyecto:** MeperPOS  
**Modelo:** Single Database, Multi-Tenant (`organizationId`)  
**Onboarding:** Manual por SuperAdmin  
**Acceso:** Selector post-login  
**Pago:** Transferencia manual con seguimiento en panel  
**Planes:** Básico $40.000 COP / Pro $55.000 COP — Trial 15 días  
**Estimación total:** ~6–8 semanas (30–40 días hábiles)  

---

## Changelog

- **v1.0** — Plan inicial con 8 fases.
- **v1.1** — Correcciones post-code review: unicidades globales, Settings singleton, raw SQL, Task/TaskEvent, seguridad DTO.
- **v1.2** — Auditoría exhaustiva del codebase: findUnique→findFirst, autoincrement global, exports/reports cross-tenant, cache keys, scripts de bootstrap.
- **v1.3** — Mejoras de Claude Opus 4.7: RLS (fase opcional), concurrencia de secuencias especificada, DIAN compliance separado, revocación JWT, políticas de downgrade/suspensión, login optimizado, índices redundantes, tests unitarios.

---

## Correcciones Post-Revisión (v1.1)

1. **Unicidades globales rompen multi-tenant**: `Category.name`, `Product.sku`, `Product.barcode`, `Customer.documentNumber`, `Sale.saleNumber`, `Supplier.documentNumber`, y `PurchaseOrder.orderNumber` tenían `@unique` o `@@unique` globales. Se corrigieron a `@@unique([organizationId, campo])`.

2. **`User.role` → `OrganizationUser.role` es un refactor transversal**: JWT, frontend AuthContext, y DashboardLayout dependen de rol global único.

3. **Settings es un singleton global sin `organizationId`**: Se unifica en `Organization.settings` (campo JSON).

4. **Raw SQL (`$queryRaw`) sin aislamiento**: `products.service.ts` y `reports.service.ts` usan `$queryRaw` sin filtrar por `organizationId`.

5. **`Task` y `TaskEvent` faltaban en el plan**: Ambos modelos no tenían `organizationId`.

6. **Checklist de seguridad tenía una trampa**: Proponía agregar `organizationId` al DTO. El `organizationId` DEBE salir del JWT/request context.

7. **Tablas hijas (`SaleItem`, `Payment`, `PurchaseOrderItem`)**: No necesitan `organizationId` propio. Excepción: `InventoryMovement` SÍ necesita `organizationId`.

## Hallazgos de Auditoría del Codebase (v1.2)

### A. Patrón sistémico: `findUnique({ where: { id } })` sin `organizationId`
**Fix:** Cambiar a `findFirst({ where: { id, organizationId } })` en TODOS los services.

### B. `findUnique` por campos que dejarán de ser @unique
Cuando `Product.sku` pase a `@@unique([organizationId, sku])`, los `findUnique` por `sku` **ROMPERÁN** en runtime.
**Fix:** Migrar a `findFirst({ where: { sku, organizationId } })`.

### C. Exports y Reports: fuga de datos TOTAL
`ExportsService` y `ReportsService` **NO FILTRAN POR `organizationId`**.
**Fix:** Inyectar `organizationId` en CADA método.

### D. Cache de reports sin prefijo de tenant
`cacheKey = 'dashboard:${startDate}:${endDate}'` → `cacheKey = 'dashboard:${organizationId}:${startDate}:${endDate}'`.

### E. `autoincrement()` global: problema legal
`Sale.saleNumber` y `PurchaseOrder.orderNumber` usan secuencia global de PostgreSQL. En Colombia la numeración debe ser consecutiva por emisor.
**Fix:** Tabla `OrganizationSequence` con bloqueo pesimista (`FOR UPDATE`).

### F. Frontend: ~10+ páginas usan `user?.role === 'ADMIN'`
**Fix:** Hook `useOrganizationRole()` y reemplazar TODAS las comparaciones.

### G. Users controller permite resetear contraseñas cross-tenant
**Fix:** Validar `OrganizationUser` antes de operar sobre otro usuario.

### H. Scripts de bootstrap y validación asumen datos globales
`phase2-bootstrap.sql` y `validate-phase2.mjs` insertan/validan sin `organizationId`.

## Mejoras Post-Análisis Claude Opus 4.7 (v1.3)

### Implementadas en este plan:
1. **OrganizationSequence con concurrencia especificada**: `SELECT ... FOR UPDATE` en transacción serializable.
2. **DIAN Compliance separado**: Numeración consecutiva + anulación sin borrar. Facturación electrónica = backlog.
3. **Revocación JWT**: JWT de 15 min + Refresh Token revocable.
4. **Downgrade policy**: Soft limit persistente (banner, no bloqueo).
5. **Transferencia de ownership**: No se puede eliminar `isPrimaryOwner` sin transferir.
6. **SUSPENDED policy**: Readonly por 5 años (cumple Estatuto Tributario colombiano).
7. **Login optimizado**: Si 1 org, JWT final directo. Si varias, selector.
8. **Índices redundantes quitados**: Si existe `@@index([organizationId, active])`, no se pone `@@index([organizationId])`.
9. **Cache invalidation**: Invalidar cache del tenant al mutar recursos.
10. **Seed de desarrollo**: SuperAdmin + 2 orgs demo (BASIC y PRO) con datos faker.
11. **Tests unitarios de aislamiento**: Un test por service verificando `organizationId` en `where`.

### Backlog (post-MVP / post-grado):
- **RLS de Postgres** (Fase 8 opcional): Defense in depth.
- **Flujo de invitación por email**: Admin crea usuarios directamente en MVP.
- **Habeas Data / dump completo**: Ley 1581 Colombia.
- **Logging con tenant context**: Pino childLogger con `orgId`.
- **ESLint custom rule para `$queryRaw`**: Regla de equipo manual en MVP.

---

## Principios Rectores

1. **Nunca dejamos la app rota**: cada fase debe deployarse sola y funcionar.
2. **Datos existentes = descartables**: no nos atamos con backfills complejos.
3. **Soft limits > Hard limits**: mejor UX, menos frustración, más conversiones.
4. **Seguridad por defecto**: si olvidamos el `organizationId`, la query NO debe devolver datos de otro tenant.
5. **El SuperAdmin NO es un dios omnisciente**: ve métricas agregadas, no entra a cuentas ajenas.
6. **OrganizationId nunca viene del cliente**: siempre del JWT o request context. Solo `/admin/*` puede recibirlo explícito.
7. **DIAN = contabilidad básica, no facturación electrónica**: numeración consecutiva + anulaciones sin borrar. CUFE/XML = backlog.

---

## Índice de Fases

| Fase | Nombre | Estimación | Estado |
|------|--------|------------|--------|
| **Fase 0** | Fundamentos del Tenant | 4–5 días | Pendiente |
| **Fase 1** | Aislamiento de Datos | 5–6 días | Pendiente |
| **Fase 2** | SuperAdmin & Onboarding | 5–6 días | Pendiente |
| **Fase 3** | Límites por Plan & Billing | 3–4 días | Pendiente |
| **Fase 4** | Personalización por Tenant | 2–3 días | Pendiente |
| **Fase 5** | Cloudinary & Assets | 1–2 días | Pendiente |
| **Fase 6** | Data Migration & Cleanup | 1–2 días | Pendiente |
| **Fase 7** | Testing, Hardening & Documentación | 4–5 días | Pendiente |
| **Fase 8** | Defense in Depth — RLS (Opcional) | 2–3 días | Backlog |

---

## Preparativos Antes de Iniciar Fase 0

**NO toques código hasta hacer esto:**

### 1. Crear rama Git
```bash
git checkout -b feat/multi-tenant
```

### 2. Backup de la base de datos (si hay datos importantes)
```bash
# En PostgreSQL
pg_dump -U admin -h localhost inventario_db > backup_pre_multitenant.sql
```

### 3. Verificar estado del repo
```bash
git status        # Asegurarse de no tener cambios sin commitear
git log --oneline -5  # Saber desde dónde partimos
```

### 4. Instalar dependencias necesarias
```bash
# En backend/
npm install        # Asegurar que todo compila
npx prisma generate  # Generar cliente Prisma actual

# En frontend/
npm install        # Asegurar que todo compila
```

### 5. Correr tests existentes (baseline)
```bash
# En backend/
npm run test       # Guardar output como baseline
npm run test:e2e   # Si existen
```

### 6. Crear checklist de progreso
Crear archivo `docs/planes/implementacion/progreso-multi-tenant.md` para trackear:
- [ ] Fase 0 completada
- [ ] Fase 1 completada
- ...

### 7. Notificar al equipo (si aplica)
Si hay otros desarrolladores: "A partir de hoy, nueva rama `feat/multi-tenant`. No mergear a main sin review."

---

## FASE 0 — Fundamentos del Tenant

**Objetivo:** Crear el modelo de `Organization`, refactorizar `User`, reestructurar autenticación con Refresh Tokens, y preparar el schema para DIAN compliance.

### 0.1 Schema Prisma — Nuevos modelos

```prisma
model Organization {
  id            String             @id @default(uuid())
  name          String
  slug          String             @unique
  logoUrl       String?
  status        OrgStatus          @default(TRIAL)
  plan          PlanType           @default(BASIC)
  trialEndsAt   DateTime?
  billingStatus BillingStatus      @default(PENDING)
  taxId         String?            // NIT del negocio (para futura facturación)
  settings      Json?              // { companyName, currency, taxRate, receiptPrefix, printHeader, printFooter, logoUrl }

  users              OrganizationUser[]
  products           Product[]
  categories         Category[]
  customers          Customer[]
  sales              Sale[]
  cashRegisters      CashRegister[]
  shifts             Shift[]
  inventoryMovements InventoryMovement[]
  suppliers          Supplier[]
  purchaseOrders     PurchaseOrder[]
  auditLogs          AuditLog[]
  tasks              Task[]
  taskEvents         TaskEvent[]
  sequences          OrganizationSequence?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([status])
  @@index([plan])
}

model OrganizationUser {
  id             String       @id @default(uuid())
  organizationId String
  userId         String
  role           OrgRole
  invitedById    String?
  isPrimaryOwner Boolean      @default(false)

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  createdAt DateTime @default(now())

  @@unique([organizationId, userId])
  @@index([organizationId, role])
}

model OrganizationSequence {
  id             String @id @default(uuid())
  organizationId String @unique
  organization   Organization @relation(fields: [organizationId], references: [id])
  saleNumber     Int    @default(0)
  orderNumber    Int    @default(0)

  @@index([organizationId])
}

model RefreshToken {
  id            String   @id @default(uuid())
  userId        String
  token         String   @unique
  organizationId String?  // null = login previo a selección de org
  expiresAt     DateTime
  revokedAt     DateTime?
  createdAt     DateTime @default(now())

  @@index([userId])
  @@index([token])
}

enum OrgStatus {
  TRIAL
  ACTIVE
  PAST_DUE      // Venció, en solo lectura
  SUSPENDED     // No paga, readonly por 5 años (Estatuto Tributario)
}

enum PlanType {
  BASIC
  PRO
}

enum BillingStatus {
  PENDING
  PAID
  OVERDUE
}

enum OrgRole {
  ADMIN
  CASHIER
  INVENTORY_USER
}

model User {
  id              String             @id @default(uuid())
  email           String             @unique
  password        String
  name            String
  isSuperAdmin    Boolean            @default(false)
  active          Boolean            @default(true)
  tokenVersion    Int                @default(0)  // Para revocación JWT
  organizations   OrganizationUser[]
  sales           Sale[]
  inventoryMovements InventoryMovement[]
  auditLogs       AuditLog[]
  tasksCreated    Task[]             @relation("TaskCreatedBy")
  tasksAssigned   Task[]             @relation("TaskAssignedTo")
  taskEvents      TaskEvent[]        @relation("TaskEventCreatedBy")
  purchaseOrders  PurchaseOrder[]
  refreshTokens   RefreshToken[]
  createdAt       DateTime           @default(now())
  updatedAt       DateTime           @updatedAt
}
```

### 0.2 Modificaciones a modelos existentes

**Regla de índices:** Si existe `@@index([organizationId, active])`, NO se pone `@@index([organizationId])` (redundante).

```prisma
model Category {
  id             String    @id @default(uuid())
  name           String
  description    String?
  defaultTaxRate Decimal?  @db.Decimal(5, 2)
  active         Boolean   @default(true)
  products       Product[]
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@unique([organizationId, name])
  @@index([organizationId, active])
}

model Product {
  id          String              @id @default(uuid())
  name        String
  sku         String
  barcode     String?
  description String?
  costPrice   Decimal             @db.Decimal(10, 2)
  salePrice   Decimal             @db.Decimal(10, 2)
  taxRate     Decimal             @default(0) @db.Decimal(5, 2)
  stock       Int                 @default(0)
  minStock    Int                 @default(0)
  imageUrl    String?
  categoryId  String
  category    Category            @relation(fields: [categoryId], references: [id], onDelete: Restrict)
  active      Boolean             @default(true)
  version     Int                 @default(0)
  movements   InventoryMovement[]
  saleItems   SaleItem[]
  preferredSupplierId String?
  preferredSupplier   Supplier?           @relation("PreferredSupplier", fields: [preferredSupplierId], references: [id])
  purchaseItems       PurchaseOrderItem[]
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt

  @@unique([organizationId, sku])
  // NOTA: barcode usa índice parcial en PostgreSQL (ver migración manual)
  // Prisma no soporta índices parciales nativamente
  // SQL: CREATE UNIQUE INDEX "product_barcode_unique" ON "Product" ("organizationId", "barcode") WHERE "barcode" IS NOT NULL;
  @@index([organizationId, barcode])
  @@index([organizationId, active])
}

model Customer {
  id             String          @id @default(uuid())
  name           String
  documentType   String
  documentNumber String
  email          String?
  phone          String?
  address        String?
  segment        CustomerSegment @default(OCCASIONAL)
  active         Boolean         @default(true)
  sales          Sale[]
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  @@unique([organizationId, documentNumber])
  @@index([organizationId, active])
}

model Sale {
  id                 String              @id @default(uuid())
  saleNumber         Int                 // Inmutable. Nunca cambia, nunca se reutiliza.
  customerId         String?
  customer           Customer?           @relation(fields: [customerId], references: [id])
  subtotal           Decimal             @db.Decimal(10, 2)
  taxAmount          Decimal             @db.Decimal(10, 2)
  discountAmount     Decimal             @default(0) @db.Decimal(10, 2)
  total              Decimal             @db.Decimal(10, 2)
  amountPaid         Decimal             @db.Decimal(10, 2)
  change             Decimal?            @db.Decimal(10, 2)
  status             SaleStatus          @default(COMPLETED)
  userId             String
  user               User                @relation(fields: [userId], references: [id])
  items              SaleItem[]
  payments           Payment[]
  inventoryMovements InventoryMovement[]
  organizationId     String
  organization       Organization        @relation(fields: [organizationId], references: [id])
  
  // Anulación (DIAN compliance)
  cancelledAt    DateTime?
  cancelledById  String?
  cancelReason   String?
  
  createdAt          DateTime            @default(now())
  updatedAt          DateTime            @updatedAt

  @@unique([organizationId, saleNumber])
  @@index([organizationId, createdAt, status])
}

enum SaleStatus {
  COMPLETED
  CANCELLED        // Anulada, número ocupado permanentemente (DIAN)
  RETURNED_PARTIAL
}

model Supplier {
  id             String   @id @default(uuid())
  name           String
  documentNumber String
  email          String?
  phone          String?
  address        String?
  contactName    String?
  active         Boolean  @default(true)
  purchaseOrders PurchaseOrder[]
  preferredBy    Product[]       @relation("PreferredSupplier")
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([organizationId, documentNumber])
  @@index([organizationId, active])
  @@index([organizationId, name])
}

model PurchaseOrder {
  id           String              @id @default(uuid())
  orderNumber  Int                 // Secuencia por org, no autoincrement global
  supplierId   String
  createdById  String
  status       PurchaseOrderStatus @default(DRAFT)
  subtotal     Decimal             @default(0) @db.Decimal(12, 2)
  taxAmount    Decimal             @default(0) @db.Decimal(12, 2)
  total        Decimal             @default(0) @db.Decimal(12, 2)
  notes        String?
  confirmedAt  DateTime?
  receivedAt   DateTime?
  cancelledAt  DateTime?
  cancelReason String?
  supplier     Supplier            @relation(fields: [supplierId], references: [id])
  createdBy    User                @relation(fields: [createdById], references: [id])
  items        PurchaseOrderItem[]
  organizationId String
  organization   Organization        @relation(fields: [organizationId], references: [id])
  createdAt    DateTime            @default(now())
  updatedAt    DateTime            @updatedAt

  @@unique([organizationId, orderNumber])
  @@index([organizationId, status])
  @@index([organizationId, createdAt])
}

model InventoryMovement {
  id             String       @id @default(uuid())
  productId      String
  product        Product      @relation(fields: [productId], references: [id])
  type           MovementType
  quantity       Int
  previousStock  Int
  newStock       Int
  reason         String
  userId         String
  user           User         @relation(fields: [userId], references: [id])
  saleId         String?
  sale           Sale?        @relation(fields: [saleId], references: [id])
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  createdAt      DateTime     @default(now())

  @@index([organizationId, productId, createdAt])
}

model Task {
  id             String      @id @default(uuid())
  title          String
  description    String?
  status         TaskStatus  @default(PENDING)
  createdById    String
  createdBy      User        @relation("TaskCreatedBy", fields: [createdById], references: [id])
  assignedToId   String?
  assignedTo     User?       @relation("TaskAssignedTo", fields: [assignedToId], references: [id], onDelete: SetNull)
  dueDate        DateTime?
  deletedAt      DateTime?
  events         TaskEvent[]
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt

  @@index([organizationId, status, createdAt])
  @@index([organizationId, assignedToId, status])
  @@index([organizationId, deletedAt])
}

model TaskEvent {
  id             String        @id @default(uuid())
  taskId         String
  task           Task          @relation(fields: [taskId], references: [id], onDelete: Cascade)
  type           TaskEventType
  fromStatus     TaskStatus?
  toStatus       TaskStatus
  note           String?
  createdById    String
  createdBy      User          @relation("TaskEventCreatedBy", fields: [createdById], references: [id])
  organizationId String
  organization   Organization  @relation(fields: [organizationId], references: [id])
  createdAt      DateTime      @default(now())

  @@index([organizationId, taskId, createdAt])
  @@index([organizationId, createdById, createdAt])
}

model AuditLog {
  id             String   @id @default(uuid())
  userId         String?
  user           User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  action         String
  resource       String
  resourceId     String?
  metadata       Json?
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  createdAt      DateTime @default(now())

  @@index([organizationId, createdAt])
  @@index([organizationId, resource])
}

// Settings deprecada — se migra a Organization.settings (Json)
// Se elimina en migración futura
```

### 0.3 Numeración consecutiva por tenant (DIAN Compliance)

**Problema:** PostgreSQL `autoincrement()` es global. La DIAN exige numeración consecutiva por emisor sin gaps.

**Solución:** Tabla `OrganizationSequence` + bloqueo pesimista.

```typescript
// sequence.service.ts
async getNextSaleNumber(tx: Prisma.TransactionClient, organizationId: string): Promise<number> {
  // Bloqueo pesimista con SELECT FOR UPDATE
  const seq = await tx.$queryRaw<OrganizationSequence>`
    SELECT * FROM "OrganizationSequence" 
    WHERE "organizationId" = ${organizationId}
    FOR UPDATE
  `;
  
  const nextNumber = seq.saleNumber + 1;
  
  await tx.organizationSequence.update({
    where: { organizationId },
    data: { saleNumber: nextNumber },
  });
  
  return nextNumber;
}
```

**Flujo de creación de venta:**
```typescript
async createSale(user, dto) {
  return prisma.$transaction(async (tx) => {
    // 1. Calcular número (bloqueo pesimista)
    const saleNumber = await this.sequenceService.getNextSaleNumber(tx, user.organizationId);
    
    // 2. Crear venta (si falla, rollback completo → número no queda quemado)
    const sale = await tx.sale.create({
      data: {
        ...dto,
        saleNumber,
        organizationId: user.organizationId,
        status: 'COMPLETED',
      },
    });
    
    return sale;
  }, { isolationLevel: 'Serializable' });
}
```

**Anulación de venta (DIAN):**
```typescript
async cancelSale(user, saleId, reason) {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({
      where: { id: saleId, organizationId: user.organizationId }
    });
    if (!sale) throw new NotFoundException();
    
    // NO se borra. Se marca como CANCELLED. El número permanece ocupado.
    return tx.sale.update({
      where: { id: saleId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledById: user.userId,
        cancelReason: reason,
      },
    });
  });
}
```

### 0.4 Revocación de JWT

**JWT de corta vida (15 min) + Refresh Token revocable.**

```typescript
// auth.service.ts
async login(loginDto) {
  const user = await validateUser(loginDto);
  
  // Access Token: 15 minutos
  const accessToken = this.jwtService.sign({
    sub: user.id,
    email: user.email,
    isSuperAdmin: user.isSuperAdmin,
    tokenVersion: user.tokenVersion,  // Para revocación
  }, { expiresIn: '15m' });
  
  // Refresh Token: 7 días, almacenado en BD
  const refreshToken = await this.prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  
  return { accessToken, refreshToken: refreshToken.token };
}

async refreshToken(token: string) {
  const rt = await this.prisma.refreshToken.findUnique({ where: { token } });
  if (!rt || rt.revokedAt || rt.expiresAt < new Date()) {
    throw new UnauthorizedException();
  }
  
  const user = await this.prisma.user.findUnique({ where: { id: rt.userId } });
  
  // Nuevo access token
  const accessToken = this.jwtService.sign({
    sub: user.id,
    email: user.email,
    isSuperAdmin: user.isSuperAdmin,
    tokenVersion: user.tokenVersion,
  }, { expiresIn: '15m' });
  
  return { accessToken };
}

// Revocar todos los tokens de un usuario (al suspender org o cambiar rol)
async revokeAllUserTokens(userId: string) {
  await this.prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
  await this.prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
```

### 0.5 Refactor de Autenticación

**JWT payload:**
```typescript
interface JwtPayload {
  sub: string;
  email: string;
  isSuperAdmin: boolean;
  tokenVersion: number;
  orgId?: string;
  orgRole?: string;
}
```

**Flujo de login optimizado:**
1. `POST /auth/login` → devuelve accessToken (15 min) + refreshToken.
2. `GET /auth/organizations` → lista de orgs del usuario.
   - Si 1 sola org: devuelve JWT con `orgId` y `orgRole` ya incluidos.
   - Si varias orgs: devuelve lista. Frontend muestra selector.
3. `POST /auth/select-organization` → emite nuevo JWT con `orgId` + `orgRole`.

### 0.6 Frontend — Auth + Organization Context

- `AuthContext`: usuario base (`id`, `email`, `name`, `isSuperAdmin`, `active`). **Sin `role`.**
- `OrganizationContext`: org activa (`orgId`, `name`, `role`, `logoUrl`, `settings`).
- `DashboardLayout` y `Sidebar`: leen `role` del `OrganizationContext`.
- Hook `useOrganizationRole()`: devuelve rol de la org activa.

### 0.7 Middleware de Tenant

`JwtStrategy` resuelve la organización y su estado en cada request
(`req.user.organizationId`, `req.user.orgStatus`).
`OrganizationStatusGuard` valida que `org.status` no sea `PAST_DUE` ni `SUSPENDED`
para mutaciones (GET/HEAD quedan permitidos). Se aplica con el interceptor global
`OrganizationStatusInterceptor`, que corre **después** de la autenticación de ruta:
un guard global vería `req.user` vacío porque la app no tiene `JwtAuthGuard` global.

### Archivos Fase 0

| Acción | Ruta |
|--------|------|
| [MODIFY] | `backend/prisma/schema.prisma` |
| [CREATE] | `backend/prisma/migrations/...` |
| [CREATE] | `backend/src/organizations/organizations.module.ts` |
| [CREATE] | `backend/src/organizations/organizations.service.ts` |
| [CREATE] | `backend/src/organizations/organizations.controller.ts` |
| [CREATE] | `backend/src/common/guards/tenant.guard.ts` |
| [CREATE] | `backend/src/common/sequences/sequence.service.ts` |
| [CREATE] | `backend/src/common/interfaces/authenticated-user.interface.ts` |
| [MODIFY] | `backend/src/auth/auth.service.ts` (JWT 15min + Refresh Token) |
| [MODIFY] | `backend/src/auth/auth.controller.ts` |
| [MODIFY] | `backend/src/auth/jwt.strategy.ts` (tokenVersion + orgId) |
| [MODIFY] | `backend/src/settings/settings.service.ts` (Organization.settings) |
| [CREATE] | `frontend/src/contexts/OrganizationContext.tsx` |
| [MODIFY] | `frontend/src/contexts/AuthContext.tsx` (quitar role) |
| [CREATE] | `frontend/src/hooks/useOrganizations.ts` |
| [CREATE] | `frontend/src/hooks/useOrganizationRole.ts` |
| [MODIFY] | `frontend/src/lib/api.ts` (enviar X-Organization-Id) |
| [MODIFY] | `frontend/src/app/layout.tsx` |
| [MODIFY] | `frontend/src/components/layout/DashboardLayout.tsx` |
| [MODIFY] | `frontend/src/components/layout/Sidebar.tsx` |

---

## FASE 1 — Aislamiento de Datos

### 1.1 Migración masiva

```bash
npx prisma migrate dev --name add_multi_tenant_organization_id
```

**Paso manual en la migración generada:**
Agregar al final del SQL de la migración:
```sql
-- Índice parcial para barcode nullable (PostgreSQL no permite múltiples NULLs en UNIQUE)
CREATE UNIQUE INDEX "product_barcode_unique" 
  ON "Product" ("organizationId", "barcode") 
  WHERE "barcode" IS NOT NULL;
```

### 1.2 `findUnique` → `findFirst`

**Regla de oro:**
- `findUnique({ where: { id } })` → `findFirst({ where: { id, organizationId } })`
- `findUnique({ where: { sku } })` → `findFirst({ where: { sku, organizationId } })`
- `findUnique({ where: { email } })` → se mantiene (User.email es global `@unique`)

**Services a modificar (todos):**
- `ProductsService`, `CategoriesService`, `SalesService`, `CustomersService`
- `InventoryMovementService`, `ReportsService`, `ExportsService`
- `AuthService`, `SuppliersService`, `PurchaseOrdersService`
- `CashRegistersService`, `ShiftsService`, `TasksService`, `UsersService`

### 1.3 Raw SQL auditado

Buscar TODOS los `$queryRaw` y asegurar `organizationId` en WHERE:
- `products.service.ts:270` (`getLowStockProducts`)
- `reports.service.ts:268` (dashboard count)

### 1.4 Exports y Reports

**Exports a corregir:**
- `getInventoryMovements`, `exportSales`, `exportProducts`, `exportCustomers`, `exportInventory`

**Reports a corregir:**
- `getDashboardKPIs`, `getSalesByPaymentMethod`, `getSalesByCategory`, `getTopSellingProducts`, `getCustomerStatistics`, `getUserPerformance`, `getDailySales`

**Cache:** `cacheKey = 'dashboard:${organizationId}:${startDate}:${endDate}'`

**Invalidación:** Al crear/modificar/eliminar recursos de una org, invalidar cache keys con ese `organizationId`.

### 1.5 Users controller — validar cross-tenant

```typescript
const targetOrgUser = await prisma.organizationUser.findFirst({
  where: { userId: targetUserId, organizationId: requesterOrgId }
});
if (!targetOrgUser) throw new NotFoundException();
```

### 1.6 Seed de desarrollo

```typescript
// seed.ts para DEV
async function main() {
  // 1. SuperAdmin
  const superAdmin = await prisma.user.create({...});
  
  // 2. Org demo BASIC
  const orgBasic = await prisma.organization.create({
    data: { name: 'Cafetería Demo', plan: 'BASIC', ... }
  });
  
  // 3. Org demo PRO
  const orgPro = await prisma.organization.create({
    data: { name: 'Supermercado Demo', plan: 'PRO', ... }
  });
  
  // 4. Datos faker en cada org (productos, categorías, ventas...)
  // Usar @faker-js/faker
}
```

### 1.7 Tests unitarios de aislamiento

Un test por service que verifique que `organizationId` está en el `where`:
```typescript
it('findAll filters by organizationId', async () => {
  const mockPrisma = { product: { findMany: jest.fn() } };
  const service = new ProductsService(mockPrisma as any);
  await service.findAll(mockUser);
  expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ organizationId: mockUser.organizationId })
    })
  );
});
```

### Archivos Fase 1

| Acción | Ruta |
|--------|------|
| [MODIFY] | `backend/src/*/*.service.ts` (findUnique → findFirst) |
| [MODIFY] | `backend/src/*/*.controller.ts` |
| [MODIFY] | `backend/src/products/products.service.ts` (raw SQL) |
| [MODIFY] | `backend/src/reports/reports.service.ts` (org filter + cache) |
| [MODIFY] | `backend/src/exports/exports.service.ts` (org filter) |
| [MODIFY] | `backend/src/users/users.controller.ts` (cross-tenant) |
| [MODIFY] | `backend/src/sales/sales.service.ts` (secuencia por tenant) |
| [MODIFY] | `backend/src/purchase-orders/purchase-orders.service.ts` (secuencia) |
| [CREATE] | `backend/prisma/migrations/...` |
| [CREATE] | `backend/test/e2e/tenant-isolation.e2e-spec.ts` |
| [CREATE] | `backend/test/unit/tenant-isolation.unit-spec.ts` |

---

## FASE 2 — SuperAdmin & Onboarding

### 2.1 Panel SuperAdmin

Endpoints (solo `isSuperAdmin`):
```
POST   /admin/organizations              → Crear org + admin
GET    /admin/organizations              → Listar orgs
GET    /admin/organizations/:id          → Detalle
PATCH  /admin/organizations/:id/status   → Cambiar status
PATCH  /admin/organizations/:id/plan     → Cambiar plan
GET    /admin/metrics                    → Dashboard
GET    /admin/billing/:orgId/history     → Historial pagos
POST   /admin/billing/:orgId/payment     → Registrar pago
```

### 2.2 Flujo de creación

```typescript
POST /admin/organizations
{
  "name": "Cafetería Juan",
  "plan": "BASIC",
  "admin": { "name": "Juan Pérez", "email": "juan@cafeteria.com" }
}

// Backend:
// 1. Crea Organization + OrganizationSequence
// 2. Genera password temporal
// 3. Crea User + OrganizationUser (ADMIN, isPrimaryOwner: true)
// 4. Crea CashRegister default
// 5. Retorna credenciales (password en texto plano UNA sola vez)
```

### 2.3 Reglas de negocio

- **No eliminar `isPrimaryOwner` sin transferir:** Si el primaryOwner se va, debe transferir a otro ADMIN primero.
- **No eliminar último ADMIN:** Una org debe tener al menos 1 ADMIN.
- **Email existente:** Si el email ya existe, asignar ese `User` a la nueva org (crear `OrganizationUser`).

### Archivos Fase 2

| Acción | Ruta |
|--------|------|
| [CREATE] | `backend/src/admin/admin.module.ts` |
| [CREATE] | `backend/src/admin/admin.controller.ts` |
| [CREATE] | `backend/src/admin/admin.service.ts` |
| [CREATE] | `backend/src/admin/dto/*.dto.ts` |
| [CREATE] | `frontend/src/app/admin/page.tsx` |
| [CREATE] | `frontend/src/app/admin/organizations/page.tsx` |
| [CREATE] | `frontend/src/app/admin/organizations/[id]/page.tsx` |
| [CREATE] | `frontend/src/components/admin/*.tsx` |
| [CREATE] | `frontend/src/hooks/useAdmin.ts` |

---

## FASE 3 — Límites por Plan & Billing

### 3.1 Límites por plan

```typescript
const PLAN_LIMITS = {
  BASIC: { maxCashRegisters: 1, maxUsers: 3, maxProducts: 500, hasAdvancedReports: false, hasForceClose: false },
  PRO:   { maxCashRegisters: 3, maxUsers: 10, maxProducts: 5000, hasAdvancedReports: true, hasForceClose: true },
};
```

### 3.2 Soft limits

Al CREAR: si se supera el límite, devuelve `warning: 'PLAN_LIMIT_REACHED'` con HTTP 200 (no error).

**Downgrade policy:** Si una org baja de PRO a BASIC y tiene 3000 productos:
- No se bloquea nada existente
- Se muestra banner persistente: "Tenés 3000 productos pero tu plan permite 500. Pasate al Pro o contacta soporte."
- No se pueden crear MÁS productos hasta bajar de 500 o subir de plan

### 3.3 Trial y SUSPENDED

- **Trial:** 15 días. Si expira → `PAST_DUE` (solo lectura).
- **PAST_DUE:** Si pasa 15 días → `SUSPENDED`.

> **Estado actual:** las transiciones automáticas están deshabilitadas por diseño
> (`BillingScheduler` es un no-op). Una organización nueva nace con `trialEndsAt`
> a 15 días y el SuperAdmin aplica `PAST_DUE`/`SUSPENDED` manualmente; la
> automatización queda como unidad pendiente.
- **SUSPENDED:** Readonly por 5 años (Estatuto Tributario colombiano). Después de 5 años, se puede purgar.
- **Revocación JWT:** Al suspender, `revokeAllUserTokens()` para todos los usuarios de la org.

### 3.4 Endpoints de Billing (implementados)

**Endpoints de organización (requieren JWT con org seleccionada):**
```
GET  /billing/status    → Estado de billing de la org activa
GET  /billing/payments  → Historial de pagos de la org activa
```

**Endpoints de administración (requieren SUPER_ADMIN):**
```
POST /billing/payments  → Registrar un pago manual (reactiva org si está PAST_DUE)
```

> **Nota de implementación:** Los endpoints de pago quedaron bajo el prefijo `/billing/payments` en lugar del prefijo `/payment-records` originalmente especificado.

### Archivos Fase 3

| Acción | Ruta |
|--------|------|
| [CREATE] | `backend/src/common/constants/plan-limits.ts` |
| [CREATE] | `backend/src/common/guards/plan-limit.guard.ts` |
| [CREATE] | `backend/src/billing/billing.module.ts` |
| [CREATE] | `backend/src/billing/billing.service.ts` |
| [MODIFY] | `backend/prisma/schema.prisma` (PaymentRecord) |
| [CREATE] | `frontend/src/components/ui/PlanLimitBanner.tsx` |
| [CREATE] | `frontend/src/app/settings/billing/page.tsx` |
| [CREATE] | `frontend/src/hooks/useBilling.ts` |

---

## FASE 4 — Personalización por Tenant

- Logo del negocio: `Organization.logoUrl` → Cloudinary `/organizations/{orgId}/logo.png`
- Impuestos: `Organization.settings.taxRate` global + `Category.defaultTaxRate` override

### Archivos Fase 4

| Acción | Ruta |
|--------|------|
| [MODIFY] | `backend/src/settings/settings.service.ts` |
| [MODIFY] | `backend/src/categories/categories.service.ts` |
| [MODIFY] | `frontend/src/app/settings/page.tsx` |
| [MODIFY] | `frontend/src/components/categories/CategoryForm.tsx` |
| [MODIFY] | `frontend/src/components/layout/Sidebar.tsx` |

---

## FASE 5 — Cloudinary & Assets

```
/organizations/
  {orgId}/
    products/
    users/
    logo/
```

### Archivos Fase 5

| Acción | Ruta |
|--------|------|
| [MODIFY] | `backend/src/cloudinary/cloudinary.service.ts` |
| [MODIFY] | `backend/src/products/products.service.ts` |
| [MODIFY] | `backend/src/auth/users.service.ts` |

---

## FASE 6 — Data Migration & Cleanup

### 6.1 Reset completo

1. Borrar base de datos.
2. Correr migraciones limpias.
3. Seed (DEV): SuperAdmin + 2 orgs demo con faker.
4. Seed (PROD): Solo SuperAdmin.

### 6.2 Scripts legacy

- Actualizar o eliminar `phase2-bootstrap.sql` y `validate-phase2.mjs`.

### Archivos Fase 6

| Acción | Ruta |
|--------|------|
| [MODIFY] | `backend/prisma/seed.ts` |
| [MODIFY] | `backend/scripts/phase2-bootstrap.sql` |
| [MODIFY] | `backend/scripts/validate-phase2.mjs` |

---

## FASE 7 — Testing, Hardening & Documentación

### 7.1 Tests E2E

```typescript
describe('Multi-tenant isolation', () => {
  it('userA cannot read products of orgB', async () => {
    const res = await request(app)
      .get(`/products/${productB.id}`)
      .set('Authorization', `Bearer ${jwtA}`);
    expect(res.status).toBe(404);
  });
});
```

### 7.2 Tests unitarios de aislamiento

Un test por service: verifica que `organizationId` está en el `where`.

### 7.3 Tests de seguridad — DTO

```typescript
it('ignores organizationId sent by client', async () => {
  const res = await request(app)
    .post('/products')
    .set('Authorization', `Bearer ${jwtOrgA}`)
    .send({ name: 'Hacked', organizationId: orgB.id });
  
  const product = await prisma.product.findUnique({ where: { id: res.body.id } });
  expect(product.organizationId).toBe(orgA.id);
});
```

### 7.4 Documentación

- `docs/architecture/MULTI_TENANT.md`
- `docs/runbooks/crear-tenant-manual.md`
- `docs/security/CHECKLIST_NUEVO_RECURSO.md`

### 7.5 Checklist de seguridad

1. [ ] Agregar `organizationId` al modelo
2. [ ] Agregar relación `organization`
3. [ ] Agregar índice compuesto (NO redundante)
4. [ ] **NUNCA** agregar `organizationId` al DTO del cliente
5. [ ] Extraer `organizationId` del JWT/contexto
6. [ ] Filtrar por `organizationId` en `findAll()`
7. [ ] Validar en `findOne()` con `findFirst({ where: { id, organizationId } })`
8. [ ] Crear con `organizationId` del contexto
9. [ ] Raw SQL SIEMPRE con `organizationId`
10. [ ] Migrar `findUnique` a `findFirst` si el campo dejó de ser `@unique`
11. [ ] Probar aislamiento cross-tenant

### Archivos Fase 7

| Acción | Ruta |
|--------|------|
| [CREATE] | `backend/test/e2e/tenant-isolation.e2e-spec.ts` |
| [CREATE] | `backend/test/e2e/plan-limits.e2e-spec.ts` |
| [CREATE] | `backend/test/e2e/trial-management.e2e-spec.ts` |
| [CREATE] | `backend/test/e2e/dto-security.e2e-spec.ts` |
| [CREATE] | `backend/test/unit/tenant-isolation.unit-spec.ts` |
| [CREATE] | `docs/architecture/MULTI_TENANT.md` |
| [CREATE] | `docs/runbooks/crear-tenant-manual.md` |
| [CREATE] | `docs/security/CHECKLIST_NUEVO_RECURSO.md` |

---

## FASE 8 — Defense in Depth: RLS (Opcional / Backlog)

**NO es necesario para MVP.** Se implementa post-grado.

```sql
-- Ejemplo de política RLS
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_tenant_isolation ON "Product"
  USING ("organizationId" = current_setting('app.current_org_id')::text);
```

En Prisma: middleware que ejecuta `SET app.current_org_id = '...'` antes de cada query.

---

## Riesgos y Mitigaciones

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Olvidar `organizationId` en endpoint | **CRÍTICO** | Checklist PR + tests E2E + tests unitarios |
| `findUnique` por ID sin org | **CRÍTICO** | Migrar a `findFirst({ where: { id, organizationId } })` |
| Exports/Reports sin filtro | **CRÍTICO** | Auditar línea por línea |
| Raw SQL sin `organizationId` | **CRÍTICO** | Regla de equipo: PR rechazado |
| Cliente envía `organizationId` en body | **CRÍTICO** | Test E2E específico |
| `autoincrement()` global | Alto (legal) | `OrganizationSequence` + `FOR UPDATE` |
| JWT no revocable | Alto | Token de 15min + Refresh Token revocable |
| Downgrade sin política | Medio | Soft limit persistente con banner |
| Cache cross-tenant | Alto | Prefijar con `organizationId` + invalidación |
| Scripts legacy | Medio | Actualizar o eliminar |

---

## Resumen de Archivos

- **Nuevos archivos backend:** ~35
- **Nuevos archivos frontend:** ~22
- **Archivos modificados:** ~50+ (services, controllers, schema, seed, contexts, scripts)
- **Tests nuevos:** 5 suites (4 E2E + 1 unit)
- **Documentación:** 3 archivos

**Total: ~30–40 días hábiles (~6–8 semanas)**

---

*Documento generado el 2026-04-21.*  
*Última actualización: v1.3 — Mejoras de Claude Opus 4.7 implementadas: RLS (fase 8 opcional), concurrencia de secuencias con FOR UPDATE, DIAN compliance separado, revocación JWT con Refresh Tokens, políticas de downgrade/suspensión, login optimizado, índices redundantes quitados, cache invalidation, seed con orgs demo, tests unitarios de aislamiento.*

## Apéndice A — Archivos auditados

**Backend:** `schema.prisma`, `auth.service.ts`, `jwt.strategy.ts`, `auth.controller.ts`, `roles.guard.ts`, `jwt-auth.guard.ts`, `products.service.ts`, `products.controller.ts`, `sales.service.ts`, `sales.controller.ts`, `customers.service.ts`, `customers.controller.ts`, `categories.service.ts`, `categories.controller.ts`, `suppliers.service.ts`, `suppliers.controller.ts`, `purchase-orders.service.ts`, `purchase-orders.controller.ts`, `settings.service.ts`, `settings.controller.ts`, `exports.service.ts`, `reports.service.ts`, `users.service.ts`, `users.controller.ts`, `tasks.service.ts`, `tasks.controller.ts`, `cloudinary.service.ts`, `main.ts`, `app.controller.ts`, `seed.ts`, `phase2-bootstrap.sql`, `validate-phase2.mjs`

**Frontend:** `api.ts`, `AuthContext.tsx`, `DashboardLayout.tsx`, `Sidebar.tsx`, `users/page.tsx`, `sales/page.tsx`, `purchase-orders/page.tsx`, `purchase-orders/[id]/page.tsx`, `suppliers/page.tsx`, `customers/page.tsx`, `inventory/page.tsx`, `profile/page.tsx`, `reports/page.tsx`, `settings/page.tsx`
