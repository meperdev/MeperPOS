-- Unwired storage: an outflow is counted once regardless of how many
-- obligations reference it. Audit/revisions, corrections and reports are future work.
CREATE UNIQUE INDEX "PayrollObligation_id_organizationId_employeeId_key"
    ON "PayrollObligation"("id", "organizationId", "employeeId");

CREATE TABLE "PayrollCashOutflow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "amount" NUMERIC NOT NULL,
    "date" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayrollCashOutflow_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PayrollCashOutflow_amount_check" CHECK ("amount" > 0 AND "amount" < 'Infinity'::numeric AND scale("amount") <= 2),
    CONSTRAINT "PayrollCashOutflow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "PayrollCashOutflow_employee_fkey" FOREIGN KEY ("employeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "PayrollCashOutflow_actor_fkey" FOREIGN KEY ("actorId", "organizationId") REFERENCES "OrganizationUser"("userId", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "PayrollCashOutflow_identity_key" ON "PayrollCashOutflow"("id", "organizationId", "employeeId");
CREATE INDEX "PayrollCashOutflow_date_idx" ON "PayrollCashOutflow"("organizationId", "date");

CREATE TABLE "PayrollInstallment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "outflowId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayrollInstallment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PayrollInstallment_obligation_fkey" FOREIGN KEY ("obligationId", "organizationId", "employeeId") REFERENCES "PayrollObligation"("id", "organizationId", "employeeId") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "PayrollInstallment_outflow_fkey" FOREIGN KEY ("outflowId", "organizationId", "employeeId") REFERENCES "PayrollCashOutflow"("id", "organizationId", "employeeId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "PayrollInstallment_obligation_outflow_key" ON "PayrollInstallment"("obligationId", "outflowId");
CREATE INDEX "PayrollInstallment_outflow_idx" ON "PayrollInstallment"("outflowId", "organizationId", "employeeId");

-- Protect only identity; future audited revisions may change the recorded facts.
CREATE FUNCTION "protect_payroll_cash_outflow_identity"() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Payroll cash outflow identity cannot be deleted';
    END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id" OR
       NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR
       NEW."employeeId" IS DISTINCT FROM OLD."employeeId" THEN
        RAISE EXCEPTION 'Payroll cash outflow identity cannot change';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PayrollCashOutflow_identity"
BEFORE UPDATE OR DELETE ON "PayrollCashOutflow"
FOR EACH ROW EXECUTE FUNCTION "protect_payroll_cash_outflow_identity"();
