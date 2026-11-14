-- Unwired membership storage. Release is a seam, not a correction workflow;
-- no settlement, copy, cash movement or correction safety is implemented here.
CREATE UNIQUE INDEX "EmployeeShift_id_organizationId_employeeId_key"
    ON "EmployeeShift"("id", "organizationId", "employeeId");
CREATE UNIQUE INDEX "PayrollObligation_id_organizationId_employeeId_kind_key"
    ON "PayrollObligation"("id", "organizationId", "employeeId", "kind");

CREATE TABLE "PayrollShiftMembership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "obligationKind" "PayrollObligationKind" NOT NULL DEFAULT 'SHIFT_GROUP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    CONSTRAINT "PayrollShiftMembership_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PayrollShiftMembership_group_kind_check" CHECK ("obligationKind" = 'SHIFT_GROUP'),
    CONSTRAINT "PayrollShiftMembership_shift_fkey" FOREIGN KEY ("shiftId", "organizationId", "employeeId") REFERENCES "EmployeeShift"("id", "organizationId", "employeeId") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "PayrollShiftMembership_obligation_fkey" FOREIGN KEY ("obligationId", "organizationId", "employeeId", "obligationKind") REFERENCES "PayrollObligation"("id", "organizationId", "employeeId", "kind") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- Prisma cannot express this partial unique index in the schema.
CREATE UNIQUE INDEX "PayrollShiftMembership_active_shift_key"
    ON "PayrollShiftMembership"("shiftId") WHERE "releasedAt" IS NULL;
CREATE INDEX "PayrollShiftMembership_obligation_idx"
    ON "PayrollShiftMembership"("obligationId", "organizationId", "employeeId", "obligationKind");

CREATE FUNCTION "protect_payroll_shift_membership_history"() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Payroll shift membership history cannot be deleted';
    END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id" OR
       NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR
       NEW."employeeId" IS DISTINCT FROM OLD."employeeId" OR
       NEW."shiftId" IS DISTINCT FROM OLD."shiftId" OR
       NEW."obligationId" IS DISTINCT FROM OLD."obligationId" OR
       NEW."obligationKind" IS DISTINCT FROM OLD."obligationKind" OR
       NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
        RAISE EXCEPTION 'Payroll shift membership identity cannot change';
    END IF;
    IF OLD."releasedAt" IS NOT NULL AND NEW."releasedAt" IS DISTINCT FROM OLD."releasedAt" THEN
        RAISE EXCEPTION 'Payroll shift membership release cannot change';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PayrollShiftMembership_history"
BEFORE UPDATE OR DELETE ON "PayrollShiftMembership"
FOR EACH ROW EXECUTE FUNCTION "protect_payroll_shift_membership_history"();
