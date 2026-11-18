# Hallazgos de seguridad — MeperPOS

Registro continuo de hallazgos con identificadores únicos. Severidades: CRÍTICA / ALTA / MEDIA / BAJA / INFORMATIVA. Estados: **confirmado** (evidencia reproducible verificada por análisis estático directo del código citado), **potencial** (evidencia estática fuerte, PoC dinámico pendiente), **no verificado**, **corregido**. Ningún hallazgo ha recibido PoC dinámico local todavía (FASE 0 es estática); los "confirmados" lo son a nivel de código leído directamente en esta auditoría.

Los valores de credenciales por defecto **no se reproducen** en este documento: se cita el archivo y línea donde el propio repositorio los contiene.

---

## SEC-001 — Escalamiento de privilegios: ADMIN crea usuarios OWNER y resetea contraseñas de cualquier usuario

**Severidad:** CRÍTICA
**Estado:** CORREGIDO (FASE 7, 2026-11-18; verificado dinámicamente post-fix: ADMIN→OWNER 403, reset de OWNER 403, control positivo CASHIER 201)

**Ubicación:** `backend/src/users/dto/create-user.dto.ts:25-29`; `backend/src/users/users.controller.ts:33-50`; `backend/src/users/users.service.ts:60-78`.

**Descripción:** `CreateUserDto.role` acepta **cualquier** valor de `OrgRole` (`@IsEnum(OrgRole)`, incluido `OWNER`). El endpoint `POST /api/users` está protegido con `@Roles(OrgRole.ADMIN)`, y `UsersService.create` persiste `role: role ?? OrgRole.CASHIER` sin ninguna restricción entre el rol del actor y el rol solicitado.

**Evidencia:** PoC dinámico completo (localhost, datos ficticios, registro en `PROGRESS.md`):
1. Login como ADMIN ficticio → `POST /api/users` con `"role": "OWNER"` → **HTTP 201**; DB: `audit.poc.escalated@...` quedó `role=OWNER`.
2. `POST /api/users/:id/reset-password` del ADMIN contra ese OWNER → **HTTP 201**; login con la contraseña inyectada → sesión `role: OWNER`.
3. Cadena estática: DTO sin restricción (`create-user.dto.ts:25-29`), controller `@Roles(OrgRole.ADMIN)` (`users.controller.ts:33-50`), service persiste `role ?? CASHIER` (`users.service.ts:71-72`) y `resetPassword` **sin ninguna restricción de rol sobre el objetivo** (`users.service.ts:210-229`, sin check de `isPrimaryOwner` ni de rol del target).

**Escenario de riesgo:** cualquier ADMIN de un tenant: (1) fabrica cuentas OWNER y les pone la contraseña; (2) **toma control de la cuenta OWNER real existente** (reset de contraseña sin restricción, con revocación de las sesiones de la víctima). Aunque hoy ninguna ruta es OWNER-only (el guard hereda OWNER ⊃ ADMIN, `roles.guard.ts:66-84`), el ADMIN ganza: cuenta auténtica del dueño secuestrada, `isPrimaryOwner` intocable por `remove` (`users.service.ts:269-272`), y auditoría que atribuye las acciones al dueño. Rutas futuras OWNER-only quedarían expuestas de entrada.

**Impacto:** toma de control de cualquier cuenta del tenant (incluido el OWNER real), suplantación con auditoría falseada al dueño, ruptura del modelo de mínimo privilegio. No es cross-tenant por sí mismo.

**Validación (no destructiva, FASE 1):** con datos ficticios — login como ADMIN en org de prueba, `POST /api/users` con `role: "OWNER"`, verificar en DB/GET que el usuario creado quedó OWNER y que puede llamar una ruta OWNER-only (p. ej. `GET /api/payroll/...`). Luego eliminar el usuario de prueba.

**Remediación (aplicada):** `users.service.create` rechaza `role: OWNER` salvo que el actor sea OWNER o SUPER_ADMIN (`ForbiddenException`); `users.service.resetPassword` rechaza el reset cuando el objetivo es OWNER y el actor no es OWNER/SUPER_ADMIN; el controller pasa el `RequestUser` actor a ambos. Tests de regresión: `users.privilege-escalation.int.spec.ts` (RED→GREEN observado).

