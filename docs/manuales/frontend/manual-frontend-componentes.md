# Manual Profesional de Componentes Frontend

**Proyecto:** MeperPOS (Next.js App Router)
**Alcance:** `frontend/src`
**Ultima actualizacion:** 2026-03-12

## 1) Objetivo

Este manual define un **ID unico y estable** para cada pieza clave del frontend.
La idea es que, cuando quieras cambiar algo, no tengas que volver a explorar todo el arbol: buscas el ID y editas directo.

## 2) Convencion de IDs

- `FE-PAGE-*`: paginas/rutas de App Router
- `FE-LAYOUT-*`: layout estructural y navegacion
- `FE-PROVIDER-*`: providers globales
- `FE-UI-*`: componentes UI base reutilizables
- `FE-FEAT-*`: componentes de dominio (POS, reportes, productos)
- `FE-CTX-*`: contextos globales
- `FE-HOOK-*`: hooks de datos/logica
- `FE-CORE-*`: utilidades base (API, utils, tipos, estilos)

Regla operativa: cuando abras un ticket/cambio, referencia siempre el ID primero (ejemplo: `FE-UI-BUTTON`).

## 3) Mapa de arranque global

- `FE-LAYOUT-ROOT` -> `frontend/src/app/layout.tsx`
- Orden de providers globales:
  - `FE-PROVIDER-QUERY` (`QueryProvider`)
  - `FE-CTX-THEME` (`ThemeProvider`)
  - `FE-CTX-TOAST` (`ToastProvider`)
  - `FE-CTX-AUTH` (`AuthProvider`)
- Estilos globales/tokens: `FE-CORE-GLOBAL-STYLES` -> `frontend/src/app/globals.css`

## 4) Catalogo maestro

### 4.1 Paginas (App Router)

| ID | Ruta | Componente | Archivo | Editar aqui cuando... |
|---|---|---|---|---|
| `FE-PAGE-HOME` | `/` | `HomePage` | `frontend/src/app/page.tsx` | quieras cambiar redireccion inicial login/dashboard |
| `FE-PAGE-LOGIN` | `/login` | `LoginPage` | `frontend/src/app/login/page.tsx` | ajustes de UX de inicio de sesion |
| `FE-PAGE-REGISTER` | `/register` | `RegisterPage` | `frontend/src/app/register/page.tsx` | mensaje de registro restringido |
| `FE-PAGE-DASHBOARD` | `/dashboard` | `DashboardPage` | `frontend/src/app/dashboard/page.tsx` | KPIs, resumen general, tabla ventas recientes |
| `FE-PAGE-POS` | `/pos` | `POSPage` | `frontend/src/app/pos/page.tsx` | flujo de venta, carrito, pausa/reanudar, checkout |
| `FE-PAGE-INVENTORY` | `/inventory` | `InventoryPage` | `frontend/src/app/inventory/page.tsx` | CRUD productos, filtros, stock bajo, imagen |
| `FE-PAGE-SALES` | `/sales` | `SalesPage` | `frontend/src/app/sales/page.tsx` | historial ventas, detalle venta, cancelacion |
| `FE-PAGE-CUSTOMERS` | `/customers` | `CustomersPage` | `frontend/src/app/customers/page.tsx` | gestion clientes y segmentos |
| `FE-PAGE-REPORTS` | `/reports` | `ReportsPage` | `frontend/src/app/reports/page.tsx` | metricas, graficos, exportaciones |
| `FE-PAGE-CATEGORIES` | `/categories` | `CategoriesPage` | `frontend/src/app/categories/page.tsx` | CRUD categorias |
| `FE-PAGE-PROFILE` | `/profile` | `ProfilePage` | `frontend/src/app/profile/page.tsx` | datos del usuario y cambio de clave |
| `FE-PAGE-SETTINGS` | `/settings` | `SettingsPage` | `frontend/src/app/settings/page.tsx` | configuracion negocio, logo, usuarios |

### 4.2 Layout, navegacion y providers

| ID | Componente | Archivo | Editar aqui cuando... |
|---|---|---|---|
| `FE-LAYOUT-ROOT` | `RootLayout` | `frontend/src/app/layout.tsx` | cambies fuentes, metadata o arbol de providers |
| `FE-LAYOUT-DASHBOARD` | `DashboardLayout` | `frontend/src/components/layout/DashboardLayout.tsx` | permisos por ruta (`routeRoleMap`) o estructura general autenticada |
| `FE-LAYOUT-SIDEBAR` | `Sidebar` | `frontend/src/components/layout/Sidebar.tsx` | menu lateral, orden de modulos, etiquetas, tema, logout |
| `FE-PROVIDER-QUERY` | `QueryProvider` | `frontend/src/components/providers/QueryProvider.tsx` | `staleTime`, cache y comportamiento global de React Query |

