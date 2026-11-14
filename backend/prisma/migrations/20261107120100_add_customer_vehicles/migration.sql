CREATE TABLE "CustomerVehicle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "model" TEXT,
    "legacyCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerVehicle_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CustomerVehicle_legacy_owner_check" CHECK ("legacyCustomerId" IS NULL OR "legacyCustomerId" = "customerId"),
    CONSTRAINT "CustomerVehicle_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CustomerVehicle_organizationId_customerId_idx" ON "CustomerVehicle"("organizationId", "customerId");
CREATE UNIQUE INDEX "CustomerVehicle_legacyCustomerId_key" ON "CustomerVehicle"("legacyCustomerId");

INSERT INTO "CustomerVehicle" ("id", "organizationId", "customerId", "plate", "legacyCustomerId")
SELECT gen_random_uuid()::text, "organizationId", "id", "placaMoto", "id"
FROM "Customer"
WHERE "placaMoto" IS NOT NULL AND btrim("placaMoto") <> '';
