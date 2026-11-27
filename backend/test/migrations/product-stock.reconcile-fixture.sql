\set ON_ERROR_STOP on

-- Legal, fully consistent T9 fixture. Every stored reservation is backed by the
-- canonical ledger: open inventory loan items still undelivered and uncancelled,
-- plus HELD POS reservations. The T8 fixture keeps its deliberate mismatch; this
-- one exists so the read-only gate has a state it must accept.
BEGIN;
DO $$
BEGIN
  IF current_database() !~ '^meperpos_stock_rehearsal_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'Expected a disposable stock rehearsal database';
  END IF;
END $$;

INSERT INTO "Organization" ("id", "name", "slug", "updatedAt", "active") VALUES
  ('t9-a', 'T9 A', 't9-a', CURRENT_TIMESTAMP, true),
  ('t9-b', 'T9 B', 't9-b', CURRENT_TIMESTAMP, true),
  ('t9-empty', 'T9 Empty', 't9-empty', CURRENT_TIMESTAMP, false);

-- The initial-location backfill ran before this fixture, so every location here is explicit.
INSERT INTO "Location" ("id", "organizationId", "name", "isDefault") VALUES
  ('t9-a-main', 't9-a', 'Sede principal', true),
  ('t9-a-alt', 't9-a', 'Sede secundaria', false),
  ('t9-b-main', 't9-b', 'Sede principal', true),
  ('t9-empty-main', 't9-empty', 'Sede principal', true);

INSERT INTO "Category" ("id", "name", "organizationId", "updatedAt") VALUES
  ('t9-cat-a', 'A', 't9-a', CURRENT_TIMESTAMP),
  ('t9-cat-b', 'B', 't9-b', CURRENT_TIMESTAMP);

INSERT INTO "Product"
  ("id", "name", "sku", "costPrice", "salePrice", "categoryId", "organizationId",
   "stock", "reservedStock", "version", "active", "type", "tracksStock", "updatedAt")
VALUES
  ('t9-a1', 'Physical and POS holds', 'T9A1', 10, 20, 't9-cat-a', 't9-a', 12, 7, 3, true, 'PRODUCT', true, CURRENT_TIMESTAMP),
  ('t9-a2', 'Zero stock', 'T9A2', 10, 20, 't9-cat-a', 't9-a', 0, 0, 1, true, 'PRODUCT', true, CURRENT_TIMESTAMP),
  ('t9-a3', 'Inactive', 'T9A3', 10, 20, 't9-cat-a', 't9-a', 3, 0, 2, false, 'PRODUCT', true, CURRENT_TIMESTAMP),
  ('t9-a4', 'Service', 'T9A4', 10, 20, 't9-cat-a', 't9-a', 0, 0, 0, true, 'SERVICE', false, CURRENT_TIMESTAMP),
  ('t9-a5', 'Idle tracked', 'T9A5', 10, 20, 't9-cat-a', 't9-a', 6, 0, 1, true, 'PRODUCT', true, CURRENT_TIMESTAMP),
  ('t9-b1', 'Terminal loans', 'T9B1', 10, 20, 't9-cat-b', 't9-b', 5, 0, 2, true, 'PRODUCT', true, CURRENT_TIMESTAMP),
  ('t9-b2', 'POS holds', 'T9B2', 10, 20, 't9-cat-b', 't9-b', 2, 2, 2, true, 'PRODUCT', true, CURRENT_TIMESTAMP);

INSERT INTO "User" ("id", "email", "name", "password", "updatedAt")
VALUES ('t9-user', 't9-rehearsal@example.test', 'T9 rehearsal', 'not-a-login-credential', CURRENT_TIMESTAMP);
INSERT INTO "Customer" ("id", "organizationId", "name", "documentType", "documentNumber", "updatedAt") VALUES
  ('t9-customer-a', 't9-a', 'T9 A customer', 'CC', '9001', CURRENT_TIMESTAMP),
  ('t9-customer-b', 't9-b', 'T9 B customer', 'CC', '9002', CURRENT_TIMESTAMP);

-- Physical reservations. Only OPEN loans reserve; the terminal loans below are
-- fully delivered-and-returned or fully cancelled, which is why they reserve nothing.
INSERT INTO "InventoryLoan" ("id", "organizationId", "status", "customerId", "createdById") VALUES
  ('t9-loan-a1', 't9-a', 'OPEN', 't9-customer-a', 't9-user'),
  ('t9-loan-a2', 't9-a', 'OPEN', 't9-customer-a', 't9-user'),
  ('t9-loan-b1-cancelled', 't9-b', 'CANCELLED', 't9-customer-b', 't9-user'),
  ('t9-loan-b1-closed', 't9-b', 'CLOSED', 't9-customer-b', 't9-user');

INSERT INTO "InventoryLoanItem"
  ("id", "loanId", "organizationId", "productId", "quantity",
   "deliveredQuantity", "returnedQuantity", "cancelledQuantity")
