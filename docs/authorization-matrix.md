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

Roles: `ADMIN`, `CASHIER`, `INVENTORY_USER` (org roles), `SUPER_ADMIN` (platform).
"any org role" = any authenticated membership role (no `@Roles` restriction).
Where a row shows an inherited role in parentheses — `CASHIER (ADMIN inherits)` — the leading value is the single role declared in `@Roles(...)` and the parenthetical is what `RolesGuard.getEffectiveRoles` additionally admits.

---

## app

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api | GET | public | pre-auth-public | backend/src/app.controller.spec.ts |
| /api/health | GET | public | pre-auth-public | backend/src/app.controller.spec.ts |

## whatsapp

The module runs two independent WAHA sessions inside one instance. The commercial session belongs to
exactly one organization: its name is derived from the authenticated token's organization, so it is
created, started, stopped and restarted only for the caller's own tenant. The intelligence session is
a single central channel owned by the platform, has no organization scope, and is reachable only by a
platform `SUPER_ADMIN`; it is deliberately guarded without `OrganizationRequiredGuard`. Neither
controller accepts a session name from the request. Unlinking and re-linking are central-only as well:
unlinking the commercial number from a distant machine would leave customers unanswered until somebody
reaches the phone, so `logout` and `relink` are implemented against the intelligence channel only.

The delivery routes supervise the daily report. Reads return the calling organization's recent
attempts, bounded to 30 rows; a delivery row carries no organization of its own, so the tenant comes
from the connection it ran on, and the central INTELLIGENCE connection's rows are shown only when that
connection speaks for exactly one organization. The send route delivers to the caller's own verified
identity and returns the delivery service's outcome; a caller with no verified identity is answered
with a 409 instead of an error.

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/whatsapp/commercial/session | POST | ADMIN | org-scoped | backend/src/whatsapp/whatsapp-commercial.controller.spec.ts |
| /api/whatsapp/commercial/session | GET | ADMIN | org-scoped | backend/src/whatsapp/whatsapp-commercial.controller.spec.ts |
| /api/whatsapp/commercial/session/qr | GET | ADMIN | org-scoped | backend/src/whatsapp/whatsapp-commercial.controller.spec.ts |
| /api/whatsapp/commercial/session/stop | POST | ADMIN | org-scoped | backend/src/whatsapp/whatsapp-commercial.controller.spec.ts |
| /api/whatsapp/commercial/session/restart | POST | ADMIN | org-scoped | backend/src/whatsapp/whatsapp-commercial.controller.spec.ts |
| /api/whatsapp/intelligence/session | POST | SUPER_ADMIN | superadmin-global | backend/src/whatsapp/whatsapp-intelligence.controller.spec.ts |
| /api/whatsapp/intelligence/session | GET | SUPER_ADMIN | superadmin-global | backend/src/whatsapp/whatsapp-intelligence.controller.spec.ts |
| /api/whatsapp/intelligence/session/qr | GET | SUPER_ADMIN | superadmin-global | backend/src/whatsapp/whatsapp-intelligence.controller.spec.ts |
| /api/whatsapp/intelligence/session/stop | POST | SUPER_ADMIN | superadmin-global | backend/src/whatsapp/whatsapp-intelligence.controller.spec.ts |
| /api/whatsapp/intelligence/session/restart | POST | SUPER_ADMIN | superadmin-global | backend/src/whatsapp/whatsapp-intelligence.controller.spec.ts |
| /api/whatsapp/intelligence/session/logout | POST | SUPER_ADMIN | superadmin-global | backend/src/whatsapp/whatsapp-intelligence.controller.spec.ts |
| /api/whatsapp/intelligence/session/relink | POST | SUPER_ADMIN | superadmin-global | backend/src/whatsapp/whatsapp-intelligence.controller.spec.ts |
| /api/whatsapp/identity | GET | ADMIN | org-scoped | backend/src/whatsapp/whatsapp-identity.controller.spec.ts |
| /api/whatsapp/identity/challenge | POST | ADMIN | org-scoped | backend/src/whatsapp/whatsapp-identity.controller.spec.ts |
| /api/whatsapp/identity/:id | DELETE | ADMIN | org-scoped | backend/src/whatsapp/whatsapp-identity.controller.spec.ts |
| /api/whatsapp/deliveries | GET | ADMIN | org-scoped | backend/src/whatsapp/whatsapp-delivery.controller.spec.ts |
| /api/whatsapp/deliveries/automatic | GET | ADMIN | org-scoped | backend/src/whatsapp/whatsapp-delivery.controller.spec.ts |
| /api/whatsapp/deliveries/report | POST | ADMIN | org-scoped | backend/src/whatsapp/whatsapp-delivery.controller.spec.ts |
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
| /api/admin/organizations/:id/electronic-invoicing | PATCH | SUPER_ADMIN | superadmin-global | backend/src/admin/admin.controller.spec.ts |
| /api/admin/organizations/:organizationId/modules | GET | SUPER_ADMIN | superadmin-global | backend/src/business-modules/admin-business-modules.controller.spec.ts |
| /api/admin/organizations/:organizationId/modules/:moduleId | PATCH | SUPER_ADMIN | superadmin-global | backend/src/business-modules/admin-business-modules.controller.spec.ts |
| /api/admin/organizations/:id/transfer-owner | POST | SUPER_ADMIN | superadmin-global | backend/src/admin/admin.controller.spec.ts |
| /api/admin/metrics | GET | SUPER_ADMIN | superadmin-global | backend/src/admin/admin.controller.spec.ts |
| /api/admin/modules | GET | SUPER_ADMIN | superadmin-global | backend/src/business-modules/admin-module-catalog.controller.spec.ts |
| /api/admin/organizations/:id | PATCH | SUPER_ADMIN | superadmin-global | backend/src/admin/admin.controller.spec.ts |
| /api/admin/organizations/:id/members | POST | SUPER_ADMIN | superadmin-global | backend/src/admin/admin.controller.spec.ts |
| /api/admin/organizations/:id/members/:userId/role | PATCH | SUPER_ADMIN | superadmin-global | backend/src/admin/admin.controller.spec.ts |
| /api/admin/organizations/:id/members/:userId | DELETE | SUPER_ADMIN | superadmin-global | backend/src/admin/admin.controller.spec.ts |
| /api/admin/organizations/:id | DELETE | SUPER_ADMIN | superadmin-global | backend/src/admin/admin.controller.spec.ts |

