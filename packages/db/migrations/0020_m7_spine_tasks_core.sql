-- 0020_m7_spine_tasks_core.sql — M7 platform spine (advaced-features-plan §3.1,
-- §3.3, §3.4, §7.1, §7.2, §8.2): issue triage lifecycle, project cycle/triage
-- settings, saved-view display options + FilterExpr column, cycle daily
-- snapshots, the unified entity_links graph (ADR-0033), and workflow
-- automation tables (ADR-0028).
--
-- Expand-phase only. Every new tenant table has:
--   * workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
--   * UNIQUE (workspace_id, id) on FK targets
--   * composite tenant FKs (workspace_id, x_id) REFERENCES x (workspace_id, id)
--   * ENABLE + FORCE ROW LEVEL SECURITY + *_tenant_isolation policy
--
-- Workspace automation kill switch + run quota are NOT columns here: they live
-- in workspaces.settings ('automations_enabled' default true,
-- 'automation_max_runs_per_minute' default 60) like mcp_enabled.
--
-- Rollback note: drop tables in reverse dependency order
-- (automation_run_steps → automation_runs → automation_rules → entity_links →
-- cycle_daily_snapshots), ALTER TABLE issues/projects/saved_views DROP the new
-- columns, restore saved_views CHECK (layout IN ('list','board')), and remove
-- the automation.* role_permissions rows.

-- ---------- 1. Issue triage lifecycle (§3.1) ----------
ALTER TABLE issues
	ADD COLUMN IF NOT EXISTS triage_status text NOT NULL DEFAULT 'none'
		CHECK (triage_status IN ('none','pending','accepted','snoozed','declined','merged')),
	ADD COLUMN IF NOT EXISTS triage_snoozed_until timestamptz,
	ADD COLUMN IF NOT EXISTS triage_declined_reason text,
	ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'manual'
		CHECK (source_kind IN ('manual','mail','chat','form','github','gitlab','api','agent'));

CREATE INDEX IF NOT EXISTS idx_issues_triage_queue
	ON issues (workspace_id, project_id, created_at)
	WHERE triage_status IN ('pending','snoozed');
CREATE INDEX IF NOT EXISTS idx_issues_triage_snooze
	ON issues (triage_snoozed_until)
	WHERE triage_status = 'snoozed';

-- ---------- 2. Project triage & cycle settings (§3.1, §3.3) ----------
ALTER TABLE projects
	ADD COLUMN IF NOT EXISTS triage_enabled boolean NOT NULL DEFAULT false,
	ADD COLUMN IF NOT EXISTS cycle_enabled boolean NOT NULL DEFAULT false,
	ADD COLUMN IF NOT EXISTS cycle_duration_days int NOT NULL DEFAULT 14
		CHECK (cycle_duration_days BETWEEN 1 AND 90),
	ADD COLUMN IF NOT EXISTS cycle_cooldown_days int NOT NULL DEFAULT 0
		CHECK (cycle_cooldown_days >= 0 AND cycle_cooldown_days <= 30),
	ADD COLUMN IF NOT EXISTS cycle_auto_rollover_mode text NOT NULL DEFAULT 'next_cycle'
		CHECK (cycle_auto_rollover_mode IN ('next_cycle','backlog','none')),
	ADD COLUMN IF NOT EXISTS cycle_start_weekday smallint NOT NULL DEFAULT 1
		CHECK (cycle_start_weekday BETWEEN 0 AND 6);

-- ---------- 3. Saved views v2 (§3.4) ----------
-- Widen layout for timeline/calendar/table views; drop whatever CHECK the
-- column carries by catalog (name has shifted across instances).
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
			AND rel.relname = 'saved_views'
			AND con.contype = 'c'
			AND pg_get_constraintdef(con.oid) LIKE '%layout%'
	LOOP
		EXECUTE format('ALTER TABLE public.saved_views DROP CONSTRAINT %I', c_name);
	END LOOP;
END
$$;

ALTER TABLE saved_views ADD CONSTRAINT ck_saved_views_layout
	CHECK (layout IN ('list','board','timeline','calendar','table'));

ALTER TABLE saved_views
	ADD COLUMN IF NOT EXISTS display_options jsonb NOT NULL DEFAULT '{}'::jsonb,
	-- Domain FilterExpr AST (packages/domain filter-ast). When non-null it wins
	-- over the legacy flat `filters` column, which stays for V1 compat.
	ADD COLUMN IF NOT EXISTS filter_expr jsonb;

-- ---------- 4. Cycle daily burnup snapshots (§3.3, §3.8) ----------
CREATE TABLE cycle_daily_snapshots (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	cycle_id uuid NOT NULL,
	snapshot_date date NOT NULL,
	total_issues int NOT NULL,
	completed_issues int NOT NULL,
	started_issues int NOT NULL,
	total_estimate numeric(10,2) NOT NULL DEFAULT 0,
	completed_estimate numeric(10,2) NOT NULL DEFAULT 0,
	scope_added_count int NOT NULL DEFAULT 0,
	scope_removed_count int NOT NULL DEFAULT 0,
	cancelled_issues int NOT NULL DEFAULT 0,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, cycle_id, snapshot_date),
	FOREIGN KEY (workspace_id, cycle_id) REFERENCES cycles (workspace_id, id) ON DELETE CASCADE
);

