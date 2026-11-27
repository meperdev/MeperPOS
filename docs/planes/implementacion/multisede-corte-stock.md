# Multisede: conservar el saldo al pasar a stock por sede

La primera entrega **crea una `Sede principal` por organización sin tocar las existencias**. Las entregas siguientes agregan el saldo por sede, los permisos y el POS por sucursal, y terminan con el corte: `ProductStock` pasa a ser la fuente de verdad y `Product.stock`/`reservedStock` quedan como el agregado de la organización, mantenido por la base. Este documento conserva el ensayo previo de cada migración y describe el estado final, el orden de despliegue y la vuelta atrás.

## Entrega 1: sede inicial

- La migración crea una sede predeterminada para cada organización existente, incluidas las inactivas y las que no tienen productos. El alta normal de organizaciones y la creación de organizaciones en los seeds de demo y sandbox hacen lo mismo.
- La base impide dos sedes predeterminadas en la misma organización. Una sede pertenece a una sola organización y se elimina con ella. La respuesta del alta de organización no cambia.
- Para desplegar, pausar las altas de organizaciones y los seeds, y esperar a que terminen las altas en curso **antes** de aplicar la migración. Mantener cerrado el aprovisionamiento hasta que esté activa la versión nueva y se compruebe que todas las organizaciones tienen su sede predeterminada. Así el código anterior no puede crear una organización después del backfill. No hace falta detener las ventas para este primer corte, porque la migración no escribe en inventario.
- Durante el backfill y la transición no debe correr ningún proceso de aprovisionamiento de organizaciones con el código anterior, ni seeds ni altas por API: ese código crearía organizaciones sin sede. Aplicar la migración, activar la versión nueva y solo entonces reabrir el aprovisionamiento.
- La base de datos no crea sedes por su cuenta: la migración hace el backfill una sola vez y, después, cada alta de organización crea su sede en la aplicación. Un disparador que la creara en la base no sustituye ese paso y ocultaría un alta que no creó su sede, así que no forma parte de esta entrega.

## Acceso a sedes

- `GET /api/locations` lista las sedes de la organización activa: `OWNER`, `ADMIN` y `SUPER_ADMIN` con una organización seleccionada ven todas; los roles operativos ven solo las sedes asignadas a su membresía. `PUT /api/users/:id/locations` reemplaza el conjunto exacto de una membresía no administrativa.
- `GET /api/locations/pos-context` es la consulta de solo lectura del POS: devuelve `{ locations, checkoutLocationId }` con las **sucursales** accesibles en el mismo orden que `GET /api/locations` (una bodega nunca se ofrece como caja). `checkoutLocationId` es la sede principal cuando el usuario puede acceder a ella y es una sucursal; si no, la única sucursal accesible; si hay varias sucursales alcanzables y ninguna principal, es `null` y el cajero elige en el POS. La consulta no autoriza ventas, no cambia el stock y elegir una sede en el navegador no concede permisos: la venta vuelve a autorizar la sede indicada.
- Esta ruta no agrega migraciones ni cambia el despliegue de acceso descrito aquí: el orden para pausar altas y escrituras de membresías antes de aplicar la migración de acceso sigue siendo el mismo. Con el corte de stock, el POS cobra en una sucursal accesible y el saldo que descuenta es el de esa sede.
- La migración de acceso asigna la sede principal solo a las membresías operativas existentes cuando esa sede es la única de la organización. No crea asignaciones para `OWNER`/`ADMIN` ni al crear una sede nueva; cada sede adicional se asigna de forma explícita.
- `20261125160000_membership_principal_grant` mantiene esa línea base en el tiempo: un disparador sobre `OrganizationUser` asigna la sede principal al crear una membresía `CASHIER`, `MEMBER` o `INVENTORY_USER`, y también cuando una membresía `OWNER`/`ADMIN` sin ninguna asignación baja a uno de esos roles; el backfill de la misma migración se la da a las membresías operativas que ya existían sin asignaciones. No crea filas para `OWNER`/`ADMIN`, no toca a quien ya tiene alguna asignación, nunca asigna una segunda sede y no reacciona a la creación de una sede; si la organización todavía no tiene sede principal, el alta no falla y no asigna nada. Se aplica en la misma ventana de pausa de altas y escrituras de membresías que la migración de acceso, y no cambia el stock ni la sede predeterminada.
- Antes de aplicar esta migración, detener las altas de organizaciones y las escrituras de membresías y roles con el código anterior, incluidas las altas de usuarios o miembros por API y los seeds. Esperar a que terminen las operaciones en curso y mantener esas escrituras pausadas hasta que esté activa la versión nueva. Las ventas no necesitan pausarse. El reemplazo de asignaciones y el cambio de rol sobre la misma membresía se serializan: la operación que obtiene el bloqueo primero puede completar su escritura; el reemplazo responde `409` si pierde por un conflicto de concurrencia y no reintenta. La migración no cambia el stock ni la sede predeterminada.

