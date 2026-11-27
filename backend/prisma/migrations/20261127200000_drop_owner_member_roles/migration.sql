-- Drop OWNER and MEMBER from the role enum (architecture/roles-redesign, phase 4).
--
-- S1 leaves exactly three roles: ADMIN (Propietario/Admin), CASHIER and
-- INVENTORY_USER. Both earlier migrations already rewrote every membership
-- (20261127120000 MEMBER -> CASHIER, 20261127130000 OWNER -> ADMIN); this one
-- rewrites any straggler again, then recreates the type without those labels so
-- they become unrepresentable in the database. Ownership keeps riding the
-- isPrimaryOwner flag, which this migration never reads nor writes, and
-- "grant_principal_site" compares NEW."role"::text, so the rewrites add and
-- remove no MembershipLocation row. AuditLog keeps the free-text role it was
-- written with.
BEGIN;

-- Do not queue membership writers indefinitely while waiting for row locks.
DO $$
BEGIN
    IF (SELECT setting::int FROM pg_catalog.pg_settings WHERE name = 'lock_timeout') NOT BETWEEN 1 AND 5000 THEN
        PERFORM set_config('lock_timeout', '5s', true);
    END IF;
END $$;

-- Hold every membership writer out for the whole transaction. The rewrite below
-- then sees every committed row, and an insert cannot land a retired value
-- between the rewrite and the type change.
LOCK TABLE "OrganizationUser" IN SHARE ROW EXCLUSIVE MODE;

-- Stragglers first: an instance still running the previous release can have
-- inserted a retired value since the earlier rewrites ran.
UPDATE "OrganizationUser" SET "role" = 'ADMIN' WHERE "role" = 'OWNER';
UPDATE "OrganizationUser" SET "role" = 'CASHIER' WHERE "role" = 'MEMBER';

-- Postgres refuses to alter the type of a column named by a trigger's
-- `UPDATE OF` list, so the principal-site trigger is dropped and recreated
-- around the type change. Its function reads NEW."role"::text and therefore
-- does not need to change.
DROP TRIGGER "OrganizationUser_principal_site" ON "OrganizationUser";

-- Postgres cannot remove enum labels in place: rename the old type, create the
-- new one, convert the column through text, and drop the old type. The default
-- goes first because its literal still belongs to the old type.
ALTER TYPE "OrgRole" RENAME TO "OrgRole_old";
CREATE TYPE "OrgRole" AS ENUM ('ADMIN', 'CASHIER', 'INVENTORY_USER');
ALTER TABLE "OrganizationUser" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "OrganizationUser" ALTER COLUMN "role" TYPE "OrgRole" USING ("role"::text::"OrgRole");
ALTER TABLE "OrganizationUser" ALTER COLUMN "role" SET DEFAULT 'CASHIER';
DROP TYPE "OrgRole_old";

CREATE TRIGGER "OrganizationUser_principal_site"
AFTER INSERT OR UPDATE OF "role" ON "OrganizationUser"
FOR EACH ROW EXECUTE FUNCTION "grant_principal_site"();

COMMIT;
