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
