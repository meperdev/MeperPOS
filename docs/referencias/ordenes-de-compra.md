# Órdenes de compra: documento, envío y seguimiento

Una orden de compra es el documento que el negocio le envía a su proveedor. Este
documento cubre cómo se genera, cómo se envía y cómo se sigue. La recepción
actualiza cantidades y costos según `PurchaseOrdersService.receive`. El `locationId`
opcional indica la sede de una entrega; el permiso se comprueba al recibir. La
sede no modifica el documento enviado al proveedor. Consultá las [reglas antes del
corte de stock](../planes/implementacion/multisede-corte-stock.md#recepción-de-compras-antes-del-corte).

Las recepciones de una misma orden se procesan una a la vez. Si otra operación
recibió la cantidad pendiente o canceló la orden, actualizá la orden antes de
volver a registrar la entrega. Una orden con una recepción parcial o completa
no se puede cancelar.

La edición de un borrador y su confirmación toman la misma orden una a la vez,
con el mismo bloqueo que la recepción. Si otra operación la confirmó o la
canceló mientras tanto, la edición responde «Solo se pueden editar órdenes en
borrador» y la confirmación «Solo se pueden confirmar órdenes en borrador», sin
escribir nada. Al confirmar se guardan los ítems, los totales y el proveedor que
la orden tiene en ese momento, no los que la petición leyó al empezar.

## 1. Ciclo de vida

| Paso | Estado | Qué queda registrado |
|---|---|---|
| Crear | `DRAFT` | Ítems y totales (calculados en el servidor). |
| Confirmar | `PENDING` | `confirmedAt` y, opcional, `expectedDeliveryDate`. La orden ya no se edita. |
| Enviar | `PENDING` (sin estado nuevo) | `sentAt`, `sentVia` y `documentSnapshot`, solo la primera vez. |
| Recibir | `PARTIAL_RECEIVED` / `RECEIVED` | Stock, movimiento `OC-<n>` y costo, como hasta ahora. |

En la interfaz, confirmar y enviar viven en el mismo modal como un grupo de dos
botones, `[ Confirmar | Enviar ]`. **Enviar se habilita cuando el servidor responde
que la orden quedó confirmada**, nunca por tiempo: así no se puede mandar al
proveedor una orden cuya confirmación falló. Si el modal se cierra después de
confirmar, la orden queda confirmada y "sin enviar"; el detalle vuelve a ofrecer
**Enviar al proveedor**.

El badge muestra **Enviada** para una orden `PENDING` con `sentAt`, y suma
**Atrasada** cuando el servidor marca `overdue`.

## 2. Endpoints

| Ruta | Qué hace |
|---|---|
| `POST /api/purchase-orders/:id/confirm` | Acepta `{ "expectedDeliveryDate": "AAAA-MM-DD" }` opcional. |
| `POST /api/purchase-orders/:id/send` | Registra el envío. Rechaza `DRAFT` y `CANCELLED`. Repetirlo no cambia nada. |
| `GET /api/purchase-orders/:id/pdf` | Descarga el PDF (tamaño carta) de cualquier orden que no sea borrador. |
| `POST /api/purchase-orders/:id/duplicate` | "Repetir pedido": crea un borrador. Acepta `{ "supplierId" }` opcional. |
| `GET /api/purchase-orders?status=OVERDUE` | Lista las órdenes atrasadas. |

Todas usan los roles de las demás rutas de órdenes (`ADMIN`, `MEMBER`) y están
filtradas por organización.

## 3. El documento y su copia fija

El PDF lo arma `backend/src/purchase-orders/document/`:

- `purchase-order-document.ts` define los datos del documento y la copia fija
  (`documentSnapshot`, versión 1): negocio, proveedor, plantilla con la dirección
  de entrega ya resuelta, quién la elaboró y el nombre y SKU de cada ítem.
- `purchase-order-pdf.ts` dibuja la hoja carta: encabezado con logo, bloques de
  proveedor y de entrega y pago, tabla de ítems que repite el encabezado en cada
  página, totales guardados en la orden, notas, términos, "Elaborado por" y un pie
  con el número de página.

**La primera vez que se envía**, el servidor guarda la copia fija. Desde ahí, cada
descarga se arma con esa copia: aunque cambien los ajustes, el proveedor o el
nombre de un producto, el PDF es el mismo que recibió el proveedor. Una orden
confirmada que no se envió se arma con los datos actuales. Cantidades y montos
siempre salen de la orden, que no cambia después de confirmar; el generador no
calcula dinero.

El primer envío escribe con `updateMany` condicionado a `sentAt: null`: si dos
envíos llegan a la vez, gana una sola copia.

## 4. La plantilla del negocio

**Ajustes → Órdenes de compra** guarda en `Organization.settings.purchaseOrderTemplate`:

| Campo | Máximo | Si está vacío |
|---|---|---|
| `deliveryAddress` | 300 | Se usa la dirección del negocio. |
| `paymentTerms` | 200 | No sale en el PDF. |
| `terms` | 2000 | No sale la sección. |
| `footer` | 500 | No sale el pie de texto. |

El `PUT /api/settings` reemplaza campo por campo: enviar solo `paymentTerms`
conserva los otros tres. El nombre, el NIT, el teléfono, la dirección y el logo
salen de **Ajustes → General**.

## 5. Atrasadas

Una orden está atrasada cuando sigue esperando mercancía (`PENDING` o
`PARTIAL_RECEIVED`), tiene `expectedDeliveryDate` y ese día ya pasó en hora de
Bogotá. `isPurchaseOrderOverdue` (`purchase-order-status.ts`) es la única regla:
el campo `overdue` de cada lectura y el filtro `status=OVERDUE` la usan. La fecha
esperada es un día calendario (`@db.Date`); el frontend la muestra con
`formatCalendarDay` para que no se corra un día por la zona horaria.

## 6. Repetir pedido

El historial es la lista de órdenes; cualquier orden, en cualquier estado, se
puede repetir. El servidor arma el borrador con `create()`, así que se valida,
numera y calcula como cualquier orden nueva:

- copia el proveedor (u otro, si se elige), los productos y las cantidades pedidas;
- toma el **costo actual** de cada producto, y la tasa de impuesto la pone `create()`;
- no copia las notas, porque son de cada pedido;
- deja por fuera los productos inactivos (`INACTIVE`) y los que no manejan
  inventario (`NOT_STOCKED`), y los devuelve en `skippedItems`.

Los productos no están atados a un proveedor, así que la misma lista sirve para
otro. Si se cambia de proveedor, el modal avisa que los costos son los de la
última compra. El borrador nuevo abre con el editor (`/purchase-orders/<id>?edit=1`).
