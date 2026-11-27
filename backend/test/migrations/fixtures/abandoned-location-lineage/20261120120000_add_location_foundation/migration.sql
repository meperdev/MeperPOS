-- Additive location foundation only: tenant-scoped branches and warehouses plus
-- one default store per organization. Product.stock, Product.reservedStock, active
-- reservations and every stock flow stay untouched until the stock cutover.

-- The backfill must see organizations committed while the trigger lock waits,
-- even if the migration connection defaults to REPEATABLE READ.
BEGIN ISOLATION LEVEL READ COMMITTED;

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('STORE', 'WAREHOUSE');

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LocationType" NOT NULL DEFAULT 'STORE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Location_organizationId_name_key" ON "Location"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Location_one_default_per_organization_key" ON "Location"("organizationId") WHERE "isDefault";

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Creates the default store for organizations inserted by any application version,
-- including seed scripts and direct SQL that bypass AdminService. The dynamic
-- statement resolves "Location" in the triggering table's schema so the function
-- stays scoped to the schema it was installed in.
CREATE FUNCTION "create_default_organization_location"() RETURNS trigger AS $$
BEGIN
    EXECUTE format(
        'INSERT INTO %I."Location" ("id", "organizationId", "name", "type", "isDefault", "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, %L, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
        TG_TABLE_SCHEMA, 'STORE'
    ) USING NEW."id", 'Sede principal';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Install the trigger before the backfill: the DDL lock it takes on "Organization"
-- serializes concurrent Organization writers with this transaction, so they fire the
-- trigger after commit instead of slipping in between backfill and trigger creation.
CREATE TRIGGER "Organization_default_location"
AFTER INSERT ON "Organization"
FOR EACH ROW EXECUTE FUNCTION "create_default_organization_location"();

-- Data backfill: one default store for every organization that already exists.
INSERT INTO "Location" ("id", "organizationId", "name", "type", "isDefault", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, o."id", 'Sede principal', 'STORE', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" AS o
WHERE NOT EXISTS (
    SELECT 1 FROM "Location" AS l
    WHERE l."organizationId" = o."id" AND l."isDefault" = TRUE
);

COMMIT;
