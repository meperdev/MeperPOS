# Runbook de Despliegue y Operacion en Produccion

**Proyecto:** MeperPOS + POS  
**Stack:** Next.js (Vercel) + NestJS/Prisma (Railway) + Supabase Postgres  
**Ultima actualizacion:** 2026-03-11

---

## 1. Objetivo y Alcance

Este documento define el proceso oficial para:

- Desplegar el sistema en produccion.
- Operar de forma segura con cambios de frontend, backend y base de datos.
- Publicar nuevas features, fixes de bugs y hotfixes sin romper produccion.
- Resolver incidentes comunes de configuracion, conexion y autenticacion.

Este runbook aplica a todo el equipo tecnico (desarrollo y operacion).

---

## 2. Arquitectura de Produccion

- **Frontend (Vercel):** sirve la aplicacion Next.js.
- **Backend (Railway):** ejecuta NestJS, expone `/api`, `/api/health`, `/api/docs`.
- **Base de datos (Supabase):** Postgres administrado.
- **ORM (Prisma Client):** `prebuild` ejecuta `prisma generate` y nada mas: solo genera el cliente, no toca la base de datos.
- **Owner versionado de la migracion (Prisma):** `backend/package.json` es el unico responsable: `migrate:prod` aplica la migracion y `start:prod` lo ejecuta antes de arrancar la aplicacion.
- **Imagenes (Cloudinary):** almacenamiento externo para assets de producto.

### Flujo de trafico

1. Usuario entra a Vercel.
2. Frontend consume API en Railway (`NEXT_PUBLIC_API_URL`).
3. Backend se conecta a Supabase con:
   - `DATABASE_URL` (pooler session, runtime).
   - `DIRECT_URL` (conexion usada por Prisma para migraciones; en entornos con limitaciones de red puede usarse temporalmente pooler).

---

## 3. Variables de Entorno Obligatorias

### 3.1 Railway (backend)

| Variable | Requerida | Ejemplo / Notas |
|---|---|---|
| `DATABASE_URL` | Si | `postgresql://postgres.<project_ref>:<password>@aws-...pooler.supabase.com:5432/postgres` |
| `DIRECT_URL` | Si | Preferido: `db.<project_ref>.supabase.co:5432`. Workaround: mismo valor de `DATABASE_URL` |
| `JWT_SECRET` | Si | Generar con `openssl rand -hex 32` |
| `NODE_ENV` | Si | `production` |
| `CORS_ORIGIN` | Si | URL(s) frontend reales, separadas por coma, sin espacios |
| `CLOUDINARY_CLOUD_NAME` | Si (si hay imagenes) | Valor de cuenta Cloudinary |
| `CLOUDINARY_API_KEY` | Si (si hay imagenes) | Valor de cuenta Cloudinary |
| `CLOUDINARY_API_SECRET` | Si (si hay imagenes) | Valor de cuenta Cloudinary |

**Nota:** no definir `PORT` en Railway (Railway lo inyecta automaticamente).

**Nota:** `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`, `SUPERADMIN_NAME`, `SUPERADMIN_PROMOTE` y `SUPERADMIN_RESET_PASSWORD` son variables de la provision y del restablecimiento del SuperAdmin (seccion 4.1), no de runtime: se definen solo para ejecutar `npm run provision:prod`. Quitar `SUPERADMIN_PASSWORD`, `SUPERADMIN_PROMOTE` y `SUPERADMIN_RESET_PASSWORD` del entorno cuando el comando termina.

### 3.2 Vercel (frontend)

| Variable | Requerida | Ejemplo / Notas |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Si | `https://<tu-backend>.up.railway.app/api` |

**Regla:** cualquier cambio en env vars de Vercel requiere nuevo deploy para reflejarse en build.

---

## 4. Despliegue Inicial (One-Time Setup)

### 4.1 Supabase

1. Crear proyecto Supabase.
2. Obtener connection strings:
   - Pooler session.
   - Direct connection.
3. Configurar variables en Railway (`DATABASE_URL`, `DIRECT_URL`).
4. Aplicar el esquema con el responsable versionado, desde un entorno con
   conectividad a la base de datos:

