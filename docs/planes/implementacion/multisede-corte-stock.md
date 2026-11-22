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

Resultado esperado: las comprobaciones pasan, ningún saldo queda persistido en `ProductStock` y los saldos de `Product` y la reserva del POS quedan intactos. La comprobación incluye existencias positivas, cero, negativas e inactivas, una reserva del POS, rechazos de reservas inválidas y los borrados en cascada de producto, sede y organización. El ensayo y la reconciliación de saldos por sede se describen en la sección siguiente: esta migración no copia saldos ni autoriza el corte operativo.

Para comprobar la espera por bloqueos, ejecutar desde `backend/` `TEST_DATABASE_URL="$TEST_DATABASE_URL" bash test/migrations/product-stock.lock-timeout.sh` en **otra** base desechable con el mismo esquema anterior a `ProductStock`. La prueba sostiene un bloqueo de escritura sobre `Product`, verifica que PostgreSQL cancele la migración sin dejar cambios parciales y que la clave única existente de `Location` quede intacta.

## Ensayo de solo lectura antes del corte

`test/migrations/product-stock.reconcile.sql` comprueba si el saldo y las reservas actuales se pueden traspasar a la sede inicial de cada producto. Es un ensayo **de solo lectura**: corre en una sola transacción `REPEATABLE READ READ ONLY`, no hace DML ni DDL, no crea objetos temporales, no toma bloqueos de fila y termina con `ROLLBACK`. Si un llamador ya abrió la transacción, el ensayo impone esas características él mismo y, cuando no puede, falla cerrado antes de comprobar nada.

Usar una base **nueva, desechable y sin conexiones de la aplicación**, con el prefijo `meperpos_stock_rehearsal_` y todas las migraciones aplicadas, incluida `20261119130000_product_stock_by_location`. Cargar el fixture propio del ensayo, que es legal y consistente. El fixture de la entrega 2 conserva su inconsistencia deliberada y no sirve para este ensayo.

La conexión va por variables de entorno de libpq, sin URL ni contraseña en los argumentos. Desde `backend/`:

```bash
PGHOST=127.0.0.1 PGPORT=32768 PGUSER=postgres \
PGDATABASE=meperpos_stock_rehearsal_t9_… \
  psql -X -v ON_ERROR_STOP=1 -f test/migrations/product-stock.reconcile-fixture.sql
```

```bash
PGHOST=127.0.0.1 PGPORT=32768 PGUSER=postgres \
PGDATABASE=meperpos_stock_rehearsal_t9_… \
  psql -X -v ON_ERROR_STOP=1 -At -f test/migrations/product-stock.reconcile.sql
```

Resultado esperado: salida `BEGIN`, `DO`, una cuenta de productos y `ROLLBACK`, con código de salida 0. La cuenta es lo único que se imprime: el ensayo no publica saldos ni queda expuesto a la aplicación.

**Qué reconstruye.** Las reservas esperadas por organización y producto se derivan de los escritores reales, nunca de `InventoryMovement`: las cantidades pendientes de los ítems de préstamos de inventario en estado `OPEN` (`quantity - deliveredQuantity - cancelledQuantity`, es decir lo no entregado y no cancelado, no lo devuelto) más las reservas del POS en estado `HELD`. Los préstamos terminales (`CLOSED`, `CANCELLED`) y las reservas del POS ya finalizadas no reservan. Un producto inelegible —inactivo, que no es físico o que no controla inventario— debe tener reserva cero. La proyección incluye todos los productos, también los de saldo cero, los inactivos y los que no controlan inventario. Las organizaciones sin productos no aportan filas al resultado.

**Cuándo falla.** Con código de salida 3 y un error determinista. Si el llamador ya abrió una transacción, PostgreSQL también puede avisar que hay una transacción en curso. Las reglas son: base fuera del prefijo `meperpos_stock_rehearsal_`; transacción distinta de `REPEATABLE READ` o de solo lectura; `ProductStock` ausente o con filas; producto sin sede predeterminada en su propia organización; stock negativo; reservas negativas o mayores que el stock; producto inelegible con reservas; préstamo terminal con cantidades pendientes; reserva del POS retenida sobre una financiación cerrada o cancelada; y reserva almacenada distinta del libro reconstruido **producto por producto**, no por total de la organización. Dos errores que se compensan dentro de una organización también fallan.

**Casos que la base ya impide.** `Product_reservedStock_bounds_check` rechaza una reserva negativa o mayor que un stock no negativo, y `Product_reservedStock_eligibility_check` rechaza reservas en productos inelegibles. El ensayo también verifica esos límites en datos heredados; la prueba confirma que el esquema actual rechaza nuevas escrituras de ese tipo, sin desactivar restricciones. El stock negativo sí es un estado heredado posible —la restricción lo tolera para no bloquear filas viejas— y el ensayo lo rechaza incluso cuando los contadores de reserva coinciden con el libro.

**Prueba de las reglas.** Desde `backend/`, con la misma base desechable y los mismos valores de libpq. Para esta prueba, el nombre de la base debe empezar con `meperpos_stock_rehearsal_t9_`:

```bash
PGHOST=127.0.0.1 PGPORT=32768 PGUSER=postgres \
PGDATABASE=meperpos_stock_rehearsal_t9_… \
  bash test/migrations/product-stock.reconcile-failures.sh
```

