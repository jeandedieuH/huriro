-- 0011_chat_integrations_m4.sql — M4 Chat, Attachments Quarantine,
-- Notification Preferences & Delivery, Web Push, Slack/Jira Importers,
-- Outbound Webhooks, and GitHub App Two-Way Sync
-- (§8.7, §12.6, §15.1–15.2, §16.5–16.6, §17.13b).
--
-- Expand-phase only. Every tenant table has:
--   * workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
--   * UNIQUE (workspace_id, id) on FK targets
--   * composite tenant FKs (workspace_id, x_id) REFERENCES x (workspace_id, id)
--   * COLLATE "C" on fractional-index position columns (§8.1)
--   * ENABLE + FORCE ROW LEVEL SECURITY + *_tenant_isolation policy
--
-- Rollback note: drop tables in reverse dependency order (github_webhook_events ...
-- chat_channels), drop update_chat_thread_stats() and SECURITY DEFINER helpers
-- (resolve_github_installation_route, list_active_workspaces_for_worker,
-- list_email_digest_candidates_for_workspace), drop added files columns, and
-- restore prior CHECK constraints on notifications, import_jobs, import_mappings.

-- ---------- 1. Expand files for two-phase quarantine (§8.7, §12.6) ----------
ALTER TABLE files
	ADD COLUMN IF NOT EXISTS quarantine_key text,
	ADD COLUMN IF NOT EXISTS declared_content_type text,
	ADD COLUMN IF NOT EXISTS scan_detail text,
	ADD COLUMN IF NOT EXISTS scanned_at timestamptz,
	ADD COLUMN IF NOT EXISTS promoted_at timestamptz,
	ADD COLUMN IF NOT EXISTS reencoded boolean NOT NULL DEFAULT false;

-- ---------- 2. Expand notifications.kind for M4 chat events ----------
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
			'doc.access_granted',
			'chat.mentioned',
			'chat.dm',
			'chat.reply',
			'chat.message',
			'channel.access_granted'
		)
	);

-- ---------- 3. Expand import_jobs & import_mappings for Slack & Jira ----------
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
	CHECK (source IN ('linear', 'github', 'notion', 'markdown', 'slack', 'jira'));

ALTER TABLE import_mappings ADD CONSTRAINT ck_import_mappings_source
	CHECK (source IN ('linear', 'github', 'notion', 'markdown', 'slack', 'jira'));

ALTER TABLE import_mappings ADD CONSTRAINT ck_import_mappings_remote_type
	CHECK (
		remote_type IN (
			'project',
			'issue',
			'comment',
			'label',
			'cycle',
			'status',
			'doc_page',
			'channel',
			'message'
		)
	);

-- ---------- 4. Chat (§15.1) ----------
CREATE TABLE chat_channels (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	kind         text NOT NULL DEFAULT 'public' CHECK (kind IN ('public', 'private', 'dm')),
	name         text,
	topic        text NOT NULL DEFAULT '',
	dm_key       text,
	last_msg_seq bigint NOT NULL DEFAULT 0,
	last_rev     bigint NOT NULL DEFAULT 0,
	created_by   uuid NOT NULL REFERENCES users(id),
	archived_at  timestamptz,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	version      int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, name)
);
CREATE UNIQUE INDEX uq_chat_channels_dm_key ON chat_channels (workspace_id, dm_key)
	WHERE dm_key IS NOT NULL AND archived_at IS NULL;
