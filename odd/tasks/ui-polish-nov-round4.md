# ODD: UI polish & bugfixes batch (November, round 4)

Objective: seven frontend improvements and bugfixes across POS, Purchase Orders, Expenses, and shared UI primitives (`Select`, `Modal`, `Input`) in an isolated worktree off `origin/master`.
Branch: `ui/polish-nov-round4`. Delivery: single-branch work-unit commits (no push/merge). Runner: Vitest (`cd frontend && npx vitest run <file>`).

## Specs

- S1 (`#1`): "1. Mejorame ese modal de Ventas pausadas."
- S2 (`#2`): "2. Me propondrias una mejora para la organizacion de los botones y su color erde neon?" -> Approved (`D1`): "Segmented control 3-col neutro + acento terracota (sin neón), Cliente/Financiar compactos y Pausar/Reanudar arriba como utilidades".
- S3 (`#3`): "3. Tambien una mejora para la creacion de una Nueva orden de compra." -> Approved (`D2`): "Proveedor arriba → Productos en primer plano → Notas opcionales debajo (o colapsables) + resumen sin alerta amarilla anticipada".
- S4 (`#4`): "4. Ese bug visual es de los porductos de la orden, entonces ya sabes que no dbe volver a pasar :)"
- S5 (`#5`): "5. Alguna reciente, moderna, clean y anti slop nueva forma de resolver el como gestionar esas categorias y etiquetas a nivel de modal? O sera muy complejo sacarle una pagina independiente?" -> Approved (`D3`): "Modal Master-Detail en 2 paneles (grupos a la izquierda, etiquetas del grupo activo a la derecha, sin scroll anidado)".
- S6 (`#6`): "6. Me gustan como se ven las cards de la informacion general de cada categoria de salia, pero no me gusta que se puedan acomular infinitas categorias en el scroll, se puede hacer algo para no se tabularlo, pero no con numerados no se?" -> Approved (`D4`): "1 fila fija: Total del mes anclado a la izquierda + carrusel horizontal de categorías con flechas discretas ‹ › y fade en el borde".
- S7 (`#7`): "7. Bug en el dropdown de metodo en el primero pago  de un Nuevo gasto."

## Tasks

| ID | Specs | Route | Status | Commit |
|----|-------|-------|--------|--------|
| T1 | S7 | inline (`Risk: item 3` — shared `Select` / `Modal`, independently verified + hardened) | done + verified | `4df9cf5`, `cd2db37` |
| T2 | S4 | inline (`Risk: item 3` — shared `Input` / PO tables, independently verified + hardened) | done + verified | `51fc762`, `cd2db37` |
| T3 | S1 | inline | done | `e48cdbc` |
| T4 | S2 | inline | done | `e48cdbc` |
| T5 | S3 | inline | done | `c55e9ab` |
| T6 | S5 | inline | done | `069ec57`, `888d3d6` |
| T7 | S6 | inline | done | `6f8ac83` |

Risk: item 3 (shared `Select`, `Modal`, and `Input` primitives — independently verified by read-only subagent across callers; 1 BLOCKER on `PasswordInput` `pr-12` clearance and 3 `Select` advisories resolved and re-verified in `cd2db37`).

## Log

