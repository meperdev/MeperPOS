# Plan de Implementación: Rediseño Frontend MeperPOS (Kinetic Bento)

Implementación integral del sistema de diseño **Kinetic Bento** en el frontend de MeperPOS (Next.js 16 + React 19 + Tailwind CSS v4), aplicando la paleta oficial **Terracotta Copper (`#c25e36`)**, **Obsidian Dark (`#111114`)**, y una sola familia tipográfica, **Inter** (subset latin self-hosted), con cifras tabulares para identificadores y datos.

---

## 5 Fases de Implementación Ejecutadas

### Fase 1: Tokens Globales, Tipografía y Tema Dual
- Inyección de `Inter` (subset latin) vía `next/font/local` en `frontend/src/app/layout.tsx`; sin `next/font/google` y sin familia monoespaciada (los identificadores usan `.id-text`, las cifras `.stat-number`).
- Escala tipográfica: cuerpo y celdas de tabla `text-sm` (14px), etiquetas y metadatos `text-[13px]`, micro-etiquetas (chips, badges, atajos, encabezados de tabla) `text-xs` (12px, piso) y valores de resumen un paso por encima de su etiqueta (`text-xl` → `sm:text-[28px]`).
- Fechas y horas en cifras proporcionales (sin `tabular-nums`): solo las líneas que mezclan una fecha con dinero o un conteo conservan cifras tabulares.
- Definición de variables CSS en `:root` y `.dark` bajo `@theme inline` en `frontend/src/app/globals.css`.

### Fase 2: Biblioteca de Componentes Atómicos UI
- Actualización de `Button`, `Input`, `Badge` (dot único), `Card`, `Modal`, `ConfirmDialog`, `Pagination`, `FilterBar`.
- Creación de nuevos componentes: `Stepper.tsx` y `BentoSelect.tsx`.

### Fase 3: Layout Base, Navegación y Autenticación
- Sidebar Bento fijo de 320px en `frontend/src/components/layout/Sidebar.tsx`.
- Offset principal `lg:ml-[320px]` en `frontend/src/components/layout/DashboardLayout.tsx`.
- Card centrada elevada con soporte Dark en `frontend/src/components/auth/AuthCard.tsx`.

### Fase 4: Módulos de Operación, Catálogo e Inventario
- Componente canónico `ProductCard.tsx` para motocicletas y repuestos.
- Vistas de `/inventory`, `/pos`, `/categories` y `/suppliers`.

### Fase 5: Módulos Financieros, Comerciales y Administrativos
- `/profile`: Grid horizontal en 2 columnas paralelas sin scroll.
- `/tasks`: Master-Detail en 2 columnas con timeline append-only con horas tabulares (sin tag "API real").
- `/expenses`: 3 KPIs fijos con `p-5` y modal de detalle en 2 columnas sin scroll para facturas.
- `/reports`: Macro-Bento de Economía, Caja/Inventario y Análisis Operativo 2x2.
- `/settings`: 3 subsecciones con previsualización en vivo de recibo térmico.
