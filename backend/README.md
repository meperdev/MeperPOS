# Backend — API REST (NestJS + Prisma + PostgreSQL)

> Documentación completa del proyecto: [../README.md](../README.md)

API REST de NestJS 11 para el MeperPOS. Expone los servicios de autenticación, productos, ventas, compras, gastos, reportes y administración de un sistema multi-tenant por organización, sobre PostgreSQL con Prisma 6 como ORM.

## Requisitos

- **Node.js** (versión compatible con NestJS 11).
- **npm**.
- **PostgreSQL** en ejecución, con una base de datos creada.

## Puesta en marcha

### 1. Variables de entorno

Crea un archivo `.env` en la raíz de `backend/`:

```env
DATABASE_URL="postgresql://admin:admin123@localhost:5432/inventario_db"
JWT_SECRET="tu-jwt-secret"
PORT=3001
CORS_ORIGIN="http://localhost:3000"
CLOUDINARY_CLOUD_NAME="..."
CLOUDINARY_API_KEY="..."
CLOUDINARY_API_SECRET="..."
```

### 2. Instalación, migraciones y seed

```bash
npm install
npx prisma migrate dev   # aplica las migraciones a la base de datos
npm run seed:apply       # (opcional) organizaciones Prueba PRO y Prueba BASIC
```

### 3. Desarrollo

```bash
npm run start:dev
```

La API queda disponible en `http://localhost:3001/api`. La documentación Swagger está habilitada a través de `@nestjs/swagger`.

## Scripts

| Script                 | Descripción                                        |
| ---------------------- | -------------------------------------------------- |
| `npm run start:dev`    | Servidor de desarrollo con recarga automática      |
| `npm run start:debug`  | Servidor de desarrollo con modo debug              |
| `npm run start:prod`   | Ejecuta la build de producción (`dotenv -e`)       |
| `npm run build`        | Compila la aplicación                              |
| `npm run lint`         | ESLint con auto-corrección                         |
| `npm run format`       | Formatea el código                                 |
| `npm run test`         | Pruebas unitarias (Jest)                           |
| `npm run test:e2e`     | Pruebas end-to-end                                 |
| `npm run test:cov`     | Pruebas con cobertura                              |
| `npm run seed`         | Dry-run de las organizaciones de prueba; `seed:apply` las crea, `seed:verify` cuenta |
| `npm run migrate:dev`  | Ejecuta migraciones en desarrollo                  |
| `npm run migrate:prod` | Ejecuta migraciones en producción                  |
| `npm run studio`       | Abre Prisma Studio                                 |

## Estructura de módulos

Módulos principales en `backend/src/`:

- `auth/` — Autenticación JWT con refresh tokens, registro/inicio de sesión, guards por rol.
- `users/` — Gestión de usuarios.
- `products/` — CRUD de productos, búsqueda, búsqueda rápida y stock bajo (concurrencia optimista).
- `categories/` — Categorías de productos.
- `customers/` — Clientes.
- `sales/` — Ventas con pagos múltiples (efectivo, tarjeta, transferencia).
- `reports/` — Reportes.
- `settings/` — Configuración de la organización.
- `exports/` — Exportación CSV, Excel y PDF.
- `imports/` — Importación de productos.
- `cloudinary/` — Subida de imágenes a Cloudinary.
- `tasks/` — Tareas con historial de eventos (`TaskEvent`).
- `suppliers/` — Proveedores.
- `purchase-orders/` — Órdenes de compra.
- `expenses/` y `expense-categories/` — Gastos con pagos parciales y sus categorías.
- `cash-registers/` — Cajas registradoras.
- `billing/` y `plan-limits/` — Facturación y límites por plan (`BASIC`, `PRO`).
- `admin/` — Panel de administración.
- `common/` — Caché, secuencias (`OrganizationSequence`) y guards compartidos.
- `prisma/` — `PrismaService` (singleton) compartido por todos los módulos.

## Testing

```bash
npm run test          # pruebas unitarias
npm run test:e2e      # pruebas end-to-end
npm run test -- --testPathPattern=<archivo>  # archivo específico
```