CREATE TRIGGER trg_chat_channels_updated_at
	BEFORE UPDATE ON chat_channels
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Join/membership table (exempt from updated_at/version per §4.2).
CREATE TABLE chat_channel_members (
	workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	channel_id     uuid NOT NULL,
	principal_type text NOT NULL DEFAULT 'user' CHECK (principal_type IN ('user', 'agent')),
	principal_id   uuid NOT NULL,
	role           text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
	position       text COLLATE "C",
	joined_at      timestamptz NOT NULL DEFAULT now(),
	created_at     timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, channel_id, principal_type, principal_id),
	FOREIGN KEY (workspace_id, channel_id) REFERENCES chat_channels (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_chat_channel_members_principal
	ON chat_channel_members (workspace_id, principal_type, principal_id);

CREATE TABLE chat_messages (
	id              uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	channel_id      uuid NOT NULL,
	channel_seq     bigint,
	thread_seq      bigint,
	rev             bigint NOT NULL,
	author_type     text NOT NULL DEFAULT 'user' CHECK (author_type IN ('user', 'agent')),
	author_id       uuid NOT NULL,
	thread_parent_id uuid,
	last_thread_seq bigint NOT NULL DEFAULT 0,
	reply_count     int NOT NULL DEFAULT 0,
	last_reply_at   timestamptz,
	client_id       text,
	body            jsonb NOT NULL DEFAULT '{}'::jsonb,
	body_text       text NOT NULL,
	edited_at       timestamptz,
	deleted_at      timestamptz,
	created_at      timestamptz NOT NULL DEFAULT now(),
	updated_at      timestamptz NOT NULL DEFAULT now(),
	version         int NOT NULL DEFAULT 1,
	CHECK ((thread_parent_id IS NULL) = (channel_seq IS NOT NULL)),
	CHECK ((thread_parent_id IS NOT NULL) = (thread_seq IS NOT NULL)),
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, channel_id, channel_seq),
	UNIQUE (workspace_id, thread_parent_id, thread_seq),
	FOREIGN KEY (workspace_id, channel_id) REFERENCES chat_channels (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, thread_parent_id) REFERENCES chat_messages (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_messages_chan_seq ON chat_messages (workspace_id, channel_id, channel_seq DESC)
	WHERE deleted_at IS NULL AND thread_parent_id IS NULL;
CREATE INDEX idx_messages_chan_rev ON chat_messages (workspace_id, channel_id, rev);
CREATE INDEX idx_messages_thread_seq ON chat_messages (workspace_id, thread_parent_id, thread_seq ASC)
	WHERE thread_parent_id IS NOT NULL;
CREATE UNIQUE INDEX uq_messages_client ON chat_messages (workspace_id, channel_id, author_id, client_id)
	WHERE client_id IS NOT NULL;
CREATE TRIGGER trg_chat_messages_updated_at
	BEFORE UPDATE ON chat_messages
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Maintain parent reply_count & last_reply_at via trigger (§15.1).
CREATE OR REPLACE FUNCTION update_chat_thread_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	v_ws_id uuid;
	v_parent_id uuid;
BEGIN
	IF TG_OP = 'DELETE' THEN
		v_ws_id := OLD.workspace_id;
		v_parent_id := OLD.thread_parent_id;
	ELSE
		v_ws_id := NEW.workspace_id;
		v_parent_id := NEW.thread_parent_id;
	END IF;

	IF v_parent_id IS NULL THEN
		RETURN NULL;
	END IF;

	UPDATE chat_messages parent
	SET
		reply_count = (
			SELECT count(*)::int
			FROM chat_messages c
			WHERE c.workspace_id = v_ws_id
				AND c.thread_parent_id = v_parent_id
				AND c.deleted_at IS NULL
		),
		last_reply_at = (
			SELECT max(c.created_at)
			FROM chat_messages c
			WHERE c.workspace_id = v_ws_id
				AND c.thread_parent_id = v_parent_id
				AND c.deleted_at IS NULL
		)
	WHERE parent.workspace_id = v_ws_id
		AND parent.id = v_parent_id;

	RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION update_chat_thread_stats() FROM PUBLIC;

CREATE TRIGGER trg_chat_messages_thread_stats
	AFTER INSERT OR UPDATE OF deleted_at OR DELETE ON chat_messages
	FOR EACH ROW EXECUTE FUNCTION update_chat_thread_stats();

-- Pure join table (exempt from updated_at/version per §4.2).
CREATE TABLE chat_message_reactions (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	message_id   uuid NOT NULL,
	user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	emoji        text NOT NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, message_id, user_id, emoji),
	FOREIGN KEY (workspace_id, message_id) REFERENCES chat_messages (workspace_id, id) ON DELETE CASCADE
);

-- Read cursor state per user/channel (uses last_read_seq, exempt from version).
CREATE TABLE chat_read_state (
	workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	channel_id    uuid NOT NULL,
	user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	last_read_seq bigint NOT NULL DEFAULT 0,
	mention_count int NOT NULL DEFAULT 0 CHECK (mention_count >= 0),
	muted         boolean NOT NULL DEFAULT false,
	created_at    timestamptz NOT NULL DEFAULT now(),
	updated_at    timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, channel_id, user_id),
	FOREIGN KEY (workspace_id, channel_id) REFERENCES chat_channels (workspace_id, id) ON DELETE CASCADE
);
CREATE TRIGGER trg_chat_read_state_updated_at
	BEFORE UPDATE ON chat_read_state
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Thread follow/read cursor state (§15.1).
CREATE TABLE chat_thread_read_state (
	workspace_id         uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	channel_id           uuid NOT NULL,
	thread_parent_id     uuid NOT NULL,
	user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	last_read_thread_seq bigint NOT NULL DEFAULT 0,
	subscribed           boolean NOT NULL DEFAULT true,
	created_at           timestamptz NOT NULL DEFAULT now(),
	updated_at           timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, thread_parent_id, user_id),
	FOREIGN KEY (workspace_id, channel_id) REFERENCES chat_channels (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, thread_parent_id) REFERENCES chat_messages (workspace_id, id) ON DELETE CASCADE
);
CREATE TRIGGER trg_chat_thread_read_state_updated_at
	BEFORE UPDATE ON chat_thread_read_state
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Pure join table linking quarantined files to chat messages (§15.1).
CREATE TABLE chat_message_attachments (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	message_id   uuid NOT NULL,
	file_id      uuid NOT NULL,
	position     int NOT NULL DEFAULT 0,
	created_at   timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, message_id, file_id),
	FOREIGN KEY (workspace_id, message_id) REFERENCES chat_messages (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, file_id) REFERENCES files (workspace_id, id) ON DELETE CASCADE
);

