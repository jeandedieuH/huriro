-- 0006_tasks_and_sync.sql — M1 Tasks, Sync signal tickets, Search index,
-- In-app Notifications, and Importers (§8.3–8.4, §9, §11.1, §17.13b).
--
-- Expand-phase only. Every new table is tenant-scoped with:
--   * workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
--   * UNIQUE (workspace_id, id) on every FK-target table
--   * composite tenant FKs (workspace_id, x_id) REFERENCES x (workspace_id, id)
--   * COLLATE "C" on every fractional-index position column (§8.1)
--   * ENABLE + FORCE ROW LEVEL SECURITY + *_tenant_isolation policy
--
-- Rollback note: drop tables in reverse dependency order (import_mappings ...
-- realtime_tickets), drop validate_issue_assignee(), and restore ck_change_log_action.

-- ---------- Expand change_log.action for grant events (§9.3) ----------
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
			AND rel.relname = 'change_log'
			AND con.contype = 'c'
			AND pg_get_constraintdef(con.oid) LIKE '%action%'
	LOOP
		EXECUTE format('ALTER TABLE public.change_log DROP CONSTRAINT %I', c_name);
	END LOOP;
END
$$;

ALTER TABLE change_log ADD CONSTRAINT ck_change_log_action
	CHECK (action IN ('upsert', 'delete', 'reorder', 'revoke', 'grant'));

-- ---------- Realtime signal tickets (§9.4) ----------
CREATE TABLE realtime_tickets (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	device_id    text NOT NULL,
	token_hash   text NOT NULL UNIQUE,
	expires_at   timestamptz NOT NULL,
	consumed_at  timestamptz,
	created_at   timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id)
);
CREATE INDEX idx_realtime_tickets_ws_user ON realtime_tickets (workspace_id, user_id);
CREATE INDEX idx_realtime_tickets_expires ON realtime_tickets (expires_at);

-- ---------- Projects & statuses & labels & cycles (§8.3) ----------
CREATE TABLE projects (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	key          text NOT NULL CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
	name         text NOT NULL,
	description  text NOT NULL DEFAULT '',
	visibility   text NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('workspace', 'private')),
	position     text COLLATE "C" NOT NULL,
	archived_at  timestamptz,
	created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	version      int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, key)
);
CREATE TRIGGER trg_projects_updated_at
	BEFORE UPDATE ON projects
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE project_statuses (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	project_id   uuid NOT NULL,
	name         text NOT NULL,
	category     text NOT NULL CHECK (category IN ('backlog', 'unstarted', 'started', 'completed', 'cancelled')),
	color        text NOT NULL DEFAULT 'neutral',
	position     text COLLATE "C" NOT NULL,
	is_default   boolean NOT NULL DEFAULT false,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	version      int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, project_id, name),
	FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_project_statuses_proj ON project_statuses (workspace_id, project_id, position);
