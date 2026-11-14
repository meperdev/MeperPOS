-- Purely additive: one enum plus two NULLABLE columns. No table rewrite, no
-- data movement, no backfill. Existing rows keep NULL, which resolves to IVA at
-- read time for a taxable product (`resolveEffectiveTaxCode`), so today's
-- behaviour is unchanged and historical rows are never reclassified.
--
-- Note: `prisma migrate dev` also wanted to reconcile pre-existing drift between
-- this repository's migration history and `schema.prisma` (PaymentRecord.method,
-- Sale.userId / InventoryMovement.userId nullability, MoneyLoanEvent FK name).
-- That drift is unrelated to the fiscal model and is deliberately NOT part of
-- this migration.

-- CreateEnum
CREATE TYPE "DianTaxCode" AS ENUM ('IVA', 'INC', 'ICA');

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "defaultTaxCode" "DianTaxCode";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "taxCode" "DianTaxCode";
