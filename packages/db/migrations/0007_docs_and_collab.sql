-- 0007_docs_and_collab.sql — M2 Collaborative Docs, CRDT State, Room Leases,
-- Collab Tickets, Anchored Comments, Versions, Favorites, and Search/Import expansions
-- (§8.4, §10, §11.1, §17.13b).
--
-- Expand-phase only. Every new table is tenant-scoped with:
--   * workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
--   * UNIQUE (workspace_id, id) / UNIQUE (workspace_id, page_id) for composite FKs
--   * composite tenant FKs (workspace_id, x_id) REFERENCES x (workspace_id, id)
--   * COLLATE "C" on fractional-index position columns (§8.1)
--   * ENABLE + FORCE ROW LEVEL SECURITY + *_tenant_isolation policy
--
-- Rollback note: drop tables in reverse dependency order (doc_favorites ... doc_pages),
-- drop search_documents.metadata, and restore prior CHECK constraints on notifications,
-- import_jobs, and import_mappings.

-- ---------- Backfill 'doc.comment' permission on existing workspaces (§12.3) ----------
INSERT INTO role_permissions (workspace_id, role_id, permission)
SELECT r.workspace_id, r.id, 'doc.comment'
FROM roles r
WHERE r.key IN ('owner', 'admin', 'member')
ON CONFLICT (role_id, permission) DO NOTHING;

-- ---------- Expand notifications.kind for M2 doc events ----------
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
			AND rel.relname = 'notifications'
			AND con.contype = 'c'
			AND pg_get_constraintdef(con.oid) LIKE '%kind%'
	LOOP
		EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', c_name);
	END LOOP;
END
$$;

ALTER TABLE notifications ADD CONSTRAINT ck_notifications_kind
	CHECK (
		kind IN (
			'issue.assigned',
			'issue.mentioned',
			'issue.commented',
			'issue.status_changed',
			'project.access_granted',
			'doc.mentioned',
			'doc.commented',
			'doc.comment_resolved',
			'doc.access_granted'
		)
	);

-- ---------- Expand import_jobs & import_mappings for Notion/Markdown ----------
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
			AND rel.relname = 'import_jobs'
			AND con.contype = 'c'
			AND pg_get_constraintdef(con.oid) LIKE '%source%'
	LOOP
		EXECUTE format('ALTER TABLE public.import_jobs DROP CONSTRAINT %I', c_name);
	END LOOP;

	FOR c_name IN
		SELECT con.conname
		FROM pg_constraint con
		JOIN pg_class rel ON rel.oid = con.conrelid
		JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
		WHERE nsp.nspname = 'public'
			AND rel.relname = 'import_mappings'
			AND con.contype = 'c'
			AND (
				pg_get_constraintdef(con.oid) LIKE '%source%'
				OR pg_get_constraintdef(con.oid) LIKE '%remote_type%'
			)
	LOOP
		EXECUTE format('ALTER TABLE public.import_mappings DROP CONSTRAINT %I', c_name);
	END LOOP;
END
$$;

ALTER TABLE import_jobs ADD CONSTRAINT ck_import_jobs_source
	CHECK (source IN ('linear', 'github', 'notion', 'markdown'));

ALTER TABLE import_mappings ADD CONSTRAINT ck_import_mappings_source
	CHECK (source IN ('linear', 'github', 'notion', 'markdown'));

ALTER TABLE import_mappings ADD CONSTRAINT ck_import_mappings_remote_type
	CHECK (remote_type IN ('project', 'issue', 'comment', 'label', 'cycle', 'status', 'doc_page'));

-- ---------- Expand search_documents with metadata for doc slug & block anchors ----------
ALTER TABLE search_documents
	ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ---------- Document tree (§8.4) ----------