CREATE TRIGGER trg_project_statuses_updated_at
	BEFORE UPDATE ON project_statuses
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE labels (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	name         text NOT NULL,
	color        text NOT NULL DEFAULT 'neutral',
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	version      int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, name)
);
CREATE TRIGGER trg_labels_updated_at
	BEFORE UPDATE ON labels
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cycles (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	project_id   uuid NOT NULL,
	name         text NOT NULL,
	description  text NOT NULL DEFAULT '',
	status       text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed')),
	starts_at    date NOT NULL,
	ends_at      date NOT NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	version      int NOT NULL DEFAULT 1,
	CHECK (ends_at >= starts_at),
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_cycles_project ON cycles (workspace_id, project_id, starts_at);
CREATE TRIGGER trg_cycles_updated_at
	BEFORE UPDATE ON cycles
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE issue_counters (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	project_id   uuid PRIMARY KEY,
	next_number  int NOT NULL DEFAULT 1,
	created_at   timestamptz NOT NULL DEFAULT now(),
	FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE
);

-- ---------- Issues, relations, comments, saved views ----------
CREATE TABLE issues (
	id               uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	project_id       uuid NOT NULL,
	number           int NOT NULL,
	parent_id        uuid,
	cycle_id         uuid,
	title            text NOT NULL,
	description      jsonb,
	description_text text NOT NULL DEFAULT '',
	status_id        uuid NOT NULL,
	priority         smallint NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4),
	assignee_type    text CHECK (assignee_type IN ('user', 'agent')),
	assignee_id      uuid,
	creator_id       uuid NOT NULL REFERENCES users(id),
	position         text COLLATE "C" NOT NULL,
	start_date       date,
	due_date         date,
	estimate         numeric(6, 2),
	closed_at        timestamptz,
	search_tsv       tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, ''))) STORED,
	created_at       timestamptz NOT NULL DEFAULT now(),
	updated_at       timestamptz NOT NULL DEFAULT now(),
	deleted_at       timestamptz,
	version          int NOT NULL DEFAULT 1,
	CHECK ((assignee_type IS NULL) = (assignee_id IS NULL)),
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, project_id, number),
	FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, status_id) REFERENCES project_statuses (workspace_id, id),
	FOREIGN KEY (workspace_id, parent_id) REFERENCES issues (workspace_id, id) ON DELETE SET NULL,
	FOREIGN KEY (workspace_id, cycle_id) REFERENCES cycles (workspace_id, id) ON DELETE SET NULL
);
CREATE INDEX idx_issues_board ON issues (workspace_id, project_id, status_id, position)
	WHERE deleted_at IS NULL;
CREATE INDEX idx_issues_assignee ON issues (workspace_id, assignee_type, assignee_id)
	WHERE deleted_at IS NULL;
CREATE INDEX idx_issues_parent ON issues (workspace_id, parent_id)
	WHERE deleted_at IS NULL AND parent_id IS NOT NULL;
CREATE INDEX idx_issues_search ON issues USING gin (search_tsv);
CREATE INDEX idx_issues_title_trgm ON issues USING gin (title gin_trgm_ops);

CREATE TRIGGER trg_issues_updated_at
	BEFORE UPDATE ON issues
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Validate polymorphic assignee_type/assignee_id (§8.3).
CREATE OR REPLACE FUNCTION validate_issue_assignee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
	IF NEW.assignee_type IS NULL THEN
		RETURN NEW;
	END IF;
	IF NEW.assignee_type = 'user' THEN
		IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.assignee_id AND u.deleted_at IS NULL) THEN
			RAISE EXCEPTION 'assignee user % does not exist', NEW.assignee_id USING ERRCODE = 'foreign_key_violation';
		END IF;
	ELSIF NEW.assignee_type = 'agent' THEN
		IF NOT EXISTS (
			SELECT 1 FROM agent_principals a
			WHERE a.workspace_id = NEW.workspace_id AND a.id = NEW.assignee_id AND a.status <> 'revoked'
		) THEN
			RAISE EXCEPTION 'assignee agent % does not exist in workspace %', NEW.assignee_id, NEW.workspace_id
				USING ERRCODE = 'foreign_key_violation';
		END IF;
	END IF;
	RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION validate_issue_assignee() FROM PUBLIC;

CREATE TRIGGER trg_issues_validate_assignee
	BEFORE INSERT OR UPDATE OF assignee_type, assignee_id ON issues
	FOR EACH ROW EXECUTE FUNCTION validate_issue_assignee();

