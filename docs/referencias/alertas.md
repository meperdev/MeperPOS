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

### El ledger de leídos

`AlertCenter` guarda en `localStorage`, por organización
(`meperpos:alerts-seen:<organizationId>`), un mapa `id -> revision`. Una alerta
está **sin leer** cuando su `revision` no coincide con la guardada. Al abrir el
panel se guardan las revisiones actuales.

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
proceso, así que un reinicio no pierde un cruce. Es idempotente: repetirlo no
duplica episodios ni mensajes.

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
resume el resto (`… y N productos más`).

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

## 3. Operación

| Síntoma | Causa probable | Qué mirar |
| --- | --- | --- |
| La campanita está vacía | el rol no ve ninguna categoría, o el usuario no tiene organización | rol y membresía en `OrganizationUser` |
| El mensaje no llegó | `SKIPPED` / `no_recipient` | `ProductStockAlert.notificationStatus` y `notificationFailure` |
| El mensaje falló | `FAILED` / `provider_rejected` | sesión WAHA `INTELLIGENCE` conectada y credenciales |
| Llegó dos veces por el mismo producto | no debería: un episodio, un envío | `episode` y `notificationAttempts` de la fila |

## 4. Lo que no está implementado

- **Email y push**: no existe transporte en el repositorio. Agregar uno implica
  dependencia nueva (SMTP o web-push), credenciales y suscripciones por
  dispositivo. No es parte de este cambio.
- **Preferencias por organización**: hoy el aviso va siempre al administrador
  verificado; no hay interruptor por usuario ni horario silencioso.
