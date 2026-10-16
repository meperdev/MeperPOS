# Plan 08 — PWA, móvil y offline

**Estado:** la base está construida y verificada en la rama `feat/pwa-support` (19 commits, sin pushear). Este plan cubre **lo que falta** para llegar a "100%": entrega probada, endurecimiento, offline de lectura y —si se decide— offline de escritura y distribución en tiendas.

**Esfuerzo estimado:** 135–255 h para las Fases 1–5 (el camino PWA + offline real). Las Fases 6 y 7 son opcionales y paralelizables: 60–160 h más.

**Por qué existe este plan:** el trabajo ya hecho dio instalabilidad en iOS y Android. Lo que falta no es "más PWA": son cuatro cosas de naturaleza distinta — verificación de entrega, endurecimiento de plataforma, capa offline, y una decisión de producto — más un fork de alcance sobre tiendas de aplicaciones que hay que resolver antes de estimar en serio.

---

## Fase 0 — La decisión que cambia todo el alcance

**¿"Soporte para iOS y Android" quiere decir "instalable desde el navegador" o "publicado en el App Store y Play Store"?**

No son el mismo proyecto y la diferencia es de 60–160 h más un compromiso de mantenimiento:

- **Android:** existe camino barato y legítimo. Una **TWA** (Trusted Web Activity) con Bubblewrap empaqueta la PWA y se publica en Play Store. ~30–50 h incluyendo cuenta, firma y ficha.
- **iOS:** **Apple no acepta PWAs en el App Store.** No hay atajo: o envoltorio nativo (Capacitor/Cordova) o app nativa. Y la guideline 4.2 rechaza explícitamente "un sitio web reempaquetado", así que hay que agregar capacidades de dispositivo para justificar la app. Además: cuenta de desarrollador Apple (USD 99/año), revisión, y un pipeline de build nativo que hoy no existe. ~60–120 h.

**Salida de la fase:** una decisión escrita. Si la respuesta es "instalable alcanza", las Fases 6 y 7 quedan fuera y el plan baja a 135–255 h. Si es "queremos tienda", la Fase 6 entra y conviene empezar por Android, que es el camino barato y valida el empaquetado.

---

## Fase 1 — Cerrar y probar la entrega (10–16 h)

**Por qué primero:** es la fase más barata y la que más riesgo elimina. Hoy *nadie* instaló esto en un dispositivo. Si la instalación real o el ciclo de cookies no se comportan como esperamos, cambia el diseño de todo lo de arriba.

- Configurar `NEXT_PUBLIC_API_URL=/api` y `BACKEND_ORIGIN` **scoped a Preview** en Vercel, y desplegar un preview. Producción queda intacta con la URL absoluta mientras se aprende.
- Backend: `app.set("trust proxy", 1)` en rama propia. `backend/src/app.module.ts:37` registra un `ThrottlerGuard` global de 100 req/60 s y `auth.controller.ts` lee la IP del cliente; detrás del proxy ambas cosas apuntan al proxy si no se lee `X-Forwarded-For`. **Requisito antes de mover tráfico de producción.**
- Verificar **un upload real de ~5 MB** por el proxy. `ImageUpload` acepta hasta 5 MB y el límite de payload de Vercel es 4,5 MB para Serverless Functions; los rewrites externos corren en la capa de ruteo, así que *no debería* aplicar — no está probado.
- Prueba en **Android y iPhone reales**: instalar, abrir sin señal, cerrar y reabrir. En particular el punto que motivó todo esto: que no pida login en cada apertura.

**Criterio de cierre:** instalación y reapertura verificadas en los dos sistemas, con el proxy funcionando, y el upload de 5 MB confirmado.

---

## Fase 2 — Endurecimiento de plataforma y guardas en CI (15–25 h)

La PWA hoy es un artefacto de una sola vez. Esta fase la vuelve algo que no se puede romper sin que alguien se entere.

