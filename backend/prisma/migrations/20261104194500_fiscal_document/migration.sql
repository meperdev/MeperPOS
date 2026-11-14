-- T4c: the fiscal document a sale emits and its status column.
--
-- Purely additive: one new enum and one new table. No pre-existing column is
-- changed, no data is moved and nothing is backfilled, so a sale created before
-- this migration simply has no fiscal document (spec S7: the historical sales
-- are not going to be invoiced).
--
-- The activation decision of spec S9 ("solo para quienes la tienen activa")
-- lives in `Organization.settings.electronicInvoicing`, a backend-managed
-- system key of the existing settings engine, so this migration adds no column
-- to a pre-existing table and every organization stays disabled until the
-- platform enables it on purpose.
--
-- `status` starts at PENDING because a sale registers its fiscal document at
-- sale registration and only a transport may advance it (spec S8).
--
-- Preservation (T4h): the fiscal document is the evidence of what the
-- organization declared, so both of its foreign keys are RESTRICT instead of
-- CASCADE. PostgreSQL refuses the organization delete while any fiscal document
-- references it, and it refuses the sale delete too, so neither a tenant
-- teardown nor a sale deletion can erase the evidence underneath it. Both
-- refusals happen in the database and are independent of any count the
-- application checked first. A fixture that needs to remove its own rows must
-- delete its fiscal documents first, on purpose.
--
-- Note: `prisma migrate dev` also wanted to reconcile pre-existing drift between
-- this repository's migration history and `schema.prisma` (PaymentRecord.method,
-- Sale.userId / InventoryMovement.userId nullability, MoneyLoanEvent FK name).
-- That drift is unrelated to the fiscal document and is deliberately NOT part of
-- this migration.

-- CreateEnum
CREATE TYPE "FiscalDocumentStatus" AS ENUM ('PENDING', 'SENT', 'ACCEPTED', 'REJECTED', 'VOIDED');

-- CreateTable
CREATE TABLE "FiscalDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "status" "FiscalDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "cufe" TEXT,
    "invoiceNumber" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_saleId_key" ON "FiscalDocument"("saleId");

-- CreateIndex
-- The defining side of the composite relation below.
CREATE UNIQUE INDEX "FiscalDocument_saleId_organizationId_key" ON "FiscalDocument"("saleId", "organizationId");

-- CreateIndex
-- Referenced side of that relation: a sale's (id, organizationId) pair.
CREATE UNIQUE INDEX "Sale_id_organizationId_key" ON "Sale"("id", "organizationId");

-- CreateIndex
CREATE INDEX "FiscalDocument_organizationId_status_idx" ON "FiscalDocument"("organizationId", "status");

-- CreateIndex
CREATE INDEX "FiscalDocument_organizationId_issuedAt_idx" ON "FiscalDocument"("organizationId", "issuedAt");

-- AddForeignKey
-- RESTRICT on purpose: the database, not an application count, is what keeps a
-- fiscal record from disappearing with its organization.
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Composite on purpose: a document can only point at a sale of its own
-- organization, so a cross-tenant (organizationId, saleId) pair is rejected by
-- the database, not only by the service that writes it. It also covers the
-- plain saleId reference, so no second single-column foreign key is created.
-- RESTRICT on delete: the fiscal record outlives the sale it documents.
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_saleId_organizationId_fkey" FOREIGN KEY ("saleId", "organizationId") REFERENCES "Sale"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
