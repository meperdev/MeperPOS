-- RefreshToken: record why a row was revoked (SEC-005 remediation).
-- 'rotated' keeps the 60s concurrent-tab grace; 'logout'/'revoke-all' are
-- explicit session ends and must never refill a session.
ALTER TABLE "RefreshToken" ADD COLUMN "revocationCause" TEXT;
