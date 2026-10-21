-- Additive L2 migration. The L1 append-only event trigger remains in place.
CREATE TYPE "MoneyLoanStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');
ALTER TYPE "MoneyLoanEventType" ADD VALUE 'COLLECTED';
ALTER TYPE "MoneyLoanEventType" ADD VALUE 'REVERSED';
ALTER TYPE "MoneyLoanEventType" ADD VALUE 'CLOSED';
ALTER TYPE "MoneyLoanEventType" ADD VALUE 'CANCELLED';
ALTER TABLE "MoneyLoan"
  ADD COLUMN "status" "MoneyLoanStatus" NOT NULL DEFAULT 'OPEN',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MoneyLoanEvent"
  ADD COLUMN "amount" DECIMAL(10,2),
  ADD COLUMN "method" "PaymentMethod",
  ADD COLUMN "reversesId" TEXT,
  ADD COLUMN "requestKey" VARCHAR(100),
  ADD COLUMN "requestPayload" TEXT,
  ADD COLUMN "result" JSONB;
CREATE UNIQUE INDEX "MoneyLoanEvent_reversesId_key" ON "MoneyLoanEvent"("reversesId");
CREATE UNIQUE INDEX "MoneyLoanEvent_id_loanId_organizationId_key" ON "MoneyLoanEvent"("id", "loanId", "organizationId");
CREATE UNIQUE INDEX "MoneyLoanEvent_organizationId_loanId_requestKey_key" ON "MoneyLoanEvent"("organizationId", "loanId", "requestKey");
ALTER TABLE "MoneyLoanEvent" ADD CONSTRAINT "MoneyLoanEvent_reversal_fkey"
  FOREIGN KEY ("reversesId", "loanId", "organizationId")
  REFERENCES "MoneyLoanEvent"("id", "loanId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Cast enum to text so added values are not used as enum constants in this migration.
ALTER TABLE "MoneyLoanEvent" ADD CONSTRAINT "MoneyLoanEvent_lifecycle_shape" CHECK (
  ("type"::text = 'CREATED' AND "amount" IS NULL AND "method" IS NULL AND "reversesId" IS NULL AND "requestKey" IS NULL AND "requestPayload" IS NULL AND "result" IS NULL)
  OR (
    "requestKey" IS NOT NULL AND length(btrim("requestKey")) > 0 AND "requestPayload" IS NOT NULL AND "result" IS NOT NULL
    AND (
      ("type"::text = 'COLLECTED' AND "amount" IS NOT NULL AND "amount" > 0 AND "method" IS NOT NULL AND "reversesId" IS NULL)
      OR ("type"::text = 'REVERSED' AND "amount" IS NOT NULL AND "amount" > 0 AND "method" IS NULL AND "reversesId" IS NOT NULL)
      OR ("type"::text IN ('CLOSED', 'CANCELLED') AND "amount" IS NULL AND "method" IS NULL AND "reversesId" IS NULL)
    )
  )
);
-- Principal/counterparty corrections are not an L2 operation. Keep identity immutable
-- even after reversal; there is no destructive edit or implicit refund route.
CREATE FUNCTION protect_money_loan_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."amount", NEW."organizationId", NEW."customerId", NEW."supplierId", NEW."employeeId", NEW."createdById")
     IS DISTINCT FROM
     (OLD."amount", OLD."organizationId", OLD."customerId", OLD."supplierId", OLD."employeeId", OLD."createdById") THEN
    RAISE EXCEPTION 'Money loan principal and counterparty are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "MoneyLoan_identity_immutable" BEFORE UPDATE ON "MoneyLoan"
  FOR EACH ROW EXECUTE FUNCTION protect_money_loan_identity();
