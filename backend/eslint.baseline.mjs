// @ts-check
/**
 * Lint baseline (trust stack Phase 1, see docs/bug-rule-log.md).
 *
 * When `npm run lint:ci` became a blocking CI step, these files already failed
 * `prettier/prettier` (359 formatting errors in 71 files on master ca23465).
 * Reformatting them would be a large, behavior-free diff colliding with work
 * in flight, so they are frozen here: in these files only, `prettier/prettier`
 * reports as a warning. Every other file — including every new file — keeps
 * it as an error.
 *
 * This list may only shrink. To pay one down, run
 * `npx prettier --write <file>`, delete its line, and run `npm run lint:ci`.
 * Never add a file to it; MeperPOS plugin rules (`meperpos/*`) are never
 * baselined.
 */
export const prettierBaseline = [
  'src/admin/admin.controller.spec.ts',
  'src/alerts/alerts.controller.spec.ts',
  'src/alerts/alerts.controller.ts',
  'src/alerts/stock-alerts.scheduler.spec.ts',
  'src/alerts/stock-alerts.service.spec.ts',
  'src/alerts/stock-alerts.service.ts',
  'src/auth/auth-body-exposure.int.spec.ts',
  'src/auth/auth.refresh.int.spec.ts',
  'src/billing/billing.controller.ts',
  'src/billing/billing.module.ts',
  'src/billing/payment-records.service.spec.ts',
  'src/business-modules/business-modules.service.spec.ts',
  'src/cash-registers/cash-registers.module.ts',
  'src/categories/categories.module.ts',
  'src/categories/categories.service.ts',
  'src/common/guards/cookie-csrf.guard.ts',
  'src/common/guards/organization-status.guard.spec.ts',
  'src/common/interceptors/admin-organization.interceptor.ts',
  'src/common/sequences/sequence.service.spec.ts',
  'src/common/validators/password.policy.spec.ts',
  'src/config/runtime-env.spec.ts',
  'src/customers/customers.controller.ts',
  'src/customers/customers.service.ts',
  'src/deployment-runbook.content.spec.ts',
  'src/expenses/default-expense-categories.ts',
  'src/expenses/expense-taxonomy-reporting.spec.ts',
  'src/expenses/expense-taxonomy.controller.spec.ts',
  'src/expenses/expense-taxonomy.controller.ts',
  'src/expenses/expense-taxonomy.service.spec.ts',
  'src/expenses/expense-taxonomy.service.ts',
  'src/expenses/expenses.controller.spec.ts',
  'src/exports/dto/export.dto.ts',
  'src/exports/exports.module.ts',
  'src/imports/engine/handlers/customer.handler.spec.ts',
  'src/imports/engine/handlers/product.handler.spec.ts',
  'src/imports/engine/handlers/supplier.handler.spec.ts',
  'src/imports/engine/handlers/user.handler.spec.ts',
  'src/imports/engine/sheet-registry.spec.ts',
  'src/imports/imports.service.spec.ts',
  'src/imports/imports.service.ts',
  'src/imports/multi-sheet-import.service.spec.ts',
  'src/imports/multi-sheet-import.service.ts',
  'src/plan-limits/plan-limits.guard.spec.ts',
  'src/prisma/migration-issue-134.spec.ts',
  'src/prisma/prisma.service.ts',
  'src/prisma/query-timing.spec.ts',
  'src/prisma/query-timing.ts',
  'src/products/products.controller.spec.ts',
  'src/products/products.controller.ts',
  'src/products/products.low-stock-roles.spec.ts',
  'src/products/products.module.ts',
  'src/reports/financial-aggregator.ts',
  'src/reports/financial-reports.service.int.spec.ts',
  'src/reports/reports-golden-workload.ts',
  'src/reports/reports.controller.ts',
  'src/runbook.content.spec.ts',
  'src/sales/sales.module.ts',
  'src/settings/migration.ts',
  'src/settings/settings.controller.spec.ts',
  'src/suppliers/dto/create-supplier.dto.ts',
  'src/suppliers/suppliers.module.ts',
  'src/suppliers/suppliers.service.ts',
  'src/tasks/tasks.module.ts',
  'src/users/users.module.ts',
  'src/users/users.multi-org.privacy.int.spec.ts',
  'src/users/users.service.int.spec.ts',
  'test/fixtures/receipts/regenerate-fixtures.ts',
  'test/fixtures/reports-golden/capture-goldens.ts',
  'test/fixtures/reports-golden/run-reports-timing.ts',
  'test/fixtures/reports-golden/seed-golden-fixtures.ts',
  'test/products-cashier-quick-search.e2e-spec.ts',
];