## billing

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/billing/payments | GET | ADMIN | org-scoped | backend/src/billing/billing.service.spec.ts |
| /api/billing/payments | POST | SUPER_ADMIN | org-required | backend/src/billing/billing.service.spec.ts |
| /api/billing/status | GET | ADMIN, CASHIER, INVENTORY_USER | org-scoped | backend/src/billing/billing.service.spec.ts |

## cash-registers

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/cash-registers | POST | ADMIN | org-scoped | backend/src/cash-registers/cash-registers.service.int.spec.ts |
| /api/cash-registers | GET | ADMIN | org-scoped | backend/src/cash-registers/cash-registers.service.int.spec.ts |
| /api/cash-registers/:id | GET | ADMIN | org-scoped | backend/src/cash-registers/cash-registers.service.int.spec.ts |
| /api/cash-registers/:id | PUT | ADMIN | org-scoped | backend/src/cash-registers/cash-registers.service.int.spec.ts |
| /api/cash-registers/:id | DELETE | ADMIN | org-scoped | backend/src/cash-registers/cash-registers.service.int.spec.ts |

## categories

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/categories | POST | ADMIN | org-scoped | backend/src/categories/categories.service.int.spec.ts |
| /api/categories | GET | ADMIN, CASHIER | org-scoped | backend/src/categories/categories.service.int.spec.ts |
| /api/categories/:id | GET | ADMIN | org-scoped | backend/src/categories/categories.service.int.spec.ts |
| /api/categories/:id | PUT | ADMIN | org-scoped | backend/src/categories/categories.service.int.spec.ts |
| /api/categories/:id | DELETE | ADMIN | org-scoped | backend/src/categories/categories.service.int.spec.ts |