- **Safe areas app-wide.** `viewportFit: cover` está en `layout.tsx`, así que la app se dibuja borde a borde, pero solo dos componentes compensan: `src/components/pos/MobileCartDrawer.tsx:310` y `src/components/pos/MobileCartFloatingBar.tsx:23`. Falta el resto: header, contenido y navegación inferior. En standalone esto se ve como contenido debajo del notch o del home indicator.
- **Indicador de conexión y estado de sincronización.** Hoy hay cero `navigator.onLine` en `src/`. Existe la página `/offline` para navegaciones, pero la app nunca te dice si estás online. Para un cajero, "¿estoy online?" y "¿entró mi venta?" no son cosmética.
- **Verificación PWA instrumentada en CI.** No hay `e2e/`, ni Playwright, ni chequeo de manifest/SW en `.github/workflows/ci.yml`. Agregar un check que cargue la app, confirme el manifest y el SW activo, y ejercite el fallback offline.
- **Decisión de flujo de actualización.** El SW usa `skipWaiting` silencioso: la versión nueva entra en el próximo load sin avisar. Alcanza para instalabilidad; para un POS conviene decidir explícitamente si querés aviso de "hay versión nueva" y recarga controlada.

**Criterio de cierre:** la PWA tiene cobertura de CI que falla si el manifest, el SW o el shell offline se rompen.

---

## Fase 3 — Offline de lectura (30–45 h)

**Qué habilita:** abrir la app sin señal y ver el último catálogo, precios y clientes conocidos. No permite vender (eso es Fase 5), pero sí operar en modo consulta.

- **Persistencia de React Query en IndexedDB.** Verificado ausente: cero referencias a `persistQueryClient` o `indexedDB` en `src/`.
- **Scoping por usuario y organización.** Este es el punto de seguridad, no un detalle. `X-Organization-Id` es estado multi-tenant: el cache persistido tiene que estar scopeado por identidad y limpiarse en el teardown de sesión, que ya es dueño único de esa frontera (`clearSessionState` en `src/lib/session.ts`). Un cache compartido en una tablet compartida es fuga de datos entre cuentas.
- **Política de frescura visible.** Cada lista leída de cache necesita decir de cuándo son los datos.
- **Presupuesto de almacenamiento y evicción.** iOS borra el storage escribible de una PWA tras ~7 días de desuso. La capa de lectura tiene que asumir que su cache puede desaparecer y no ser la única fuente de verdad.

**Criterio de cierre:** con la red caída, la app abre y muestra datos del último estado conocido, claramente marcados como tales, sin filtrar datos entre usuarios.

---

## Fase 4 — Escritura offline: la decisión de producto (20–30 h, solo decisión y diseño)

**Esta fase no produce código.** Produce un documento. Y es obligatoria antes de la Fase 5, porque la Fase 5 no se puede codear sin estas respuestas.

- **Política de conflicto de stock.** El stock es un compare-and-swap bajo `Serializable` (`updateMany({ stock: { gte: qty } })`). Offline, dos dispositivos pueden creer que tienen el último ítem. ¿Se permite stock negativo y se reconcilia? ¿Se rechaza la venta al sincronizar y se avisa? No hay respuesta técnica correcta: es comercial.
- **Autoridad del precio.** El invariante del proyecto es que **el servidor es dueño de toda cifra que se convierte en plata** (`computeEffectiveSalePrice`, `resolveEffectiveTaxRate`). Una venta offline lleva precios calculados con un catálogo viejo. ¿El cliente manda un snapshot del precio efectivo y el servidor lo acepta con auditoría? Eso mueve una frontera que hoy está bien puesta, y necesita decisión explícita.
- **Numeración fiscal offline.** El Plan 04 (DIAN) asigna consecutivos con bloqueo pesimista. Vender sin conexión y asignar números fiscales después es un problema legal, no técnico.

**Criterio de cierre:** un documento de decisión aprobado, con la política elegida y sus consecuencias escritas.

---

## Fase 5 — Implementar el POS offline (80–140 h)

