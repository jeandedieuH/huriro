-- 0019_outbox_dead_letters.sql — general outbox dead-lettering (§5.5, §20).
--
-- The drain previously retried a permanently-failing event every tick forever
-- (observed: 500+ attempts on unprocessable rows). Now each failure schedules
-- the next attempt with capped exponential backoff, and after the attempt
-- budget is exhausted the row is dead-lettered: out of the retry loop, visible
-- to operators (`huriro dead-letters`), re-armable via replay. No silent drops.
--
-- Expand-phase only — additive columns, plus a recreated partial index so
-- dead-lettered rows leave the pending scan. Instance-level table: no RLS.
--
-- Rollback note: drop index idx_outbox_pending, recreate it as
--   CREATE INDEX idx_outbox_pending ON outbox (created_at) WHERE published_at IS NULL;
-- then ALTER TABLE outbox DROP COLUMN dead_lettered_at, DROP COLUMN
-- last_attempt_at, DROP COLUMN next_attempt_at.

ALTER TABLE outbox
	ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz,   -- null = still in the retry loop
	ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
	ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;    -- null = due immediately

CREATE INDEX IF NOT EXISTS idx_outbox_dead_letters
	ON outbox (dead_lettered_at)
	WHERE dead_lettered_at IS NOT NULL;

DROP INDEX IF EXISTS idx_outbox_pending;
CREATE INDEX idx_outbox_pending
	ON outbox (created_at)
	WHERE published_at IS NULL AND dead_lettered_at IS NULL;
