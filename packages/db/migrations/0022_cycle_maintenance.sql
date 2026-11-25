-- Migration 0022 — M7 cycle maintenance discovery function (§3.3)
--
-- Rollback note (contract-phase companion of 0020):
--   DROP FUNCTION IF EXISTS list_cycle_maintenance_projects();
--   No data change; safe to drop at any time.
--
-- The nightly `tasks-cycle-maintenance` sweep discovers projects with the
-- cycle engine enabled BEFORE opening a tenant tx — `withSystem` sees zero
-- tenant rows by design (§12.4), so discovery goes through a SECURITY DEFINER
-- function the same way `list_workspaces_with_snoozed_triage()` does (0021).
-- It returns (workspace_id, project_id) pairs only; every mutation runs
-- inside `withWorkspace`.

CREATE OR REPLACE FUNCTION list_cycle_maintenance_projects()
RETURNS TABLE (
	workspace_id uuid,
	project_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
	SELECT DISTINCT p.workspace_id, p.id
	FROM public.projects p
	WHERE p.cycle_enabled;
$$;
REVOKE ALL ON FUNCTION list_cycle_maintenance_projects() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_cycle_maintenance_projects() TO huriro_app;
