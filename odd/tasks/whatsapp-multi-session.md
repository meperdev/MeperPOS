# WhatsApp multi-session

Objective: two independent WAHA sessions in one instance — `COMMERCIAL` (org-owned) and `INTELLIGENCE` (central, platform-owned) — with persisted connection registry, signed webhook routing, durable deduplication, and split administrative authority. Branch `feat/whatsapp-daily-report`. Delivery: work-unit commits on the feature branch; push and PR remain the user's decisions.

Runtime fact: the backend runs **Express**, not Fastify. No second WAHA server, no n8n, no Redis.

## Specs

- S1: «Cambio arquitectónico confirmado: utilizaremos DOS sesiones independientes de WhatsApp dentro de una misma instancia WAHA, separando el canal comercial del canal administrativo.»
- S2: «Implementar o adaptar la integración para soportar múltiples sesiones independientes.»
- S3: «Crear, iniciar, consultar, detener y recuperar sesiones.» «Generar y mostrar QR de vinculación.» «Consultar el estado de cada conexión.»
- S4: «Identificar qué sesión originó cada webhook.»
- S5: «No depender exclusivamente del nombre de sesión para determinar permisos.»
- S6: «Persistir la relación entre: Proveedor WhatsApp. Sesión del proveedor. Tipo de canal: `COMMERCIAL` o `INTELLIGENCE`. Organización propietaria, cuando corresponda. Estado de conexión. Configuración y metadatos necesarios.»
- S7: «La sesión `COMMERCIAL` pertenece a una organización.» «La sesión `INTELLIGENCE` debe poder diseñarse como un canal central compartido entre organizaciones, con aislamiento lógico estricto.»
- S8: «No crear un servidor independiente por sesión sin una justificación técnica.» «Una instancia WAHA. Dos sesiones WhatsApp.»
- S9: «Proteger la API y los webhooks mediante autenticación adecuada.»
- S10: «Recuperar las conexiones después de reinicios.» «Manejar desconexiones y errores de comunicación.»
- S11: «No procesar eventos duplicados.»
- S12: «No modifiques código hasta comprender las dependencias.» «Antes de implementar, presenta los hallazgos técnicos y el plan de cambios.»
- S13: «E1 sola si»
- S14: «EL pdf solo por ahora»
- S15: «Diseño central»
- S16: «No introduzcas n8n, Redis, microservicios adicionales ni frameworks de agentes sin justificar su necesidad.»
- S17: «Enviar al `CommercialMessageHandler`.» Responsabilidades: «Identificar clientes.» «Registrar conversaciones comerciales.» «Preparar la integración del agente de atención comercial.» «Mantener estados de conversación.» «Detectar intervención humana.» «Permitir suspender y reactivar respuestas automáticas.» «Evitar que mensajes entre empleadas y administradora activen funcionalidades administrativas.» «Registrar mensajes salientes manuales cuando WAHA permita capturarlos.» «No responder automáticamente a la administradora ni a contactos internos configurados.»
- S18: «Las conversaciones personales de las empleadas con la administradora deben seguir funcionando normalmente.»
- S19: «No asumir que todas las conversaciones pertenecen automáticamente a una sede: el número comercial es compartido por las dos.» «Distinguir conversaciones comerciales de comunicaciones internas.»
- S20: «Si, dejarlo mientras al locationId y ya meteremos sedes bien, continua» (E2 keeps the conversation scoped to the organization; no location column until the branches work lands).

## Tasks

- T1 [S1,S6,S7,S15] Schema and migration: `WhatsAppConnection`, `WhatsAppProcessedEvent`, channel/status enums, single central INTELLIGENCE row. Route: inline. Done: commit `870e70b` (6 migration-shape tests RED then GREEN).
- T2 [S2,S3,S8,S10] Provider contract and WAHA adapter lifecycle plus per-session webhook key derivation. Route: inline plus one worker for the wiring and specs. Done: commit `09ee27d` (`src/whatsapp/` 52 tests green, `tsc` clean in this module).
- T3 [S4,S5,S9,S11] Webhook resolves the connection from the signed payload, deduplicates durably, classifies, and dispatches to a recording-only handler. Route: inline. Done: commit `fba265c`.
- T4 [S5,S7,S9] Split administrative surfaces: commercial sessions for the owning organization, intelligence session for the platform. Route: worker. Done: commit `d92516c` (4 tests of the matrix gate green, 22 pre-existing `tsc` errors elsewhere, none in `src/whatsapp/`).
- T5 [S2,S9,S10] Tests, `docs/waha-integration.md`, `docs/authorization-matrix.md`, environment configuration. Route: worker. Done: commit `d92516c` (11 matrix rows replace 3; `frontend/src` never consumed the removed route).
- T6 [S17,S19,S20] Schema and migration for commercial ingestion: conversations, messages, internal contacts, contact kind, conversation state. Route: inline. Done: commit `9a734a8` (6 shape tests RED then GREEN).
- T7 [S17,S18,S19] Ingestion service: classify contact, record the thread and its messages, timing facts, human-intervention detection, behind one transaction with the deduplication receipt. Route: worker. Done: commit `4c0508c` (`src/whatsapp/` 129 tests green; `tsc` 0 errors in this module; matrix gate 4/4).

