---
name: Kinetic Bento
brand:
  primary: '#c25e36' # Terracotta Copper
  primary-hover: '#a84d28'
  primary-light: '#faece5'
  primary-dark-light: '#2c1d18'
  coral: '#d0453f'
colors:
  light:
    surface: '#faf8ff'
    surface-card: '#ffffff'
    outline: '#c7c4d7'
    outline-light: '#e2e8f0'
    primary: '#c25e36'
    primary-soft: '#faece5'
    coral: '#d0453f'
    on-surface: '#131b2e'
    on-surface-variant: '#464554'
    text-muted: '#767586'
  dark: # Obsidian Charcoal (Zero saturated blue)
    surface: '#111114'
    surface-card: '#18181c'
    surface-card-high: '#222228'
    surface-card-higher: '#2c2c34'
    outline: '#30303a'
    outline-light: '#3d3d4a'
    primary: '#c25e36'
    primary-soft: '#2c1d18'
    coral: '#e0524c'
    on-surface: '#f2f2f5'
    on-surface-variant: '#9494a3'
    text-muted: '#6a6a78'
typography:
  source_of_truth:
    font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif
    font-mono: 'JetBrains Mono', monospace
---

# Kinetic Bento Design System: Especificación Canónica Oficial

## 1. Tokens de Identidad & Marca (Definitivos)
- **Color Base Primario**: `Terracotta Copper` (`#c25e36`) con hover en `#a84d28`.
- **Fondo de Acento Suave**: `#faece5` en Light / `#2c1d18` en Dark.
- **Tipografía de Interfaz (UI / Títulos / Textos)**: `Inter` (variable, self-hosted vía `next/font/local`).
- **Tipografía Monospace (Códigos, SKUs, IDs, Precios COP)**: `JetBrains Mono`.
- **Paleta Modo Oscuro**: `Obsidian Charcoal` neutro (`#111114` fondo, `#18181c` tarjetas, `#30303a` bordes).

## 2. Cobertura de Módulos Auditados
1. **Autenticación (`/login` & `/register`)**:
   - Layout **Centrado Elevado Bento**: Card `rounded-3xl` con sombras de profundidad, branding Terracotta Copper, inputs limpios en Inter y botón principal sólido.
2. **Layout Base**: Sidebar persistente de 320px con User Card Bento y conmutador Sun/Moon.
3. **Dashboard (`/dashboard`)**: Macro-tarjetas Bento de ingresos, ventas recientes y accesos táctiles.
4. **POS (`/pos`)**: Grid de catálogo con fotos 4/3, Stepper táctil, carrito dinámico, pagos múltiples (Efectivo/Tarjeta/Transferencia) y modal de ticket térmico.
5. **Ventas (`/sales`)**: Filtro por método y fecha, tabla Bento de transacciones y modal de anulación/detalle.
6. **Clientes (`/customers`)**: Grid 4 columnas con avatares Terracotta y metadatos en JetBrains Mono.
7. **Inventario (`/inventory`)**: Componente canónico `ProductCard` (Bento chunky, imagen 4/3 sobre fondo blanco, categoría superior, título `#131b2e`, bloque dual de precio COP completo + stock con barra, botón editar sólido y squircle de desactivar/reactivar).
8. **Categorías (`/categories`)**: Grid Bento con ícono temático squircle, conteo de productos e impuesto en JetBrains Mono.
9. **Proveedores (`/suppliers`)**: Tarjetas Bento con avatar de iniciales, NIT y teléfono en JetBrains Mono.
10. **Órdenes de Compra (`/purchase-orders`)**: Listado, Detalle `/purchase-orders/[id]`, Formulario dinámico de items y Modal de recibir productos.
11. **Salidas / Gastos (`/expenses`)**: 3 KPIs fijos con padding `p-5`, tabla con set completo de acciones y modal de 2 columnas sin scroll para visualización de factura.
12. **Reportes (`/reports`)**: Filtro de período, Macro-Bento Economía (4 KPIs + comparación + calidad COGS), Fila dual Caja e Inventario actual, Análisis Operativo 2x2 y botón de exportación.
13. **Tareas del Local (`/tasks`)**: Master-Detail 2 columnas con timeline append-only en JetBrains Mono (sin tag "API real").
14. **Mi Perfil (`/profile`)**: Grid horizontal zero-scroll en 2 columnas paralelas (Información Personal + Seguridad).
15. **Configuración (`/settings`)**: 3 subsecciones con sub-navegación (General con subida de logo, Facturación con Live Receipt Preview, y Equipo/Acceso con listado de usuarios).

## 3. Biblioteca Atómica Estandarizada
- **Tags de Estado**: Un solo dot luminoso circular `w-1.5 h-1.5` sin caracteres `•` de texto duplicados.
- **Dropdowns & Selects**: Popovers Bento flotantes `rounded-2xl` con micro-borde y checkmark activo.
- **Steppers**: Botones táctiles reactivos `−` y `+` con número central en **JetBrains Mono Bold**.
- **Inputs de Formulario**: Input de moneda COP con prefijo `$`, campos bloqueados con candado y validaciones en coral.
- **Paginación & Dropzones**: Numeración en JetBrains Mono y dropzone para fotos/facturas con miniatura.
