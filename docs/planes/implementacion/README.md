# Planes de Implementación — Índice Maestro

Este directorio contiene los **super planes** de las mejoras mayores del sistema de gestión de inventario. Cada plan está pensado para ser ejecutable fase por fase, con dependencias de archivos claras, decisiones arquitectónicas justificadas, riesgos identificados y criterios de aceptación verificables.

**Plan 01 (Proveedores + Órdenes de Compra)** ya fue implementado y no aparece en este índice. Los planes 02 a 08 son los que quedan por construir.

---

## Orden de lectura recomendado

Leelos en este orden si es tu primera vez; cada uno asume contexto del anterior:

| # | Plan | Esfuerzo | Fases | Criticidad | Dependencias |
|---|------|---------:|------:|------------|--------------|
| 02 | [Notas de crédito y devoluciones](./plan-02-notas-credito-devoluciones.md) | 25–35 h | 4 | Alta — legal/fiscal | Ninguna |
| 03 | [Caja, arqueo y turnos](./plan-03-caja-arqueo-turnos.md) | 30–40 h | 5 | Alta — operativa diaria | Ninguna |
| 04 | [Facturación electrónica DIAN](./plan-04-facturacion-electronica-dian.md) | 120–150 h | 5 | Crítica — obligación legal | Plan 02 (notas crédito) |
| 05 | [Sucursales, bodegas y transferencias](./plan-05-sucursales-bodegas-transferencias.md) | 70–90 h | 6 | Alta — habilita escalamiento | Ninguna (migración destructiva) |
| 06 | [Lotes, vencimientos y alertas](./plan-06-lotes-vencimientos-alertas.md) | 50–65 h | 6 | Media-alta — sectorial | Plan 05 (locationId) |
| 07 | [RBAC granular + 2FA](./plan-07-rbac-granular-2fa.md) | 60–80 h | 6 | Alta — seguridad | Ninguna (migración enum→FK) |
| 08 | [PWA, móvil y offline](./plan-08-pwa-movil-y-offline.md) | 135–255 h | 7 | Media-alta — operación móvil | Fase 5 depende del Plan 03 |

**Esfuerzo total estimado: 490–715 horas** (≈ 12–18 semanas de un dev full-stack senior), incluyendo el Plan 08.

---

## Resúmenes ejecutivos

### 02 — Notas de crédito y devoluciones
**Problema:** no se pueden anular ni devolver ventas; las correcciones se hacen manual sobre la DB.
**Decisión clave:** modelo `CreditNote` independiente con ítems, motivo obligatorio, reintegro opcional a stock, afecta reportes de ventas netas.
**Cross-plan:** el Plan 04 (DIAN) usa `CreditNote` para emitir nota crédito electrónica.
**Riesgo crítico:** doble devolución sobre la misma venta — resuelto con `Sale.returnedAmount` y validación en servicio.

### 03 — Caja, arqueo y turnos
**Problema:** cualquier cajero puede vender en cualquier momento sin control de caja física.
**Decisión clave:** modelo `CashRegister` + `CashSession` + `CashMovement`; la creación de `Sale` exige `cashSessionId` activo del usuario.
**Integra:** nuevo `CashSessionGuard` valida sesión abierta antes de vender.
**Riesgo crítico:** pérdida de datos si cierre de sesión falla a mitad — resuelto con transacción y snapshot previo al cálculo de diferencia.

### 04 — Facturación electrónica DIAN
**Problema:** obligación legal de facturar electrónicamente ante la DIAN en Colombia.
**Decisión clave:** integración vía **proveedor tecnológico PSE** (Facture / HKA) con una abstracción `ElectronicInvoiceProvider`, NO integración directa con DIAN. Emisión asíncrona vía BullMQ.
**Cross-plan:** consume `CreditNote` del Plan 02 para emitir nota crédito electrónica; el `consecutive` se asigna dentro del worker con `SELECT FOR UPDATE` para evitar huecos.
**Riesgo crítico:** huecos o duplicados en el consecutivo — resuelto con bloqueo pesimista + idempotencia del job (`jobId = einvoiceId`).

### 05 — Sucursales, bodegas y transferencias
**Problema:** un único stock global impide operar más de una ubicación física.
**Decisión clave (Option B):** eliminar `Product.stock`, crear tabla `ProductStock(productId, locationId, quantity, minStock, version)` con PK compuesta. Migración en 3 pasos: crear tablas → backfill a ubicación `MAIN` → drop `Product.stock`.
**Cross-plan:** el Plan 06 (lotes) usa `locationId` en `Batch`; los POs del Plan 01 ganan `locationId`.
**Riesgo crítico:** datos perdidos en el backfill — resuelto con migración de 3 pasos y script `migrate-stock.ts` idempotente con verificación `sum(ProductStock) === Product.stock`.

### 06 — Lotes, vencimientos y alertas
**Problema:** no hay trazabilidad de lotes ni alertas automáticas; productos perecederos quedan invisibles hasta vencer.
**Decisión clave (Option C):** `Batch.quantity` es **fuente de verdad** para productos con `tracksBatches=true`; `ProductStock.quantity` se mantiene como **cache** dentro de la misma transacción (invariante: `sum(batches) === ProductStock.quantity`).
**FEFO:** función pura `FefoService.pick()` ordena `expiryDate ASC NULLS LAST, createdAt ASC`.
**Jobs:** 4 crons (`@nestjs/schedule`) — `expire-batches` (00:00), `expiry-warning` (06:00), `low-stock` (06:30), `stockout` (cada 30 min).
**Riesgo crítico:** desincronización entre `Batch` y `ProductStock` — resuelto con transacciones atómicas y test de invariante en CI.