### 4.3 UI base reutilizable

| ID | Componente(s) | Archivo | Editar aqui cuando... |
|---|---|---|---|
| `FE-UI-BUTTON` | `Button` | `frontend/src/components/ui/Button.tsx` | variantes, tamanos, estados loading/disabled |
| `FE-UI-INPUT` | `Input` | `frontend/src/components/ui/Input.tsx` | inputs/textarea, label/error, estilos de campo |
| `FE-UI-SELECT` | `Select`, `SelectOption` | `frontend/src/components/ui/Select.tsx` | select unico de la app: `onChange(value)` (no evento), select nativo oculto para `name`/`required`/`disabled`, soporte de `error` |
| `FE-UI-CARD` | `Card`, `CardHeader`, `CardContent`, `CardFooter` | `frontend/src/components/ui/Card.tsx` | contenedores de cards globales |
| `FE-UI-BADGE` | `Badge` | `frontend/src/components/ui/Badge.tsx` | chips de estado/segmento/alerta |
| `FE-UI-MODAL` | `Modal` | `frontend/src/components/ui/Modal.tsx` | comportamiento de overlays/modales |
| `FE-UI-CONFIRM-DIALOG` | `ConfirmDialog` | `frontend/src/components/ui/ConfirmDialog.tsx` | confirmaciones de borrado/acciones sensibles |
| `FE-UI-IMAGE-UPLOAD` | `ImageUpload` | `frontend/src/components/ui/ImageUpload.tsx` | subida previa/validaciones de imagen |

### 4.4 Componentes de dominio

| ID | Componente(s) | Archivo | Editar aqui cuando... |
|---|---|---|---|
| `FE-FEAT-PRODUCT-CARD` | `ProductCard` | `frontend/src/components/products/ProductCard.tsx` | tarjeta producto en inventario/POS |
| `FE-FEAT-POS-PAYMENT-METHODS` | `PaymentMethodCard`, `PaymentMethodCards` | `frontend/src/components/pos/PaymentMethodCards.tsx` | selector visual de metodos de pago |
| `FE-FEAT-POS-PAYMENT-CONFIRM` | `PaymentConfirmationModal` | `frontend/src/components/pos/PaymentConfirmationModal.tsx` | division de pagos, cambio, resumen checkout |
| `FE-FEAT-POS-QUICK-AMOUNTS` | `QuickAmountButtons` | `frontend/src/components/pos/QuickAmountButtons.tsx` | botones rapidos de efectivo |
| `FE-FEAT-REPORTS-IMPORT` | `ImportSection` | `frontend/src/components/reports/ImportSection.tsx` | importacion de inventario con reintentos |

### 4.5 Contextos globales

| ID | Contexto | Archivo | Editar aqui cuando... |
|---|---|---|---|
| `FE-CTX-AUTH` | `AuthProvider`, `useAuth` | `frontend/src/contexts/AuthContext.tsx` | login/logout/sesion, usuario actual, roles |
| `FE-CTX-THEME` | `ThemeProvider`, `useTheme` | `frontend/src/contexts/ThemeContext.tsx` | dark/light mode y persistencia |
| `FE-CTX-TOAST` | `ToastProvider`, `useToast` | `frontend/src/contexts/ToastContext.tsx` | notificaciones globales |

### 4.6 Hooks de datos y logica

