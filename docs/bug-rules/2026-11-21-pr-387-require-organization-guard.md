---
date: 2026-11-21
layer: "02"
title: Controller without OrganizationRequiredGuard becomes a cross-tenant query
source: "Phase 1 trust stack ([#387](https://github.com/meperdev/MeperPOS/pull/387))"
pr: 387
paths:
  - backend/eslint-plugin-meperpos/rules/require-organization-guard.mjs
tests:
  - backend/eslint-plugin-meperpos/tests/require-organization-guard.test.mjs
---

A controller authenticated with `JwtAuthGuard` but without `OrganizationRequiredGuard` lets `user.organizationId` arrive `undefined`, so the service fallback `...(organizationId ? { organizationId } : {})` becomes a cross-tenant query (SEC-002). Exemptions (SUPER_ADMIN platform, user-scoped auth routes, plan-limits) now carry an inline `-- reason`.