-- Link preview cache (workspace-scoped, TTL-cached; exempt from version).
CREATE TABLE chat_link_previews (
	id            uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	url           text NOT NULL,
	url_hash      text NOT NULL,
	canonical_url text,
	title         text NOT NULL DEFAULT '',
	description   text NOT NULL DEFAULT '',
	site_name     text NOT NULL DEFAULT '',
	image_url     text,
	status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'blocked', 'failed')),
	error_detail  text,
	fetched_at    timestamptz,
	expires_at    timestamptz,
	created_at    timestamptz NOT NULL DEFAULT now(),
	updated_at    timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, url_hash)
);
CREATE TRIGGER trg_chat_link_previews_updated_at
	BEFORE UPDATE ON chat_link_previews
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Pure join table between chat messages and link previews.
CREATE TABLE chat_message_link_previews (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	message_id   uuid NOT NULL,
	preview_id   uuid NOT NULL,
	position     int NOT NULL DEFAULT 0,
	created_at   timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, message_id, preview_id),
	FOREIGN KEY (workspace_id, message_id) REFERENCES chat_messages (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, preview_id) REFERENCES chat_link_previews (workspace_id, id) ON DELETE CASCADE
);

-- ---------- 5. Notification preferences, delivery log & Web Push (§15.2) ----------
CREATE TABLE notification_preferences (
	workspace_id           uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	user_id                uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	chat_level             text NOT NULL DEFAULT 'mentions' CHECK (chat_level IN ('all', 'mentions', 'none')),
	email_digest_frequency text NOT NULL DEFAULT 'off' CHECK (email_digest_frequency IN ('off', 'hourly', 'daily')),
	quiet_hours_start      text,
	quiet_hours_end        text,
	timezone               text NOT NULL DEFAULT 'UTC',
	web_push_enabled       boolean NOT NULL DEFAULT false,
	last_digest_sent_at    timestamptz,
	created_at             timestamptz NOT NULL DEFAULT now(),
	updated_at             timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, user_id)
);
CREATE TRIGGER trg_notification_preferences_updated_at
	BEFORE UPDATE ON notification_preferences
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Append-only notification delivery log (exempt from updated_at/version per §4.2).
CREATE TABLE notification_delivery_log (
	id              uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	notification_id uuid,
	user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	channel         text NOT NULL CHECK (channel IN ('in_app', 'email_digest', 'web_push')),
	status          text NOT NULL CHECK (status IN ('pending', 'sent', 'skipped_quiet_hours', 'failed')),
	dedupe_key      text,
	detail          text,
	created_at      timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, notification_id) REFERENCES notifications (workspace_id, id) ON DELETE SET NULL
);
CREATE INDEX idx_notif_delivery_log_ws_user ON notification_delivery_log (workspace_id, user_id, created_at DESC);

