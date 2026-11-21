\set ON_ERROR_STOP on

-- T9 read-only readiness rehearsal for the per-location stock cutover.
--
-- It writes nothing: no DML, no DDL, no temporary objects, and no row-level locks.
-- Run it on a disposable `meperpos_stock_rehearsal_*` database that already applied
-- the canonical migrations (so `ProductStock` exists) and stays free of application
-- connections. The whole rehearsal is one REPEATABLE READ READ ONLY transaction, so
-- every check reads a single snapshot of Product, both reservation ledgers and the
-- dormant target.
--
-- Expected reservations are rebuilt from the canonical writers, never from
-- InventoryMovement history: OPEN inventory-loan items still owe
-- quantity - deliveredQuantity - cancelledQuantity, and HELD POS reservations owe
-- their quantity. Terminal loans and finalized POS reservations reserve nothing.
-- Ineligible products (inactive, non-physical, or untracked) must reserve nothing.
--
-- Passing this rehearsal proves readiness only. It cannot authorize the cutover:
-- that remains an atomic, writer-authorized switch.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;

DO $$
BEGIN
  IF current_database() !~ '^meperpos_stock_rehearsal_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'Expected a disposable stock rehearsal database';
  END IF;

  -- A caller may already own a transaction. Then these settings are not ours to set,
  -- so refuse instead of rehearsing under a weaker contract.
  IF current_setting('transaction_isolation') <> 'repeatable read' THEN
    RAISE EXCEPTION 'The stock rehearsal must run in a REPEATABLE READ transaction';
  END IF;
  IF current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'The stock rehearsal must run in a READ ONLY transaction';
  END IF;

  IF to_regclass('"ProductStock"') IS NULL THEN
    RAISE EXCEPTION 'ProductStock schema must be installed before rehearsing stock';
  END IF;
  IF EXISTS (SELECT 1 FROM "ProductStock") THEN
    RAISE EXCEPTION 'ProductStock must be empty before rehearsing stock';
  END IF;

  -- Every product needs a default location in its own organization, never a foreign one.
  IF EXISTS (
    SELECT 1 FROM "Product" p
    WHERE NOT EXISTS (
      SELECT 1 FROM "Location" l
      WHERE l."organizationId" = p."organizationId" AND l."isDefault"
    )
  ) THEN
    RAISE EXCEPTION 'At least one product has no default location in its organization';
  END IF;

  IF EXISTS (SELECT 1 FROM "Product" p WHERE p."stock" < 0) THEN
    RAISE EXCEPTION 'Product stock is negative before the cutover';
  END IF;
  IF EXISTS (SELECT 1 FROM "Product" p WHERE p."reservedStock" < 0) THEN
    RAISE EXCEPTION 'Product reserved stock is negative';
  END IF;
  IF EXISTS (SELECT 1 FROM "Product" p WHERE p."reservedStock" > p."stock") THEN
    RAISE EXCEPTION 'Product reserved stock exceeds its stock';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Product" p
    WHERE p."reservedStock" <> 0
      AND (p."active" = false OR p."type" <> 'PRODUCT' OR p."tracksStock" = false)
  ) THEN
    RAISE EXCEPTION 'An ineligible product holds reserved stock';
  END IF;

  -- A terminal loan that still owes units was never released or closed: its evidence
  -- is stuck even when the product counter agrees with an open-loan-only ledger.
  IF EXISTS (
    SELECT 1
    FROM "InventoryLoan" l
    JOIN "InventoryLoanItem" i
      ON i."loanId" = l."id" AND i."organizationId" = l."organizationId"
    WHERE l."status" <> 'OPEN'
      AND i."quantity" - i."deliveredQuantity" - i."cancelledQuantity" <> 0
  ) THEN
    RAISE EXCEPTION 'Terminal inventory loans still hold reserved quantities';
  END IF;

  -- A HELD reservation on a claimed or terminal intent can no longer be consumed or
  -- released, so it is stuck evidence regardless of the product counter.
  IF EXISTS (
    SELECT 1
    FROM "PosLoanSaleReservation" r
    JOIN "PosLoanSaleIntent" i
      ON i."id" = r."intentId" AND i."organizationId" = r."organizationId"
    JOIN "MoneyLoan" l
      ON l."id" = i."loanId" AND l."organizationId" = i."organizationId"
     AND l."customerId" = i."customerId"
    WHERE r."state" = 'HELD'
      AND (i."finalSaleId" IS NOT NULL OR l."status" <> 'OPEN')
  ) THEN
    RAISE EXCEPTION 'POS reservations are still held on a finalized intent';
  END IF;

  -- Per product inside its own organization, not per organization total: two
  -- compensating errors must not cancel out.
  IF EXISTS (
    WITH owed AS (
      SELECT i."organizationId", i."productId",
             (i."quantity" - i."deliveredQuantity" - i."cancelledQuantity")::bigint AS "reserved"
      FROM "InventoryLoanItem" i
      JOIN "InventoryLoan" l
        ON l."id" = i."loanId" AND l."organizationId" = i."organizationId"
      WHERE l."status" = 'OPEN'
      UNION ALL
      SELECT r."organizationId", r."productId", r."quantity"::bigint
      FROM "PosLoanSaleReservation" r
      WHERE r."state" = 'HELD'
    ), ledger AS (
      SELECT "organizationId", "productId", SUM("reserved") AS "reserved"
      FROM owed
      GROUP BY "organizationId", "productId"
    )
    SELECT 1
    FROM "Product" p
    LEFT JOIN ledger g
      ON g."organizationId" = p."organizationId" AND g."productId" = p."id"
    WHERE p."reservedStock"::bigint <> COALESCE(g."reserved", 0)
  ) THEN
    RAISE EXCEPTION 'Reserved stock does not match the loan and POS reservation ledger';
  END IF;

  -- Only reads ran, so this read-only transaction never needed a transaction identifier.
  IF pg_current_xact_id_if_assigned() IS NOT NULL THEN
    RAISE EXCEPTION 'The stock rehearsal assigned a transaction identifier';
  END IF;
END $$;

-- Deterministic readiness count: the products whose default-location balance was checked.
-- No balances are printed and nothing is exposed to the application.
SELECT count(*) AS "verifiedProducts"
FROM "Product" p
JOIN "Location" l
  ON l."organizationId" = p."organizationId" AND l."isDefault";

ROLLBACK;
