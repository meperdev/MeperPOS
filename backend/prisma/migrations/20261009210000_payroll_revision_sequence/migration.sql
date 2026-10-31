-- Existing evidence needs an explicitly approved migration plan, not a guessed order.
-- Hold the table lock until the constraint and index are installed so concurrent
-- writers cannot insert between the emptiness check and the schema change.
BEGIN;
LOCK TABLE "PayrollCashRevision" IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "PayrollCashRevision") THEN
        RAISE EXCEPTION 'Cannot sequence existing payroll cash revision history';
    END IF;
END;
$$;

ALTER TABLE "PayrollCashRevision"
    ADD COLUMN "sequence" INTEGER NOT NULL,
    ADD CONSTRAINT "PayrollCashRevision_sequence_check" CHECK ("sequence" > 0);
CREATE UNIQUE INDEX "PayrollCashRevision_installment_sequence_key"
    ON "PayrollCashRevision"("installmentId", "sequence");
COMMIT;
