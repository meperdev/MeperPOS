# Progreso de la auditoría — MeperPOS

Última actualización: FASE 1 (parcial, autenticación/autorización) ejecutada sobre rama `audit/security`. Antes de FASE 1, FASE 0 completa.

## Estado por fase

| Fase | Estado |
|---|---|
| FASE 0 — Reconocimiento | ✅ completada (estática; sin PoC dinámicos) |
| FASE 1 — Autenticación y autorización | **en curso** — 3 PoC ejecutados (SEC-001, SEC-005, SEC-007), quedan: cambio de rol de usuarios existentes (`UpdateUserDto` no acepta rol → pendiente verificar rutas de cambio de rol), `x-organization-id` del interceptor SUPER_ADMIN, exenciones CSRF de `select-organization`, enumeración de usuarios en login |
| FASE 2 — Aislamiento multi-tenant | pendiente — arrancar por SEC-002 |
| FASE 3 — Backend y API | pendiente — SEC-003, SEC-008, SEC-009, carreras |
| FASE 4 — Integridad comercial | pendiente |
| FASE 5 — Frontend | pendiente — SEC-006, no-store |
| FASE 6 — Infra y dependencias | pendiente — SEC-004, Railway/Vercel reales |
| FASE 7 — Remediación | bloqueada hasta autorización explícita del dueño |

## FASE 1 — PoC ejecutados (2026-11-18, localhost, datos ficticios, no destructivos)

Entorno: Postgres del compose local + backend `npm run start:dev` con `JWT_SECRET` aleatorio generado por sesión; usuarios/org ficticios `audit.poc.*@audit-invalid.test` eliminados y verificados (0 filas) al finalizar. Registro completo en el historial de sesión; resumen:

1. **SEC-001 CONFIRMADO (cadena completa):** ADMIN ficticio → `POST /api/users {role:OWNER}` → 201, DB `role=OWNER`; luego `POST /api/users/:id/reset-password` contra ese OWNER → 201 → login con la contraseña inyectada → sesión `role: OWNER`. Impacto verificado: un ADMIN toma control de cualquier cuenta del tenant, incluida la del OWNER real. Matiz honesto: hoy ninguna ruta es OWNER-only (guard hereda OWNER ⊃ ADMIN); el daño real es el secuestro de cuenta + auditoría falseada + exposición futura.
2. **SEC-005 CONFIRMADO (más grave que la hipótesis):** refresh sin `x-csrf-token` → 201; replay de token rotado → 201; **logout con cookie presente → replay del mismo token → 201 con access token nuevo y fila `RefreshToken` ACTIVA minteada** (verificado en DB: fila del token revocado por logout + fila activa nueva 60 ms después). El logout no expulsa a quien tenga copia del refresh cookie.
3. **SEC-007 CONFIRMADO (dinámico parcial):** `POST /api/auth/login` con `Origin: https://evil.example` sin CSRF → 201. Login CSRF viable en producción (cookies `SameSite=None`).

Cobertura adicional de FASE 1 estática: `RolesGuard.getInheritedRoles` leído completo; `users.service.update/toggleActive/remove/resetPassword` leídos; `multi-sheet-import.service.canImportUsersSheet` leído.

## FASE 3 — Backend y API (principal completada, 2026-11-18)

- **SEC-003 (logo) CONFIRMADO:** `POST /api/settings/logo` aceptó un archivo `text/plain` (.txt) → 201, guardado como `/uploads/logos/<uuid>.txt`: sin validación de tipo, sin límite, extensión del cliente. Un ADMIN escribe archivos con extensión elegida en el servidor.
- **SEC-003 (traversal) NO alcanzable hoy (verificado con cadena limpia):** el flujo de producto desarma la URL vía `extractPublicId` antes de `deleteImage`; el único caller con URL cruda (`expenses.service.ts:786`) usa `receiptUrl` generado por el servidor y ningún DTO acepta `receiptUrl`. Queda como mina latente + el logo como puerta de plantado. (Nota de integridad: un PoC anterior reportó falsamente "confirmado" por un comando malformado; se re-verificó.)
- **SEC-009 CORREGIDO:** la hipótesis FASE 0 era incorrecta — sí hay límite de body (default Express); el defecto real es que `PayloadTooLargeError` sale como **500** en vez de **413** (contrato/observabilidad). Baja a BAJA.
- **SEC-008 VERIFICADO:** `.xlsx` falso (texto plano) → **422** limpio "The import file could not be processed": el parser falla cerrado; residual = superficie del parser sobre entrada hostil. Baja a BAJA.
- **SEC-010 VERIFICADO en runtime:** throttle de login operativo (429 tras el 4º login del minuto); persiste la limitación multi-instancia sin `REDIS_URL`.
- **Datos ficticios y archivos de PoC limpiados** (uploads/logos y uploads/products del PoC, marcadores, org y usuarios de prueba); servidor apagado.
- Pendiente de FASE 3b: SSRF (revisión de URLs salientes), manejo de errores en exports/receipts, cola FASE 2b (receipts, fiscal-document, whatsapp ingestion, business-modules, employee-shifts, settings logo ya cubierto).