```bash
railway run npm run migrate:prod
```

5. Verificar el estado de las migraciones antes de provisionar:

```bash
railway run npx prisma migrate status
```

   `prisma migrate status` no debe reportar migraciones sin aplicar: verificar
   que la migracion quedo aplicada antes de arrancar la aplicacion (seccion 4.2).
   El deploy usa `npm run start:prod`, que ejecuta `migrate:prod` antes de
   arrancar; si la migracion falla, el contenedor no arranca y el deploy queda
   marcado como fallido.

6. Crear el primer SuperAdmin con el provisioner de produccion. `SUPERADMIN_EMAIL`
   y `SUPERADMIN_PASSWORD` (minimo 12 caracteres) no son variables de runtime:
   exportarlas en el mismo shell que ejecuta el comando, porque `railway run`
   solo inyecta las variables del servicio y el script las lee del entorno local.
   Opcionalmente `SUPERADMIN_NAME`:

```bash
export SUPERADMIN_EMAIL='owner@tu-dominio.com'
read -rsp 'SUPERADMIN_PASSWORD: ' SUPERADMIN_PASSWORD; echo
export SUPERADMIN_PASSWORD
railway run npm run provision:prod
unset SUPERADMIN_PASSWORD
```

   Si el email de la cuenta no se recuerda, listarlo antes de restablecer:

```bash
railway run bash -lc 'psql "${DATABASE_URL%%\?*}" -Atc "select email from \"User\" where \"isSuperAdmin\";"'
```

   `DATABASE_URL` lleva parametros de Prisma (`connection_limit`, `pool_timeout`)
   que libpq rechaza como `invalid URI query parameter`; el `${DATABASE_URL%%\?*}`
   los recorta y deja la URL que `psql` acepta.

   No usar claves conocidas ni valores de ejemplo como
   `cambiar-esta-clave-produccion`: el script rechaza los defaults conocidos y las
   claves documentadas en este repositorio. El comando es idempotente: si el email
   ya es SuperAdmin no cambia nada. Si el email pertenece a un usuario que no es
   SuperAdmin, falla en vez de promoverlo en silencio; para promoverlo de forma
   explicita hay que definir `SUPERADMIN_PROMOTE=true`. Si el email no existe,
   crea una cuenta nueva: cuando ya habia otros SuperAdmins, imprime un aviso con
   sus emails, para que confirmes que no fue un error de tipeo antes de dar la
   recuperacion por buena. La busqueda del email ignora mayusculas y minusculas;
   si dos usuarios coinciden por diferencia de capitalizacion, el comando falla
   en vez de elegir uno. Imprime un resumen sin
   secretos y termina con codigo distinto de cero si rechaza la operacion.

   Si se pierde la clave del SuperAdmin, el mismo comando la restablece: exportar
   la nueva clave en `SUPERADMIN_PASSWORD` (minimo 12 caracteres) junto con
   `SUPERADMIN_EMAIL` y `SUPERADMIN_RESET_PASSWORD=true`:

```bash
export SUPERADMIN_EMAIL='owner@tu-dominio.com'
export SUPERADMIN_RESET_PASSWORD=true
read -rsp 'Nueva SUPERADMIN_PASSWORD: ' SUPERADMIN_PASSWORD; echo
export SUPERADMIN_PASSWORD
railway run npm run provision:prod
unset SUPERADMIN_PASSWORD SUPERADMIN_RESET_PASSWORD
```

   El restablecimiento solo actua sobre un email que ya sea
   SuperAdmin: reemplaza el hash, incrementa `tokenVersion` y revoca los refresh
   tokens activos de esa cuenta, de modo que las sesiones previas quedan
   cerradas. Falla si el email no existe o si pertenece a un usuario comun, asi
   que no puede crear ni promover cuentas. Confirmar el acceso con el login real
   antes de dar la recuperacion por cerrada. `BACKEND_URL` es el dominio publico
   del backend (Railway: Settings > Networking > Public Networking, o
   `railway status` en `backend/` imprime la `url` del servicio); definirlo una
   vez y el paso 7 lo reutiliza:

