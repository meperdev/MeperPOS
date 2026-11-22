---
date: 2026-11-21
layer: "02"
title: Raw error.response.data.message instead of getApiErrorMessage
source: "Phase 1 trust stack ([#387](https://github.com/meperdev/MeperPOS/pull/387))"
pr: 387
paths:
  - frontend/eslint-plugin-meperpos/rules/no-raw-api-error-message.mjs
tests:
  - frontend/eslint-plugin-meperpos/tests/no-raw-api-error-message.test.mjs
---

Reading `error.response.data.message` by hand shows a `string[]` from ValidationPipe, an empty toast, or `undefined`; `getApiErrorMessage` in `frontend/src/lib/api.ts` is the single funnel.
