# ODD: App header and command palette

Objective: a desktop header bar with a global search that opens a command palette, notifications and an account menu, adapted to MeperPOS.
Branch: `feat/app-header` (worktree `../MeperPOS-worktrees/app-header`), based on `ui/polish-batch-nov-2`. Delivery: ask-on-risk. Runner: Vitest.

## Specs

- S1 Header bar "de este estilo" (reference screenshot: centered "Buscar en Sigo" field; at the right a messages icon, help icon, notification bell with "99+" badge, avatar "AR"; avatar menu with name + role, "Mi perfil", "Mis avisos y correos", "Mis solicitudes de ayuda", "Instalar aplicación", "Salir"), "ajustada a MeperPOS".
- S2 Search palette like the reference modal "Buscar en Sigo": search input with an example placeholder, groups "Abiertos recientemente", "Crear", "Ir a", "pero ajustada a MeperPOS". Approved search scope: screens, products (name, SKU, barcode), customers (name, document), sales (number). Suppliers and purchase orders are a later round.
- S3 (follow-up, after the font prototype lands) Remove the bell and user block from the sidebar once the header owns them.
- S4 `/inventory` reads `?search=` on load and prefills its search field (and the query), so a palette product hit lands on that product. `?filter=lowStock` keeps working; both together must work.
- S5 The POS root height subtracts the new header, so the POS document does not scroll at 1366x768 or 1890x1037. Prefer one CSS variable for the header height (`--app-header-height`) used by AppHeader, AppShellSkeleton, DashboardLayout and POS, so the number lives in one place. Any other `100dvh-` calc that assumed no header is fixed the same way.
- S6 While typing, the palette also shows a query-filtered «Crear» group (same accent-insensitive filter as «Pantallas»), placed after «Pantallas». With no matching action the group is absent.

## Tasks

| ID | Specs | Route | Status | Commit |
|----|-------|-------|--------|--------|
| T1 | S1, S2 | delegated (context backstop) | in progress | |
| T2 | S3, S4, S5, S6 | delegated (context backstop) | in progress | |

## Log

- L1 (2026-11-18) User: "me interesa mucho integrar una barra de header asi [captura] de este estilo." Then, on the proposed search scope (screens, products, customers, sales via existing endpoints, Ctrl+K): "[captura del modal Buscar en Sigo] pero ajustada a MeperPOS".
- L2 Facts: no global search exists; no backend search endpoint (per-entity search only); AlertCenter and the user menu live at the bottom of Sidebar.tsx; PWA install lives in contexts/InstallPromptContext.tsx; MobileTopBar exists for phones.
- L3 (2026-11-19) T1 landed: `AppHeader` (sticky, `h-14`, right of the rail), `AccountMenu`, `CommandPalette` + `useCommandSearch`, open state and recents ledger in `lib/command-palette.ts`; `MobileTopBar` gained the search button and `AppShellSkeleton` reserves the bar. Facts: (a) "Crear" carries only "Nueva venta" (/pos) and "Nueva orden de compra" (/purchase-orders/new) — "Nuevo producto", "Nuevo cliente" and "Registrar salida" open their modal from local state and read no URL param, so they are omitted; (b) `/inventory` reads only `filter=lowStock`, so a product hit lands on the unfiltered catalog (`/inventory?search=<sku>` is ignored today); (c) no customer detail route exists, so a customer hit opens the app's own cross-link `/sales?customerId=<id>&customerName=<name>`; (d) a sale hit opens `/sales/:id`, the real detail route; (e) `GET /products/search` excludes INVENTORY_USER, so that role reads the same name/SKU/barcode fields through `GET /products?search=` instead of losing the group.
- L4 (2026-11-19) Parent decisions on T1's open items: keep "Cambiar a modo oscuro / Cambiar a modo claro"; one logout name in the product ("Cerrar sesión", the header's after T2); add the query-filtered «Crear» group; keep INVENTORY_USER reading `GET /products?search=`.
- L5 (2026-11-19) T2 landed: `Sidebar.tsx` footer split in two regions — the lg rail keeps only `OrganizationSwitcher` (the one control with no other home; it renders nothing for single-org users, so no empty strip), and the drawer keeps the whole block it had (clock, identity, bell, account menu, switcher). The clock left the rail and lives in the drawer. The collapsed rail's "Mostrar organizaciones" button went with the rest of the rail footer. `--app-header-height` (3.5rem) is now the single header number, used by AppHeader, AppShellSkeleton, DashboardLayout and the POS root; POS no longer scrolls (measured 0 overflow at 1366x768 and 1890x1037; `/profile` also 0, `/dashboard` and `/tasks` overflow only by their own content). `/inventory` adopts `?search=` on a URL transition, combined with `?filter=lowStock`. Palette hint faces follow "mono only for identifiers": prices sans + `tabular-nums`, document numbers mono, the `Ctrl K` hint mono.
