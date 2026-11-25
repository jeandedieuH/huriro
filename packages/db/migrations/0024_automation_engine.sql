-- Migration 0024 — workflow automation engine runtime (§7.2, ADR-0028)
--
-- Rollback note (contract-phase companion of 0020):
--   DROP TRIGGER IF EXISTS trg_outbox_automation_depth ON outbox;
--   DROP FUNCTION IF EXISTS outbox_propagate_automation_depth();
--   DROP FUNCTION IF EXISTS list_due_automation_cron_rules(timestamptz);
--   DROP FUNCTION IF EXISTS list_due_automation_runs(integer, uuid);
--   No table data is changed by this migration.
--
-- Expand-phase only: adds automation depth propagation metadata and the
-- SECURITY DEFINER discovery idioms needed by role=worker. `agent_principals`
-- already allows kind='automation' (0002), so no CHECK migration is required.

-- ---------- 1. Outbox depth propagation (R23 loop guard) ----------
-- The worker sets transaction-local app.automation_depth while executing a
-- rule. This trigger copies that depth into every outbox payload written by
-- the same transaction, so owning modules do not need to know automation
-- metadata exists. A pre-existing explicit depth wins when it is larger.
CREATE OR REPLACE FUNCTION outbox_propagate_automation_depth()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	raw_depth text;
	depth int;
	existing_depth int;
BEGIN
	raw_depth := current_setting('app.automation_depth', true);
	IF raw_depth IS NULL OR raw_depth = '' THEN
		RETURN NEW;
	END IF;

	BEGIN
		depth := raw_depth::int;
	EXCEPTION WHEN OTHERS THEN
		RETURN NEW;
	END;
	IF depth < 0 THEN
		depth := 0;
	END IF;

	existing_depth := CASE jsonb_typeof(NEW.payload->'x_automation_depth')
		WHEN 'number' THEN floor((NEW.payload->>'x_automation_depth')::numeric)::int
		ELSE NULL
	END;
	NEW.payload := NEW.payload || jsonb_build_object(
		'x_automation_depth',
		GREATEST(depth, COALESCE(existing_depth, depth))
	);
	RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_outbox_automation_depth ON outbox;
CREATE TRIGGER trg_outbox_automation_depth
	BEFORE INSERT ON outbox
	FOR EACH ROW EXECUTE FUNCTION outbox_propagate_automation_depth();

-- ---------- 2. Worker discovery across tenant boundaries ----------
-- withSystem intentionally sees no tenant rows (§12.4). As with 0021/0022,
-- these SECURITY DEFINER functions return ids only; every mutation and read of
-- the actual rule/run happens afterwards inside withWorkspace.
CREATE OR REPLACE FUNCTION list_due_automation_cron_rules(due_by timestamptz)
RETURNS TABLE (
	workspace_id uuid,
	rule_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
	SELECT r.workspace_id, r.id
	FROM public.automation_rules r
	WHERE r.enabled
		AND r.trigger_kind = 'cron'
		AND r.next_run_at IS NOT NULL
		AND r.next_run_at <= due_by
	ORDER BY r.next_run_at ASC;
$$;
REVOKE ALL ON FUNCTION list_due_automation_cron_rules(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_due_automation_cron_rules(timestamptz) TO huriro_app;

-- Spillover/crash recovery discovery for runs already marked 'running'. The
-- per-run advisory lock in the executor prevents double execution when several
-- workers race over the same ids.
CREATE OR REPLACE FUNCTION list_due_automation_runs(batch_limit integer, p_workspace_id uuid DEFAULT NULL)
RETURNS TABLE (
	workspace_id uuid,
	run_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
	SELECT r.workspace_id, r.id
	FROM public.automation_runs r
	WHERE r.status = 'running'
		AND (p_workspace_id IS NULL OR r.workspace_id = p_workspace_id)
	ORDER BY r.started_at ASC
	LIMIT LEAST(GREATEST(batch_limit, 1), 100);
$$;
REVOKE ALL ON FUNCTION list_due_automation_runs(integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_due_automation_runs(integer, uuid) TO huriro_app;
