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

## SEC-003 — Borrado de imágenes con `path.join` inseguro; logo de settings sin validar

**Severidad:** MEDIA (bajada de ALTA tras verificación dinámica FASE 3)
**Estado:** parcialmente confirmado — logo de settings **confirmado (PoC dinámico)**; path traversal **potencial, no alcanzable hoy** (defense-in-depth)

**Ubicación:** `backend/src/cloudinary/cloudinary.service.ts:118-131` (`deleteImage`: `path.join(this.localUploadPath, relativePath)` sobre `imageUrl.replace('/uploads/','')`, sin normalizar ni chequear prefijo); `backend/src/settings/settings.controller.ts:66-76` (logo sin `ParseFilePipe`); `backend/src/cloudinary/cloudinary.service.ts:97-113` (extensión del archivo tomada de `path.extname(file.originalname)` — controlada por el cliente); DTOs con `imageUrl?: string` sin restricción de formato: `products/dto/product.dto.ts:122,224`. Imports: solo `maxSize` (`imports.controller.ts:79-83`).

**Descripción:** (a) `deleteImage` construye la ruta con `path.join` sobre el string recibido sin normalizar; un `imageUrl` tipo `/uploads/../../.env` escapa del directorio de uploads y `fs.unlinkSync` borra un archivo arbitrario dentro del proceso (Railway). El `imageUrl` puede llegar de un DTO cliente-controlable guardado en DB. (b) El upload de logo de settings no valida tamaño, extensión ni MIME; el fallback local guarda `uuid + path.extname(file.originalname)` (`cloudinary.service.ts:97-113`) — extensión controlada por el cliente.

**Evidencia (FASE 3, dinámica):**
- **Logo confirmado:** `POST /api/settings/logo` con un archivo `text/plain` (.txt) → **201**, guardado como `/uploads/logos/<uuid>.txt`. Sin validación de tipo, sin límite de tamaño, extensión derivada del nombre del archivo del cliente. Un ADMIN puede escribir archivos con extensión y contenido elegidos dentro del árbol de almacenamiento del servidor.
- **Traversal no alcanzable hoy (verificado):** la cadena del producto pasa por `extractPublicId` (`products.service.ts:1027-1030`), cuyo output (`carpeta/archivo`) no contiene `/uploads/` → cae en la rama Cloudinary; el único caller con URL cruda es `expenses.service.ts:786` (`existing.receiptUrl`), y **ningún DTO acepta `receiptUrl`** (verificado) → el valor en DB solo puede provenir de uploads del servidor. El `imageUrl` del DTO de producto sí llega a DB, pero el flujo de borrado lo desarma antes de `deleteImage`. Nota honesta: un intento anterior de PoC reportó "confirmado" por un comando mal formado; se re-verificó con cadena limpia y el marcador **no** se borró.

**Escenario de riesgo:** el logo permite hoy a un ADMIN escribir archivos con extensión controlada en el servidor (superficie de plantado + consumo de disco sin límite). El traversal queda como mina latente: cualquier caller futuro que pase una URL cruda con `/uploads/` controlable por cliente (o un DTO que acepte `receiptUrl`) lo activa de inmediato.

**Impacto:** integridad del filesystem del backend (borrado arbitrario), DoS de disco/memoria, posible plantado de archivos con extensión peligrosa.

**Validación (FASE 3, no destructiva):** en entorno local con datos ficticios: setear `imageUrl = '/uploads/../../../tmp/marker.txt'` a un producto de prueba, llamar al path que dispara el borrado, verificar si `marker.txt` desaparece; revertir todo.

**Remediación (logo ya es prioritario):** (1) `ParseFilePipe` con límite + whitelist MIME/regex en `settings.controller.ts:66-76`; (2) en `deleteImage`, resolver con `path.resolve` y exigir que el resultado empiece con `path.resolve(localUploadPath)` antes de unlink; (3) validar formato de `imageUrl`/`receiptUrl` en DTOs (URL http(s) o ruta `/uploads/...` sin `..`).

**Regresión:** unit test de `deleteImage` con `../` → lanza BadRequest y no toca fs; integración de upload de logo rechaza >5 MB o MIME no imagen.

---

## SEC-004 — Credenciales por defecto hardcodeadas y Postgres expuesto en todas las interfaces

**Severidad:** ALTA (CRÍTICA si el seed corre en producción)
**Estado:** CORREGIDO en el código (FASE 7: seed fail-closed + loopback). **Acción de despliegue pendiente del dueño:** si el seed ya corrió en algún entorno real, la credencial por defecto publicada debe rotarse ahí.

