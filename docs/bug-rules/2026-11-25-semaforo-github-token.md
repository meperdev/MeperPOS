---
date: 2026-11-25
layer: "02"
title: The semáforo workflow never passed GITHUB_TOKEN, so no pull request was labelled
source: "PR #402 and #401 Semáforo runs: `semaforo skipped, nothing was changed: GITHUB_TOKEN is not set`"
pr:
paths:
  - .github/workflows/semaforo.yml
tests:
  - .github/semaforo/workflow.test.mjs
---

`.github/semaforo/run.mjs` reads its token from `process.env.GITHUB_TOKEN` and
degrades to "no change + warning" without it. GitHub generates
`secrets.GITHUB_TOKEN` for every run and the workflow already requests
`pull-requests: write`, but Actions never exports that token as an environment
variable on its own, and the step that runs the classifier had no `env:` block.
Every run therefore ended as skipped and no PR received a `semaforo:*` label or
its summary comment.

The step now sets `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`.
`workflow.test.mjs`, which CI already runs with the other semáforo tests, fails
when that step stops passing the token or the workflow drops
`pull-requests: write` (RED before the change, GREEN after).
