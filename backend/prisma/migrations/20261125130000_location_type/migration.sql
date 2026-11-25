-- Site type: a store serves customers, a warehouse stores stock. Existing
-- locations predate the distinction and keep operating as stores, which also
-- keeps the organization's principal site a store.
CREATE TYPE "LocationType" AS ENUM ('STORE', 'WAREHOUSE');

ALTER TABLE "Location"
  ADD COLUMN "type" "LocationType" NOT NULL DEFAULT 'STORE';

-- Site names are unique per organization, ignoring case: two branches may not
-- read the same in the directory or on a receipt. Prisma cannot express an
-- expression index, so it lives here like the partial unique index that keeps
-- one default site per organization.
CREATE UNIQUE INDEX "Location_organizationId_lower_name_key"
  ON "Location" ("organizationId", lower("name"));