## POS por sucursal

- **Orden de despliegue:** habilitar primero la API de contexto de sede y después el frontend del POS. Sin esa API, el frontend nuevo no puede verificar la sede y no habilita el cobro.
- **Cobrar:** el POS cobra en una sucursal accesible. Si el contexto nombra una (`checkoutLocationId`), el POS la usa; si no, el cajero elige entre las sucursales listadas. Antes de enviar un cobro o iniciar una financiación vuelve a comprobar que esa sucursal sigue accesible, y envía su `locationId` en la venta y en la financiación: el saldo que se descuenta es el de esa sede. Una bodega no se ofrece y, si se envía igual, la API responde `400`.
- **Cambiar de organización o de sede:** terminar, pausar o vaciar el carrito antes de cambiar. Mientras el cobro se está verificando o enviando, no se puede pausar el carrito ni cerrar el diálogo de pago. Si la sesión cambia de usuario u organización, el POS no envía la solicitud bajo la otra sesión. El carrito, sus borradores pausados y sus solicitudes pertenecen a la sede activa: cambiar de sede monta otro espacio de trabajo y no arrastra el carrito.
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

### Ventas directas

`POST /api/sales` admite `locationId` opcional. Si se envía, debe ser un texto no vacío; un número o `null` devuelve `400`. El servidor comprueba el permiso vigente en la misma transacción y acepta la venta cuando la sede es una **sucursal** a la que el usuario tiene acceso: cualquiera de las sucursales de la organización, no solo la principal. Una bodega responde `400`; una sede ajena o sin asignación responde `404`. Guarda la sede de origen junto con la venta y el movimiento, y descuenta el saldo de esa sede. Sin `locationId` la venta se descuenta en la sede principal, pero solo si el usuario tiene acceso a ella: se aplica la misma comprobación de permiso que con una sede explícita y, si no la tiene, responde `404`. En ese caso la sede de origen no se guarda, como antes.

Un reintento con el mismo contenido y clave devuelve la venta original. Si el reintento indica una sede, tiene que coincidir con la ya registrada: otra sede o una venta anterior sin sede devuelve `409` sin duplicar la venta ni cambiar el saldo. Una anulación de una venta atribuida registra la devolución en su sede original y comprueba los permisos vigentes, sin volver a exigir que sea la única. La respuesta de venta conserva sus campos anteriores.

### Financiación POS

`POST /api/loans/pos-initiation` acepta `locationId` opcional con las mismas reglas que una venta directa: sucursal accesible, `400` para una bodega y `404` para una sede ajena. Si se envía, la reserva guarda su origen sin cambiar la cotización ni el JSON del reintento. Un reintento con sede distinta, o que agrega una sede a una financiación histórica sin atribución, devuelve `409` sin crear otra reserva. Omitir la sede reserva en la sede principal con la misma comprobación de permiso: un usuario sin acceso a la sede principal recibe `404`.

Cobrar o reversar un abono no mueve inventario. Completar la venta financiada consume la reserva y registra la sede guardada en la venta y su movimiento. Cancelar libera la reserva de esa sede, sin crear un movimiento. En esas dos operaciones se valida el permiso vigente sobre la sede de origen, sin exigir que siga siendo la única.

### Recepción de compras

Cada llamada a `POST /api/purchase-orders/:id/receive` puede indicar un `locationId` de destino para la entrega actual. Si se envía, el servidor verifica el permiso vigente y lo acepta sin importar el tipo de sede: una bodega es un destino válido. El mismo destino queda en los movimientos de los productos con control de stock, no en la orden ni en el PDF del proveedor. Omitir `locationId` recibe en la sede principal con la misma comprobación de permiso; un usuario sin acceso a ella recibe `404`. Una entrega parcial no fija el destino de entregas futuras.

