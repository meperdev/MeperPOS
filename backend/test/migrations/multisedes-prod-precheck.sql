-- Read-only production precheck before deploying the multi-site chain.
-- Run from backend/ with the production service linked:
--   railway run bash -lc 'psql "${DATABASE_URL%%\?*}" -X -v ON_ERROR_STOP=1 -f test/migrations/multisedes-prod-precheck.sql'
-- Every query must return the value noted next to it; any other value means
-- the deploy will refuse (fail closed) and must not start. Nothing is written:
-- the whole script runs in a READ ONLY transaction that ends in ROLLBACK.
BEGIN TRANSACTION READ ONLY;

\echo '== 1. Unresolved failed migrations (expect 0)'
SELECT count(*) AS unresolved_failed
FROM "_prisma_migrations"
WHERE finished_at IS NULL AND rolled_back_at IS NULL;

\echo '== 2. Which location lineage is applied (expect abandoned=t, multisite=f)'
SELECT
  EXISTS (SELECT 1 FROM "_prisma_migrations"
          WHERE migration_name = '20261120120000_add_location_foundation'
            AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS abandoned,
  EXISTS (SELECT 1 FROM "_prisma_migrations"
          WHERE migration_name = '20261118120000_initial_organization_location'
            AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS multisite;

\echo '== 3. Sites the abandoned triggers did not generate (expect 0)'
SELECT count(*) AS unexpected_locations
FROM "Location" l
WHERE NOT (l."isDefault" AND l."type"::text = 'STORE' AND l."name" = 'Sede principal');

\echo '== 4. Assignments that do not point at a principal site (expect 0)'
SELECT count(*) AS unexpected_assignments
FROM "LocationAssignment" a
LEFT JOIN "Location" l
  ON l."id" = a."locationId" AND l."organizationId" = a."organizationId"
WHERE l."id" IS NULL OR NOT l."isDefault";

\echo '== 5. Foreign keys from other tables into Location (expect 0)'
SELECT count(*) AS foreign_references
FROM pg_constraint c
WHERE c.contype = 'f'
  AND c.confrelid = 'public."Location"'::regclass
  AND c.conrelid <> 'public."LocationAssignment"'::regclass;

\echo '== 6. Products the stock seed would refuse (expect 0)'
SELECT count(*) AS products_blocking_stock_seed
FROM "Product"
WHERE "reservedStock" < 0 OR (stock >= 0 AND "reservedStock" > stock);

\echo '== 7. Organizations and products (for the post-deploy comparison)'
SELECT count(*) AS organizations FROM "Organization";
SELECT count(*) AS products,
       md5(string_agg(concat_ws(':', "id", stock::text, "reservedStock"::text), ',' ORDER BY "id")) AS product_checksum
FROM "Product";

ROLLBACK;
