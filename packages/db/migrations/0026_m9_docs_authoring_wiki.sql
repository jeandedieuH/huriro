-- 0026_m9_docs_authoring_wiki.sql — M9 Docs Notion Authoring & Wiki
-- (advaced-features-plan §4.2–§4.5, §8.2, ADR-0027):
--   * Teamspaces (`teamspaces`, `teamspace_members`) & `acl_entries` resource_type='teamspace'
--   * Page covers, typography, full-width, small-text, and page locking on `doc_pages`
--   * Synced blocks (`doc_synced_blocks`) + `collab_tickets` room_kind='synced_block'
--   * In-house Suggestion Mode index (`doc_suggestions`)
--   * Wiki Verification & Freshness (`doc_verifications`) + expiry helper
--   * Publish to Web (`doc_public_shares`) + public resolution helpers
--   * Expand `notifications.kind` for `doc.verification_expiring` and `doc.suggestion_created`
--
-- Expand-phase only. Every new tenant table has workspace-scoped composite
-- keys/foreign keys and ENABLE + FORCE ROW LEVEL SECURITY.
--
-- Rollback note: drop SECURITY DEFINER functions (list_expiring_doc_verifications,
-- resolve_public_doc_share, list_public_workspace_shares); drop tables in reverse
-- dependency order (doc_public_shares -> doc_verifications -> doc_suggestions ->
-- doc_synced_blocks -> teamspace_members -> teamspaces); drop added columns on
-- collab_tickets and doc_pages (restoring collab_tickets.page_id NOT NULL);
-- restore previous CHECK constraints on acl_entries.resource_type and notifications.kind;
-- remove doc.verify, doc.publish, teamspace.manage from role_permissions.

-- ---------- 1. Permissions & CHECK expansions ----------
INSERT INTO role_permissions (workspace_id, role_id, permission)
SELECT r.workspace_id, r.id, p.perm
FROM roles r
CROSS JOIN (VALUES ('doc.verify'), ('doc.publish'), ('teamspace.manage')) AS p(perm)
WHERE r.key IN ('owner', 'admin')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (workspace_id, role_id, permission)
SELECT r.workspace_id, r.id, 'doc.verify'
FROM roles r
WHERE r.key = 'member'
ON CONFLICT DO NOTHING;

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
			AND rel.relname = 'acl_entries'
			AND con.contype = 'c'
			AND pg_get_constraintdef(con.oid) LIKE '%resource_type%'
	LOOP
		EXECUTE format('ALTER TABLE public.acl_entries DROP CONSTRAINT %I', c_name);
	END LOOP;

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

ALTER TABLE acl_entries ADD CONSTRAINT ck_acl_entries_resource_type
	CHECK (resource_type IN ('project', 'doc_page', 'teamspace', 'channel', 'mail_account'));

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
			'doc.access_granted',
			'doc.verification_expiring',
			'doc.suggestion_created',
			'chat.mentioned',
			'chat.dm',
			'chat.reply',
			'chat.message',
			'channel.access_granted',
			'approval.requested',
			'mail.assigned',
			'mail.mentioned',
			'mail.reply_needed'
		)
	);

-- ---------- 2. Teamspaces (§4.4) ----------
CREATE TABLE teamspaces (
	id          uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	name        text NOT NULL,
	slug        text NOT NULL,
	icon        text,
	description text NOT NULL DEFAULT '',
	visibility  text NOT NULL DEFAULT 'open' CHECK (visibility IN ('open', 'closed', 'private')),
	default_acl jsonb NOT NULL DEFAULT '[]'::jsonb,
	position    text COLLATE "C" NOT NULL,
	archived_at timestamptz,
	created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at  timestamptz NOT NULL DEFAULT now(),
	updated_at  timestamptz NOT NULL DEFAULT now(),
	version     int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, slug)
);
CREATE INDEX idx_teamspaces_ws_pos ON teamspaces (workspace_id, position COLLATE "C", id)
	WHERE archived_at IS NULL;
