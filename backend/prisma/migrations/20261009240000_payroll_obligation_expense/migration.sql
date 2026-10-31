-- Unwired storage only: no expense is created, annulled or aggregated here,
-- no cash or per-installment mirror is stored, and no existing row is rewritten.
-- One obligation links to at most one expense, and an expense cannot be shared by
-- several obligations. Both sides are tenant-checked through composite keys.
--
-- What protects this evidence, and what does not:
--   * the parent foreign keys below are ON DELETE RESTRICT / ON UPDATE RESTRICT,
--     so a linked obligation or expense cannot be removed or re-keyed while
--     linked; they do not make the link row itself immutable;
--   * the row-level append-only trigger rejects every ordinary UPDATE and DELETE
--     of a link row, so repointing or removing that evidence is refused;
--   * administrative cleanup of a link row is therefore blocked on purpose: a
--     wrongly written link needs an explicit, reviewed schema migration rather
--     than an UPDATE/DELETE here;
--   * TRUNCATE and privileged bypass (disabling the trigger,
--     session_replication_role = replica, owner-level DDL) are NOT guarded;
--   * the expense removal path stays a soft delete, so annulment keeps this row.
--
-- Annulment and replacement are not implemented here and the correction-copy
-- protocol is not established. The approved decision keeps the annulled payment
-- history, annuls the associated expense when present and creates a pending copy
-- with the valid shifts and installments, choosing the expense option on
-- completion. If the copy protocol creates a new obligation, it would need its
-- own link row; the copy identity and protocol are not established here.
--
-- Future expense creation still needs at least one ExpensePayment row because
-- the expense service requires it; that is a service rule, not a database
-- constraint, and this table does not relax it. The expense money column stays
-- Decimal(12,2) while a payroll aggregate can exceed it.
-- The Expense key is unique on (id, organizationId); id is already the primary
-- key, so no row is rewritten, but the index build is not concurrent and holds a
-- write lock on Expense while it runs.
CREATE UNIQUE INDEX "Expense_payroll_target_key" ON "Expense"("id", "organizationId");

CREATE TABLE "PayrollObligationExpense" (
    "obligationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayrollObligationExpense_pkey" PRIMARY KEY ("obligationId", "organizationId", "employeeId")
);

CREATE UNIQUE INDEX "PayrollObligationExpense_expense_key" ON "PayrollObligationExpense"("expenseId", "organizationId");
CREATE INDEX "PayrollObligationExpense_organization_idx" ON "PayrollObligationExpense"("organizationId");

ALTER TABLE "PayrollObligationExpense" ADD CONSTRAINT "PayrollObligationExpense_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PayrollObligationExpense" ADD CONSTRAINT "PayrollObligationExpense_obligation_fkey" FOREIGN KEY ("obligationId", "organizationId", "employeeId") REFERENCES "PayrollObligation"("id", "organizationId", "employeeId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PayrollObligationExpense" ADD CONSTRAINT "PayrollObligationExpense_expense_fkey" FOREIGN KEY ("expenseId", "organizationId") REFERENCES "Expense"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Append-only evidence: ordinary UPDATE and DELETE of a link row are refused.
-- Like the other payroll history triggers, this does not cover TRUNCATE or
-- privileged trigger bypass, and it is not proof of PostgreSQL runtime behavior.
CREATE FUNCTION "protect_payroll_obligation_expense_link"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Payroll obligation expense link cannot be changed or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PayrollObligationExpense_history"
BEFORE UPDATE OR DELETE ON "PayrollObligationExpense"
FOR EACH ROW EXECUTE FUNCTION "protect_payroll_obligation_expense_link"();
