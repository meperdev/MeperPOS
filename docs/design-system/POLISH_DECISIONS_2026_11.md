# MeperPOS UI polish — binding design decisions

> **Provenance.** Recovered verbatim on 2026-11-15 from the scratchpad of Claude Code session
> `222a5ecb-4363-4597-891e-5bc97068d07a`, source path
> `/tmp/claude-1000/-home-meper-Projects-MeperPOS-worktrees-pwa-support/222a5ecb-4363-4597-891e-5bc97068d07a/scratchpad/polish-decisions.md`.
> The worktree that hosted those waves (`pwa-support`) was deleted in the 2026-11-15 worktree
> cleanup, so this is the only surviving copy. Everything below the rule is the original body,
> unmodified except for its own H1, which is dropped because it duplicates this file's title.
>
> Two lines of the body were instructions to the wave subagents of that session, not to readers:
> the "Work ONLY there" worktree notice and "Do NOT run git add/commit/stash/checkout — the
> orchestrator commits". The orchestrator owns git; subagents still do not.
>
> Feature record and task log: `odd/tasks/ui-polish.md`.

---


Worktree: /home/meper/Projects/MeperPOS-worktrees/ui-polish (branch feat/ui-polish). Work ONLY there.
This is POLISH, not redesign: keep layout, behavior, data flow, routes and copy meaning. Change only what a decision below covers.
Do NOT run git add/commit/stash/checkout. The orchestrator commits.
UI language is Spanish (es-CO), informal "tú". Sentence case for every heading, label, button, title ("Nuevo producto", not "Nuevo Producto").

## D1 Tokens (globals.css) — done in wave 1
Light neutrals lose their lavender tint (warm stone neutrals that sit with the terracotta primary):
--background #FAFAF9, --foreground #1C1917, --card-foreground #1C1917, --muted #F5F5F4, --muted-foreground #625D58,
--border #D6D3D1, --border-subtle #E7E5E4, --sidebar-border #D6D3D1, --sidebar-title #1C1917, --sidebar-fg #44403C.
Dark: --border-subtle #26262C (must be subtler than --border #30303A). Everything else unchanged.
New semantic text + info tokens (light / dark), mapped in @theme as --color-*:
--success-text #15803D / #4ADE80 ; --warning-text #B45309 / #FBBF24 ; --danger-text #B91C1C / #F87171 ;
--info #2563EB / #60A5FA ; --info-text #1D4ED8 / #60A5FA.

## D2 Status color usage (everywhere)
No Tailwind palette hues for state: emerald/green/rose/red/amber/orange/yellow/sky/blue/violet/fuchsia/purple/indigo/slate/stone/zinc/gray.
- Text: text-success-text / text-warning-text / text-danger-text / text-info-text
- Dots & solid fills: bg-success / bg-warning / bg-danger / bg-info / bg-muted-foreground (neutral)
- Tinted panels: border-<tone>/30 bg-<tone>/10 + text-<tone>-text
- Neutral: text-muted-foreground, bg-muted, border-border
- Charts (recharts props): "var(--primary)", "var(--success)", "var(--danger)", "var(--info)", "var(--muted-foreground)".
Exceptions allowed: brand wordmark colors (login/sidebar logo), supplier BANK_CHIP_STYLES (bank brand hues), text-white on solid fills.
"text-destructive" does not exist -> text-danger-text.

## D3 Control sizing (4px grid)
Button: sm = h-8 px-3, md = h-10 sm:h-9 (replaces h-[38px]), lg = h-11. Input, Select trigger, BentoSelect trigger, SearchField, date inputs: h-10 sm:h-9.
No h-[38px], w-[38px] anywhere. Off-grid half steps (gap-2.5, gap-3.5, space-y-2.5) -> nearest of gap-2/gap-3/gap-4.
Micro type floor is text-[11px]: replace text-[8px]/[9px]/[10px] with text-[11px]. Leave existing text-[11px]/text-[13px] alone.
Touch targets: icon-only buttons min h-9 w-9 (36px); in POS cart & mobile drawer min 40px (h-10 w-10). Stepper: sm buttons h-8 w-8, md h-10 w-10, lg h-11 w-11.

## D4 Focus (one system)
Buttons/links/icon buttons: focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background
Fields (input/select/textarea/triggers): focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/25
Never leave focus:outline-none without one of these. Prefer replacing raw inputs with components/ui/Input (it has textarea support).

