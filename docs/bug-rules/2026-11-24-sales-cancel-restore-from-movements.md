---
date: 2026-11-24
layer: "01+02"
title: Cancelling a sale restored stock from today's tracking flag instead of its SALE movements
source: "PR 4 (fix/sales-cancel-restore-from-movements)"
pr:
paths:
  - backend/src/sales/sales.service.ts
tests:
  - backend/src/sales/sales.service.selling-services.spec.ts
  - backend/src/sales/sales.service.spec.ts
---

`SalesService.create` only decrements stock and writes an `InventoryMovement`
of type `SALE` for a line whose product `tracksStock` at that moment.
`SalesService.update` with `{ status: 'CANCELLED' }` walked
`existingSale.items` and, for every line whose product tracked stock **today**,
incremented `item.quantity` and wrote a `RETURN`. It never asked whether the
sale had actually taken that stock out.

So a product sold while "Maneja inventario" was off (no `SALE` movement, no
decrement) got phantom stock when tracking was enabled later and the sale was
cancelled: the restore invented units that never left, and the kárdex recorded
a `RETURN` for them. The inverse case was just as wrong — merchandise sold with
tracking that was later converted to `SERVICE` was never restocked, because the
flag read at cancellation time was false.

Cancellation now derives its effects from the sale's own `SALE` movements: one
scoped `inventoryMovement.findMany({ saleId, organizationId, type: 'SALE' })`
inside the same transaction, after the atomic `COMPLETED -> CANCELLED` claim
and `voidSaleFiscalDocument`. Signed quantities are summed per product in a
`Map` (a movement is negative when it left stock, and repeated lines for one
product are a single restore), and each product with a positive aggregate is
restored once with the same version/reservation CAS as before, writing one
`RETURN` for the aggregated quantity. A product with no `SALE` movement is
never touched, whatever its current flags say, and a service line never had a
movement to restore.

What catches it now: the mocked-service regression tests in
`sales.service.selling-services.spec.ts` pin the movement query, both flag
directions (sold untracked then tracked -> no stock, no `RETURN`; sold tracked
then service -> stock restored) and the per-product aggregation that skips a
line with no movement. The cancellation claim, the fiscal void and the CAS
remain covered by the same suite.
