# Frontend — SPA (Next.js App Router)

> Documentación completa del proyecto: [../README.md](../README.md)

Aplicación frontend del MeperPOS, construida con Next.js 16 (App Router), React 19 y TailwindCSS v4. Consume la API REST del backend mediante TanStack Query v5 y un cliente Axios con inyección automática de JWT.

## Requisitos

- **Node.js** (versión compatible con Next.js 16).
- **npm**.
- **Backend en ejecución** en `http://localhost:3001/api` (ver [backend/README.md](../backend/README.md)).

## Puesta en marcha

### 1. Variables de entorno

Crea un archivo `.env.local` en la raíz de `frontend/`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

### 2. Instalación y desarrollo

```bash
npm install
npm run dev
```

La aplicación queda disponible en `http://localhost:3000`.

## Scripts

| Script        | Descripción                     |
| ------------- | ------------------------------- |
| `npm run dev` | Servidor de desarrollo          |
| `npm run build` | Build de producción (Webpack)  |
| `npm run lint`  | ESLint                       |
| `npm run test`  | Pruebas (Vitest)             |

### Build de producción

`npm run build` compila con Webpack (`next build --webpack`); `npm run dev` sigue usando Turbopack. El build de producción evade el fallo del resolvedor de fuentes de `next/font/google` que aparece en builds fríos con Turbopack (`Can't resolve '@vercel/turbopack-next/internal/font/google/font'`). Es una omisión documentada del bundler en producción, no una corrección de la causa raíz: las fuentes, sus pesos, las variables CSS y la versión de Next no cambian.

## Estructura de páginas

Páginas principales en `frontend/src/app/`:

- `login/`, `register/` — Autenticación.
- `dashboard/` — Resumen principal.
- `pos/` — Módulo Point of Sale (carrito, favoritos, ventas pausadas, splits de pago e impresión de facturas).
- `inventory/` — Gestión de inventario y productos.
- `sales/` — Ventas, con detalle en `sales/[id]/`.
- `customers/` — Clientes.
- `reports/` — Reportes.
- `categories/` — Categorías.
- `profile/` — Perfil del usuario.
- `settings/` — Configuración, con `settings/billing/` para facturación.
- `users/` — Gestión de usuarios.
- `suppliers/` — Proveedores.
- `purchase-orders/` — Órdenes de compra (`purchase-orders/new/` y `purchase-orders/[id]/`).
- `expenses/` — Gastos.
- `tasks/` — Tareas.
- `admin/` — Panel de administración (`admin/organizations/[id]/`).

El layout `DashboardLayout` envuelve todas las páginas autenticadas: renderiza la `Sidebar` y aplica redirecciones según el rol. En móvil usa un slide-over; en escritorio una barra fija de 256px con `lg:ml-64`.

## Convenciones

- **`cn()`** (`lib/utils.ts`, clsx + tailwind-merge) para combinar clases de Tailwind en los componentes de `components/ui/`.
- **`formatCurrency(amount)`** para formatear montos en COP; **`formatDate` / `formatDateTime`** con locale es-CO.
- **`getApiErrorMessage(error, fallback)`** para extraer mensajes de error legibles de los errores de Axios.
- **Cliente `api`** (`lib/api.ts`): singleton de Axios con inyección automática del JWT y redirección en respuestas `401`.
- **Contextos**: `AuthContext` (usuario + JWT), `ThemeContext` (tema claro/oscuro) y `ToastContext` (notificaciones).
- El tema usa variables CSS definidas en `globals.css` (`--primary` teal, `--terracotta` como acento) y fuentes Manrope + JetBrains Mono vía `next/font`.

## Testing

```bash
npm run test   # Vitest + Testing Library (jsdom)
```