### 07 — RBAC granular + 2FA + auth hardening
**Problema:** solo 3 roles hardcodeados en enum, sin permisos granulares ni 2FA; sesión infinita.
**Decisión clave (Option C):** JWT payload minimal `{ sub, email, roleId, tokenVersion }`, permisos cargados desde `CacheService` (TTL 5 min, key `permissions:{userId}`), cache invalidado al cambiar rol o permisos del rol.
**Migración enum→FK:** 3 pasos (crear tablas + seed 3 roles sistema → NOT NULL + FK → drop `Role` enum + `User.role`).
**Auth:** access token 15 min + refresh token 7 días con rotación (`replacedById` chain, SHA-256 hash en DB), `tokenVersion` para invalidación instantánea, lockout 5 intentos fallidos en 15 min.
**2FA:** `otplib` v12 TOTP + códigos de recuperación bcrypt, obligatorio para `ADMIN`.
**Riesgo crítico:** usuario quedó sin permisos tras migración — resuelto con seed que replica exactamente el comportamiento actual de los 3 roles.

### 08 — PWA, móvil y offline
**Problema:** la base PWA está construida y verificada (rama `feat/pwa-support`, 19 commits), pero nadie la instaló en un dispositivo, no hay capa offline de lectura ni de escritura, y no existe verificación PWA en CI.
**Decisión clave (Fase 0, bloqueante para estimar):** ¿"soporte iOS y Android" significa instalable desde el navegador, o publicado en tiendas? Apple no acepta PWAs en el App Store (solo envoltorio nativo, con la guideline 4.2 en contra); Android sí acepta una TWA, que es el camino barato.
**Cross-plan:** la Fase 5 (POS offline) depende del Plan 03 (turno por dispositivo) y la Fase 4 toca numeración fiscal del Plan 04 y la política de stock del Plan 05.
**Riesgo crítico:** vender sin conexión duplica ventas porque **no existe idempotencia en el backend** (`POST /sales` no acepta clave del cliente), y los precios offline chocan con el invariante de que el servidor es dueño de toda cifra que se convierte en plata. Resuelto con idempotencia end-to-end y una decisión de producto escrita antes de codear.
**Nota de arranque:** las Fases 1 y 2 son de 10–25 h cada una y conviene hacerlas ya; no reemplazan ni retrasan los planes 02–07.

---

## Dependencias entre planes

```
Plan 02 ──────────────> Plan 04 (CreditNote → e-invoice crédito)
                             ^
Plan 03 ─────────────────────┤ (CashSession opcional en Sale)
                             │
Plan 05 (locationId) ──> Plan 06 (Batch.locationId, transferencias con lotes)
                             │
Plan 07 (permissions) ───────┘ (reemplaza @Roles por @RequirePermissions en TODOS los endpoints nuevos)
```

**Orden sugerido de implementación** (minimiza rework):
1. **Plan 07** primero — todos los endpoints nuevos de 02/03/04/05/06 deben nacer con `@RequirePermissions`, no con `@Roles`. Hacerlo al revés fuerza una refactorización masiva.
2. **Plan 05** segundo — Plan 06 depende de `locationId` en `ProductStock`/`Batch`; implementar 06 primero obliga a una segunda migración.
3. **Plan 03** (caja) — independiente, se integra con `Sale` existente.
4. **Plan 02** (notas crédito) — independiente, prerequisito para Plan 04.
5. **Plan 06** (lotes) — requiere Plan 05 terminado.
6. **Plan 04** (DIAN) — al final; requiere Plan 02 + estabilidad de ventas; lanzamiento piloto en ambiente `HABILITACION` antes de `PRODUCCION`.

**Plan 08 entra al costado, no en la cola.** Sus Fases 1 y 2 (entrega probada y endurecimiento, 25–40 h) son independientes de los planes 02–07 y conviene hacerlas ya, porque son las que convierten la PWA en un artefacto verificado en vez de uno supuesto. La Fase 4 (decisiones de offline) debe sentarse **junto** al Plan 03 y al Plan 04: comparten el turno por dispositivo y la numeración fiscal. La Fase 5 (implementación de POS offline, 80–140 h) no se arranca sin la Fase 4 aprobada.

---

## Archivos legados en este directorio

- `plan-implementacion-mejoras.md` — análisis original de mejoras (superseded por los planes 02–07).
- `plan-multi-tenant-completo.md` — plan alternativo de multi-tenancy (no priorizado por ahora).
- `2026-04-19-correccion-bugs-proveedores-ordenes-compra.md` — parche puntual sobre Plan 01 ya implementado.

---

## Convenciones comunes a todos los planes

- **Prisma migrations** nunca destructivas en un solo paso. Si se borra una columna, siempre en 3 pasos (crear nuevo → backfill → drop viejo) con releases intermedios.
- **Optimistic concurrency** (`version` field) en todas las tablas con contención (stock, batch, refresh tokens).
- **Idempotencia** en todo job/worker (BullMQ `jobId`, verificación de estado previo).
- **Tests de invariantes** en CI (ej. `sum(batches) === ProductStock.quantity`, `sum(ProductStock) === Product.stock` durante migración).
- **Audit log** (ya existe `AuditLog`) para operaciones sensibles: emisión DIAN, cierre de caja, cambio de rol, reset de 2FA.
- **Feature flags** recomendados durante rollout de planes 04/05/07 (ambientes: `HABILITACION` DIAN, `multiLocationEnabled`, `requireTwoFactor`).
