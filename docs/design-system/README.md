# Kinetic Bento Design System — MeperPOS

Documentación oficial del sistema de diseño **Kinetic Bento** para el frontend de MeperPOS (Next.js 16 + React 19 + Tailwind CSS v4).

---

## 📚 Índice de Documentación

1. **[Especificación Canónica del Sistema (`KINETIC_BENTO_SPEC.md`)](./KINETIC_BENTO_SPEC.md)**  
   Definición completa de tokens de diseño, tipografía combinada (`Inter` + `JetBrains Mono` para códigos), paleta dual (Light / Obsidian Charcoal Dark), reglas atómicas y especificación de los 15 módulos del sistema.

2. **[Plan de Implementación Técnica (`IMPLEMENTATION_PLAN.md`)](./IMPLEMENTATION_PLAN.md)**  
   Estructura en 5 fases de implementación, mapa de archivos afectados y criterios de verificación.

3. **[Recorrido y Validación de Compilación (`WALKTHROUGH.md`)](./WALKTHROUGH.md)**  
   Resumen de los commits atómicos encadenados y validación exitosa de `npm run build` (29/29 páginas generadas en verde).

---

## 🎨 Tokens Principales de Identidad

| Token | Valor Oficial | Uso / Contexto |
| :--- | :--- | :--- |
| **Primary (Terracotta Copper)** | `#c25e36` | Color de marca, botones principales, acentos |
| **Primary Hover / Dark** | `#a84d28` | Hover y estados activos de botones |
| **Primary Soft (Light)** | `#faece5` | Fondos de acento suave en modo claro |
| **Primary Soft (Dark)** | `#2c1d18` | Fondos de acento suave en modo oscuro |
| **Dark Background (Obsidian)** | `#111114` | Fondo de página en modo oscuro (sin tintes azules) |
| **Dark Cards / Containers** | `#18181c` | Tarjetas Bento en modo oscuro |
| **Dark Borders** | `#30303a` | Micro-bordes en modo oscuro |
| **Font Sans** | `Inter` | Títulos, textos generales de UI y navegación |
| **Font Mono** | `JetBrains Mono` | Códigos, SKUs, IDs y precios COP completos |

---

## 🖥️ Prototipos HTML Interactivos (Showrooms)

Los prototipos visuales interactivos se encuentran guardados en la subcarpeta [`previews/`](./previews/):

- `preview_design_system_components.html`: Showroom de biblioteca atómica con selector de paletas y probador de tipografías.
- `preview_product_cards.html`: Maqueta canónica de `ProductCard` para motocicletas y repuestos.
- `preview_login.html`: Maqueta de pantalla de Login & Autenticación.
- `preview_expenses.html`: Maqueta de Salidas / Gastos con 3 KPIs y modal de factura sin scroll.
- `preview_reports.html`: Dashboard de Reportes Financieros y Operativos.
- `preview_tasks.html`: Master-Detail de Tareas del local con timeline append-only.
- `preview_profile.html`: Vista de Mi Perfil en 2 columnas paralelas sin scroll.
- `preview_settings.html`: Configuración con subsecciones y Live Ticket Preview.