### Transferencias entre sedes

`POST /api/transfers` despacha desde una sede autorizada y `POST /api/transfers/:id/receive` acredita la sede de destino, ambas de la organización activa. Despachar descuenta el saldo de la sede de origen y recibir lo acredita en la de destino, con un movimiento de inventario en cada lado; ninguna de las dos toca el saldo de otra sede. En la primera versión, despachar autoriza solo la sede de origen y el destino debe existir en la organización.

## Saldo por sede: la fuente de verdad

La migración `20261125120000_product_stock_authority` deja `ProductStock` con una fila por producto en la sede predeterminada de su organización y agrega los disparadores que mantienen `Product.stock` y `Product.reservedStock` como el agregado de la organización. Con `20261125150000_product_stock_guard`, la base además rechaza cualquier escritura directa a esos dos campos: solo las filas de sede mueven el agregado. Todos los escritores de la aplicación (ventas, anulaciones, financiación POS, recepción de compras, préstamos de inventario, edición de productos, importaciones, seeds, backfill y transferencias) escriben la fila de la sede a través del helper `applySiteStockDelta`.

**Qué carga.** Cada producto existente recibe una fila con su stock y sus reservas actuales en la sede predeterminada de su propia organización. Un producto con saldo cero, inactivo, de tipo servicio o con stock negativo heredado se copia tal cual: la migración no normaliza valores. Las organizaciones sin productos no generan filas.

**Cómo se mantiene el agregado.** Un disparador sobre `ProductStock` aplica a `Product` el delta de cada alta, cambio o baja de una fila de sede, con aritmética (`stock + delta`) y no recalculando una suma, de modo que dos sedes que cambian a la vez no se pisan. Al terminar cada sentencia se cumple `Product.stock = SUM(ProductStock.stock)` y lo mismo para las reservas. Un alta de producto abre su fila en la sede predeterminada con los saldos que esa alta ya escribió, sin sumarlos dos veces, así que el alta de productos, las importaciones, los seeds y el backfill siguen funcionando sin cambios. En producción toda organización ya tiene su sede principal desde `20261118120000_initial_organization_location`; el camino que crea una `Sede principal` cuando falta sirve solo para altas directas en la base o en los seeds de prueba, y existe para que ningún producto quede sin saldo por sede.

**Cuándo falla.** La migración se revierte completa, con un mensaje determinista, si `ProductStock` no está vacía, si un producto pertenece a una organización sin sede predeterminada, o si un saldo no cumple el mismo límite de reservas que `Product` (`reservedStock >= 0` y `reservedStock <= stock` cuando el stock no es negativo). Nunca reescribe ni normaliza stock o reservas: esos casos se corrigen en los datos antes de desplegar. Aplicar con las escrituras de inventario pausadas y las transacciones en curso terminadas: la migración bloquea `Product` en modo `SHARE ROW EXCLUSIVE` y `Location` en `SHARE`, con un máximo de 5 segundos de espera por bloqueo o el límite positivo menor ya configurado. Si se agota la espera (SQLSTATE `55P03`), se revierte y el despliegue se repite después de resolver la transacción que bloquea.

**Antes de desplegar.** El ensayo de solo lectura de este documento tiene que pasar **antes** de aplicar esta migración: comprueba que el saldo y las reservas se pueden traspasar a la sede inicial y exige `ProductStock` vacía, así que después de esta migración falla por diseño y deja de ser la comprobación previa. Si el ensayo falla o no se ejecutó, no desplegar.

**Cómo comprobarlo.** En una base desechable `meperpos_stock_rehearsal_…` con todas las migraciones anteriores aplicadas, desplegar y ejecutar la prueba desde `backend/`:

```bash
DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy
```

```bash
T3A_TEST_DATABASE_URL="$TEST_DATABASE_URL" \
  npx jest --runInBand src/inventory
```

La prueba de PostgreSQL cubre la fila de la sede inicial, el agregado después de altas, cambios y bajas en dos sedes, el rechazo de un retiro mayor que el disponible, el alta de una fila de sede faltante, el aislamiento entre organizaciones y dos bajas concurrentes. También comprueba que un alta de producto no duplica el saldo y que el borrado de un producto no deja filas de sede. Los casos de falla de la migración se comprueban en una copia previa a la migración, aplicando `psql -X -w -v ON_ERROR_STOP=1 -f prisma/migrations/20261125120000_product_stock_authority/migration.sql`: cada uno debe terminar con código de salida 3, el mensaje correspondiente y la reversión completa (sin filas en `ProductStock` y sin los disparadores).