CREATE TABLE doc_pages (
	id          uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	parent_id   uuid,
	path        text NOT NULL,
	depth       int NOT NULL DEFAULT 0 CHECK (depth >= 0 AND depth <= 20),
	slug        text NOT NULL,
	title       text NOT NULL,
	icon        text,
	visibility  text NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('workspace', 'private')),
	is_template boolean NOT NULL DEFAULT false,
	position    text COLLATE "C" NOT NULL,
	created_by  uuid NOT NULL REFERENCES users(id),
	archived_at timestamptz,
	created_at  timestamptz NOT NULL DEFAULT now(),
	updated_at  timestamptz NOT NULL DEFAULT now(),
	version     int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, slug),
	FOREIGN KEY (workspace_id, parent_id) REFERENCES doc_pages (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_doc_pages_path ON doc_pages (workspace_id, path text_pattern_ops);
CREATE INDEX idx_doc_pages_tree ON doc_pages (workspace_id, parent_id, position)
	WHERE archived_at IS NULL;
CREATE TRIGGER trg_doc_pages_updated_at
	BEFORE UPDATE ON doc_pages
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Live CRDT state: one row per page, fenced by lease_epoch (exempt from `version` per §8.4).
CREATE TABLE doc_state (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	page_id      uuid PRIMARY KEY,
	state        bytea NOT NULL,
	state_vector bytea NOT NULL,
	byte_size    int NOT NULL CHECK (byte_size >= 0),
	lease_epoch  bigint NOT NULL DEFAULT 0,
	plain_text   text NOT NULL DEFAULT '',
	headings     jsonb NOT NULL DEFAULT '[]'::jsonb,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, page_id),
	FOREIGN KEY (workspace_id, page_id) REFERENCES doc_pages (workspace_id, id) ON DELETE CASCADE
);
CREATE TRIGGER trg_doc_state_updated_at
	BEFORE UPDATE ON doc_state
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Immutable version checkpoints (exempt from updated_at/version per §4.2).
CREATE TABLE doc_versions (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	page_id      uuid NOT NULL,
	kind         text NOT NULL CHECK (kind IN ('auto', 'named', 'pre_restore')),
	label        text,
	state        bytea NOT NULL,
	byte_size    int NOT NULL CHECK (byte_size >= 0),
	plain_text   text NOT NULL DEFAULT '',
	authors      uuid[] NOT NULL DEFAULT '{}',
	created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, page_id) REFERENCES doc_pages (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_doc_versions_page ON doc_versions (workspace_id, page_id, created_at DESC);

-- Single-homed room leases with fencing epoch (§10.5; uses epoch instead of version).
CREATE TABLE doc_room_leases (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	page_id      uuid PRIMARY KEY,
	node_id      text NOT NULL,
	epoch        bigint NOT NULL DEFAULT 1,
	expires_at   timestamptz NOT NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, page_id),
	FOREIGN KEY (workspace_id, page_id) REFERENCES doc_pages (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_doc_room_leases_expires ON doc_room_leases (expires_at);
CREATE TRIGGER trg_doc_room_leases_updated_at
	BEFORE UPDATE ON doc_room_leases
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Single-use collab WS tickets (§10.3; append/consume-once, exempt from updated_at/version).
CREATE TABLE collab_tickets (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	page_id      uuid NOT NULL,
	user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	permission   text NOT NULL CHECK (permission IN ('read', 'write')),
	token_hash   text NOT NULL UNIQUE,
	expires_at   timestamptz NOT NULL,
	consumed_at  timestamptz,
	created_at   timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, page_id) REFERENCES doc_pages (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_collab_tickets_expires ON collab_tickets (expires_at);
CREATE INDEX idx_collab_tickets_page_user ON collab_tickets (workspace_id, page_id, user_id);

-- Anchored document comments using Yjs RelativePosition (§10.4).
CREATE TABLE doc_comments (
	id              uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	page_id         uuid NOT NULL,
	parent_id       uuid,
	author_type     text NOT NULL DEFAULT 'user' CHECK (author_type IN ('user', 'agent')),
	author_id       uuid NOT NULL,
	anchor_from     text,
	anchor_to       text,
	anchor_quote    text NOT NULL DEFAULT '',
	anchor_block_id text,
	anchor_orphaned boolean NOT NULL DEFAULT false,
	body            jsonb,
	body_text       text NOT NULL,
	resolved_at     timestamptz,
	resolved_by     uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at      timestamptz NOT NULL DEFAULT now(),
	updated_at      timestamptz NOT NULL DEFAULT now(),
	deleted_at      timestamptz,
	version         int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, page_id) REFERENCES doc_pages (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, parent_id) REFERENCES doc_comments (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_doc_comments_page ON doc_comments (workspace_id, page_id, created_at)
	WHERE deleted_at IS NULL;
CREATE TRIGGER trg_doc_comments_updated_at
	BEFORE UPDATE ON doc_comments
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Pure join table for user favorites (exempt from updated_at/version per §4.2).
CREATE TABLE doc_favorites (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	page_id      uuid NOT NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, user_id, page_id),
	FOREIGN KEY (workspace_id, page_id) REFERENCES doc_pages (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_doc_favorites_page ON doc_favorites (workspace_id, page_id);

-- ---------- RLS policies (ENABLE + FORCE on every new tenant table) ----------
ALTER TABLE doc_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_pages FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_pages_tenant_isolation ON doc_pages
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE doc_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_state FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_state_tenant_isolation ON doc_state
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE doc_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_versions_tenant_isolation ON doc_versions
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE doc_room_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_room_leases FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_room_leases_tenant_isolation ON doc_room_leases
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE collab_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE collab_tickets FORCE ROW LEVEL SECURITY;
CREATE POLICY collab_tickets_tenant_isolation ON collab_tickets
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE doc_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_comments FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_comments_tenant_isolation ON doc_comments
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE doc_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_favorites FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_favorites_tenant_isolation ON doc_favorites
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ---------- Grants ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON
	doc_pages,
	doc_state,
	doc_versions,
	doc_room_leases,
	collab_tickets,
	doc_comments,
	doc_favorites
TO huriro_app;

GRANT SELECT ON
	doc_pages,
	doc_state,
	doc_versions,
	doc_room_leases,
	collab_tickets,
	doc_comments,
	doc_favorites
TO huriro_maint;

GRANT DELETE ON
	doc_versions,
	doc_room_leases,
	collab_tickets
TO huriro_maint;
