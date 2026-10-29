-- Optional profile data for existing and future independent employees.
CREATE TYPE "EmployeeRemunerationModality" AS ENUM ('FIXED', 'BY_DAY', 'OTHER');

ALTER TABLE "Employee"
    ADD COLUMN "identification" TEXT,
    ADD COLUMN "phone" TEXT,
    ADD COLUMN "email" TEXT,
    ADD COLUMN "address" TEXT,
    ADD COLUMN "jobTitle" TEXT,
    ADD COLUMN "startDate" DATE,
    ADD COLUMN "remunerationModality" "EmployeeRemunerationModality",
    ADD COLUMN "referenceAmount" DECIMAL(12,2),
    ADD CONSTRAINT "Employee_referenceAmount_check"
        CHECK ("referenceAmount" >= 0 AND "referenceAmount" <> 'NaN'::numeric);
