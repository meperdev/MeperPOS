# SuperAdmin redesign

Redesign every `/admin/**` surface on the shared kit and the unslop protocol rebuilt from the recovered design context.

## Specs

S1. Cross-org visibility is a read-only contract, not a bug: "No sabia que era modo lectura global y pense quew era un bug. Pero si es solo lectura dejalo." The redesign must not alter scoping, guards, endpoints or the organization selector.
S2. Scope: "Un redesign completo a todo lo del SuperAdmin, pero solo del SUperAdmin." Only `frontend/src/app/admin/**` changes, plus its tests.
S3. Copy stays sentence-case Spanish: "actions, titles and labels capitalize only the first word and proper nouns (`Nuevo cliente`, `Registrar pago`, `Editar producto`), never Title Case (`Nuevo Cliente`). No exclamation marks or emoji in chrome; an action reads verb + object."
S4. Numbers use mono tabular figures: "JetBrains Mono (font-mono tabular-nums) for all currency (COP), quantities, dates, SKU, and NIT figures."
S5. Behavior is preserved: same routes, mutations and destructive confirmation; no new filters or features.

## Tasks

| ID | Spec | Surface | Route | Commit |
| --- | --- | --- | --- | --- |
| T1 | S2, S3 | Admin shell: brand, nav with active state, session, 32px rows, one keyline | `frontend/src/app/admin/layout.tsx` | `db15605` |
| T2 | S2, S3, S4 | Panel: metric strip, plan composition, real error/empty states | `frontend/src/app/admin/page.tsx` | `db15605` |
| T3 | S2, S3, S4 | Organizations list: page header, table alignment, row actions, skeleton | `frontend/src/app/admin/organizations/page.tsx` | `d62a05d` |
| T4 | S2, S3, S4, S5 | Organization detail: header, sections, members table, copy fixes | `frontend/src/app/admin/organizations/[id]/page.tsx` (+ test copy) | `2abc932` |
| T5 | All | Verify: admin vitest, tsc, eslint, build | - | vitest 26/26, tsc + eslint clean; build pending |
| T6 | S2, S3 | Fix the clipped row menus: read-only table + edit dialog + shared labels | `organizations/page.tsx`, `organizations/labels.ts`, `organizations/[id]/page.tsx` | `ae39adf` |
| T7 | S2, S3, S4 | Filter, sort and page the list; trial/billing columns; open-as and copy-slug actions | `organizations/page.tsx`, `organizations/list.ts`, `lib/organizationScope.ts`, `layout/Sidebar.tsx` | `1fa87c4` |

## Log

L1. User request, verbatim: "HOla recupera todo lo de engram de las mejoras de UI, la skill y el repo que se uso para la guia de toda la implementacion del redesign unslopping para para usarla en la pagina del SuperAdmin y validar unas cosas que hace que el dashboard del SuperAdmin pueda ver cosas de otras organizaciones."

L2. User decisions, verbatim: "No sabia que era modo lectura global y pense quew era un bug. Pero si es solo lectura dejalo." / "Un redesign completo a todo lo del SuperAdmin, pero solo del SUperAdmin."

L3. Validation evidence for S1 (read-only): `OrganizationRequiredGuard` passes SuperAdmin without org; `AdminOrganizationInterceptor` resolves `X-Organization-Id` > `?organizationId` > undefined; `RolesGuard` bypasses `@Roles` for SuperAdmin; permissive reads exist in products/customers/categories/suppliers/purchase-orders/exports; writes reject without org; reports/expenses/payroll require an org. No code change is part of this feature.

L4. Design sources recovered: `odd`-external Engram `#2442` (unslop rules), `#2443` (module pass), `#2544` (shared-kit sweep), skill `.agents/skills/unslop-ui/SKILL.md`, guide repo `github.com/pbakaus/impeccable` v4.8.0 vendored untracked at `.agents/skills/impeccable/`, incumbent tokens `docs/design-system/KINETIC_BENTO_SPEC.md` + `frontend/src/app/globals.css`.

L5. Delivery slices, recorded before the next commit: slice 1 = T1+T2 shell+panel (`db15605`, 323 authored lines); slice 2 = T3 list (`d62a05d`, 186 authored lines); slice 3 = T4 detail + test copy (`2abc932`, 375 authored lines). If a PR is opened, chain slice 1+2 and slice 3 so each review stays near the ~400-line budget.

L6. Verification environment: this session runs inside a cgroup capped at `pids.max=64` and `memory.max=3 GiB` (`memory.peak` reached 3.0 GiB, `memory.events.max=282`). Vitest's default fork pool cannot start there (`Failed to start forks worker ... Timeout waiting for worker to respond`), which also caused ~40 minutes of `fork: Resource temporarily unavailable` on plain shell commands. Verification therefore runs with `--pool=threads --maxWorkers=1` and `NODE_OPTIONS=--max-old-space-size=512`; if the sandbox still refuses, run the same commands in a normal terminal.

L7. Verification evidence: `vitest run src/app/admin/organizations/[id]/page.test.tsx --pool=threads --maxWorkers=1 --no-isolate` → 26/26 passed; `npx tsc --noEmit` → exit 0, no output; `npx eslint` on every touched file → clean. `npm run build` (Next, whole app) was stopped after ~4 minutes: while its prerender workers ran, even a diagnostic `bash` failed with `EAGAIN` under the 64-PID ceiling. The whole-app build stays pending for a normal terminal: `cd frontend && npm run build`.

L8. User review found the status menu clipped by the table's scroll container (`BentoSelect` positions its menu absolutely; no z-index escapes an overflow ancestor). T6 makes the table read-only and moves both mutations to an Editar organización dialog opened from a portal row menu, and shares the enum copy through `organizations/labels.ts`. New list test: 3 cases; suite 29/29, tsc and eslint clean (`ae39adf`).

L9. User chose all four UI-only additions. T7 adds an accent-insensitive search, status/plan filters with counts, sort, trial and billing columns, pagination, and the Abrir como organización / Copiar slug row actions. `applyOrganizationScope` moved out of `Sidebar.tsx` into `lib/organizationScope.ts` (Sidebar re-exports it) so the admin page resets the query scope through the same contract. `organizations/list.ts` holds the pure filter/sort/page/trial logic. 48/48 admin tests, tsc and eslint clean (`1fa87c4`). The Sidebar suite is unavailable in this sandbox: esbuild's Rust worker aborts with `OS can't spawn worker thread ... (os error 11)` under the 64-thread cgroup; the file type-checks and CI will run it.