CREATE TABLE web_push_subscriptions (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	endpoint     text NOT NULL,
	p256dh       text NOT NULL,
	auth_secret  text NOT NULL,
	user_agent   text NOT NULL DEFAULT '',
	last_used_at timestamptz,
	revoked_at   timestamptz,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, user_id, endpoint)
);
CREATE TRIGGER trg_web_push_subscriptions_updated_at
	BEFORE UPDATE ON web_push_subscriptions
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- 6. Outbound Webhooks (§16.5) ----------
CREATE TABLE webhook_endpoints (
	id               uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	name             text NOT NULL,
	url              text NOT NULL,
	secret_encrypted text NOT NULL,
	secret_prefix    text NOT NULL,
	events           text[] NOT NULL DEFAULT '{}',
	enabled          boolean NOT NULL DEFAULT true,
	created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at       timestamptz NOT NULL DEFAULT now(),
	updated_at       timestamptz NOT NULL DEFAULT now(),
	version          int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id)
);
CREATE TRIGGER trg_webhook_endpoints_updated_at
	BEFORE UPDATE ON webhook_endpoints
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE webhook_deliveries (
	id                 uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id       uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	endpoint_id        uuid NOT NULL,
	event_id           uuid,
	event_type         text NOT NULL,
	payload            jsonb NOT NULL,
	status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'retrying', 'failed')),
	attempts           int NOT NULL DEFAULT 0,
	max_attempts       int NOT NULL DEFAULT 8,
	next_attempt_at    timestamptz NOT NULL DEFAULT now(),
	last_status_code   int,
	last_response_body text,
	last_error         text,
	delivered_at       timestamptz,
	created_at         timestamptz NOT NULL DEFAULT now(),
	updated_at         timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, endpoint_id) REFERENCES webhook_endpoints (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_webhook_deliveries_due ON webhook_deliveries (status, next_attempt_at)
	WHERE status IN ('pending', 'retrying');
CREATE INDEX idx_webhook_deliveries_ep ON webhook_deliveries (workspace_id, endpoint_id, created_at DESC);
CREATE TRIGGER trg_webhook_deliveries_updated_at
	BEFORE UPDATE ON webhook_deliveries
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- 7. GitHub App Two-Way Sync (§16.6) ----------
CREATE TABLE github_installations (
	id                       uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id             uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	installation_id          bigint NOT NULL,
	account_login            text NOT NULL,
	repo_full_name           text NOT NULL,
	project_id               uuid NOT NULL,
	webhook_secret_encrypted text NOT NULL,
	access_token_encrypted   text,
	sync_enabled             boolean NOT NULL DEFAULT true,
	last_synced_at           timestamptz,
	created_by               uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at               timestamptz NOT NULL DEFAULT now(),
	updated_at               timestamptz NOT NULL DEFAULT now(),
	version                  int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, repo_full_name),
	FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE CASCADE
);
CREATE TRIGGER trg_github_installations_updated_at
	BEFORE UPDATE ON github_installations
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE issue_github_links (
	id                  uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	issue_id            uuid NOT NULL,
	installation_id     uuid NOT NULL,
	repo_full_name      text NOT NULL,
	github_issue_number int NOT NULL,
	github_issue_id     bigint NOT NULL,
	github_node_id      text,
	github_url          text NOT NULL,
	source_of_truth     text NOT NULL DEFAULT 'bidirectional' CHECK (source_of_truth IN ('huriro', 'github', 'bidirectional')),
	last_synced_at      timestamptz,
	last_sync_hash      text,
	sync_state          text NOT NULL DEFAULT 'synced' CHECK (sync_state IN ('synced', 'pending_push', 'push_failed')),
	last_sync_error     text,
	created_at          timestamptz NOT NULL DEFAULT now(),
	updated_at          timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, repo_full_name, github_issue_number),
	UNIQUE (workspace_id, issue_id, repo_full_name),
	FOREIGN KEY (workspace_id, issue_id) REFERENCES issues (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, installation_id) REFERENCES github_installations (workspace_id, id) ON DELETE CASCADE
);
CREATE TRIGGER trg_issue_github_links_updated_at
	BEFORE UPDATE ON issue_github_links
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- System table: inbound GitHub webhook deliveries arrive pre-tenant (§16.6).
CREATE TABLE github_webhook_events (
	id              uuid PRIMARY KEY DEFAULT uuidv7(),
	delivery_id     text NOT NULL UNIQUE,
	installation_id bigint,
	repo_full_name  text,
	event_name      text NOT NULL,
	payload         jsonb NOT NULL,
	status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'ignored', 'failed')),
	error_detail    text,
	received_at     timestamptz NOT NULL DEFAULT now(),
	processed_at    timestamptz
);
CREATE INDEX idx_github_webhook_events_pending ON github_webhook_events (received_at)
	WHERE status = 'pending';

