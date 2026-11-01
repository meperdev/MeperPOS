# SuperAdmin redesign

Redesign every `/admin/**` surface on the shared kit and the unslop protocol rebuilt from the recovered design context.

## Specs

S1. Cross-org visibility is a read-only contract, not a bug: "No sabia que era modo lectura global y pense quew era un bug. Pero si es solo lectura dejalo." The redesign must not alter scoping, guards, endpoints or the organization selector.
S2. Scope: "Un redesign completo a todo lo del SuperAdmin, pero solo del SUperAdmin." Only `frontend/src/app/admin/**` changes, plus its tests.
S3. Copy stays sentence-case Spanish: "actions, titles and labels capitalize only the first word and proper nouns (`Nuevo cliente`, `Registrar pago`, `Editar producto`), never Title Case (`Nuevo Cliente`). No exclamation marks or emoji in chrome; an action reads verb + object."
S4. Numbers use mono tabular figures: "JetBrains Mono (font-mono tabular-nums) for all currency (COP), quantities, dates, SKU, and NIT figures."
S5. Behavior is preserved: same routes, mutations and destructive confirmation; no new filters or features.

## Tasks

| ID | Spec | Surface | Route |
| --- | --- | --- | --- |
| T1 | S2, S3 | Admin shell: brand, nav with active state, session, 32px rows, one keyline | `frontend/src/app/admin/layout.tsx` |
| T2 | S2, S3, S4 | Panel: metric strip, plan composition, real error/empty states | `frontend/src/app/admin/page.tsx` |
| T3 | S2, S3, S4 | Organizations list: page header, table alignment, row actions, skeleton | `frontend/src/app/admin/organizations/page.tsx` |
| T4 | S2, S3, S4, S5 | Organization detail: header, sections, members table, copy fixes | `frontend/src/app/admin/organizations/[id]/page.tsx` (+ test copy) |
| T5 | All | Verify: admin vitest, tsc, eslint, build | - |

## Log

L1. User request, verbatim: "HOla recupera todo lo de engram de las mejoras de UI, la skill y el repo que se uso para la guia de toda la implementacion del redesign unslopping para para usarla en la pagina del SuperAdmin y validar unas cosas que hace que el dashboard del SuperAdmin pueda ver cosas de otras organizaciones."

L2. User decisions, verbatim: "No sabia que era modo lectura global y pense quew era un bug. Pero si es solo lectura dejalo." / "Un redesign completo a todo lo del SuperAdmin, pero solo del SUperAdmin."

L3. Validation evidence for S1 (read-only): `OrganizationRequiredGuard` passes SuperAdmin without org; `AdminOrganizationInterceptor` resolves `X-Organization-Id` > `?organizationId` > undefined; `RolesGuard` bypasses `@Roles` for SuperAdmin; permissive reads exist in products/customers/categories/suppliers/purchase-orders/exports; writes reject without org; reports/expenses/payroll require an org. No code change is part of this feature.

L4. Design sources recovered: `odd`-external Engram `#2442` (unslop rules), `#2443` (module pass), `#2544` (shared-kit sweep), skill `.agents/skills/unslop-ui/SKILL.md`, guide repo `github.com/pbakaus/impeccable` v4.8.0 vendored untracked at `.agents/skills/impeccable/`, incumbent tokens `docs/design-system/KINETIC_BENTO_SPEC.md` + `frontend/src/app/globals.css`.
