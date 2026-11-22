-- 0004_security.sql — RLS everywhere, grants, the ACL read helper (§12.4–12.5).
--
-- Invariants enforced here:
--   * ENABLE + FORCE RLS on every tenant table (FORCE matters: without it the
--     owner bypasses RLS silently)
--   * app traffic runs as huriro_app (NOBYPASSRLS, not an owner)
--   * the tenant context is transaction-local: set_config('app.workspace_id',…,true)
--     inside withWorkspace(); unset → current_setting()→NULL → zero rows (fails closed)
--   * every current_setting cast goes through NULLIF(…,''): a custom GUC that
--     was set transaction-locally can read back as '' (not NULL) later in the
--     same session — ''::uuid throws instead of failing closed.
--   * append-only tables (change_log, audit_log) get no UPDATE/DELETE grant
--
-- Rollback note: DROP POLICY + DISABLE RLS per table is safe; do not drop roles
-- while grants exist.

-- ---------- The tenant-isolation policy, applied to every tenant table ----------
-- Written out per table so the RLS coverage test can grep exactly one policy
-- per table and so per-table exceptions are explicit, not hidden in a helper.

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_tenant_isolation ON roles
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_tenant_isolation ON role_permissions
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
-- A member sees their own membership rows in every workspace (needed to list
-- "my workspaces" before a tenant context exists) plus all rows in the
-- active workspace context. Writes stay inside the tenant context.
CREATE POLICY memberships_tenant_isolation ON memberships
	USING (
		workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
		OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
	)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