```bash
export BACKEND_URL='https://<dominio-del-backend>.up.railway.app'
curl -sS -X POST "$BACKEND_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"<email-del-superadmin>","password":"<clave-nueva>"}'
```

7. Crear la primera organizacion con la API de administracion (solo SuperAdmin),
   autenticado con el SuperAdmin del paso 6:

```bash
curl -X POST "$BACKEND_URL/api/admin/organizations" \
  -H "Authorization: Bearer <token-superadmin>" \
  -H "Content-Type: application/json" \
  -d '{"name":"<nombre-organizacion>","slug":"<slug>","admin":{"email":"<email>","name":"<nombre>"}}'
```

   `POST /api/admin/organizations` es el bootstrap de la organizacion: crea la
   organizacion, el usuario ADMIN con una password temporal aleatoria, las
   secuencias de venta y de orden de compra, y la caja por defecto.

8. Verificar tablas en Supabase (`User`, `Product`, `Category`, `Settings`, `Sale`, etc.).

   La produccion no usa datos demo: el seed de desarrollo queda fuera del camino
   de provision. El catalogo opcional de una organizacion de sandbox sigue
   disponible con `npm run seed:org:prod` (requiere `SEED_ALLOW_NON_DEV=true`).

### 4.2 Railway

1. Root directory: `backend`.
2. Start command: `npm run start:prod`, que ejecuta `migrate:prod` antes de arrancar la aplicacion.
3. Health check path: `/api/health`.
4. Confirmar deploy sin errores.

### 4.3 Vercel

1. Root directory: `frontend`.
2. Configurar `NEXT_PUBLIC_API_URL`.
3. Deploy y validar carga de aplicacion.

### 4.4 Integracion final

1. Configurar `CORS_ORIGIN` en Railway con dominio de Vercel.
2. Redeploy backend.
3. Verificar flujo E2E.

---

## 5. Checklist de Go-Live

- [ ] `GET /api/health` responde `status: ok` y `database: connected`.
- [ ] `GET /api/docs` disponible.
- [ ] Frontend en Vercel carga sin errores JS.
- [ ] Login funciona con el SuperAdmin creado por `provision:prod` y con usuarios reales (no hay usuarios demo en produccion).
- [ ] `prisma migrate status` sin migraciones pendientes: verificar el orden de `start:prod` (migracion antes del arranque).
- [ ] Inventario y POS operativos.
- [ ] `CORS_ORIGIN` sin localhost en produccion.
- [ ] Spend limit configurado en Railway.
- [ ] Secretos almacenados fuera de git.

---

## 6. Flujo Estandar para Subir Cambios a Produccion

### 6.1 Principio operativo

Produccion no es el lugar para descubrir errores evitables. Antes de hacer push o merge, el cambio ya debe estar validado como desplegable. El objetivo del push a `main/master` es que Railway y Vercel solo ejecuten el redeploy con artefactos y migraciones ya preparados, no que actuen como entorno de prueba.

### 6.2 Clasificar el cambio antes de tocar la rama de release

Todo cambio debe clasificarse antes del PR. Esta clasificacion define que validar antes del push:

- **Frontend-only:** cambios en `frontend/` sin cambios de API, DB ni variables compartidas.
- **Backend-only:** cambios en `backend/src/` o configuracion de backend sin modificar `schema.prisma`.
- **Backend + DB:** cambios en `backend/prisma/schema.prisma`, queries Prisma, estructura de datos o migraciones.
- **Config-only:** cambios en variables de entorno, dominios, CORS, secretos, settings de Railway/Vercel/Supabase.
- **Mixto:** cualquier combinacion de los tipos anteriores. Se valida con la suma de todos los checks aplicables.

Si el cambio toca API, modelo de datos, autenticacion, permisos, integraciones externas o variables de entorno, debe tratarse como cambio de riesgo medio/alto aunque el diff parezca pequeno.

### 6.3 Que preparar segun el tipo de cambio

Usar esta matriz operativa antes de pensar en push. Primero clasificar el cambio. Despues preparar lo que corresponde. Si un caso combina varios tipos, aplicar todos los bloques.

#### Caso A - Si tocaste solo backend

Preparar antes del push:

- Validar build de backend.