## FASE 2 — Aislamiento multi-tenant (completada, 2026-11-18)

**Veredicto: el aislamiento aguanta.** Sin hallazgo cross-tenant explotable por usuarios de organización.

- **Dinámico (2 orgs ficticias A/B, localhost):** batería IDOR 12/12 en 404 (producto, categoría, cliente, supplier, venta — lectura, modificación y borrado por id ajeno); relays 3/3 bloqueados (venta con productId ajeno, tarea con userId ajeno, PO con supplier+productId ajenos → 404); `x-organization-id` ajeno ignorado para usuarios normales; `findBySaleNumber` scoping correcto por clave compuesta (aunque responde 200-null en vez de 404).
- **Estático (barrido delegado, 32 controladores):** patrón fallback `...(organizationId ? ...)` inventariado completo (~30 sitios en products/sales/reports/exports/categories/customers/suppliers/purchase-orders/cash-registers/users) — alcanzable con org indefinida **solo por SUPER_ADMIN** (guard + estrategia + interceptor verificados); modo plataforma global confirmado dinámicamente (SUPER_ADMIN sin header lista productos de todas las orgs; con header, solo la elegida). Writes check-then-write (~20 sitios) precedidos de lectura org-scoped; TOCTOU no alcanzable vía API. SQL crudo 100% parametrizado y org-constrained. Mass assignment bloqueado por ValidationPipe global.
- **SEC-002 recalificado:** ALTA → MEDIA, estado "verificado, no explotable por usuarios"; mina latente documentada con remediación recomendada (fail-closed + org en el where de los writes).
- **Datos ficticios limpiados** (0 filas en User/Org/Product/Sale de prueba), servidor apagado.

No cubierto aún (cola para FASE 2b/3): receipts, fiscal-document, whatsapp ingestion/delivery, business-modules, employee-shifts, settings logo.

## FASE 7 (parcial) — Remediación autorizada y ejecutada (2026-11-18)

El dueño autorizó («SI») la remediación mínima de SEC-001 y SEC-005. Ambos quedaron **corregidos y verificados dinámicamente** en el worktree (rama `audit/security`, sin push):

- **SEC-001:** guardrails en `users.service` (solo OWNER/SUPER_ADMIN mintea OWNER o resetea password de un OWNER), actor pasado desde el controller. Re-PoC: ADMIN→OWNER 403, reset de OWNER 403, control positivo CASHIER 201.
- **SEC-005:** `RefreshToken.revocationCause` (migración aditiva `20261118150000_refresh_revocation_cause`, aplicada sin reset gracias a SQL quirúrgico + `migrate resolve`) — la grace refill solo aplica a causa `'rotated'`; refresh exige CSRF. Re-PoC: cookie-only refresh 403, con header 201, replay post-logout 401, refill por rotación sigue vivo (caso legítimo de pestañas).
- Pruebas: 3 specs nuevos/extendidos en RED→GREEN observado; suites vecinas users/auth/csrf/body-exposure: 109-109/126-126 en verde; `npm run build` OK; eslint 0 errores en archivos tocados. Specs que pineaban el contrato viejo actualizados al nuevo (controller firma, causas de revocación, CSRF en refresh HTTP).
- Datos ficticios de re-verificación eliminados y verificados (0 filas); servidor de pruebas apagado.
- **Observación de infra detectada durante la migración (para FASE 6):** `prisma migrate dev` detectó que tres migraciones ya aplicadas (`20261009*`) fueron modificadas después de aplicadas — drift de checksum que en un despliegue real puede forzar un reset o fallar el deploy. No lo arreglé (fuera de alcance): tratar en FASE 6.

## Qué se investigó (FASE 0)

- **Backend (35 controladores)**: inventario de rutas y guards por controlador; flujo auth completo (login, cookies, JWT, refresh con rotación, logout, tokenVersion); modelo de roles y origen del tenant; patrón de aislamiento Prisma en products/sales/reports/users; config de seguridad (helmet, ValidationPipe, throttler, CSRF, manejo de errores, CORS, trust proxy, swagger); uploads (products, expenses, settings, imports); webhook WAHA; dependencias de `backend/package.json`.
- **Frontend**: manejo de tokens (`session.ts`, `api.ts`), localStorage, CSRF cookie→header, variables `NEXT_PUBLIC_*`, CSP y headers en `next.config.ts`, sinks XSS, protección de rutas (`DashboardLayout`), matemática de dinero en POS.
- **Infra/repo**: secretos commiteados (ninguno: `.env*` ignorado y solo `.env.example`), `docker-compose.yml` y variantes WAHA, CI (`.github/workflows/ci.yml`), 56 modelos de Prisma y su scoping/cascadas.

## Qué se encontró