## Log

- L1: «# MeperPOS — Actualización de arquitectura WhatsApp + WAHA

## 1. Contexto

Estamos desarrollando MeperPOS, un SaaS multi-tenant basado en NestJS, TypeScript, Fastify, Prisma, PostgreSQL y Next.js.

El sistema ya cuenta con sus módulos fundamentales de ventas, inventario, compras, gastos, usuarios, sucursales y reportes.

Estamos implementando WhatsApp mediante WAHA.

**Cambio arquitectónico confirmado:** utilizaremos DOS sesiones independientes de WhatsApp dentro de una misma instancia WAHA, separando el canal comercial del canal administrativo.

Revisa primero el estado actual de la implementación. Conserva y adapta el código existente siempre que sea viable.

## 2. Distribución de números

Existen tres números telefónicos con funciones diferentes.

### Número A — WhatsApp comercial

- Pertenece a la cosmetiquera.
- Es compartido por sus dos sedes.
- Recibe conversaciones de clientes.
- Las empleadas lo utilizan para responder mensajes manualmente.
- Las empleadas también pueden utilizarlo para comunicarse con la administradora.
- Estará conectado a WAHA mediante una sesión denominada conceptualmente `commercial`.

Este canal debe permitir respuestas automáticas y atención humana.

### Número B — WhatsApp personal de la administradora

- Es su número personal habitual.
- No estará conectado a WAHA.
- Lo utiliza para comunicarse con las empleadas.
- También lo utilizará para escribir al número exclusivo del asistente administrativo.
- Su identidad deberá vincularse de forma segura a su usuario de MeperPOS.

### Número C — WhatsApp exclusivo de MeperPOS Intelligence

- Es un número adicional dedicado al asistente administrativo.
- Estará conectado a WAHA mediante una segunda sesión, denominada conceptualmente `intelligence`.
- Recibirá consultas administrativas desde el número personal de la administradora.
- Enviará respuestas y reportes mediante WhatsApp.
- En el futuro podrá funcionar como un número administrativo central para múltiples organizaciones de MeperPOS.

**Importante:** el número comercial y el número de Intelligence no son el mismo.

## 3. Arquitectura requerida

```text
           WHATSAPP
               |
       +-------+-------+
       |               |
    CLIENTES      ADMINISTRADORA
       |          Número personal
       |               |
       v               v
   Número A        Número C
   Comercial       Intelligence
       |               |
       v               v
  WAHA Session 1   WAHA Session 2
       |               |
       +-------+-------+
               |
               v
       WhatsApp Gateway
             NestJS
               |
       +-------+-------+
       |               |
       v               v
 CommercialHandler  AdminHandler
       |               |
       +-------+-------+
               |
               v
      MeperPOS Services
               |
               v
        PostgreSQL
```

Ambas sesiones utilizarán la misma infraestructura WAHA, cuando la capacidad del servidor y la versión instalada lo permitan.

No crear un servidor independiente por sesión sin una justificación técnica.

## 4. Reconocimiento del proyecto

Antes de implementar:

1. Inspecciona el módulo WhatsApp existente.
2. Identifica qué partes fueron desarrolladas para una sola sesión.
3. Revisa el esquema Prisma y las relaciones entre organizaciones, sedes y usuarios.
4. Identifica el mecanismo de autenticación y autorización.
5. Revisa los servicios de generación de reportes.
6. Revisa la infraestructura Docker y las configuraciones de despliegue.
7. Identifica los cambios mínimos necesarios para soportar múltiples sesiones y roles de canal.

No modifiques código hasta comprender las dependencias.

## 5. Integración de sesiones WAHA

Implementar o adaptar la integración para soportar múltiples sesiones independientes.

