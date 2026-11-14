-- Additive intent storage; no existing loan is marked or linked retrospectively.
CREATE UNIQUE INDEX "MoneyLoan_id_organizationId_customerId_key"
    ON "MoneyLoan"("id", "organizationId", "customerId");
CREATE UNIQUE INDEX "Sale_id_organizationId_customerId_key"
    ON "Sale"("id", "organizationId", "customerId");

CREATE TABLE "PosLoanSaleIntent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalSaleId" TEXT,

    CONSTRAINT "PosLoanSaleIntent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PosLoanSaleIntent_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "PosLoanSaleIntent_customerId_organizationId_fkey"
        FOREIGN KEY ("customerId", "organizationId")
        REFERENCES "Customer"("id", "organizationId")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "PosLoanSaleIntent_loanId_organizationId_customerId_fkey"
        FOREIGN KEY ("loanId", "organizationId", "customerId")
        REFERENCES "MoneyLoan"("id", "organizationId", "customerId")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    -- Default MATCH SIMPLE permits an unclaimed intent, not a null-customer sale.
    CONSTRAINT "PosLoanSaleIntent_finalSaleId_organizationId_customerId_fkey"
        FOREIGN KEY ("finalSaleId", "organizationId", "customerId")
        REFERENCES "Sale"("id", "organizationId", "customerId")
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "PosLoanSaleIntent_loanId_key"
    ON "PosLoanSaleIntent"("loanId");
CREATE UNIQUE INDEX "PosLoanSaleIntent_finalSaleId_key"
    ON "PosLoanSaleIntent"("finalSaleId");
-- Composite uniques mirror Prisma's one-to-one relation tuples.
CREATE UNIQUE INDEX "PosLoanSaleIntent_loanId_organizationId_customerId_key"
    ON "PosLoanSaleIntent"("loanId", "organizationId", "customerId");
CREATE UNIQUE INDEX "PosLoanSaleIntent_finalSaleId_organizationId_customerId_key"
    ON "PosLoanSaleIntent"("finalSaleId", "organizationId", "customerId");

CREATE FUNCTION "protect_pos_loan_sale_intent"() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'POS loan sale intents cannot be deleted';
    END IF;

    IF NEW."id" IS DISTINCT FROM OLD."id"
        OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
        OR NEW."loanId" IS DISTINCT FROM OLD."loanId"
        OR NEW."customerId" IS DISTINCT FROM OLD."customerId"
        OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
        RAISE EXCEPTION 'POS loan sale intent identity is immutable';
    END IF;

    IF OLD."finalSaleId" IS NULL
        AND NEW."finalSaleId" IS DISTINCT FROM OLD."finalSaleId" THEN
        -- The completion flow closes the loan before claiming its final sale, so a
        -- legitimate claim always sees CLOSED. A CANCELLED loan must never be claimed.
        IF NOT EXISTS (
            SELECT 1 FROM "MoneyLoan" l
            WHERE l."id" = NEW."loanId"
                AND l."organizationId" = NEW."organizationId"
                AND l."status" = 'CLOSED'
        ) THEN
            RAISE EXCEPTION 'POS loan sale intent claim requires a closed loan';
        END IF;
    END IF;

    IF OLD."finalSaleId" IS NOT NULL
        AND NEW."finalSaleId" IS DISTINCT FROM OLD."finalSaleId" THEN
        RAISE EXCEPTION 'POS loan sale intent final sale claim is immutable';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PosLoanSaleIntent_protect"
BEFORE UPDATE OR DELETE ON "PosLoanSaleIntent"
FOR EACH ROW EXECUTE FUNCTION "protect_pos_loan_sale_intent"();