- L1 (2026-11-21) User request verbatim: "MIra quiero que siguiendo las normas y la metodologia de diseño que se ha subido recientemente y de hecho el nuevo diseño estandar de MeperPOS, quiero que me realices una serie de ajues visuales, modificacion, bugfixs y mejoras: 1. Mejorame ese modal de Ventas pausadas. 2. Me propondrias una mejora para la organizacion de los botones y su color erde neon? 3. Tambien una mejora para la creacion de una Nueva orden de compra. 4. Ese bug visual es de los porductos de la orden, entonces ya sabes que no dbe volver a pasar :) 5. Alguna reciente, moderna, clean y anti slop nueva forma de resolver el como gestionar esas categorias y etiquetas a nivel de modal? O sera muy complejo sacarle una pagina independiente? 6. Me gustan como se ven las cards de la informacion general de cada categoria de salia, pero no me gusta que se puedan acomular infinitas categorias en el scroll, se puede hacer algo para no se tabularlo, pero no con numerados no se? 7. Bug en el dropdown de metodo en el primero pago  de un Nuevo gasto. Eso por el momento ;) / hazlo en un worktree aparte de master actualsiado"
- L2 (2026-11-21) Approved design choices (`D1`-`D4`): A1 Segmented control 3-col neutro + acento terracota (sin neón), Cliente/Financiar compactos y Pausar/Reanudar arriba como utilidades; A2 Proveedor arriba → Productos en primer plano → Notas opcionales debajo + resumen sin alerta amarilla anticipada; A3 Modal Master-Detail en 2 paneles (grupos izquierda, etiquetas derecha, sin scroll anidado); A4 1 fila fija: Total del mes anclado a la izquierda + carrusel horizontal de categorías con flechas discretas ‹ › y fade en el borde. Created worktree `/home/meper/Projects/MeperPOS-worktrees/ui-polish-nov-round4` on branch `ui/polish-nov-round4` from `origin/master` (`a52b23f`).
- L3 (2026-11-21) `T1` (`4df9cf5`) portaled desktop `Select` popovers (`[data-select-popover]`, `position: fixed`), whitelisted them in `Modal` focus-trap, and logged the fix in `docs/bug-rule-log.md`. `T2` (`51fc762`) added `hideStepper`, moved stepper `pr-9` after caller `className` in `Input.tsx`, widened `PurchaseOrderItemEditor` numeric columns (`w-28 min-w-28`, `2xl:px-2`) and `ReceiveItemsModal`, and logged the fix in `docs/bug-rule-log.md`.
- L4 (2026-11-21) `T3`/`T4` (`e48cdbc`) extracted `PausedSalesModal` (`size="md"`, hairline rows, item preview, `formatDateTime`, discount-adjusted total, compact `Reanudar`), converted `PaymentMethodCards` to a 3-col neutral/terracotta segmented control (no neon `--success`), and moved `Reanudar`/`Pausar` to the POS cart header / mobile sheet top bar alongside a compact `Cliente` + `Financiar` row. `T5` (`c55e9ab`) placed `PurchaseOrderItemEditor` directly under `Proveedor *`, moved `Notas` below, added `Unidades`, and separated calm setup hints from row-error warning callouts.
- L5 (2026-11-21) `T6` (`069ec57`) redesigned `ExpenseTaxonomyModal` as a two-panel `size="lg"` master-detail dialog with single group/label forms, `Escape` cancel on inline edits, and `InlineConfirmButton` delete confirmations; follow-up `888d3d6` added required `message` + `retryLabel` props to `ErrorState`. `T7` (`6f8ac83`) refactored `ExpenseSummaryCards` into a single-row pinned `Total del mes` + horizontal `<ol data-testid="expense-summary-rail">` with overflow `‹ ›` arrows and `.expense-summary-rail[data-fade]` CSS masks in `globals.css`.
- L6 (2026-11-21) Independent Risk item 3 verification (`T1`/`T2`) flagged 1 BLOCKER (`Input.tsx` post-`className` `pr-9` downgraded `PasswordInput` `pr-12`) and 3 ADVISORIES (`Select` viewport resize across `sm`, empty `options={[]}` Escape/Tab handling, multi-level nested scrollers). Fixed all four in `cd2db37` with regression tests in `PasswordInput.test.tsx`, `Input.test.tsx`, and `Select.test.tsx`.
- L7 (2026-11-21) Final verification on committed HEAD (`cd2db37`): `npx vitest run` passed `209/209` files (`2,128/2,128` tests); `npx tsc --noEmit` passed (0 errors); `npm run lint:ci` passed (0 errors, 11 pre-existing warnings); `npm run test:eslint-plugin` passed (`7/7`); `impeccable detect --json` returned `[]` across all changed UI files; `git diff --check origin/master` clean. `npm run build` failed earlier with `ENOSPC` (root filesystem `/` at 100%, ~551 MB free after cleaning partial `.next` inside the worktree) and remains blocked by host disk space.
