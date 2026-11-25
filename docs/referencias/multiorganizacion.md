# Organizaciones, sedes y accesos

La aplicación es multiinquilino: cada organización tiene sus propios productos,
ventas y sedes. Este documento describe el modelo y las reglas de acceso que hoy
están en producción. El detalle de stock por sede y las transferencias quedan
para la entrega siguiente.

## 1. Organización y rol

- Un `User` puede pertenecer a varias organizaciones a través de
  `OrganizationUser`, y ese vínculo lleva el rol: `OWNER`, `ADMIN`, `MEMBER`,
  `CASHIER` o `INVENTORY_USER`.
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

- La sede principal la crea el aprovisionamiento de la organización y **siempre
  es una sucursal**: es la que opera el punto de venta hoy, así que la API
  rechaza cambiarla a bodega.
- El nombre se compara sin distinguir mayúsculas ni espacios sobrantes. Un
  nombre repetido responde `409`.
- En esta entrega no hay borrado de sedes.

## 3. Quién ve qué sede (regla de acceso)

La regla es explícita y no se hereda sola:

- **Dueños y administradores** acceden a todas las sedes de su organización,
  incluidas las que se creen después. El acceso viene de su rol, no de filas de
  asignación.
- **El resto de los roles** accede solo a las sedes que un administrador le
  asignó (`MembershipLocation`), una por una. Cero asignaciones significa cero
  sedes visibles, nunca todas.
- **Crear una sede no amplía el acceso de nadie.** La sede nueva nace sin
  asignaciones y un administrador tiene que habilitarla por persona.

## 4. API

| Ruta                                  | Método | Rol            | Para                                              |
| ------------------------------------- | ------ | -------------- | ------------------------------------------------- |
| `/api/locations`                      | `GET`  | todos          | Sedes accesibles en la organización activa        |
| `/api/locations/pos-context`          | `GET`  | todos          | Sedes del POS y la sede habilitada para cobrar    |
| `/api/locations/:id`                  | `GET`  | todos          | Una sede, solo si es accesible                    |
| `/api/locations`                      | `POST` | `OWNER`/`ADMIN`| Crear una sucursal o bodega                       |
| `/api/locations/:id`                  | `PATCH`| `OWNER`/`ADMIN`| Renombrar o cambiar el tipo de una sede           |
| `/api/users/:id/locations`            | `GET`  | `OWNER`/`ADMIN`| Asignaciones explícitas de un vínculo             |
| `/api/users/:id/locations`            | `PUT`  | `OWNER`/`ADMIN`| Reemplazar el conjunto exacto de asignaciones     |

`POST /api/locations` acepta `{ "name": string, "type": "STORE" | "WAREHOUSE" }`
y devuelve la sede creada. `PATCH /api/locations/:id` acepta `name` y/o `type`;
la sede principal responde `400` si se intenta convertir en bodega.

`PUT /api/users/:id/locations` recibe `{ "locationIds": string[] }` y reemplaza
el conjunto completo. Responde `404` si el vínculo o alguna sede no pertenecen a
la organización activa, y `409` si el objetivo ya tiene acceso por rol
(propietario o administrador). `GET /api/users/:id/locations` devuelve
`{ "locationIds": string[], "orgWideAccess": boolean }`: las asignaciones
explícitas y si el rol del vínculo ya alcanza todas las sedes, porque
`GET /api/users` no informa roles y la pantalla necesita ese dato para no ofrecer
casillas a un administrador.

## 5. Pantallas

- **Sedes** (`/locations`, solo propietarios y administradores): lista de sedes
  con su tipo y la marca de principal, alta y edición. Al crear una sede el aviso
  recuerda que el acceso se asigna por persona.
- **Usuarios** (`/settings/team`): la acción de sedes de cada miembro abre las
  casillas con las sedes de la organización; para propietarios y administradores
  se muestra que acceden a todas.

La navegación y los chequeos de pantalla son solo presentación: el límite real
es el backend, que responde `403` a cualquier rol que no sea propietario o
administrador en las rutas de gestión.
