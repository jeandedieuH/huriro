-- 0030_user_availability.sql - Shared User Availability (ADR-0035)
--
-- Promotes the chat-owned `user_workspace_profiles` row into a first-class,
-- workspace-scoped availability model consumed by chat, tasks, mail, docs,
-- notifications, automations, agents, web, and mobile:
--   * durable manual override + timezone + off-hours suppression preferences
--   * typed (validated in @huriro/domain) weekly working hours JSONB
--   * scheduled OOO / focus / DND windows with an optional backup delegate
--   * mail round-robin availability flags
--   * explicit notification-delivery suppression reasons
--   * narrow SECURITY DEFINER discovery helpers for the 60s availability sweep
--
-- Expand-phase only: every new tenant table carries workspace_id, a composite
-- (workspace_id, id) target, ENABLE + FORCE RLS, and huriro_app grants.
--
-- Rollback note: drop the two discovery functions; drop
-- user_availability_windows; restore the previous notification_delivery_log
-- status CHECK (pending, sent, skipped_quiet_hours, failed); drop the added
-- columns on mail_inbox_routing_state and user_workspace_profiles. Safe only
-- once no rows use the new values/columns.

-- ---------- 1. Expand user_workspace_profiles ----------
ALTER TABLE user_workspace_profiles
	ADD COLUMN manual_state text NOT NULL DEFAULT 'auto',
	ADD COLUMN manual_state_expires_at timestamptz,
	ADD COLUMN timezone text NOT NULL DEFAULT 'UTC',
	ADD COLUMN suppress_notifications_off_hours boolean NOT NULL DEFAULT false,
	ADD COLUMN allow_urgent_override boolean NOT NULL DEFAULT true,
	ADD COLUMN version int NOT NULL DEFAULT 1;

ALTER TABLE user_workspace_profiles
	ADD CONSTRAINT ck_user_workspace_profiles_manual_state
	CHECK (manual_state IN ('auto', 'available', 'busy', 'dnd', 'away', 'ooo'));

CREATE INDEX idx_uwp_expirations ON user_workspace_profiles (workspace_id)
	WHERE status_expires_at IS NOT NULL
		OR manual_state_expires_at IS NOT NULL
		OR dnd_until IS NOT NULL;

-- ---------- 2. Scheduled availability windows ----------
CREATE TABLE user_availability_windows (
	id                       uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id             uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	user_id                  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kind                     text NOT NULL DEFAULT 'ooo'
		CHECK (kind IN ('ooo', 'focus', 'dnd')),
	title                    text NOT NULL DEFAULT '',
	message                  text NOT NULL DEFAULT '',
	starts_at                timestamptz NOT NULL,
	ends_at                  timestamptz NOT NULL,
	delegate_user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
	auto_decline_routing     boolean NOT NULL DEFAULT true,
	suppress_notifications   boolean NOT NULL DEFAULT true,
	started_event_emitted_at timestamptz,
	ended_event_emitted_at   timestamptz,
	created_at               timestamptz NOT NULL DEFAULT now(),
	updated_at               timestamptz NOT NULL DEFAULT now(),
	version                  int NOT NULL DEFAULT 1,
	CHECK (ends_at > starts_at),
	CHECK (delegate_user_id IS NULL OR delegate_user_id <> user_id),
	UNIQUE (workspace_id, id)
);

CREATE INDEX idx_uaw_ws_user_range
	ON user_availability_windows (workspace_id, user_id, starts_at, ends_at);
CREATE INDEX idx_uaw_ws_active_end
	ON user_availability_windows (workspace_id, ends_at);
CREATE TRIGGER trg_user_availability_windows_updated_at
	BEFORE UPDATE ON user_availability_windows
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE user_availability_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_availability_windows FORCE ROW LEVEL SECURITY;
CREATE POLICY user_availability_windows_tenant_isolation ON user_availability_windows
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON user_availability_windows TO huriro_app;
GRANT SELECT ON user_availability_windows TO huriro_maint;

-- ---------- 3. Mail round-robin availability flags ----------
ALTER TABLE mail_inbox_routing_state
	ADD COLUMN respect_working_hours boolean NOT NULL DEFAULT false,
	ADD COLUMN respect_ooo boolean NOT NULL DEFAULT true,
	ADD COLUMN use_ooo_delegate boolean NOT NULL DEFAULT true;

-- ---------- 4. Widen notification delivery suppression reasons ----------
DO $$
DECLARE
	c_name text;
BEGIN
	FOR c_name IN
		SELECT con.conname
		FROM pg_constraint con
		JOIN pg_class rel ON rel.oid = con.conrelid
		JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
		WHERE nsp.nspname = 'public'
			AND rel.relname = 'notification_delivery_log'
			AND con.contype = 'c'
			AND pg_get_constraintdef(con.oid) LIKE '%status%'
	LOOP
		EXECUTE format('ALTER TABLE public.notification_delivery_log DROP CONSTRAINT %I', c_name);
	END LOOP;
END
$$;

ALTER TABLE notification_delivery_log
	ADD CONSTRAINT ck_notification_delivery_log_status
	CHECK (status IN (
		'pending', 'sent', 'skipped_quiet_hours', 'skipped_dnd',
		'skipped_ooo', 'skipped_off_hours', 'failed'
	));

-- ---------- 5. Worker discovery helpers (SECURITY DEFINER, narrow projections) ----------
CREATE OR REPLACE FUNCTION list_availability_expirations_due()
RETURNS TABLE (workspace_id uuid, user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
	SELECT workspace_id, user_id
	FROM user_workspace_profiles
	WHERE (status_expires_at IS NOT NULL AND status_expires_at <= now())
		OR (manual_state_expires_at IS NOT NULL AND manual_state_expires_at <= now())
		OR (dnd_until IS NOT NULL AND dnd_until <= now())
	ORDER BY workspace_id, user_id
	LIMIT 1000;
$$;

CREATE OR REPLACE FUNCTION list_availability_window_transitions_due()
RETURNS TABLE (workspace_id uuid, id uuid, transition text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
	SELECT workspace_id, id, 'started'::text
	FROM user_availability_windows
	WHERE started_event_emitted_at IS NULL AND starts_at <= now()
	UNION ALL
	SELECT workspace_id, id, 'ended'::text
	FROM user_availability_windows
	WHERE ended_event_emitted_at IS NULL AND ends_at <= now()
	ORDER BY workspace_id, id, transition
	LIMIT 1000;
$$;

REVOKE ALL ON FUNCTION list_availability_expirations_due() FROM PUBLIC;
REVOKE ALL ON FUNCTION list_availability_window_transitions_due() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_availability_expirations_due() TO huriro_app;
GRANT EXECUTE ON FUNCTION list_availability_window_transitions_due() TO huriro_app;
