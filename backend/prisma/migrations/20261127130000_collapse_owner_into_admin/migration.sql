-- Collapse OWNER into ADMIN (architecture/roles-redesign, phase 2).
--
-- Every existing OWNER membership becomes ADMIN. Ownership keeps riding the
-- isPrimaryOwner flag, which this migration never reads nor writes. Both roles
-- already have organization-wide site access, and
-- "OrganizationUser_principal_site" grants a site only when the NEW role is
-- CASHIER/MEMBER/INVENTORY_USER, so this rewrite adds and removes no
-- MembershipLocation row. The enum value stays until phase 4 (Postgres needs a
-- type recreation to drop it); AuditLog keeps the role text it was written with.
BEGIN;

-- Do not queue membership writers indefinitely while waiting for row locks.
DO $$
BEGIN
    IF (SELECT setting::int FROM pg_catalog.pg_settings WHERE name = 'lock_timeout') NOT BETWEEN 1 AND 5000 THEN
        PERFORM set_config('lock_timeout', '5s', true);
    END IF;
END $$;

-- Hold every membership writer out for the whole transaction: SHARE ROW
-- EXCLUSIVE conflicts with the ROW EXCLUSIVE an insert or update takes, so no
-- membership can become OWNER between the statement below and COMMIT, while
-- reads keep working. Unlike the MEMBER retirement there is no column default
-- to move (a new membership already defaults to CASHIER) and the API refuses
-- OWNER from this release on.
LOCK TABLE "OrganizationUser" IN SHARE ROW EXCLUSIVE MODE;

UPDATE "OrganizationUser" SET "role" = 'ADMIN' WHERE "role" = 'OWNER';

COMMIT;
