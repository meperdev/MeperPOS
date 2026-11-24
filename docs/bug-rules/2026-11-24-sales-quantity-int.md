---
date: 2026-11-24
layer: "01+02"
title: Reject fractional and out-of-range sale quantities
pr:
paths:
  - backend/src/sales/dto/sales.dto.ts
  - backend/src/sales/sales.service.ts
tests:
  - backend/src/sales/dto/sales.dto.spec.ts
  - backend/src/sales/sales.quantity-validation.http.spec.ts
  - backend/src/sales/sales.service.spec.ts
  - backend/src/loans/loans.boundary.spec.ts
---

`POST /api/sales` accepted fractional quantities such as `1.5` and `2.7`:
`@IsNumber()` and `@Min(1)` let them reach pricing, even though Prisma stores
sale quantities as `Int`. Pricing can use the fraction while the persisted
quantity loses it, leaving the charged amount and stock movement inconsistent.

The request DTO now accepts only integers from `1` through `2147483647`.
Numeric strings still convert to numbers before validation, so `"2.7"` is also
rejected. The service checks the same bounds before replay, pricing, or writes
for callers that bypass the HTTP pipe. The financed POS flow retains its own
quantity validation and error contract.