**Regresión:** ✅ escrita y en verde: ADMIN crea OWNER → 403 sin persistir; ADMIN resetea password de OWNER → 403 con hash intacto; ADMIN crea CASHIER → 201. Suite: `npm run test -- --testPathPatterns=users.privilege-escalation`.

---

## SEC-002 — Fallbacks de aislamiento multi-tenant sin scoping (riesgo latente, no explotable hoy)

**Severidad:** MEDIA (bajada de ALTA tras verificación dinámica FASE 2)
**Estado:** verificado (FASE 2, 2026-11-18): **no explotable por usuarios de organización**; patrón confirmado y cross-tenant pero alcanzable solo por SUPER_ADMIN (modo plataforma documentado)

**Ubicación:** fallback `...(organizationId ? { organizationId } : {})` en `backend/src/products/products.service.ts:332,450,789,835`; `backend/src/sales/sales.service.ts:511,598`; `backend/src/reports/reports.service.ts:922`. Writes post-check `where: { id }` sin org: `sales.service.ts:786-789,840-846`; `products.service.ts:1036-1038`; `users.service.ts:128,192,221`.

**Descripción:** (a) Cuando `organizationId` llega indefinido, las consultas listan/leen **toda la tabla** sin filtro de tenant. La ruta normal lo impide con `OrganizationRequiredGuard`, pero ese guard hace bypass para SUPER_ADMIN (`organization-required.guard.ts:17-19`) y `AdminOrganizationInterceptor` sobrescribe la org desde header/query del cliente (`admin-organization.interceptor.ts:9-13`). (b) Varias mutaciones hacen "check-then-write": primero `findUnique({ where: { id, organizationId } })` y luego `update({ where: { id } })` **sin** org — una carrera entre check y write, o un path que omita el check, escribe cruzando tenants.

**Evidencia (FASE 2, estática + dinámica):**
- **Batería IDOR cruzada (2 orgs ficticias, ADMIN de org A contra objetos de org B):** 12/12 bloqueadas con 404 — GET/PUT/DELETE producto, GET/DELETE categoría, GET/PUT/DELETE cliente, GET/PATCH supplier, GET/PUT venta, y búsqueda por número (`findBySaleNumber` usa clave compuesta `organizationId_saleNumber`, `sales.service.ts:626-632`).
- **Relays (crear con ids ajenos):** venta con productId de B → 404; tarea asignada al userId de B → 404; PO con supplierId+productId de B → 404.
- **Suplantación por header:** `x-organization-id` ajeno ignorado para usuarios normales (respuesta = datos de la org propia).
- **Barrido estático completo:** el patrón `...(organizationId ? ...)` existe en products (`:332,450,789,835`), sales (`:511,598`), reports (14 sitios), exports (6), categories, customers, suppliers, purchase-orders, cash-registers, users — pero `OrganizationRequiredGuard` + `JwtStrategy` + `AdminOrganizationInterceptor` garantizan que org indefinida **solo** ocurre para SUPER_ADMIN; verificado dinámicamente: SUPER_ADMIN sin header lista productos de **todas** las orgs; con header lista solo la elegida.
- **Writes check-then-write (`where: { id }` post-check):** ~20 sitios (sales, products, users, customers, suppliers, categories, cash-registers, expenses, tasks, purchase-orders), todos precedidos de lectura org-scoped; TOCTOU no alcanzable vía API hoy. Mass assignment bloqueado por ValidationPipe global.

**Escenario de riesgo:** es una **mina latente**, no una brecha abierta: cualquier refactor futuro que relaje el guard, un endpoint nuevo sin `OrganizationRequiredGuard`, o un bug que deje la org indefinida convierte el fallback en lectura cross-tenant inmediata. El modo SUPER_ADMIN sin org expone datos de todas las empresas en un solo endpoint; combinado con SEC-004 (credencial por defecto del seed) el radio de daño es total.

