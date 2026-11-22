# Bug → rule log

Append-only record of every bug or footgun that was pushed up the trust stack
into something a machine checks. Each `fix:` PR adds **one row at the bottom**;
never edit or delete an earlier row (a superseded rule gets a new row that says
so).

Layers: **01** types/boundaries (Prisma, TypeScript, class-validator, guards,
module limits) · **02** lint/test (ESLint rule or regression test) · **03**
prose (AGENTS.md or a skill, only when it cannot be checked mechanically).

| Date | Issue / PR | Bug or footgun addressed | Layer | Rule or test path | PR |
| --- | --- | --- | --- | --- | --- |
| 2026-11-21 | Phase 1 trust stack ([#387](https://github.com/meperdev/MeperPOS/pull/387)) | A controller authenticated with `JwtAuthGuard` but without `OrganizationRequiredGuard` lets `user.organizationId` arrive `undefined`, so the service fallback `...(organizationId ? { organizationId } : {})` becomes a cross-tenant query (SEC-002). Exemptions (SUPER_ADMIN platform, user-scoped auth routes, plan-limits) now carry an inline `-- reason`. | 02 | `backend/eslint-plugin-meperpos/rules/require-organization-guard.mjs` · tests `backend/eslint-plugin-meperpos/tests/require-organization-guard.test.mjs` | [#387](https://github.com/meperdev/MeperPOS/pull/387) |
| 2026-11-21 | Phase 1 trust stack ([#387](https://github.com/meperdev/MeperPOS/pull/387)) | Reading `error.response.data.message` by hand shows a `string[]` from ValidationPipe, an empty toast, or `undefined`; `getApiErrorMessage` in `frontend/src/lib/api.ts` is the single funnel. | 02 | `frontend/eslint-plugin-meperpos/rules/no-raw-api-error-message.mjs` · tests `frontend/eslint-plugin-meperpos/tests/no-raw-api-error-message.test.mjs` | [#387](https://github.com/meperdev/MeperPOS/pull/387) |
| 2026-11-21 | Explorer F28: fractional stock | `POST /api/products` and `PUT /api/products/:id` accepted a fractional `stock`/`minStock` (e.g. `2.5`) because the DTOs used `@IsNumber()`, while `Product.stock`/`minStock` and every `InventoryMovement` quantity are `Int` whole units. The DTOs now use `@IsInt()` + `@Min(0)` (400, no silent truncation) and the inventory form sets `step={1}` `min={0}` and checks `Number.isInteger` before submitting. | 01 | `backend/src/products/dto/product.dto.ts` · `frontend/src/app/inventory/page.tsx` · tests `backend/src/products/dto/product.dto.spec.ts`, `backend/src/products/products.stock-validation.http.spec.ts`, `frontend/src/app/inventory/page.product-form.test.tsx` | [#390](https://github.com/meperdev/MeperPOS/pull/390) |
| 2026-11-21 | F39 business name length | `settings/general` and `PATCH /settings/organization` (`UpdateOrganizationNameDto`) accepted an unbounded business name (1000+ chars), bypassing the admin `@MaxLength(100)` on create/update organization, and the name overflows the receipt/invoice header. The DTO now trims and caps it at `ORGANIZATION_NAME_MAX_LENGTH` (100); the form adds `maxLength` and a Zod check. | 01 | `backend/src/settings/dto/settings.dto.ts` · tests `backend/src/settings/dto/settings.dto.spec.ts`, `frontend/src/app/settings/(general)/general/page.behavior.test.tsx` | [#391](https://github.com/meperdev/MeperPOS/pull/391) |
| 2026-11-22 | Explorer F39: unbounded DTO strings | `UpdateOrganizationNameDto` accepted a 1000-character business name because it had `@IsString()` and no `@MaxLength`; the same footgun sat in 97 DTO fields (96 now bounded; the unused multipart `UploadImageDto.file` carries a reasoned disable). In `*.dto.ts`, `@IsString()` now needs `@MaxLength`/`@Length` (`each: true` for arrays) unless `@IsEnum`, `@IsIn`, `@IsUUID`, `@IsEmail`, `@IsUrl`, `@IsISO8601`, `@IsDateString`, `@IsValidPassword` or an anchored, bounded `@Matches` already caps it; `@IsOptional()` does not exempt and `@Matches(/\S/)` is not a bound. | 02 | `backend/eslint-plugin-meperpos/rules/require-string-length-bound.mjs` · tests `backend/eslint-plugin-meperpos/tests/require-string-length-bound.test.mjs`, `backend/src/common/dto-string-bounds.spec.ts` · bounded DTOs in `backend/src/{admin,auth,billing,cash-registers,categories,customers,expenses,exports,imports,payroll,products,purchase-orders,sales,settings,suppliers,tasks,users}/dto/` | [#393](https://github.com/meperdev/MeperPOS/pull/393) |

## Lint baseline (Phase 1)

`npm run lint:ci` became a blocking CI step in this PR. Stock-rule errors that
already existed on master `ca23465` were handled like this:

- **Fixed (behavior-free):** 8 `no-unnecessary-type-assertion` (explicit type
  arguments or dropped no-op assertions), 3 `no-require-imports` (two turned
  into imports, one stale `no-var-requires` directive renamed), 1
  `no-useless-escape`, 1 intentional `no-control-regex` given a reasoned
  disable comment.
- **Frozen, backend:** `prettier/prettier` errors in 71 files are reported as
  warnings in those files only (`backend/eslint.baseline.mjs`). New files keep
  the error.
- **Frozen, frontend:** 5 React Compiler errors (`react-hooks/set-state-in-effect`,
  `react-hooks/refs`) in 3 files are warnings in those files only (baseline
  block in `frontend/eslint.config.mjs`). Fixing them changes render behavior.
- The existing stock-rule *warnings* configured before this PR are unchanged.
- `meperpos/*` rules are never baselined: they are errors everywhere.

Both baselines may only shrink: fix a file, remove its entry, run
`npm run lint:ci`.