CREATE TRIGGER trg_teamspaces_updated_at
	BEFORE UPDATE ON teamspaces
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE teamspace_members (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	teamspace_id uuid NOT NULL,
	user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	role         text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member', 'viewer')),
	created_at   timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, teamspace_id, user_id),
	FOREIGN KEY (workspace_id, teamspace_id)
		REFERENCES teamspaces (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_teamspace_members_user ON teamspace_members (workspace_id, user_id);

-- ---------- 3. Expand doc_pages (§4.2, §4.4) ----------
ALTER TABLE doc_pages
	ADD COLUMN IF NOT EXISTS teamspace_id uuid,
	ADD COLUMN IF NOT EXISTS cover_file_id uuid,
	ADD COLUMN IF NOT EXISTS cover_gradient text,
	ADD COLUMN IF NOT EXISTS cover_position_y int NOT NULL DEFAULT 50
		CHECK (cover_position_y BETWEEN 0 AND 100),
	ADD COLUMN IF NOT EXISTS font_style text NOT NULL DEFAULT 'sans'
		CHECK (font_style IN ('sans', 'serif', 'mono')),
	ADD COLUMN IF NOT EXISTS full_width boolean NOT NULL DEFAULT false,
	ADD COLUMN IF NOT EXISTS small_text boolean NOT NULL DEFAULT false,
	ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false,
	ADD COLUMN IF NOT EXISTS locked_by uuid REFERENCES users(id) ON DELETE SET NULL,
	ADD COLUMN IF NOT EXISTS locked_at timestamptz;

ALTER TABLE doc_pages
	ADD CONSTRAINT fk_doc_pages_teamspace
		FOREIGN KEY (workspace_id, teamspace_id)
		REFERENCES teamspaces (workspace_id, id) ON DELETE SET NULL (teamspace_id),
	ADD CONSTRAINT fk_doc_pages_cover_file
		FOREIGN KEY (workspace_id, cover_file_id)
		REFERENCES files (workspace_id, id) ON DELETE SET NULL (cover_file_id);

CREATE INDEX IF NOT EXISTS idx_doc_pages_teamspace
	ON doc_pages (workspace_id, teamspace_id, position COLLATE "C")
	WHERE archived_at IS NULL;

-- ---------- 4. Synced Blocks (§4.2) ----------
CREATE TABLE doc_synced_blocks (
	id               uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	title            text NOT NULL DEFAULT 'Synced block',
	source_page_id   uuid,
	state            bytea NOT NULL,
	state_vector     bytea NOT NULL,
	byte_size        int NOT NULL CHECK (byte_size >= 0),
	lease_node_id    text,
	lease_epoch      bigint NOT NULL DEFAULT 0,
	lease_expires_at timestamptz,
	plain_text       text NOT NULL DEFAULT '',
	created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
	archived_at      timestamptz,
	created_at       timestamptz NOT NULL DEFAULT now(),
	updated_at       timestamptz NOT NULL DEFAULT now(),
	version          int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, source_page_id)
		REFERENCES doc_pages (workspace_id, id) ON DELETE SET NULL (source_page_id)
);
CREATE INDEX idx_doc_synced_blocks_ws ON doc_synced_blocks (workspace_id, updated_at DESC)
	WHERE archived_at IS NULL;
CREATE TRIGGER trg_doc_synced_blocks_updated_at
	BEFORE UPDATE ON doc_synced_blocks
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Expand collab_tickets to support both `doc_page` and `synced_block` rooms.
ALTER TABLE collab_tickets
	ALTER COLUMN page_id DROP NOT NULL,
	ADD COLUMN IF NOT EXISTS room_kind text NOT NULL DEFAULT 'doc_page'
		CHECK (room_kind IN ('doc_page', 'synced_block')),
	ADD COLUMN IF NOT EXISTS synced_block_id uuid;