El script inyecta cada falla en la base desechable, verifica el código de salida 3 y la salida y el error esperados, y comprueba que el origen, los dos libros de reservas y la tabla destino quedan sin cambios. Puede repetirse: restaura el fixture después de cada caso. Resultado esperado: `21 passed, 0 failed` y código de salida 0.

**Alcance.** Aprobar este ensayo prueba que el saldo se puede traspasar; **no autoriza el corte**. El corte real sigue siendo un cambio atómico, con los escritores de inventario detenidos y autorizados, según la sección siguiente. Ninguna sede adicional recibe saldo y `Product.stock` sigue siendo la única fuente de la aplicación.

## Atribución en el historial de inventario

La migración `20261122120000_inventory_movement_location` permite guardar la sede de un movimiento, pero todavía no cambia cómo lo registra la aplicación. Los movimientos existentes quedan sin sede: el saldo global anterior no permite deducir dónde ocurrió cada movimiento. Si un movimiento tiene sede, la base exige que pertenezca a la misma organización e impide borrar la sede por separado mientras haya movimientos que la referencien. Los saldos y las reservas se mantienen en `Product`. El historial JSON de `GET /api/exports/inventory` sigue mostrando los mismos campos de la organización; no expone la sede.

Aplicar como cambio de esquema separado. Antes de aplicarlo, detener las escrituras de inventario y esperar a que terminen las transacciones en curso: PostgreSQL bloquea el historial para agregar la columna y validar la referencia. El límite de espera es de 5 segundos por bloqueo, o el límite positivo menor ya configurado; no limita la duración de la validación.

Para verificar una actualización, preparar una base desechable `meperpos_stock_rehearsal_t14_…` con las migraciones hasta `ProductStock`, cargar `test/migrations/product-stock.fixture.sql` y crear un movimiento previo al cambio:

```sql
INSERT INTO "InventoryMovement"
    (id, "productId", type, quantity, "previousStock", "newStock", reason, "userId", "organizationId")
VALUES ('t14-legacy', 'stock-a1', 'ADJUSTMENT_IN', 5, 0, 5, 'Legacy movement without a site', 'stock-user', 'stock-a');
```

Después de aplicar la migración nueva, ejecutar `psql -X -w -v ON_ERROR_STOP=1 -f test/migrations/inventory-movement-location.constraints.sql` desde `backend/`, con las variables de conexión explícitas de la base desechable. Debe terminar en `ROLLBACK` con código 0: verifica que el movimiento anterior conserve sus datos sin sede, que se rechace una sede ajena y que el borrado de la organización siga eliminando su historial.

## Sede de origen de una venta o financiación POS

`20261123120000_sale_origin_site` agrega dos tablas vacías. Cada tabla permite una sola sede de origen por operación, de la misma organización. No cambia `Sale` ni `PosLoanSaleIntent`, no completa datos históricos y no agrega campos a las respuestas, las cotizaciones ni los resultados de un reintento. La migración por sí sola no escribe atribuciones ni mueve saldos por sede.

Borrar una sede que conserve una atribución se rechaza; si una operación se elimina de acuerdo con las reglas actuales, su atribución se elimina con ella. La migración necesita bloqueos breves sobre las tablas referenciadas: aplicar con las escrituras de ventas y financiación pausadas y las transacciones en curso terminadas, con un máximo de 5 segundos de espera por bloqueo o el límite positivo menor ya configurado.

Para verificarla desde `backend/`, usar una base desechable `meperpos_stock_rehearsal_t16_…` con las migraciones aplicadas y el fixture `test/migrations/product-stock.fixture.sql`. Ejecutar `psql -X -w -v ON_ERROR_STOP=1 -f test/migrations/sale-origin-site.constraints.sql` con la conexión explícita a esa base. Debe terminar en `ROLLBACK` con código 0.

### Ventas directas antes del corte

`POST /api/sales` admite `locationId` opcional. Si se envía, debe ser un texto no vacío; un número o `null` devuelve `400`. El servidor comprueba el permiso vigente en la misma transacción y acepta la venta solo cuando esa sede es la única sede de la organización y es la principal. Guarda la sede de origen junto con la venta y el movimiento. Sin `locationId` se mantiene el comportamiento anterior; no se atribuye una sede por defecto. El saldo descontado sigue siendo `Product.stock`.

Un reintento con el mismo contenido y clave devuelve la venta original. Si el reintento indica una sede, tiene que coincidir con la ya registrada: otra sede o una venta anterior sin sede devuelve `409` sin duplicar la venta ni cambiar el saldo. Una anulación de una venta atribuida registra la devolución en su sede original y comprueba los permisos vigentes, sin volver a exigir que sea la única sede. La respuesta de venta conserva sus campos anteriores.

## Entrega futura: cambiar la fuente de stock

1. **Fijar la base de comparación.** Con una copia verificable y los escritores de inventario detenidos, tomar un registro por organización y producto del stock y sus reservas. Incluir productos con saldo cero e inactivos. El registro debe conservar la identidad del producto, no solo el total de la organización.
2. **Asignar cada saldo una sola vez.** Crear el saldo del producto en la sede inicial de su propia organización. Una clave única producto–ubicación y relaciones que respeten la organización deben impedir duplicados y asociaciones entre organizaciones. En el corte, el saldo y las reservas en la sede inicial tienen que coincidir con el registro de origen producto por producto; ninguna otra sede recibe una copia. El ensayo de solo lectura del apartado anterior es la comprobación previa de esta condición: si falla, no hay corte.
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