**Impacto:** hoy: fuga cross-tenant solo con cuenta SUPER_ADMIN. Potencial: fuga/modificación masiva entre empresas si el control de entrada se debilita.

**Validación (FASE 2):** con dos orgs ficticias: (1) reproducir si algún endpoint alcanzable por un usuario normal llega al fallback con org indefinida; (2) para cada write post-check, probar condición de carrera con dos requests concurrentes sobre el mismo objeto en orgs distintas y verificar que el `update` no puede tocar la org contraria.

**Remediación (recomendada, pendiente de autorización):** reemplazar el fallback por un throw explícito cuando la org falte en rutas de usuario (fail-closed en vez de fail-open); mantener el modo plataforma solo como opción explícita (`?allOrganizations=true`) para SUPER_ADMIN; llevar `organizationId` al `where` de cada update/delete check-then-write.

**Regresión:** specs de integración con dos orgs: acceso cruzado por id (GET/PUT/DELETE) → 404 en todos; relay con id ajeno → 404; org indefinida en ruta de usuario → 403 (no listado global).

---

## SEC-003 — Path traversal en borrado de imágenes locales y uploads sin validar

**Severidad:** ALTA
**Estado:** potencial (código verificado; cadena completa pendiente de PoC FASE 3)

**Ubicación:** `backend/src/cloudinary/cloudinary.service.ts:118-125` (`deleteImage` con `path.join(this.localUploadPath, relativePath)` sobre `imageUrl` saneado solo con `replace('/uploads/', '')`); DTOs que aceptan `imageUrl` del cliente: `backend/src/products/dto/product.dto.ts:122,224`; `settings.controller.ts:66-72` (logo sin `ParseFilePipe`, sin límite ni validación de MIME); `imports.controller.ts:79-83` (solo `maxSize`).

**Descripción:** (a) `deleteImage` construye la ruta con `path.join` sobre el string recibido sin normalizar; un `imageUrl` tipo `/uploads/../../.env` escapa del directorio de uploads y `fs.unlinkSync` borra un archivo arbitrario dentro del proceso (Railway). El `imageUrl` puede llegar de un DTO cliente-controlable guardado en DB. (b) El upload de logo de settings no valida tamaño, extensión ni MIME; el fallback local guarda `uuid + path.extname(file.originalname)` (`cloudinary.service.ts:97-113`) — extensión controlada por el cliente.

**Evidencia:** verificado directamente: `path.join` sin normalización previa ni chequeo de prefijo; `settings.controller.ts:66-72` sin `ParseFilePipe`; `product.dto.ts:122,224` con `imageUrl?: string` sin restricción de formato.

**Escenario de riesgo:** ADMIN/OWNER (o quien pueda setear `imageUrl`) borra archivos del servidor de aplicación; upload sin validar permite escribir archivos con extensión elegida dentro del árbol servido o consumir memoria (sin límite en el logo).

**Impacto:** integridad del filesystem del backend (borrado arbitrario), DoS de disco/memoria, posible plantado de archivos con extensión peligrosa.

**Validación (FASE 3, no destructiva):** en entorno local con datos ficticios: setear `imageUrl = '/uploads/../../../tmp/marker.txt'` a un producto de prueba, llamar al path que dispara el borrado, verificar si `marker.txt` desaparece; revertir todo.

**Remediación:** resolver la ruta, calcular `path.resolve` y verificar que empieza con `path.resolve(localUploadPath)` antes de unlink; validar `imageUrl` con whitelist de formato; añadir `ParseFilePipe` con límite + MIME whitelist al logo de settings; validar extensión/MIME en imports.

**Regresión:** unit test de `deleteImage` con `../` → lanza BadRequest y no toca fs; integración de upload de logo rechaza >5 MB o MIME no imagen.

---

## SEC-004 — Credenciales por defecto hardcodeadas y Postgres expuesto en todas las interfaces

**Severidad:** ALTA (CRÍTICA si el seed corre en producción)
**Estado:** confirmado (estático; presencia en despliegue real no verificable desde el repo)

