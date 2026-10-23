-- Legacy intents remain unquoted; no existing row is populated retrospectively.
ALTER TABLE "PosLoanSaleIntent"
    ADD COLUMN "quoteSnapshot" JSONB,
    ADD COLUMN "agreedCustomerTotal" DECIMAL(10,2),
    ADD CONSTRAINT "PosLoanSaleIntent_quote_pair_check"
        CHECK (("quoteSnapshot" IS NULL) = ("agreedCustomerTotal" IS NULL)),
    ADD CONSTRAINT "PosLoanSaleIntent_quote_positive_check"
        CHECK ("agreedCustomerTotal" > 0);

-- Separate from the existing identity/delete/final-sale-claim protection.
CREATE FUNCTION "protect_pos_loan_sale_quote"() RETURNS trigger AS $$
DECLARE
    snapshot JSONB;
    item JSONB;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW."quoteSnapshot" IS DISTINCT FROM OLD."quoteSnapshot"
            OR NEW."agreedCustomerTotal" IS DISTINCT FROM OLD."agreedCustomerTotal" THEN
            RAISE EXCEPTION 'POS loan sale quote is immutable from insertion';
        END IF;
        RETURN NEW;
    END IF;

    -- Pair/positive CHECK constraints still apply after this return.
    IF NEW."quoteSnapshot" IS NULL THEN
        RETURN NEW;
    END IF;
    snapshot := NEW."quoteSnapshot";

    -- Check types before object operations or casts; missing keys fail closed.
    IF jsonb_typeof(snapshot) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'POS loan sale quote must be an object';
    END IF;
    IF snapshot - ARRAY['items', 'agreedCustomerTotal'] <> '{}'::jsonb THEN
        RAISE EXCEPTION 'POS loan sale quote contains unknown keys';
    END IF;
    IF jsonb_typeof(snapshot -> 'items') IS DISTINCT FROM 'array'
        OR jsonb_typeof(snapshot -> 'agreedCustomerTotal') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'POS loan sale quote requires items and a string total';
    END IF;
    IF jsonb_array_length(snapshot -> 'items') = 0 THEN
        RAISE EXCEPTION 'POS loan sale quote requires at least one item';
    END IF;
    IF (snapshot ->> 'agreedCustomerTotal') !~ '^(0|[1-9][0-9]{0,7})[.][0-9]{2}$' THEN
        RAISE EXCEPTION 'POS loan sale quote total must be canonical Decimal(10,2)';
    END IF;
    IF (snapshot ->> 'agreedCustomerTotal')::numeric IS DISTINCT FROM NEW."agreedCustomerTotal" THEN
        RAISE EXCEPTION 'POS loan sale quote total differs from agreed total';
    END IF;

    -- Parent scope is also protected by the existing composite foreign key.
    IF NOT EXISTS (
        SELECT 1 FROM "MoneyLoan" l
        WHERE l."id" = NEW."loanId"
            AND l."organizationId" = NEW."organizationId"
            AND l."customerId" = NEW."customerId"
            AND l."amount" = NEW."agreedCustomerTotal"
    ) THEN
        RAISE EXCEPTION 'POS loan sale quote requires the scoped loan with the agreed amount';
    END IF;

    FOR item IN SELECT value FROM jsonb_array_elements(snapshot -> 'items') LOOP
        IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'POS loan sale quote item must be an object';
        END IF;
        IF item - ARRAY['productId', 'quantity', 'resolvedUnitPrice', 'discountAmount'] <> '{}'::jsonb THEN
            RAISE EXCEPTION 'POS loan sale quote item contains unknown keys';
        END IF;
        IF jsonb_typeof(item -> 'productId') IS DISTINCT FROM 'string'
            OR jsonb_typeof(item -> 'quantity') IS DISTINCT FROM 'number'
            OR jsonb_typeof(item -> 'resolvedUnitPrice') IS DISTINCT FROM 'string'
            OR jsonb_typeof(item -> 'discountAmount') IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION 'POS loan sale quote item has missing or invalid fields';
        END IF;
        IF btrim(item ->> 'productId') = '' THEN
            RAISE EXCEPTION 'POS loan sale quote product ID must not be blank';
        END IF;
        IF (item ->> 'quantity') !~ '^[1-9][0-9]*$' THEN
            RAISE EXCEPTION 'POS loan sale quote quantity must be a positive integer';
        END IF;
        IF (item ->> 'quantity')::numeric > 2147483647 THEN
            RAISE EXCEPTION 'POS loan sale quote quantity exceeds Prisma Int';
        END IF;
        IF (item ->> 'resolvedUnitPrice') !~ '^(0|[1-9][0-9]{0,7})[.][0-9]{2}$'
            OR (item ->> 'discountAmount') !~ '^(0|[1-9][0-9]{0,7})[.][0-9]{2}$' THEN
            RAISE EXCEPTION 'POS loan sale quote prices must be canonical Decimal(10,2)';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM "Product" p
            WHERE p."id" = item ->> 'productId'
                AND p."organizationId" = NEW."organizationId"
        ) THEN
            RAISE EXCEPTION 'POS loan sale quote product must belong to the intent organization';
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PosLoanSaleIntent_quote_protect"
BEFORE INSERT OR UPDATE ON "PosLoanSaleIntent"
FOR EACH ROW EXECUTE FUNCTION "protect_pos_loan_sale_quote"();
