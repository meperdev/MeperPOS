---
date: 2026-11-25
layer: "02"
title: Owners and super admins only saw the sales they rang up themselves
source: "Product owner testing of multi-site sales (odd/tasks/multisedes.md, L117)"
pr:
paths:
  - backend/src/sales/sales.service.ts
tests:
  - backend/src/sales/sales.service.spec.ts
---

`SalesService.buildScopeFilter` widened the sales list only for `role === 'ADMIN'`
and narrowed every other caller to `userId = caller`. `OWNER` inherits `ADMIN`
(`RolesGuard.getInheritedRoles`) and a super admin is above both, yet both fell
into the deny-by-default branch: an owner's Ventas screen showed only the sales
that owner rang up, so sales made by cashiers at another store looked lost.

The list now treats `OWNER`, `ADMIN`, `SUPER_ADMIN` and an `isSuperAdmin`
session as organization-wide, and keeps MEMBER/CASHIER on their own sales.
`sales.service.spec.ts` pins all four organization-wide identities (RED: OWNER,
SUPER_ADMIN and the platform session failed; ADMIN passed).

A pre-PR review then found the same hand-written `role !== 'ADMIN'` check in
`findOne`, `findBySaleNumber` (receipt) and `update` (cancel): the list showed
an owner a colleague's sale whose detail and receipt then answered 403. All
four now go through one private `readsEverySale(user)` helper, pinned by a
test that opens a colleague's sale by id and by number as OWNER and
SUPER_ADMIN (RED before the change) and still refuses a cashier.
