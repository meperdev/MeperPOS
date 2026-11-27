# Transferencias entre sedes

Una transferencia mueve stock de una sede a otra dentro de la misma organización.
Sirve para trasladar mercancía de una bodega a una tienda, entre bodegas o entre
tiendas, sin vender ni comprar nada.

El stock sale de la sede de origen al despachar y queda **en tránsito**: ya no
está en ninguna sede ni en el total de la organización. Al recibirla, entra en la
sede de destino y el total vuelve a cuadrar. Si se cancela, vuelve a la sede de
origen. Los totales de la organización siguen siendo la suma de las sedes, así
que reportes y alertas no cambian de significado durante esta entrega.

## 1. Ciclo de vida

| Paso | Estado | Qué queda registrado |
|---|---|---|
| Despachar | `IN_TRANSIT` | Número consecutivo por organización, sedes de origen y destino, ítems con su cantidad, `createdById` y, si se escribió, `notes`. El stock sale de la sede de origen. |
| Recibir | `RECEIVED` | `receivedAt` y `receivedById`. El stock entra en la sede de destino. No se puede volver a recibir ni cancelar. |
| Cancelar | `CANCELLED` | `cancelledAt`, `cancelledById` y `cancelReason` (obligatorio). El stock vuelve a la sede de origen. No se puede volver a recibir ni cancelar. |

Solo se admiten productos que manejan inventario (`tracksStock` y que no sean de
tipo servicio). Un producto repetido en la misma transferencia se rechaza: el
efecto sobre el stock sería ambiguo.

## 2. Qué le pasa al stock

Cada ítem escribe un movimiento de inventario en la sede que realmente se movió,
con la referencia `TR-<número>` en `reason`:

| Leg | Movimiento | Sede del movimiento | Cantidad |
|---|---|---|---|
| Despacho | `TRANSFER_OUT` | Origen | Negativa |
| Recepción | `TRANSFER_IN` | Destino | Positiva |
| Cancelación | `TRANSFER_IN` | Origen | Positiva |

`previousStock` y `newStock` siguen documentando el total de la organización,
como en el resto del kárdex. La cantidad del movimiento es el cambio del total:
en el despacho el stock se va de la organización, en la recepción o la
cancelación vuelve.

El stock por sede vive en `ProductStock`. El total de la organización
(`Product.stock`) se mantiene igual a la suma de las sedes por los triggers de la
base, así que nadie escribe el total a mano:

```
Product.stock      = SUM(ProductStock.stock de ese producto)
Product.reservedStock = SUM(ProductStock.reservedStock)
```

Con una transferencia en tránsito, esa ecuación sigue valiendo: la mercancía no
está en ninguna de las dos sedes y tampoco en el total. Es lo que se busca: nadie
puede vender ni reservar unidades que están en un camión.

## 3. API

Todas las rutas llevan `JwtAuthGuard`, `OrganizationRequiredGuard` y `@Roles`.
Despachar y cancelar son trabajo administrativo (`ADMIN`; ningún otro rol lo
alcanza). El cajero de la sede de destino recibe la mercancía, así que leer y
recibir admiten además `CASHIER`. Toda lectura y toda escritura se filtra por la
organización del token.

| Ruta | Método | Para qué |
|---|---|---|
| `/api/transfers` | POST | Despachar stock de una sede a otra. |
| `/api/transfers` | GET | Listar transferencias con filtros `status`, `siteId`, `page` y `limit`. |
| `/api/transfers/:id` | GET | Leer una transferencia con ítems, nombres de producto y nombres de sede. |
| `/api/transfers/:id/receive` | POST | Recibir la transferencia en la sede de destino. |
| `/api/transfers/:id/cancel` | POST | Cancelar la transferencia en tránsito y devolver el stock al origen. |

### Despachar

```json
POST /api/transfers
{
  "fromLocationId": "…",
  "toLocationId": "…",
  "notes": "Traslado a la bodega",
  "items": [{ "productId": "…", "quantity": 3 }]
}
```