ALTER TABLE collab_tickets
	ADD CONSTRAINT fk_collab_tickets_synced_block
		FOREIGN KEY (workspace_id, synced_block_id)
		REFERENCES doc_synced_blocks (workspace_id, id) ON DELETE CASCADE,
	ADD CONSTRAINT ck_collab_tickets_room_target
		CHECK (
			(room_kind = 'doc_page' AND page_id IS NOT NULL AND synced_block_id IS NULL)
			OR (room_kind = 'synced_block' AND synced_block_id IS NOT NULL AND page_id IS NULL)
		);

-- ---------- 5. Suggestion Mode Index (§4.3, ADR-0027) ----------
CREATE TABLE doc_suggestions (
	id              uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	page_id         uuid NOT NULL,
	group_id        text NOT NULL,
	kind            text NOT NULL CHECK (kind IN ('insert', 'delete', 'replace')),
	author_type     text NOT NULL DEFAULT 'user' CHECK (author_type IN ('user', 'agent')),
	author_id       uuid NOT NULL,
	anchor_block_id text,
	before_text     text NOT NULL DEFAULT '',
	after_text      text NOT NULL DEFAULT '',
	status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected')),
	resolved_by     uuid REFERENCES users(id) ON DELETE SET NULL,
	resolved_at     timestamptz,
	created_at      timestamptz NOT NULL DEFAULT now(),
	updated_at      timestamptz NOT NULL DEFAULT now(),
	version         int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, page_id, group_id),
	FOREIGN KEY (workspace_id, page_id)
		REFERENCES doc_pages (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_doc_suggestions_page_status ON doc_suggestions (workspace_id, page_id, status, created_at);
CREATE TRIGGER trg_doc_suggestions_updated_at
	BEFORE UPDATE ON doc_suggestions
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- 6. Wiki Verification & Freshness (§4.3) ----------
CREATE TABLE doc_verifications (
	id                 uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id       uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	page_id            uuid NOT NULL,
	status             text NOT NULL DEFAULT 'verified' CHECK (status IN ('verified', 'stale', 'unverified')),
	verified_by        uuid REFERENCES users(id) ON DELETE SET NULL,
	verified_at        timestamptz,
	expires_at         timestamptz,
	expiry_notified_at timestamptz,
	note               text NOT NULL DEFAULT '',
	created_at         timestamptz NOT NULL DEFAULT now(),
	updated_at         timestamptz NOT NULL DEFAULT now(),
	version            int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, page_id),
	FOREIGN KEY (workspace_id, page_id)
		REFERENCES doc_pages (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_doc_verifications_expiry ON doc_verifications (expires_at)
	WHERE status = 'verified' AND expires_at IS NOT NULL;
CREATE TRIGGER trg_doc_verifications_updated_at
	BEFORE UPDATE ON doc_verifications
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- 7. Publish to Web (§4.5) ----------
CREATE TABLE doc_public_shares (
	id                    uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id          uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	page_id               uuid NOT NULL,
	public_slug           text NOT NULL,
	include_children      boolean NOT NULL DEFAULT false,
	allow_search_indexing boolean NOT NULL DEFAULT false,
	password_hash         text,
	expires_at            timestamptz,
	revoked_at            timestamptz,
	created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at            timestamptz NOT NULL DEFAULT now(),
	updated_at            timestamptz NOT NULL DEFAULT now(),
	version               int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, page_id),
	UNIQUE (workspace_id, public_slug),
	FOREIGN KEY (workspace_id, page_id)
		REFERENCES doc_pages (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_doc_public_shares_active ON doc_public_shares (workspace_id, public_slug)
	WHERE revoked_at IS NULL;
CREATE TRIGGER trg_doc_public_shares_updated_at
	BEFORE UPDATE ON doc_public_shares
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- 8. SECURITY DEFINER Cross-Tenant Discovery Helpers ----------
CREATE OR REPLACE FUNCTION list_expiring_doc_verifications()
RETURNS TABLE (workspace_id uuid, page_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
	SELECT dv.workspace_id, dv.page_id
	FROM doc_verifications dv
	JOIN doc_pages dp ON dp.workspace_id = dv.workspace_id AND dp.id = dv.page_id
	WHERE dp.archived_at IS NULL
		AND dv.status = 'verified'
		AND dv.expires_at IS NOT NULL
		AND (
			dv.expires_at <= now()
			OR (dv.expires_at <= now() + interval '7 days' AND dv.expiry_notified_at IS NULL)
		);
$$;

CREATE OR REPLACE FUNCTION resolve_public_doc_share(
	p_workspace_slug citext,
	p_public_slug text
)
RETURNS TABLE (
	share_id uuid,
	workspace_id uuid,
	workspace_slug citext,
	workspace_name text,
	page_id uuid,
	public_slug text,
	include_children boolean,
	allow_search_indexing boolean,
	password_hash text,
	expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
	SELECT
		s.id AS share_id,
		s.workspace_id,
		w.slug AS workspace_slug,
		w.name AS workspace_name,
		s.page_id,
		s.public_slug,
		s.include_children,
		s.allow_search_indexing,
		s.password_hash,
		s.expires_at
	FROM doc_public_shares s
	JOIN workspaces w ON w.id = s.workspace_id
	JOIN doc_pages dp ON dp.workspace_id = s.workspace_id AND dp.id = s.page_id
	WHERE w.slug = p_workspace_slug
		AND w.deleted_at IS NULL
		AND s.public_slug = p_public_slug
		AND s.revoked_at IS NULL
		AND (s.expires_at IS NULL OR s.expires_at > now())
		AND dp.archived_at IS NULL
	LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION list_public_workspace_shares(p_workspace_slug citext)
RETURNS TABLE (
	workspace_id uuid,
	workspace_name text,
	public_slug text,
	title text,
	updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
	SELECT
		s.workspace_id,
		w.name AS workspace_name,
		s.public_slug,
		dp.title,
		dp.updated_at
	FROM doc_public_shares s
	JOIN workspaces w ON w.id = s.workspace_id
	JOIN doc_pages dp ON dp.workspace_id = s.workspace_id AND dp.id = s.page_id
	WHERE w.slug = p_workspace_slug
		AND w.deleted_at IS NULL
		AND s.revoked_at IS NULL
		AND s.password_hash IS NULL
		AND (s.expires_at IS NULL OR s.expires_at > now())
		AND dp.archived_at IS NULL
	ORDER BY dp.title ASC;
$$;

REVOKE ALL ON FUNCTION list_expiring_doc_verifications() FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_public_doc_share(citext, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION list_public_workspace_shares(citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_expiring_doc_verifications() TO huriro_app;
GRANT EXECUTE ON FUNCTION resolve_public_doc_share(citext, text) TO huriro_app;
GRANT EXECUTE ON FUNCTION list_public_workspace_shares(citext) TO huriro_app;

-- ---------- 9. RLS Policies (ENABLE + FORCE on every new tenant table) ----------
ALTER TABLE teamspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE teamspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY teamspaces_tenant_isolation ON teamspaces
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE teamspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE teamspace_members FORCE ROW LEVEL SECURITY;
CREATE POLICY teamspace_members_tenant_isolation ON teamspace_members
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE doc_synced_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_synced_blocks FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_synced_blocks_tenant_isolation ON doc_synced_blocks
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE doc_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_suggestions FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_suggestions_tenant_isolation ON doc_suggestions
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE doc_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_verifications FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_verifications_tenant_isolation ON doc_verifications
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE doc_public_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_public_shares FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_public_shares_tenant_isolation ON doc_public_shares
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ---------- 10. Grants ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON
	teamspaces,
	teamspace_members,
	doc_synced_blocks,
	doc_suggestions,
	doc_verifications,
	doc_public_shares
TO huriro_app;

GRANT SELECT ON
	teamspaces,
	teamspace_members,
	doc_synced_blocks,
	doc_suggestions,
	doc_verifications,
	doc_public_shares
TO huriro_maint;