**Ubicación:** `backend/prisma/seed.ts:26-50` (super-admin con email y contraseña fijos, impresos en consola); `backend/docker-compose.yml:6-11` (credenciales literales de Postgres y `"5432:5432"` publicado en todas las interfaces).

**Descripción:** el seed crea un `SUPER_ADMIN` con credencial fija incluida en el propio repositorio. La misma credencial débil aparece como default del contenedor Postgres, que se publica en `0.0.0.0:5432` (no `127.0.0.1:5432`).

**Evidencia:** verificado directamente: `bcrypt.hash(<credencial fija>, 10)` + `console.log` con la credencial en claro; compose con `ports: "5432:5432"` y credenciales literales.

**Escenario de riesgo:** si `npm run seed` se ejecuta en producción (Railway o donde sea), existe una cuenta SUPER_ADMIN con credencial pública del repo → toma de control total multi-tenant. En red local, cualquier host alcanzable puede conectar a Postgres con las credenciales del repo.

**Impacto:** compromiso total del sistema (SUPER_ADMIN no persistido pero con bypass de guards) y de la base de datos.

**Validación (FASE 6):** confirmar con el dueño si el seed corre en producción (no accesible desde el repo); localmente, `db:up` y verificar exposición con `ss -tlnp` (5432 en 0.0.0.0).

**Remediación:** (1) el seed debe exigir la contraseña por env var y negarse a crear super-admin con valor por defecto; (2) `ports: "127.0.0.1:5432:5432"`; (3) rotar la credencial de Postgres y del super-admin si ya se sembró en algún entorno real.

**Regresión:** test de seed: sin `SUPER_ADMIN_PASSWORD` → aborta con error; verificación de que el compose bindea solo loopback.

---

## SEC-005 — El refresh token sobrevive al logout (ventana de gracia mintea sesión activa)

**Severidad:** ALTA
**Estado:** CORREGIDO (FASE 7, 2026-11-18; verificado dinámicamente post-fix: refresh sin CSRF → 403, con CSRF → 201, replay post-logout → 401, grace por rotación sigue viva)

**Ubicación:** `backend/src/common/guards/cookie-csrf.guard.ts:20-25` (refresh exento de CSRF); `backend/src/auth/cookies.helper.ts:37-41` (`SameSite=None; Secure` en producción); `backend/src/auth/auth.service.ts:265-292` (ventana de reuso de 60 s de refresh token revocado).

**Descripción:** `/api/auth/refresh` acepta el refresh cookie-only sin token CSRF; las cookies viajan con `SameSite=None` (se envían en cualquier contexto cross-site); y un refresh token recién rotado/revocado sigue siendo aceptado durante 60 s (grace window que "rellena desde la fila activa más nueva").

**Evidencia:** PoC dinámico (localhost, datos ficticios; secuencia completa y estado de la tabla `RefreshToken` registrados en `PROGRESS.md`):
1. `POST /api/auth/refresh` **sin `x-csrf-token`** → 201 con access token nuevo (exención CSRF verificada en runtime).
2. Replay del refresh token **ya rotado** (revocado por rotación) → 201 con access token nuevo: la ventana de gracia mintea fila activa.
3. **Logout con cookie de refresh presente → replay inmediato del mismo token → 201 con access token nuevo.** La tabla `RefreshToken` muestra la fila del token revocado por logout y una fila **activa** nueva minteada por el replay 60 ms después.
4. Estático: exención en `cookie-csrf.guard.ts:20-25`, cookies `SameSite=None; Secure` en producción (`cookies.helper.ts:37-41`), lógica de grace refill en `auth.service.ts:265-292`.

**Escenario de riesgo:** un atacante con una copia del refresh cookie (XSS puntual, proxy, malware) **mantiene sesión válida incluso después de que la víctima haga logout**, porque el replay dentro de los 60 s mintea un refresh token activo nuevo. El logout no lo expulsa; solo la revocación global (`tokenVersion` bump, `auth.service.ts:433-448`) lo haría, y el usuario común no la dispara.

**Impacto:** persistencia de atacante con sesión válida tras detección y logout de la víctima.

