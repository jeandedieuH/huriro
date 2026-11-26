-- 0027_m10_doc_databases.sql — M10 Docs Structured Databases & Linked Views
-- (advaced-features-plan §4.1, §8.1–§8.3, ADR-0026):
--   * Relational doc databases, typed properties, rows, sparse cell values, views
--   * Lazy row pages via doc_pages.is_database_row
--   * database.read/write/manage permission catalog additions
--   * acl_entries.resource_type='doc_database' for database-level ACLs
--
-- Expand-phase only. Every new tenant table has workspace-scoped composite
-- keys/foreign keys and ENABLE + FORCE ROW LEVEL SECURITY.
--
-- Rollback note: drop tables in reverse dependency order
-- (doc_database_views -> doc_database_cell_values -> doc_database_rows ->
-- doc_database_properties -> doc_databases); drop doc_pages.is_database_row;
-- restore the previous acl_entries.resource_type CHECK; remove
-- database.read/write/manage from role_permissions.

-- ---------- 1. Permissions & ACL resource expansion ----------
INSERT INTO role_permissions (workspace_id, role_id, permission)
SELECT r.workspace_id, r.id, p.perm
FROM roles r
CROSS JOIN (VALUES ('database.read'), ('database.write'), ('database.manage')) AS p(perm)
WHERE r.key IN ('owner', 'admin')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (workspace_id, role_id, permission)
SELECT r.workspace_id, r.id, p.perm
FROM roles r
CROSS JOIN (VALUES ('database.read'), ('database.write')) AS p(perm)
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
END
$$;

ALTER TABLE acl_entries ADD CONSTRAINT ck_acl_entries_resource_type
	CHECK (resource_type IN ('project', 'doc_page', 'teamspace', 'channel', 'mail_account', 'doc_database'));

ALTER TABLE doc_pages ADD COLUMN IF NOT EXISTS is_database_row boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_doc_pages_database_rows
	ON doc_pages (workspace_id, teamspace_id) WHERE is_database_row AND archived_at IS NULL;

