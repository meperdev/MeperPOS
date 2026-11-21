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
