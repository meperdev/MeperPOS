# Alertas y notificaciones de stock bajo

Este documento cubre las dos mitades del sistema de alertas: el feed que alimenta
la campanita de la aplicación y el aviso que sale de la aplicación por WhatsApp.

## 1. El feed (`GET /api/alerts`)

La campanita ya no calcula nada. El backend arma la lista y la entrega completa:

```json
[
  {
    "id": "stock:low",
    "category": "stock",
    "severity": "warning",
    "title": "Stock bajo",
    "detail": "3 productos por debajo del mínimo.",
    "href": "/inventory?filter=lowStock",
    "revision": "9f2c1a3b7d4e5f60"
  }
]
```

- **`id`** identifica la condición, no el evento. `stock:low` agrupa todos los
  productos bajos en una sola fila.
- **`revision`** es la huella de los hechos detrás de la alerta. Cambia cuando
  cambia el conjunto de productos bajos, los contadores del plan, los préstamos
  vencidos o la fecha de la prueba.
- **Visibilidad**: la decide el servidor. `ADMIN` (y `OWNER` por herencia) ve
  facturación, límites, stock, préstamos y tareas; `INVENTORY_USER` ve stock,
  préstamos y tareas; `CASHIER` ve préstamos y tareas; `MEMBER` ve préstamos y
  tareas. Un rol sin permiso no recibe la categoría, aunque la pida.
- **Degradación por fuente**: si una consulta falla (por ejemplo, un timeout en
  préstamos), se pierde solo esa categoría; las demás se siguen sirviendo. Cada
  fallo queda en el log como `alerts_signal_failed` con el nombre de la fuente y
  el tipo de error, nunca con datos del tenant.

### El ledger de leídos

`AlertCenter` guarda en `localStorage`, por organización
(`meperpos:alerts-seen:<organizationId>`), un mapa `id -> revision`. La consulta
del feed también está indexada por organización en la caché del cliente, así que
cambiar de organización en la misma sesión no puede mostrar el feed de la
anterior. Una alerta está **sin leer** cuando su `revision` no coincide con la
guardada. Al abrir el panel se guardan las revisiones actuales.

Consecuencia importante: si mañana entra un producto nuevo a stock bajo, la fila
sigue siendo `stock:low` pero su `revision` cambia, y la campanita vuelve a sonar.
La versión anterior guardaba solo el `id`, así que una condición vista una vez
quedaba muda para siempre.

## 2. El aviso por WhatsApp

### Qué dispara

Un **episodio** por producto (`ProductStockAlert`):

- el producto entra al conjunto bajo (`stock <= minStock`, producto activo con
  inventario manejado) → se abre un episodio y se notifica;
- el producto se recupera → el episodio se resuelve;
- vuelve a bajar → se abre el episodio siguiente y se notifica de nuevo.

El barrido corre cada 5 minutos (`StockAlertsScheduler`) y una vez al arrancar el
proceso, así que un reinicio no pierde un cruce. Es de un solo vuelo: si un tick
llega mientras el anterior sigue corriendo, se omite con
`stock_alert_scan/skipped_overlap` en vez de apilar otro barrido. El barrido de arranque **no
bloquea el listen**: se lanza en segundo plano, porque una sesión de WhatsApp
lenta o caída no puede retrasar el arranque del servicio. Es idempotente:
repetirlo no duplica episodios ni mensajes.

### A quién le llega

Al **primer teléfono verificado** (`WhatsAppIdentity` en estado `VERIFIED`) cuyo
usuario sea `OWNER` o `ADMIN` de esa misma organización, ordenado por fecha de
verificación. Es la misma política que usa el reporte diario: el stock de una
organización nunca viaja al administrador de otra.

Si no hay teléfono verificado, el episodio queda `SKIPPED` con
`notificationFailure = 'no_recipient'`. La alerta sigue visible en la campanita.

### Cómo sale

Por la sesión central `INTELLIGENCE` del proveedor WAHA, con el puerto
`WHATSAPP_TEXT_SENDER` que ya usa la respuesta administrativa. Requiere la misma
configuración que el resto del canal:

