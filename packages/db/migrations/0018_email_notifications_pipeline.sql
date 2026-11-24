-- 0018_email_notifications_pipeline.sql — Transactional & notification email pipeline
-- (Resend / SMTP for self-host, Emailit for cloud, React Email composition).
--
-- Expand-phase only: adds `notification_preferences.email_instant_enabled`,
-- expands `notification_delivery_log.channel` to include `email_instant`, and
-- provides tenant-checked SECURITY DEFINER email recipient helpers for workers.
--
-- Rollback note: drop functions `list_workspace_owners_for_email(uuid)` and
-- `resolve_workspace_email_recipients(uuid, uuid[])`, restore the previous
-- CHECK constraint on `notification_delivery_log.channel` (`in_app`,
-- `email_digest`, `web_push`, `mobile_push`), and drop column
-- `notification_preferences.email_instant_enabled`.

-- ---------- 1. Instant email alert preference & delivery log channel ----------
ALTER TABLE notification_preferences
	ADD COLUMN IF NOT EXISTS email_instant_enabled boolean NOT NULL DEFAULT true;

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
			AND pg_get_constraintdef(con.oid) LIKE '%channel%'
	LOOP
		EXECUTE format('ALTER TABLE public.notification_delivery_log DROP CONSTRAINT %I', c_name);
	END LOOP;
END
$$;

ALTER TABLE notification_delivery_log
	ADD CONSTRAINT ck_notification_delivery_log_channel
	CHECK (channel IN ('in_app', 'email_digest', 'email_instant', 'web_push', 'mobile_push'));

-- ---------- 2. Tenant-checked worker email recipient lookup helpers ----------
-- Enforces `p_workspace_id = app.workspace_id` so workers running as `huriro_app`
-- can resolve recipient email addresses and workspace branding inside `withWorkspace`
-- without needing an interactive user session for `users_visibility` RLS.
CREATE OR REPLACE FUNCTION resolve_workspace_email_recipients(
	p_workspace_id uuid,
	p_user_ids uuid[]
)
RETURNS TABLE (
	user_id uuid,
	email text,
	display_name text,
	workspace_name text,
	workspace_slug text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
	SELECT
		u.id AS user_id,
		u.email::text,
		u.display_name,
		w.name AS workspace_name,
		w.slug AS workspace_slug
	FROM public.memberships m
	JOIN public.users u
		ON u.id = m.user_id
		AND u.deleted_at IS NULL
	JOIN public.workspaces w
		ON w.id = m.workspace_id
		AND w.deleted_at IS NULL
	WHERE p_workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
		AND m.workspace_id = p_workspace_id
		AND m.status = 'active'
		AND m.user_id = ANY(p_user_ids);
$$;
REVOKE ALL ON FUNCTION resolve_workspace_email_recipients(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_workspace_email_recipients(uuid, uuid[]) TO huriro_app;

CREATE OR REPLACE FUNCTION list_workspace_owners_for_email(
	p_workspace_id uuid
)
RETURNS TABLE (
	user_id uuid,
	email text,
	display_name text,
	workspace_name text,
	workspace_slug text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
	SELECT
		u.id AS user_id,
		u.email::text,
		u.display_name,
		w.name AS workspace_name,
		w.slug AS workspace_slug
	FROM public.memberships m
	JOIN public.roles r
		ON r.workspace_id = m.workspace_id
		AND r.id = m.role_id
	JOIN public.users u
		ON u.id = m.user_id
		AND u.deleted_at IS NULL
	JOIN public.workspaces w
		ON w.id = m.workspace_id
		AND w.deleted_at IS NULL
	WHERE p_workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
		AND m.workspace_id = p_workspace_id
		AND m.status = 'active'
		AND r.key = 'owner';
$$;
REVOKE ALL ON FUNCTION list_workspace_owners_for_email(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_workspace_owners_for_email(uuid) TO huriro_app;
