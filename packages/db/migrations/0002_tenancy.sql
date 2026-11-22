-- 0002_tenancy.sql — users, workspaces, roles-as-data, memberships,
-- invitations, resource ACLs, agent principals (§8.2–8.3, §12.3).
--
-- Conventions (§8.1): uuidv7 PKs; every tenant table carries workspace_id with
-- UNIQUE (workspace_id, id) on FK targets and composite tenant FKs; updated_at
-- by trigger; version on mutable aggregate roots.
--
-- Rollback note: drop in reverse order (acl_entries … users). Expand-phase:
-- new columns are nullable or defaulted; nothing here contracts.

-- ---------- Identity (instance-level — NOT tenant-scoped) ----------
-- Better Auth owns this table from the auth increment (§8.3: the `user` table
-- in schema `auth` is this same table via additionalFields). Until then the
-- identity module is the only writer; the API role gets a narrow column set.
CREATE TABLE users (
	id            uuid PRIMARY KEY DEFAULT uuidv7(),
	email         citext UNIQUE NOT NULL,
	display_name  text NOT NULL,
	avatar_url    text,
	locale        text NOT NULL DEFAULT 'en',
	timezone      text NOT NULL DEFAULT 'UTC',
	mfa_enabled   boolean NOT NULL DEFAULT false,
	created_at    timestamptz NOT NULL DEFAULT now(),
	updated_at    timestamptz NOT NULL DEFAULT now(),
	deleted_at    timestamptz
);
CREATE TRIGGER trg_users_updated_at
	BEFORE UPDATE ON users
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Tenancy root ----------
-- Instance-level table (no workspace_id — it IS the tenant key).
-- RLS policy added in 0004: a member sees workspaces they belong to.
CREATE TABLE workspaces (
	id         uuid PRIMARY KEY DEFAULT uuidv7(),
	slug       citext UNIQUE NOT NULL,
	name       text NOT NULL,
	plan       text NOT NULL DEFAULT 'free',
	settings   jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	deleted_at timestamptz
);

-- ---------- Roles are DATA (§12.3, ADR-0007) ----------
CREATE TABLE roles (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	key          text NOT NULL,             -- 'owner' | 'admin' | 'member' | 'guest' | custom
	name         text NOT NULL,
	is_system    boolean NOT NULL DEFAULT false,
	rank         int NOT NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, key),
	UNIQUE (workspace_id, id)                -- composite FK target (§8.1)
);

CREATE TABLE role_permissions (
	workspace_id uuid NOT NULL,
	role_id      uuid NOT NULL,
	permission   text NOT NULL,             -- matches packages/domain Action catalog
	PRIMARY KEY (role_id, permission),
	FOREIGN KEY (workspace_id, role_id) REFERENCES roles (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE memberships (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	role_id      uuid NOT NULL,
	status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
	joined_at    timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, user_id),
	FOREIGN KEY (workspace_id, role_id) REFERENCES roles (workspace_id, id)
);
CREATE INDEX idx_memberships_user ON memberships (user_id);

CREATE TABLE invitations (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	email        citext NOT NULL,
	role_id      uuid NOT NULL,
	token_hash   text NOT NULL,             -- sha256 of the invite token; the token is shown once
	invited_by   uuid REFERENCES users(id) ON DELETE SET NULL,
	status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
	expires_at   timestamptz NOT NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	accepted_at  timestamptz,
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, role_id) REFERENCES roles (workspace_id, id)
);
-- At most one *pending* invite per email per workspace; re-invites after
-- accept/revoke are normal.
CREATE UNIQUE INDEX uq_invitations_pending ON invitations (workspace_id, email)
	WHERE status = 'pending';

-- ---------- Resource ACLs (§8.3, ADR-0007) ----------
-- principal_id is NULL for principal_type='workspace' (grant to everyone);
-- dedup uses a COALESCE unique index so NULLs still can't double-grant.
CREATE TABLE acl_entries (
	id            uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	resource_type text NOT NULL CHECK (resource_type IN ('project', 'doc_page', 'channel', 'mail_account')),
	resource_id   uuid NOT NULL,
	principal_type text NOT NULL CHECK (principal_type IN ('user', 'role', 'workspace')),
	principal_id  uuid,                     -- null only when principal_type = 'workspace'
	permission    text NOT NULL CHECK (permission IN ('read', 'comment', 'write', 'manage')),
	granted_by    uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at    timestamptz NOT NULL DEFAULT now(),
	CHECK (principal_type <> 'workspace' OR principal_id IS NULL),
	CHECK (principal_type = 'workspace' OR principal_id IS NOT NULL),
	UNIQUE (workspace_id, id)              -- composite FK target convention (§8.1)
);
CREATE UNIQUE INDEX uq_acl_entries ON acl_entries
	(workspace_id, resource_type, resource_id, principal_type,
	 COALESCE(principal_id, '00000000-0000-7000-8000-000000000000'::uuid), permission);
CREATE INDEX idx_acl_lookup ON acl_entries (workspace_id, resource_type, resource_id);
CREATE INDEX idx_acl_principal ON acl_entries (workspace_id, principal_type, principal_id);

-- ---------- Agent principals (§8.3, §13.1a) ----------
-- Agents are principals, not users-with-a-flag: owner accountable, scope
-- ceiling, revocable. assignee_type/assignee_id polymorphism lands with issues.
CREATE TABLE agent_principals (
	id             uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	kind           text NOT NULL CHECK (kind IN ('external_mcp', 'builtin_assistant', 'automation')),
	name           text NOT NULL,
	owner_user_id  uuid NOT NULL REFERENCES users(id),
	oauth_client_id text,
	scope_ceiling  text[] NOT NULL DEFAULT '{}',
	status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
	last_active_at timestamptz,
	created_at     timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id)
);