**Ubicación:** `backend/prisma/seed.ts:26-50` (super-admin con email y contraseña fijos, impresos en consola); `backend/docker-compose.yml:6-11` (credenciales literales de Postgres y `"5432:5432"` publicado en todas las interfaces).

**Descripción:** el seed crea un `SUPER_ADMIN` con credencial fija incluida en el propio repositorio. La misma credencial débil aparece como default del contenedor Postgres, que se publica en `0.0.0.0:5432` (no `127.0.0.1:5432`).

**Evidencia:** verificado directamente: `bcrypt.hash(<credencial fija>, 10)` + `console.log` con la credencial en claro; compose con `ports: "5432:5432"` y credenciales literales.

**Escenario de riesgo:** si `npm run seed` se ejecuta en producción (Railway o donde sea), existe una cuenta SUPER_ADMIN con credencial pública del repo → toma de control total multi-tenant. En red local, cualquier host alcanzable puede conectar a Postgres con las credenciales del repo.

**Impacto:** compromiso total del sistema (SUPER_ADMIN no persistido pero con bypass de guards) y de la base de datos.

**Validación (FASE 6):** confirmar con el dueño si el seed corre en producción (no accesible desde el repo); localmente, `db:up` y verificar exposición con `ss -tlnp` (5432 en 0.0.0.0).

**Remediación (aplicada):** (1) `prisma/seed.ts` resuelve la credencial vía `src/config/super-admin-credentials.ts`: sin `SUPER_ADMIN_PASSWORD` sana (≥10, denylist) **salta** la cuenta (fail-closed) y nunca imprime la contraseña; specs cubren los caminos (ausente/vacía/corta/histórica). (2) `docker-compose.yml` bindea Postgres a `127.0.0.1` solamente. (3) `AGENTS.md` documenta la variable.

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
**Estado:** CORREGIDO (FASE 7: Origin allowlist; re-PoC dinámico: Origin ajeno → 403, Origin permitido → 201)

**Evidencia:** PoC dinámico: `POST /api/auth/login` con `Origin: https://evil.example`, sin ningún token CSRF → **HTTP 201** con sesión emitida. En producción las cookies viajan `SameSite=None` (`cookies.helper.ts:37-41`), así que un form cross-site autentica al navegador de la víctima en la cuenta del atacante (login CSRF clásico).

**Descripción:** `POST /api/auth/login` no exige CSRF (exención en `cookie-csrf.guard.ts:20-25`) y no valida el origen del POST; combinado con cookies `SameSite=None` en producción, un tercero puede fijar la sesión del navegador de la víctima a la cuenta del atacante.

**Escenario de riesgo:** la víctima queda autenticada como el atacante sin darse cuenta e introduce datos (clientes, notas, precios) en una sesión ajena que el atacante controla.

**Impacto:** confusión de usuario + posible exposición de datos que la víctima introduce creyendo estar en su cuenta.

**Remediación (aplicada):** `login`/`register` ya no están exentos a ciegas: el guard exige `Origin` ausente (cliente nativo, no vector CSRF) o `Origin` dentro del allowlist compartido con CORS (`src/config/allowed-origins.ts`, única fuente de verdad usada también por `main.ts`). Sin cambio de frontend: el navegador legítimo siempre manda un Origin permitido.

**Regresión:** login sin header CSRF cross-site → 403.

---

## SEC-008 — Imports sin whitelist de tipo (solo tamaño)

**Severidad:** BAJA (bajada de MEDIA tras PoC FASE 3: el parser falla cerrado)
**Estado:** confirmado (estático) + verificado dinámicamente que el parser rechaza limpiamente

**Ubicación:** `backend/src/imports/imports.controller.ts:79-83,124-125` (solo `maxSize`); parsers `exceljs`/`saxes`.

**Descripción:** el importador multi-hoja acepta cualquier extensión/MIME dentro del límite de tamaño y lo entrega al parser.

**Evidencia:** PoC dinámico: `.xlsx` que en realidad era texto plano → **422** `{"The import file could not be processed"}` — manejo de error correcto, sin crash ni fuga. El residual es la superficie del parser sobre entrada hostil (zip-bomb xlsx, XML hostil vía `saxes`) y consumo de CPU/memoria del worker, no un crash reproducible.

**Remediación:** whitelist estricta de extensión+MIME+magic bytes antes de parsear; límite de filas por hoja.

**Regresión:** upload de `.zip` renombrado a `.xlsx` → 400.

---

## SEC-009 — Límite de body implícito; `PayloadTooLargeError` se reporta como 500

