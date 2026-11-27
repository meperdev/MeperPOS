-- T3a — the per-site stock ledger becomes ready to be the source of truth.
--
-- "ProductStock" holds one row per (product, location). This migration fills it
-- from the balances that every current reader still uses (reports, alerts,
-- catalog availability, low stock, exports all read "Product"), and installs the
-- two triggers that keep those organization-wide balances equal to the sum of
-- their site rows from now on:
--
--   * a row trigger on "ProductStock" applies each insert/update/delete delta to
--     the owning "Product", so Product.stock = SUM(ProductStock.stock) and
--     Product.reservedStock = SUM(ProductStock.reservedStock) after every
--     statement;
--   * a row trigger on "Product" opens the default-site row for a new product,
--     carrying the balances that insert already wrote.
--
-- Direct writes to "Product"."stock"/"reservedStock" stay allowed on purpose:
-- each remaining writer moves to the site ledger in its own unit, and the guard
-- that rejects direct aggregate writes lands last. Nothing here changes what the
-- application reads.
BEGIN;

-- Do not queue stock writers indefinitely while acquiring the table locks.
DO $$
BEGIN
    IF (SELECT setting::int FROM pg_catalog.pg_settings WHERE name = 'lock_timeout') NOT BETWEEN 1 AND 5000 THEN
        PERFORM set_config('lock_timeout', '5s', true);
    END IF;
END $$;

-- Writers are held off for the whole migration. The seed must see every product,
-- and a product inserted while the seed runs would commit without its site row.
-- "Location" is held so the default site each product is seeded at cannot move
-- underneath the seed. The order is fixed (Product, then Location) so this
-- migration cannot deadlock with another one locking the same tables; SHARE ROW
-- EXCLUSIVE on "Product" is also the lock CREATE TRIGGER needs, so no upgrade is
-- attempted later.
LOCK TABLE "Product" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "Location" IN SHARE MODE;

-- The seed runs once, against the dormant table.
DO $$
DECLARE
    occupied bigint;
BEGIN
    SELECT count(*) INTO occupied FROM "ProductStock";
    IF occupied > 0 THEN
        RAISE EXCEPTION 'ProductStock must be empty before 20261125120000_product_stock_authority (found % rows); balances were already copied or written by hand', occupied;
    END IF;
END $$;

-- Every product needs a default site in its own organization to be seeded. This
-- is repaired on the data, never by inventing a site for a product that never
-- had one.
DO $$
DECLARE
    orphans bigint;
    sample text;
BEGIN
    SELECT count(*) INTO orphans
    FROM "Product" p
    WHERE NOT EXISTS (
        SELECT 1 FROM "Location" l
        WHERE l."organizationId" = p."organizationId" AND l."isDefault"
    );

    IF orphans > 0 THEN
        SELECT string_agg(
                   format('product %s (organization %s)', p."id", p."organizationId"),
                   ', ' ORDER BY p."id"
               )
        INTO sample
        FROM (
            SELECT p."id", p."organizationId"
            FROM "Product" p
            WHERE NOT EXISTS (
                SELECT 1 FROM "Location" l
                WHERE l."organizationId" = p."organizationId" AND l."isDefault"
            )
            ORDER BY p."id"
            LIMIT 5
        ) p;
        RAISE EXCEPTION 'Cannot seed ProductStock: % product(s) belong to an organization without a default location (first: %). Create the default site before deploying; balances are not rewritten here', orphans, sample;
    END IF;
END $$;

-- The per-site bound is the same one "Product" already carries and it is
-- enforced on every new ProductStock row. Legacy balances the older NOT VALID
-- constraint never validated therefore stop the migration with this message
-- instead of surfacing as an opaque constraint violation, and they are never
-- normalized: repairing a reservation is the operator's decision.
DO $$
DECLARE
    inconsistent bigint;
    sample text;
BEGIN
    SELECT count(*) INTO inconsistent
    FROM "Product" p
    WHERE NOT (p."reservedStock" >= 0 AND (p."stock" < 0 OR p."reservedStock" <= p."stock"));

    IF inconsistent > 0 THEN
        SELECT string_agg(
                   format('product %s (stock %s, reservedStock %s)', p."id", p."stock", p."reservedStock"),
                   ', ' ORDER BY p."id"
               )
        INTO sample
        FROM (
            SELECT p."id", p."stock", p."reservedStock"
            FROM "Product" p
            WHERE NOT (p."reservedStock" >= 0 AND (p."stock" < 0 OR p."reservedStock" <= p."stock"))
            ORDER BY p."id"
            LIMIT 5
        ) p;
        RAISE EXCEPTION 'Cannot seed ProductStock: % product(s) hold balances the per-site reservation check rejects (first: %). Repair the reservations before deploying; this migration never rewrites stock or reservations', inconsistent, sample;
    END IF;
END $$;

-- One row per product at its organization's default site, carrying exactly the
-- aggregate it accounts for. Negative legacy stock is copied as it is: the site
-- check accepts it because "Product" does.
INSERT INTO "ProductStock" ("productId", "locationId", "organizationId", "stock", "reservedStock")
SELECT p."id", l."id", p."organizationId", p."stock", p."reservedStock"
FROM "Product" p
JOIN "Location" l ON l."organizationId" = p."organizationId" AND l."isDefault";

