# Organizaciones, sedes y accesos

La aplicación es multiinquilino: cada organización tiene sus propios productos,
ventas y sedes. Este documento describe el modelo y las reglas de acceso, y cómo
se reparte el stock entre sedes. El detalle operativo del corte de stock está en
`docs/planes/implementacion/multisede-corte-stock.md`.

## 1. Organización y rol

- Un `User` puede pertenecer a varias organizaciones a través de
  `OrganizationUser`, y ese vínculo lleva el rol. Los roles asignables hoy son
  `ADMIN`, `CASHIER` e `INVENTORY_USER`; `OWNER` y `MEMBER` están retirados
  (siguen en el enum hasta la fase 4 de la redefinición).
- `OWNER` está retirado: la migración `20261127130000_collapse_owner_into_admin`
  pasó a `ADMIN` toda membresía que lo tenía y conservó `isPrimaryOwner`. El
  dueño principal es un `ADMIN` con `isPrimaryOwner = true`; solo él (o un
  `SUPER_ADMIN`) puede crear otros administradores, y nadie puede asignar
  `OWNER` por la API (`POST /api/users`, alta de miembro y cambio de rol del
  panel lo rechazan). La propiedad se transfiere solo desde el panel de
  plataforma (`POST /api/admin/organizations/:id/transfer-owner`).
- `MEMBER` está retirado: la migración `20261127120000_retire_member_role` pasó
  a `CASHIER` toda membresía que lo tenía, el rol por defecto de una membresía
  nueva es `CASHIER` y la pantalla de equipo ya no lo ofrece. El valor sigue en
  el enum (y en los `@Roles` que lo nombran) hasta que se rehaga la tabla de
  permisos; ninguna membresía debería tenerlo.
- La sesión arrastra la organización activa. `JwtStrategy` vuelve a leer el rol
  del vínculo en cada request, así que un token viejo nunca conserva un rol que
  ya se cambió.
- `SUPER_ADMIN` no es un rol persistido: es una marca del usuario de plataforma
  y solo abre las rutas `admin/*`. Para leer una organización tiene que elegirla
  explícitamente (`x-organization-id`).
- Toda ruta autenticada y con datos de una organización lleva
  `OrganizationRequiredGuard`. Sin ese guard, un `organizationId` indefinido
  degrada la consulta a "todas las organizaciones".

## 2. Sedes

Una sede es una sucursal o una bodega de la organización (`Location`):

| Campo       | Significado                                                     |
| ----------- | --------------------------------------------------------------- |
| `name`      | Nombre de la sede, único por organización sin distinguir mayúsculas |
| `type`      | `STORE` (sucursal) o `WAREHOUSE` (bodega)                       |
| `isDefault` | La sede principal; existe una sola por organización             |
| `address`   | Dirección de la sede, opcional (máximo 200 caracteres)          |
| `phone`     | Teléfono de la sede, opcional (máximo 40 caracteres)            |

- La sede principal la crea el aprovisionamiento de la organización y **siempre
  es una sucursal**: es la que opera el punto de venta hoy, así que la API
  rechaza cambiarla a bodega.
- El nombre se compara sin distinguir mayúsculas ni espacios sobrantes. Un
  nombre repetido responde `409`.
- La dirección y el teléfono son opcionales y se imprimen en el comprobante de
  venta, debajo del nombre del negocio. Se guardan recortados y un valor en
  blanco los borra (`null`), nunca se guarda una cadena vacía.
- En esta entrega no hay borrado de sedes.

## 3. Quién ve qué sede (regla de acceso)

La regla es explícita y no se hereda sola:

- **Administradores** (incluido el dueño principal) acceden a todas las sedes de
  su organización, incluidas las que se creen después. El acceso viene de su rol,
  no de filas de asignación.
- **El resto de los roles** accede solo a las sedes que un administrador le
  asignó (`MembershipLocation`), una por una. Cero asignaciones significa cero
  sedes visibles, nunca todas.
- **Una membresía operativa nueva arranca en la sede principal.** Al crear un
  `CASHIER`, `MEMBER` o `INVENTORY_USER`, la base le asigna la sede principal de
  su organización (y lo mismo si un `ADMIN` sin ninguna asignación baja a uno de
  esos roles). Es la línea base que S3 promete: el acceso a la sede principal se
  conserva y cada sede adicional la asigna un administrador.
- **Crear una sede no amplía el acceso de nadie.** La sede nueva nace sin
  asignaciones y un administrador tiene que habilitarla por persona.

## 4. API

