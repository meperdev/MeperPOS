\set ON_ERROR_STOP on

BEGIN;
DO $$
DECLARE
  constraint_name text;
BEGIN
  IF current_database() !~ '^meperpos_stock_rehearsal_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'Expected a disposable stock rehearsal database';
  END IF;
  IF EXISTS (SELECT 1 FROM "ProductStock") THEN
    RAISE EXCEPTION 'The schema migration or rehearsal left stock rows behind';
  END IF;

  INSERT INTO "ProductStock" ("productId", "locationId", "organizationId", "stock", "reservedStock")
  VALUES ('stock-a1', 'stock-a-main', 'stock-a', 5, 2), ('stock-b1', 'stock-b-main', 'stock-b', -3, 0);
  IF NOT EXISTS (
    SELECT 1 FROM "ProductStock"
    WHERE "productId" = 'stock-b1' AND "stock" = -3 AND "reservedStock" = 0
  ) THEN
    RAISE EXCEPTION 'A legacy negative stock balance was not stored as-is';
  END IF;

  BEGIN
    INSERT INTO "ProductStock" VALUES ('stock-a1', 'stock-a-main', 'stock-a', 1, 0);
    RAISE EXCEPTION 'Duplicate product and location accepted';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    IF constraint_name <> 'ProductStock_pkey' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO "ProductStock" VALUES ('stock-a1', 'stock-b-main', 'stock-a', 1, 0);
    RAISE EXCEPTION 'Cross-organization location accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    IF constraint_name <> 'ProductStock_locationId_organizationId_fkey' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO "ProductStock" VALUES ('stock-a1', 'stock-b-main', 'stock-b', 1, 0);
    RAISE EXCEPTION 'Cross-organization product accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    IF constraint_name <> 'ProductStock_productId_organizationId_fkey' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO "ProductStock" VALUES ('stock-a2', 'stock-a-main', 'stock-a', 1, -1);
    RAISE EXCEPTION 'A negative reservation was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    IF constraint_name <> 'ProductStock_reservedStock_bounds_check' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO "ProductStock" VALUES ('stock-a2', 'stock-a-main', 'stock-a', 1, 2);
    RAISE EXCEPTION 'A reservation above the available stock was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    IF constraint_name <> 'ProductStock_reservedStock_bounds_check' THEN RAISE; END IF;
  END;

  INSERT INTO "ProductStock" VALUES ('stock-a2', 'stock-a-alt', 'stock-a', 0, 0);

  BEGIN
    UPDATE "Product" SET "id" = 'stock-a2-moved' WHERE "id" = 'stock-a2';
    RAISE EXCEPTION 'Updating a product key with location balances was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    IF constraint_name <> 'ProductStock_productId_organizationId_fkey' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE "Location" SET "id" = 'stock-a-alt-moved' WHERE "id" = 'stock-a-alt';
    RAISE EXCEPTION 'Updating a location key with stock balances was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    IF constraint_name <> 'ProductStock_locationId_organizationId_fkey' THEN RAISE; END IF;
  END;

  DELETE FROM "Product" WHERE "id" = 'stock-a2';
  IF EXISTS (SELECT 1 FROM "ProductStock" WHERE "productId" = 'stock-a2')
     OR (SELECT count(*) FROM "ProductStock") <> 2 THEN
    RAISE EXCEPTION 'Deleting a product did not remove only its location balances';
  END IF;

  INSERT INTO "ProductStock" VALUES ('stock-a1', 'stock-a-alt', 'stock-a', 0, 0);
  DELETE FROM "Location" WHERE "id" = 'stock-a-alt';
  IF EXISTS (SELECT 1 FROM "ProductStock" WHERE "locationId" = 'stock-a-alt') THEN
    RAISE EXCEPTION 'Deleting a location did not remove its stock balances';
  END IF;

  DELETE FROM "Organization" WHERE "id" = 'stock-b';
  IF EXISTS (SELECT 1 FROM "ProductStock" WHERE "organizationId" = 'stock-b')
     OR (SELECT count(*) FROM "ProductStock" WHERE "organizationId" = 'stock-a') <> 1 THEN
    RAISE EXCEPTION 'Deleting an organization did not remove only its balances';
  END IF;
END $$;
ROLLBACK;
