-- Migration 0021 — M7 triage snooze-wake discovery function
--
-- Rollback note (contract-phase companion of 0020):
--   DROP FUNCTION IF EXISTS list_workspaces_with_snoozed_triage(timestamptz);
--   No data change; safe to drop at any time.
--
-- The 60s `tasks-triage-wake` sweep discovers workspaces with due snoozed
-- issues BEFORE opening a tenant tx — `withSystem` sees zero tenant rows by
-- design (§12.4), so discovery goes through a SECURITY DEFINER function the
-- same way `list_mail_drafts_due_for_send()` does (0016). It returns
-- workspace ids only; the per-workspace UPDATE runs inside `withWorkspace`.

CREATE OR REPLACE FUNCTION list_workspaces_with_snoozed_triage(due_by timestamptz)
RETURNS TABLE (workspace_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
	SELECT DISTINCT i.workspace_id
	FROM public.issues i
	WHERE i.triage_status = 'snoozed'
		AND i.triage_snoozed_until IS NOT NULL
		AND i.triage_snoozed_until <= due_by;
$$;
REVOKE ALL ON FUNCTION list_workspaces_with_snoozed_triage(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_workspaces_with_snoozed_triage(timestamptz) TO huriro_app;
