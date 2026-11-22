---
date: 2026-11-21
layer: "01"
title: Fractional stock and minStock accepted by the product DTOs
source: "Explorer F28: fractional stock"
pr: 390
paths:
  - backend/src/products/dto/product.dto.ts
  - frontend/src/app/inventory/page.tsx
tests:
  - backend/src/products/dto/product.dto.spec.ts
  - backend/src/products/products.stock-validation.http.spec.ts
  - frontend/src/app/inventory/page.product-form.test.tsx
---

`POST /api/products` and `PUT /api/products/:id` accepted a fractional `stock`/`minStock` (e.g. `2.5`) because the DTOs used `@IsNumber()`, while `Product.stock`/`minStock` and every `InventoryMovement` quantity are `Int` whole units. The DTOs now use `@IsInt()` + `@Min(0)` (400, no silent truncation) and the inventory form sets `step={1}` `min={0}` and checks `Number.isInteger` before submitting.
