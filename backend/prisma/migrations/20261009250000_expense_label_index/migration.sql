-- Additive only: creates the composite index the Expense model declares.
-- No table, column, constraint or data change; existing rows stay untouched.
CREATE INDEX "Expense_organizationId_labelId_idx" ON "Expense"("organizationId", "labelId");