Requisitos:

- Crear, iniciar, consultar, detener y recuperar sesiones.
- Generar y mostrar QR de vinculación.
- Consultar el estado de cada conexión.
- Identificar qué sesión originó cada webhook.
- Enviar mensajes utilizando la sesión correcta.
- Recuperar las conexiones después de reinicios.
- Mantener persistencia segura.
- Manejar desconexiones y errores de comunicación.
- Evitar respuestas duplicadas.
- Proteger la API y los webhooks mediante autenticación adecuada.

Consultar los endpoints reales en la documentación oficial:

https://waha.devlike.pro/docs/how-to/sessions/

https://waha.devlike.pro/docs/how-to/events/

https://waha.devlike.pro/docs/how-to/security/

Verificar las características de la versión instalada antes de utilizarlas.

### Identificación de sesiones

No depender exclusivamente del nombre de sesión para determinar permisos.

Persistir la relación entre:

- Proveedor WhatsApp.
- Sesión del proveedor.
- Tipo de canal: `COMMERCIAL` o `INTELLIGENCE`.
- Organización propietaria, cuando corresponda.
- Estado de conexión.
- Configuración y metadatos necesarios.

La sesión `COMMERCIAL` pertenece a una organización.

La sesión `INTELLIGENCE` debe poder diseñarse como un canal central compartido entre organizaciones, con aislamiento lógico estricto.

Inicialmente solamente atenderá a la cosmetiquera.

## 6. Enrutamiento de mensajes

Crear o adaptar un servicio responsable de identificar el canal de origen.

### Mensajes recibidos en COMMERCIAL

Enviar al `CommercialMessageHandler`.

Responsabilidades:

- Identificar clientes.
- Registrar conversaciones comerciales.
- Preparar la integración del agente de atención comercial.
- Mantener estados de conversación.
- Detectar intervención humana.
- Permitir suspender y reactivar respuestas automáticas.
- Evitar que mensajes entre empleadas y administradora activen funcionalidades administrativas.
- Registrar mensajes salientes manuales cuando WAHA permita capturarlos.
- No responder automáticamente a la administradora ni a contactos internos configurados.

Las conversaciones personales de las empleadas con la administradora deben seguir funcionando normalmente.

### Mensajes recibidos en INTELLIGENCE

Enviar al `AdminMessageHandler`.

Responsabilidades:

- Identificar al remitente.
- Vincularlo con un usuario de MeperPOS.
- Verificar identidad, permisos y organización.
- Rechazar consultas administrativas no autorizadas.
- Preparar el acceso a servicios de lectura.
- Preparar el envío de reportes.
- Consultar estados y métricas del canal comercial.
- Mantener contexto conversacional independiente.

No otorgar acceso administrativo únicamente porque un número esté incluido en una lista estática.

El proceso de vinculación debe requerir autenticación previa en MeperPOS y permitir revocación.

No incluir claves, tokens ni datos financieros sensibles en logs.

## 7. Preparación de MeperPOS Intelligence

NO desarrollar todavía todo el motor de IA.

La integración debe quedar preparada para conectar un módulo independiente denominado conceptualmente `MeperPOS Intelligence`.

Debe admitir dos perfiles:

### Commercial Assistant

Acceso permitido:

- Catálogo público.
- Precios de venta.
- Disponibilidad comercial por sede.
- Información pública de sucursales.
- Solicitudes de atención humana.

Sin acceso a información administrativa.

### Administrative Assistant

Primera etapa: estrictamente READ-ONLY.

Acceso futuro previsto:

- Ventas.
- Inventarios.
- Compras.
- Gastos.
- Indicadores.
- Reportes.
- Métricas de conversaciones comerciales.
- Resúmenes de atención.
- Clientes pendientes.
- Estadísticas de atención automatizada y humana.

El asistente podrá posteriormente realizar inferencias y análisis utilizando herramientas autorizadas de MeperPOS.

No permitir acceso SQL arbitrario ni acceso directo del modelo a la base de datos.

La inteligencia se debe conectar a través de servicios existentes y herramientas controladas.

Preparar contratos para futuras acciones administrativas con autenticación, permisos, auditoría y confirmaciones explícitas, pero NO habilitar escrituras en esta etapa.

## 8. Supervisión de conversaciones

El asistente administrativo debe poder consultar información del WhatsApp comercial.

Preparar la persistencia necesaria para conocer:

