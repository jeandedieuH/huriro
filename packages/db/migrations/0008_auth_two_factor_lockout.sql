-- 0008_auth_two_factor_lockout.sql — better-auth twoFactor plugin drift (§8.3).
--
-- better-auth 1.7.x added lockout bookkeeping to the twoFactor model:
-- `verified` (enrollment confirmed), `failedVerificationCount` and
-- `lockedUntil` (brute-force lockout). The adapter validates the Drizzle
-- schema at request time and refuses writes when expected columns are
-- missing, so sign-up/sign-in fail until this lands.
--
-- Grants need no change: huriro_auth already holds ALL on auth.two_factor.
--
-- Rollback note: ALTER TABLE auth.two_factor DROP COLUMN verified,
-- DROP COLUMN failed_verification_count, DROP COLUMN locked_until.

ALTER TABLE auth.two_factor
	ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT true,
	ADD COLUMN IF NOT EXISTS failed_verification_count integer NOT NULL DEFAULT 0,
	ADD COLUMN IF NOT EXISTS locked_until timestamptz;
