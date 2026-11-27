-- Retire the MEMBER role (architecture/roles-redesign, phase 3).
--
-- Every existing MEMBER membership becomes CASHIER, and new memberships default
-- to CASHIER. Both are operational roles holding the same principal-site grant,
-- and "OrganizationUser_principal_site" only acts on a demotion from OWNER/ADMIN,
-- so no MembershipLocation row is added or removed. The enum value itself stays
-- until phase 4 (Postgres needs a type recreation to drop it); AuditLog keeps
-- the role text it was written with.
BEGIN;

-- Do not queue membership writers indefinitely while waiting for row locks.
DO $$
BEGIN
    IF (SELECT setting::int FROM pg_catalog.pg_settings WHERE name = 'lock_timeout') NOT BETWEEN 1 AND 5000 THEN
        PERFORM set_config('lock_timeout', '5s', true);
    END IF;
END $$;

-- The default goes first: ALTER TABLE takes ACCESS EXCLUSIVE, waits for every
-- in-flight membership insert and holds new ones until COMMIT, so the row
-- rewrite below sees every row ever written with the old default. In the opposite order
-- an insert committing between the two statements kept MEMBER.
ALTER TABLE "OrganizationUser" ALTER COLUMN "role" SET DEFAULT 'CASHIER';

UPDATE "OrganizationUser" SET "role" = 'CASHIER' WHERE "role" = 'MEMBER';

COMMIT;