## D5 Elevation & overlays
- Declare elevation once: a card is border + bg-card (shadow-2xs allowed). Never border + shadow-md/lg/xl/2xl at rest. No hover:shadow-lg, no hover:-translate-y, no hover:scale / group-hover:scale / active:scale-*.
- Overlays (modal, drawer backdrop): bg-black/40 dark:bg-black/60, NO backdrop-blur.
- Floating surfaces (modal panel, popovers, menus, dropdowns, tooltips): border border-border bg-card shadow-lg shadow-black/10. No backdrop-blur, no colored shadow (shadow-primary/xx), no shadow-2xl.
- Sticky footers/bars: solid bg-card (or bg-background) + border-t, no /95 + blur.
- transition-all -> transition-colors (duration-150). Press feedback = active:bg-* color change, not scale.
- No gradients (bg-gradient-*) on UI surfaces (avatar = solid bg-primary text-white).

## D6 Motion
Remove stagger-children, animate-fade-in-up, animate-fade-in from page content, headers, lists, tables, grids, cards, banners, auth cards, dropdowns.
Keep: toasts, mobile drawer slide-in-bottom, Modal panel may keep a subtle animate-fade-in only.

## D7 Typography
No font-black / font-extrabold -> font-bold (wordmarks) or font-semibold (numbers/headings).
No uppercase+tracking labels and no eyebrow/kicker text above a heading: delete kickers; convert uppercase labels to sentence case text-xs text-muted-foreground (no tracking). Badge text in sentence case ("Oferta", not "OFERTA").
Arbitrary display sizes -> scale (text-[1.375rem] -> text-xl, sm:text-[42px] -> sm:text-4xl).

## D8 Numbers
Every money, quantity, count, %, page range: add `tabular-nums`. Do NOT use font-mono for this (use .stat-number only where already present).

## D9 Copy (exact replacements)
"Dashboard" nav/page label -> "Panel" | "¡Venta Completada!" -> "Venta registrada" (and drop the duplicate "Venta Exitosa" heading) |
"Items"/"items" -> "Productos"/"productos" ("Items de la venta" -> "Productos de la venta") | "N/A" / "Cliente General" / "General" (no-customer) -> "Sin cliente" |
"Top Clientes" -> "Mejores clientes" | "Productos Más Vendidos" / "Top productos" -> "Productos más vendidos" | "7D" -> "7 días" | bare unit "u" -> "und." |
"Nueva OC" -> "Nueva orden" | "haz click" -> "haz clic" | "Ingrese ..." -> "Ingresa ..." (tú) | "Cerrar menu"/"Abrir menu" -> "menú" |
missing accents: importación, organización, múltiples, está, página, válido | raw enum status shown to user ("PARSING" etc.) -> Spanish label |
"Guardando"/"Creando..." -> use Button loading prop + "Guardando…"/"Creando…" (single ellipsis char) |
Title Case -> sentence case (e.g. "Finalizar venta", "Stock bajo", "Tipo de documento", "Resumen de compra", "Desactivar proveedor", "Uso y límites", "Importación multi-hoja", "Correo electrónico", "Ingresar al sistema", "Ayuda y soporte de acceso", "Volver al inicio de sesión").
Remove "↵ Enter" glyph from the login button. "→" in running copy is fine.

## D10 Kit adoption (only where flagged; preserve behavior)
- Error branch on every list/detail query: use components/ui/ErrorState with retry (refetch). A failed request must never render the empty state. Dashboard cards with false-empty (RecentSalesCard, TopProductsCard) get loading skeleton + error.
- Hand-built page headers -> components/ui/PageHeader. Local duplicates of ErrorState/EmptyState/LoadingState -> kit.
- Raw <input>/<textarea>/<select> with bespoke classes -> components/ui/Input / Select. Labels must be associated (htmlFor/id).
- Inline status pills -> Badge/StatusBadge.
- Row action buttons hidden behind hover (opacity-0 group-hover) must stay visible on touch: use `[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100`.
- Icon-only buttons need aria-label naming the action AND the object when repeated per row ("Eliminar clave X").
- <Link> wrapping <Button> -> Link styled as button (or Button asChild pattern if it exists).
- Nested cards: inner blocks inside a card become borderless (bg-muted/40 rounded-lg) or divide-y rows. Exception: invoice preview <article> in settings/invoicing (it depicts paper) stays.

## Out of scope (do not touch)
Select vs BentoSelect merge, CurrencyInput vs MoneyField merge, dashboard metric-card layout concept, bank chip hues, brand wordmark colors, backend.