| ID | Hook(s) | Archivo | Dominio principal |
|---|---|---|---|
| `FE-HOOK-PRODUCTS` | `useProducts`, `useProduct`, `useCreateProduct`, `useUpdateProduct`, etc. | `frontend/src/hooks/useProducts.ts` | inventario y productos |
| `FE-HOOK-SALES` | `useSales`, `useSale`, `useCreateSale`, `useUpdateSaleStatus` | `frontend/src/hooks/useSales.ts` | ventas |
| `FE-HOOK-CUSTOMERS` | `useCustomers`, `useCustomer`, `useCreateCustomer`, etc. | `frontend/src/hooks/useCustomers.ts` | clientes |
| `FE-HOOK-CATEGORIES` | `useCategories`, `useCreateCategory`, etc. | `frontend/src/hooks/useCategories.ts` | categorias |
| `FE-HOOK-REPORTS` | `useDashboard`, `useSalesByPaymentMethod`, etc. | `frontend/src/hooks/useReports.ts` | reportes |
| `FE-HOOK-SETTINGS` | `useSettings`, `useUpdateSettings`, `useInventoryMovements` | `frontend/src/hooks/useSettings.ts` | configuracion |
| `FE-HOOK-USERS` | `useUsers`, `useCreateUser` | `frontend/src/hooks/useUsers.ts` | usuarios (admin) |
| `FE-HOOK-PROFILE` | `useProfile`, `useUpdateProfile`, `useChangePassword` | `frontend/src/hooks/useProfile.ts` | perfil propio |
| `FE-HOOK-PAUSED-SALES` | `usePausedSales` | `frontend/src/hooks/usePausedSales.ts` | ventas pausadas en localStorage |
| `FE-HOOK-IMPORT` | `useImport` | `frontend/src/hooks/useImport.ts` | importacion productos |
| `FE-HOOK-INVOICE` | `printInvoice` | `frontend/src/hooks/useInvoice.ts` | impresion/descarga factura |

### 4.7 Core compartido

| ID | Modulo | Archivo | Responsabilidad |
|---|---|---|---|
| `FE-CORE-API` | `api`, `getApiErrorMessage` | `frontend/src/lib/api.ts` | cliente Axios, token JWT, interceptor 401, exports/downloads |
| `FE-CORE-UTILS` | `cn`, `formatCurrency`, fechas, safe localStorage | `frontend/src/lib/utils.ts` | utilidades base del frontend |
| `FE-CORE-TYPES` | interfaces globales | `frontend/src/types/index.ts` | contratos TS del frontend |
| `FE-CORE-GLOBAL-STYLES` | tokens CSS + clases globales | `frontend/src/app/globals.css` | tema, sidebar styles, animaciones, scrollbars |

## 5) Matriz rapida: "quiero cambiar X"

| Si quieres cambiar... | ID principal | Dependencias que casi siempre tocas |
|---|---|---|
| permisos por rol | `FE-LAYOUT-DASHBOARD` | `FE-LAYOUT-SIDEBAR`, `FE-CTX-AUTH` |
| menu lateral/navegacion | `FE-LAYOUT-SIDEBAR` | `FE-LAYOUT-DASHBOARD`, `FE-CORE-GLOBAL-STYLES` |
| estilos globales y paleta | `FE-CORE-GLOBAL-STYLES` | `FE-UI-*` |
| cualquier boton del sistema | `FE-UI-BUTTON` | paginas/feature donde se usa |
| flujo de pago POS | `FE-PAGE-POS` | `FE-FEAT-POS-PAYMENT-CONFIRM`, `FE-HOOK-SALES` |
| importacion de inventario | `FE-FEAT-REPORTS-IMPORT` | `FE-HOOK-IMPORT`, `FE-PAGE-REPORTS` |
| CRUD productos | `FE-PAGE-INVENTORY` | `FE-HOOK-PRODUCTS`, `FE-UI-IMAGE-UPLOAD`, `FE-FEAT-PRODUCT-CARD` |
| gestion usuarios admin | `FE-PAGE-SETTINGS` | `FE-HOOK-USERS`, `FE-CORE-API` |
| errores de API mostrados al usuario | `FE-CORE-API` | hooks y paginas que llaman `getApiErrorMessage` |

## 6) Protocolo de uso (edicion rapida)

1. Define el cambio en una frase: "quiero cambiar [X]".
2. Busca ese caso en la seccion 5 y toma el `ID principal`.
3. Abre el archivo del ID en este manual.
4. Revisa la columna de dependencias para no romper flujo.
5. Edita y valida en la pagina relacionada (`FE-PAGE-*`).

## 7) Mantenimiento del manual

- Cuando crees un componente nuevo, agrega su fila el mismo dia.
- Si renombras/mueves archivos, actualiza el ID sin cambiar su semantica.
- Evita IDs ambiguos; usa siempre prefijos de capa (`PAGE`, `UI`, `HOOK`, etc.).

---

### Nota final

Este documento esta pensado como indice operativo rapido. Si quieres, en el siguiente paso puedo generarte una **version 2** con:

- prioridad por frecuencia de cambio,
- mapa por permisos (`ADMIN`, `CASHIER`, `INVENTORY_USER`),
- y checklist de regression por modulo.
