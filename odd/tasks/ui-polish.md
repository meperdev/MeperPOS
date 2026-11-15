# ODD: UI polish over the October shared-kit redesign

Objective: polish (not redesign) the October 2026 frontend rebuilt on the shared kit, following the
`impeccable` and `unslop-ai-ui` anti-slop skills. Branch `feat/ui-polish` from `origin/master`
`5d051ff`. Runner `cd frontend && npm run test` (vitest); typecheck `npx tsc --noEmit`; build
`npm run build`. Delivery strategy `ask-on-risk`.

Engram mirror: `odd/ui-polish/tasks`.

## Resume

Paste this into a fresh Claude Code session; it is self-sufficient.

```
Work in /home/meper/Projects/MeperPOS-worktrees/ui-polish (branch feat/ui-polish, 16 commits
ahead of origin/master 5d051ff). Read odd/tasks/ui-polish.md until "## Log" first, and
docs/design-system/POLISH_DECISIONS_2026_11.md (binding D1-D10).

The first polish pass is committed and green (tsc clean, vitest 1136/1136). Do NOT redo it.
A second batch is now in scope, specs S11-S15 in that task file: merge Select/BentoSelect and
CurrencyInput/MoneyField; rework the 8 dashboard metric cards; stop ImportSheetErrors from
showing raw codes; kill CATEGORY_CHART_PALETTE hex in lib/dashboard.ts; and the design
annotations described in S15 (confirm scope with me before touching 10 files).

Order: S13 (smallest, self-contained), then S14, then S11, then S12, S15 last. Work units of
one behavior each with its tests; no behavior, routing, data-flow or API changes outside the
spec. Local stack: backend :3001, frontend :3000, DB inventario_db.
```


## Specs

The binding decisions are **D1–D10**, recovered verbatim to
`docs/design-system/POLISH_DECISIONS_2026_11.md`. That file is the source of truth; the quotes below
are the operative line of each decision. A worker implementing `S#` reads the full decision, not this
summary.