- Conversaciones recibidas.
- Mensajes entrantes y salientes.
- Estado de cada conversación.
- Conversaciones pendientes.
- Conversaciones atendidas por IA.
- Conversaciones transferidas a humanos.
- Tiempos de primera respuesta.
- Intervenciones manuales.
- Información de la sede asociada, cuando esté identificada.
- Historial disponible para resúmenes y seguimiento.

No asumir que todas las conversaciones pertenecen automáticamente a una sede: el número comercial es compartido por las dos.

Distinguir conversaciones comerciales de comunicaciones internas.

La consulta administrativa se hará exclusivamente mediante servicios autorizados de MeperPOS.

Implementar medidas de privacidad y una política configurable de retención de mensajes.

## 9. Reportes

MeperPOS ya tiene mecanismos para generar reportes.

No reconstruirlos en WAHA ni en el agente de IA.

Preparar el flujo:

1. Administradora solicita un reporte.
2. AdminHandler valida identidad y permisos.
3. MeperPOS obtiene el reporte mediante su servicio existente.
4. WAHA lo envía desde la sesión INTELLIGENCE.
5. Se registra el resultado del envío.

Los documentos sensibles deberán entregarse mediante mecanismos de acceso protegido cuando corresponda.

## 10. Persistencia y multi-tenancy

Adaptar el esquema existente solamente cuando resulte necesario.

Evaluar entidades o estructuras equivalentes para:

- WhatsAppConnection.
- WhatsAppIdentity.
- WhatsAppConversation.
- WhatsAppMessage.
- WhatsAppProcessedEvent.
- WhatsAppConversationAssignment.

No es obligatorio utilizar estos nombres. Reutilizar las entidades ya existentes cuando sea apropiado.

Todas las consultas comerciales deben estar limitadas a su organización.

Para el canal INTELLIGENCE compartido, el contexto de organización debe resolverse de manera explícita y segura.

Si un administrador pertenece a varias organizaciones, exigir selección de contexto antes de consultar información.

Nunca permitir acceso cruzado entre tenants.

## 11. Infraestructura y costos

Priorizar un despliegue económico:

- Una instancia WAHA.
- Dos sesiones WhatsApp.
- Backend NestJS existente.
- PostgreSQL existente.
- Docker Compose cuando corresponda.
- Sin n8n inicialmente.
- Sin segundo servidor obligatorio.
- Sin servicio adicional de agentes de IA por ahora.

Configurar persistencia, health checks, secretos y recuperación.

No exponer públicamente el dashboard administrativo de WAHA.

Recordar que WAHA puede utilizar conexiones no oficiales y existe riesgo de desconexión o restricciones de WhatsApp.

Documentar cómo operar manualmente el canal comercial si WAHA deja de funcionar.

## 12. Pruebas obligatorias

Validar:

1. La sesión COMMERCIAL conecta mediante QR.
2. La sesión INTELLIGENCE conecta mediante otro QR.
3. Ambas funcionan simultáneamente.
4. Los webhooks identifican correctamente la sesión.
5. Los mensajes de clientes llegan al CommercialHandler.
6. Los mensajes de la administradora al número INTELLIGENCE llegan al AdminHandler.
7. El WhatsApp comercial permite seguir conversando manualmente con la administradora.
8. Esas conversaciones internas no activan el agente comercial.
9. Un cliente no puede consultar datos administrativos.
10. Un número no autorizado no puede utilizar Intelligence.
11. Los mensajes enviados desde una sesión no aparecen como enviados desde la otra.
12. Se registran las conversaciones comerciales necesarias para supervisión.
13. No se procesan eventos duplicados.
14. Las reconexiones y reinicios no mezclan sesiones.
15. El sistema sigue funcionando si una de las sesiones se desconecta.
16. No se producen bucles de respuesta automática.

## 13. Entregables

- Informe de impacto sobre la implementación actual.
- Plan de adaptación.
- Soporte de múltiples sesiones WAHA.
- Configuración de ambos canales.
- Enrutamiento por tipo de canal.
- Identificación y autorización de usuarios.
- Registro de conversaciones.
- Preparación para Intelligence.
- Pruebas de integración.
- Documentación de configuración y despliegue.
- Relación de archivos modificados.
- Instrucciones de vinculación de los dos números mediante QR.

## 14. Instrucciones finales

Trabaja sobre el código existente.

No reescribas módulos funcionales sin necesidad.

No introduzcas n8n, Redis, microservicios adicionales ni frameworks de agentes sin justificar su necesidad.

