-- Storage only; servicing writers and HTTP rollout remain disabled.
ALTER TYPE "MovementType" ADD VALUE 'LOAN_DELIVERY';
ALTER TYPE "MovementType" ADD VALUE 'LOAN_RETURN';

-- Null links preserve legacy movements; one immutable item event has one movement.
ALTER TABLE "InventoryMovement" ADD COLUMN "inventoryLoanEventId" TEXT;
CREATE UNIQUE INDEX "InventoryMovement_inventoryLoanEventId_key" ON "InventoryMovement"("inventoryLoanEventId");
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_inventoryLoanEventId_fkey" FOREIGN KEY ("inventoryLoanEventId") REFERENCES "InventoryLoanEvent"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- All new enum comparisons use text, including inside functions, so this DDL
-- never consumes a newly added MovementType literal before transaction commit.
CREATE FUNCTION "validate_inventory_loan_movement_insert"() RETURNS trigger AS $$
BEGIN
    IF NEW."type"::text NOT IN ('LOAN_DELIVERY', 'LOAN_RETURN') THEN
        IF NEW."inventoryLoanEventId" IS NOT NULL THEN
            RAISE EXCEPTION 'Legacy movement types cannot link inventory loan events';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW."inventoryLoanEventId" IS NULL OR NEW."saleId" IS NOT NULL OR NEW."userId" IS NULL THEN
        RAISE EXCEPTION 'Inventory loan movements require an event and actor, without a sale';
    END IF;
    IF NEW."previousStock" < 0 OR NEW."newStock" < 0 OR
       NEW."newStock"::bigint - NEW."previousStock"::bigint <> NEW."quantity"::bigint THEN
        RAISE EXCEPTION 'Inventory loan movement stock snapshots must match the signed quantity';
    END IF;

    -- Completed operation and append-only event must already exist. Bind the
    -- servicing actor, not the original loan creator. Do not compare live stock
    -- or active eligibility: inactive returns and per-item intermediate snapshots
    -- for multiple items of one product are valid evidence.
    IF NOT EXISTS (
        SELECT 1
        FROM "InventoryLoanEvent" e
        JOIN "InventoryLoanItem" i ON i."id" = e."itemId"
            AND i."loanId" = e."loanId"
            AND i."organizationId" = e."organizationId"
        JOIN "InventoryLoan" l ON l."id" = e."loanId"
            AND l."organizationId" = e."organizationId"
        JOIN "Product" p ON p."id" = i."productId"
            AND p."organizationId" = e."organizationId"
        JOIN "InventoryLoanOperation" o ON o."id" = e."operationId"
            AND o."loanId" = e."loanId"
            AND o."organizationId" = e."organizationId"
            AND o."actorId" = e."createdById"
        WHERE e."id" = NEW."inventoryLoanEventId"
            AND e."organizationId" = NEW."organizationId"
            AND i."productId" = NEW."productId"
            AND e."createdById" = NEW."userId"
            AND e."itemId" IS NOT NULL AND e."quantity" > 0
            AND (
                (NEW."type"::text = 'LOAN_DELIVERY'
                 AND e."type"::text = 'DELIVERED' AND o."type"::text = 'DELIVER'
                 AND NEW."quantity"::bigint = -e."quantity"::bigint) OR
                (NEW."type"::text = 'LOAN_RETURN'
                 AND e."type"::text = 'RETURNED' AND o."type"::text = 'RETURN'
                 AND NEW."quantity"::bigint = e."quantity"::bigint)
            )
    ) THEN
        RAISE EXCEPTION 'Inventory loan movement correlation must match item, loan, product, tenant, actor and operation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InventoryMovement_inventory_loan_insert"
BEFORE INSERT ON "InventoryMovement"
FOR EACH ROW EXECUTE FUNCTION "validate_inventory_loan_movement_insert"();

-- Reject all mutation routes, including no-op updates and legacy acquisition of
-- a link/type. Ordinary unlinked legacy rows retain their previous mutability.
CREATE FUNCTION "protect_inventory_loan_movement"() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."inventoryLoanEventId" IS NOT NULL OR
           OLD."type"::text IN ('LOAN_DELIVERY', 'LOAN_RETURN') THEN
            RAISE EXCEPTION 'Inventory loan movements are immutable';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD."inventoryLoanEventId" IS NOT NULL OR
       OLD."type"::text IN ('LOAN_DELIVERY', 'LOAN_RETURN') OR
       NEW."inventoryLoanEventId" IS NOT NULL OR
       NEW."type"::text IN ('LOAN_DELIVERY', 'LOAN_RETURN') THEN
        RAISE EXCEPTION 'Inventory loan movements are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InventoryMovement_inventory_loan_immutable"
BEFORE UPDATE OR DELETE ON "InventoryMovement"
FOR EACH ROW EXECUTE FUNCTION "protect_inventory_loan_movement"();