-- A partial seed would leave products whose aggregate has no site behind.
DO $$
DECLARE
    products bigint;
    balances bigint;
BEGIN
    SELECT count(*) INTO products FROM "Product";
    SELECT count(*) INTO balances FROM "ProductStock";
    IF balances <> products THEN
        RAISE EXCEPTION 'ProductStock seed is incomplete: % product(s) but % site balance(s)', products, balances;
    END IF;
END $$;

-- Keeps "Product" as the organization-wide aggregate. It is created after the
-- seed above, so the seed never passes through it. The delta is applied
-- arithmetically ("stock" + delta) rather than by recomputing a SUM, so a
-- concurrent change at another site accumulates under READ COMMITTED and a stale
-- snapshot aborts under REPEATABLE READ instead of silently overwriting it.
CREATE FUNCTION "apply_product_site_stock_delta"() RETURNS trigger AS $$
DECLARE
    delta_stock integer;
    delta_reserved integer;
    target_product text;
    target_organization text;
BEGIN
    -- The default-site row a new product opens already carries balances that
    -- insert wrote, so that insert must not be added a second time.
    IF coalesce(current_setting('meperpos.suppress_site_stock_delta', true), '') = 'on' THEN
        RETURN NULL;
    END IF;

    IF TG_OP = 'DELETE' THEN
        delta_stock := -OLD."stock";
        delta_reserved := -OLD."reservedStock";
        target_product := OLD."productId";
        target_organization := OLD."organizationId";
    ELSE
        IF TG_OP = 'UPDATE' THEN
            IF NEW."productId" <> OLD."productId"
                OR NEW."locationId" <> OLD."locationId"
                OR NEW."organizationId" <> OLD."organizationId" THEN
                RAISE EXCEPTION 'ProductStock identity columns cannot be changed';
            END IF;
            delta_stock := NEW."stock" - OLD."stock";
            delta_reserved := NEW."reservedStock" - OLD."reservedStock";
            IF delta_stock = 0 AND delta_reserved = 0 THEN
                RETURN NULL;
            END IF;
        ELSE
            delta_stock := NEW."stock";
            delta_reserved := NEW."reservedStock";
        END IF;
        target_product := NEW."productId";
        target_organization := NEW."organizationId";
    END IF;

    UPDATE "Product"
    SET "stock" = "stock" + delta_stock,
        "reservedStock" = "reservedStock" + delta_reserved,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = target_product AND "organizationId" = target_organization;

    -- Deleting a product cascades its site rows away after the aggregate row is
    -- gone; anything else must still find the product it belongs to.
    IF TG_OP <> 'DELETE' AND NOT FOUND THEN
        RAISE EXCEPTION 'Product % in organization % vanished while applying a site stock delta', target_product, target_organization;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ProductStock_aggregate_delta"
AFTER INSERT OR UPDATE OR DELETE ON "ProductStock"
FOR EACH ROW EXECUTE FUNCTION "apply_product_site_stock_delta"();

-- Gives every new product its default-site row so product creation, imports,
-- seeds and backfills keep writing only the aggregate they always wrote. The
-- inserted row carries those balances, and the suppression setting above stops
-- the delta trigger from adding them to "Product" a second time.
CREATE FUNCTION "open_default_site_stock"() RETURNS trigger AS $$
DECLARE
    default_location text;
    previous text := coalesce(current_setting('meperpos.suppress_site_stock_delta', true), '');
BEGIN
    SELECT l."id" INTO default_location
    FROM "Location" l
    WHERE l."organizationId" = NEW."organizationId" AND l."isDefault"
    ORDER BY l."id"
    LIMIT 1;

    -- A product can only exist where its balance can be counted. Creation paths
    -- that do not provision the default site (direct SQL, legacy seeds, tests)
    -- get the same 'Sede principal' the organization provisioning service
    -- creates, so no product is created without a site balance.
    IF default_location IS NULL THEN
        INSERT INTO "Location" ("id", "organizationId", "name", "isDefault")
        VALUES (gen_random_uuid()::text, NEW."organizationId", 'Sede principal', true)
        ON CONFLICT ("organizationId") WHERE "isDefault" DO NOTHING;

        SELECT l."id" INTO default_location
        FROM "Location" l
        WHERE l."organizationId" = NEW."organizationId" AND l."isDefault"
        ORDER BY l."id"
        LIMIT 1;
    END IF;

    IF default_location IS NULL THEN
        RAISE EXCEPTION 'Organization % has no default location; product % cannot be created without a site balance', NEW."organizationId", NEW."id";
    END IF;

    PERFORM set_config('meperpos.suppress_site_stock_delta', 'on', true);
    INSERT INTO "ProductStock" ("productId", "locationId", "organizationId", "stock", "reservedStock")
    VALUES (NEW."id", default_location, NEW."organizationId", NEW."stock", NEW."reservedStock");
    PERFORM set_config('meperpos.suppress_site_stock_delta', previous, true);

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Product_default_site_stock"
AFTER INSERT ON "Product"
FOR EACH ROW EXECUTE FUNCTION "open_default_site_stock"();

COMMIT;
