# Backend Authorization Matrix

Living inventory of every backend route: path × method × role(s) × org-scope × test reference.

- Hand-authored with judgment (roles and org-scope need human interpretation); a CI coverage spec
  (`backend/src/common/matrix-coverage.spec.ts`) diffs this file against the OpenAPI document built
  from `AppModule` and asserts every referenced test file exists, so route drift breaks the build.
- Tracks issues [#47](https://github.com/MeperDonas/MeperPOS/issues/47) and
  [#48](https://github.com/MeperDonas/MeperPOS/issues/48).
- **Supersedes** the static 142-item matrix in
  `docs/reportes/verify-report-multi-tenant.md:354-367`, which remains as a point-in-time audit
  precedent but is no longer updated.

## Org-scope legend

| Value | Meaning |
|---|---|
| `org-scoped` | Route data is filtered by `organizationId` in the service layer; cross-org access must 404 (two-org isolation specs). |
| `org-required` | Route requires an organization context (OrganizationRequiredGuard) but reads/writes a single shared org row without per-row filtering. |
| `superadmin-global` | Only SUPER_ADMIN; operates across organizations via `X-Organization-Id`. |
| `authenticated-global` | Requires a valid JWT but no organization context (own profile, token flows). |
| `pre-auth-public` | No JWT required (login, refresh, health). |
| `provider-hmac` | No JWT; requires WAHA HMAC over the exact request body and does not process events. |

Roles: `OWNER`, `ADMIN`, `MEMBER`, `CASHIER`, `INVENTORY_USER` (org roles), `SUPER_ADMIN` (platform).
"any org role" = any authenticated membership role (no `@Roles` restriction).
Where a row shows an inherited role in parentheses — `ADMIN (OWNER inherits)`, `CASHIER (OWNER, ADMIN, MEMBER inherit)` — the leading value is the single role declared in `@Roles(...)` and the parenthetical is what `RolesGuard.getInheritedRoles` additionally admits.

---

## app

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api | GET | public | pre-auth-public | backend/src/app.controller.spec.ts |
| /api/health | GET | public | pre-auth-public | backend/src/app.controller.spec.ts |

## whatsapp

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/whatsapp/session | POST | ADMIN (OWNER inherits) | org-scoped | backend/src/whatsapp/whatsapp.controller.spec.ts |
| /api/whatsapp/session | GET | ADMIN (OWNER inherits) | org-scoped | backend/src/whatsapp/whatsapp.controller.spec.ts |
| /api/whatsapp/session/qr | GET | ADMIN (OWNER inherits) | org-scoped | backend/src/whatsapp/whatsapp.controller.spec.ts |
| /api/whatsapp/webhook | POST | WAHA HMAC | provider-hmac | backend/src/whatsapp/whatsapp-webhook.spec.ts |

## auth

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/auth/login | POST | public | pre-auth-public | backend/src/auth/auth.controller.spec.ts |
| /api/auth/select-organization | POST | partial-token holder | pre-auth-public | backend/src/auth/auth.controller.spec.ts |
| /api/auth/organizations | GET | any authenticated | authenticated-global | backend/src/auth/auth.controller.spec.ts |
| /api/auth/profile | GET | any authenticated | authenticated-global | backend/src/auth/auth.controller.spec.ts |
| /api/auth/profile | PUT | any authenticated | authenticated-global | backend/src/auth/auth.controller.spec.ts |
| /api/auth/change-password | POST | any authenticated | authenticated-global | backend/src/auth/auth.service.spec.ts |
| /api/auth/refresh | POST | refresh-cookie holder | pre-auth-public | backend/src/auth/auth.service.spec.ts |
| /api/auth/logout | POST | public (cookie-aware) | pre-auth-public | backend/src/auth/auth.controller.spec.ts |
| /api/auth/select-org | POST | any authenticated | authenticated-global | backend/src/auth/auth.controller.spec.ts |

## admin (platform)

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/admin/organizations | POST | SUPER_ADMIN | superadmin-global | backend/src/admin/admin.controller.spec.ts |
| /api/admin/organizations | GET | SUPER_ADMIN | superadmin-global | backend/src/admin/admin.controller.spec.ts |
| /api/admin/organizations/:id | GET | SUPER_ADMIN | superadmin-global | backend/src/admin/admin.controller.spec.ts |
| /api/admin/organizations/:id/status | PATCH | SUPER_ADMIN | superadmin-global | backend/src/admin/admin.controller.spec.ts |
| /api/admin/organizations/:id/plan | PATCH | SUPER_ADMIN | superadmin-global | backend/src/admin/admin.controller.spec.ts |
| /api/admin/organizations/:id/transfer-owner | POST | SUPER_ADMIN | superadmin-global | backend/src/admin/admin.controller.spec.ts |
| /api/admin/metrics | GET | SUPER_ADMIN | superadmin-global | backend/src/admin/admin.controller.spec.ts |
| /api/admin/organizations/:id | PATCH | SUPER_ADMIN | superadmin-global | backend/src/admin/admin.controller.spec.ts |
| /api/admin/organizations/:id/members | POST | SUPER_ADMIN | superadmin-global | backend/src/admin/admin.controller.spec.ts |
| /api/admin/organizations/:id/members/:userId/role | PATCH | SUPER_ADMIN | superadmin-global | backend/src/admin/admin.controller.spec.ts |
| /api/admin/organizations/:id/members/:userId | DELETE | SUPER_ADMIN | superadmin-global | backend/src/admin/admin.controller.spec.ts |
| /api/admin/organizations/:id | DELETE | SUPER_ADMIN | superadmin-global | backend/src/admin/admin.controller.spec.ts |

## billing

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/billing/payments | GET | OWNER, ADMIN | org-scoped | backend/src/billing/billing.service.spec.ts |
| /api/billing/payments | POST | SUPER_ADMIN | org-required | backend/src/billing/billing.service.spec.ts |
| /api/billing/status | GET | ADMIN, CASHIER, INVENTORY_USER | org-scoped | backend/src/billing/billing.service.spec.ts |

## cash-registers

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/cash-registers | POST | ADMIN | org-scoped | backend/src/cash-registers/cash-registers.service.int.spec.ts |
| /api/cash-registers | GET | ADMIN, MEMBER | org-scoped | backend/src/cash-registers/cash-registers.service.int.spec.ts |
| /api/cash-registers/:id | GET | ADMIN, MEMBER | org-scoped | backend/src/cash-registers/cash-registers.service.int.spec.ts |
| /api/cash-registers/:id | PUT | ADMIN | org-scoped | backend/src/cash-registers/cash-registers.service.int.spec.ts |
| /api/cash-registers/:id | DELETE | ADMIN | org-scoped | backend/src/cash-registers/cash-registers.service.int.spec.ts |

## categories

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/categories | POST | ADMIN, MEMBER | org-scoped | backend/src/categories/categories.service.int.spec.ts |
| /api/categories | GET | ADMIN, MEMBER, CASHIER | org-scoped | backend/src/categories/categories.service.int.spec.ts |
| /api/categories/:id | GET | ADMIN, MEMBER | org-scoped | backend/src/categories/categories.service.int.spec.ts |
| /api/categories/:id | PUT | ADMIN, MEMBER | org-scoped | backend/src/categories/categories.service.int.spec.ts |
| /api/categories/:id | DELETE | ADMIN, MEMBER | org-scoped | backend/src/categories/categories.service.int.spec.ts |

## customers

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/customers | POST | ADMIN, MEMBER, CASHIER | org-scoped | backend/src/customers/customers.service.int.spec.ts |
| /api/customers | GET | ADMIN, MEMBER, CASHIER | org-scoped | backend/src/customers/customers.service.int.spec.ts |
| /api/customers/document/:documentNumber | GET | ADMIN, MEMBER, CASHIER | org-scoped | backend/src/customers/customers.service.int.spec.ts |
| /api/customers/:id | GET | ADMIN, MEMBER, CASHIER | org-scoped | backend/src/customers/customers.service.int.spec.ts |
| /api/customers/:id | PUT | ADMIN | org-scoped | backend/src/customers/customers.service.int.spec.ts |
| /api/customers/:id | DELETE | ADMIN | org-scoped | backend/src/customers/customers.service.int.spec.ts |

## expenses

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/expenses | POST | ADMIN | org-scoped | backend/src/expenses/expenses.service.int.spec.ts |
| /api/expenses | GET | ADMIN | org-scoped | backend/src/expenses/expenses.service.int.spec.ts |
| /api/expenses/summary/monthly | GET | ADMIN | org-scoped | backend/src/expenses/expenses.service.int.spec.ts |
| /api/expenses/:id | GET | ADMIN | org-scoped | backend/src/expenses/expenses.service.int.spec.ts |
| /api/expenses/:id/history | GET | ADMIN | org-scoped | backend/src/expenses/expenses.service.int.spec.ts |
| /api/expenses/:id | PATCH | ADMIN | org-scoped | backend/src/expenses/expenses.service.int.spec.ts |
| /api/expenses/:id/payments | POST | ADMIN | org-scoped | backend/src/expenses/expenses.service.int.spec.ts |
| /api/expenses/:id/duplicate | POST | ADMIN | org-scoped | backend/src/expenses/expenses.service.int.spec.ts |
| /api/expenses/:id/upload | POST | ADMIN | org-scoped | backend/src/expenses/expenses.service.int.spec.ts |
| /api/expenses/:id | DELETE | ADMIN | org-scoped | backend/src/expenses/expenses.service.int.spec.ts |

## expense-groups

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/expense-groups | GET | ADMIN | org-scoped | backend/src/expenses/expense-taxonomy.controller.spec.ts |
| /api/expense-groups | POST | ADMIN | org-scoped | backend/src/expenses/expense-taxonomy.controller.spec.ts |
| /api/expense-groups/:id | PATCH | ADMIN | org-scoped | backend/src/expenses/expense-taxonomy.controller.spec.ts |
| /api/expense-groups/:id | DELETE | ADMIN | org-scoped | backend/src/expenses/expense-taxonomy.controller.spec.ts |
| /api/expense-groups/:groupId/labels | GET | ADMIN | org-scoped | backend/src/expenses/expense-taxonomy.controller.spec.ts |
| /api/expense-groups/:groupId/labels | POST | ADMIN | org-scoped | backend/src/expenses/expense-taxonomy.controller.spec.ts |
| /api/expense-groups/:groupId/labels/:id | PATCH | ADMIN | org-scoped | backend/src/expenses/expense-taxonomy.controller.spec.ts |
| /api/expense-groups/:groupId/labels/:id | DELETE | ADMIN | org-scoped | backend/src/expenses/expense-taxonomy.controller.spec.ts |

## exports

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/exports/inventory | GET | ADMIN, MEMBER | org-scoped | backend/src/exports/exports.service.spec.ts |
| /api/exports/sales | POST | ADMIN | org-scoped | backend/src/exports/exports.service.spec.ts |
| /api/exports/products | POST | ADMIN, MEMBER | org-scoped | backend/src/exports/exports.service.spec.ts |
| /api/exports/customers | POST | ADMIN | org-scoped | backend/src/exports/exports.service.spec.ts |
| /api/exports/inventory | POST | ADMIN, MEMBER | org-scoped | backend/src/exports/exports.service.spec.ts |
| /api/exports/expenses | POST | ADMIN | org-scoped | backend/src/exports/exports.service.spec.ts |
| /api/exports/economic | POST | ADMIN | org-scoped | backend/src/exports/exports.service.spec.ts |

## imports

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/imports/products/template | GET | ADMIN, CASHIER | org-scoped | backend/src/imports/imports.service.int.spec.ts |
| /api/imports/products | POST | ADMIN, CASHIER | org-scoped | backend/src/imports/imports.service.int.spec.ts |
| /api/imports/full-template | GET | ADMIN, CASHIER | org-scoped | backend/src/imports/imports.service.int.spec.ts |
| /api/imports/full | POST | ADMIN, CASHIER | org-scoped | backend/src/imports/imports.service.int.spec.ts |
| /api/imports/:jobId/status | GET | ADMIN, CASHIER | org-scoped | backend/src/imports/imports.service.int.spec.ts |
| /api/imports/:jobId/retry-row | POST | ADMIN, CASHIER | org-scoped | backend/src/imports/imports.service.int.spec.ts |

## loans

All rows below are served by `backend/src/loans/loans.controller.ts`; the controller mounts
`JwtAuthGuard`, `RolesGuard` and `OrganizationRequiredGuard`, and every read/mutation is filtered by
`organizationId` in `LoansService`.

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/loans/pos-initiation | POST | CASHIER (OWNER, ADMIN, MEMBER inherit) | org-scoped | backend/src/loans/loans.pos-initiation.spec.ts |
| /api/loans/:id/pos-completion | POST | CASHIER (OWNER, ADMIN, MEMBER inherit) | org-scoped | backend/src/loans/loans.boundary.spec.ts |
| /api/loans | POST | ADMIN (OWNER inherits) | org-scoped | backend/src/loans/loans.boundary.spec.ts |
| /api/loans/:id/collections | POST | CASHIER (OWNER, ADMIN, MEMBER inherit) | org-scoped | backend/src/loans/loans.lifecycle.spec.ts |
| /api/loans/:id/collections/:paymentId/reverse | POST | ADMIN (OWNER inherits) | org-scoped | backend/src/loans/loans.lifecycle.spec.ts |
| /api/loans/:id/close | POST | ADMIN (OWNER inherits) | org-scoped | backend/src/loans/loans.lifecycle.spec.ts |
| /api/loans/:id/cancel | POST | ADMIN (OWNER inherits) | org-scoped | backend/src/loans/loans.lifecycle.spec.ts |
| /api/loans | GET | CASHIER (OWNER, ADMIN, MEMBER inherit) | org-scoped | backend/src/loans/loans.service.spec.ts |
| /api/loans/:id | GET | CASHIER (OWNER, ADMIN, MEMBER inherit) | org-scoped | backend/src/loans/loans.service.spec.ts |
| /api/loans/:id/history | GET | CASHIER (OWNER, ADMIN, MEMBER inherit) | org-scoped | backend/src/loans/loans.service.spec.ts |

Note: `InventoryLoansController` (`backend/src/loans/inventory-loans.controller.ts`, all routes
`@Roles(OrgRole.OWNER, OrgRole.ADMIN)`) is a prepared artifact that is deliberately **unregistered**
in every module, so it is absent from the OpenAPI document and has no rows here. Wire it into a
module and add its rows in the same change that exposes it.

## plan-limits

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/plan-limits/status | GET | any authenticated | authenticated-global | backend/src/plan-limits/plan-limits.service.spec.ts |

## products

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/products | POST | ADMIN, MEMBER | org-scoped | backend/src/products/products.service.int.spec.ts |
| /api/products | GET | any org role | org-scoped | backend/src/products/products.service.int.spec.ts |
| /api/products/low-stock | GET | ADMIN, MEMBER | org-scoped | backend/src/products/products.service.int.spec.ts |
| /api/products/search | GET | ADMIN, MEMBER, CASHIER | org-scoped | backend/src/products/products.controller.spec.ts |
| /api/products/quick-search | GET | ADMIN, MEMBER, CASHIER | org-scoped | backend/src/products/products.controller.spec.ts |
| /api/products/:id | GET | any org role | org-scoped | backend/src/products/products.service.int.spec.ts |
| /api/products/:id | PUT | ADMIN, MEMBER | org-scoped | backend/src/products/products.service.int.spec.ts |
| /api/products/:id/deactivate | PUT | ADMIN, MEMBER | org-scoped | backend/src/products/products.service.int.spec.ts |
| /api/products/:id/reactivate | PUT | ADMIN, MEMBER | org-scoped | backend/src/products/products.service.int.spec.ts |
| /api/products/:id | DELETE | ADMIN, MEMBER | org-scoped | backend/src/products/products.service.int.spec.ts |
| /api/products/upload | POST | ADMIN, MEMBER | org-scoped | backend/src/products/products.controller.spec.ts |
| /api/products/:id/upload | POST | ADMIN, MEMBER | org-scoped | backend/src/products/products.service.int.spec.ts |

Note: `GET /api/products/search` and `GET /api/products/quick-search` are served by the registered
`products.controller.ts`; the retired unregistered `products-search.controller.ts` was deleted
(see change `pos-cashier-search`).

## purchase-orders

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/purchase-orders | POST | ADMIN, MEMBER | org-scoped | backend/src/purchase-orders/purchase-orders.service.int.spec.ts |
| /api/purchase-orders | GET | ADMIN, MEMBER | org-scoped | backend/src/purchase-orders/purchase-orders.service.int.spec.ts |
| /api/purchase-orders/:id | GET | ADMIN, MEMBER | org-scoped | backend/src/purchase-orders/purchase-orders.service.int.spec.ts |
| /api/purchase-orders/:id | PATCH | ADMIN, MEMBER | org-scoped | backend/src/purchase-orders/purchase-orders.service.int.spec.ts |
| /api/purchase-orders/:id/confirm | POST | ADMIN, MEMBER | org-scoped | backend/src/purchase-orders/purchase-orders.service.int.spec.ts |
| /api/purchase-orders/:id/receive | POST | ADMIN, MEMBER | org-scoped | backend/src/purchase-orders/purchase-orders.service.int.spec.ts |
| /api/purchase-orders/:id/cancel | POST | ADMIN, MEMBER | org-scoped | backend/src/purchase-orders/purchase-orders.service.int.spec.ts |

## reports

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/reports/daily-report | GET | ADMIN | org-scoped | backend/src/reports/daily-report.http.spec.ts |
| /api/reports/daily-report/pdf | GET | ADMIN | org-scoped | backend/src/reports/daily-report.http.spec.ts |
| /api/reports/dashboard | GET | ADMIN | org-scoped | backend/src/reports/reports.service.spec.ts |
| /api/reports/economic | GET | ADMIN | org-scoped | backend/src/reports/financial-reports.service.int.spec.ts |
| /api/reports/economic/cash | GET | ADMIN | org-scoped | backend/src/reports/financial-reports.service.int.spec.ts |
| /api/reports/economic/inventory | GET | ADMIN | org-scoped | backend/src/reports/financial-reports.service.int.spec.ts |
| /api/reports/sales/payment-method | GET | ADMIN | org-scoped | backend/src/reports/reports.service.spec.ts |
| /api/reports/sales/category | GET | ADMIN | org-scoped | backend/src/reports/reports.service.spec.ts |
| /api/reports/sales/category-daily | GET | ADMIN | org-scoped | backend/src/reports/reports.service.spec.ts |
| /api/reports/products/top-selling | GET | ADMIN | org-scoped | backend/src/reports/reports.service.spec.ts |
| /api/reports/customers/statistics | GET | ADMIN | org-scoped | backend/src/reports/reports.service.spec.ts |
| /api/reports/users/performance | GET | ADMIN | org-scoped | backend/src/reports/reports.service.spec.ts |
| /api/reports/sales/daily | GET | ADMIN | org-scoped | backend/src/reports/reports.service.spec.ts |

## sales

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/sales | POST | ADMIN, MEMBER, CASHIER | org-scoped | backend/src/sales/sales.service.int.spec.ts |
| /api/sales | GET | ADMIN, MEMBER, CASHIER | org-scoped | backend/src/sales/sales.service.int.spec.ts |
| /api/sales/number/:saleNumber | GET | ADMIN, MEMBER, CASHIER | org-scoped | backend/src/sales/sales.service.int.spec.ts |
| /api/sales/:id | GET | ADMIN, MEMBER, CASHIER | org-scoped | backend/src/sales/sales.service.int.spec.ts |
| /api/sales/:id | PUT | ADMIN | org-scoped | backend/src/sales/sales.service.int.spec.ts |
| /api/sales/:id/force-close | POST | ADMIN | org-scoped | backend/src/sales/sales.service.int.spec.ts |
| /api/sales/:id/receipt | POST | ADMIN, MEMBER, CASHIER | org-scoped | backend/src/sales/sales.service.int.spec.ts |

## settings

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/settings | GET | ADMIN | org-required | backend/src/settings/settings.service.spec.ts |
| /api/settings/default | GET | ADMIN | org-required | backend/src/settings/settings.service.spec.ts |
| /api/settings | PUT | ADMIN | org-required | backend/src/settings/settings.service.spec.ts |
| /api/settings/logo | POST | ADMIN | org-required | backend/src/settings/settings.service.spec.ts |
| /api/settings/organization | PATCH | ADMIN | org-required | backend/src/settings/settings.service.spec.ts |
| /api/settings/receipt-prefix | PATCH | ADMIN | org-required | backend/src/settings/settings.service.spec.ts |

## suppliers

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/suppliers | POST | ADMIN, MEMBER | org-scoped | backend/src/suppliers/suppliers.service.int.spec.ts |
| /api/suppliers | GET | ADMIN, MEMBER | org-scoped | backend/src/suppliers/suppliers.service.int.spec.ts |
| /api/suppliers/:id | GET | ADMIN, MEMBER | org-scoped | backend/src/suppliers/suppliers.service.int.spec.ts |
| /api/suppliers/:id | PATCH | ADMIN, MEMBER | org-scoped | backend/src/suppliers/suppliers.service.int.spec.ts |
| /api/suppliers/:id | DELETE | ADMIN, MEMBER | org-scoped | backend/src/suppliers/suppliers.service.int.spec.ts |
| /api/suppliers/:id/reactivate | POST | ADMIN, MEMBER | org-scoped | backend/src/suppliers/suppliers.service.int.spec.ts |

## tasks

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/tasks | POST | OWNER, ADMIN, MEMBER, CASHIER, INVENTORY_USER | org-scoped | backend/src/tasks/tasks.service.spec.ts |
| /api/tasks | GET | OWNER, ADMIN, MEMBER, CASHIER, INVENTORY_USER | org-scoped | backend/src/tasks/tasks.service.spec.ts |
| /api/tasks/assignees | GET | OWNER, ADMIN, MEMBER, CASHIER, INVENTORY_USER | org-scoped | backend/src/tasks/tasks.service.spec.ts |
| /api/tasks/:id/timeline | GET | OWNER, ADMIN, MEMBER, CASHIER, INVENTORY_USER | org-scoped | backend/src/tasks/tasks.service.spec.ts |
| /api/tasks/:id | GET | OWNER, ADMIN, MEMBER, CASHIER, INVENTORY_USER | org-scoped | backend/src/tasks/tasks.service.spec.ts |
| /api/tasks/:id | PUT | OWNER, ADMIN, MEMBER, CASHIER, INVENTORY_USER | org-scoped | backend/src/tasks/tasks.service.spec.ts |
| /api/tasks/:id/status | PUT | OWNER, ADMIN, MEMBER, CASHIER, INVENTORY_USER | org-scoped | backend/src/tasks/tasks.service.spec.ts |
| /api/tasks/:id | DELETE | OWNER, ADMIN, MEMBER, CASHIER, INVENTORY_USER | org-scoped | backend/src/tasks/tasks.service.spec.ts |

## users

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/users | POST | ADMIN | org-scoped | backend/src/users/users.service.int.spec.ts |
| /api/users | GET | ADMIN | org-scoped | backend/src/users/users.service.int.spec.ts |
| /api/users/:id | PUT | ADMIN | org-scoped | backend/src/users/users.service.int.spec.ts |
| /api/users/:id/toggle-active | PUT | ADMIN | org-scoped | backend/src/users/users.service.int.spec.ts |
| /api/users/:id/reset-password | POST | ADMIN | org-scoped | backend/src/users/users.service.int.spec.ts |
| /api/users/:id | DELETE | ADMIN | org-scoped | backend/src/users/users.service.int.spec.ts |

---

## Known residual risks (tracked, not yet fixed)

The `organizationId ? { organizationId } : {}` idiom tolerates a missing org context as an implicit
all-organizations query on some read paths. For regular org users the OrganizationRequiredGuard
guarantees the header, so residual exposure is the superadmin-without-header path:

- products: findAll, findOne, searchProducts, quickSearch
- sales: findAll, findOne, findBySaleNumber
- cash-registers: countByOrg (zero callers)

Routed to the design owner for a follow-up inside the auth work (issue #48 slice C) or a dedicated
micro-PR (issue #47).

## Issue #134 final regression evidence

- Backend: 88 suites and 859 tests passed.
- Frontend: 71 files and 398 tests passed.
- Database migration status was up to date.
- Rollback is performed by restoring a database snapshot; no reverse migration is provided.
- The earlier timeout in `frontend/src/app/tasks/page.evidence.test.tsx` was pre-existing and passed
  when run in isolation.
