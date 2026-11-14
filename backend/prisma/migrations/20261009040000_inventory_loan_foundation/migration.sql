-- Unexposed foundation only; no stock/reservation writes or monetary changes.
CREATE TYPE "InventoryLoanStatus" AS ENUM ('OPEN', 'CANCELLED');
CREATE TYPE "InventoryLoanEventType" AS ENUM ('CREATED', 'DELIVERED', 'RETURNED', 'CANCELLED');

CREATE TABLE "InventoryLoan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "InventoryLoanStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 0,
    "customerId" TEXT,
    "supplierId" TEXT,
    "employeeId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryLoan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InventoryLoan_version" CHECK ("version" >= 0),
    CONSTRAINT "InventoryLoan_one_counterparty" CHECK (
        num_nonnulls("customerId", "supplierId", "employeeId") = 1
    )
);

CREATE TABLE "InventoryLoanItem" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "deliveredQuantity" INTEGER NOT NULL DEFAULT 0,
    "returnedQuantity" INTEGER NOT NULL DEFAULT 0,
    "cancelledQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryLoanItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InventoryLoanItem_quantities" CHECK (
        "quantity" > 0 AND "deliveredQuantity" >= 0 AND
        "returnedQuantity" >= 0 AND "cancelledQuantity" >= 0 AND
        "returnedQuantity" <= "deliveredQuantity" AND
        "deliveredQuantity" <= "quantity" - "cancelledQuantity"
    )
);

CREATE TABLE "InventoryLoanEvent" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT,
    "type" "InventoryLoanEventType" NOT NULL,
    "quantity" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryLoanEvent_pkey" PRIMARY KEY ("id"),
    -- Header cancellation is recorded even when no undelivered units remain.
    -- Per-item CANCELLED events record only positive reservation releases.
    CONSTRAINT "InventoryLoanEvent_shape" CHECK (
        ("type" IN ('CREATED', 'CANCELLED') AND "itemId" IS NULL AND "quantity" IS NULL) OR
        ("type" IN ('DELIVERED', 'RETURNED', 'CANCELLED') AND
         "itemId" IS NOT NULL AND "quantity" IS NOT NULL AND "quantity" > 0)
    )
);

CREATE UNIQUE INDEX "Customer_id_organizationId_key" ON "Customer"("id", "organizationId");
CREATE UNIQUE INDEX "Supplier_id_organizationId_key" ON "Supplier"("id", "organizationId");
CREATE UNIQUE INDEX "Product_id_organizationId_key" ON "Product"("id", "organizationId");
CREATE UNIQUE INDEX "InventoryLoan_id_organizationId_key" ON "InventoryLoan"("id", "organizationId");
CREATE UNIQUE INDEX "InventoryLoanItem_id_loanId_organizationId_key" ON "InventoryLoanItem"("id", "loanId", "organizationId");
CREATE INDEX "InventoryLoan_organizationId_createdAt_id_idx" ON "InventoryLoan"("organizationId", "createdAt", "id");
CREATE INDEX "InventoryLoanItem_organizationId_loanId_idx" ON "InventoryLoanItem"("organizationId", "loanId");
CREATE INDEX "InventoryLoanItem_organizationId_productId_idx" ON "InventoryLoanItem"("organizationId", "productId");
CREATE INDEX "InventoryLoanEvent_organizationId_loanId_createdAt_id_idx" ON "InventoryLoanEvent"("organizationId", "loanId", "createdAt", "id");

-- Default MATCH SIMPLE intentionally permits each unselected nullable counterparty.
ALTER TABLE "InventoryLoan" ADD CONSTRAINT "InventoryLoan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "InventoryLoan" ADD CONSTRAINT "InventoryLoan_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "InventoryLoan" ADD CONSTRAINT "InventoryLoan_supplierId_organizationId_fkey" FOREIGN KEY ("supplierId", "organizationId") REFERENCES "Supplier"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "InventoryLoan" ADD CONSTRAINT "InventoryLoan_employeeId_organizationId_fkey" FOREIGN KEY ("employeeId", "organizationId") REFERENCES "OrganizationUser"("userId", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "InventoryLoan" ADD CONSTRAINT "InventoryLoan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "InventoryLoanItem" ADD CONSTRAINT "InventoryLoanItem_loanId_organizationId_fkey" FOREIGN KEY ("loanId", "organizationId") REFERENCES "InventoryLoan"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "InventoryLoanItem" ADD CONSTRAINT "InventoryLoanItem_productId_organizationId_fkey" FOREIGN KEY ("productId", "organizationId") REFERENCES "Product"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "InventoryLoanEvent" ADD CONSTRAINT "InventoryLoanEvent_loanId_organizationId_fkey" FOREIGN KEY ("loanId", "organizationId") REFERENCES "InventoryLoan"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "InventoryLoanEvent" ADD CONSTRAINT "InventoryLoanEvent_itemId_loanId_organizationId_fkey" FOREIGN KEY ("itemId", "loanId", "organizationId") REFERENCES "InventoryLoanItem"("id", "loanId", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "InventoryLoanEvent" ADD CONSTRAINT "InventoryLoanEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION "reject_inventory_loan_event_mutation"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Inventory loan history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InventoryLoanEvent_append_only"
BEFORE UPDATE OR DELETE ON "InventoryLoanEvent"
FOR EACH ROW EXECUTE FUNCTION "reject_inventory_loan_event_mutation"();

CREATE FUNCTION "protect_inventory_loan_identity"() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Inventory loan evidence cannot be deleted';
    END IF;
    IF ROW(NEW."id", NEW."organizationId", NEW."customerId", NEW."supplierId",
           NEW."employeeId", NEW."createdById", NEW."createdAt") IS DISTINCT FROM
       ROW(OLD."id", OLD."organizationId", OLD."customerId", OLD."supplierId",
           OLD."employeeId", OLD."createdById", OLD."createdAt") THEN
        RAISE EXCEPTION 'Inventory loan identity is immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InventoryLoan_identity"
BEFORE UPDATE OR DELETE ON "InventoryLoan"
FOR EACH ROW EXECUTE FUNCTION "protect_inventory_loan_identity"();

CREATE FUNCTION "protect_inventory_loan_item_evidence"() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Inventory loan item evidence cannot be deleted';
    END IF;
    IF ROW(NEW."id", NEW."loanId", NEW."organizationId", NEW."productId",
           NEW."quantity", NEW."createdAt") IS DISTINCT FROM
       ROW(OLD."id", OLD."loanId", OLD."organizationId", OLD."productId",
           OLD."quantity", OLD."createdAt") OR
       NEW."deliveredQuantity" < OLD."deliveredQuantity" OR
       NEW."returnedQuantity" < OLD."returnedQuantity" OR
       NEW."cancelledQuantity" < OLD."cancelledQuantity" THEN
        RAISE EXCEPTION 'Inventory loan item identity and accumulated evidence are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InventoryLoanItem_evidence"
BEFORE UPDATE OR DELETE ON "InventoryLoanItem"
FOR EACH ROW EXECUTE FUNCTION "protect_inventory_loan_item_evidence"();
