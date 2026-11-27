-- T3h — an operational membership starts at the organization's principal site.
--
-- S3 keeps owners and administrators on every site of their organization, and
-- gives every other role only the sites an administrator assigned it. The only
-- principal-site grants installed so far came from the one-shot backfill in
-- 20261118140000_membership_location_access, which ran for organizations that
-- held a single site. A CASHIER, MEMBER or INVENTORY_USER created afterwards
-- kept zero grants — that is, zero sites, so it could not even reach the POS —
-- and a membership demoted from OWNER/ADMIN to one of those roles kept exactly
-- the grants it already had, none of them when the role was its whole access.
--
-- This migration installs that baseline and keeps it:
--
--   * "OrganizationUser_principal_site" grants the organization's principal site
--     after an operational membership is inserted;
--   * on UPDATE OF "role" it grants it only for a demotion from OWNER/ADMIN to
--     an operational role whose membership still holds no grant at all;
--   * the backfill below gives the principal site to the operational
--     memberships that already exist with zero grants.
--
-- Nothing else widens: an organization-wide role still derives its access from
-- the role and never receives a row, a membership that already holds a grant is
-- never touched, a second site is never granted, and creating a "Location"
-- grants nothing (the trigger only reads the site provisioning created).
BEGIN;

-- Do not queue membership writers indefinitely while acquiring the table locks.
DO $$
BEGIN
    IF (SELECT setting::int FROM pg_catalog.pg_settings WHERE name = 'lock_timeout') NOT BETWEEN 1 AND 5000 THEN
        PERFORM set_config('lock_timeout', '5s', true);
    END IF;
END $$;

-- Lock order, from parent to child, and why it cannot deadlock:
--
--   * "Organization" in SHARE mode first. Organization deletion and
--     provisioning both need ROW EXCLUSIVE on it, so neither starts while this
--     migration runs, and this migration waits for whichever began first while
--     holding nothing yet. The parent lock is taken before any child lock, so a
--     concurrent deletion can never hold a child row this migration wants.
--   * "OrganizationUser" in SHARE ROW EXCLUSIVE next: it is the lock CREATE
--     TRIGGER needs and it keeps membership writers out for the whole
--     transaction, so the trigger and the backfill never see a membership the
--     other one created. Taking it before any grant lock matters: an in-flight
--     membership insert holds ROW EXCLUSIVE here and only later asks for a grant
--     write (its trigger), so it finishes instead of waiting on a lock this
--     migration holds while waiting for that insert.
--   * "Location" in SHARE mode so the principal site the backfill reads cannot
--     be created, renamed or removed underneath it, again after the membership
--     lock, exactly like the two migrations that seeded sites and balances.
--   * "MembershipLocation" in SHARE ROW EXCLUSIVE last, so the backfill is the
--     only grant writer while it runs (reads stay allowed) and a concurrent
--     assignment replacement cannot interleave a delete with these inserts.
LOCK TABLE "Organization" IN SHARE MODE;
LOCK TABLE "OrganizationUser" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "Location" IN SHARE MODE;
LOCK TABLE "MembershipLocation" IN SHARE ROW EXCLUSIVE MODE;

-- Runtime lock order of the trigger, for the same reason: it reads the
-- principal "Location" and then writes the grant, while an organization
-- deletion cascades "OrganizationUser" before "Location" (constraint creation
-- order). Both orders are parent-first, so a deletion waits for a competing
-- membership insert or demotion instead of deadlocking with it.
CREATE FUNCTION "grant_principal_site"() RETURNS trigger AS $$
DECLARE
    principal_site text;
BEGIN
    -- Owners and administrators reach every site through their role; a
    -- membership outside the operational roles holds no grant on purpose.
    IF NEW."role"::text NOT IN ('CASHIER', 'MEMBER', 'INVENTORY_USER') THEN
        RETURN NULL;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- Only a demotion from an organization-wide role grants the baseline.
        -- Any other role edit leaves the assignments an administrator wrote.
        IF OLD."role"::text NOT IN ('OWNER', 'ADMIN') THEN
            RETURN NULL;
        END IF;
        -- A membership that already holds any access keeps exactly that access.
        IF EXISTS (
            SELECT 1
            FROM "MembershipLocation" held
            WHERE held."userId" = NEW."userId"
              AND held."organizationId" = NEW."organizationId"
        ) THEN
            RETURN NULL;
        END IF;
    END IF;

    -- There is one principal site per organization at most.
    SELECT l."id" INTO principal_site
    FROM "Location" l
    WHERE l."organizationId" = NEW."organizationId" AND l."isDefault"
    ORDER BY l."id"
    LIMIT 1;

    -- Provisioning order: an organization whose principal site does not exist
    -- yet keeps the membership without grants instead of failing the insert.
    -- Creating that site later grants nothing; an administrator assigns.
    IF principal_site IS NULL THEN
        RETURN NULL;
    END IF;

    INSERT INTO "MembershipLocation" ("userId", "organizationId", "locationId")
    VALUES (NEW."userId", NEW."organizationId", principal_site)
    ON CONFLICT DO NOTHING;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OrganizationUser_principal_site"
AFTER INSERT OR UPDATE OF "role" ON "OrganizationUser"
FOR EACH ROW EXECUTE FUNCTION "grant_principal_site"();

-- The baseline S3 says current operational users keep: every operational
-- membership that holds no grant at all receives its organization's principal
-- site. Memberships that already hold any grant are not touched, and an
-- organization without a principal site stays as it is.
INSERT INTO "MembershipLocation" ("userId", "organizationId", "locationId")
SELECT m."userId", m."organizationId", l."id"
FROM "OrganizationUser" m
JOIN "Location" l ON l."organizationId" = m."organizationId" AND l."isDefault"
WHERE m."role"::text IN ('CASHIER', 'MEMBER', 'INVENTORY_USER')
  AND NOT EXISTS (
      SELECT 1
      FROM "MembershipLocation" held
      WHERE held."userId" = m."userId"
        AND held."organizationId" = m."organizationId"
  )
ON CONFLICT DO NOTHING;

COMMIT;
