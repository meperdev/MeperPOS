-- Unexposed lifecycle vocabulary only; no stock writes or writer activation.
ALTER TYPE "InventoryLoanStatus" ADD VALUE 'CLOSED';
ALTER TYPE "InventoryLoanEventType" ADD VALUE 'CLOSED';
ALTER TYPE "InventoryLoanOperationType" ADD VALUE 'DELIVER';
ALTER TYPE "InventoryLoanOperationType" ADD VALUE 'RETURN';
ALTER TYPE "InventoryLoanOperationType" ADD VALUE 'CANCEL';
ALTER TYPE "InventoryLoanOperationType" ADD VALUE 'CLOSE';

-- Compare text rather than a newly added enum literal before transaction commit.
-- Preserve old header/item shapes; CLOSED is exclusively a null-quantity header.
ALTER TABLE "InventoryLoanEvent"
    DROP CONSTRAINT "InventoryLoanEvent_shape",
    ADD CONSTRAINT "InventoryLoanEvent_shape" CHECK (
        ("type"::text IN ('CREATED', 'CANCELLED', 'CLOSED') AND "itemId" IS NULL AND "quantity" IS NULL) OR
        ("type"::text IN ('DELIVERED', 'RETURNED', 'CANCELLED') AND
         "itemId" IS NOT NULL AND "quantity" IS NOT NULL AND "quantity" > 0)
    );
