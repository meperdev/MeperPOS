-- Reference-based replacement of a completed payroll payment (approved decision
-- "Referenciarlos sin cobrar de nuevo", option A). A new pending payment counts
-- the valid installments of the completed one as cash already paid, so no new
-- cash outflow is written here and the original payment, its outflows, its
-- allocations and its linked expense stay untouched.
--
-- What this table and its keys protect:
--   * the target payment is referenced by (targetObligationId, organizationId,
--     employeeId) against the existing obligation identity key, so the new
--     payment cannot be re-keyed or deleted while a reference exists;
--   * the source installment is referenced by (sourceInstallmentId,
--     sourceObligationId, organizationId, employeeId) against the existing
--     installment allocation target key, so the reference also pins the payment
--     that owns the referenced cash, its tenant and its employee; a reference
--     can never be re-pointed at another payment's installment;
--   * both references are ON DELETE / ON UPDATE RESTRICT, so removing either
--     side fails instead of silently losing the evidence;
--   * UNIQUE (targetObligationId, sourceInstallmentId) means one reference per
--     counted installment and payment, so a replayed or duplicated request
--     cannot count the same cash twice for the same replacement;
--   * the amount snapshot is positive, finite and scaled to two decimals, and it
--     is a snapshot on purpose: no trigger copies it from the source outflow;
--   * the row-level append-only trigger rejects every ordinary UPDATE and DELETE.
--
-- Not enforced here, and not implemented by this migration:
--   * TRUNCATE and privileged bypass (disabling the trigger,
--     session_replication_role = replica, owner-level DDL) are not guarded;
--   * "a source installment is not already referenced" across different
--     payments, and "the snapshot equals the live source outflow amount", are
--     cross-row writer rules; the writer checks them under FOR UPDATE locks;
--   * no cash outflow, expense, status transition, route or report change is
--     added by this migration. It only adds this table, its keys and its
--     trigger, so it rewrites no existing payroll row.
CREATE TABLE "PayrollInstallmentReference" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "targetObligationId" TEXT NOT NULL,
    "sourceObligationId" TEXT NOT NULL,
    "sourceInstallmentId" TEXT NOT NULL,
    "amount" NUMERIC NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayrollInstallmentReference_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PayrollInstallmentReference_amount_check" CHECK ("amount" > 0 AND "amount" < 'Infinity'::numeric AND scale("amount") <= 2),
    CONSTRAINT "PayrollInstallmentReference_target_fkey" FOREIGN KEY ("targetObligationId", "organizationId", "employeeId") REFERENCES "PayrollObligation"("id", "organizationId", "employeeId") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "PayrollInstallmentReference_source_fkey" FOREIGN KEY ("sourceInstallmentId", "sourceObligationId", "organizationId", "employeeId") REFERENCES "PayrollInstallment"("id", "obligationId", "organizationId", "employeeId") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "PayrollInstallmentReference_target_source_key"
    ON "PayrollInstallmentReference"("targetObligationId", "sourceInstallmentId");
CREATE INDEX "PayrollInstallmentReference_source_idx"
    ON "PayrollInstallmentReference"("sourceInstallmentId", "organizationId", "employeeId");

CREATE FUNCTION "protect_payroll_installment_reference_history"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Payroll installment references cannot be changed or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PayrollInstallmentReference_history"
BEFORE UPDATE OR DELETE ON "PayrollInstallmentReference"
FOR EACH ROW EXECUTE FUNCTION "protect_payroll_installment_reference_history"();
