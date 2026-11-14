-- Persisted registration order for grouped installments (decisions L332/L333).
-- Additive and forward-only: the sequence is nullable and nothing is inferred or
-- written for existing rows, whose registration order was never stored. All
-- legacy rows therefore stay NULL, which is what makes a correction over such a
-- history fail closed instead of inventing an order.
-- Scoped uniqueness is per obligation, tenant and employee; PostgreSQL treats
-- NULLs as distinct in a unique index, so any number of legacy NULL rows coexist.
-- No explicit BEGIN/COMMIT: Prisma Migrate already runs this migration inside a
-- transaction, and the plain (non-concurrent) unique index blocks writes on
-- "PayrollInstallment" for the duration of the migration, so writers should be
-- quiesced in a maintenance window.
ALTER TABLE "PayrollInstallment" ADD COLUMN "sequence" INTEGER;

ALTER TABLE "PayrollInstallment"
    ADD CONSTRAINT "PayrollInstallment_sequence_check"
    CHECK ("sequence" IS NULL OR "sequence" > 0);

CREATE UNIQUE INDEX "PayrollInstallment_obligation_sequence_key"
    ON "PayrollInstallment"("obligationId", "organizationId", "employeeId", "sequence");