## customers

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/customers | POST | ADMIN, CASHIER | org-scoped | backend/src/customers/customers.service.int.spec.ts |
| /api/customers | GET | ADMIN, CASHIER | org-scoped | backend/src/customers/customers.service.int.spec.ts |
| /api/customers/document/:documentNumber | GET | ADMIN, CASHIER | org-scoped | backend/src/customers/customers.service.int.spec.ts |
| /api/customers/:id | GET | ADMIN, CASHIER | org-scoped | backend/src/customers/customers.service.int.spec.ts |
| /api/customers/:id | PUT | ADMIN | org-scoped | backend/src/customers/customers.service.int.spec.ts |
| /api/customers/:id | DELETE | ADMIN | org-scoped | backend/src/customers/customers.service.int.spec.ts |
| /api/customers/:customerId/vehicles | GET | ADMIN, CASHIER | org-scoped, vehicles enabled | backend/src/customers/customer-vehicles.service.int.spec.ts |
| /api/customers/:customerId/vehicles | POST | ADMIN, CASHIER | org-scoped, vehicles enabled | backend/src/customers/customer-vehicles.service.int.spec.ts |
| /api/customers/:customerId/vehicles/:vehicleId | PATCH | ADMIN | org-scoped, vehicles enabled | backend/src/customers/customer-vehicles.service.int.spec.ts |

## business-modules

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/business-modules | GET | authenticated | org-required | backend/src/business-modules/business-modules.controller.spec.ts |

## employees

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/employees | POST | ADMIN | org-scoped | backend/src/payroll/employees.controller.spec.ts |
| /api/employees | GET | ADMIN | org-scoped | backend/src/payroll/employees.controller.spec.ts |
| /api/employees/shifts | POST | ADMIN | org-scoped | backend/src/payroll/employee-shifts.service.spec.ts |
| /api/employees/shifts/:shiftId | GET | ADMIN | org-scoped | backend/src/payroll/employee-shifts.service.spec.ts |
| /api/employees/:id/shifts | GET | ADMIN | org-scoped | backend/src/payroll/employee-shifts.service.spec.ts |
| /api/employees/:id | GET | ADMIN | org-scoped | backend/src/payroll/employees.controller.spec.ts |
| /api/employees/:id | PATCH | ADMIN | org-scoped | backend/src/payroll/employees.controller.spec.ts |
| /api/employees/:id/active | PATCH | ADMIN | org-scoped | backend/src/payroll/employees.controller.spec.ts |

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
| /api/exports/inventory | GET | ADMIN | org-scoped | backend/src/exports/exports.service.spec.ts |
| /api/exports/sales | POST | ADMIN | org-scoped | backend/src/exports/exports.service.spec.ts |
| /api/exports/products | POST | ADMIN | org-scoped | backend/src/exports/exports.service.spec.ts |
| /api/exports/customers | POST | ADMIN | org-scoped | backend/src/exports/exports.service.spec.ts |
| /api/exports/inventory | POST | ADMIN | org-scoped | backend/src/exports/exports.service.spec.ts |
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
| /api/loans/pos-initiation | POST | CASHIER (ADMIN inherits) | org-scoped | backend/src/loans/loans.pos-initiation.spec.ts |
| /api/loans/:id/pos-completion | POST | CASHIER (ADMIN inherits) | org-scoped | backend/src/loans/loans.boundary.spec.ts |
| /api/loans | POST | ADMIN | org-scoped | backend/src/loans/loans.boundary.spec.ts |
| /api/loans/:id/collections | POST | CASHIER (ADMIN inherits) | org-scoped | backend/src/loans/loans.lifecycle.spec.ts |
| /api/loans/:id/collections/:paymentId/reverse | POST | ADMIN | org-scoped | backend/src/loans/loans.lifecycle.spec.ts |
| /api/loans/:id/close | POST | ADMIN | org-scoped | backend/src/loans/loans.lifecycle.spec.ts |
| /api/loans/:id/cancel | POST | ADMIN | org-scoped | backend/src/loans/loans.lifecycle.spec.ts |
| /api/loans | GET | CASHIER (ADMIN inherits) | org-scoped | backend/src/loans/loans.service.spec.ts |
| /api/loans/:id | GET | CASHIER (ADMIN inherits) | org-scoped | backend/src/loans/loans.service.spec.ts |
| /api/loans/:id/history | GET | CASHIER (ADMIN inherits) | org-scoped | backend/src/loans/loans.service.spec.ts |