```bash
cd backend
npm run build
```

- Revisar el modulo afectado y validar en local `GET /api/health` mas el endpoint critico impactado.
- Si cambiaste DTOs, controladores o servicios, revisar contratos API: rutas, payloads, codigos de estado, validaciones y errores esperados.
- Confirmar que no cambiaste `schema.prisma`, migraciones ni env vars sin documentarlo.

#### Caso B - Si tocaste backend + Prisma/schema/db

Orden mental obligatorio antes del push:

1. Ajustar `backend/prisma/schema.prisma`.
2. Generar la migracion localmente.
3. Validar migracion y aplicacion.
4. Recien despues pensar en build y push.

Preparar antes del push:

- Crear la migracion versionada inmediatamente despues del cambio de schema.

```bash
cd backend
npx prisma migrate dev --name <descripcion>
```

- Verificar que el cambio incluya `backend/prisma/schema.prisma` y una nueva carpeta en `backend/prisma/migrations/`.
- NO hacer push con cambios en `schema.prisma` si no existe la carpeta de migracion versionada en git.
- Validar que no quede drift entre schema y migraciones.
- Validar backend con el estado post-migracion antes del push.

```bash
cd backend
npm run build
```

- Si el cambio impacta queries Prisma, DTOs o respuestas API, revisar endpoints criticos y contratos resultantes.
- Si la migracion transforma datos, documentar mitigacion y estrategia de forward-fix antes del PR.

#### Caso C - Si tocaste solo frontend

Preparar antes del push:

- Validar build de frontend.

```bash
cd frontend
npm run build
```

- Probar la pagina, vista o flujo afectado con backend local o backend esperado para release.
- Si cambiaste consumo de API, revisar que rutas, payloads, estados de carga/error y formatos esperados sigan alineados con backend.
- Confirmar que no introdujiste dependencia nueva de env vars sin actualizar documentacion y configuracion.

#### Caso D - Si tocaste frontend + backend

Preparar antes del push:

- Validar build de backend y frontend antes del push.

```bash
cd backend
npm run build
```

```bash
cd frontend
npm run build
```

- Revisar integracion completa del flujo impactado: ruta frontend -> llamada API -> respuesta backend -> render final.
- Confirmar alineacion de contratos: metodo HTTP, payloads, campos opcionales, enums, nullables, mensajes de error y codigos de estado.
- Si frontend y backend no quedan backward compatible, coordinar deploy conjunto y dejar el orden operativo explicito en el PR.

#### Caso E - Si tocaste configuracion o env vars

Preparar antes del push:

- Identificar exactamente que variables cambian, donde se usan y en que plataforma viven: Railway, Vercel o ambas.
- Actualizar `backend/.env.example` o `frontend/.env.example` si corresponde.
- Confirmar formato, nombre exacto, valor esperado y momento en que impacta el deploy.
- Si la variable afecta build de frontend, asumir redeploy despues de cargarla en Vercel.
- Si la variable afecta runtime backend, confirmar que Railway la tenga cargada antes del release.
- Si la variable cambia contratos, origenes CORS, autenticacion o integraciones externas, tratar el cambio como mixto y aplicar tambien checks de backend/frontend.

### 6.4 Checklist obligatoria antes de push

Ejecutar esta checklist en orden. Si un punto falla, el cambio queda en estado **no push** hasta corregirlo.

#### Paso 1 - Confirmar alcance real del cambio

- [ ] Identificar si el cambio afecta frontend, backend, base de datos, configuracion o una combinacion.
- [ ] Revisar si el cambio modifica contratos HTTP, payloads, codigos de estado, validaciones, autenticacion, permisos o estructura de respuesta.
- [ ] Revisar si el cambio introduce dependencias nuevas, scripts nuevos o ajustes de runtime.

#### Paso 2 - Validar variables de entorno afectadas

