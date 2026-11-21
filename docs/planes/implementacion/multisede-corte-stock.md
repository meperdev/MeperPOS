# Multisede: conservar el saldo al pasar a stock por sede

La primera entrega **crea una `Sede principal` por organización sin tocar las existencias**. El cambio de fuente de stock queda para otra entrega: hoy el POS y los otros módulos siguen leyendo y escribiendo `Product.stock`. No hay segunda sede habilitada ni transferencias.

## Entrega 1: sede inicial

- La migración crea una sede predeterminada para cada organización existente, incluidas las inactivas y las que no tienen productos. El alta normal de organizaciones y la creación de organizaciones en los seeds de demo y sandbox hacen lo mismo.
- La base impide dos sedes predeterminadas en la misma organización. Una sede pertenece a una sola organización y se elimina con ella. La respuesta del alta de organización no cambia.
- Para desplegar, pausar las altas de organizaciones y los seeds, y esperar a que terminen las altas en curso **antes** de aplicar la migración. Mantener cerrado el aprovisionamiento hasta que esté activa la versión nueva y se compruebe que todas las organizaciones tienen su sede predeterminada. Así el código anterior no puede crear una organización después del backfill. No hace falta detener las ventas para este primer corte, porque la migración no escribe en inventario.
- Durante el backfill y la transición no debe correr ningún proceso de aprovisionamiento de organizaciones con el código anterior, ni seeds ni altas por API: ese código crearía organizaciones sin sede. Aplicar la migración, activar la versión nueva y solo entonces reabrir el aprovisionamiento.
- La base de datos no crea sedes por su cuenta: la migración hace el backfill una sola vez y, después, cada alta de organización crea su sede en la aplicación. Un disparador que la creara en la base no sustituye ese paso y ocultaría un alta que no creó su sede, así que no forma parte de esta entrega.

## Acceso a sedes

- `GET /api/locations` lista las sedes de la organización activa: `OWNER`, `ADMIN` y `SUPER_ADMIN` con una organización seleccionada ven todas; los roles operativos ven solo las sedes asignadas a su membresía. `PUT /api/users/:id/locations` reemplaza el conjunto exacto de una membresía no administrativa.
- `GET /api/locations/pos-context` es la consulta de solo lectura del POS: devuelve `{ locations, checkoutLocationId }` con las sedes accesibles en el mismo orden que `GET /api/locations`. `checkoutLocationId` solo tiene valor cuando la organización tiene una única sede, esa sede es la principal y el usuario puede acceder a ella. Una sola sede asignada dentro de una organización con varias sedes no habilita el cobro con saldo global. La consulta no autoriza ventas, no cambia el stock y elegir una sede en el navegador no concede permisos.
- Esta ruta no agrega migraciones ni cambia el despliegue de acceso descrito aquí: el orden para pausar altas y escrituras de membresías antes de aplicar la migración de acceso sigue siendo el mismo. El POS continúa leyendo el stock global en este corte; operar una segunda tienda queda para una entrega posterior.
- La migración de acceso asigna la sede principal solo a las membresías operativas existentes cuando esa sede es la única de la organización. No crea asignaciones para `OWNER`/`ADMIN` ni al crear una sede nueva; cada sede adicional se asigna de forma explícita.
- Antes de aplicar esta migración, detener las altas de organizaciones y las escrituras de membresías y roles con el código anterior, incluidas las altas de usuarios o miembros por API y los seeds. Esperar a que terminen las operaciones en curso y mantener esas escrituras pausadas hasta que esté activa la versión nueva. Las ventas no necesitan pausarse. El reemplazo de asignaciones y el cambio de rol sobre la misma membresía se serializan: la operación que obtiene el bloqueo primero puede completar su escritura; el reemplazo responde `409` si pierde por un conflicto de concurrencia y no reintenta. La migración no cambia el stock ni la sede predeterminada.

## POS antes del corte de stock por sede

- **Orden de despliegue:** habilitar primero la API de contexto de sede y después el frontend del POS. Sin esa API, el frontend nuevo no puede verificar la sede y no habilita el cobro.
- **Cobrar:** el POS habilita el cobro solo en la sede principal accesible de una organización con una única sede. Vuelve a comprobar esa sede antes de enviar un cobro o iniciar una financiación. La validación no cambia el saldo global ni habilita el cobro en una segunda sede.
- **Cambiar de organización:** terminar, pausar o vaciar el carrito antes de cambiar. Mientras el cobro se está verificando o enviando, no se puede pausar el carrito ni cerrar el diálogo de pago. Si la sesión cambia de usuario u organización, el POS no envía la solicitud bajo la otra sesión.
- **Ventas pausadas:** se muestran solo para el usuario, la organización y la sede que las guardaron. Antes de habilitar este POS, terminar las ventas pausadas que queden en la versión anterior: los borradores sin sede quedan en el navegador, pero el POS nuevo no los muestra ni los reasigna.

## Entrega 2: almacenamiento de stock por sede, todavía vacío

La migración `20261119130000_product_stock_by_location` agrega `ProductStock`, uno por producto y sede, **sin cargar filas**. La base impide vincular productos y sedes de organizaciones distintas, y que las reservas queden negativas o superen el stock disponible; el stock negativo heredado se conserva tal cual. `Product.stock` y `Product.reservedStock` siguen siendo la única fuente de la aplicación: no hay lecturas ni escrituras operativas en la tabla nueva y esta entrega no habilita el cobro por sede. La clave compuesta `Location_id_organizationId_key` ya existe desde la migración de acceso; esta migración no la vuelve a crear.

