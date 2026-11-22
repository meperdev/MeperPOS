# Bug → rule log

Append-only record of every bug or footgun that was pushed up the trust stack
into something a machine checks. Each entry is **one file** in
[`docs/bug-rules/`](bug-rules/), so two PRs that each add an entry never touch
the same lines and merge cleanly in any order.

Layers: **01** types/boundaries (Prisma, TypeScript, class-validator, guards,
module limits) · **02** lint/test (ESLint rule or regression test) · **03**
prose (AGENTS.md or a skill, only when it cannot be checked mechanically).

## Adding an entry

Every `fix:` PR adds one entry file:

1. Copy [`docs/bug-rules/_TEMPLATE.md`](bug-rules/_TEMPLATE.md) to
   `docs/bug-rules/YYYY-MM-DD-<slug>.md` (lowercase letters, digits and
   hyphens). Put the PR number in the slug when you know it
   (`2026-11-21-pr-392-csrf-cookie-ttl.md`); otherwise use a descriptive slug
   (`2026-11-21-csrf-cookie-ttl.md`). There is no sequence number and no shared
   counter, so nothing needs coordinating with other PRs.
2. Fill in the frontmatter. Required: `date` (`YYYY-MM-DD`) and `layer`
   (`"01"`, `"02"`, `"03"` or a mix like `"01+02"`; quote it so YAML keeps the
   leading zero). Optional: `title` (one-line summary), `source` (issue,
   explorer finding or audit item), `pr` (the number, or empty until the PR is
   open), `paths` (rule, type, DTO or guard paths) and `tests` (test paths),
   both lists. Extra fields are allowed.
3. Write the full bug or footgun description in the body: what broke, why the
   old code allowed it, what now catches it.

Entries are append-only: never edit or delete an earlier entry. A rule that
supersedes another gets a new entry that says which one it supersedes. Filling
in `pr` on your own entry before your PR merges is fine. Files whose name
starts with `_` (the template) are not entries.

## Reading the log

There is no committed table to keep in sync. To print one, sorted by date then
file name:

```sh
node scripts/bug-log.mjs          # markdown table on stdout (never commit it)
node scripts/bug-log.mjs --check  # only check the entry files
```

The backend `npm run test:eslint-plugin` (an existing CI step) also runs
`scripts/bug-log.test.mjs`, which only checks that each entry file present has
a conventional name and frontmatter with `date` and `layer`. It never fails
because a PR has no entry, `pr` is empty or optional fields are missing; a line
of an optional field it cannot read is only printed as a warning.

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
