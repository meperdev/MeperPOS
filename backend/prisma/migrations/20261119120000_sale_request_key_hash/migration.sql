-- Sale: optional idempotency key for POST /api/sales (SEC-014 remediation).
-- Additive only: a sale registered without a key keeps a NULL hash, and the
-- unique index tolerates every such row because PostgreSQL treats NULLs as
-- distinct. A retried request with the same key and payload replays the sale
-- it already created instead of registering a second one.
ALTER TABLE "Sale" ADD COLUMN "requestKeyHash" VARCHAR(64);

CREATE UNIQUE INDEX "Sale_organizationId_requestKeyHash_key"
    ON "Sale"("organizationId", "requestKeyHash");
