-- 0003_system.sql — sync log, outbox, audit, idempotency, files, flags,
-- instance settings, sync cursors (§8.5–8.7, ADR-0013, §9).
--
-- Table classification for RLS (§4.2):
--   tenant tables      → workspace_id + ENABLE/FORCE RLS in 0004
--   instance tables    → users-adjacent/global state, no tenant policy
--   system tables      → internal plumbing (outbox, processed_events): accessed
--                        cross-tenant by the worker before a workspace context
--                        exists, never exposed over the API. Marked so the RLS
--                        coverage test can classify them correctly.

-- ---------- Sync: per-workspace monotonic change log (§8.5, §9.2) ----------
-- One row per workspace: the serialization point for cursor allocation.
-- Allocated LAST in the write txn via UPDATE … RETURNING — never a sequence.
CREATE TABLE workspace_seq (
	workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
	last_cursor  bigint NOT NULL DEFAULT 0
);

CREATE TABLE change_log (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	cursor       bigint NOT NULL,
	entity_type  text NOT NULL,             -- 'issue' | 'doc_page' | 'permission' | ...
	entity_id    uuid NOT NULL,
	action       text NOT NULL CHECK (action IN ('upsert', 'delete', 'reorder', 'revoke')),
	scope        text[] NOT NULL DEFAULT '{}',
	payload      jsonb,
	actor_id     uuid,
	changed_at   timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, cursor)
);
CREATE INDEX idx_change_log_entity ON change_log (workspace_id, entity_type, entity_id);

-- Clients' last-seen cursors, for change_log retention (§8.5 floor).
CREATE TABLE sync_cursors (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	client_id    text NOT NULL,
	cursor       bigint NOT NULL DEFAULT 0,
	updated_at   timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, client_id)
);
CREATE TRIGGER trg_sync_cursors_updated_at
	BEFORE UPDATE ON sync_cursors
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Outbox (system table — see header) ----------
CREATE TABLE outbox (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid,
	aggregate    text NOT NULL,
	aggregate_id uuid,
	event_type   text NOT NULL,
	payload      jsonb NOT NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	published_at timestamptz,               -- null = pending
	attempts     int NOT NULL DEFAULT 0,
	last_error   text
);
CREATE INDEX idx_outbox_pending ON outbox (created_at) WHERE published_at IS NULL;

-- ---------- Consumer idempotency (instance-level, §5.5) ----------
CREATE TABLE processed_events (
	consumer     text NOT NULL,
	event_id     uuid NOT NULL,
	processed_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (consumer, event_id)
);

-- ---------- Audit log (§12.8) ----------
-- workspace_id NULL for instance events (failed logins, setup). Append-only:
-- the app role gets INSERT + SELECT (scoped), never UPDATE/DELETE.
CREATE TABLE audit_log (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid,
	actor_type   text NOT NULL CHECK (actor_type IN ('user', 'api_key', 'agent', 'system')),
	actor_id     uuid,
	action       text NOT NULL,
	target_type  text,
	target_id    uuid,
	ip_hash      text,
	user_agent   text,
	metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_ws_time ON audit_log (workspace_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_log (actor_type, actor_id, created_at DESC);

-- ---------- Idempotency keys (§8.6) ----------
CREATE TABLE idempotency_keys (
	workspace_id  uuid NOT NULL,
	key           text NOT NULL,
	endpoint      text NOT NULL,
	request_hash  text NOT NULL,
	response_code int,
	response_body jsonb,
	status        text NOT NULL DEFAULT 'in_flight' CHECK (status IN ('in_flight', 'completed', 'failed')),
	created_at    timestamptz NOT NULL DEFAULT now(),
	expires_at    timestamptz NOT NULL,
	PRIMARY KEY (workspace_id, key)
);
CREATE INDEX idx_idempotency_expiry ON idempotency_keys (expires_at);

-- ---------- Files (§8.7) ----------
CREATE TABLE files (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	uploaded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
	storage_key  text NOT NULL,             -- opaque object key, never the raw filename
	filename     text NOT NULL,             -- sanitized for display only
	content_type text NOT NULL,             -- sniffed, not trusted from client
	byte_size    bigint NOT NULL,
	checksum     text NOT NULL,             -- sha256
	scan_status  text NOT NULL DEFAULT 'pending'
	             CHECK (scan_status IN ('pending', 'clean', 'infected', 'failed', 'unscanned')),
	is_public    boolean NOT NULL DEFAULT false,
	created_at   timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	UNIQUE (storage_key)
);

-- ---------- Feature flags (ADR-0013: in-house, server-evaluated) ----------
CREATE TABLE feature_flags (
	key         text PRIMARY KEY,
	description text NOT NULL DEFAULT '',
	enabled     boolean NOT NULL DEFAULT false,
	rollout     int NOT NULL DEFAULT 0 CHECK (rollout BETWEEN 0 AND 100),
	created_at  timestamptz NOT NULL DEFAULT now(),
	updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_feature_flags_updated_at
	BEFORE UPDATE ON feature_flags
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE feature_flag_overrides (
	flag_key   text NOT NULL REFERENCES feature_flags(key) ON DELETE CASCADE,
	scope_type text NOT NULL CHECK (scope_type IN ('workspace', 'user')),
	scope_id   uuid NOT NULL,
	enabled    boolean NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (flag_key, scope_type, scope_id)
);

-- ---------- Bootstrap provisioning (docker initdb may pre-create; §12.2) ----------
-- Holds provision-time secrets like the setup-token hash. Separate from
-- instance_settings so the initdb script and this migration never collide.
CREATE TABLE IF NOT EXISTS huriro_bootstrap (
	key   text PRIMARY KEY,
	value jsonb NOT NULL
);

-- ---------- Instance settings (setup wizard state; instance-level) ----------
CREATE TABLE instance_settings (
	key        text PRIMARY KEY,            -- 'setup_completed' | 'setup_token_hash' | ...
	value      jsonb NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_instance_settings_updated_at
	BEFORE UPDATE ON instance_settings
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