| Ruta                                  | Método | Rol            | Para                                              |
| ------------------------------------- | ------ | -------------- | ------------------------------------------------- |
| `/api/locations`                      | `GET`  | todos          | Sedes accesibles en la organización activa        |
| `/api/locations/pos-context`          | `GET`  | todos          | Sucursales del POS y la sede sugerida para cobrar |
| `/api/locations/:id`                  | `GET`  | todos          | Una sede, solo si es accesible                    |
| `/api/locations`                      | `POST` | `ADMIN`        | Crear una sucursal o bodega                       |
| `/api/locations/:id`                  | `PATCH`| `ADMIN`        | Renombrar o cambiar el tipo de una sede           |
| `/api/users/:id/locations`            | `GET`  | `ADMIN`        | Asignaciones explícitas de un vínculo             |
| `/api/users/:id/locations`            | `PUT`  | `ADMIN`        | Reemplazar el conjunto exacto de asignaciones     |

`GET /api/locations/pos-context` devuelve `{ locations, checkoutLocationId }` con
**solo las sucursales** accesibles (una bodega nunca se ofrece al punto de venta)
y la sede que el servidor sugiere cobrar: la principal cuando el usuario la
alcanza, o la única sucursal accesible cuando hay una sola. Con varias sucursales
alcanzables y ninguna principal a la vista, `checkoutLocationId` es `null` y el
cajero elige en el POS. La sugerencia es una comodidad, no un permiso: la venta
vuelve a autorizar la sede indicada en su propia transacción.

`POST /api/locations` acepta
`{ "name": string, "type": "STORE" | "WAREHOUSE", "address"?: string, "phone"?: string }`
y devuelve la sede creada. `PATCH /api/locations/:id` acepta `name`, `type`,
`address` y/o `phone`; un texto en blanco borra la dirección o el teléfono y la
sede principal responde `400` si se intenta convertir en bodega. Toda respuesta
de sede incluye `address` y `phone` como `null` cuando no se cargaron.

`PUT /api/users/:id/locations` recibe `{ "locationIds": string[] }` y reemplaza
el conjunto completo. Responde `404` si el vínculo o alguna sede no pertenecen a
la organización activa, y `409` si el objetivo ya tiene acceso por rol
(administrador, incluido el dueño principal). `GET /api/users/:id/locations` devuelve
`{ "locationIds": string[], "orgWideAccess": boolean }`: las asignaciones
explícitas y si el rol del vínculo ya alcanza todas las sedes, porque
`GET /api/users` no informa roles y la pantalla necesita ese dato para no ofrecer
casillas a un administrador.

`GET /api/sales` acepta `locationId` y devuelve solo las ventas cuyo origen
guardado es esa sede. El valor pasa por la misma regla de acceso: un `404` si el
usuario de operación no alcanza la sede, y cualquier sede de la organización
para dueños y administradores. Las ventas sin origen guardado (anteriores a las
sedes, o hechas sin indicar una) nunca aparecen bajo un filtro de sede y su
`originSite` es `null`: el historial no adivina la sede principal. La lista y el
detalle de venta incluyen `originSite: { id, name } | null`, y sin el filtro la
respuesta conserva sus campos de siempre.

El comprobante de venta imprime, debajo del nombre y el NIT del negocio, la sede
donde se hizo la venta (`Sede: <nombre>`, su dirección y su teléfono) cuando la
venta tiene origen guardado; sin origen no agrega ninguna línea.

## 5. Pantallas

- **Sedes** (`/locations`, solo administradores, incluido el dueño principal):
  lista de sedes con su tipo, la marca de principal, la dirección y el teléfono,
  alta y edición. Al crear una sede el aviso recuerda que el acceso se asigna
  por persona.
- **Ventas** (`/sales`): la tabla muestra la sede de cada venta y, cuando la
  organización tiene más de una sede visible, un filtro por sede; el detalle de
  la venta también nombra la sede (o avisa que no tiene una registrada).
- **Usuarios** (`/settings/team`): la acción de sedes de cada miembro abre las
  casillas con las sedes de la organización; para administradores se muestra que
  acceden a todas.

La navegación y los chequeos de pantalla son solo presentación: el límite real
es el backend, que responde `403` a cualquier rol que no sea administrador en las
rutas de gestión.

## 6. Stock por sede

- `ProductStock` guarda una fila por producto y sede (`stock` y `reservedStock`)
  y es la fuente de verdad del inventario.
- `Product.stock` y `Product.reservedStock` siguen existiendo como el agregado de
  la organización: los disparadores de la base los igualan a la suma de las filas
  de sede después de cada sentencia. Los reportes y las alertas siguen leyendo la
  organización a través de `Product`, sin cambios.
- El agregado no se escribe a mano: un disparador rechaza cualquier `UPDATE` a
  `Product.stock`/`reservedStock` que no venga del delta de una fila de sede. Las
  altas de producto siguen permitidas y abren la fila de la sede principal.
- El POS cobra y financia en una **sucursal** accesible (una bodega no tiene
  caja). La recepción de compras y las transferencias pueden usar cualquier sede
  del tenant autorizada para el usuario. Cada operación descuenta o acredita el
  saldo de la sede que indica, no el de la organización.
- Las transferencias entre sedes (`/api/transfers`) descuentan la sede de origen
  al despachar y acreditan la de destino al recibir, con su historial de
  inventario en ambas sedes.
