-- AlterTable
-- Every channel carries a retention policy from the moment this migration runs.
-- The default is the policy the design document states (30 days), so an existing
-- connection is never left without one and the purge job never has to guess.
ALTER TABLE "WhatsAppConnection" ADD COLUMN "retentionDays" INTEGER NOT NULL DEFAULT 30;

-- AddCheckConstraint
-- A retention policy below one day would delete the message the webhook just
-- stored, so the floor is enforced in the database as well as in the schema.
-- NOT VALID on purpose: the constraint applies to every future insert and update
-- but does not scan the existing row at deploy time, so a value an operator may
-- have written by hand cannot block this migration. The first purge run treats
-- anything below one day as one day, so a legacy row is still handled safely.
ALTER TABLE "WhatsAppConnection" ADD CONSTRAINT "WhatsAppConnection_retentionDays_check" CHECK ("retentionDays" >= 1) NOT VALID;
