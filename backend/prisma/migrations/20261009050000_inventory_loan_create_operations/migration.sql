-- Unexposed completed replay storage only; no reservation writer activation.
-- Future lifecycle discriminators require a separate additive migration.
CREATE TYPE "InventoryLoanOperationType" AS ENUM ('CREATE');

CREATE TABLE "InventoryLoanOperation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "type" "InventoryLoanOperationType" NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestPayload" JSONB NOT NULL,
    "resultSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryLoanOperation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InventoryLoanOperation_request_key" CHECK (
        char_length("requestKey") BETWEEN 1 AND 100 AND
        "requestKey" = btrim("requestKey")
    ),
    CONSTRAINT "InventoryLoanOperation_request_payload" CHECK (
        jsonb_typeof("requestPayload") = 'object' AND "requestPayload" <> '{}'::jsonb
    ),
    CONSTRAINT "InventoryLoanOperation_result_snapshot" CHECK (
        jsonb_typeof("resultSnapshot") = 'object' AND "resultSnapshot" <> '{}'::jsonb
    )
);

-- Tenant-wide, not actor/loan-scoped: a conflicting actor cannot reserve twice.
CREATE UNIQUE INDEX "InventoryLoanOperation_organizationId_requestKey_key" ON "InventoryLoanOperation"("organizationId", "requestKey");
-- Composite target also binds the linked event author to the authenticated actor.
CREATE UNIQUE INDEX "InventoryLoanOperation_event_target_key" ON "InventoryLoanOperation"("id", "loanId", "organizationId", "actorId");

ALTER TABLE "InventoryLoanOperation" ADD CONSTRAINT "InventoryLoanOperation_loanId_organizationId_fkey" FOREIGN KEY ("loanId", "organizationId") REFERENCES "InventoryLoan"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "InventoryLoanOperation" ADD CONSTRAINT "InventoryLoanOperation_actorId_organizationId_fkey" FOREIGN KEY ("actorId", "organizationId") REFERENCES "OrganizationUser"("userId", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Preserve old foundation events with a null link; no backfill/event update.
-- Only operationId is nullable: MATCH SIMPLE cannot skip a nonnull correlation.
-- One completed operation may correlate many events; there is no event key uniqueness.
ALTER TABLE "InventoryLoanEvent" ADD COLUMN "operationId" TEXT;
ALTER TABLE "InventoryLoanEvent" ADD CONSTRAINT "InventoryLoanEvent_operation_fkey" FOREIGN KEY ("operationId", "loanId", "organizationId", "createdById") REFERENCES "InventoryLoanOperation"("id", "loanId", "organizationId", "actorId") MATCH SIMPLE ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Completed result must be inserted before its linked append-only events, all in
-- the same future Serializable transaction. No placeholder or overwritable upsert.
CREATE FUNCTION "reject_inventory_loan_operation_mutation"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Inventory loan operations are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InventoryLoanOperation_immutable"
BEFORE UPDATE OR DELETE ON "InventoryLoanOperation"
FOR EACH ROW EXECUTE FUNCTION "reject_inventory_loan_operation_mutation"();