Note: `InventoryLoansController` (`backend/src/loans/inventory-loans.controller.ts`, all routes
`@Roles(OrgRole.ADMIN)`) is a prepared artifact that is deliberately **unregistered**
in every module, so it is absent from the OpenAPI document and has no rows here. Wire it into a
module and add its rows in the same change that exposes it.

## payroll

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/payroll/periods | POST | ADMIN | org-scoped | backend/src/payroll/payroll-http.spec.ts |
| /api/payroll/groups | POST | ADMIN | org-scoped | backend/src/payroll/payroll-http.spec.ts |
| /api/payroll/period-installments | POST | ADMIN | org-scoped | backend/src/payroll/payroll-http.spec.ts |
| /api/payroll/group-installments | POST | ADMIN | org-scoped | backend/src/payroll/payroll-http.spec.ts |
| /api/payroll/group-installments/correct | POST | ADMIN | org-scoped | backend/src/payroll/payroll.controller.spec.ts |
| /api/payroll/period-installments/correct | POST | ADMIN | org-scoped | backend/src/payroll/payroll-http.spec.ts |
| /api/payroll/cash-returns | POST | ADMIN | org-scoped | backend/src/payroll/payroll.controller.spec.ts |
| /api/payroll/replacement-payments | POST | ADMIN | org-scoped | backend/src/payroll/payroll.controller.spec.ts |
| /api/payroll/obligations | GET | ADMIN | org-scoped | backend/src/payroll/payroll-http.spec.ts |

## plan-limits

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/plan-limits/status | GET | any authenticated | authenticated-global | backend/src/plan-limits/plan-limits.service.spec.ts |

## alerts

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/alerts | GET | any org role (per-category visibility decided server-side) | org-scoped | backend/src/alerts/alerts.service.spec.ts |
| /api/alerts/notifications | GET | ADMIN, INVENTORY_USER | org-scoped | backend/src/alerts/alerts.controller.spec.ts |

Note: the route admits every organization role on purpose; `alerts.logic.ts`
decides which categories each one receives, mirroring the guard hierarchy.
`ADMIN` inherits `CASHIER`; `INVENTORY_USER` inherits nothing
and only receives stock, loans and tasks.

