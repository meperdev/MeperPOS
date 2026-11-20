# Estado y Componentes Frontend (Next.js)

El cliente de este sistema está desarrollado como una SPA moderna (Server/Client components mixtos) utilizando **Next.js 16 (App Router)**, **React 19** y **TailwindCSS v4**. Este documento establece las convenciones de diseño y flujo de estado.

## 1. Arquitectura de Next.js (App Router)

El enrutamiento está basado en el sistema de archivos bajo el directorio `src/app/`.

### Estructura de Páginas
- Rutas públicas: `/login`, `/register`.
- Rutas privadas: `/dashboard`, `/pos`, `/inventory`, `/sales`, `/customers`, `/reports`, `/categories`, `/settings`, `/profile`.
- **DashboardLayout**: Intercepta todas las rutas autenticadas. Contiene el componente `Sidebar`. En escritorio es un menú lateral fijo de 256px de ancho con un margen izquierdo (`lg:ml-64`) para el contenido principal; en móvil actúa como un *slide-over* (drawer).
- Este layout también se encarga de validar los accesos (Route-Role Mapping) y redirigir si un rol (`CASHIER` o `INVENTORY_USER`) intenta acceder a un área no permitida.

---

## 2. Gestión de Estado (Server State vs Client State)

### Estado del Servidor (React Query)
Las llamadas directas con `useEffect` están prohibidas. Todo estado proveniente del backend es gestionado mediante **TanStack Query (React Query v5)**.

- **Custom Hooks**: Toda lógica de query y mutación vive en `src/hooks/api/` (ej. `useProducts.ts`, `useSales.ts`).
- **Caché y Revalidación**: React Query se encarga del manejo del estado de carga (`isLoading`), errores (`isError`) e invalidación del caché de las listas (ej. después de agregar un nuevo producto, invalidamos la query `['products']`).

### Comunicación de Red (Axios)
Se utiliza una instancia Singleton exportada desde `lib/api.ts`.
- **Interceptors**: Inyecta automáticamente el JWT almacenado en `localStorage` en cada solicitud. 
- **Manejo de 401**: Si un request falla con 401 Unauthorized, el interceptor expulsa la sesión y redirige al `/login`.
- Función helper `getApiErrorMessage(error, fallback)` extrae los mensajes amigables al usuario de la respuesta de NestJS de forma segura.

### Estado Local y Módulo POS
El módulo POS (Punto de Venta) posee una gestión de estado intensiva en el cliente:
- El **Carrito de Compras**, **Ventas Pausadas** y estado de división de **Pagos (CASH, CARD, TRANSFER)** se manejan con estado en memoria y persistencia parcial en `localStorage` (ej. favoritos persisten en `pos_favorite_product_ids`).
- Función de facturación `useInvoice` orquesta la compilación visual de la venta para su impresión o entrega digital.

---

## 3. UI y Componentes (Design System)

Implementamos un sistema de diseño propio altamente reutilizable basado en Tailwind.

- **Componentes Base**: Ubicados en `components/ui/` (`Button`, `Input`, `Card`, `Modal`, `Select`, `Badge`, `ConfirmDialog`, `ImageUpload`).
- **Tailwind Merge**: TODOS los componentes base aceptan la propiedad `className`. Para asegurar una correcta cascada de estilos, es OBLIGATORIO usar la utilidad `cn()` (que envuelve `clsx` y `tailwind-merge`) ubicada en `lib/utils.ts`.
  ```tsx
  // ✅ Correcto
  <button className={cn("base-clases", className, isActive && "bg-primary")}>...</button>
  
  // ❌ Incorrecto (Evitar concatenación estática)
  <button className={`base-clases ${className}`}>...</button>
  ```

---

## 4. Temado y Contextos Globales

La inyección de estado de aplicación transversal se da vía React Contexts:

1. **ThemeContext**: Gestiona el cambio Claro/Oscuro. Agrega o retira la clase `.dark` sobre la etiqueta `<html>`. Las variables CSS principales (ej. `--primary` (teal), `--terracotta` (accent), `--card`, `--border`, `--muted`) se definen en `globals.css`.
2. **AuthContext**: Provee globalmente la información del usuario en sesión, decodificación de roles y método manual de deslogueo.
3. **ToastContext**: Sistema de notificaciones *snackbars* usado globalmente para éxitos y errores.

### Tipografías
Están inyectadas con `next/font/local` desde `frontend/src/app/fonts/inter-latin.woff2`:
- Fuente única: **Inter** (subset latin con los ejes `opsz` 14-32 y `wght` 100-900), expuesta como `--font-sans-face`.
- Identificadores (SKU, códigos de venta y OC, NIT, teléfonos, cuentas, documentos) usan la misma familia con cifras tabulares mediante `.id-text`; montos, conteos, porcentajes y fechas, con `.stat-number` / `tabular-nums`.
- No se carga ninguna familia monoespaciada: `globals.css` no declara `--font-mono`. El único texto en ancho fijo es un comando literal que el lector podría volver a escribir, y toma la pila del sistema con `.code-text`.
- Escala: cuerpo y celdas de tabla `text-sm` (14px); etiquetas, metadatos y ayudas `text-[13px]`; micro-etiquetas (chips, badges, atajos de teclado, encabezados de tabla) `text-xs` (12px, piso); los valores de resumen van un paso por encima de su etiqueta (`text-xl` en móvil, `sm:text-[28px]` en escritorio).
Evita hardcodear familias de fuentes y respeta las variables CSS de tipografía impuestas en la capa root.