Antes de aplicar la migración de `ProductStock`, pausar las escrituras de inventario y esperar a que terminen las transacciones en curso. PostgreSQL puede necesitar bloquear `Product` para agregar la clave foránea aunque no se copien saldos. La migración limita la espera a **5 segundos por bloqueo** (no el tiempo total de ejecución), sin ampliar un límite menor ya configurado. En `psql` sin modo silencioso, el bloque que aplica este límite agrega una línea `DO` a la salida normal del SQL directo; no indica un error. Si se agota la espera (SQLSTATE `55P03`), se revierte la transacción. Comprobar que no quedó la tabla nueva y que la clave única existente de `Location` sigue intacta, resolver la transacción que bloquea y recién ahí repetir el despliegue. Si Prisma registró la migración como fallida, el responsable del despliegue debe marcarla como revertida con `prisma migrate resolve --rolled-back 20261119130000_product_stock_by_location` antes de volver a ejecutar `prisma migrate deploy`; no marcarla como aplicada.

Para comprobar el esquema desde `backend/`, usar una **base nueva, desechable y sin conexiones de la aplicación**, con nombre `meperpos_stock_rehearsal_…`. En el caso de actualización, aplicar primero las migraciones existentes hasta `20261119120000_sale_request_key_hash`. El ejemplo carga datos ficticios, aplica el SQL aditivo y verifica las restricciones y los borrados en cascada. No usar esta base para desplegar después.

```bash
psql -X -v ON_ERROR_STOP=1 "$TEST_DATABASE_URL" \
  -f test/migrations/product-stock.fixture.sql \
  -f prisma/migrations/20261119130000_product_stock_by_location/migration.sql \
  -f test/migrations/product-stock.constraints.sql
```

Resultado esperado: las comprobaciones pasan, ningún saldo queda persistido en `ProductStock` y los saldos de `Product` y la reserva del POS quedan intactos. La comprobación incluye existencias positivas, cero, negativas e inactivas, una reserva del POS, rechazos de reservas inválidas y los borrados en cascada de producto, sede y organización. El ensayo y la reconciliación de saldos por sede llegan con la entrega siguiente: esta migración no copia saldos ni autoriza el corte operativo.

Para comprobar la espera por bloqueos, ejecutar desde `backend/` `TEST_DATABASE_URL="$TEST_DATABASE_URL" bash test/migrations/product-stock.lock-timeout.sh` en **otra** base desechable con el mismo esquema anterior a `ProductStock`. La prueba sostiene un bloqueo de escritura sobre `Product`, verifica que PostgreSQL cancele la migración sin dejar cambios parciales y que la clave única existente de `Location` quede intacta.

## Entrega futura: cambiar la fuente de stock

1. **Fijar la base de comparación.** Con una copia verificable y los escritores de inventario detenidos, tomar un registro por organización y producto del stock y sus reservas. Incluir productos con saldo cero e inactivos. El registro debe conservar la identidad del producto, no solo el total de la organización.
2. **Asignar cada saldo una sola vez.** Crear el saldo del producto en la sede inicial de su propia organización. Una clave única producto–ubicación y relaciones que respeten la organización deben impedir duplicados y asociaciones entre organizaciones. En el corte, el saldo y las reservas en la sede inicial tienen que coincidir con el registro de origen producto por producto; ninguna otra sede recibe una copia.
3. **Cambiar las operaciones juntas.** Validar que POS, compras, devoluciones, ajustes, reservas, importaciones y consultas usen el saldo por ubicación antes de reanudar las escrituras con el nuevo modelo. Usar una sola fuente activa; no mantener dos saldos editables. Reanudar solo si coinciden todos los saldos y las reservas. No borrar la columna anterior como parte de este corte. Una vez que haya operaciones nuevas, no volver al stock anterior sin reconciliar esas operaciones.
4. **Habilitar la segunda tienda.** Su saldo empieza en cero. Si parte del saldo global anterior corresponde físicamente a esa tienda, asignarlo a partir de un conteo y registrar el traspaso de saldo de apertura; no sumarlo por segunda vez. Si lo contado no coincide con el saldo anterior, documentar y autorizar el ajuste por separado.

**Criterio del piloto:** con 5 unidades en A y 3 en B, una venta de 2 en B deja A en 5 y B en 1, y la venta figura en B. Si B no tiene unidades suficientes, la venta se rechaza aunque A tenga stock.

## Verificación reproducible de la primera entrega

En una **base desechable** con todas las migraciones anteriores aplicadas y sin la nueva (nombre `meperpos_baseline` o prefijo `meperpos_location_`), ejecutar desde `backend/`:

```bash
psql -X -v ON_ERROR_STOP=1 "$TEST_DATABASE_URL" \
  -f test/migrations/initial-location.before.sql \
  -f prisma/migrations/20261118120000_initial_organization_location/migration.sql \
  -f test/migrations/initial-location.after.sql
```

La prueba incluye saldo positivo, cero, stock reservado, un producto inactivo y una organización sin productos. Compara inventario por fila, y prueba que se acepta una segunda sede no predeterminada, pero no una segunda sede predeterminada dentro de la misma organización. La prueba HTTP `admin.location-provisioning.int.spec.ts` verifica el alta y la eliminación de organizaciones en una base ya migrada.
