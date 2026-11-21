# Multisede: conservar el saldo al pasar a stock por sede

La primera entrega **crea una `Sede principal` por organización sin tocar las existencias**. El cambio de fuente de stock queda para otra entrega: hoy el POS y los otros módulos siguen leyendo y escribiendo `Product.stock`. No hay segunda sede habilitada ni transferencias.

## Entrega 1: sede inicial

- La migración crea una sede predeterminada para cada organización existente, incluidas las inactivas y las que no tienen productos. El alta normal de organizaciones y la creación de organizaciones en los seeds de demo y sandbox hacen lo mismo.
- La base impide dos sedes predeterminadas en la misma organización. Una sede pertenece a una sola organización y se elimina con ella. No se expone una API de sedes y la respuesta del alta de organización no cambia.
- Para desplegar, pausar las altas de organizaciones y los seeds, y esperar a que terminen las altas en curso **antes** de aplicar la migración. Mantener cerrado el aprovisionamiento hasta que esté activa la versión nueva y se compruebe que todas las organizaciones tienen su sede predeterminada. Así el código anterior no puede crear una organización después del backfill. No hace falta detener las ventas para este primer corte, porque la migración no escribe en inventario.
- Durante el backfill y la transición no debe correr ningún proceso de aprovisionamiento de organizaciones con el código anterior, ni seeds ni altas por API: ese código crearía organizaciones sin sede. Aplicar la migración, activar la versión nueva y solo entonces reabrir el aprovisionamiento.
- La base de datos no crea sedes por su cuenta: la migración hace el backfill una sola vez y, después, cada alta de organización crea su sede en la aplicación. Un disparador que la creara en la base no sustituye ese paso y ocultaría un alta que no creó su sede, así que no forma parte de esta entrega.

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
