-- Unwired obligation storage. Group membership and totals, installments,
-- completion rules, CAS writes and correction history belong to later flows.
CREATE TYPE "PayrollObligationKind" AS ENUM ('SHIFT_GROUP', 'FIXED_PERIOD');
CREATE TYPE "PayrollObligationStatus" AS ENUM ('PENDING', 'COMPLETED');

CREATE TABLE "PayrollObligation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" "PayrollObligationKind" NOT NULL,
    "status" "PayrollObligationStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 0,
    "periodStart" DATE,
    "periodEnd" DATE,
    "periodAmount" NUMERIC,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayrollObligation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PayrollObligation_period_shape_check" CHECK (
        ("kind" = 'FIXED_PERIOD' AND "periodStart" IS NOT NULL AND "periodEnd" IS NOT NULL AND "periodAmount" IS NOT NULL)
        OR ("kind" = 'SHIFT_GROUP' AND "periodStart" IS NULL AND "periodEnd" IS NULL AND "periodAmount" IS NULL)
    )
);

CREATE INDEX "PayrollObligation_organizationId_employeeId_idx" ON "PayrollObligation"("organizationId", "employeeId");
ALTER TABLE "PayrollObligation" ADD CONSTRAINT "PayrollObligation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PayrollObligation" ADD CONSTRAINT "PayrollObligation_employeeId_organizationId_fkey" FOREIGN KEY ("employeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION "protect_payroll_obligation_ownership"() RETURNS trigger AS $$
BEGIN
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR
       NEW."employeeId" IS DISTINCT FROM OLD."employeeId" THEN
        RAISE EXCEPTION 'Payroll obligation ownership cannot change';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PayrollObligation_ownership"
BEFORE UPDATE ON "PayrollObligation"
FOR EACH ROW EXECUTE FUNCTION "protect_payroll_obligation_ownership"();