10 hallazgos preliminares: SEC-001 (CRÍTICA), SEC-002 (ALTA), SEC-003 (ALTA), SEC-004 (ALTA), SEC-005 (ALTA), SEC-006 (MEDIA), SEC-007 (MEDIA), SEC-008 (MEDIA), SEC-009 (MEDIA, no verificado), SEC-010 (BAJA). **Tras FASE 1: SEC-001, SEC-005 y SEC-007 confirmados dinámicamente con PoC reproducible.** Detalle y formato completo en `FINDINGS.md`; matriz en `ARCHITECTURE.md` §8.

## Qué se verificó (spot-checks de primera mano)

Los siguientes puntos fueron leídos directamente en el código por el auditor principal, además del mapeo delegado: `create-user.dto.ts` + `users.controller.ts` + `users.service.create` (SEC-001); fallback `products.service.ts:332` (SEC-002); `cloudinary.service.deleteImage` (SEC-003); `seed.ts:26-50` y `docker-compose.yml:6-11` (SEC-004); `ENFORCED_SCRIPT_SRC` prod con `unsafe-inline` (SEC-006).

## Incertidumbres / no verificado

1. **Ningún PoC dinámico** se ha ejecutado aún: todos los estados son estáticos. Los "confirmados" lo son a nivel de código.
2. Entorno real de Railway/Vercel no inspeccionable desde el repo (SEC-004 en producción, `REDIS_URL`, `NODE_ENV`, `TRUST_PROXY_HOPS` reales) — requiere confirmación del dueño.
3. `npm audit` no ejecutado (fase 6, herramienta estándar de npm; se solicitará correrlo en FASE 6).
4. Cobertura de *tests* de seguridad existentes: hay `*.int.spec.ts` de auth/CSRF en el repo sin revisar en detalle (FASE 1 los aprovechará como baseline).
5. Módulos grandes no revisados en profundidad aún: `billing`, `electronic-invoicing`, `exports`, `receipts`, `purchase-orders` (estado PO), `backfill`, `provisioning`, `seeding` — solo inventariados.

## Próximas acciones recomendadas (orden)

1. **FASE 1 (resto):** exención CSRF de `select-organization` (otra mutación de sesión sin token); interceptor `x-organization-id` (¿qué puede hacer un SUPER_ADMIN sin CSRF?); enumeración/timing en login; revisión de `UpdateUserDto` (no acepta `role` — verificar si existe otra vía de cambio de rol para ADMIN, p. ej. admin.controller transfer-owner es SUPER_ADMIN-only).
2. **FASE 2:** reproducción del fallback sin scoping y de los writes post-check con dos orgs ficticias; barrido completo de `...(organizationId ? ...)` y `where: { id }` en todos los services.
3. **FASE 4** temprana en módulo `sales` (recálculo de totales, descuentos, override de precio ya documentado en AGENTS.md).

## ⚠️ Aviso al dueño (prioridad de remediación, requiere autorización para FASE 7)

SEC-001 y SEC-005 están confirmados con PoC y afectan la integridad de la autorización y de las sesiones. Si querés, priorizo la remediación mínima de ambos (lista blanca de roles en `users.service` + grace-window que no aplique a revocaciones por logout + CSRF en refresh) apenas autorices.

## Regla de continuidad

Al abrir una nueva sesión: leer `README.md` → `PROGRESS.md` → `FINDINGS.md` → verificar si el código citado en hallazgos pendientes cambió (comparar líneas) → continuar desde "Próximas acciones".

## FASE 4 — Integridad comercial (completada, 2026-11-18)

**Veredicto: el servidor manda en los números.** Batería dinámica (2 orgs ficticias + CASHIER/MEMBER de prueba, limpiado a 0 filas): descuento > subtotal → 400; pago insuficiente → 400; cantidad > stock → 409; carrera por la última unidad → sin sobreventa, stock 0 final; unitPrice negativo → 400; MEMBER override → 403; CASHIER override → 201 recalculado + audited; MEMBER force-close → 403; duplicado exacto → 2×201 (hallazgo).

**Hallazgos nuevos:** SEC-012 (P2034/P2002 sin mapear → 500 en conflictos de concurrencia legítimos), SEC-013 (RETURNED_PARTIAL sin restock/tx/movimiento — aparentemente intencional, requiere decisión), SEC-014 (sin idempotencia en POST /sales; loans sí la tiene), SEC-015 (descuento por ítem pre-impuesto vs global post-impuesto sin clamp; sobrepago no-efectivo sin reembolso), más el gap de receive de PO (qtyReceived sin guard, tx sin aislamiento — registrado dentro de SEC-012/013 como observación de auditoría de compras).

**Sanos:** totales/impuestos/cambio no seteables por cliente; CAS de stock completo; saleNumber con lock; override auditado; financiamiento con total congelado; pagos parciales bloqueados.

Pendiente: decisión del dueño sobre SEC-013/015 (semántica contable) y autorización para remediar SEC-012/014.