- **S1 — Tokens (D1).** "Light neutrals lose their lavender tint (warm stone neutrals that sit with the terracotta primary)": `--background #FAFAF9`, `--foreground #1C1917`, `--card-foreground #1C1917`, `--muted #F5F5F4`, `--muted-foreground #625D58`, `--border #D6D3D1`, `--border-subtle #E7E5E4`, `--sidebar-border #D6D3D1`, `--sidebar-title #1C1917`, `--sidebar-fg #44403C`. Dark: `--border-subtle #26262C`, "must be subtler than --border #30303A". New semantic tokens mapped in `@theme` as `--color-*`: `--success-text #15803D / #4ADE80`, `--warning-text #B45309 / #FBBF24`, `--danger-text #B91C1C / #F87171`, `--info #2563EB / #60A5FA`, `--info-text #1D4ED8 / #60A5FA`.
- **S2 — Status color usage (D2).** "No Tailwind palette hues for state: emerald/green/rose/red/amber/orange/yellow/sky/blue/violet/fuchsia/purple/indigo/slate/stone/zinc/gray." Text uses `text-<tone>-text`; dots and solid fills use `bg-<tone>`; tinted panels use `border-<tone>/30 bg-<tone>/10 + text-<tone>-text`; charts use `"var(--primary)"`, `"var(--success)"`, `"var(--danger)"`, `"var(--info)"`, `"var(--muted-foreground)"`. Allowed exceptions: brand wordmark colors, `BANK_CHIP_STYLES`, `text-white` on solid fills. `text-destructive` does not exist.
- **S3 — Control sizing (D3).** "Button: sm = h-8 px-3, md = h-10 sm:h-9 (replaces h-[38px]), lg = h-11." Fields at `h-10 sm:h-9`. "No h-[38px], w-[38px] anywhere." Off-grid half steps snap to `gap-2/gap-3/gap-4`. "Micro type floor is text-[11px]". Icon-only buttons `min h-9 w-9` (36px), POS cart and mobile drawer `h-10 w-10`.
- **S4 — Focus (D4).** Buttons/links: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background`. Fields: `focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/25`. "Never leave focus:outline-none without one of these."
- **S5 — Elevation and overlays (D5).** A card is "border + bg-card (shadow-2xs allowed)"; never `border + shadow-md/lg/xl/2xl` at rest, no `hover:shadow-lg`, no `hover:-translate-y`, no `hover:scale`/`group-hover:scale`/`active:scale-*`. Overlays `bg-black/40 dark:bg-black/60`, "NO backdrop-blur". Floating surfaces `border border-border bg-card shadow-lg shadow-black/10`. Sticky bars solid, no `/95` + blur. `transition-all` -> `transition-colors`. No `bg-gradient-*` on UI surfaces.
- **S6 — Motion (D6).** "Remove stagger-children, animate-fade-in-up, animate-fade-in from page content, headers, lists, tables, grids, cards, banners, auth cards, dropdowns." Kept: toasts, mobile drawer slide-in, a subtle modal fade.
- **S7 — Typography (D7).** "No font-black / font-extrabold -> font-bold (wordmarks) or font-semibold (numbers/headings)." No uppercase+tracking labels, no eyebrow/kicker above a heading; uppercase labels become `text-xs text-muted-foreground` with no tracking; badge text in sentence case ("Oferta", not "OFERTA"); arbitrary display sizes move to the scale.
- **S8 — Numbers (D8).** "Every money, quantity, count, %, page range: add `tabular-nums`. Do NOT use font-mono for this."
- **S9 — Copy (D9), exact replacements.** "Dashboard" nav/page label -> "Panel" | "¡Venta Completada!" -> "Venta registrada" (dropping the duplicate "Venta Exitosa" heading) | "Items"/"items" -> "Productos"/"productos" ("Items de la venta" -> "Productos de la venta") | "N/A" / "Cliente General" / "General" (no-customer) -> "Sin cliente" | "Top Clientes" -> "Mejores clientes" | "Productos Más Vendidos" / "Top productos" -> "Productos más vendidos" | "7D" -> "7 días" | bare unit "u" -> "und." | "Nueva OC" -> "Nueva orden" | "haz click" -> "haz clic" | "Ingrese ..." -> "Ingresa ..." (tú) | "Cerrar menu"/"Abrir menu" -> "menú" | missing accents: importación, organización, múltiples, está, página, válido | raw enum status shown to user ("PARSING" etc.) -> Spanish label | "Guardando"/"Creando..." -> Button loading prop with "Guardando…"/"Creando…" (single ellipsis char) | Title Case -> sentence case ("Finalizar venta", "Stock bajo", "Tipo de documento", "Resumen de compra", "Desactivar proveedor", "Uso y límites", "Importación multi-hoja", "Correo electrónico", "Ingresar al sistema", "Ayuda y soporte de acceso", "Volver al inicio de sesión"). Remove the "↵ Enter" glyph from the login button.
- **S10 — Kit adoption (D10), only where flagged.** Error branch with retry on every list/detail query (a failed request never renders the empty state); hand-built page headers -> `PageHeader`; local duplicates of ErrorState/EmptyState/LoadingState -> kit; raw `input`/`textarea`/`select` -> `Input`/`Select` with associated labels; inline status pills -> `Badge`/`StatusBadge`; row actions hidden behind hover stay visible on touch via `[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100`; icon-only buttons get an aria-label naming action **and** object per row; `<Link>` wrapping `<Button>` -> Link styled as a button; nested cards become borderless blocks, except the invoice preview `<article>` in settings/invoicing.

Shared constraints: Spanish UI (es-CO), informal "tú", sentence case everywhere. Out of scope for
this feature: merging Select/BentoSelect, merging CurrencyInput/MoneyField, the dashboard metric-card
layout concept, bank chip hues, brand wordmark colors, and the backend.

### Second batch (user-scoped 2026-11-15, see L7)

These are the items the first pass deliberately left out. They are now in scope and replace the
"out of scope" lines above where they overlap. None has been implemented.

- **S11 — Merge the duplicated kit pairs.** Unify `components/ui/Select.tsx` (207 lines) with `BentoSelect.tsx` (250 lines), and `CurrencyInput.tsx` (122 lines) with `MoneyField.tsx` (104 lines), into one component each. Every current call site keeps its present behavior and accessible name (note the kit change recorded in #2688: the trigger is named by its label). Migrate call sites and their colocated tests; one component per concept, no visual regression.
- **S12 — Rethink the eight dashboard metric cards.** "Las 8 tarjetas de métricas del dashboard: replantearlas sería un rediseño." Replan the hero-metric layout concept; the current 8 cards are the starting point, not a constraint. Redesign scope, so it carries its own design decision before any code.
- **S13 — Stop showing raw import error codes.** In `components/imports/ImportSheetErrors.tsx` line 100 the `Badge` renders `error.code ?? error.errorCode` verbatim (`DUPLICATE_SKU`, `INVALID_EMAIL`, `UNKNOWN_ERROR`). Map codes to Spanish through a `CODE_LABELS` record in `components/imports/labels.ts`, next to the existing `SHEET_LABELS`/`FIELD_LABELS`, with a fallback that never leaks the raw code.
- **S14 — Remove the category hex palette.** `lib/dashboard.ts` line 259 `CATEGORY_CHART_PALETTE` hardcodes 8 hexes (`#C25E36`, `#2563EB`, `#059669`, `#7C3AED`, `#D97706`, `#0891B2`, `#DB2777`, `#EA580C`) and line 295 assigns them per category. They violate S2 twice: palette hues and literal hex. Replace with the semantic token approach D2 requires for charts, and keep category colors stable and distinguishable across renders.
- **S15 — Design annotations referencing a reference image.** The user wants design notes in the shape `[Image 1]` marked on every page that uses the control in the reference image (a grid/list `ViewModeToggle`, used in `app/{categories,customers,employees,expenses,inventory,loans,payroll,purchase-orders,sales,suppliers}/page.tsx`). **Scope is not confirmed**: whether these are code comments in those 10 files or one annotation document, and what each annotation must say, is still an open question (L8). Ask before touching the 10 files.

## Tasks

- [x] **T1 — Wave 1, tokens and kit.** S1–S5, S7–S8 in `globals.css` (+ `globals.theme-tokens.test.ts`), `lib/chipStyles.ts`, `components/ui/*`, `contexts/ToastContext.tsx`. Evidence: Engram #2686; new tokens, D3 sizes, D4 ring, D5 elevation carried into the kit.
- [x] **T2 — Wave 2a, layout / pwa / auth / dashboard.** S2–S10 on `components/layout/*`, `components/pwa/*`, `components/auth/*`, `app/login`, `app/register`, `app/offline`, `app/dashboard`, `app/page.tsx`, `components/dashboard/*`. Evidence: #2687; `tsc` clean, 174 vitest tests green on owned paths. Deviation: dashboard `totalSales` is an all-time COMPLETED count (`reports.service.ts` `getDashboard`), so the copy reads "acumulado", not "registradas hoy".
- [x] **T3 — Wave 2b, POS / inventory / sales / customers / categories.** S2–S10 on `app/{pos,inventory,sales,customers,categories}` plus `components/{pos,products,sales,categories}` and their colocated tests. Evidence: #2690.
- [x] **T4 — Wave 2c, reports / tasks / loans / expenses / payroll / employees.** S2–S10 on `app/{reports,tasks,loans,expenses,payroll,employees}` and `components/expenses`. Evidence: #2689. Known deviation: `components/ui/FilterBar` chips are still `h-7` where S3 asks `h-8`.
- [x] **T5 — Wave 2d, settings / users / admin / suppliers.** S2–S10 on `app/{settings,users,admin,suppliers}`. Evidence: #2688 (BentoSelect accessible name is the field label; StatusBadge no longer carries `font-mono`).
- [x] **T6 — Adversarial review.** Fresh-context review over the whole diff found 7 defects, all fixed. Evidence: #2692.
- [x] **T7 — Verification.** `tsc` clean, vitest 1136/1136, `eslint` at the master baseline (11 pre-existing problems), `next build` OK, `impeccable` detector `[]`. Evidence: #2692.
- [ ] **T8 — Visual check in the browser.** Light/dark, mobile POS. Blocked in the previous session (no running stack); the stack is now up on :3000/:3001, so this is executable.
- [x] **T9 — Work-unit commits on `feat/ui-polish`.** 152 files, +2160/−2056, split into 15 commits by area, each holding its own colocated tests. Verified before committing: `tsc --noEmit` exit 0, vitest 124 files / 1136 tests green. Commits, in order: `705b1e2` tokens, `da9b0da` kit, `d60033a` shell/pwa/auth/dashboard, `ec61717` POS, `a152f7b` inventory, `cd1bdb4` sales, `aa27c95` reports, `55c6729` tasks, `b3887bc` loans, `f82e60f` expenses, `d444bd2` employees/payroll, `42166b2` settings, `32e2cf0` admin/suppliers/users, `1e42436` purchase-orders/imports/billing, `932fbbf` alerts/profile.
- [ ] **T10 — Delivery decision.** The diff exceeds ~400 authored lines, so `ask-on-risk` requires choosing `stacked-to-main` or `feature-branch-chain` before the first PR. Nothing is pushed yet.
- [ ] **T11 — S13, import error labels.** Smallest, self-contained; do it first.
- [ ] **T12 — S14, category chart colors.** Tokenize or derive, then verify categories stay distinguishable and stable.
- [ ] **T13 — S11, kit pair merges.** Select/BentoSelect and CurrencyInput/MoneyField; large refactor, its own chain decision.
- [ ] **T14 — S12, dashboard metric cards.** Design decision first (S12), then code.
- [ ] **T15 — S15, design annotations.** Blocked on L8: confirm scope before touching 10 files.

## Log

- **L1 (2026-11-15, verbatim).** "Revisa el ultimo redesign que le hice a todo el front y pulemelo. Apoyate en estas skills de anti slop https://github.com/pbakaus/impeccable y https://github.com/steve-in-tandem/unslop-ai-ui. Trabaja bajo modo orquestacion, tu tendras el mando y las desisiones de diseño, pero toda exploracion o implementacion lo haras con haikus 5.5 para ahorrar costos :)"
- **L2 (2026-11-15, verbatim).** "Una cosa, cuando ya tengas que implementar trabaj sobre un worktree aparte con master actualizado"
- **L3 (2026-11-15).** Session `222a5ecb` ran the waves in the `pwa-support` worktree with the decisions doc in a scratchpad file outside the repo. That worktree and its siblings were deleted in the worktree cleanup later the same day, and the code was carried into `feat/ui-polish` without commits.
- **L4 (2026-11-15, recovery).** On resume, `polish-decisions.md` was absent from every remaining checkout and from Engram (the observations reference it but never enumerate D1–D10). It was recovered **verbatim** from `/tmp/claude-1000/-home-meper-Projects-MeperPOS-worktrees-pwa-support/222a5ecb-4363-4597-891e-5bc97068d07a/scratchpad/polish-decisions.md` and stored as `docs/design-system/POLISH_DECISIONS_2026_11.md`. L1 and L2 were recovered verbatim from the same session log, because no feature document had ever been written for this work.
- **L5 (2026-11-15).** Local stack lifted from this worktree so T8 can run: env files copied from the main checkout, backend dependencies installed, the two pending migrations (`20261114210000_product_stock_alerts`, `20261115120000_product_stock_alert_events`) applied, backend :3001 and frontend :3000 up.
- **L6 (2026-11-15).** T9 closed: the 152 uncommitted files are now 15 area commits on `feat/ui-polish`, each with its colocated tests, after `tsc --noEmit` exit 0 and vitest 1136/1136. `frontend/AGENTS.md` stays out of the commits: `next dev` regenerates it, so whether it is tracked is a repo-policy decision, not part of this feature. Nothing pushed and no PR opened; T8 (visual check) and T10 (chain strategy) remain open.
- **L7 (2026-11-15, verbatim).** "quiero re tomar la sesion en el claude code y añadirle un par de cosas que quieor ajustar junto con lo que el en la sesion que se me bloqueo me dijo: **Cosas que dejé afuera a propósito** — Unificar `Select` con `BentoSelect`, y `CurrencyInput` con `MoneyField`: es un refactor, no pulido. — Las 8 tarjetas de métricas del dashboard: replantearlas sería un rediseño. — Los códigos de error crudos que todavía muestra `ImportSheetErrors`. — Los colores en hex de las categorías en `lib/dashboard`. y hyacerle unas anotaciones de diseño como [Image 1] en todas las paginas que lo usa. Ayudame a dejar el contexto y un mini promtp para retomar y la ruta del worktree" → scoped as S11–S15, T11–T15.
- **L8 (2026-11-15, open).** S15 is underdefined: `[Image 1]` points at an attached screenshot of the grid/list `ViewModeToggle` (10 pages), but the request does not say whether the annotations are code comments in those files, a single document, or something else, nor what each must say. T15 stays blocked until the user answers.