- [ ] Confirmar si se agrega, elimina o cambia alguna env var en `backend/.env.example` o `frontend/.env.example`.
- [ ] Verificar que el nombre, formato y uso de cada variable coincidan entre codigo, documentacion y plataforma objetivo.
- [ ] Verificar impacto cruzado: cambios de `NEXT_PUBLIC_API_URL`, `CORS_ORIGIN`, `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET` o claves de Cloudinary afectan despliegue real.
- [ ] Confirmar que las variables necesarias ya existen en Railway/Vercel o que su alta esta planificada antes del merge.
- [ ] Si una env var cambia de significado, dejarlo explicito en el PR y en este runbook si corresponde.

#### Paso 3 - Gate obligatorio para cambios de Prisma y schema

- [ ] Si se modifico `backend/prisma/schema.prisma`, confirmar que existe una migracion versionada nueva en `backend/prisma/migrations/`.
- [ ] Confirmar que el commit incluye ambos artefactos: schema actualizado y carpeta de migracion correspondiente.
- [ ] Confirmar que NO hay cambios de schema pendientes sin migracion versionada.
- [ ] Confirmar que no se esta confiando en `prisma db push` ni en ajustes manuales en produccion como sustituto de migracion.
- [ ] Si la migracion es destructiva o transforma datos, documentar plan de mitigacion, ventana operativa y estrategia de forward-fix.
- [ ] Si hubo cambio de schema pero no corresponde migracion, justificarlo explicitamente en el PR. En la practica, esto deberia ser excepcional.

#### Paso 4 - Validacion local obligatoria del backend

No se hace push para que Railway descubra errores de compilacion, dependencias, configuracion o Prisma.

- [ ] Validar que el backend arranca en local con la configuracion prevista.
- [ ] Validar localmente el flujo de compilacion/arranque de backend antes del push.
- [ ] Validar como minimo `GET /api/health` y el endpoint o modulo afectado por el cambio.
- [ ] Revisar que no haya errores de bootstrap, inyeccion de dependencias, validacion de DTOs, Prisma Client o carga de env vars.
- [ ] Si el cambio toca auth, permisos o CORS, probar explicitamente ese flujo en local.
- [ ] Si el cambio toca DB, verificar que la app funcione luego de aplicar la migracion en entorno local o controlado antes del merge.

#### Paso 5 - Validacion local obligatoria del frontend

- [ ] Validar localmente que el frontend compila antes del push.
- [ ] Probar la vista, pagina o flujo afectado con backend realista o entorno local equivalente.
- [ ] Verificar que no existan errores de tipos, importaciones rotas, hooks invalidos, hydration issues ni fallas de consumo API.
- [ ] Si el cambio depende de env vars de frontend, confirmar que su valor esperado esta definido antes del deploy.
- [ ] Si el cambio impacta navegacion, login, dashboard, POS o formularios, probar el flujo completo y no solo el componente aislado.

#### Paso 6 - Verificar contratos frontend-backend

- [ ] Si cambio la API, confirmar que frontend y backend estan alineados en rutas, metodo HTTP, payloads, campos opcionales, codigos de error y mensajes esperados.
- [ ] Verificar que no haya incompatibilidad entre nombres de campos, enums, nullables, formatos de fecha o montos.
- [ ] Verificar compatibilidad hacia atras si frontend y backend no van a desplegarse exactamente al mismo tiempo.
- [ ] Si no hay backward compatibility, coordinar deploy conjunto y documentar el orden de despliegue.

#### Paso 7 - Smoke test local / pre-flight antes de push

- [ ] Ejecutar un recorrido corto del flujo impactado de punta a punta en local o entorno controlado.
- [ ] Verificar login, carga de datos, guardado y visualizacion del cambio afectado segun corresponda.
- [ ] Confirmar ausencia de errores 4xx/5xx inesperados, errores de consola y fallas de serializacion.
- [ ] Confirmar que logs y respuestas del backend no muestran errores repetitivos ni warnings criticos.

#### Paso 8 - Criterio formal de listo para push

Un cambio queda **listo para push** solo si se cumple todo lo siguiente:

- [ ] La clasificacion del cambio es clara y el PR describe impacto tecnico y operativo.
- [ ] Las variables de entorno afectadas estan verificadas y disponibles.
- [ ] Si hubo cambio de schema, la migracion versionada existe y ya fue validada antes del push.
- [ ] Backend y frontend fueron validados localmente segun el alcance del cambio.
- [ ] Los contratos frontend-backend quedaron alineados.
- [ ] El smoke test local/pre-flight fue satisfactorio.
- [ ] No queda ninguna validacion critica delegada a Railway, Vercel o Supabase para despues del merge.

