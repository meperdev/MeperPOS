-- Unwired evidence only. A future transaction must verify pending status,
-- snapshots and amount continuity, and preserve the outflow's date and method.
-- Revisions do not themselves update cash or establish a valid chain.
-- Referenced actor memberships cannot be deleted or re-keyed (RESTRICT).
-- Row triggers do not guard TRUNCATE or privileged trigger bypass.
CREATE UNIQUE INDEX "PayrollInstallment_revision_target_key"
    ON "PayrollInstallment"("id", "obligationId", "outflowId", "organizationId", "employeeId");

CREATE TABLE "PayrollCashRevision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "installmentId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "outflowId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "oldAmount" NUMERIC NOT NULL,
    "newAmount" NUMERIC NOT NULL,
    "originalDate" DATE NOT NULL,
    "originalMethod" "PaymentMethod" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayrollCashRevision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PayrollCashRevision_oldAmount_check" CHECK ("oldAmount" > 0 AND "oldAmount" < 'Infinity'::numeric AND scale("oldAmount") <= 2),
    CONSTRAINT "PayrollCashRevision_newAmount_check" CHECK ("newAmount" > 0 AND "newAmount" < 'Infinity'::numeric AND scale("newAmount") <= 2),
    CONSTRAINT "PayrollCashRevision_installment_fkey" FOREIGN KEY ("installmentId", "obligationId", "outflowId", "organizationId", "employeeId") REFERENCES "PayrollInstallment"("id", "obligationId", "outflowId", "organizationId", "employeeId") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "PayrollCashRevision_actor_fkey" FOREIGN KEY ("actorId", "organizationId") REFERENCES "OrganizationUser"("userId", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "PayrollCashRevision_installment_idx"
    ON "PayrollCashRevision"("installmentId", "obligationId", "outflowId", "organizationId", "employeeId");

CREATE FUNCTION "protect_payroll_cash_revision_history"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Payroll cash revision history cannot be changed or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PayrollCashRevision_history"
BEFORE UPDATE OR DELETE ON "PayrollCashRevision"
FOR EACH ROW EXECUTE FUNCTION "protect_payroll_cash_revision_history"();