## products

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/products | POST | ADMIN | org-scoped | backend/src/products/products.service.int.spec.ts |
| /api/products | GET | any org role | org-scoped; optional `locationId` reads one accessible site (404 when foreign/unassigned); `carriedAtSite=true` narrows it to the products that site carries (400 without `locationId`; pinned by products.site-assortment.postgres.spec.ts) | backend/src/products/products.service.int.spec.ts |
| /api/products/low-stock | GET | ADMIN, INVENTORY_USER | org-scoped | backend/src/products/products.low-stock-roles.spec.ts |
| /api/products/search | GET | ADMIN, CASHIER | org-scoped | backend/src/products/products.controller.spec.ts |
| /api/products/quick-search | GET | ADMIN, CASHIER | org-scoped | backend/src/products/products.controller.spec.ts |
| /api/products/:id | GET | any org role | org-scoped | backend/src/products/products.service.int.spec.ts |
| /api/products/:id | PUT | ADMIN | org-scoped | backend/src/products/products.service.int.spec.ts |
| /api/products/:id/deactivate | PUT | ADMIN | org-scoped | backend/src/products/products.service.int.spec.ts |
| /api/products/:id/reactivate | PUT | ADMIN | org-scoped | backend/src/products/products.service.int.spec.ts |
| /api/products/:id | DELETE | ADMIN | org-scoped | backend/src/products/products.service.int.spec.ts |
| /api/products/:id/stock-by-site | GET | any org role | org-scoped; lists only the sites the caller can read (ADMIN/SUPER_ADMIN all, others assigned) | backend/src/products/products.stock-by-site.postgres.spec.ts |
| /api/products/:id/stock-adjustments | POST | ADMIN | org-scoped; site authorized in the transaction (404 when unassigned or foreign); audited PRODUCT_STOCK_ADJUST | backend/src/products/products.stock-by-site.postgres.spec.ts |
| /api/products/upload | POST | ADMIN | org-scoped | backend/src/products/products.controller.spec.ts |
| /api/products/:id/upload | POST | ADMIN | org-scoped | backend/src/products/products.service.int.spec.ts |

Note: `GET /api/products/search` and `GET /api/products/quick-search` are served by the registered
`products.controller.ts`; the retired unregistered `products-search.controller.ts` was deleted
(see change `pos-cashier-search`).

## purchase-orders

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/purchase-orders | POST | ADMIN | org-scoped | backend/src/purchase-orders/purchase-orders.service.int.spec.ts |
| /api/purchase-orders | GET | ADMIN | org-scoped | backend/src/purchase-orders/purchase-orders.service.int.spec.ts |
| /api/purchase-orders/:id | GET | ADMIN | org-scoped | backend/src/purchase-orders/purchase-orders.service.int.spec.ts |
| /api/purchase-orders/:id | PATCH | ADMIN | org-scoped | backend/src/purchase-orders/purchase-orders.service.int.spec.ts |
| /api/purchase-orders/:id/confirm | POST | ADMIN | org-scoped | backend/src/purchase-orders/purchase-orders.service.int.spec.ts |
| /api/purchase-orders/:id/duplicate | POST | ADMIN | org-scoped | backend/src/purchase-orders/document/purchase-order-documents.int.spec.ts |
| /api/purchase-orders/:id/send | POST | ADMIN | org-scoped | backend/src/purchase-orders/document/purchase-order-documents.int.spec.ts |
| /api/purchase-orders/:id/pdf | GET | ADMIN | org-scoped | backend/src/purchase-orders/document/purchase-order-documents.int.spec.ts |
| /api/purchase-orders/:id/receive | POST | ADMIN | org-scoped | backend/src/purchase-orders/purchase-orders.service.int.spec.ts |
| /api/purchase-orders/:id/cancel | POST | ADMIN | org-scoped | backend/src/purchase-orders/purchase-orders.service.int.spec.ts |

