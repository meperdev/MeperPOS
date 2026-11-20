# ODD: UI polish batch (November)

Objective: eleven targeted UI adjustments across POS, dashboard, sales, inventory, suppliers, purchase orders and expenses.
Branch: `ui/polish-batch-nov` (main tree), continued in worktree `../MeperPOS-worktrees/ui-polish-batch-nov` on `ui/polish-batch-nov-2`. Delivery: ask-on-risk. Runner: Vitest (`cd frontend && npx vitest run <file>`).

## Specs

- S1 POS: "quiero que se reduzca la zona de Productos al menos para que sea un 60% 40%". "acomodar los productos de al menos 4 columnas. Asi tambien le das mas espacio a las cards y que no parezcan chubbys."
- S2 POS cart: "Parte a la mitad esos dos botones" (Sin cliente / Financiar a crédito) and lay them out like the Efectivo/Tarjeta payment cards: "haz que el del cliente se vea en icono y abajo el 'Sin Cliente' En el de financiar igual."
- S3 Dashboard: "TEngo conflicto con que el boton de Stock critico ocupe todo el horizontal".
- S4 Dashboard "Ventas recientes" table: "Siento que la tabla no esta muy dentro del diseño estanar? LO digo por la fila de los nombres de las columnas".
- S5 Sales cards: "Saca boton 'Detalle' porque con clickear se entra a ver el detalle."
- S6 "/sales o Ventas genera un scroll por muchas filas al cambiar al modo de mostrar en fila. ESo de hecho ocurre en mas paginas."
- S7 Sale detail modal payment method chip: "Me gusta el chip, pero brodi esta el 80% del espacio vacio".
- S8 Inventory: "inconforme con la cantidad de productos que me salen en el INventario" and "lo ancha que se puede ver el sidebar ... podemos ajustar mejor la armonia ahi?"
- S9 Suppliers cards: "Me gustaba mas cuando se alcanzaba a ver la parte o la cuenta bancaria, se puede ajustar para que quede visible?"
- S10 Purchase orders: "un reajuste de diseño para La creacion de la Orden de compra junto con lo demas dentro del flujo, dejando como esta la principal de Ordenes de compra. Solo sacando el boton de 'Detalle'".
- S11 Expenses: "saca el boton del ojo para ver el detalle y solo hazla clickeable como las demas." and "esa pagina hace un refresh raro debajo de la barra de paginador cuando entro a ver el detalle de una Salida por primera vez".

## Tasks

| ID | Specs | Route | Status | Commit |
|----|-------|-------|--------|--------|
| T1 | S1, S2 | inline | done | 8e53f53 |
| T2 | S3, S4 | inline | done | 0966c9b |
| T3 | S5, S6, S7 | inline | done | a9451b9 |
| T4 | S8 | delegated (parallel) | done | a94d8e4 |
| T5 | S9 | delegated (parallel) | done | b9b869a |
| T6 | S11 | delegated (parallel) | done | 2a3a5a2 |
| T7 | S10 | delegated (parallel) | done | c4508c2 |
| T8 | S6 regression | delegated (parallel) | done | 5c0c7ce |

## Log

- L1 (2026-11-18) User request verbatim: "TEngo cambios puntuales de UI: 1. El POS regreso a cuando era mas grande la parte de Porductos que el Carrito? ... 11. saca el boton del ojo para ver el detalle y solo hazla clickeable como las demas. Una cosa esa pagina hace un refresh raro debajo de la barra de paginador cuando entro a ver el detalle de una Salida por primera vez, mas o menos asi lo he replicado." (full text quoted in S1-S11; screenshots supplied in chat).
- L2 Route: all inline; no Writer trigger reason (units are small and share layout code). Skills: impeccable (refinement on incumbent design), project unslop-ui.
- L3 T1-T3 done inline. Visual check: POS 60/40 and 4 columns render; sale detail tiles OK. Regression found: /customers in table view throws "Maximum update depth exceeded" (absent on base) -> T8.
- L4 (2026-11-18) User: "tu debes orquestar ... decides el maldito mejor cambio del mundo y se lo pasas al worker". Remaining tasks delegated as parallel units with disjoint surfaces. Main tree was left with stash@{0} accidentally applied (agent error); `git reset --hard` is blocked by runtime permission, so work continues in a clean worktree from a9451b9.
- L5 Workers returned; parent reviewed screenshots (inventory 9x3 at 1890x1037, PO editor, popover). Seam check: vitest 179 files / 1688 tests passed, tsc clean. T8 root cause: table answer fell back to `min` while the table unmounted for its skeleton, re-keying the query in a loop.
- L6 Test data left in dev DB `inventario_po_docs`: expense "Prueba visual S11"; supplier "Proveedor Prueba UI" (NIT 900999888); draft OC-1 (b04d80aa-...). Open decision: zero-cost line blocks saving in create and edit-draft flows.
