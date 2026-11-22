-- 0010_roles_member_visibility.sql — workspace discovery needs role rows
-- before a tenant context exists (§12.3).
--
-- /workspaces/current lists "my workspaces" by joining memberships →
-- workspaces → roles with only app.user_id set. memberships already carries
-- a self-visibility branch for exactly this bootstrap need (0004), but roles
-- stayed strictly tenant-scoped — the JOIN resolved zero rows and workspace
-- discovery returned an empty list. A member seeing the roles of workspaces
-- they belong to is the same visibility memberships grants them (and what
-- member pickers/invites assume). Writes stay inside the tenant context.
--
-- Rollback note: DROP POLICY + recreate the 0004 strict-isolation USING.

DROP POLICY roles_tenant_isolation ON roles;
CREATE POLICY roles_tenant_isolation ON roles
	USING (
		workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
		OR EXISTS (
			SELECT 1
			FROM memberships mine
			WHERE mine.workspace_id = roles.workspace_id
				AND mine.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
				AND mine.status = 'active'
		)
	)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