**Depende de:** Fase 3 (capa de lectura) y Fase 4 (decisiones). Y conviene coordinarla con el **Plan 03 (caja, arqueo y turnos)**: vender offline sin control de turno por dispositivo deja un agujero en el arqueo.

- **Idempotencia end-to-end, que hoy no existe.** Verificado: `grep idempotenc backend/src` solo da un spec de backfill, y `POST /sales` no acepta ninguna clave del cliente. Una venta hecha offline y reintentada al reconectar es una venta duplicada. Requiere clave generada por el cliente, índice único y replay que devuelva la venta original.
- **Cola de sincronización y reconciliación** en el cliente, con resolución de conflictos según la Fase 4.
- **Recibos offline.** Hoy `POST /sales/:id/receipt` es un viaje al servidor.
- **Sincronización en primer plano.** iOS no implementa Background Sync: la cola drena cuando la app está abierta, no en background. El diseño tiene que asumirlo.
- **Caja y turno por dispositivo**, coordinado con el Plan 03.

**Criterio de cierre:** una venta hecha sin conexión se registra exactamente una vez, con el stock y el arqueo consistentes, y sin romper el invariante de autoridad del precio.

---

## Fase 6 (opcional) — Distribución en tiendas (40–120 h)

Solo si la Fase 0 se responde "queremos tiendas".

- **Android (30–50 h):** TWA con Bubblewrap, Digital Asset Links, cuenta de Play, ficha, firma y pipeline de release. Camino barato, validado por la industria.
- **iOS (60–120 h):** envoltorio Capacitor o nativo. Requiere cuenta Apple, revisión, y capacidades de dispositivo reales para no caer en la guideline 4.2.
- **Consecuencia de mantenimiento:** cada release de tienda pasa por revisión, y aparece un pipeline de build móvil que hoy no existe en el repo.

---

## Fase 7 (opcional) — Capacidades de dispositivo (20–40 h)

- **Escáner de código de barras.** Hoy está **bloqueado por el propio CSP**: `next.config.ts` envía `Permissions-Policy: camera=()`, que deshabilita `getUserMedia` y por lo tanto la cámara in-page y `BarcodeDetector`. Los `<input accept="image/*">` siguen funcionando porque el picker lo maneja el sistema operativo. Para un POS, escanear es de las mejoras de operación más grandes por hora invertida — pero requiere abrir la cámara explícitamente y acotar el alcance del permiso.
- **Notificaciones push.** iOS 16.4+ las soporta para PWAs instaladas, con gesto del usuario. Candidatas naturales: stock bajo, vencimientos (Plan 06), y tareas asignadas.

---

## Deuda declarada de la rama actual

- `NEXT_PUBLIC_API_URL` y `BACKEND_ORIGIN` no están documentadas en `frontend/.env.example`: una política de seguridad bloquea leer esa ruta y no se rodeó. Queda para el dueño.
- El rewrite de `/api` está en la misma rama que la feature de PWA, y es el único commit que puede afectar producción. **Candidato a separarse en su propia rama.**
- Nada de esto se probó nunca en navegador, emulador ni dispositivo real. Todo lo verificado es fuente, tests y HTML generado.

## Dependencias con los planes existentes

```text
Fase 1 ──> Fase 2 ──> Fase 3 ──> Fase 5 (POS offline)
                        │            ^
Fase 4 (decisión) ──────┘            │
                                     │
Plan 03 (caja/turnos) ───────────────┘   turno por dispositivo
Plan 04 (DIAN) ──> numeración fiscal offline (Fase 4)
Plan 05 (sucursales) ──> stock por ubicación cambia la política de conflicto
Plan 06 (lotes/vencimientos) ──> FEFO offline
```

**Choque de prioridades a tener presente:** los Planes 02–07 suman 355–460 h, con la facturación electrónica DIAN como obligación legal. Este plan no los reemplaza. La Fase 1 y la 2 son chicas y conviene hacerlas ya; la Fase 4 debería sentarse junto al Plan 03 y el Plan 04, no después.