No desarrolles todavía el motor completo de inteligencia artificial.

Prioriza una implementación modular, segura y mantenible.

Antes de implementar, presenta los hallazgos técnicos y el plan de cambios.

**Objetivo final:** dos números conectados a dos sesiones WAHA dentro de una misma infraestructura. Uno atiende clientes de una organización con dos sedes; el otro ofrece un canal administrativo privado, preparado para MeperPOS Intelligence y potencialmente compartible entre administradores de múltiples organizaciones. mira este plan y dime que piensas con el proyecto y la implementacion como va»

- L2 — decisions: «2. EL pdf solo por ahora» (reports deliver the PDF attachment; no signed links in this stage), «3. E1 sola si» (scope is E1: connection registry, multi-session lifecycle, webhook routing and deduplication), «4. Diseño central» (the INTELLIGENCE session is modelled as one central channel from the start, `organizationId` nullable, logical isolation per resolved organization).
- L3 — reconnaissance finding: no branch/`Location` model exists. `Organization` is the only tenant container; `OrganizationUser` carries the role; `CashRegister` is a plan-limited POS cash register (`maxCashRegisters`) with no relation to `Sale`, `Product` or `InventoryMovement`. The remembered branch model is `docs/planes/implementacion/plan-05-sucursales-bodegas-transferencias.md`, which is a **plan document, not implemented code** (70–90 h, destructive `Product.stock` migration, prerequisite of plan 06). Consequence for this feature: E2 conversations are scoped to the organization, and `locationId` is added later as an additive migration when plan 05 lands. No branch model is invented here.
- L4 — reconnaissance finding: the existing module is single-session by construction (`meper-<sha256(orgId)>`), the webhook discards every signed event, the provider contract exposes no lifecycle beyond connect/status/qr, and there are no WhatsApp tables in `schema.prisma`. No live WAHA session was ever created, so the session-name scheme can change without a production migration.
- L5 — documentation finding: the WAHA sessions page lists `POST /api/{session}/auth/qr` in its feature table while its detailed section documents `GET /api/{session}/auth/qr` returning `{ mimetype, data }` with `Accept: application/json`. This implementation uses the documented GET plus JSON and treats a 405 as a provider failure; the installed version must confirm it. The status set also includes `PASSKEY_REQUIRED` and `PASSKEY_CONFIRMATION_REQUIRED`, which the current allowlist omits.
- L6 — correction to the input: the backend runs Express, not Fastify. Fastify remains postponed by the user's earlier decision.
- L8 — slice boundaries on `feat/whatsapp-daily-report`: `118c6b0` daily report, `feeadf4` WAHA connection, then this feature in `870e70b` (schema/migration), `09ee27d` (provider lifecycle), `fba265c` (webhook routing), `d92516c` (channel surfaces plus docs). Each slice is a reviewable unit under ~500 authored lines; the branch total exceeds the 400-line review target because it carries four earlier slices from a previous session. Verification per slice: focused Jest in `src/whatsapp/`, the authorization-matrix gate, and `tsc` (22 pre-existing errors outside this module, 0 inside). E1 is complete; E2 onward is not authorized yet.
- L7 — rejected diagnostic: the automated reviewer reports `L7: The datasource property url is no longer supported` on `backend/prisma/schema.prisma`. It is a Prisma 7 rule; this repository pins `prisma ^6.19.2` (installed 6.19.2), where the datasource `url` is mandatory. Verified with the project's own CLI: removing the line yields `Argument "url" is missing in data source block "db"`, keeping it yields `The schema at prisma/schema.prisma is valid`. The line is pre-existing at HEAD and untouched by this feature's diff. Applying the suggestion would break `prisma validate`, `generate` and `migrate` for the whole repository, so it is not applied. Upgrading to Prisma 7 is a separate, user-owned decision.
- L9 — E2 boundary: `9a734a8` (conversations, messages, internal contacts) and `4c0508c` (ingestion) close commercial ingestion. Product-visible rules chosen while implementing, each reversible in a later task: `firstResponseAt` also counts a reply typed by hand; a hand-typed reply moves `SUSPENDED` to `HUMAN` (reactivation semantics are not built yet); `lastMessageAt` follows arrival order, so a late older message moves it backwards; customer matching is exact digits, so a stored phone with separators will not match; `contactKind` is written when the conversation is created, so a thread first seen as `UNKNOWN` stays that way if the customer is registered later. Intelligence events are deduplication-only until E3. E3 (verified administrative identity) is not authorized yet.
