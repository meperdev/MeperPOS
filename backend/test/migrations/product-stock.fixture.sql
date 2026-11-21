\set ON_ERROR_STOP on

BEGIN;
DO $$
BEGIN
  IF current_database() !~ '^meperpos_stock_rehearsal_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'Expected a disposable stock rehearsal database';
  END IF;
END $$;

INSERT INTO "Organization" ("id", "name", "slug", "updatedAt", "active") VALUES
  ('stock-a', 'Stock A', 'stock-a', CURRENT_TIMESTAMP, true),
  ('stock-b', 'Stock B', 'stock-b', CURRENT_TIMESTAMP, true),
  ('stock-empty', 'Stock Empty', 'stock-empty', CURRENT_TIMESTAMP, false);

INSERT INTO "Location" ("id", "organizationId", "name", "isDefault") VALUES
  ('stock-a-main', 'stock-a', 'Sede principal', true),
  ('stock-a-alt', 'stock-a', 'Sede secundaria', false),
  ('stock-b-main', 'stock-b', 'Sede principal', true),
  ('stock-empty-main', 'stock-empty', 'Sede principal', true);

INSERT INTO "Category" ("id", "name", "organizationId", "updatedAt") VALUES
  ('stock-cat-a', 'A', 'stock-a', CURRENT_TIMESTAMP),
  ('stock-cat-b', 'B', 'stock-b', CURRENT_TIMESTAMP);

INSERT INTO "Product"
  ("id", "name", "sku", "costPrice", "salePrice", "categoryId", "organizationId",
   "stock", "reservedStock", "version", "active", "updatedAt")
VALUES
  ('stock-a1', 'Reserved', 'SHARED', 10, 20, 'stock-cat-a', 'stock-a', 5, 2, 8, true, CURRENT_TIMESTAMP),
  ('stock-a2', 'Zero', 'ZERO', 10, 20, 'stock-cat-a', 'stock-a', 0, 0, 2, true, CURRENT_TIMESTAMP),
  ('stock-b1', 'Legacy negative', 'SHARED', 10, 20, 'stock-cat-b', 'stock-b', -3, 0, 1, true, CURRENT_TIMESTAMP),
  ('stock-b2', 'Inactive', 'INACTIVE', 10, 20, 'stock-cat-b', 'stock-b', 3, 0, 4, false, CURRENT_TIMESTAMP);

-- One real POS hold for one unit: the product counter of two must not be reconstructed from this hold.
INSERT INTO "User" ("id", "email", "name", "password", "updatedAt")
VALUES ('stock-user', 'stock-fixture@example.test', 'Stock fixture', 'not-a-login-credential', CURRENT_TIMESTAMP);
INSERT INTO "Customer" ("id", "organizationId", "name", "documentType", "documentNumber", "updatedAt")
VALUES ('stock-customer', 'stock-a', 'Stock customer', 'CC', '5100', CURRENT_TIMESTAMP);
INSERT INTO "MoneyLoan" ("id", "organizationId", "customerId", "createdById", "amount", "issuedAt", "reason")
VALUES ('stock-loan', 'stock-a', 'stock-customer', 'stock-user', 20, CURRENT_DATE, 'Stock fixture');
WITH quote AS (
  SELECT '{"agreedCustomerTotal":"20.00","items":[{"productId":"stock-a1","quantity":1,"resolvedUnitPrice":"20.00","discountAmount":"0.00"}]}'::jsonb AS snapshot
)
INSERT INTO "PosLoanSaleIntent" ("id", "organizationId", "loanId", "customerId", "agreedCustomerTotal",
  "quoteSnapshot", "initiationRequestKey", "initiationRequestHash", "initiatedById", "initiationResult")
SELECT 'stock-intent', 'stock-a', 'stock-loan', 'stock-customer', 20,
  snapshot, 'stock-fixture', repeat('a', 64), 'stock-user',
  jsonb_build_object('intentId', 'stock-intent', 'organizationId', 'stock-a', 'loanId', 'stock-loan',
    'customerId', 'stock-customer', 'agreedCustomerTotal', '20.00', 'quoteSnapshot', snapshot)
FROM quote;
INSERT INTO "PosLoanSaleReservation" ("id", "intentId", "organizationId", "productId", "quantity")
VALUES ('stock-hold', 'stock-intent', 'stock-a', 'stock-a1', 1);
COMMIT;
