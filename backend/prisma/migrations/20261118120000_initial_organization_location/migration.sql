BEGIN;

CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Location_organizationId_fkey" FOREIGN KEY ("organizationId")
        REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Location_organizationId_idx" ON "Location" ("organizationId");
CREATE UNIQUE INDEX "Location_one_default_per_organization_idx"
    ON "Location" ("organizationId") WHERE "isDefault";

-- Include inactive organizations. Product.stock and all inventory are untouched.
INSERT INTO "Location" ("id", "organizationId", "name", "isDefault")
SELECT gen_random_uuid()::text, "id", 'Sede principal', true
FROM "Organization";

COMMIT;
