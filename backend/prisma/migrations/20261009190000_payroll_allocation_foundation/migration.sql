-- Unwired evidence only. Sums, status, corrections and concurrency are future work.
-- Voids and replacement allocations are evidence only; the future transaction
-- protocol must enforce effective uniqueness, sums, status and audit attribution.
-- Date corrections retain applications; cash is counted by outflow identity.
CREATE UNIQUE INDEX "PayrollInstallment_allocation_target_key"
    ON "PayrollInstallment"("id", "obligationId", "organizationId", "employeeId");
CREATE UNIQUE INDEX "PayrollShiftMembership_allocation_target_key"
    ON "PayrollShiftMembership"("id", "obligationId", "organizationId", "employeeId");

CREATE TABLE "PayrollAllocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "installmentId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "amount" NUMERIC NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayrollAllocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PayrollAllocation_amount_check" CHECK ("amount" > 0 AND "amount" <= 9999999999.99 AND scale("amount") <= 2),
    CONSTRAINT "PayrollAllocation_installment_fkey" FOREIGN KEY ("installmentId", "obligationId", "organizationId", "employeeId") REFERENCES "PayrollInstallment"("id", "obligationId", "organizationId", "employeeId") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "PayrollAllocation_membership_fkey" FOREIGN KEY ("membershipId", "obligationId", "organizationId", "employeeId") REFERENCES "PayrollShiftMembership"("id", "obligationId", "organizationId", "employeeId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "PayrollAllocation_void_target_key"
    ON "PayrollAllocation"("id", "obligationId", "organizationId", "employeeId");
CREATE INDEX "PayrollAllocation_installment_membership_idx"
    ON "PayrollAllocation"("installmentId", "membershipId");
CREATE INDEX "PayrollAllocation_membership_idx"
    ON "PayrollAllocation"("membershipId", "obligationId", "organizationId", "employeeId");

-- A void marks one allocation as no longer effective. No replacement or actor
-- is implied: future workflow must record attribution and coordinate replacement.
CREATE TABLE "PayrollAllocationVoid" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayrollAllocationVoid_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PayrollAllocationVoid_allocation_fkey" FOREIGN KEY ("allocationId", "obligationId", "organizationId", "employeeId") REFERENCES "PayrollAllocation"("id", "obligationId", "organizationId", "employeeId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "PayrollAllocationVoid_allocation_key"
    ON "PayrollAllocationVoid"("allocationId");

CREATE FUNCTION "protect_payroll_allocation_void_history"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Payroll allocation void history cannot be changed or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PayrollAllocationVoid_history"
BEFORE UPDATE OR DELETE ON "PayrollAllocationVoid"
FOR EACH ROW EXECUTE FUNCTION "protect_payroll_allocation_void_history"();

CREATE FUNCTION "protect_payroll_allocation_history"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Payroll allocation history cannot be changed or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PayrollAllocation_history"
BEFORE UPDATE OR DELETE ON "PayrollAllocation"
FOR EACH ROW EXECUTE FUNCTION "protect_payroll_allocation_history"();