El origen se autoriza dentro de la transacción de inventario: hace falta una sede
a la que el usuario tenga acceso (los roles de organización completa llegan a
todas). El destino tiene que existir en la misma organización; una sede de otra
empresa responde igual que una inexistente. Origen y destino deben ser distintos.

Un despacho que excede las existencias disponibles de la sede de origen responde
409 y no escribe nada: ni stock, ni movimiento, ni documento, ni número de
secuencia.

### Recibir y cancelar

```json
POST /api/transfers/:id/cancel
{ "reason": "La bodega no la recibe" }
```

Recibir exige acceso a la sede de destino; cancelar, a la de origen. El cajero de
la sede de destino puede recibir, pero no despachar ni cancelar: su sesión llega a
las tres rutas de lectura y recepción y la recepción solo prospera en una sede que
tenga asignada (en cualquier otra responde 404 y el documento sigue
`IN_TRANSIT`). Las dos operaciones toman la fila de la transferencia
(`SELECT … FOR NO KEY UPDATE`) antes de leer su estado, así que si dos pedidos
compiten —dos recepciones, o una recepción y una cancelación— uno gana y el otro
responde 409 sin efectos. La transacción es `Serializable`; una falla de
serialización de PostgreSQL se informa como el mismo 409, nunca se reintenta sola.

### Leer

`GET /api/transfers` devuelve `{ data, meta: { total, page, limit, totalPages } }`
y acepta `status` (`IN_TRANSIT`, `RECEIVED`, `CANCELLED`), `siteId` (solo
transferencias que salen o llegan a esa sede), `page` y `limit` (10 por defecto).

`ADMIN` ve todas las transferencias de la organización. Un cajero con sedes
asignadas solo ve las que tocan alguna de sus sedes; sin ninguna
asignación no ve ninguna. Un identificador de otra organización responde 404.

## 4. Errores

| Situación | Respuesta |
|---|---|
| Origen y destino iguales | 400 «La sede de origen y la de destino deben ser diferentes». |
| Producto de servicio o sin inventario | 400 «Solo se pueden transferir productos que manejan inventario». |
| Producto repetido en la transferencia | 400 «El producto … está repetido en la transferencia». |
| Falta `reason` al cancelar | 400 de validación (el campo es obligatorio, máximo 500 caracteres). |
| Sede de origen no autorizada o inexistente | 404. |
| Sede de destino fuera de la organización o inexistente | 404 «Sede de destino no encontrada». |
| Transferencia de otra organización o inexistente | 404 «Transferencia no encontrada». |
| Existencias insuficientes en la sede de origen | 409 «Existencias insuficientes en la sede de origen para el producto …». |
| Recibir o cancelar una transferencia que ya no está en tránsito | 409 «Solo se pueden recibir transferencias en tránsito» / «Solo se pueden cancelar transferencias en tránsito». |
| Dos operaciones compiten por el mismo documento | 409 «La operación compitió con otra transferencia; vuelva a intentarlo». |

## 5. Numeración

El número es consecutivo por organización desde `OrganizationSequence`
(`type = 'TRANSFER'`). Esa fila se abre sola en el primer despacho de la
organización; las secuencias de ventas y de órdenes de compra no se tocan. Si dos
despachos de la misma organización arrancan a la vez, uno espera a la fila y el
otro toma el número siguiente.

## 6. Límites de esta entrega

- La pantalla `/transfers` lista, despacha, recibe y cancela. Un administrador o
  miembro ve los botones de despacho y cancelación; un cajero ve la lista y el
  botón «Recibir» de su detalle. Es presentación: el servidor vuelve a decidir en
  cada ruta y en cada sede.
- La recepción automática de compras y el POS siguen trabajando con su propia
  sede explícita; una transferencia no reemplaza esos flujos.
- El stock en tránsito no se reserva para nadie: si la mercancía no llega, se
  cancela y vuelve al origen.
