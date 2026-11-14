-- Unexposed employee and manual shift foundation; no payroll payments or integrations.
CREATE TYPE "EmployeeShiftKind" AS ENUM ('FULL_DAY', 'PARTIAL_DAY');

CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmployeeShift" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "EmployeeShiftKind" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeeShift_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EmployeeShift_amount_check" CHECK ("amount" >= 0 AND "amount" <> 'NaN'::numeric)
);

CREATE UNIQUE INDEX "Employee_id_organizationId_key" ON "Employee"("id", "organizationId");
CREATE INDEX "Employee_organizationId_active_idx" ON "Employee"("organizationId", "active");
CREATE UNIQUE INDEX "EmployeeShift_organizationId_employeeId_date_key" ON "EmployeeShift"("organizationId", "employeeId", "date");

ALTER TABLE "Employee" ADD CONSTRAINT "Employee_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "EmployeeShift" ADD CONSTRAINT "EmployeeShift_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "EmployeeShift" ADD CONSTRAINT "EmployeeShift_employeeId_organizationId_fkey" FOREIGN KEY ("employeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Preserve tenant ownership even before an employee has shifts.
CREATE FUNCTION "protect_employee_ownership"() RETURNS trigger AS $$
BEGIN
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" THEN
        RAISE EXCEPTION 'Employee organization cannot change';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Employee_ownership"
BEFORE UPDATE ON "Employee"
FOR EACH ROW EXECUTE FUNCTION "protect_employee_ownership"();

-- Keep historical shifts with their original employee and organization.
CREATE FUNCTION "protect_employee_shift_identity"() RETURNS trigger AS $$
BEGIN
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR
       NEW."employeeId" IS DISTINCT FROM OLD."employeeId" THEN
        RAISE EXCEPTION 'Employee shift ownership cannot change';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "EmployeeShift_identity"
BEFORE UPDATE ON "EmployeeShift"
FOR EACH ROW EXECUTE FUNCTION "protect_employee_shift_identity"();

-- Lock the employee row so concurrent deactivation cannot race shift assignment.
-- Existing shift details remain editable after deactivation, but not reassignment/date.
CREATE FUNCTION "check_employee_shift_active"() RETURNS trigger AS $$
DECLARE
    employee_active BOOLEAN;
BEGIN
    -- Ownership changes are rejected by EmployeeShift_identity independently.
    IF TG_OP = 'UPDATE' THEN
        IF NEW."date" IS NOT DISTINCT FROM OLD."date" THEN
            RETURN NEW;
        END IF;
    END IF;
    SELECT "active" INTO employee_active FROM "Employee"
    WHERE "id" = NEW."employeeId" AND "organizationId" = NEW."organizationId"
    FOR UPDATE;
    IF employee_active = false THEN
        RAISE EXCEPTION 'Inactive employee cannot receive a shift';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "EmployeeShift_active_employee"
BEFORE INSERT OR UPDATE OF "employeeId", "organizationId", "date" ON "EmployeeShift"
FOR EACH ROW EXECUTE FUNCTION "check_employee_shift_active"();