-- ---------- 8. RLS policies (ENABLE + FORCE on every new tenant table) ----------
ALTER TABLE chat_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_channels FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_channels_tenant_isolation ON chat_channels
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE chat_channel_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_channel_members FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_channel_members_tenant_isolation ON chat_channel_members
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_messages_tenant_isolation ON chat_messages
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE chat_message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_message_reactions FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_message_reactions_tenant_isolation ON chat_message_reactions
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE chat_read_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_read_state FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_read_state_tenant_isolation ON chat_read_state
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE chat_thread_read_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_thread_read_state FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_thread_read_state_tenant_isolation ON chat_thread_read_state
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE chat_message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_message_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_message_attachments_tenant_isolation ON chat_message_attachments
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE chat_link_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_link_previews FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_link_previews_tenant_isolation ON chat_link_previews
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE chat_message_link_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_message_link_previews FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_message_link_previews_tenant_isolation ON chat_message_link_previews
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_preferences_tenant_isolation ON notification_preferences
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE notification_delivery_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_delivery_log FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_delivery_log_tenant_isolation ON notification_delivery_log
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE web_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_push_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY web_push_subscriptions_tenant_isolation ON web_push_subscriptions
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_endpoints_tenant_isolation ON webhook_endpoints
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_deliveries_tenant_isolation ON webhook_deliveries
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE github_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE github_installations FORCE ROW LEVEL SECURITY;
CREATE POLICY github_installations_tenant_isolation ON github_installations
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE issue_github_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_github_links FORCE ROW LEVEL SECURITY;
CREATE POLICY issue_github_links_tenant_isolation ON issue_github_links
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- Pre-tenant GitHub webhook routing helper (§12.4, §16.6): exact match on
-- repo_full_name / installation_id returns only routing + encrypted secret metadata
-- before a workspace session exists, preserving FORCE RLS on github_installations.
CREATE OR REPLACE FUNCTION resolve_github_installation_route(
	p_repo_full_name text,
	p_installation_id bigint DEFAULT NULL
)
RETURNS TABLE (
	id uuid,
	workspace_id uuid,
	webhook_secret_encrypted text,
	sync_enabled boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
	SELECT
		gi.id,
		gi.workspace_id,
		gi.webhook_secret_encrypted,
		gi.sync_enabled
	FROM public.github_installations gi
	WHERE lower(gi.repo_full_name) = lower(p_repo_full_name)
		AND (p_installation_id IS NULL OR gi.installation_id = p_installation_id);
$$;
REVOKE ALL ON FUNCTION resolve_github_installation_route(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_github_installation_route(text, bigint) TO huriro_app;

-- Worker tenant discovery helper (§12.4): lets background cron workers
-- enumerate active workspaces before calling `withWorkspace(...)` under FORCE RLS.
CREATE OR REPLACE FUNCTION list_active_workspaces_for_worker()
RETURNS TABLE (
	id uuid,
	name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
	SELECT w.id, w.name
	FROM public.workspaces w
	WHERE w.deleted_at IS NULL;
$$;
REVOKE ALL ON FUNCTION list_active_workspaces_for_worker() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_active_workspaces_for_worker() TO huriro_app;

-- Worker email digest lookup helper (§12.4, §15.2): returns active members
-- due for an hourly/daily digest in the current tenant context without
-- requiring an interactive user session for `users_visibility` RLS.
CREATE OR REPLACE FUNCTION list_email_digest_candidates_for_workspace(p_workspace_id uuid)
RETURNS TABLE (
	user_id uuid,
	email text,
	display_name text,
	email_digest_frequency text,
	quiet_hours_start text,
	quiet_hours_end text,
	timezone text,
	last_digest_sent_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
	SELECT
		np.user_id,
		u.email::text,
		u.display_name,
		np.email_digest_frequency,
		np.quiet_hours_start,
		np.quiet_hours_end,
		np.timezone,
		np.last_digest_sent_at
	FROM public.notification_preferences np
	JOIN public.memberships m
		ON m.workspace_id = np.workspace_id
		AND m.user_id = np.user_id
		AND m.status = 'active'
	JOIN public.users u
		ON u.id = np.user_id
		AND u.deleted_at IS NULL
	WHERE p_workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
		AND np.workspace_id = p_workspace_id
		AND np.email_digest_frequency IN ('hourly', 'daily')
		AND (
			np.last_digest_sent_at IS NULL
			OR (np.email_digest_frequency = 'hourly' AND np.last_digest_sent_at <= now() - interval '1 hour')
			OR (np.email_digest_frequency = 'daily' AND np.last_digest_sent_at <= now() - interval '24 hours')
		);
$$;
REVOKE ALL ON FUNCTION list_email_digest_candidates_for_workspace(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_email_digest_candidates_for_workspace(uuid) TO huriro_app;

-- ---------- 9. Grants ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON
	chat_channels,
	chat_channel_members,
	chat_messages,
	chat_message_reactions,
	chat_read_state,
	chat_thread_read_state,
	chat_message_attachments,
	chat_link_previews,
	chat_message_link_previews,
	notification_preferences,
	web_push_subscriptions,
	webhook_endpoints,
	webhook_deliveries,
	github_installations,
	issue_github_links
TO huriro_app;

GRANT SELECT, INSERT ON notification_delivery_log TO huriro_app;
GRANT SELECT, INSERT, UPDATE ON github_webhook_events TO huriro_app;

GRANT SELECT ON
	chat_channels,
	chat_channel_members,
	chat_messages,
	chat_message_reactions,
	chat_read_state,
	chat_thread_read_state,
	chat_message_attachments,
	chat_link_previews,
	chat_message_link_previews,
	notification_preferences,
	notification_delivery_log,
	web_push_subscriptions,
	webhook_endpoints,
	webhook_deliveries,
	github_installations,
	issue_github_links,
	github_webhook_events
TO huriro_maint;

GRANT DELETE ON
	notification_delivery_log,
	webhook_deliveries,
	github_webhook_events
TO huriro_maint;