-- ---------- 2. Databases ----------
CREATE TABLE doc_databases (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	teamspace_id uuid,
	parent_page_id uuid,
	title        text NOT NULL,
	icon         text,
	is_inline    boolean NOT NULL DEFAULT false,
	created_by   uuid NOT NULL REFERENCES users(id),
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	version      int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, teamspace_id)
		REFERENCES teamspaces (workspace_id, id) ON DELETE SET NULL,
	FOREIGN KEY (workspace_id, parent_page_id)
		REFERENCES doc_pages (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_doc_databases_ws_teamspace ON doc_databases (workspace_id, teamspace_id, title, id);
CREATE INDEX idx_doc_databases_parent_page ON doc_databases (workspace_id, parent_page_id) WHERE parent_page_id IS NOT NULL;
CREATE TRIGGER trg_doc_databases_updated_at
	BEFORE UPDATE ON doc_databases
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- 3. Properties ----------
CREATE TABLE doc_database_properties (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	database_id  uuid NOT NULL,
	name         text NOT NULL,
	prop_type    text NOT NULL CHECK (prop_type IN (
		'title','text','number','select','multi_select','status','date','person',
		'checkbox','url','email','phone','file','relation','rollup','formula',
		'created_time','created_by','updated_time','updated_by'
	)),
	config       jsonb NOT NULL DEFAULT '{}'::jsonb,
	position     text COLLATE "C" NOT NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	version      int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, database_id)
		REFERENCES doc_databases (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_doc_database_properties_pos
	ON doc_database_properties (workspace_id, database_id, position COLLATE "C", id);
CREATE UNIQUE INDEX uq_doc_database_one_title
	ON doc_database_properties (workspace_id, database_id) WHERE prop_type = 'title';
CREATE TRIGGER trg_doc_database_properties_updated_at
	BEFORE UPDATE ON doc_database_properties
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- 4. Rows ----------
CREATE TABLE doc_database_rows (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	database_id  uuid NOT NULL,
	page_id      uuid,
	title        text NOT NULL DEFAULT '',
	position     text COLLATE "C" NOT NULL,
	created_by   uuid NOT NULL REFERENCES users(id),
	updated_by   uuid REFERENCES users(id) ON DELETE SET NULL,
	archived_at  timestamptz,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	version      int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, database_id)
		REFERENCES doc_databases (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, page_id)
		REFERENCES doc_pages (workspace_id, id) ON DELETE SET NULL
);
CREATE INDEX idx_doc_database_rows_pos
	ON doc_database_rows (workspace_id, database_id, position COLLATE "C", id) WHERE archived_at IS NULL;
CREATE INDEX idx_doc_database_rows_page ON doc_database_rows (workspace_id, page_id) WHERE page_id IS NOT NULL;
CREATE TRIGGER trg_doc_database_rows_updated_at
	BEFORE UPDATE ON doc_database_rows
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- 5. Sparse typed cell values ----------
CREATE TABLE doc_database_cell_values (
	workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	database_id   uuid NOT NULL,
	row_id        uuid NOT NULL,
	property_id   uuid NOT NULL,
	val_text      text,
	val_number    numeric(18,6),
	val_bool      boolean,
	val_date_start timestamptz,
	val_date_end  timestamptz,
	val_json      jsonb,
	updated_at    timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, row_id, property_id),
	FOREIGN KEY (workspace_id, database_id)
		REFERENCES doc_databases (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, row_id)
		REFERENCES doc_database_rows (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, property_id)
		REFERENCES doc_database_properties (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_db_cells_prop_text ON doc_database_cell_values (workspace_id, property_id, val_text) WHERE val_text IS NOT NULL;
CREATE INDEX idx_db_cells_prop_num ON doc_database_cell_values (workspace_id, property_id, val_number) WHERE val_number IS NOT NULL;
CREATE INDEX idx_db_cells_prop_bool ON doc_database_cell_values (workspace_id, property_id, val_bool) WHERE val_bool IS NOT NULL;
CREATE INDEX idx_db_cells_prop_date ON doc_database_cell_values (workspace_id, property_id, val_date_start) WHERE val_date_start IS NOT NULL;
CREATE INDEX idx_db_cells_prop_json_scope ON doc_database_cell_values (workspace_id, property_id) WHERE val_json IS NOT NULL;
CREATE INDEX idx_db_cells_prop_json ON doc_database_cell_values USING GIN (val_json) WHERE val_json IS NOT NULL;
CREATE TRIGGER trg_doc_database_cell_values_updated_at
	BEFORE UPDATE ON doc_database_cell_values
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- 6. Views ----------
CREATE TABLE doc_database_views (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	database_id  uuid NOT NULL,
	name         text NOT NULL,
	view_type    text NOT NULL CHECK (view_type IN ('table','board','gallery','calendar','timeline','list')),
	config       jsonb NOT NULL DEFAULT '{}'::jsonb,
	position     text COLLATE "C" NOT NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	version      int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, database_id)
		REFERENCES doc_databases (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_doc_database_views_pos
	ON doc_database_views (workspace_id, database_id, position COLLATE "C", id);
CREATE TRIGGER trg_doc_database_views_updated_at
	BEFORE UPDATE ON doc_database_views
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- 7. RLS Policies ----------
ALTER TABLE doc_databases ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_databases FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_databases_tenant_isolation ON doc_databases
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE doc_database_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_database_properties FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_database_properties_tenant_isolation ON doc_database_properties
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE doc_database_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_database_rows FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_database_rows_tenant_isolation ON doc_database_rows
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE doc_database_cell_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_database_cell_values FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_database_cell_values_tenant_isolation ON doc_database_cell_values
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE doc_database_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_database_views FORCE ROW LEVEL SECURITY;
CREATE POLICY doc_database_views_tenant_isolation ON doc_database_views
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ---------- 8. Grants ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON
	doc_databases,
	doc_database_properties,
	doc_database_rows,
	doc_database_cell_values,
	doc_database_views
TO huriro_app;

GRANT SELECT ON
	doc_databases,
	doc_database_properties,
	doc_database_rows,
	doc_database_cell_values,
	doc_database_views
TO huriro_maint;