```
WAHA_BASE_URL=...
WAHA_API_KEY=...
WAHA_WEBHOOK_URL=...
```

El mensaje es texto plano, sin enlaces, y lista hasta 10 productos; si hay más,
resume el resto (`… y N productos más`). El nombre y el SKU se normalizan antes de
renderizar: los caracteres de control (incluidos saltos de línea) se colapsan y el
texto se trunca, así que un nombre de catálogo no puede fabricar renglones ni
colar un enlace.

### Garantías

- **Como máximo un intento por episodio.** La fila se reclama
  (`PENDING → SENDING`) antes de llamar al proveedor. Un segundo barrido no
  encuentra nada que reclamar.
- **Sin reintentos automáticos.** Un fallo queda `FAILED` con un código fijo
  (`provider_rejected`, `send_failed`); un `SENDING` que quedó colgado por una
  caída no se reintenta. Reintentar es una decisión manual.
- **Nada del proveedor se guarda ni se registra**: ni el cuerpo de la respuesta,
  ni la URL, ni el teléfono, ni el texto. Los logs llevan solo el resultado y el
  motivo.

### Apagarlo

`STOCK_ALERTS_ENABLED=false` desactiva el barrido y el aviso. El feed sigue
funcionando. Es la variable que usan las suites end-to-end para no tocar al
proveedor.

## 3. Historial de notificaciones

Cada transición de un episodio queda como una fila inmutable en
`ProductStockAlertEvent`: `OPENED`, `RESOLVED`, `NOTIFIED`, `FAILED` y `SKIPPED`.
La tabla actual (`ProductStockAlert`) guarda el estado corriente; el historial no
se sobrescribe cuando el producto vuelve a cruzar su mínimo, así que cada
episodio conserva su apertura, su resolución y el resultado de su aviso.

`GET /api/alerts/notifications?page=1&limit=20&kind=FAILED` devuelve la página más
reciente primero:

```json
{
  "data": [
    {
      "id": "evt_1",
      "product": { "id": "p1", "name": "Café molido 500 g", "sku": "BEB-003" },
      "episode": 2,
      "kind": "NOTIFIED",
      "failureReason": null,
      "createdAt": "2026-11-15T10:00:00.000Z"
    }
  ],
  "meta": { "total": 1, "page": 1, "limit": 20, "totalPages": 1 }
}
```

- Roles: `ADMIN` (OWNER hereda) e `INVENTORY_USER`, los mismos que ya ven alertas
  de stock. El tenant sale del token.
- `limit` se acota a 100 y `page` a un mínimo de 1; un `kind` fuera del conjunto
  cerrado responde 400.

En la aplicación, `/alerts` muestra ese historial con filtro por estado,
paginación y enlace desde el panel de alertas. Es la pantalla para responder "¿a
quién le llegó qué y cuándo?" sin mirar la base.

## 4. Operación

| Síntoma | Causa probable | Qué mirar |
| --- | --- | --- |
| La campanita está vacía | el rol no ve ninguna categoría, o el usuario no tiene organización | rol y membresía en `OrganizationUser` |
| El mensaje no llegó | `SKIPPED` / `no_recipient` | `ProductStockAlert.notificationStatus` y `notificationFailure` |
| El mensaje falló | `FAILED` / `provider_rejected` | sesión WAHA `INTELLIGENCE` conectada y credenciales |
| Llegó dos veces por el mismo producto | no debería: un episodio, un envío | `episode` y `notificationAttempts` de la fila |
| No sé si el aviso salió | consultá `/alerts` | historial por episodio y estado (`NOTIFIED`, `FAILED`, `SKIPPED`) |

## 5. Lo que no está implementado

- **Email y push**: no existe transporte en el repositorio. Agregar uno implica
  dependencia nueva (SMTP o web-push), credenciales y suscripciones por
  dispositivo. No es parte de este cambio.
- **Preferencias por organización**: hoy el aviso va siempre al administrador
  verificado; no hay interruptor por usuario ni horario silencioso.
