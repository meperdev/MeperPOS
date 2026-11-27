-- T4 — stock transfers between two sites of one organization.
--
-- A transfer is dispatched from a source site (stock leaves that site's row and
-- therefore the organization aggregate), travels as an IN_TRANSIT document, and
-- either lands at the destination (its stock enters that site's row and the
-- aggregate again) or is cancelled (its stock returns to the origin). Both ends
-- must belong to the transfer's organization, which the composite foreign keys
-- below make unrepresentable rather than merely validated.
--
-- Movement types: TRANSFER_OUT is stock that left a site because of a transfer;
-- TRANSFER_IN is stock that entered a site because of one, including the origin
-- receiving its own stock back on cancellation. Adding the literals here does not
-- consume them in this migration, so the ALTER TYPE statements are safe inside
-- the transaction (PostgreSQL 12+).
BEGIN;

-- Do not queue writers indefinitely while acquiring locks.
DO $$
BEGIN
    IF (SELECT setting::int FROM pg_catalog.pg_settings WHERE name = 'lock_timeout') NOT BETWEEN 1 AND 5000 THEN
        PERFORM set_config('lock_timeout', '5s', true);
    END IF;
END $$;

ALTER TYPE "MovementType" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "MovementType" ADD VALUE 'TRANSFER_IN';

CREATE TYPE "StockTransferStatus" AS ENUM ('IN_TRANSIT', 'RECEIVED', 'CANCELLED');

CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "status" "StockTransferStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id"),
    -- A transfer always moves stock somewhere else.
    CONSTRAINT "StockTransfer_sites_differ" CHECK ("fromLocationId" <> "toLocationId"),
    -- Each terminal state carries exactly the facts that describe it, so a
    -- half-written receipt or cancellation cannot exist.
    CONSTRAINT "StockTransfer_terminal_shape" CHECK (
        ("status" = 'IN_TRANSIT'
            AND "receivedAt" IS NULL AND "receivedById" IS NULL
            AND "cancelledAt" IS NULL AND "cancelledById" IS NULL AND "cancelReason" IS NULL)
        OR ("status" = 'RECEIVED'
            AND "receivedAt" IS NOT NULL
            AND "cancelledAt" IS NULL AND "cancelledById" IS NULL AND "cancelReason" IS NULL)
        OR ("status" = 'CANCELLED'
            AND "cancelledAt" IS NOT NULL AND "cancelReason" IS NOT NULL
            AND "receivedAt" IS NULL AND "receivedById" IS NULL)
    )
);

-- Tenant-scoped document identity: the number is consecutive per organization.
CREATE UNIQUE INDEX "StockTransfer_id_organizationId_key" ON "StockTransfer"("id", "organizationId");
CREATE UNIQUE INDEX "StockTransfer_organizationId_number_key" ON "StockTransfer"("organizationId", "number");
CREATE INDEX "StockTransfer_organizationId_status_createdAt_idx" ON "StockTransfer"("organizationId", "status", "createdAt");
CREATE INDEX "StockTransfer_fromLocationId_organizationId_idx" ON "StockTransfer"("fromLocationId", "organizationId");
CREATE INDEX "StockTransfer_toLocationId_organizationId_idx" ON "StockTransfer"("toLocationId", "organizationId");

ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A site that took part in a transfer keeps its history: deleting it alone is
-- refused, exactly like a site that carries "InventoryMovement" rows. An
-- organization delete still succeeds, because both site ends and the transfer
-- are removed by that statement before the reference is checked.
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_fromLocationId_organizationId_fkey"
    FOREIGN KEY ("fromLocationId", "organizationId") REFERENCES "Location"("id", "organizationId") ON DELETE NO ACTION ON UPDATE RESTRICT;
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_toLocationId_organizationId_fkey"
    FOREIGN KEY ("toLocationId", "organizationId") REFERENCES "Location"("id", "organizationId") ON DELETE NO ACTION ON UPDATE RESTRICT;
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_receivedById_fkey"
    FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_cancelledById_fkey"
    FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "StockTransferItem" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "StockTransferItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StockTransferItem_quantity_positive" CHECK ("quantity" > 0)
);

-- One line per product: a repeated product would make the stock effect ambiguous.
CREATE UNIQUE INDEX "StockTransferItem_transferId_productId_key" ON "StockTransferItem"("transferId", "productId");
CREATE INDEX "StockTransferItem_productId_organizationId_idx" ON "StockTransferItem"("productId", "organizationId");

ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_transferId_organizationId_fkey"
    FOREIGN KEY ("transferId", "organizationId") REFERENCES "StockTransfer"("id", "organizationId") ON DELETE CASCADE ON UPDATE RESTRICT;
-- A line is history: the product it moved cannot be deleted while the line exists.
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_productId_organizationId_fkey"
    FOREIGN KEY ("productId", "organizationId") REFERENCES "Product"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