**Validación (FASE 1, local, datos ficticios):** **ejecutada con resultado positivo** — la cadena login → refresh (sin CSRF) → replay del token rotado → logout con cookie → replay del token revocado por logout emite access token válido en todos los pasos.

**Remediación (aplicada):** (1) columna `RefreshToken.revocationCause` (migración `20261118150000_refresh_revocation_cause`): la rotación marca `'rotated'`, el logout marca `'logout'`, las revocaciones globales `'revoke-all'`; la grace window del refill aplica **solo** a causa `'rotated'` — un token revocado por logout o revocación global nunca rellena sesión. (2) `POST /api/auth/refresh` exige el header `x-csrf-token` double-submit (quitado de la lista de exenciones; el frontend ya lo envía en todo POST). Tests de regresión: guard CSRF (403 sin header / 201 con header) y `auth.refresh.int.spec.ts` (replay post-logout → 401, refill por rotación sigue 201).

**Regresión:** ✅ escrita y en verde: cookie-only refresh → 403; refresh con cookie+header → 201; logout con cookie → replay → 401 y hash sin cambios; rotación competitiva (dos pestañas) sigue emitiendo par. Suites: `cookie-csrf.guard.spec.ts`, `auth.refresh.int.spec.ts`, `auth-body-exposure.int.spec.ts`.

---

## SEC-006 — CSP inoperante contra XSS

**Severidad:** MEDIA
**Estado:** confirmado (estático)

**Ubicación:** `frontend/next.config.ts:110-112` (`script-src 'self' 'unsafe-inline'` también en producción); `backend/src/app-configuration.ts:38` (helmet sin CSP en la API).

**Descripción:** la CSP de producción mantiene `'unsafe-inline'` en `script-src`, lo que elimina la protección principal contra XSS inyectado. El API no agrega CSP vía helmet (aceptable para JSON, pero no hay cabeceras complementarias en el backend).

**Evidencia:** constante `ENFORCED_SCRIPT_SRC` con `unsafe-inline` en ambas ramas.

**Impacto:** un XSS puntual (hoy no se encontraron sinks `dangerouslySetInnerHTML`) queda sin segunda capa de defensa.

**Remediación:** migrar a nonces/hashes (Next soporta nonces con middleware) y activar la política report-only ya existente (`CONTENT_SECURITY_POLICY_REPORT_ONLY`) para medir antes de forzar.

**Validación/Regresión:** header real en build de prod sin `unsafe-inline`; report-only sin errores.

---

## SEC-007 — Login CSRF (fijación de sesión a cuenta del atacante)

**Severidad:** MEDIA
**Estado:** CONFIRMADO (dinámico parcial, FASE 1: el servidor acepta login cross-origin sin token CSRF)

**Evidencia:** PoC dinámico: `POST /api/auth/login` con `Origin: https://evil.example`, sin ningún token CSRF → **HTTP 201** con sesión emitida. En producción las cookies viajan `SameSite=None` (`cookies.helper.ts:37-41`), así que un form cross-site autentica al navegador de la víctima en la cuenta del atacante (login CSRF clásico).

**Descripción:** `POST /api/auth/login` no exige CSRF (exención en `cookie-csrf.guard.ts:20-25`) y no valida el origen del POST; combinado con cookies `SameSite=None` en producción, un tercero puede fijar la sesión del navegador de la víctima a la cuenta del atacante.

**Escenario de riesgo:** la víctima queda autenticada como el atacante sin darse cuenta e introduce datos (clientes, notas, precios) en una sesión ajena que el atacante controla.

**Impacto:** confusión de usuario + posible exposición de datos que la víctima introduce creyendo estar en su cuenta.

**Remediación:** exigir `x-csrf-token` también en login (el flujo ya lee la cookie CSRF pre-login o puede recibirla en la misma respuesta de pre-auth), o bloquear cross-site con `SameSite=Lax` para las cookies pre-auth.

**Regresión:** login sin header CSRF cross-site → 403.

---

## SEC-008 — Uploads de imports sin validación de tipo (solo tamaño)

