BEGIN;

-- Do not queue stock writers indefinitely while acquiring the foreign-key table locks.
DO $$
BEGIN
    IF (SELECT setting::int FROM pg_catalog.pg_settings WHERE name = 'lock_timeout') NOT BETWEEN 1 AND 5000 THEN
        PERFORM set_config('lock_timeout', '5s', true);
    END IF;
END $$;

-- "Location_id_organizationId_key" already exists from 20261118140000_membership_location_access.

CREATE TABLE "ProductStock" (
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stock" INTEGER NOT NULL,
    "reservedStock" INTEGER NOT NULL,

    CONSTRAINT "ProductStock_pkey" PRIMARY KEY ("productId", "locationId"),
    CONSTRAINT "ProductStock_reservedStock_bounds_check"
        CHECK ("reservedStock" >= 0 AND ("stock" < 0 OR "reservedStock" <= "stock")),
    CONSTRAINT "ProductStock_productId_organizationId_fkey" FOREIGN KEY ("productId", "organizationId")
        REFERENCES "Product"("id", "organizationId") ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT "ProductStock_locationId_organizationId_fkey" FOREIGN KEY ("locationId", "organizationId")
        REFERENCES "Location"("id", "organizationId") ON DELETE CASCADE ON UPDATE RESTRICT
);

CREATE INDEX "ProductStock_locationId_organizationId_idx" ON "ProductStock" ("locationId", "organizationId");

-- Intentionally empty. Product.stock and Product.reservedStock are still authoritative.
COMMIT;
