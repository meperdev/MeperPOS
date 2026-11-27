BEGIN;

DO $$
DECLARE
  violated_constraint text;
BEGIN
  IF to_regclass('"Location"') IS NULL THEN
    RAISE EXCEPTION 'Expected one initial location per organization; Location is missing';
  END IF;

  IF EXISTS (
    SELECT o."id"
    FROM "Organization" o LEFT JOIN "Location" l ON l."organizationId" = o."id"
    GROUP BY o."id"
    HAVING count(l."id") <> 1
        OR count(*) FILTER (WHERE l."isDefault" AND l."name" = 'Sede principal') <> 1
  ) THEN
    RAISE EXCEPTION 'Expected exactly one Sede principal per existing organization';
  END IF;

  IF EXISTS (
    (SELECT "id", "organizationId", "stock", "reservedStock", "version", "updatedAt" FROM "Product"
      EXCEPT ALL SELECT * FROM location_product_baseline)
    UNION ALL
    (SELECT * FROM location_product_baseline EXCEPT ALL
      SELECT "id", "organizationId", "stock", "reservedStock", "version", "updatedAt" FROM "Product")
  ) THEN
    RAISE EXCEPTION 'Migration changed the product inventory snapshot';
  END IF;

  BEGIN
    INSERT INTO "Location" ("id", "organizationId", "name", "isDefault")
    VALUES ('loc-test-duplicate', 'loc-test-a', 'Duplicate default', true);
    RAISE EXCEPTION 'A second default in the same organization was accepted';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
    IF violated_constraint <> 'Location_one_default_per_organization_idx' THEN
      RAISE;
    END IF;
  END;

  INSERT INTO "Location" ("id", "organizationId", "name", "isDefault")
  VALUES ('loc-test-secondary', 'loc-test-a', 'Second site', false);
END $$;

ROLLBACK;