**El cerrojo final.** `20261125150000_product_stock_guard` agrega un disparador `BEFORE UPDATE` sobre `Product`: si `stock` o `reservedStock` cambian y la escritura no viene del delta de una fila de sede, la base la rechaza con SQLSTATE `23514` y un mensaje que nombra los saldos por sede. Las demás columnas del producto (nombre, precios, `version`, estado) se siguen editando normalmente, y las altas siguen permitidas porque abren la fila de la sede principal. El reconocimiento se hace con `pg_trigger_depth()`: el delta de sede corre a un nivel de disparador y su `UPDATE` sobre `Product` llega al segundo; una sentencia de la aplicación llega al primero. No se usa una marca de sesión porque cualquier cliente podría activarla, mientras que llegar al segundo nivel exige que exista otro disparador.

Comprobación del cerrojo en una base desechable `meperpos_stock_rehearsal_…` con todas las migraciones aplicadas, desde `backend/`:

```bash
T3G_TEST_DATABASE_URL="$TEST_DATABASE_URL" \
  npx jest --runInBand src/inventory/product-stock-guard.postgres.spec.ts
```

Debe pasar completa. Contra una copia **previa** a `20261125150000_product_stock_guard` la escritura directa se acepta y las comprobaciones de rechazo fallan: eso es el resultado esperado antes de aplicar la migración, no un defecto. La migración toma `Product` en `SHARE ROW EXCLUSIVE` antes de crear el disparador, con el mismo límite de 5 segundos por bloqueo.

## Ensayo de actualización antes de desplegar

El corte completo se puede ensayar sobre una base desechable, sin tocar datos reales. El script `backend/test/migrations/multisedes-upgrade.rehearse.sh` despliega la cadena de migraciones anterior al feature extraída de `origin/master`, inserta datos heredados (dos organizaciones, productos con saldo y reservas —incluido cero, un servicio, uno inactivo y un saldo negativo—, una membresía por rol y un préstamo de inventario abierto con su reserva), guarda un checksum de `Product(id, stock, reservedStock)` y de las membresías, aplica la cadena de la rama y verifica que el saldo no cambió y que la migración no amplió permisos: una fila de `ProductStock` en la sede principal por producto, igual a `Product`; exactamente la sede principal asignada a cada membresía operativa y ninguna a dueños ni administradores; todas las sedes creadas como sucursal; y todas las migraciones terminadas.

```bash
createdb -h 127.0.0.1 -p 55440 -U postgres meperpos_stock_rehearsal_release_upgrade
backend/test/migrations/multisedes-upgrade.rehearse.sh \
  'postgresql://postgres@127.0.0.1:55440/meperpos_stock_rehearsal_release_upgrade?schema=public'
```

El script se niega a correr contra cualquier base cuyo nombre no empiece con `meperpos_stock_rehearsal_release` o que escuche en el puerto 5432, exige `?schema=public` y pide una base vacía: cada corrida necesita una base nueva. Termina con código distinto de cero y con el diff de los productos afectados si un saldo o una asignación cambió; el directorio temporal con la cadena base extraída queda como evidencia. Si falla, no desplegar.

**El ensayo tiene que partir del estado real de producción, no de `master`.** El primer despliegue (27-nov) se cayó justamente por eso: el ensayo partía de `origin/master`, y producción tenía además una línea de sedes abandonada que `master` no conoce (ver la sección siguiente). Para producción hoy, correrlo así:

```bash
createdb -h 127.0.0.1 -p 55440 -U postgres meperpos_stock_rehearsal_release_prod
BASELINE_REF=257218d PRODUCTION_LINEAGE=1 backend/test/migrations/multisedes-upgrade.rehearse.sh \
  'postgresql://postgres@127.0.0.1:55440/meperpos_stock_rehearsal_release_prod?schema=public'
```

`PRODUCTION_LINEAGE=1` reproduce, sobre la cadena de `257218d` (la versión que corre en producción), las dos migraciones abandonadas tal como quedaron aplicadas allá (`backend/test/migrations/fixtures/abandoned-location-lineage/`, mismos checksums) y los dos intentos revertidos del 27-nov, y además verifica que la limpieza retiró todos sus objetos.

