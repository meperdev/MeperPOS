\set ON_ERROR_STOP on

-- Apply to a disposable migrated clone with product-stock.fixture.sql loaded.
-- The probe rolls back every inserted or deleted row.
BEGIN;
DO $$
DECLARE
  table_name text;
  parent_column text;
  parent_id text;
  rejected_constraint text;
BEGIN
  IF current_database() !~ '^meperpos_stock_rehearsal_t16_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'Expected a disposable sale origin site database';
  END IF;

  IF EXISTS (SELECT FROM "SaleOriginSite") OR
     EXISTS (SELECT FROM "PosLoanSaleIntentOriginSite") OR
     EXISTS (SELECT FROM "ProductStock") THEN
    RAISE EXCEPTION 'Dormant attribution and stock tables must be empty';
  END IF;

  INSERT INTO "Sale" (
    id, "saleNumber", subtotal, "taxAmount", "discountAmount", total,
    "amountPaid", "userId", "updatedAt", "organizationId"
  ) VALUES
    ('t16-sale-a', 1, 10, 0, 0, 10, 10, 'stock-user', now(), 'stock-a'),
    ('t16-sale-b', 1, 10, 0, 0, 10, 10, 'stock-user', now(), 'stock-b'),
    ('t16-sale-legacy', 2, 10, 0, 0, 10, 10, 'stock-user', now(), 'stock-a');

  FOR table_name, parent_column, parent_id IN
    VALUES ('SaleOriginSite', 'saleId', 't16-sale-a'),
           ('PosLoanSaleIntentOriginSite', 'intentId', 'stock-intent')
  LOOP
    -- Change both values: the Location exists in stock-b but the owner does not.
    BEGIN
      EXECUTE format('INSERT INTO %I (%I, "organizationId", "locationId") VALUES ($1,$2,$3)', table_name, parent_column)
        USING parent_id, 'stock-b', 'stock-b-main';
      RAISE EXCEPTION '% accepted an owner from another organization', table_name;
    EXCEPTION WHEN foreign_key_violation THEN
      GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
      IF rejected_constraint <> format('%s_%s_organizationId_fkey', table_name, parent_column) THEN RAISE; END IF;
    END;

    BEGIN
      EXECUTE format('INSERT INTO %I (%I, "organizationId", "locationId") VALUES ($1,$2,$3)', table_name, parent_column)
        USING parent_id, 'stock-a', 'stock-b-main';
      RAISE EXCEPTION '% accepted a location from another organization', table_name;
    EXCEPTION WHEN foreign_key_violation THEN
      GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
      IF rejected_constraint <> format('%s_locationId_organizationId_fkey', table_name) THEN RAISE; END IF;
    END;

    EXECUTE format('INSERT INTO %I (%I, "organizationId", "locationId") VALUES ($1,$2,$3)', table_name, parent_column)
      USING parent_id, 'stock-a', 'stock-a-alt';

    BEGIN
      EXECUTE format('INSERT INTO %I (%I, "organizationId", "locationId") VALUES ($1,$2,$3)', table_name, parent_column)
        USING parent_id, 'stock-a', 'stock-a-main';
      RAISE EXCEPTION '% accepted a second origin for the same operation', table_name;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
      IF rejected_constraint <> format('%s_pkey', table_name) THEN RAISE; END IF;
    END;
  END LOOP;

  BEGIN
    DELETE FROM "Location" WHERE id = 'stock-a-alt';
    RAISE EXCEPTION 'Referenced location deletion must preserve its attributions';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
    IF rejected_constraint NOT IN ('SaleOriginSite_locationId_organizationId_fkey',
        'PosLoanSaleIntentOriginSite_locationId_organizationId_fkey') THEN RAISE; END IF;
  END;

  IF (SELECT "locationId" FROM "SaleOriginSite" WHERE "saleId" = 't16-sale-a') IS DISTINCT FROM 'stock-a-alt' OR
     (SELECT "locationId" FROM "PosLoanSaleIntentOriginSite" WHERE "intentId" = 'stock-intent') IS DISTINCT FROM 'stock-a-alt' OR
     EXISTS (SELECT FROM "SaleOriginSite" WHERE "saleId" = 't16-sale-legacy') THEN
    RAISE EXCEPTION 'Rejected operations changed origin attribution';
  END IF;

  DELETE FROM "Sale" WHERE id = 't16-sale-a';
  IF EXISTS (SELECT FROM "SaleOriginSite" WHERE "saleId" = 't16-sale-a') THEN
    RAISE EXCEPTION 'Origin row outlived its deleted sale';
  END IF;

  BEGIN
    DELETE FROM "Location" WHERE id = 'stock-a-alt';
    RAISE EXCEPTION 'Deleting the location must not erase the financing origin';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
    IF rejected_constraint <> 'PosLoanSaleIntentOriginSite_locationId_organizationId_fkey' THEN RAISE; END IF;
  END;

  INSERT INTO "SaleOriginSite" ("saleId", "organizationId", "locationId")
  VALUES ('t16-sale-b', 'stock-b', 'stock-b-main');
  DELETE FROM "Organization" WHERE id = 'stock-b';
  IF EXISTS (SELECT FROM "SaleOriginSite" WHERE "saleId" = 't16-sale-b') OR
     EXISTS (SELECT FROM "Location" WHERE id = 'stock-b-main') THEN
    RAISE EXCEPTION 'Origin row blocked the organization cascade';
  END IF;
END $$;
ROLLBACK;