**Severidad:** BAJA (corregido: sí existe límite)
**Estado:** verificado dinámicamente (FASE 3)

**Ubicación:** límite implícito de `body-parser` (default); `common/filters/http-exception.filter.ts` no mapea `PayloadTooLargeError` a 413.

**Descripción (corregida):** la hipótesis FASE 0 "sin límite observable" era incorrecta: Express aplica su límite por defecto y un body de ~12MB fue rechazado por `raw-body`. El defecto real es de contrato/observabilidad: el rechazo sale como **HTTP 500** (`Unexpected failure`) en lugar de **413**, lo que rompe clientes y ensucia alertas.

**Evidencia:** log del servidor: `PayloadTooLargeError: request entity too large` en `raw-body` → respuesta final `HTTP 500` con código `INTERNAL_SERVER_ERROR`.

**Remediación:** mapear `PayloadTooLargeError` a 413 en el `HttpExceptionFilter`; opcionalmente fijar un límite explícito de JSON acorde al producto (p. ej. 1MB) en `NestFactory.create`.

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

---

## SEC-011 — Next.js 16.4.2 afectado por vulnerabilidad conocida (declarado por su propio build)

**Severidad:** BAJA (advisories moderados identificados; **exposición no aplicable** en MeperPOS)
**Estado:** confirmado y evaluado (FASE 6): GHSA-mfr8-8qww-v76h y GHSA-vc7v-qv4w-wrv8 — fuga de caché entre valores de root params en funciones `'use cache'`/`unstable_cache()` (next 16.2.0-16.4.4, fix en 16.4.6). Verificado: el frontend **no usa** `'use cache'` ni `unstable_cache` en ningún archivo → sin camino de explotación. Upgrade recomendado como higiene (npm audit fix --force instala next@16.4.6).

**Ubicación:** `frontend/package.json` (next 16.4.2).

**Descripción:** durante la remediación de SEC-006, `npm run build` se detuvo con el mecanismo oficial de upgrade de Next: la versión instalada está afectada por una vulnerabilidad conocida y exige reintento manual. El advisory/CVE específico y la versión corregida quedan para FASE 6 (`npm audit next`).

**Remediación:** identificar el advisory exacto, evaluar la exposición real según el CVE y planear el upgrade de `next` como trabajo propio (separado de la auditoría).

---

## SEC-012 — Conflictos de concurrencia del create de ventas reportados como 500

**Severidad:** MEDIA
**Estado:** CORREGIDO (FASE 7, re-PoC: carrera 3-ventas por la última unidad -> 1x201 + 2x409, cero 500)

**Ubicación:** `backend/src/sales/sales.service.ts:483-491` (solo mapea `P2028`); transacción Serializable `:474-479`.

**Descripción:** dos ventas concurrentes por la última unidad: la integridad aguanta (CAS + Serializable, sin sobreventa, stock nunca negativo — verificado dinámicamente), pero el perdedor recibe **500** por `PrismaClientKnownRequestError 40001/P2034` sin mapear, en lugar de un 409 limpio o reintento. Lo mismo aplica a `P2002` de la secuencia `saleNumber` (única por org, `schema.prisma:624`).

**Escenario de riesgo:** en horas pico el POS muestra "Error interno" en ventas perfectamente válidas; el cajero reintenta y duplica (ver SEC-014).

**Impacto:** confiabilidad del punto de venta; sin pérdida de integridad de datos.

**Remediación:** mapear `P2034`/`P2002` a `ConflictException` con retry acotado (1 reintentó) en el create de ventas.

**Regresión:** test de concurrencia: N requests simultáneos por la última unidad → exactamente 1×201 y (N-1)×409, jamás 500.

---

## SEC-013 — `RETURNED_PARTIAL` es un flip de estado pelado (sin restock ni transacción)

**Severidad:** MEDIA
**Estado:** CORREGIDO (FASE 7, decisión del dueño: deshabilitado; PUT /:id responde 400; rama muerta eliminada; re-PoC 400)

**Ubicación:** `backend/src/sales/sales.service.ts:784-787`.

**Descripción:** marcar una devolución parcial solo hace `sale.update({status})` — sin transacción, sin claim atómico del estado (a diferencia de CANCEL `:705-717`), sin `InventoryMovement`, sin reposición de stock, sin auditoría de línea. Una devolución parcial queda registrada en el estado de la venta pero el inventario ignora los ítems devueltos.

**Escenario de riesgo:** divergencia sistemática entre ventas/inventario: la mercancía devuelta sigue "vendida" para el stock y el reporte de inventario valorizado queda distorsionado.

**Impacto:** integridad contable de inventario; no es explotable de forma remota.

