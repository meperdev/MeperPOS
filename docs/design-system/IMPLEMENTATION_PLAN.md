# Plan de Implementación: Rediseño Frontend MeperPOS (Kinetic Bento)

Implementación integral del sistema de diseño **Kinetic Bento** en el frontend de MeperPOS (Next.js 16 + React 19 + Tailwind CSS v4), aplicando la paleta oficial **Terracotta Copper (`#c25e36`)**, **Obsidian Dark (`#111114`)**, y la tipografía combinada **Inter** (UI) + **JetBrains Mono** (datos y cifras COP).

---

## 5 Fases de Implementación Ejecutadas

### Fase 1: Tokens Globales, Tipografía y Tema Dual
- Inyección de `Inter` y `JetBrains Mono` vía `next/font/local` (WOFF2 self-hosted) en `frontend/src/app/layout.tsx`.
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
- `/tasks`: Master-Detail en 2 columnas con timeline append-only en JetBrains Mono (sin tag "API real").
- `/expenses`: 3 KPIs fijos con `p-5` y modal de detalle en 2 columnas sin scroll para facturas.
- `/reports`: Macro-Bento de Economía, Caja/Inventario y Análisis Operativo 2x2.
- `/settings`: 3 subsecciones con previsualización en vivo de recibo térmico.
