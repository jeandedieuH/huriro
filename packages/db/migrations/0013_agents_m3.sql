-- 0013_agents_m3.sql — M3 Agents: tier overrides + approval-required flags on
-- agent_principals, agent_approvals, agent_tool_calls (append-only audit),
-- agent_status_reports, agent_undo_log (§13.1a, §13.3, §13.5).
--
-- Expand-phase only. Every new table is tenant-scoped with:
--   * workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
--   * UNIQUE (workspace_id, id) on every FK-target table
--   * composite tenant FKs (workspace_id, x_id) REFERENCES x (workspace_id, id)
--   * ENABLE + FORCE ROW LEVEL SECURITY + *_tenant_isolation policy
--
-- Rollback note: drop agent_undo_log, agent_status_reports, agent_tool_calls,
-- agent_approvals; drop the partial unique index uq_agent_principals_ws_owner_client
-- and columns agent_principals.tier_overrides / require_approval_all_writes;
-- restore agent_principals.status CHECK to its 0006 form; revoke grants.

-- ---------- agent_principals extensions ----------
ALTER TABLE agent_principals
	ADD COLUMN tier_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
	ADD COLUMN require_approval_all_writes boolean NOT NULL DEFAULT false;

-- Status set stays {active, suspended, revoked} — enforce via CHECK if absent.
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
			AND rel.relname = 'agent_principals'
			AND con.contype = 'c'
			AND pg_get_constraintdef(con.oid) LIKE '%status%'
	LOOP
		EXECUTE format('ALTER TABLE public.agent_principals DROP CONSTRAINT %I', c_name);
	END LOOP;
END
$$;

ALTER TABLE agent_principals ADD CONSTRAINT ck_agent_principals_status
	CHECK (status IN ('active', 'suspended', 'revoked'));

-- Tier overrides may only RAISE a tool's base tier — the allowed values are
-- concrete tiers; the raise-only relation is enforced in the service layer
-- (admin patch validates against the tool's base tier).
ALTER TABLE agent_principals ADD CONSTRAINT ck_agent_principals_tier_overrides
	CHECK (jsonb_typeof(tier_overrides) = 'object');

-- One principal per (workspace, owner, oauth client) — partial so non-OAuth
-- principals (builtin assistant) can coexist.
CREATE UNIQUE INDEX uq_agent_principals_ws_owner_client
	ON agent_principals (workspace_id, owner_user_id, oauth_client_id)
	WHERE oauth_client_id IS NOT NULL;

-- ---------- Assignee validation tightened: only active agents assignable ----------
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
			WHERE a.workspace_id = NEW.workspace_id AND a.id = NEW.assignee_id AND a.status = 'active'
		) THEN
			RAISE EXCEPTION 'assignee agent % does not exist in workspace % or is not active', NEW.assignee_id, NEW.workspace_id
				USING ERRCODE = 'foreign_key_violation';
		END IF;
	END IF;
	RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION validate_issue_assignee() FROM PUBLIC;

-- ---------- agent_approvals (§13.5) ----------
CREATE TABLE agent_approvals (
	id              uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	agent_id        uuid NOT NULL,
	owner_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	tool            text NOT NULL,
	args            jsonb NOT NULL,
	args_hash       text NOT NULL,
	preview_md      text NOT NULL DEFAULT '',
	tier            text NOT NULL CHECK (tier IN ('R0', 'R1', 'R2', 'R3')),
	status          text NOT NULL DEFAULT 'pending'
		CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'executing', 'executed', 'failed')),
	request_id      text,
	token_id        text,
	token_scopes    text[] NOT NULL DEFAULT '{}',
	idempotency_key text,
	decided_by      uuid REFERENCES users(id),
	decided_at      timestamptz,
	decision_reason text,
	expires_at      timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
	result          jsonb,
	error_code      text,
	created_at      timestamptz NOT NULL DEFAULT now(),
	updated_at      timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, agent_id)
		REFERENCES agent_principals (workspace_id, id) ON DELETE CASCADE,
	CHECK (status <> 'pending' OR decided_by IS NULL)
);
CREATE INDEX idx_agent_approvals_ws_status ON agent_approvals (workspace_id, status, created_at DESC);
CREATE INDEX idx_agent_approvals_agent ON agent_approvals (agent_id, created_at DESC);
CREATE INDEX idx_agent_approvals_expires ON agent_approvals (expires_at) WHERE status = 'pending';
CREATE UNIQUE INDEX uq_agent_approvals_idem
	ON agent_approvals (workspace_id, idempotency_key)
	WHERE idempotency_key IS NOT NULL;

