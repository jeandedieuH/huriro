-- 0025_m8_planning_timeline.sql — M8 Tasks Linear Completion slice (advaced-features-plan
-- §3.2): initiatives, initiative/project ordering, project status updates,
-- project milestones, and issue → milestone links.
--
-- Expand-phase only. Every new tenant table has workspace-scoped composite
-- keys/foreign keys and ENABLE + FORCE ROW LEVEL SECURITY.
--
-- Rollback note: ALTER TABLE issues DROP CONSTRAINT fk_issues_milestone and
-- DROP COLUMN milestone_id; drop tables in reverse dependency order
-- (project_updates → initiative_projects → project_milestones → initiatives);
-- remove the initiative.manage role_permissions rows.

-- ---------- 1. Initiatives (§3.2) ----------
CREATE TABLE initiatives (
	id uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	name text NOT NULL,
	description jsonb,
	description_text text NOT NULL DEFAULT '',
	health text NOT NULL DEFAULT 'on_track'
		CHECK (health IN ('on_track','at_risk','off_track','completed')),
	owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
	target_date date,
	position text COLLATE "C" NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	version int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id)
);
CREATE TRIGGER trg_initiatives_updated_at
	BEFORE UPDATE ON initiatives
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_initiatives_ws_position
	ON initiatives (workspace_id, position COLLATE "C", id);
CREATE INDEX idx_initiatives_ws_target_date
	ON initiatives (workspace_id, target_date)
	WHERE target_date IS NOT NULL;

-- Many-to-many ordering across projects. This is a pure edge table like
-- issue_labels: the composite primary key is the stable identity.
CREATE TABLE initiative_projects (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	initiative_id uuid NOT NULL,
	project_id uuid NOT NULL,
	position text COLLATE "C" NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, initiative_id, project_id),
	FOREIGN KEY (workspace_id, initiative_id)
		REFERENCES initiatives (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, project_id)
		REFERENCES projects (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_initiative_projects_project
	ON initiative_projects (workspace_id, project_id, initiative_id);

-- ---------- 2. Project milestones (§3.2) ----------
CREATE TABLE project_milestones (
	id uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	project_id uuid NOT NULL,
	name text NOT NULL,
	description text NOT NULL DEFAULT '',
	target_date date,
	status text NOT NULL DEFAULT 'planned'
		CHECK (status IN ('planned','completed','missed')),
	position text COLLATE "C" NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	version int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	-- Additional composite target used by issues so a milestone can never be
	-- attached across project boundaries even if application validation is bypassed.
	UNIQUE (workspace_id, project_id, id),
	FOREIGN KEY (workspace_id, project_id)
		REFERENCES projects (workspace_id, id) ON DELETE CASCADE
);
CREATE TRIGGER trg_project_milestones_updated_at
	BEFORE UPDATE ON project_milestones
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_project_milestones_project
	ON project_milestones (workspace_id, project_id, position COLLATE "C", id);
CREATE INDEX idx_project_milestones_target_date
	ON project_milestones (workspace_id, target_date)
	WHERE target_date IS NOT NULL;

ALTER TABLE issues ADD COLUMN milestone_id uuid;
ALTER TABLE issues ADD CONSTRAINT fk_issues_milestone
	FOREIGN KEY (workspace_id, project_id, milestone_id)
	REFERENCES project_milestones (workspace_id, project_id, id)
	ON DELETE SET NULL (milestone_id);
CREATE INDEX idx_issues_milestone
	ON issues (workspace_id, project_id, milestone_id)
	WHERE milestone_id IS NOT NULL;

-- ---------- 3. Project status updates (§3.2) ----------
CREATE TABLE project_updates (
	id uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	project_id uuid NOT NULL,
	health text NOT NULL
		CHECK (health IN ('on_track','at_risk','off_track','completed')),
	body jsonb,
	body_text text NOT NULL DEFAULT '',
	completed_issues int NOT NULL DEFAULT 0 CHECK (completed_issues >= 0),
	total_issues int NOT NULL DEFAULT 0 CHECK (total_issues >= 0),
	scope_change int NOT NULL DEFAULT 0,
	created_by uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	version int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, project_id)
		REFERENCES projects (workspace_id, id) ON DELETE CASCADE,
	CHECK (completed_issues <= total_issues)
);
CREATE TRIGGER trg_project_updates_updated_at
	BEFORE UPDATE ON project_updates
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_project_updates_project
	ON project_updates (workspace_id, project_id, created_at DESC);

-- ---------- 4. RLS (ENABLE + FORCE on every new tenant table) ----------
ALTER TABLE initiatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE initiatives FORCE ROW LEVEL SECURITY;
CREATE POLICY initiatives_tenant_isolation ON initiatives
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE initiative_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE initiative_projects FORCE ROW LEVEL SECURITY;
CREATE POLICY initiative_projects_tenant_isolation ON initiative_projects
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE project_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_milestones FORCE ROW LEVEL SECURITY;
CREATE POLICY project_milestones_tenant_isolation ON project_milestones
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE project_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_updates FORCE ROW LEVEL SECURITY;
CREATE POLICY project_updates_tenant_isolation ON project_updates
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ---------- 5. Grants ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON
	initiatives,
	initiative_projects,
	project_milestones,
	project_updates
TO huriro_app;

GRANT SELECT ON
	initiatives,
	initiative_projects,
	project_milestones,
	project_updates
TO huriro_maint;

-- ---------- 6. Permission backfill for existing workspaces ----------
-- New workspaces seed from packages/domain SYSTEM_ROLES; existing workspaces
-- receive the new initiative administration action here. Initiative reads use
-- ordinary project.read; creating/reordering/health changes are admin-level.
INSERT INTO role_permissions (workspace_id, role_id, permission)
SELECT r.workspace_id, r.id, 'initiative.manage'
FROM roles r
WHERE r.key IN ('owner', 'admin')
ON CONFLICT DO NOTHING;