**Remediación (requiere decisión de producto):** si la devolución parcial debe reponer stock, replicar el flujo de CANCEL (claim atómico + restock con guard de versión + `InventoryMovement`); si no, deshabilitar el estado hasta implementarlo.

**Regresión:** devolución parcial → stock del ítem devuelto se incrementa exactamente en la cantidad devuelta y existe el `InventoryMovement` correspondiente.

---

## SEC-014 — `POST /api/sales` sin idempotencia (duplicado exacto = doble venta + doble descuento de stock)

**Severidad:** MEDIA
**Estado:** CORREGIDO (FASE 7: requestKey opcional + Sale.requestKeyHash único por org; re-PoC: replay devuelve la venta original, 1 sola fila)

**Ubicación:** `backend/src/sales/sales.service.ts:145-172`.

**Descripción:** ninguna clave de idempotencia en el create; contraste: el financiamiento sí la tiene (`loans.service.ts:648-661`, replay key + sha256). Un doble click, retry de red o el escenario SEC-012 generan dos ventas completas con números distintos y doble decremento de stock.

**Impacto:** doble cobro al cliente y descuadre de inventario.

**Remediación:** aceptar un `requestKey` opcional con unique por org+usuario+ventana (como el módulo de loans) y devolver la venta original en replay.

**Regresión:** misma carga con el mismo `requestKey` → una sola venta (segunda respuesta = misma saleNumber).

---

## SEC-015 — Semántica de descuentos inconsistente + sobrepago no-efectivo sin reembolso

**Severidad:** BAJA
**Estado:** CORREGIDO la parte autorizada (FASE 7, decisión del dueño: pre-IVA + clamp; re-PoC: 10000+19%−1000 → IVA 1710, total 10710). Sobrepago no-efectivo sigue documentado como decisión contable pendiente.

**Ubicación:** descuento por ítem pre-impuesto y clamped (`sale-pricing.ts:90-102`); descuento de venta **post-impuesto y sin clamp superior** (`sales.service.ts:225-228`); sobrepago `:236-245`.

**Descripción:** el mismo peso de descuento tributa distinto según se aplique por ítem o por venta (base gravable distinta), y el descuento global puede comerse el impuesto sin límite superior; en orgs con facturación electrónica activada esto falla cerrado por reconciliación (`:414-430`), pero el resto no. Además, un sobrepago con CARD/TRANSFER se persiste (`amountPaid > total`, `change=null`) sin camino de reembolso.

**Impacto:** inconsistencia de IVA y caja en reportes; requiere decisión contable del dueño, no es explotable.

**Remediación (decisión de producto):** unificar base de descuento (recomendado: pre-impuesto) y clamp `discountAmount <= subtotal`; registrar reembolso/ajuste para sobrepagos no-efectivos.

---

## Controles verificados sanos (FASE 4, para el registro)

- Totales/impuestos/cambio: **no** seteables por el cliente (DTO sin campos + `forbidNonWhitelisted`); recalculados por línea con `resolveEffectiveTaxRate`.
- Stock: CAS completo (versión + `stock >= reservedStock + qty`) en transacción Serializable; sin camino a stock negativo; CANCEL repone con guard.
- `saleNumber`: `FOR UPDATE` + recuperación por máximo + unique por org.
- Override de precio: roles ADMIN/OWNER/CASHIER/SUPER_ADMIN, tolerancia 0.01, auditado dentro de la transacción (`SALE_PRICE_OVERRIDE` verificado en DB); MEMBER → 403.
- Financiamiento: total congelado al iniciar; la compleción no acepta total del cliente.
- Pagos parciales: bloqueados; `change` computado solo para CASH.
- BFLA: CASHIER no puede cambiar estado (`PUT /:id` es ADMIN); MEMBER no puede `force-close` (403 dinámico).

---

## SEC-004 — Apéndice: guía de verificación para el dueño (decisión "no sé cómo verificarlo")

Pasos exactos para confirmar si el seed corrió alguna vez en un entorno real, SIN exponer credenciales:

1. **Railway → servicio de Postgres → pestaña "Data" (o abrir la consola `psql` desde el panel)** y ejecutar:
   ```sql
   SELECT email, "isSuperAdmin", "createdAt" FROM "User" WHERE email = 'admin@sistema.com';
   ```
