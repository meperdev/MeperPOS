-- Storage only: no label creation, assignment or backfill.
-- Existing inconsistent label/group tenant pairs remain untouched and cannot be assigned.
CREATE UNIQUE INDEX "ExpenseLabel_payroll_target_key" ON "ExpenseLabel"("id", "groupId", "organizationId");
CREATE UNIQUE INDEX "ExpenseGroup_payroll_target_key" ON "ExpenseGroup"("id", "organizationId");

CREATE TABLE "PayrollExpenseCategory" (
    "organizationId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    CONSTRAINT "PayrollExpenseCategory_pkey" PRIMARY KEY ("organizationId")
);

CREATE UNIQUE INDEX "PayrollExpenseCategory_label_key" ON "PayrollExpenseCategory"("labelId", "groupId", "organizationId");
CREATE INDEX "PayrollExpenseCategory_group_idx" ON "PayrollExpenseCategory"("groupId", "organizationId");

ALTER TABLE "PayrollExpenseCategory" ADD CONSTRAINT "PayrollExpenseCategory_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "PayrollExpenseCategory" ADD CONSTRAINT "PayrollExpenseCategory_label_fkey" FOREIGN KEY ("labelId", "groupId", "organizationId") REFERENCES "ExpenseLabel"("id", "groupId", "organizationId") ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "PayrollExpenseCategory" ADD CONSTRAINT "PayrollExpenseCategory_group_fkey" FOREIGN KEY ("groupId", "organizationId") REFERENCES "ExpenseGroup"("id", "organizationId") ON DELETE CASCADE ON UPDATE RESTRICT;