## Producción con la línea de sedes abandonada (incidente 2026-11-27)

**Qué hay en producción.** El 22-nov se aplicaron a producción, con un `prisma migrate deploy` local, dos migraciones de una rama que nunca se mergeó: `20261120120000_add_location_foundation` y `20261120130000_add_location_assignments`. Crearon `Location`, `LocationType`, `LocationAssignment`, los triggers `Organization_default_location` y `OrganizationUser_principal_location_assignment`, sus dos funciones y los índices `Location_id_organizationId_key` y `OrganizationUser_id_organizationId_key`. Ningún código liberado los usó: su contenido lo generaron solo sus triggers. El 27-nov, el deploy de #402 intentó crear `Location` otra vez, falló (`applied_steps 0`, sin cambios de datos), el contenedor no arrancó y se volvió a la versión de #404 marcando los dos intentos con `prisma migrate resolve --rolled-back`.

**Qué lo resuelve.** `20261118115900_retire_abandoned_location_lineage` corre antes de la cadena de sedes. Solo actúa si la línea abandonada está aplicada y la cadena de sedes no; en cualquier otra base (nueva, CI, desarrollo, ya migrada) no hace nada. Antes de borrar verifica que solo haya lo que generaron los triggers viejos (una «Sede principal» tipo sucursal por organización y asignaciones a esa sede, sin claves foráneas de otras tablas); si encuentra otra cosa, aborta con un mensaje explícito y no borra nada.

**Despliegue en producción, en este orden:**

1. Pausar el auto-deploy de `master` en Railway (servicio `meperpos-api` → Settings → Source), si no está pausado.
2. Precheck de solo lectura, desde `backend/` con el servicio de producción enlazado (`railway link`):
   ```bash
   railway run bash -lc 'psql "${DATABASE_URL%%\?*}" -X -v ON_ERROR_STOP=1 -f test/migrations/multisedes-prod-precheck.sql'
   ```
   Cada bloque dice el valor esperado: 0 migraciones fallidas sin resolver, línea abandonada aplicada y cadena de sedes no, 0 sedes o asignaciones inesperadas, 0 claves foráneas extra, 0 productos que el corte rechazaría. Anotar el checksum de productos del bloque 7. Si algo no coincide, no desplegar.
3. Ventana sin ventas: POS pausado y nadie operando inventario.
4. Mergear el PR de la limpieza a `master` y, en Railway, desplegar a mano el último commit de `master`. En los logs del deploy tienen que aparecer 13 migraciones aplicadas (la limpieza y las 12 de sedes) y después el arranque de Nest.
5. Comprobar: `railway run npx prisma migrate status` sin pendientes ni fallidas (puede seguir avisando de las dos migraciones abandonadas registradas en la base: es esperado); `curl https://meperpos-api.up.railway.app/api/health`; volver a correr el bloque 7 del precheck y comparar el checksum de productos, que tiene que ser idéntico; y las comprobaciones de «Corte final».
6. En Vercel, promover a producción el deploy del último commit de `master` (tras el rollback del 27-nov, Vercel no promueve solo).
7. Reactivar el auto-deploy de `master` en Railway.

**Si el deploy falla.** Leer el error en los logs: cada migración es atómica, así que la que falla no deja cambios. Si falló la limpieza o cualquier migración **anterior** a `20261125150000_product_stock_guard`, marcarla con `prisma migrate resolve --rolled-back <nombre>` y volver a la versión de #404 en Railway y Vercel: esa versión sigue funcionando con las migraciones previas aplicadas. Si falló una migración **posterior** al cerrojo, no volver atrás (la versión de #404 escribe `Product.stock` directo y el cerrojo lo rechazaría): corregir la migración y desplegar hacia adelante.

## Corte final: estado, despliegue y vuelta atrás

**Estado final.** `ProductStock` es la fuente de verdad y `Product.stock`/`reservedStock` son su agregado de organización, mantenido por disparadores y protegido por el cerrojo. Ya no existe ninguna compuerta de "única sede principal": una venta o una financiación se acepta en cualquier sucursal autorizada, una recepción o una transferencia en cualquier sede autorizada, y `checkoutLocationId` solo sugiere una sucursal. Los reportes, exportaciones y alertas siguen leyendo `Product`, es decir el total de la organización; el detalle por sede en reportes no forma parte de esta entrega.

