# Owner role actions and page chrome fixes

Branch `fix/owner-role-actions`, worktree `/home/meper/Projects/MeperPOS-fix-owner-roles`, based on `feat/login-redesign` (1ef6689).
Delivered work must never touch `inventario_db` or the loans worktree.

## Specs

Numbered requirements quoting the user verbatim.

- S1: "el boton e crear orden de compra no me sale ni en pantalla completa ni reducida"
- S2: "tampoco el de crear proveedores"
- S3: "darle un poco mas de top pdding para que no se vea tan pegado"
- S4: "no hay forma de ajustar un poco mas el responsive?"
- S5: "no me sale boton crear producto"
- S6: "quita la linea separadora del medio"
- S7: "dame las otras credenciales incliyendo la del superadmin" — answered from the seed, no code change (see Log).

## Tasks

- T1 — Route the role checks through the existing shared helper (S1, S2, S5).
  Root cause: eight call sites hand-roll `role === "ADMIN"` (or `=== "ADMIN" || === "INVENTORY_USER"`), which excludes `OWNER`, while the backend's `RolesGuard` inherits `OWNER ⊃ ADMIN ⊃ MEMBER ⊃ CASHIER`. `frontend/src/lib/auth.ts` already exports `getEffectiveRoles` and `hasAnyRole`, which encode that hierarchy plus `SUPER_ADMIN`, and nothing in the app calls them. The seeded demo data contains OWNER and CASHIER users only, so no account can currently reach those actions. Fix by using `hasAnyRole` at every site, keeping each site's intended audience identical and only adding the roles the hierarchy already grants.
  Sites: `app/purchase-orders/page.tsx:35`, `app/purchase-orders/[id]/page.tsx:41`, `app/suppliers/page.tsx:108`, `app/inventory/page.tsx:48` (all `ADMIN || INVENTORY_USER`); `app/customers/page.tsx:59` (`ADMIN || CASHIER`), `:60` (`ADMIN`); `app/expenses/page.tsx:239` (`ADMIN`); `app/sales/page.tsx:43` (`ADMIN`).
- T2 — Add `frontend/src/lib/auth.test.ts` covering `getEffectiveRoles` and `hasAnyRole`, including OWNER inheriting ADMIN, SUPER_ADMIN, INVENTORY_USER inheriting nothing, and the undefined-role case (S1, S2, S5).
- T3 — More top padding where the user pointed (S3).
- T4 — Responsive adjustment (S4).
- T5 — Remove the middle separator line (S6).

## Log

- L1 (user, verbatim): screenshots plus "el boton e crear orden de compra no me sale ni en pantalla completa ni reducida", "tampoco el de crear proveedores", "darle un poco mas de top pdding para que no se vea tan pegado", "no hay forma de ajustar un poco mas el responsive?", "no me sale boton crear producto", "quita la linea separadora del medio", "y dame las otras credenciales incliyendo la del superadmin".
- L2 (decision): the parent proposed three places to do the work; the user chose a separate branch and worktree so neither `feat/login-redesign` nor the loans branch is disturbed.
- L3 (evidence): `QuickActions.tsx` was deleted on `feat/login-redesign`, and that branch touches only `app/dashboard`, `app/login`, `app/register`, `app/tasks`, icons, `globals.css` and `layout.tsx` under `app/`, so the missing buttons are not caused by the redesign.
- L4 (evidence): the seeded users are `admin@sistema.com` (SUPER_ADMIN), `admin@cafeteria-demo.com` and `admin@supermercado-demo.com` (OWNER) and `cajero1..3@cafeteria-demo.com` plus `cajero1..5@supermercado-demo.com` (CASHIER); no ADMIN user exists, which is why the gap is invisible until an OWNER logs in.