#### Paso 9 - Criterio explicito de no push

No hacer push a rama de release ni mergear a `main/master` si ocurre cualquiera de estas condiciones:

- [ ] Cambio de `schema.prisma` sin migracion versionada.
- [ ] Build local de backend o frontend no validada segun el alcance del cambio.
- [ ] Endpoint, modulo o flujo afectado no probado localmente.
- [ ] Variables de entorno faltantes, ambiguas o no cargadas en plataforma.
- [ ] Contrato API cambiado pero frontend o backend siguen desalineados.
- [ ] El equipo depende de "ver que pasa en Railway/Vercel" para descubrir si el deploy funciona.
- [ ] No existe plan claro para migraciones, compatibilidad o rollback cuando el riesgo lo requiere.

### 6.5 Rama, PR y merge

1. Crear rama:

```bash
git checkout -b feature/<nombre>
```

2. Implementar el cambio y completar la checklist obligatoria antes de push.
3. Abrir PR con descripcion clara: que cambia, por que, impacto operativo, variables afectadas y si incluye migracion.
4. Adjuntar evidencia de validacion local en el PR cuando el cambio toque backend, DB, auth, POS o integraciones.
5. Merge a `main/master` solo cuando la checklist este cerrada y los checks minimos del repositorio esten en verde.

### 6.6 Release en produccion

- Push/merge dispara deploy automatico en Railway y Vercel.
- Railway debe encontrar schema y migraciones ya preparados; no debe descubrir cambios incompletos ni drift evitable.
- El responsable versionado de la migracion es `backend/package.json`: `start:prod` ejecuta `npm run migrate:prod` (`prisma migrate deploy`) antes de arrancar la aplicacion; no depende de un paso definido en la plataforma.
- La integracion continua aplica las migraciones en un paso explicito y separado (`.github/workflows/ci.yml`).
  Ningun paso de compilacion toca la base de datos.
- La plataforma no define un paso de migracion aparte: el contrato vive en el repositorio y se ejecuta al arrancar el contenedor (seccion 4.2).
- Ejecutar smoke test post-deploy (seccion 9).
- Si el despliegue depende de habilitar o actualizar variables de entorno, hacerlo antes o en la misma ventana operativa del release, nunca despues de detectar la falla en produccion.

---

## 7. Guia de Buenas Practicas para Features y Bugfixes

### 7.1 Features nuevas

- Definir alcance pequeno y entregable (MVP por iteracion).
- Documentar contrato API si se toca backend.
- Mantener compatibilidad hacia atras cuando sea posible.
- Si cambia DB, incluir migracion Prisma versionada.
- Agregar validaciones y manejo de errores de negocio.
- Verificar impacto en roles (`ADMIN`, `CASHIER`, `INVENTORY_USER`).

### 7.2 Bugfixes

- Reproducir bug con pasos concretos antes de corregir.
- Aplicar fix minimo y seguro (evitar refactors grandes en bugfix).
- Probar regression en flujo afectado y flujo vecino.
- Dejar evidencia en PR (causa raiz + validacion del fix).

### 7.3 Hotfixes de produccion

- Crear rama `hotfix/<descripcion>` desde `main/master`.
- Corregir solo lo critico.
- Deploy inmediato.
- Postmortem corto: causa raiz, prevencion, accion follow-up.

### 7.4 Convenciones de calidad

- Commits atomicos y con mensaje semantico (`feat`, `fix`, `chore`, `docs`).
- No mezclar cambios de infraestructura con cambios funcionales sin necesidad.
- Evitar secretos en codigo, commits o PR.
- Mantener `.env.example` actualizado cuando cambien variables.

---

## 8. Cambios con Base de Datos (Prisma + Supabase)

### 8.1 Flujo recomendado

1. Actualizar `backend/prisma/schema.prisma`.
2. Crear migracion local:

```bash
npx prisma migrate dev --name <descripcion>
```

