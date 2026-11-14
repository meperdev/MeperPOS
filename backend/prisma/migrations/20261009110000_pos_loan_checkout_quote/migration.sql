-- Replace only quote validation; existing identity, link and reservation guards remain.
-- Updates return before catalog checks, so legacy snapshots stay immutable and replayable.
CREATE OR REPLACE FUNCTION "protect_pos_loan_sale_quote"() RETURNS trigger AS $$
DECLARE
    snapshot JSONB;
    item JSONB;
    extended BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW."quoteSnapshot" IS DISTINCT FROM OLD."quoteSnapshot"
            OR NEW."agreedCustomerTotal" IS DISTINCT FROM OLD."agreedCustomerTotal" THEN
            RAISE EXCEPTION 'POS loan sale quote is immutable from insertion';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW."quoteSnapshot" IS NULL THEN
        RETURN NEW;
    END IF;
    snapshot := NEW."quoteSnapshot";
    IF jsonb_typeof(snapshot) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'POS loan sale quote must be an object';
    END IF;
    extended := snapshot ? 'discountAmount';
    IF snapshot - ARRAY['items', 'agreedCustomerTotal', 'discountAmount'] <> '{}'::jsonb THEN
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
    IF extended THEN
        IF jsonb_typeof(snapshot -> 'discountAmount') IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION 'POS loan sale quote discount must be a string';
        END IF;
        IF (snapshot ->> 'discountAmount') !~ '^(0|[1-9][0-9]{0,7})[.][0-9]{2}$' THEN
            RAISE EXCEPTION 'POS loan sale quote discount must be canonical Decimal(10,2)';
        END IF;
    END IF;
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
        IF item - (CASE WHEN extended THEN
            ARRAY['productId', 'quantity', 'resolvedUnitPrice', 'discountAmount', 'taxRate', 'costPriceSnapshot']
            ELSE ARRAY['productId', 'quantity', 'resolvedUnitPrice', 'discountAmount'] END) <> '{}'::jsonb THEN
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
        IF (item ->> 'quantity') !~ '^[1-9][0-9]*$' OR (item ->> 'quantity')::numeric > 2147483647 THEN
            RAISE EXCEPTION 'POS loan sale quote quantity must be a positive Prisma Int';
        END IF;
        IF (item ->> 'resolvedUnitPrice') !~ '^(0|[1-9][0-9]{0,7})[.][0-9]{2}$'
            OR (item ->> 'discountAmount') !~ '^(0|[1-9][0-9]{0,7})[.][0-9]{2}$' THEN
            RAISE EXCEPTION 'POS loan sale quote prices must be canonical Decimal(10,2)';
        END IF;
        IF extended THEN
            IF jsonb_typeof(item -> 'taxRate') IS DISTINCT FROM 'number'
                OR jsonb_typeof(item -> 'costPriceSnapshot') IS DISTINCT FROM 'string' THEN
                RAISE EXCEPTION 'POS loan sale quote requires resolved tax and cost';
            END IF;
            IF (item ->> 'costPriceSnapshot') !~ '^(0|[1-9][0-9]{0,7})[.][0-9]{2}$'
                OR (item ->> 'taxRate')::numeric < 0
                OR (item ->> 'taxRate')::numeric > 999.99
                OR scale((item ->> 'taxRate')::numeric) > 2 THEN
                RAISE EXCEPTION 'POS loan sale quote tax or cost is outside storage bounds';
            END IF;
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
