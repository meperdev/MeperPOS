BEGIN;

-- The foreign keys need locks on the existing tables even though no rows move.
DO $$
BEGIN
    IF (SELECT setting::int FROM pg_catalog.pg_settings WHERE name = 'lock_timeout') NOT BETWEEN 1 AND 5000 THEN
        PERFORM set_config('lock_timeout', '5s', true);
    END IF;
END $$;

CREATE TABLE "SaleOriginSite" (
    "saleId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,

    CONSTRAINT "SaleOriginSite_pkey" PRIMARY KEY ("saleId", "organizationId"),
    CONSTRAINT "SaleOriginSite_saleId_organizationId_fkey"
        FOREIGN KEY ("saleId", "organizationId")
        REFERENCES "Sale"("id", "organizationId") ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT "SaleOriginSite_locationId_organizationId_fkey"
        FOREIGN KEY ("locationId", "organizationId")
        REFERENCES "Location"("id", "organizationId") ON DELETE NO ACTION ON UPDATE RESTRICT
);

CREATE INDEX "SaleOriginSite_locationId_organizationId_idx"
    ON "SaleOriginSite" ("locationId", "organizationId");

CREATE TABLE "PosLoanSaleIntentOriginSite" (
    "intentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,

    CONSTRAINT "PosLoanSaleIntentOriginSite_pkey" PRIMARY KEY ("intentId", "organizationId"),
    CONSTRAINT "PosLoanSaleIntentOriginSite_intentId_organizationId_fkey"
        FOREIGN KEY ("intentId", "organizationId")
        REFERENCES "PosLoanSaleIntent"("id", "organizationId") ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT "PosLoanSaleIntentOriginSite_locationId_organizationId_fkey"
        FOREIGN KEY ("locationId", "organizationId")
        REFERENCES "Location"("id", "organizationId") ON DELETE NO ACTION ON UPDATE RESTRICT
);

CREATE INDEX "PosLoanSaleIntentOriginSite_locationId_organizationId_idx"
    ON "PosLoanSaleIntentOriginSite" ("locationId", "organizationId");

COMMIT;
