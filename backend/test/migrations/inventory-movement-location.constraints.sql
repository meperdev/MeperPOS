\set ON_ERROR_STOP on

-- Run after applying the attribution migration to a disposable clone prepared
-- with the fixture and the t14-legacy movement described in the rollout guide.
-- The probes roll back.
BEGIN;
DO $$
DECLARE
  rejected_constraint text;
BEGIN
  IF current_database() !~ '^meperpos_stock_rehearsal_t14_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'Expected a disposable movement attribution database';
  END IF;

  IF NOT EXISTS (
    SELECT FROM "InventoryMovement"
    WHERE id = 't14-legacy' AND "organizationId" = 'stock-a' AND "productId" = 'stock-a1'
      AND "locationId" IS NULL AND quantity = 5 AND "previousStock" = 0 AND "newStock" = 5
  ) THEN
    RAISE EXCEPTION 'Legacy movement was rewritten or assigned to a location';
  END IF;

  INSERT INTO "InventoryMovement"
    (id, "productId", type, quantity, "previousStock", "newStock", reason, "userId", "organizationId", "locationId")
  VALUES ('t14-located', 'stock-a1', 'ADJUSTMENT_IN', 1, 4, 5, 'Test attribution', 'stock-user', 'stock-a', 'stock-a-alt');

  BEGIN
    UPDATE "InventoryMovement" SET "locationId" = 'stock-b-main' WHERE id = 't14-located';
    RAISE EXCEPTION 'Movement accepted a location from another organization';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
    IF rejected_constraint <> 'InventoryMovement_locationId_organizationId_fkey' THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM "Location" WHERE id = 'stock-a-alt';
    RAISE EXCEPTION 'Deleting a referenced location erased movement provenance';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
    IF rejected_constraint <> 'InventoryMovement_locationId_organizationId_fkey' THEN RAISE; END IF;
  END;

  IF NOT EXISTS (
    SELECT FROM "InventoryMovement" WHERE id = 't14-located' AND "locationId" = 'stock-a-alt'
  ) THEN
    RAISE EXCEPTION 'Rejected actions changed movement attribution';
  END IF;

  INSERT INTO "InventoryMovement"
    (id, "productId", type, quantity, "previousStock", "newStock", reason, "userId", "organizationId", "locationId")
  VALUES ('t14-org-cascade', 'stock-b2', 'ADJUSTMENT_IN', 1, 2, 3, 'Test attribution', 'stock-user', 'stock-b', 'stock-b-main');
  DELETE FROM "Organization" WHERE id = 'stock-b';
  IF EXISTS (SELECT FROM "InventoryMovement" WHERE id = 't14-org-cascade') OR
     EXISTS (SELECT FROM "Location" WHERE id = 'stock-b-main') THEN
    RAISE EXCEPTION 'Organization deletion did not cascade to movement and location';
  END IF;
END $$;
ROLLBACK;
