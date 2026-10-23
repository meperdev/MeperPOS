-- Additive storage only. Existing null initiation evidence is never retrofilled.
ALTER TABLE "PosLoanSaleIntent"
    ADD COLUMN "initiationRequestKey" VARCHAR(100),
    ADD COLUMN "initiationRequestHash" VARCHAR(64),
    ADD COLUMN "initiatedById" TEXT,
    ADD COLUMN "initiationResult" JSONB,
    ADD CONSTRAINT "PosLoanSaleIntent_initiation_tuple_check"
        CHECK (num_nonnulls("initiationRequestKey", "initiationRequestHash",
            "initiatedById", "initiationResult") IN (0, 4)),
    ADD CONSTRAINT "PosLoanSaleIntent_initiation_key_check"
        CHECK (btrim("initiationRequestKey") <> ''),
    ADD CONSTRAINT "PosLoanSaleIntent_initiation_hash_check"
        CHECK ("initiationRequestHash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "PosLoanSaleIntent_initiatedById_fkey"
        FOREIGN KEY ("initiatedById") REFERENCES "User"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE UNIQUE INDEX "PosLoanSaleIntent_organizationId_initiationRequestKey_key"
    ON "PosLoanSaleIntent"("organizationId", "initiationRequestKey");
CREATE UNIQUE INDEX "PosLoanSaleIntent_id_organizationId_key"
    ON "PosLoanSaleIntent"("id", "organizationId");

CREATE FUNCTION "validate_pos_loan_initiation"() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW."initiationRequestKey" IS DISTINCT FROM OLD."initiationRequestKey"
            OR NEW."initiationRequestHash" IS DISTINCT FROM OLD."initiationRequestHash"
            OR NEW."initiatedById" IS DISTINCT FROM OLD."initiatedById"
            OR NEW."initiationResult" IS DISTINCT FROM OLD."initiationResult" THEN
            RAISE EXCEPTION 'POS initiation evidence is immutable from insertion';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW."initiationRequestKey" IS NULL THEN RETURN NEW; END IF;
    IF NEW."quoteSnapshot" IS NULL THEN
        RAISE EXCEPTION 'POS initiation requires a frozen quote';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM "MoneyLoan" l
        WHERE l."id" = NEW."loanId"
            AND l."organizationId" = NEW."organizationId"
            AND l."customerId" = NEW."customerId"
            AND l."amount" = NEW."agreedCustomerTotal"
            AND l."createdById" = NEW."initiatedById"
            AND l."type" = 'MONEY'
    ) THEN
        RAISE EXCEPTION 'POS initiation requires the scoped MONEY loan and creator';
    END IF;
    -- Missing keys and JSON nulls fail before text extraction or numeric casts.
    IF jsonb_typeof(NEW."initiationResult") IS DISTINCT FROM 'object'
        OR jsonb_typeof(NEW."initiationResult" -> 'intentId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(NEW."initiationResult" -> 'loanId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(NEW."initiationResult" -> 'organizationId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(NEW."initiationResult" -> 'customerId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(NEW."initiationResult" -> 'agreedCustomerTotal') IS DISTINCT FROM 'string'
        OR jsonb_typeof(NEW."initiationResult" -> 'quoteSnapshot') IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'POS initiation result has missing or invalid fields';
    END IF;
    IF (NEW."initiationResult" ->> 'agreedCustomerTotal') !~ '^(0|[1-9][0-9]{0,7})[.][0-9]{2}$' THEN
        RAISE EXCEPTION 'POS initiation result total must be canonical Decimal(10,2)';
    END IF;
    IF NEW."initiationResult" ->> 'intentId' IS DISTINCT FROM NEW."id"
        OR NEW."initiationResult" ->> 'loanId' IS DISTINCT FROM NEW."loanId"
        OR NEW."initiationResult" ->> 'organizationId' IS DISTINCT FROM NEW."organizationId"
        OR NEW."initiationResult" ->> 'customerId' IS DISTINCT FROM NEW."customerId"
        OR (NEW."initiationResult" ->> 'agreedCustomerTotal')::numeric IS DISTINCT FROM NEW."agreedCustomerTotal"
        OR NEW."initiationResult" -> 'quoteSnapshot' IS DISTINCT FROM NEW."quoteSnapshot" THEN
        RAISE EXCEPTION 'POS initiation result differs from its immutable intent';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PosLoanSaleIntent_initiation_validate"
BEFORE INSERT OR UPDATE ON "PosLoanSaleIntent"
FOR EACH ROW EXECUTE FUNCTION "validate_pos_loan_initiation"();

CREATE TYPE "PosLoanSaleReservationState" AS ENUM ('HELD', 'CONSUMED', 'RELEASED');
CREATE TABLE "PosLoanSaleReservation" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "state" "PosLoanSaleReservationState" NOT NULL DEFAULT 'HELD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),
    "finalizedById" TEXT,
    CONSTRAINT "PosLoanSaleReservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PosLoanSaleReservation_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "PosLoanSaleReservation_finalization_check" CHECK (
        ("state" = 'HELD' AND "finalizedAt" IS NULL AND "finalizedById" IS NULL)
        OR ("state" IN ('CONSUMED', 'RELEASED')
            AND "finalizedAt" IS NOT NULL AND "finalizedById" IS NOT NULL)
    ),
    CONSTRAINT "PosLoanSaleReservation_intentId_organizationId_fkey"
        FOREIGN KEY ("intentId", "organizationId")
        REFERENCES "PosLoanSaleIntent"("id", "organizationId")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "PosLoanSaleReservation_productId_organizationId_fkey"
        FOREIGN KEY ("productId", "organizationId") REFERENCES "Product"("id", "organizationId")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "PosLoanSaleReservation_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "PosLoanSaleReservation_finalizedById_fkey"
        FOREIGN KEY ("finalizedById") REFERENCES "User"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "PosLoanSaleReservation_intentId_productId_key"
    ON "PosLoanSaleReservation"("intentId", "productId");

-- Counters are deliberately not changed here: the later caller-owned transaction
-- must pair each owned row with its sorted product CAS, including cancellation.
CREATE FUNCTION "validate_pos_loan_reservation"() RETURNS trigger AS $$
DECLARE
    intent "PosLoanSaleIntent"%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'POS reservations cannot be deleted';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW."state" IS DISTINCT FROM 'HELD'
            OR NEW."finalizedAt" IS NOT NULL OR NEW."finalizedById" IS NOT NULL THEN
            RAISE EXCEPTION 'POS reservations must start held without finalization';
        END IF;
        SELECT i.* INTO intent FROM "PosLoanSaleIntent" i
        WHERE i."id" = NEW."intentId" AND i."organizationId" = NEW."organizationId";
        IF NOT FOUND OR intent."quoteSnapshot" IS NULL
            OR intent."initiationRequestKey" IS NULL OR intent."finalSaleId" IS NOT NULL THEN
            RAISE EXCEPTION 'POS reservation requires an initiated unclaimed scoped intent';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM "MoneyLoan" l
            WHERE l."id" = intent."loanId" AND l."organizationId" = NEW."organizationId"
                AND l."customerId" = intent."customerId" AND l."type" = 'MONEY'
                AND l."amount" = intent."agreedCustomerTotal"
                AND l."createdById" = intent."initiatedById" AND l."status" = 'OPEN'
        ) THEN
            RAISE EXCEPTION 'POS reservation requires its open scoped MONEY loan';
        END IF;
        -- Sum all frozen priced lines for this product, not just the first match.
        IF NEW."quantity" IS DISTINCT FROM (
            SELECT SUM((item ->> 'quantity')::numeric)
            FROM jsonb_array_elements(intent."quoteSnapshot" -> 'items') item
            WHERE item ->> 'productId' = NEW."productId"
        ) THEN
            RAISE EXCEPTION 'POS reservation quantity differs from the frozen quote';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM "Product" p
            WHERE p."id" = NEW."productId" AND p."organizationId" = NEW."organizationId"
                AND p."type" = 'PRODUCT' AND p."tracksStock" = true AND p."active" = true
        ) THEN
            RAISE EXCEPTION 'POS reservation requires an active tracked physical product';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW."id" IS DISTINCT FROM OLD."id"
            OR NEW."intentId" IS DISTINCT FROM OLD."intentId"
            OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
            OR NEW."productId" IS DISTINCT FROM OLD."productId"
            OR NEW."quantity" IS DISTINCT FROM OLD."quantity"
            OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
            RAISE EXCEPTION 'POS reservation identity and quantity are immutable';
        END IF;
        IF OLD."state" <> 'HELD' THEN
            IF NEW."state" IS DISTINCT FROM OLD."state"
                OR NEW."finalizedAt" IS DISTINCT FROM OLD."finalizedAt"
                OR NEW."finalizedById" IS DISTINCT FROM OLD."finalizedById" THEN
                RAISE EXCEPTION 'Terminal POS reservations are immutable';
            END IF;
            RETURN NEW;
        END IF;
        IF NEW."state" = 'HELD' THEN RETURN NEW; END IF;
        -- No catalog checks on historical updates. Terminal evidence is mandatory.
        IF NEW."finalizedAt" IS NULL OR NEW."finalizedById" IS NULL THEN
            RAISE EXCEPTION 'Terminal POS reservations require an actor and time';
        END IF;
        IF NEW."state" = 'CONSUMED' THEN
            -- The claim is not enough: a CANCELLED loan must never reach CONSUMED,
            -- and the completion flow closes the loan before consuming its holds.
            IF NOT EXISTS (
                SELECT 1 FROM "PosLoanSaleIntent" i JOIN "MoneyLoan" l
                    ON l."id" = i."loanId" AND l."organizationId" = i."organizationId"
                WHERE i."id" = NEW."intentId" AND i."organizationId" = NEW."organizationId"
                    AND i."finalSaleId" IS NOT NULL
                    AND l."status" = 'CLOSED'
            ) THEN
                RAISE EXCEPTION 'Consumed POS reservation requires its final sale claim';
            END IF;
        ELSIF NEW."state" = 'RELEASED' THEN
            IF NOT EXISTS (
                SELECT 1 FROM "PosLoanSaleIntent" i JOIN "MoneyLoan" l
                    ON l."id" = i."loanId" AND l."organizationId" = i."organizationId"
                        AND l."customerId" = i."customerId"
                WHERE i."id" = NEW."intentId" AND i."organizationId" = NEW."organizationId"
                    AND l."status" = 'CANCELLED' AND i."finalSaleId" IS NULL
            ) THEN
                RAISE EXCEPTION 'Released POS reservation requires its cancelled unclaimed loan';
            END IF;
        ELSE
            RAISE EXCEPTION 'Invalid POS reservation terminal transition';
        END IF;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Unsupported POS reservation operation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PosLoanSaleReservation_validate"
BEFORE INSERT OR UPDATE OR DELETE ON "PosLoanSaleReservation"
FOR EACH ROW EXECUTE FUNCTION "validate_pos_loan_reservation"();
