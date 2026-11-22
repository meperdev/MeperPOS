BEGIN;

-- Bound the wait for DDL locks without overriding a stricter session limit.
DO $$
BEGIN
    IF (SELECT setting::int FROM pg_catalog.pg_settings WHERE name = 'lock_timeout') NOT BETWEEN 1 AND 5000 THEN
        PERFORM set_config('lock_timeout', '5s', true);
    END IF;
END $$;

-- Existing movement history has no reliable location attribution.
ALTER TABLE "InventoryMovement"
    ADD COLUMN "locationId" TEXT,
    ADD CONSTRAINT "InventoryMovement_locationId_organizationId_fkey"
        FOREIGN KEY ("locationId", "organizationId")
        REFERENCES "Location"("id", "organizationId")
        ON DELETE NO ACTION ON UPDATE RESTRICT;

COMMIT;