CREATE TRIGGER trg_agent_approvals_updated_at BEFORE UPDATE ON agent_approvals
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE agent_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_approvals_tenant_isolation ON agent_approvals
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ---------- agent_tool_calls — append-only call audit (§13.3) ----------
CREATE TABLE agent_tool_calls (
	id                uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	agent_id          uuid NOT NULL,
	owner_user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	oauth_client_id   text,
	token_id          text,
	tool              text NOT NULL,
	args_hash         text NOT NULL,
	requested_scopes  text[] NOT NULL DEFAULT '{}',
	effective_scopes  text[] NOT NULL DEFAULT '{}',
	requested_tier    text NOT NULL,
	effective_tier    text NOT NULL,
	status            text NOT NULL
		CHECK (status IN ('ok', 'denied', 'error', 'needs_confirmation', 'approval_required', 'rate_limited')),
	error_code        text,
	duration_ms       integer NOT NULL DEFAULT 0,
	approval_id       uuid,
	request_id        text,
	created_at        timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, agent_id)
		REFERENCES agent_principals (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, approval_id)
		REFERENCES agent_approvals (workspace_id, id) ON DELETE SET NULL
);
CREATE INDEX idx_agent_tool_calls_ws_agent ON agent_tool_calls (workspace_id, agent_id, created_at DESC);
CREATE INDEX idx_agent_tool_calls_ws_tool ON agent_tool_calls (workspace_id, tool, created_at DESC);
CREATE INDEX idx_agent_tool_calls_token ON agent_tool_calls (token_id) WHERE token_id IS NOT NULL;

ALTER TABLE agent_tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tool_calls FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_tool_calls_tenant_isolation ON agent_tool_calls
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ---------- agent_status_reports — issue timeline entries ----------
CREATE TABLE agent_status_reports (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	issue_id     uuid NOT NULL,
	agent_id     uuid NOT NULL,
	state        text NOT NULL CHECK (state IN ('working', 'needs_input', 'done', 'failed')),
	message      text NOT NULL,
	links        jsonb NOT NULL DEFAULT '[]'::jsonb,
	created_at   timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, issue_id)
		REFERENCES issues (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, agent_id)
		REFERENCES agent_principals (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_agent_status_reports_issue ON agent_status_reports (workspace_id, issue_id, created_at DESC);
CREATE INDEX idx_agent_status_reports_agent ON agent_status_reports (workspace_id, agent_id, created_at DESC);

ALTER TABLE agent_status_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_status_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_status_reports_tenant_isolation ON agent_status_reports
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ---------- agent_undo_log — R1 undo tokens (§13.5, 7-day window) ----------
CREATE TABLE agent_undo_log (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	agent_id     uuid NOT NULL,
	tool_call_id uuid NOT NULL,
	tool         text NOT NULL,
	entity_type  text NOT NULL,
	entity_id    uuid NOT NULL,
	before       jsonb,
	expires_at   timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
	undone_at    timestamptz,
	undone_by    uuid REFERENCES users(id),
	created_at   timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, agent_id)
		REFERENCES agent_principals (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, tool_call_id)
		REFERENCES agent_tool_calls (workspace_id, id) ON DELETE CASCADE,
	CHECK (undone_at IS NULL OR undone_by IS NOT NULL)
);
CREATE UNIQUE INDEX uq_agent_undo_tool_call ON agent_undo_log (workspace_id, tool_call_id);
CREATE INDEX idx_agent_undo_agent ON agent_undo_log (workspace_id, agent_id, created_at DESC);

ALTER TABLE agent_undo_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_undo_log FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_undo_log_tenant_isolation ON agent_undo_log
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ---------- grants (mirror 0004_security.sql) ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_approvals TO huriro_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_status_reports TO huriro_app;
GRANT SELECT, INSERT, UPDATE ON agent_undo_log TO huriro_app;
GRANT SELECT, INSERT ON agent_tool_calls TO huriro_app;              -- append-only forever
-- 0004's ALTER DEFAULT PRIVILEGES grants UPDATE/DELETE on every NEW table, so
-- the grant alone is not enough — strip the inherited write grants explicitly.
REVOKE UPDATE, DELETE ON agent_tool_calls FROM huriro_app;

-- ---------- notifications.kind expands for R2 approval requests ----------
ALTER TABLE notifications DROP CONSTRAINT ck_notifications_kind;
ALTER TABLE notifications ADD CONSTRAINT ck_notifications_kind
	CHECK (
		kind IN (
			'issue.assigned', 'issue.mentioned', 'issue.commented', 'issue.status_changed',
			'project.access_granted',
			'doc.mentioned', 'doc.commented', 'doc.comment_resolved', 'doc.access_granted',
			'chat.mentioned', 'chat.dm', 'chat.reply', 'chat.message', 'channel.access_granted',
			'approval.requested'
		)
	);
