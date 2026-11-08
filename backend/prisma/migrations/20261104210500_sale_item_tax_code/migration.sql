-- T4b: per-line fiscal facts at sale creation.
--
-- Purely additive: two NULLABLE columns on `SaleItem`, no table rewrite, no data
-- movement and no backfill. Sales created before this migration keep NULL and
-- are never reclassified (spec S7): the CUFE and the XML treat "every line
-- carries no code" as the pre-feature case and keep today's IVA-only behaviour.
--
-- No new enum is created here: `SaleItem.taxCode` reuses the `DianTaxCode` enum
-- that T4a added for the catalog (IVA, INC, ICA).
--
-- Note: `prisma migrate dev` also wanted to reconcile pre-existing drift between
-- this repository's migration history and `schema.prisma` (PaymentRecord.method,
-- Sale.userId / InventoryMovement.userId nullability, MoneyLoanEvent FK name).
-- That drift is unrelated to the fiscal model and is deliberately NOT part of
-- this migration.

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "taxAmount" DECIMAL(10,2),
ADD COLUMN     "taxCode" "DianTaxCode";