3. Validar migracion en local y sobre la aplicacion afectada antes del push.
4. Confirmar que el backend levanta correctamente con el schema resultante y que no quedan cambios de schema sin versionar.
5. Commit de schema + carpeta de migracion en el mismo cambio.
6. En deploy, `prisma migrate deploy` aplica cambios en produccion.

### 8.2 Gates obligatorios antes de merge para cambios de DB

- Toda modificacion de `schema.prisma` debe pasar por la checklist de la seccion 6.4.
- No hacer merge si existe drift entre `schema.prisma` y `backend/prisma/migrations/`.
- No asumir que Railway o Prisma en produccion van a resolver errores de schema no probados localmente.
- Si la migracion cambia columnas, indices, defaults, enums o relaciones, validar tambien el impacto en DTOs, queries Prisma y respuestas API.
- Si el cambio requiere datos previos o backfill, documentar el orden operativo exacto antes del release.

### 8.3 Reglas importantes

- Nunca editar manualmente migraciones ya aplicadas en produccion.
- Evitar cambios destructivos sin plan de rollback.
- Si hay que renombrar o transformar datos, preferir migraciones graduales.
- Para incidentes de schema, preferir **forward-fix** (nueva migracion) sobre rollback manual agresivo.

---

## 9. Smoke Test Post-Deploy (Obligatorio)

### 9.1 Backend

- [ ] `GET /api/health` OK.
- [ ] `GET /api/docs` accesible.
- [ ] Logs sin errores repetitivos en Railway.

### 9.2 Frontend

- [ ] Login exitoso.
- [ ] Dashboard carga datos.
- [ ] Productos listan sin error.
- [ ] POS permite crear una venta.
- [ ] Reportes y clientes responden.

### 9.3 Integracion

- [ ] Sin errores CORS.
- [ ] Sin errores 401/500 inesperados.
- [ ] Datos se reflejan en Supabase.

---

## 10. Troubleshooting Rapido

### 10.1 `Configuration key "JWT_SECRET" does not exist`

**Causa:** falta variable en Railway.  
**Accion:** agregar `JWT_SECRET` en Railway y redeploy.

### 10.2 `P1000 Authentication failed`

**Causa:** credenciales invalidas en `DATABASE_URL`/`DIRECT_URL`.  
**Accion:**

- Validar usuario correcto en pooler (`postgres.<project_ref>`).
- Verificar password real y URL encoding de caracteres especiales.
- Reemplazar variables y redeploy.

### 10.3 `P1001 Can't reach database server`

**Causa:** conectividad al host de DB.  
**Accion:**

- Validar host/puerto de URL.
- Usar pooler session para destrabar despliegue si direct no es alcanzable.
- Reintentar migracion desde entorno con conectividad valida.

### 10.4 CORS bloqueando frontend

**Causa:** `CORS_ORIGIN` incorrecto o incompleto.  
**Accion:**

- Setear URL exacta de Vercel en Railway.
- Si hay varios dominios, separarlos por coma.
- Redeploy backend.

### 10.5 Backend inicia con `npm start` en vez de produccion

**Causa:** start command por defecto no ajustado.  
**Accion:** en Railway, definir `npm run start:prod`.

---

## 11. Rollback y Recuperacion

### 11.1 Rollback de aplicacion

- Revertir commit en GitHub.
- Trigger de nuevo deploy en Railway/Vercel.
- Verificar smoke test.

### 11.2 Rollback de base de datos

- Evitar rollback manual directo salvo emergencia critica.
- Preferir migracion correctiva (forward-fix).
- Si se requiere restauracion completa, usar backup/snapshot de Supabase.

---

## 12. Control de Costos y Operacion Continua

- Configurar spend limit en Railway (Workspace -> Billing).
- Evitar redeploys innecesarios en ramas de prueba.
- Mantener Supabase y Railway con monitoreo basico de estado.
- Revisar consumo y logs de error al menos semanalmente.

---

## 13. Referencias Internas

- `docs/planes/historicos/2026-03-05-deployment-design.md`
- `docs/planes/historicos/2026-03-06-deployment-implementation.md`
- `backend/.env.example`
- `frontend/.env.example`
