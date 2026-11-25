-- T3g — the per-site ledger is the only writer of the organization aggregate.
--
-- Since 20261125120000_product_stock_authority every writer moves a
-- ProductStock row and the "ProductStock_aggregate_delta" trigger keeps
-- Product.stock/reservedStock equal to the sum of those rows. Nothing enforced
-- that rule yet: a leftover writer, a script or a manual statement could still
-- update the aggregate directly and leave the site rows describing a stock the
-- organization does not have.
--
-- This migration installs that guard:
--
--   * "Product"."stock" and "Product"."reservedStock" may only change from
--     inside a trigger, which in practice is the aggregate delta above;
--   * every other "Product" column (name, prices, version, updatedAt, ...) is
--     still writable by ordinary application updates;
--   * inserts stay allowed because the "Product_default_site_stock" trigger
--     opens the default-site row carrying the balances the insert wrote.
--
-- How the guard recognizes the one authorized writer: `pg_trigger_depth()`.
-- The delta trigger runs one level deep, so the UPDATE it issues against
-- "Product" reaches a BEFORE UPDATE trigger at depth 2. An application
-- statement arrives at depth 1. A transaction-local marker GUC was considered
-- and rejected: any client can `SET LOCAL` it, while reaching depth 2 requires
-- another trigger to exist at all. Both checks would only be defeated by an
-- actor with DDL rights, and such an actor can drop this trigger anyway, so the
-- extra marker would add state without adding protection.
BEGIN;

-- Do not queue stock writers indefinitely while acquiring the table locks.
DO $$
BEGIN
    IF (SELECT setting::int FROM pg_catalog.pg_settings WHERE name = 'lock_timeout') NOT BETWEEN 1 AND 5000 THEN
        PERFORM set_config('lock_timeout', '5s', true);
    END IF;
END $$;

-- CREATE TRIGGER needs this lock. Taking it explicitly, before the function is
-- created, keeps the wait bounded by the timeout above and keeps the lock order
-- (Product first) identical to 20261125120000_product_stock_authority.
LOCK TABLE "Product" IN SHARE ROW EXCLUSIVE MODE;

-- Writes are held off while the guard is installed, but an in-flight writer has
-- already been resolved into a site row by the time it reaches this transaction:
-- no writer reads or writes the aggregate directly any more.
CREATE FUNCTION "guard_product_stock_aggregate"() RETURNS trigger AS $$
BEGIN
    -- Any ordinary edit of a product (price, name, version bump, activation)
    -- passes through untouched.
    IF NEW."stock" IS NOT DISTINCT FROM OLD."stock"
        AND NEW."reservedStock" IS NOT DISTINCT FROM OLD."reservedStock" THEN
        RETURN NEW;
    END IF;

    IF pg_trigger_depth() >= 2 THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Product % cannot change stock or reservedStock directly (stock % -> %, reservedStock % -> %): the site balances in ProductStock own those values and the aggregate follows them', OLD."id", OLD."stock", NEW."stock", OLD."reservedStock", NEW."reservedStock"
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Product_guard_stock_aggregate"
BEFORE UPDATE ON "Product"
FOR EACH ROW EXECUTE FUNCTION "guard_product_stock_aggregate"();

COMMIT;
