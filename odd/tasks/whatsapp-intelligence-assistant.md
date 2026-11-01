# WhatsApp Intelligence assistant

Objective: implement the accepted administrative assistant proposal in ordered, testable work units; exclude the commercial assistant.
Branch: `sesion-proveedor-ai-meper-intelligence`; delivery strategy: ask-on-risk; forecast: >400 authored lines. Backend Jest (`npm test`), focused tests and suite.

## Specs

- S1: «primero con el canal administrativo —el que usa la administradora para consultar el negocio— y dejemos el asistente comercial para después»
- S2: «Agregar envío de texto mediante un contrato del proveedor y su adaptador WAHA.» «Enviar respuestas legibles para resumen y supervisión, y definir qué responder ante comandos no compatibles y fallos.» «Mantener el PDF como flujo separado y evitar respuestas o envíos duplicados.»
- S3: «Probar webhook → identidad → autorización → consulta → respuesta con WAHA simulado.» «Revisar registro de resultados, caídas y recuperación, sin registrar mensajes, números ni cifras sensibles en logs.»
- S4: «Crear una interfaz de proveedor de modelo intercambiable, sin acoplar WAHA a un proveedor concreto.» «Limitar las herramientas inicialmente a las operaciones de lectura ya autorizadas.» «Validar del lado del servidor cada intención, parámetro, identidad, rol y organización.» «Ante salida inválida, indisponibilidad o duda, rechazar o pedir precisión; no inventar datos.» «Definir límites de tiempo, costo y datos enviados al proveedor, además de pruebas contra instrucciones maliciosas.»
- S5: «No hay una imagen WAHA verificada fijada en la configuración. Hay que confirmar que la versión elegida soporte las dos sesiones y verificar QR, formato de eventos y envío de archivos y texto.» «La SIM y los teléfonos son necesarios para la aceptación final»
- S6: «Compararía proveedores y modelos cuando tengamos claros presupuesto, privacidad y dónde puede procesarse la información.» «No recomiendo elegir uno todavía solo por nombre»

## Tasks

- T1 [S1,S2,S3] Implement deterministic text response and bounded delivery semantics with tests and relevant docs. Route: delegated writer, context backstop. Status: done — text port + WAHA `sendText`, deterministic administrative gate, at-most-once reply, opaque LID refused at the intelligence boundary; 380 focused tests GREEN. Independent security verification unavailable (timed out, no verdict) — carried to T3. Commit: `df8d766`.
- T2 [S1,S4,S6] Prepare safe model integration without selecting a provider; tests and docs. Route: pending reassessment. Status: pending. Commit: pending.
- T3 [S1,S3] Run applicable focused and full checks, independent security verification and correct regressions. Route: independent verifier for security. Status: pending. Commit: pending.
- T4 [S5,S6] Document remaining real WAHA/number acceptance and decisions on provider, privacy and budget. Route: inline. Status: pending. Commit: pending.

## Log

- L1: «Hola necesito continua con la parte que me hace falta para whatsapp que es ver al final que haremos con el modelo y la conexion detras. Tambien nos falta creo que hacer la parte determinista? AUn no tengo
la SIM del numero que quedara para el sistema, pero eso al final.»
- L2: «Dale si, revisa y valida lo que falta y arma la propuesta»
- L3: «Si, comienza con toda mi loco :)» — accepts the assistant proposal: deterministic administrative circuit first, secure model preparation next; real provider choice and actual phone tests remain pending required decisions/resources.
- L4: Existing focused Jest command failed before running tests: `dotenv: command not found`; `backend/node_modules` absent. Engram tools unavailable; mirror pending. Native WhatsApp documentation contains stale stage statements. Do not alter commercial assistant behavior.
- L5: `npm ci` succeeded. T1 writer observed RED (21 failures), then GREEN (155 tests in 5 suites); parent independently reran the focused Jest command: exit 0, 155 passed. Independent security verification timed out after 30 minutes with a bash tool still running; no verdict was returned. Required security proof is unavailable. Diff forecast exceeded: 1,009 insertions and 37 deletions; delivery strategy choice required before committing. Real WAHA remains unverified.
- L6: «SI revisa, y mira como complementas y continuas buen» Parent review identified a security concern: `normaliseContactPhone` accepts opaque `@lid` identifiers as phone numbers, and `inboundText` applies it before linking and authorization. If an opaque identifier collides with a verified phone, an unrelated sender may be treated as that identity. Fail closed at the intelligence boundary while preserving commercial ingestion; prove with public-boundary RED/GREEN tests. Do not conflate unknown LID with a verified phone.
- L7: Session interrupted while T1 was uncommitted and the LID correction was in the working tree. Resumed from this document (not from memory claims). RED re-proved on the public boundary: with `if (route === 'intelligence' && sender.kind !== 'phone')` temporarily disabled, `whatsapp-events.service.spec.ts` + `whatsapp-webhook.spec.ts` fail 8 of 69; restored, 69/69 pass, and the whole `src/whatsapp` folder is 20 suites / 380 tests GREEN. TypeScript over the backend reports 22 pre-existing errors elsewhere and 0 in `src/whatsapp`; ESLint on every touched file is 0 errors (one prettier error fixed in `whatsapp-webhook.spec.ts`).
- L8: T1 was committed as `df8d766` (1,513 authored changed lines) as one work unit including its tests and `docs/waha-integration.md`, because the same behaviour cannot be split from its proof and the slice is a single security boundary (identity gate + delivery bound). It is explicitly above the 400-authored-line guideline and must not be presented as a small review; the branch is never presented as one slice. Nothing pushed; no PR.
