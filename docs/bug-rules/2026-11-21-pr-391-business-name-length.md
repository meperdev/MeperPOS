---
date: 2026-11-21
layer: "01"
title: Unbounded business name in settings/general
source: "F39 business name length"
pr: 391
paths:
  - backend/src/settings/dto/settings.dto.ts
tests:
  - backend/src/settings/dto/settings.dto.spec.ts
  - "frontend/src/app/settings/(general)/general/page.behavior.test.tsx"
---

`settings/general` and `PATCH /settings/organization` (`UpdateOrganizationNameDto`) accepted an unbounded business name (1000+ chars), bypassing the admin `@MaxLength(100)` on create/update organization, and the name overflows the receipt/invoice header. The DTO now trims and caps it at `ORGANIZATION_NAME_MAX_LENGTH` (100); the form adds `maxLength` and a Zod check.
