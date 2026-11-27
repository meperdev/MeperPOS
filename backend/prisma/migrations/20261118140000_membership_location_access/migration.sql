BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS "Location_id_organizationId_key"
    ON "Location" ("id", "organizationId");

CREATE TABLE "MembershipLocation" (
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    CONSTRAINT "MembershipLocation_pkey" PRIMARY KEY ("userId", "organizationId", "locationId"),
    CONSTRAINT "MembershipLocation_userId_organizationId_fkey"
        FOREIGN KEY ("userId", "organizationId") REFERENCES "OrganizationUser" ("userId", "organizationId")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MembershipLocation_locationId_organizationId_fkey"
        FOREIGN KEY ("locationId", "organizationId") REFERENCES "Location" ("id", "organizationId")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "MembershipLocation_organizationId_locationId_idx"
    ON "MembershipLocation" ("organizationId", "locationId");

-- Preserve access only when the existing default is the unambiguous sole site.
INSERT INTO "MembershipLocation" ("userId", "organizationId", "locationId")
SELECT m."userId", m."organizationId", l."id"
FROM "OrganizationUser" m
JOIN "Location" l ON l."organizationId" = m."organizationId" AND l."isDefault"
WHERE m."role" IN ('CASHIER', 'MEMBER', 'INVENTORY_USER')
  AND NOT EXISTS (
      SELECT 1 FROM "Location" other
      WHERE other."organizationId" = m."organizationId" AND other."id" <> l."id"
  );

COMMIT;
