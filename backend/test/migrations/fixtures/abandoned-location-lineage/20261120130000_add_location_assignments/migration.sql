-- Explicit, tenant-scoped location grants for existing and future memberships.
-- Product.stock, reservations and every stock flow stay untouched; this migration
-- adds no endpoint and no authorization behavior.

-- The backfill must see memberships committed while the trigger lock waits,
-- even if the migration connection defaults to REPEATABLE READ.
BEGIN ISOLATION LEVEL READ COMMITTED;

-- Organization creation writes Location before OrganizationUser; organization
-- deletion can cascade in the opposite order. Wait for both paths here before
-- taking either child lock. SHARE still allows ordinary reads and FK checks.
LOCK TABLE "Organization" IN SHARE MODE;

-- Parent keys required by the composite foreign keys below. They also make a
-- mixed-tenant grant impossible through either endpoint of the join.
CREATE UNIQUE INDEX "Location_id_organizationId_key"
    ON "Location"("id", "organizationId");
CREATE UNIQUE INDEX "OrganizationUser_id_organizationId_key"
    ON "OrganizationUser"("id", "organizationId");

CREATE TABLE "LocationAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "organizationUserId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationAssignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LocationAssignment_location_fkey"
        FOREIGN KEY ("locationId", "organizationId")
        REFERENCES "Location"("id", "organizationId")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LocationAssignment_organizationUserId_organizationId_fkey"
        FOREIGN KEY ("organizationUserId", "organizationId")
        REFERENCES "OrganizationUser"("id", "organizationId")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LocationAssignment_organizationUserId_locationId_key"
    ON "LocationAssignment"("organizationUserId", "locationId");
CREATE INDEX "LocationAssignment_organizationId_idx"
    ON "LocationAssignment"("organizationId");
CREATE INDEX "LocationAssignment_locationId_idx"
    ON "LocationAssignment"("locationId");

-- Grants the organization's default location, and only that one. When the
-- default is absent the SELECT inserts nothing: zero assignments never mean
-- "all locations". The dynamic statement resolves both tables in the triggering
-- schema so the function stays scoped to the schema it was installed in.
CREATE FUNCTION "create_principal_location_assignment"() RETURNS trigger AS $$
BEGIN
    EXECUTE format(
        'INSERT INTO %I."LocationAssignment" ("id", "organizationId", "organizationUserId", "locationId", "createdAt")
         SELECT gen_random_uuid()::text, $1, $2, l."id", CURRENT_TIMESTAMP
         FROM %I."Location" AS l
         WHERE l."organizationId" = $1 AND l."isDefault" = TRUE
         ON CONFLICT ("organizationUserId", "locationId") DO NOTHING',
        TG_TABLE_SCHEMA, TG_TABLE_SCHEMA
    ) USING NEW."organizationId", NEW."id";
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Install the trigger before the backfill: the DDL lock it takes on
-- "OrganizationUser" serializes concurrent membership writers with this
-- transaction, so they fire the trigger after commit instead of slipping in
-- between backfill and trigger creation.
CREATE TRIGGER "OrganizationUser_principal_location_assignment"
AFTER INSERT ON "OrganizationUser"
FOR EACH ROW EXECUTE FUNCTION "create_principal_location_assignment"();

-- One default location per organization makes this deterministic. ON CONFLICT
-- also covers a membership whose trigger ran before this statement ran.
INSERT INTO "LocationAssignment" ("id", "organizationId", "organizationUserId", "locationId", "createdAt")
SELECT gen_random_uuid()::text, m."organizationId", m."id", l."id", CURRENT_TIMESTAMP
FROM "OrganizationUser" AS m
JOIN "Location" AS l
  ON l."organizationId" = m."organizationId" AND l."isDefault" = TRUE
ON CONFLICT ("organizationUserId", "locationId") DO NOTHING;

COMMIT;