VALUES
  ('t9-item-a1a', 't9-loan-a1', 't9-a', 't9-a1', 5, 1, 0, 1),
  ('t9-item-a1b', 't9-loan-a1', 't9-a', 't9-a1', 3, 2, 2, 0),
  ('t9-item-a2', 't9-loan-a2', 't9-a', 't9-a2', 3, 3, 3, 0),
  ('t9-item-b1a', 't9-loan-b1-cancelled', 't9-b', 't9-b1', 4, 0, 0, 4),
  ('t9-item-b1b', 't9-loan-b1-closed', 't9-b', 't9-b1', 2, 2, 2, 0);

-- POS reservations. HELD holds reserve; the RELEASED hold of its cancelled loan does not.
INSERT INTO "MoneyLoan" ("id", "organizationId", "customerId", "createdById", "amount", "issuedAt", "reason") VALUES
  ('t9-money-a1', 't9-a', 't9-customer-a', 't9-user', 60.00, CURRENT_DATE, 'T9 rehearsal'),
  ('t9-money-b2', 't9-b', 't9-customer-b', 't9-user', 40.00, CURRENT_DATE, 'T9 rehearsal'),
  ('t9-money-b2r', 't9-b', 't9-customer-b', 't9-user', 20.00, CURRENT_DATE, 'T9 rehearsal');

WITH quote AS (
  SELECT '{"agreedCustomerTotal":"60.00","items":[{"productId":"t9-a1","quantity":3,"resolvedUnitPrice":"20.00","discountAmount":"0.00"}]}'::jsonb AS snapshot
)
INSERT INTO "PosLoanSaleIntent" ("id", "organizationId", "loanId", "customerId", "agreedCustomerTotal",
  "quoteSnapshot", "initiationRequestKey", "initiationRequestHash", "initiatedById", "initiationResult")
SELECT 't9-intent-a1', 't9-a', 't9-money-a1', 't9-customer-a', 60.00,
  snapshot, 't9-rehearsal-a1', repeat('a', 64), 't9-user',
  jsonb_build_object('intentId', 't9-intent-a1', 'organizationId', 't9-a', 'loanId', 't9-money-a1',
    'customerId', 't9-customer-a', 'agreedCustomerTotal', '60.00', 'quoteSnapshot', snapshot)
FROM quote;

WITH quote AS (
  SELECT '{"agreedCustomerTotal":"40.00","items":[{"productId":"t9-b2","quantity":2,"resolvedUnitPrice":"20.00","discountAmount":"0.00"}]}'::jsonb AS snapshot
)
INSERT INTO "PosLoanSaleIntent" ("id", "organizationId", "loanId", "customerId", "agreedCustomerTotal",
  "quoteSnapshot", "initiationRequestKey", "initiationRequestHash", "initiatedById", "initiationResult")
SELECT 't9-intent-b2', 't9-b', 't9-money-b2', 't9-customer-b', 40.00,
  snapshot, 't9-rehearsal-b2', repeat('b', 64), 't9-user',
  jsonb_build_object('intentId', 't9-intent-b2', 'organizationId', 't9-b', 'loanId', 't9-money-b2',
    'customerId', 't9-customer-b', 'agreedCustomerTotal', '40.00', 'quoteSnapshot', snapshot)
FROM quote;

WITH quote AS (
  SELECT '{"agreedCustomerTotal":"20.00","items":[{"productId":"t9-b2","quantity":1,"resolvedUnitPrice":"20.00","discountAmount":"0.00"}]}'::jsonb AS snapshot
)
INSERT INTO "PosLoanSaleIntent" ("id", "organizationId", "loanId", "customerId", "agreedCustomerTotal",
  "quoteSnapshot", "initiationRequestKey", "initiationRequestHash", "initiatedById", "initiationResult")
SELECT 't9-intent-b2r', 't9-b', 't9-money-b2r', 't9-customer-b', 20.00,
  snapshot, 't9-rehearsal-b2r', repeat('c', 64), 't9-user',
  jsonb_build_object('intentId', 't9-intent-b2r', 'organizationId', 't9-b', 'loanId', 't9-money-b2r',
    'customerId', 't9-customer-b', 'agreedCustomerTotal', '20.00', 'quoteSnapshot', snapshot)
FROM quote;

INSERT INTO "PosLoanSaleReservation" ("id", "intentId", "organizationId", "productId", "quantity", "state") VALUES
  ('t9-hold-a1', 't9-intent-a1', 't9-a', 't9-a1', 3, 'HELD'),
  ('t9-hold-b2', 't9-intent-b2', 't9-b', 't9-b2', 2, 'HELD'),
  ('t9-hold-b2r', 't9-intent-b2r', 't9-b', 't9-b2', 1, 'HELD');

-- Terminal POS evidence: its cancelled, unclaimed loan released the hold.
UPDATE "MoneyLoan" SET "status" = 'CANCELLED'
WHERE "id" = 't9-money-b2r' AND "organizationId" = 't9-b';
UPDATE "PosLoanSaleReservation"
SET "state" = 'RELEASED', "finalizedAt" = CURRENT_TIMESTAMP, "finalizedById" = 't9-user'
WHERE "id" = 't9-hold-b2r' AND "intentId" = 't9-intent-b2r' AND "organizationId" = 't9-b';

-- ProductStock stays empty: the cutover target is dormant, not populated.
COMMIT;