-- ---------- 5. Unified cross-entity graph (§7.1, ADR-0033) ----------
-- Polymorphic endpoints: NO FK on source_id/target_id — integrity is enforced
-- in the service layer + transactional cleanup on entity delete (ADR-0033).
CREATE TABLE entity_links (
	id uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	source_type text NOT NULL CHECK (source_type IN (
		'issue','doc_page','doc_database_row','chat_message','mail_conversation','contact_org','vcs_pr'
	)),
	source_id uuid NOT NULL,
	target_type text NOT NULL CHECK (target_type IN (
		'issue','doc_page','doc_database_row','chat_message','mail_conversation','contact_org','vcs_pr'
	)),
	target_id uuid NOT NULL,
	relation_kind text NOT NULL DEFAULT 'references'
		CHECK (relation_kind IN ('references','blocks','duplicates','originated_from','tracked_by','requested_by')),
	created_by uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, source_type, source_id, target_type, target_id, relation_kind),
	CHECK (NOT (source_type = target_type AND source_id = target_id))
);
CREATE INDEX idx_entity_links_src ON entity_links (workspace_id, source_type, source_id);
CREATE INDEX idx_entity_links_tgt ON entity_links (workspace_id, target_type, target_id);

-- ---------- 6. Workflow automation engine (§7.2, ADR-0028) ----------
CREATE TABLE automation_rules (
	id uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	name text NOT NULL,
	description text NOT NULL DEFAULT '',
	enabled boolean NOT NULL DEFAULT false,
	-- Every rule executes as an agent_principals(kind='automation') principal —
	-- least privilege through can()/RLS, never a bypass (ADR-0028, R23).
	principal_id uuid NOT NULL,
	trigger_kind text NOT NULL CHECK (trigger_kind IN ('event','cron')),
	-- event: { eventTypes: string[] }; cron: { cron: string, timezone: string }
	trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
	condition_ast jsonb,                    -- domain FilterExpr (packages/domain filter-ast)
	actions jsonb NOT NULL DEFAULT '[]'::jsonb,
	next_run_at timestamptz,
	last_run_at timestamptz,
	created_by uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	version int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, name),
	FOREIGN KEY (workspace_id, principal_id) REFERENCES agent_principals (workspace_id, id)
);
CREATE TRIGGER trg_automation_rules_updated_at
	BEFORE UPDATE ON automation_rules
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_automation_rules_next_run
	ON automation_rules (next_run_at)
	WHERE enabled AND trigger_kind = 'cron';
CREATE INDEX idx_automation_rules_ws_enabled ON automation_rules (workspace_id, enabled);

CREATE TABLE automation_runs (
	id uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	rule_id uuid NOT NULL,
	trigger_event_id uuid,                  -- outbox.id; no FK — outbox rows purge
	status text NOT NULL CHECK (status IN (
		'running','succeeded','failed','skipped','loop_guard_tripped','quota_exceeded','dry_run'
	)),
	depth int NOT NULL DEFAULT 0 CHECK (depth >= 0),   -- x_automation_depth from outbox metadata
	dry_run boolean NOT NULL DEFAULT false,
	trigger_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
	started_at timestamptz NOT NULL DEFAULT now(),
	finished_at timestamptz,
	duration_ms int,
	error_detail text,
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, rule_id) REFERENCES automation_rules (workspace_id, id) ON DELETE CASCADE
);
-- Idempotency: at most one real run per (rule, event); dry runs are exempt.
CREATE UNIQUE INDEX uq_automation_runs_event
	ON automation_runs (workspace_id, rule_id, trigger_event_id)
	WHERE trigger_event_id IS NOT NULL AND dry_run = false;
CREATE INDEX idx_automation_runs_rule ON automation_runs (workspace_id, rule_id, started_at DESC);
CREATE INDEX idx_automation_runs_ws_started ON automation_runs (workspace_id, started_at);

CREATE TABLE automation_run_steps (
	id uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	run_id uuid NOT NULL,
	step_index int NOT NULL,
	action_kind text NOT NULL,
	status text NOT NULL CHECK (status IN ('succeeded','failed','skipped','simulated')),
	input jsonb NOT NULL DEFAULT '{}'::jsonb,
	output jsonb,
	error_detail text,
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, run_id, step_index),
	FOREIGN KEY (workspace_id, run_id) REFERENCES automation_runs (workspace_id, id) ON DELETE CASCADE
);

-- ---------- 7. RLS (ENABLE + FORCE on every new tenant table) ----------
ALTER TABLE cycle_daily_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycle_daily_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY cycle_daily_snapshots_tenant_isolation ON cycle_daily_snapshots
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE entity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_links FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_links_tenant_isolation ON entity_links
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY automation_rules_tenant_isolation ON automation_rules
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY automation_runs_tenant_isolation ON automation_runs
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE automation_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_run_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY automation_run_steps_tenant_isolation ON automation_run_steps
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ---------- 8. Grants ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON
	cycle_daily_snapshots,
	entity_links,
	automation_rules,
	automation_runs,
	automation_run_steps
TO huriro_app;

GRANT SELECT ON
	cycle_daily_snapshots,
	entity_links,
	automation_rules,
	automation_runs,
	automation_run_steps
TO huriro_maint;

-- Run/step history is prunable by audited retention jobs (huriro_maint).
GRANT DELETE ON
	automation_runs,
	automation_run_steps
TO huriro_maint;

-- ---------- 9. Permission backfill for existing workspaces ----------
-- New workspaces seed from packages/domain SYSTEM_ROLES; existing rows get the
-- new actions here (same pattern as 0015/0016). Members may inspect rules but
-- only admins manage them.
INSERT INTO role_permissions (workspace_id, role_id, permission)
SELECT r.workspace_id, r.id, 'automation.read'
FROM roles r
WHERE r.key IN ('owner', 'admin', 'member')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (workspace_id, role_id, permission)
SELECT r.workspace_id, r.id, 'automation.manage'
FROM roles r
WHERE r.key IN ('owner', 'admin')
ON CONFLICT DO NOTHING;
