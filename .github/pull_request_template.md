## What and why

<!-- One or two sentences: the change, and the bug or need behind it. Link the issue. -->

## Trust stack

<!-- For every `fix:` PR: push the fix as high as it goes. Check exactly one. -->

The fix was raised to:

- [ ] **01 types/boundaries** — Prisma schema, TypeScript types, class-validator DTO, guard, module limit
- [ ] **02 lint/test** — `eslint-plugin-meperpos` rule (RuleTester: broken fixture fails, fixed fixture passes) or regression test
- [ ] **03 prose** — AGENTS.md or a skill (explain below why it cannot be checked mechanically)
- [ ] Not a fix (feature, chore, docs)

Rule or test path:

- [ ] Appended one row to `docs/bug-rule-log.md` (required for `fix:` PRs)

## Acceptance evidence

<!-- Command + observed result, or a CI link. Paste real output; never "should pass". -->

```text
$ npm run lint:ci
$ npm run test:eslint-plugin
$ ...
```

## Semáforo (suggested)

- [ ] **Verde** — ready for a human to merge. Never auto-merge.
- [ ] **Amarillo** — wants an AI review before the human looks at it.
- [ ] **Rojo** — needs human review. Required for new lint rules, architecture, auth, payments, inventory, or payroll.

> Agents never merge. An agent opens the PR and leaves the merge to a human.