**Antes de desplegar.** Todo en una sola ventana:

1. Pausar las escrituras de inventario (ventas, financiación POS, recepción de compras, transferencias, préstamos, edición de productos, importaciones y backfill) y las altas de organizaciones, usuarios y membresías. Esperar a que terminen las transacciones en curso.
2. Correr el ensayo de solo lectura de este documento sobre una copia verificable, **antes** de aplicar `20261125120000_product_stock_authority`: exige `ProductStock` vacía y comprueba producto por producto que el saldo y las reservas se pueden traspasar. Si falla, no hay corte. Antes de eso, correr el ensayo de actualización de «Ensayo de actualización antes de desplegar»: es el que prueba la cadena completa de la rama sobre una base anterior, sin mover saldos ni ampliar accesos.
3. Comprobar el precheck de nombres de sede repetidos **antes** de `20261125130000_location_type`: esa migración crea el índice único `(organizationId, lower(name))`, así que dos sedes de la misma organización que solo difieran en mayúsculas o espacios lo hacen fallar. Detectarlas y renombrarlas antes de desplegar:
   ```sql
   SELECT "organizationId", lower(btrim("name")) AS repeated, array_agg("id") AS ids
   FROM "Location" GROUP BY 1, 2 HAVING count(*) > 1;
   ```
4. Aplicar **todas** las migraciones de la entrega juntas, con `prisma migrate deploy`. Están ordenadas por marca de tiempo y no se aplican por separado: `20261125120000_product_stock_authority`, `20261125130000_location_type`, `20261125140000_stock_transfers`, `20261125150000_product_stock_guard`, `20261125160000_membership_principal_grant`, `20261125170000_default_site_trigger_any_conflict` y `20261125180000_location_contact` (además de las de sedes, accesos y atribución de fechas `20261118…`–`20261123…` que traiga la misma entrega). El cerrojo va al final a propósito; aplicarlo antes del último escritor rompería las escrituras que todavía pasaban por `Product`.
5. Activar la versión nueva del backend y después la del frontend.
6. Comprobar las asignaciones: `20261125160000_membership_principal_grant` da la sede principal a cada usuario operativo que no tenía ninguna, y a los que se creen después. Las sedes adicionales las asigna un administrador (`PUT /api/users/:id/locations` o la pantalla de equipo); el cobro, con o sin `locationId`, se autoriza contra esa asignación. Recién entonces reabrir las escrituras y las altas.

**Comprobaciones después del despliegue.** Con la aplicación ya en la versión nueva: iniciar sesión como dueño, abrir el POS y verificar que lista las sucursales; cobrar una venta en una sucursal distinta de la principal y comprobar que se descuenta esa sede y no la principal (`SELECT * FROM "ProductStock" WHERE "productId" = …`); recibir una compra en una bodega; despachar y recibir una transferencia entre dos sedes; y confirmar que `SELECT p."stock" - coalesce(sum(s."stock"), 0) FROM "Product" p LEFT JOIN "ProductStock" s ON s."productId" = p."id" GROUP BY p."id"` devuelve solo ceros. En los reportes, el total de la organización no debe cambiar por una transferencia.

**Vuelta atrás.** Si hay que volver a la versión anterior de la aplicación después del corte, hacerlo con las escrituras pausadas y **sin** revertir el esquema: el código anterior escribiría `Product.stock` directamente y el cerrojo lo rechazaría. Para volver al modelo de saldo global hay que, en una ventana con escrituras detenidas, reconciliar el agregado con las filas de sede (`UPDATE "Product" FROM (suma por producto)`), quitar el disparador del cerrojo y recién después reactivar la versión anterior. Las operaciones hechas en sedes distintas de la principal no se pueden deshacer por sí solas: sus movimientos de inventario quedan registrados con su sede y su saldo debe sumarse a mano al total si se vuelve a un único libro. Nunca borrar `ProductStock` para "volver atrás": es el único registro de dónde está cada unidad.

**Saldo de apertura de una sede nueva.** Una sede nueva empieza en cero. Si parte del saldo anterior corresponde físicamente a esa sede, pasarlo con una transferencia desde la principal (o con un ajuste autorizado), nunca sumándolo dos veces. Si lo contado no coincide con el saldo anterior, documentar y autorizar el ajuste por separado.

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
