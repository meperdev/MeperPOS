---
date: 2026-11-27
layer: "02"
title: Integration suites wrote their fixtures into the local development database
source: "Test accounts reset (odd/tasks/test-accounts-reset.md L4, L8)"
pr:
paths:
  - backend/test/global-setup.ts
  - backend/src/testing/test-database.ts
tests:
  - backend/src/testing/test-database.spec.ts
---

`npm test` loads `.env.development`, whose `DATABASE_URL` names `inventario_db`,
the database developers log into. Integration suites only checked that
`DATABASE_URL` was non-empty, and some keep their rows on purpose as evidence
(`loans.pos-fiscal.int.spec.ts`, `loans.pos-quote-tax-code.int.spec.ts`), so
every local run left organizations such as "T4i active" / "T4i inactive" in the
development database: dozens of them, plus 164 users, which made it impossible
to tell real test accounts from fixtures. CI never saw it, because it points
`DATABASE_URL` at `meperpos_test`.

A jest `globalSetup` now moves any `DATABASE_URL` that names `inventario_db` to
`meperpos_test` on the same server and runs `prisma migrate deploy` there before
the first suite; workers inherit the new URL, and a failed migration never falls
back to the development database. `payroll-concurrency.int.spec.ts`, the one
suite that required `inventario_db`, now requires `meperpos_test`.