**Severidad:** MEDIA
**Estado:** confirmado (estático)

**Ubicación:** `backend/src/imports/imports.controller.ts:79-83,124-125` (solo `maxSize`); parsers `saxes`/`exceljs` consumen el buffer.

**Descripción:** el importador multi-hoja acepta cualquier extensión/MIME dentro del límite de tamaño y lo entrega al parser.

**Impacto:** superficie para parser exploits (XXE en XML via `saxes`, ZIP bombs en xlsx) y DoS de CPU/memoria del worker.

**Remediación:** whitelist estricta de extensión+MIME+magic bytes antes de parsear; límite de filas por hoja.

**Regresión:** upload de `.zip` renombrado a `.xlsx` → 400.

---

## SEC-009 — Sin límite observable de tamaño de body

**Severidad:** MEDIA
**Estado:** no verificado (no se encontró configuración de `bodyParser`/limit; confirmar en FASE 3 con prueba local)

**Ubicación:** `backend/src/main.ts` / `app-configuration.ts` — no se encontró `bodyParser limit` ni equivalente Nest.

**Descripción:** sin límite de body, requests JSON enormes consumen memoria antes del ValidationPipe. El throttler limita frecuencia, no tamaño.

**Remediación:** `NestFactory.create(AppModule, { bodyParser: true })` con `express.json({ limit: '1mb' })` o `app.useBodyParser('json', { limit })`.

**Regresión:** POST con body > límite → 413.

---

## SEC-010 — Throttler en memoria cuando no hay Redis

**Severidad:** BAJA
**Estado:** confirmado (estático, condición de despliegue)

**Ubicación:** `backend/src/common/throttling/throttler-storage.factory.ts:56-73`.

**Descripción:** sin `REDIS_URL`, el rate limit es por-instancia; múltiples réplicas en Railway anulan el límite efectivo (login 5/60 s incluido).

**Remediación:** requerir Redis en producción (fail-fast o advertencia de arranque) como ya se hace con `JWT_SECRET`.

**Regresión:** arranque en prod sin `REDIS_URL` → warning/error verificable.

---

## Observaciones informativas (sin ID de vulnerabilidad)

- `GET /api/auth/profile` etc. revelan `isSuperAdmin` y roles — es diseño, no fuga.
- Rutas `alerts`, `loans`, `employees`, `payroll` quedan fuera del `no-store` de `next.config.ts:207-222` (caché de navegador en páginas sensibles) — tratar en FASE 5.
- CSRF se evita para todo request `Bearer` (`cookie-csrf.guard.ts:57-62`): correcto para Bearer, pero conviene confirmar que ninguna mutación cookie-authenticated dependa de él.
- `RefreshToken` no tiene `organizationId` obligatorio y `User` es global: revisar en FASE 2 si algún listado expone usuarios de otras orgs.
- El POS recalcula totales en cliente (`frontend/src/app/pos/page.tsx:804-811`): según `AGENTS.md` el servidor es quien manda (`SalesService.create` recalcula y audita overrides); **verificar en FASE 4** que ningún total/descuento del body se acepta sin recálculo.
- **FASE 2:** `GET /api/sales/number/:n` devuelve **200 con body vacío** cuando la venta no existe (`sales.service.findBySaleNumber` retorna `null` y el controller lo serializa tal cual) — debería ser 404; inconsistencia de contrato, sin fuga.
- **FASE 2:** `users.controller.ts:104` pasa `'unknown'` como organizationId en un caso borde de SUPER_ADMIN sin org → `findUserOrThrow` responde 403 con mensaje confuso; bug funcional, no de seguridad.
- **FASE 2:** `plan-limits` sin org devuelve shape `null` en vez de error (controlador JWT-only, sin OrganizationRequiredGuard) — robustez, revisar en FASE 3.
- **FASE 2 (pendiente de verificación):** el barrido no cubrió a fondo: receipts, fiscal-document/electronic-invoicing, whatsapp delivery/connections/ingestion, business-modules, employee-shifts y el logo de settings — quedan como primera cola de FASE 2b/3.