2. **Si devuelve 0 filas:** el seed no creó el super-admin ahí → no hay nada que rotar; cerrá la acción pendiente en `PROGRESS.md`.
3. **Si devuelve 1 fila:** ese entorno tiene la credencial por defecto del repo activa. Rotación (en orden):
   a. `UPDATE "User" SET "tokenVersion" = "tokenVersion" + 1 WHERE email = 'admin@sistema.com';` (mata todas sus sesiones — el `JWT_SECRET` distinto del local ya invalida los tokens locales, pero por las dudas).
   b. O mejor: `DELETE FROM "User" WHERE email = 'admin@sistema.com';` y recrear el super-admin real por el mecanismo nuevo (`SUPER_ADMIN_PASSWORD` fuerte y única).
   c. Rotar también `DATABASE_URL` de Railway si comparte la credencial del compose.
4. **Repetir en cada entorno no-dev que exista** (staging incluido).

Ninguno de estos pasos imprime secretos; el SQL se ejecuta desde el panel de Railway con tu sesión de dueño.

---

## SEC-016 — Rutas sensibles sin `Cache-Control: no-store`

**Severidad:** MEDIA
**Estado:** confirmado (estático FASE 5)

**Ubicación:** `frontend/next.config.ts` — `AUTHENTICATED_ROUTE_PREFIXES` omite `alerts`, `employees`, `loans`, `payroll`, que sí existen como rutas autenticadas en `frontend/src/app/`.

**Descripción:** el mecanismo de `no-store` (que correctamente cubre admin, pos, sales, reports, etc.) no cubre cuatro rutas con datos sensibles: `payroll` y `employees` (datos personales y salarios), `loans` (datos financieros de clientes), `alerts` (feed operativo del negocio). El HTML renderizado de esas páginas puede quedar en la caché del navegador compartido o de un proxy/CDN.

**Escenario de riesgo:** en un equipo/ordenador compartido o un proxy corporativo, la nómina queda recuperable de caché tras cerrar sesión.

**Remediación (pendiente de autorización, cambio de 4 líneas):** agregar `alerts`, `employees`, `loans`, `payroll` a `AUTHENTICATED_ROUTE_PREFIXES`.

**Regresión:** `curl -I` de las cuatro rutas en build de producción devuelve `Cache-Control: no-store`.

**Nota positiva FASE 5:** el service worker (`frontend/public/sw.js`) es explícitamente shell-only ("Cache Storage never sees a product, customer or money value", documentado y cubierto por `src/lib/pwa.test.ts`) — sin riesgo de fuga por SW. Tokens en memoria, sin sinks XSS y una sola variable pública ya estaban verificados desde FASE 0.

---

## SEC-017 — Dependencias con vulnerabilidades conocidas (npm audit, frontend + backend)

**Severidad:** MEDIA
**Estado:** confirmado (FASE 6, `npm audit`)

**Resumen:** frontend: 23 vulnerabilidades (12 moderadas, 11 altas) — destacan `axios` 1.x con **alto**: bypass de NO_PROXY con SSRF (GHSA-3p68-rc4w-qgx5), gadgets de prototype pollution en `validateStatus`/`parseReviver`, `zod` alto (agotamiento de memoria en colecciones sobredimensionadas), más vitest/vite/launch-editor (mayormente toolchain de dev). Backend (deps de producción): 24 (6 moderadas, 18 altas) — `uuid` vía `exceljs` (bounds check) y otras; `exceljs` requiere downgrade para el fix automático.

**Escenario de riesgo:** axios se usa en el frontend (SSRF local del navegador del usuario); `uuid`/exceljs en parsing del backend. Ninguna explotación confirmada en el flujo de MeperPOS; clasificadas por exposición teórica.

**Remediación (requiere autorización, es cambio de dependencias):** (1) `npm audit fix` en frontend (mayoría no-breaking; `next@16.4.6` y zod fuera de rango declarada → actualizar `package.json` conscientemente); (2) backend: audit fix no-breaking + revisar el caso `exceljs/uuid` por separado (el fix automático es downgrade a exceljs@3.4.0 — riesgo funcional en el importador). Recomendación: hacer esto como trabajo propio de mantenimiento, no dentro de la rama de auditoría.

---

## Observación post-remediación SEC-015 (frontend, pendiente de autorización)

El preview del POS (`frontend/src/app/pos/page.tsx:805-811`) sigue descontando el descuento global DESPUÉS del impuesto: con descuento de venta, el total en pantalla puede superar el cobrado por el servidor (el servidor manda y cobra bien; es la vista la que miente). Un pago CARD/TRANSFER por el monto del preview genera el sobrepago ya documentado. Fix propuesto: replicar en el preview la distribución pre-IVA de `allocateSaleDiscount`. También cosmético: `frontend/src/app/sales/page.tsx:257` sigue ofreciendo el filtro RETURNED_PARTIAL.
