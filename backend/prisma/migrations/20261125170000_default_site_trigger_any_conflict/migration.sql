BEGIN;

-- 20261125130000_location_type added a second unique index on "Location"
-- ("organizationId", lower("name")). When two products of an organization
-- without a default site are inserted concurrently, both runs of
-- "open_default_site_stock" try to create 'Sede principal'; the loser can hit
-- the name index instead of the default-site index named as the ON CONFLICT
-- arbiter, and the product insert fails. Without a conflict target every
-- unique index is an arbiter, so the loser does nothing and re-reads the
-- winner's default site. Behaviour is otherwise identical to
-- 20261125120000_product_stock_authority.
CREATE OR REPLACE FUNCTION "open_default_site_stock"() RETURNS trigger AS $$
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
        ON CONFLICT DO NOTHING;

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

COMMIT;