## reports

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/reports/daily-report | GET | ADMIN | org-scoped | backend/src/reports/daily-report.http.spec.ts |
| /api/reports/daily-report/pdf | GET | ADMIN | org-scoped | backend/src/reports/daily-report.http.spec.ts |
| /api/reports/dashboard | GET | ADMIN | org-scoped; optional `locationId` must be a site the caller can read (404 otherwise) and filters by the stored sale origin (site balances for inventory) | backend/src/reports/reports.service.spec.ts |
| /api/reports/economic | GET | ADMIN | org-scoped | backend/src/reports/financial-reports.service.int.spec.ts |
| /api/reports/economic/cash | GET | ADMIN | org-scoped | backend/src/reports/financial-reports.service.int.spec.ts |
| /api/reports/economic/inventory | GET | ADMIN | org-scoped; optional `locationId` must be a site the caller can read (404 otherwise) and filters by the stored sale origin (site balances for inventory) | backend/src/reports/financial-reports.service.int.spec.ts |
| /api/reports/sales/payment-method | GET | ADMIN | org-scoped; optional `locationId` must be a site the caller can read (404 otherwise) and filters by the stored sale origin (site balances for inventory) | backend/src/reports/reports.service.spec.ts |
| /api/reports/sales/category | GET | ADMIN | org-scoped; optional `locationId` must be a site the caller can read (404 otherwise) and filters by the stored sale origin (site balances for inventory) | backend/src/reports/reports.service.spec.ts |
| /api/reports/sales/category-daily | GET | ADMIN | org-scoped; optional `locationId` must be a site the caller can read (404 otherwise) and filters by the stored sale origin (site balances for inventory) | backend/src/reports/reports.service.spec.ts |
| /api/reports/products/top-selling | GET | ADMIN | org-scoped; optional `locationId` must be a site the caller can read (404 otherwise) and filters by the stored sale origin (site balances for inventory) | backend/src/reports/reports.service.spec.ts |
| /api/reports/customers/statistics | GET | ADMIN | org-scoped; optional `locationId` must be a site the caller can read (404 otherwise) and filters by the stored sale origin (site balances for inventory) | backend/src/reports/reports.service.spec.ts |
| /api/reports/users/performance | GET | ADMIN | org-scoped; optional `locationId` must be a site the caller can read (404 otherwise) and filters by the stored sale origin (site balances for inventory) | backend/src/reports/reports.service.spec.ts |
| /api/reports/sales/daily | GET | ADMIN | org-scoped; optional `locationId` must be a site the caller can read (404 otherwise) and filters by the stored sale origin (site balances for inventory) | backend/src/reports/reports.service.spec.ts |

## sales

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/sales | POST | ADMIN, CASHIER | org-scoped | backend/src/sales/sales.service.int.spec.ts |
| /api/sales | GET | ADMIN, CASHIER | org-scoped; optional `locationId` must be a site the caller can read (404 otherwise) and matches the stored sale origin | backend/src/sales/sales.service.int.spec.ts |
| /api/sales/number/:saleNumber | GET | ADMIN, CASHIER | org-scoped | backend/src/sales/sales.service.int.spec.ts |
| /api/sales/:id | GET | ADMIN, CASHIER | org-scoped | backend/src/sales/sales.service.int.spec.ts |
| /api/sales/:id | PUT | ADMIN | org-scoped | backend/src/sales/sales.service.int.spec.ts |
| /api/sales/:id/force-close | POST | ADMIN | org-scoped | backend/src/sales/sales.service.int.spec.ts |
| /api/sales/:id/receipt | POST | ADMIN, CASHIER | org-scoped | backend/src/sales/sales.service.int.spec.ts |

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
| /api/suppliers | POST | ADMIN | org-scoped | backend/src/suppliers/suppliers.service.int.spec.ts |
| /api/suppliers | GET | ADMIN | org-scoped | backend/src/suppliers/suppliers.service.int.spec.ts |
| /api/suppliers/:id | GET | ADMIN | org-scoped | backend/src/suppliers/suppliers.service.int.spec.ts |
| /api/suppliers/:id | PATCH | ADMIN | org-scoped | backend/src/suppliers/suppliers.service.int.spec.ts |
| /api/suppliers/:id | DELETE | ADMIN | org-scoped | backend/src/suppliers/suppliers.service.int.spec.ts |
| /api/suppliers/:id/reactivate | POST | ADMIN | org-scoped | backend/src/suppliers/suppliers.service.int.spec.ts |

