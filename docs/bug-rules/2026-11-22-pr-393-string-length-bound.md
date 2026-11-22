---
date: 2026-11-22
layer: "02"
title: "@IsString() DTO fields without a length bound"
source: "Explorer F39: unbounded DTO strings"
pr: 393
paths:
  - backend/eslint-plugin-meperpos/rules/require-string-length-bound.mjs
  - "backend/src/{admin,auth,billing,cash-registers,categories,customers,expenses,exports,imports,payroll,products,purchase-orders,sales,settings,suppliers,tasks,users}/dto/ (bounded DTOs)"
tests:
  - backend/eslint-plugin-meperpos/tests/require-string-length-bound.test.mjs
  - backend/src/common/dto-string-bounds.spec.ts
---

`UpdateOrganizationNameDto` accepted a 1000-character business name because it had `@IsString()` and no `@MaxLength`; the same footgun sat in 97 DTO fields (96 now bounded; the unused multipart `UploadImageDto.file` carries a reasoned disable). In `*.dto.ts`, `@IsString()` now needs `@MaxLength`/`@Length` (`each: true` for arrays) unless `@IsEnum`, `@IsIn`, `@IsUUID`, `@IsEmail`, `@IsUrl`, `@IsISO8601`, `@IsDateString`, `@IsValidPassword` or an anchored, bounded `@Matches` already caps it; `@IsOptional()` does not exempt and `@Matches(/\S/)` is not a bound.
