-- Standalone money-loan creation and read-only history. No lifecycle tables.
CREATE TYPE "MoneyLoanEventType" AS ENUM ('CREATED');

CREATE TABLE "MoneyLoan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "issuedAt" DATE NOT NULL,
    "dueAt" DATE,
    "reason" VARCHAR(500) NOT NULL,
    "customerId" TEXT,
    "supplierId" TEXT,
    "employeeId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MoneyLoan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MoneyLoan_positive_amount" CHECK ("amount" > 0),
    CONSTRAINT "MoneyLoan_valid_dates" CHECK ("dueAt" IS NULL OR "dueAt" >= "issuedAt"),
    CONSTRAINT "MoneyLoan_reason" CHECK (length(btrim("reason")) > 0),
    CONSTRAINT "MoneyLoan_one_counterparty" CHECK (
        num_nonnulls("customerId", "supplierId", "employeeId") = 1
    )
);

CREATE TABLE "MoneyLoanEvent" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "MoneyLoanEventType" NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MoneyLoanEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MoneyLoan_id_organizationId_key" ON "MoneyLoan"("id", "organizationId");
CREATE INDEX "MoneyLoan_organizationId_createdAt_id_idx" ON "MoneyLoan"("organizationId", "createdAt", "id");
CREATE INDEX "MoneyLoanEvent_organizationId_loanId_createdAt_id_idx" ON "MoneyLoanEvent"("organizationId", "loanId", "createdAt", "id");

ALTER TABLE "MoneyLoan" ADD CONSTRAINT "MoneyLoan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MoneyLoan" ADD CONSTRAINT "MoneyLoan_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MoneyLoan" ADD CONSTRAINT "MoneyLoan_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MoneyLoan" ADD CONSTRAINT "MoneyLoan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MoneyLoan" ADD CONSTRAINT "MoneyLoan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MoneyLoanEvent" ADD CONSTRAINT "MoneyLoanEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MoneyLoanEvent" ADD CONSTRAINT "MoneyLoanEvent_loanId_organizationId_fkey" FOREIGN KEY ("loanId", "organizationId") REFERENCES "MoneyLoan"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MoneyLoanEvent" ADD CONSTRAINT "MoneyLoanEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- History cannot be rewritten or erased, including through direct SQL.
CREATE FUNCTION "reject_money_loan_event_mutation"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Money loan history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MoneyLoanEvent_append_only"
BEFORE UPDATE OR DELETE ON "MoneyLoanEvent"
FOR EACH ROW EXECUTE FUNCTION "reject_money_loan_event_mutation"();
