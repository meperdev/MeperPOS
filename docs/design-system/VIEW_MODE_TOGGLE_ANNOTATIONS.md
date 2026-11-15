# ViewModeToggle — design annotations

Spec S15 of the UI polish feature (`odd/tasks/ui-polish.md`). One document, no code comments in the pages.

## Reference

`[Image 1]`: [`previews/view-mode-toggle.png`](previews/view-mode-toggle.png), the grid/list switch as the user
reported it on 2026-11-15: a pill container with two icon segments, the active one with its own border.

The control is `components/ui/ViewModeToggle.tsx`, built on `FilterGroup` / `FilterOptionButton` from
`components/ui/FilterBar.tsx`. Every page below renders the same component, so a note on the control applies to all
of them; per-page notes are only for what a page does differently.

## Notes on the control

| # | Note (user, verbatim) | Status | Resolution |
|---|---|---|---|
| N1 | "los botones se ven corridos" | Resolved | Two causes. The icon sat on the text baseline because `FilterOptionButton` was not a flex container, so it drifted ~3px off-centre: the button is now `inline-flex items-center justify-center` (`5041ef7`). The track had a border plus 1px padding while the active segment had its own border, so the two borders nearly touched with uneven spacing: the track is now a borderless inset surface, `bg-muted` on light and `bg-background` on dark, and the active segment is raised with `bg-card` / `dark:bg-muted` (`2a151f8`, `5041ef7`). The whole control is 36px, the field height. |

## Pages using the control

| Page | Route file | Page-specific note |
|---|---|---|
| Categorías | `app/categories/page.tsx` | — |
| Clientes | `app/customers/page.tsx` | — |
| Empleados | `app/employees/page.tsx` | — |
| Salidas | `app/expenses/page.tsx` | — |
| Inventario | `app/inventory/page.tsx` | — |
| Préstamos | `app/loans/page.tsx` | — |
| Nómina | `app/payroll/page.tsx` | — |
| Órdenes de compra | `app/purchase-orders/page.tsx` | — |
| Ventas | `app/sales/page.tsx` | — |
| Proveedores | `app/suppliers/page.tsx` | — |

The control is hidden below the `sm` viewport (`hidden sm:inline-flex`); on phones each page keeps its default view.

New notes go in the first table when they concern the control, or in the "Page-specific note" column otherwise.
None are invented here: an empty cell means the user has not annotated that page.