## tasks

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/tasks | POST | ADMIN, CASHIER, INVENTORY_USER | org-scoped | backend/src/tasks/tasks.service.spec.ts |
| /api/tasks | GET | ADMIN, CASHIER, INVENTORY_USER | org-scoped | backend/src/tasks/tasks.service.spec.ts |
| /api/tasks/assignees | GET | ADMIN, CASHIER, INVENTORY_USER | org-scoped | backend/src/tasks/tasks.service.spec.ts |
| /api/tasks/:id/timeline | GET | ADMIN, CASHIER, INVENTORY_USER | org-scoped | backend/src/tasks/tasks.service.spec.ts |
| /api/tasks/:id | GET | ADMIN, CASHIER, INVENTORY_USER | org-scoped | backend/src/tasks/tasks.service.spec.ts |
| /api/tasks/:id | PUT | ADMIN, CASHIER, INVENTORY_USER | org-scoped | backend/src/tasks/tasks.service.spec.ts |
| /api/tasks/:id/status | PUT | ADMIN, CASHIER, INVENTORY_USER | org-scoped | backend/src/tasks/tasks.service.spec.ts |
| /api/tasks/:id | DELETE | ADMIN, CASHIER, INVENTORY_USER | org-scoped | backend/src/tasks/tasks.service.spec.ts |

## locations

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/locations | GET | ADMIN, CASHIER, INVENTORY_USER, SUPER_ADMIN | selected org; limited roles require a membership assignment | backend/src/locations/locations.http.int.spec.ts |
| /api/locations | POST | ADMIN, SUPER_ADMIN | selected org; creates a store or warehouse and no assignment rows | backend/src/locations/locations.http.int.spec.ts |
| /api/locations/pos-context | GET | ADMIN, CASHIER, INVENTORY_USER, SUPER_ADMIN | selected org; eligible checkout site must be assigned or accessible and the organization's sole default site | backend/src/locations/locations.pos-context.spec.ts |
| /api/locations/:id | GET | ADMIN, CASHIER, INVENTORY_USER, SUPER_ADMIN | selected org; limited roles require a membership assignment | backend/src/locations/locations.http.int.spec.ts |
| /api/locations/:id | PATCH | ADMIN, SUPER_ADMIN | selected org; the principal site stays a store | backend/src/locations/locations.http.int.spec.ts |

## transfers

A transfer moves tracked stock between two sites of the same organization. Both requests that change
its fate (receipt and cancellation) claim the document row first, so exactly one of two competing
requests wins and the other answers 409. Every write is scoped by the caller's organization, the source
and destination site are authorized inside the inventory transaction, and a restricted membership only
reads documents that touch a site it was assigned.

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/transfers | POST | ADMIN, SUPER_ADMIN | org-scoped; source site authorized in the transaction, destination must be a site of the same organization | backend/src/transfers/transfers.http.int.spec.ts |
| /api/transfers | GET | ADMIN, CASHIER, SUPER_ADMIN | org-scoped; restricted memberships only see transfers touching an assigned site | backend/src/transfers/transfers.http.int.spec.ts |
| /api/transfers/:id | GET | ADMIN, CASHIER, SUPER_ADMIN | org-scoped; restricted memberships only see transfers touching an assigned site | backend/src/transfers/transfers.http.int.spec.ts |
| /api/transfers/:id/receive | POST | ADMIN, CASHIER, SUPER_ADMIN | org-scoped; destination site authorized in the transaction; an unassigned destination answers 404 and the transfer stays IN_TRANSIT | backend/src/transfers/transfers.http.int.spec.ts |
| /api/transfers/:id/cancel | POST | ADMIN, SUPER_ADMIN | org-scoped; origin site authorized in the transaction | backend/src/transfers/transfers.http.int.spec.ts |

## users

| Route | Method | Role(s) | Org-scope | Test reference |
|---|---|---|---|---|
| /api/users | POST | ADMIN | org-scoped | backend/src/users/users.service.int.spec.ts |
| /api/users | GET | ADMIN | org-scoped | backend/src/users/users.service.int.spec.ts |
| /api/users/:id | PUT | ADMIN | org-scoped | backend/src/users/users.service.int.spec.ts |
| /api/users/:id/locations | GET | ADMIN, SUPER_ADMIN | selected org; reads the target membership's assignment rows and whether its role already reaches every site | backend/src/locations/locations.http.int.spec.ts |
| /api/users/:id/locations | PUT | ADMIN, SUPER_ADMIN | selected org; target membership and every location must belong to it | backend/src/locations/locations.http.int.spec.ts |
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
