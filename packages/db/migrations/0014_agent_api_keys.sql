-- 0014_agent_api_keys.sql — M3 stage 4: workspace-bound agent API keys
-- (§13.1a, ADR-0021). Huriro-owned credentials (NOT the better-auth api-key
-- plugin): each key is bound to one workspace automation principal, carries a
-- scope subset, and is verified inside the tenant transaction — there is no
-- cross-tenant lookup path for `hrk_` values.
--
-- Expand-phase only: tenant RLS rules apply — workspace_id, UNIQUE
-- (workspace_id, id), composite tenant FK, ENABLE+FORCE RLS.
--
-- Rollback note: drop agent_api_keys; revoke its grants. Principals created
-- for keys remain (revoke them via the agents API if needed).

CREATE TABLE agent_api_keys (
	id             uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	agent_id       uuid NOT NULL,
	created_by     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name           text NOT NULL,
	-- First 8 chars of the public half (hrk_<prefix>_<secret>) — indexed for
	-- lookup; safe to display in list responses (the secret never leaves create).
	prefix         text NOT NULL,
	-- sha256 hex of the FULL key; compared in constant time at verify.
	secret_hash    text NOT NULL,
	scopes         text[] NOT NULL DEFAULT '{}',
	expires_at     timestamptz,
	last_used_at   timestamptz,
	revoked_at     timestamptz,
	created_at     timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, agent_id)
		REFERENCES agent_principals (workspace_id, id) ON DELETE CASCADE
);

-- Prefix is globally unique so a leaked prefix never collides across tenants.
CREATE UNIQUE INDEX uq_agent_api_keys_prefix ON agent_api_keys (prefix);
CREATE INDEX idx_agent_api_keys_ws_agent ON agent_api_keys (workspace_id, agent_id);
CREATE INDEX idx_agent_api_keys_ws_created ON agent_api_keys (workspace_id, created_at DESC);

ALTER TABLE agent_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_api_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_api_keys_tenant_isolation ON agent_api_keys
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ---------- grants (mirror 0004_security.sql) ----------
GRANT SELECT, INSERT, UPDATE ON agent_api_keys TO huriro_app; -- no DELETE: keys are revoked, not erased
REVOKE DELETE ON agent_api_keys FROM huriro_app;
