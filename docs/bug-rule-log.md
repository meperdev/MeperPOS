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
| 2026-11-21 | CSRF cookie lifetime ([#392](https://github.com/meperdev/MeperPOS/pull/392)) | `csrf_token` was a session cookie while `refresh_token` lived 7 days, so a browser restart dropped only the CSRF cookie: the CSRF-guarded `POST /api/auth/refresh` answered 403 `CSRF token mismatch` and `restoreSession` sent a still-valid session to `/login`. Both cookies now take `maxAge` from the one exported `REFRESH_TTL_MS`; logout still clears `csrf_token` with the same path/httpOnly/sameSite/secure; the guard is unchanged. | 01 (with 02 tests) | `backend/src/auth/cookies.helper.ts` (`REFRESH_TTL_MS`) · tests `backend/src/auth/cookies.helper.spec.ts`, `backend/src/auth/auth.refresh.int.spec.ts`, `e2e/tests/session-restart.spec.ts` | [#392](https://github.com/meperdev/MeperPOS/pull/392) |

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