-- Invitees may see an invite addressed to their own email (acceptance flow);
-- everything else stays inside the tenant context.
CREATE POLICY invitations_tenant_isolation ON invitations
	USING (
		workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
		OR email = NULLIF(current_setting('app.user_email', true), '')::citext
	)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE acl_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE acl_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY acl_entries_tenant_isolation ON acl_entries
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE agent_principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_principals FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_principals_tenant_isolation ON agent_principals
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE workspace_seq ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_seq FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_seq_tenant_isolation ON workspace_seq
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_log FORCE ROW LEVEL SECURITY;
CREATE POLICY change_log_tenant_isolation ON change_log
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE sync_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_cursors FORCE ROW LEVEL SECURITY;
CREATE POLICY sync_cursors_tenant_isolation ON sync_cursors
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_tenant_isolation ON idempotency_keys
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;
CREATE POLICY files_tenant_isolation ON files
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ---------- Instance-level tables with scoped visibility ----------

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
-- The active workspace in context, or any workspace the user is a member of
-- (the "switch workspace" list). No member → no row.
CREATE POLICY workspaces_member_visibility ON workspaces
	USING (
		id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
		OR EXISTS (
			SELECT 1 FROM memberships m
			WHERE m.workspace_id = id
				AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
				AND m.status = 'active'
		)
	)
	WITH CHECK (id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
-- Creating a workspace is a bootstrap: the row's own id can't equal a tenant
-- context that doesn't exist yet, so INSERT gets its own permissive CHECK.
-- SELECT/UPDATE stay governed by member_visibility above (policies are OR'd;
-- this policy applies to INSERT only).
CREATE POLICY workspaces_insert ON workspaces
	FOR INSERT WITH CHECK (true);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
-- Self, plus users who share at least one workspace with me (rosters, pickers).
-- Signup writes arrive via the identity module; revisit when auth gets its own
-- DB role (§12.4 "auth tables live in their own schema").
CREATE POLICY users_visibility ON users
	USING (
		id = NULLIF(current_setting('app.user_id', true), '')::uuid
		OR EXISTS (
			SELECT 1
			FROM memberships mine
			JOIN memberships theirs ON theirs.workspace_id = mine.workspace_id
			WHERE mine.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
				AND theirs.user_id = users.id
		)
	)
	WITH CHECK (true);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
-- Tenant rows visible only in context; instance rows (workspace_id NULL) are
-- readable only by huriro_maint. INSERT allows both shapes — the audit writer
-- decides which events are tenant-scoped.
CREATE POLICY audit_log_tenant_isolation ON audit_log
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (
		workspace_id IS NULL
		OR workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
	);

-- ---------- can_read(): ACL mirror for list endpoints (§12.5) ----------
-- SECURITY DEFINER (the function owner may bypass RLS), so tenant isolation is
-- enforced EXPLICITLY: p_workspace_id must equal the transaction's tenant
-- context — no context, no answer (fail closed), and no cross-tenant probing.
CREATE OR REPLACE FUNCTION can_read(
	p_workspace_id uuid,
	p_resource_type text,
	p_resource_id uuid,
	p_user_id uuid,
	p_permission text DEFAULT 'read'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
	SELECT p_workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
		AND EXISTS (
		SELECT 1
		FROM acl_entries a
		WHERE a.workspace_id = p_workspace_id
			AND a.resource_type = p_resource_type
			AND a.resource_id = p_resource_id
			AND (
				a.permission = p_permission
				-- manage implies every lower level (read < comment < write < manage)
				OR (p_permission = 'read'    AND a.permission IN ('comment', 'write', 'manage'))
				OR (p_permission = 'comment' AND a.permission IN ('write', 'manage'))
				OR (p_permission = 'write'   AND a.permission = 'manage')
			)
			AND (
				(a.principal_type = 'user' AND a.principal_id = p_user_id)
				OR a.principal_type = 'workspace'
				OR (
					a.principal_type = 'role'
					AND a.principal_id = (
						SELECT m.role_id
						FROM memberships m
						WHERE m.workspace_id = p_workspace_id
							AND m.user_id = p_user_id
							AND m.status = 'active'
					)
				)
			)
	);
$$;

-- ---------- Grants ----------
-- Public has nothing; every grant below is explicit.

REVOKE ALL ON FUNCTION set_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION can_read(uuid, text, uuid, uuid, text) FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO huriro_app;
GRANT USAGE ON SCHEMA public TO huriro_maint;

-- Instance tables
GRANT SELECT, INSERT, UPDATE ON users TO huriro_app;                    -- no DELETE (soft delete only)
GRANT SELECT, INSERT, UPDATE ON workspaces TO huriro_app;               -- no DELETE (soft delete only)
GRANT SELECT, INSERT, UPDATE, DELETE ON feature_flags TO huriro_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON feature_flag_overrides TO huriro_app;
GRANT SELECT, INSERT, UPDATE ON instance_settings TO huriro_app;
GRANT SELECT, UPDATE ON huriro_bootstrap TO huriro_app;                 -- read + burn the setup token
GRANT SELECT ON schema_migrations TO huriro_app;                        -- /ready reports pending count

-- Tenant tables
GRANT SELECT, INSERT, UPDATE, DELETE ON roles TO huriro_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON role_permissions TO huriro_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON memberships TO huriro_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON invitations TO huriro_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON acl_entries TO huriro_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_principals TO huriro_app;
GRANT SELECT, INSERT, UPDATE ON workspace_seq TO huriro_app;            -- cursor bump needs UPDATE
GRANT SELECT, INSERT ON change_log TO huriro_app;                       -- append-only; pruning is huriro_maint's
GRANT SELECT, INSERT, UPDATE, DELETE ON sync_cursors TO huriro_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO huriro_app;
GRANT SELECT, INSERT, UPDATE ON files TO huriro_app;

-- System tables (cross-tenant by design — see 0003 header)
GRANT SELECT, INSERT, UPDATE ON outbox TO huriro_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON processed_events TO huriro_app;
GRANT SELECT, INSERT ON audit_log TO huriro_app;                        -- append-only forever

GRANT EXECUTE ON FUNCTION can_read(uuid, text, uuid, uuid, text) TO huriro_app;

-- huriro_maint: BYPASSRLS role for audited maintenance jobs only (no ingress).
GRANT SELECT ON ALL TABLES IN SCHEMA public TO huriro_maint;
GRANT DELETE ON change_log TO huriro_maint;                             -- retention pruning
GRANT DELETE ON outbox TO huriro_maint;
GRANT DELETE ON idempotency_keys TO huriro_maint;                       -- expired keys

-- Future tables created by the migration role inherit sane defaults:
ALTER DEFAULT PRIVILEGES IN SCHEMA public
	GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO huriro_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
	GRANT SELECT ON TABLES TO huriro_maint;
