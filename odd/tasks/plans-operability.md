# Plans operability

Make the subscription lifecycle real: a trial with a deadline, a past-due tenant that cannot write, and enforcement covered by tests. Units 1, 3 and 7 of the recovered gap inventory.

## Specs

S1. Scope is the recovered inventory's units 1, 3 and 7 only:
- P1 trial: every new organization receives `trialEndsAt`.
- P3 enforcement: `PAST_DUE` blocks non-GET exactly like `SUSPENDED`; reads stay available.
- P7 coverage: specs for the plan-limit guard, the billing controller and payment records.
S2. User request, verbatim: "Oye por si por cirerte, delega exploracion, necesito saber ya el total de lo qeu falta para que los planes funciones bien bien." and the go-ahead "SI arranca".
S3. Trial length is 15 days, taken from `docs/planes/implementacion/plan-multi-tenant-completo.md:924`; it lives in `TRIAL_DAYS` so the product decision changes in one place.
S4. `PAST_DUE` read-only matches the documented intent (`docs/planes/...:252,702,924`) and keeps payment registration possible, because billing routes do not use `OrganizationStatusGuard`.
S5. The backfill is a script, dry-run by default; there is no automatic data migration.

## Tasks

| ID | Spec | Surface | Commit |
| --- | --- | --- | --- |
| P1 | S1, S3, S5 | Trial deadline on creation + trial constant + backfill script + admin hint | `afe6c80` |
| P3 | S1, S4 | `PAST_DUE` write block in the organization status guard | `afb38e4` |
| P7 | S1 | Plan-limit guard, billing controller and payment-records specs | `e927fe1` |

## Log

L1. User request, verbatim: "Oye por si por cirerte, delega exploracion, necesito saber ya el total de lo qeu falta para que los planes funciones bien bien."

L2. Decision, verbatim: "SI arranca" after the proposed order (units 1 + 3 + 7 first).

L3. Exploration evidence: `trialEndsAt` and `pastDueAt` had zero writers; the billing cron is an explicit no-op; `PAST_DUE` was not enforced; the multi-sheet import bypasses `maxProducts`; downgrade flags are never cleared and excess cash registers are not deactivated; no plan-limit guard nor billing controller/payment-records specs. Stale docs: `docs/planes/...:702,924,937`.

L4. Local dry run: `npm run backfill:trial-ends` reported 1 TRIAL organization without a deadline (Reports Golden Fixtures) and wrote nothing. Applying it remains the operator's decision.

L5. Verification: backend 89/89 across 9 targeted suites, frontend admin 59/59, `tsc` and eslint clean on both sides, `nest build` green. The whole-app Next build stays pending for a normal terminal (session cgroup pids.max=64).