-- Pure join table (exempt from updated_at/version per §4.2).
CREATE TABLE issue_labels (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	issue_id     uuid NOT NULL,
	label_id     uuid NOT NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, issue_id, label_id),
	FOREIGN KEY (workspace_id, issue_id) REFERENCES issues (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, label_id) REFERENCES labels (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_issue_labels_label ON issue_labels (workspace_id, label_id);

-- Pure link table (append/delete; exempt from updated_at/version per §4.2).
CREATE TABLE issue_relations (
	id              uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	source_issue_id uuid NOT NULL,
	target_issue_id uuid NOT NULL,
	kind            text NOT NULL CHECK (kind IN ('blocks', 'relates_to', 'duplicates')),
	created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at      timestamptz NOT NULL DEFAULT now(),
	CHECK (source_issue_id <> target_issue_id),
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, source_issue_id, target_issue_id, kind),
	FOREIGN KEY (workspace_id, source_issue_id) REFERENCES issues (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, target_issue_id) REFERENCES issues (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_issue_relations_target ON issue_relations (workspace_id, target_issue_id);

CREATE TABLE issue_comments (
	id          uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	issue_id    uuid NOT NULL,
	author_type text NOT NULL DEFAULT 'user' CHECK (author_type IN ('user', 'agent')),
	author_id   uuid NOT NULL,
	body        jsonb,
	body_text   text NOT NULL,
	created_at  timestamptz NOT NULL DEFAULT now(),
	updated_at  timestamptz NOT NULL DEFAULT now(),
	deleted_at  timestamptz,
	version     int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, issue_id) REFERENCES issues (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_issue_comments_issue ON issue_comments (workspace_id, issue_id, created_at)
	WHERE deleted_at IS NULL;
CREATE TRIGGER trg_issue_comments_updated_at
	BEFORE UPDATE ON issue_comments
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE saved_views (
	id            uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	project_id    uuid,
	owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
	name          text NOT NULL,
	layout        text NOT NULL DEFAULT 'list' CHECK (layout IN ('list', 'board')),
	filters       jsonb NOT NULL DEFAULT '{}'::jsonb,
	sort          jsonb NOT NULL DEFAULT '{}'::jsonb,
	is_shared     boolean NOT NULL DEFAULT false,
	position      text COLLATE "C" NOT NULL,
	created_at    timestamptz NOT NULL DEFAULT now(),
	updated_at    timestamptz NOT NULL DEFAULT now(),
	version       int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_saved_views_ws ON saved_views (workspace_id, project_id, position);
CREATE TRIGGER trg_saved_views_updated_at
	BEFORE UPDATE ON saved_views
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Search materialized index (§11.1) ----------
CREATE TABLE search_documents (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	entity_type  text NOT NULL CHECK (entity_type IN ('issue', 'project', 'comment', 'doc_page', 'message', 'mail_message')),
	entity_id    uuid NOT NULL,
	project_id   uuid,
	container_id uuid,
	identifier   text,
	title        text NOT NULL DEFAULT '',
	body         text NOT NULL DEFAULT '',
	lang         text NOT NULL DEFAULT 'simple',
	tsv          tsvector GENERATED ALWAYS AS (
		setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
		setweight(to_tsvector('simple', coalesce(body, '')), 'B')
	) STORED,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, entity_type, entity_id),
	FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_sd_tsv ON search_documents USING gin (tsv);
CREATE INDEX idx_sd_trgm ON search_documents USING gin (title gin_trgm_ops);
CREATE INDEX idx_sd_identifier ON search_documents (workspace_id, identifier) WHERE identifier IS NOT NULL;
CREATE TRIGGER trg_search_documents_updated_at
	BEFORE UPDATE ON search_documents
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Notifications (§15) ----------
CREATE TABLE notifications (
	id                uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	actor_type        text NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
	actor_id          uuid,
	kind              text NOT NULL CHECK (
		kind IN (
			'issue.assigned',
			'issue.mentioned',
			'issue.commented',
			'issue.status_changed',
			'project.access_granted'
		)
	),
	entity_type       text NOT NULL,
	entity_id         uuid NOT NULL,
	title             text NOT NULL,
	body              text NOT NULL DEFAULT '',
	metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
	read_at           timestamptz,
	archived_at       timestamptz,
	created_at        timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id)
);
CREATE INDEX idx_notifications_recipient ON notifications (workspace_id, recipient_user_id, created_at DESC)
	WHERE archived_at IS NULL;

-- ---------- Importers (§17.13b) ----------
CREATE TABLE import_jobs (
	id                uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	source            text NOT NULL CHECK (source IN ('linear', 'github')),
	status            text NOT NULL DEFAULT 'dry_run'
		CHECK (status IN ('dry_run', 'pending', 'running', 'completed', 'failed', 'cancelled')),
	target_project_id uuid,
	created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
	config            jsonb NOT NULL DEFAULT '{}'::jsonb,
	preview           jsonb NOT NULL DEFAULT '{}'::jsonb,
	report            jsonb NOT NULL DEFAULT '{}'::jsonb,
	cursor            text,
	created_at        timestamptz NOT NULL DEFAULT now(),
	updated_at        timestamptz NOT NULL DEFAULT now(),
	completed_at      timestamptz,
	version           int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, target_project_id) REFERENCES projects (workspace_id, id) ON DELETE SET NULL
);
CREATE INDEX idx_import_jobs_ws ON import_jobs (workspace_id, created_at DESC);
CREATE TRIGGER trg_import_jobs_updated_at
	BEFORE UPDATE ON import_jobs
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE import_mappings (
	id                uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	import_job_id     uuid NOT NULL,
	source            text NOT NULL CHECK (source IN ('linear', 'github')),
	remote_type       text NOT NULL CHECK (remote_type IN ('project', 'issue', 'comment', 'label', 'cycle', 'status')),
	remote_id         text NOT NULL,
	remote_identifier text,
	remote_url        text,
	local_type        text NOT NULL,
	local_id          uuid NOT NULL,
	created_at        timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, source, remote_type, remote_id),
	FOREIGN KEY (workspace_id, import_job_id) REFERENCES import_jobs (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_import_mappings_redirect ON import_mappings (workspace_id, remote_identifier)
	WHERE remote_identifier IS NOT NULL;

-- ---------- RLS policies (ENABLE + FORCE on every new tenant table) ----------
ALTER TABLE realtime_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtime_tickets FORCE ROW LEVEL SECURITY;
CREATE POLICY realtime_tickets_tenant_isolation ON realtime_tickets
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
CREATE POLICY projects_tenant_isolation ON projects
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE project_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_statuses FORCE ROW LEVEL SECURITY;
CREATE POLICY project_statuses_tenant_isolation ON project_statuses
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE labels FORCE ROW LEVEL SECURITY;
CREATE POLICY labels_tenant_isolation ON labels
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycles FORCE ROW LEVEL SECURITY;
CREATE POLICY cycles_tenant_isolation ON cycles
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE issue_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY issue_counters_tenant_isolation ON issue_counters
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE issues FORCE ROW LEVEL SECURITY;
CREATE POLICY issues_tenant_isolation ON issues
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE issue_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_labels FORCE ROW LEVEL SECURITY;
CREATE POLICY issue_labels_tenant_isolation ON issue_labels
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE issue_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_relations FORCE ROW LEVEL SECURITY;
CREATE POLICY issue_relations_tenant_isolation ON issue_relations
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE issue_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_comments FORCE ROW LEVEL SECURITY;
CREATE POLICY issue_comments_tenant_isolation ON issue_comments
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_views FORCE ROW LEVEL SECURITY;
CREATE POLICY saved_views_tenant_isolation ON saved_views
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE search_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY search_documents_tenant_isolation ON search_documents
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_tenant_isolation ON notifications
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY import_jobs_tenant_isolation ON import_jobs
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE import_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_mappings FORCE ROW LEVEL SECURITY;
CREATE POLICY import_mappings_tenant_isolation ON import_mappings
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ---------- Grants ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON
	realtime_tickets,
	projects,
	project_statuses,
	labels,
	cycles,
	issue_counters,
	issues,
	issue_labels,
	issue_relations,
	issue_comments,
	saved_views,
	search_documents,
	notifications,
	import_jobs,
	import_mappings
TO huriro_app;

GRANT SELECT ON
	realtime_tickets,
	projects,
	project_statuses,
	labels,
	cycles,
	issue_counters,
	issues,
	issue_labels,
	issue_relations,
	issue_comments,
	saved_views,
	search_documents,
	notifications,
	import_jobs,
	import_mappings
TO huriro_maint;

GRANT DELETE ON realtime_tickets TO huriro_maint;
