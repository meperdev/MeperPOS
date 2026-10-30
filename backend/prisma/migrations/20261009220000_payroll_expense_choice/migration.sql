-- Null represents an unspecified choice or an expense date not explicitly chosen.
-- This stores intent only; expense and cash workflows are not wired here.
ALTER TABLE "PayrollObligation"
  ADD COLUMN "expenseEnabled" BOOLEAN,
  ADD COLUMN "selectedExpenseDate" DATE;
