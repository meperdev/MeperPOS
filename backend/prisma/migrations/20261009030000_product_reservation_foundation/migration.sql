-- Foundation only: reservation writers remain disabled until all L3B safeguards land.
-- NOT VALID skips validating baseline rows at deploy, but PostgreSQL still enforces
-- the check on every later UPDATE, so the stock bound must tolerate inherited
-- negative stock: a row with negative stock keeps accepting updates while the
-- reservation invariant still holds for every non-negative one.
ALTER TABLE "Product"
  ADD COLUMN "reservedStock" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "Product_reservedStock_bounds_check"
    CHECK ("reservedStock" >= 0 AND ("stock" < 0 OR "reservedStock" <= "stock")) NOT VALID,
  ADD CONSTRAINT "Product_reservedStock_eligibility_check"
    CHECK ("reservedStock" = 0 OR
      ("active" = true AND "type" = 'PRODUCT' AND "tracksStock" = true));
