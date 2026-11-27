-- Run only on a disposable baseline database, using the same psql session as the assertions.
DO $$
BEGIN
  IF current_database() !~ '^meperpos_(baseline|location_[a-z0-9_]+)$' THEN
    RAISE EXCEPTION 'Expected the disposable location migration database';
  END IF;
END $$;

INSERT INTO "Organization" ("id", "name", "slug", "updatedAt", "active") VALUES
    ('loc-test-a', 'Location Test A', 'loc-test-a', CURRENT_TIMESTAMP, true),
    ('loc-test-b', 'Location Test B', 'loc-test-b', CURRENT_TIMESTAMP, true),
    ('loc-test-c', 'Location Test C', 'loc-test-c', CURRENT_TIMESTAMP, false)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Category" ("id", "name", "organizationId", "updatedAt") VALUES
    ('loc-test-cat-a', 'A', 'loc-test-a', CURRENT_TIMESTAMP),
    ('loc-test-cat-b', 'B', 'loc-test-b', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Product"
    ("id", "name", "sku", "costPrice", "salePrice", "categoryId", "organizationId",
     "stock", "reservedStock", "version", "active", "updatedAt")
VALUES
    ('loc-test-a1', 'Product A1', 'SHARED', 10, 20, 'loc-test-cat-a', 'loc-test-a', 5, 2, 8, true, CURRENT_TIMESTAMP),
    ('loc-test-a2', 'Product A2', 'A2', 10, 20, 'loc-test-cat-a', 'loc-test-a', 0, 0, 0, true, CURRENT_TIMESTAMP),
    ('loc-test-b1', 'Product B1', 'SHARED', 10, 20, 'loc-test-cat-b', 'loc-test-b', 3, 0, 4, false, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

CREATE TEMP TABLE location_product_baseline AS
SELECT "id", "organizationId", "stock", "reservedStock", "version", "updatedAt" FROM "Product";
