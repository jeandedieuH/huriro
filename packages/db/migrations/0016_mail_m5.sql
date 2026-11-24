-- 0016_mail_m5.sql — M5 Shared Inbox: mail accounts & identities, inboxes,
-- conversations/messages/drafts/timeline events, internal notes, task/doc
-- links, and the outbound (undo-send) queue (§14.1–14.7, §23 M5).
--
-- Expand-phase only. Every tenant table has:
--   * workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
--   * UNIQUE (workspace_id, id) on FK targets
--   * composite tenant FKs (workspace_id, x_id) REFERENCES x (workspace_id, id)
--   * ENABLE + FORCE ROW LEVEL SECURITY + *_tenant_isolation policy
--
-- Rollback note: drop tables in reverse dependency order
-- (mail_message_attachments → mail_drafts → mail_conversation_docs →
-- mail_conversation_tasks → mail_conversation_comments →
-- mail_conversation_events → mail_messages → mail_conversations →
-- mail_identities → mail_accounts → mail_inboxes), drop
-- resolve_mail_inbound_route + list_mail_accounts_for_sync, and restore the
-- pre-existing CHECK on notifications.kind.

-- ---------- 1. Inbox grouping & connected accounts (§14.2–14.3) ----------
CREATE TABLE mail_inboxes (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	name         text NOT NULL,
	position     text COLLATE "C" NOT NULL,
	settings     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { defaultAssigneeId, retentionDays, undoSendSeconds }
	created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	version      int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, name)
);
CREATE TRIGGER trg_mail_inboxes_updated_at
	BEFORE UPDATE ON mail_inboxes
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE mail_accounts (
	id                    uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id          uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	provider              text NOT NULL CHECK (provider IN ('inbound_parse', 'gmail', 'graph', 'imap', 'jmap')),
	address               citext NOT NULL,
	display_name          text,
	credentials_encrypted text,                        -- envelope-encrypted JSON creds (§12.6)
	config                jsonb NOT NULL DEFAULT '{}'::jsonb, -- provider config + inbound token hash + domain verification state
	sync_state            jsonb NOT NULL DEFAULT '{}'::jsonb, -- imap uidvalidity/uidnext, gmail historyId, graph delta token
	default_inbox_id      uuid,
	status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_verification', 'error', 'disconnected')),
	status_detail         text,
	last_synced_at        timestamptz,
	created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at            timestamptz NOT NULL DEFAULT now(),
	updated_at            timestamptz NOT NULL DEFAULT now(),
	version               int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, address),
	FOREIGN KEY (workspace_id, default_inbox_id) REFERENCES mail_inboxes (workspace_id, id) ON DELETE SET NULL
);
CREATE TRIGGER trg_mail_accounts_updated_at
	BEFORE UPDATE ON mail_accounts
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Teammate sending identities: address + signature a member may send as (§14.5).
CREATE TABLE mail_identities (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	account_id   uuid NOT NULL,
	address      citext NOT NULL,
	display_name text,
	signature    jsonb NOT NULL DEFAULT '{}'::jsonb,   -- rich-text signature appended to replies
	is_default   boolean NOT NULL DEFAULT false,
	created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	version      int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, account_id, address, display_name),
	FOREIGN KEY (workspace_id, account_id) REFERENCES mail_accounts (workspace_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uq_mail_identities_default
	ON mail_identities (workspace_id, account_id) WHERE is_default;
CREATE TRIGGER trg_mail_identities_updated_at
	BEFORE UPDATE ON mail_identities
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- 2. Conversations & messages (§14.3–14.4) ----------
CREATE TABLE mail_conversations (
	id              uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	inbox_id        uuid NOT NULL,
	account_id      uuid NOT NULL,                     -- account that owns the thread
	subject         text NOT NULL,
	normalized_subject text NOT NULL,                  -- threading key (§14.4)
	status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'snoozed', 'closed', 'spam')),
	assignee_id     uuid REFERENCES users(id) ON DELETE SET NULL,
	snoozed_until   timestamptz,
	merged_into_id  uuid,
	last_message_at timestamptz NOT NULL,
	first_reply_at  timestamptz,                       -- response-time metrics
	customer_email  citext,                            -- primary external party (list view)
	created_at      timestamptz NOT NULL DEFAULT now(),
	updated_at      timestamptz NOT NULL DEFAULT now(),
	version         int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, inbox_id) REFERENCES mail_inboxes (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, account_id) REFERENCES mail_accounts (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, merged_into_id) REFERENCES mail_conversations (workspace_id, id) ON DELETE SET NULL
);
CREATE INDEX idx_conv_inbox ON mail_conversations (workspace_id, inbox_id, status, last_message_at DESC);
CREATE INDEX idx_conv_thread_key ON mail_conversations (workspace_id, account_id, normalized_subject);
CREATE INDEX idx_conv_assignee ON mail_conversations (workspace_id, assignee_id)
	WHERE assignee_id IS NOT NULL;
CREATE TRIGGER trg_mail_conversations_updated_at
	BEFORE UPDATE ON mail_conversations
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE mail_messages (
	id              uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	conversation_id uuid NOT NULL,
	account_id      uuid NOT NULL,
	direction       text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
	rfc_message_id  text,                              -- Message-Id header
	in_reply_to     text,
	references_ids  text[] NOT NULL DEFAULT '{}',      -- RFC 5322 References ("references" is reserved)
	from_addr       jsonb NOT NULL,                    -- {name,email}
	to_addrs        jsonb NOT NULL DEFAULT '[]'::jsonb,
	cc_addrs        jsonb NOT NULL DEFAULT '[]'::jsonb,
	subject         text,
	snippet         text NOT NULL DEFAULT '',          -- short text preview for the timeline
	sent_at         timestamptz,
	received_at     timestamptz NOT NULL DEFAULT now(),
	raw_blob_key    text,                              -- immutable raw MIME object (null for pending outbound)
	body_html       text,                              -- sanitized for display
	body_text       text,
	attachments     jsonb NOT NULL DEFAULT '[]'::jsonb,-- [{name,contentType,size,partIndex}]
	auth_results    jsonb,                             -- SPF/DKIM/DMARC verdicts
	provider_ref    jsonb NOT NULL DEFAULT '{}'::jsonb,-- cache only; never a key (§14.3)
	send_state      text CHECK (send_state IN ('queued', 'sending', 'sent', 'delivered', 'bounced', 'failed')),
	created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at      timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, conversation_id) REFERENCES mail_conversations (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, account_id) REFERENCES mail_accounts (workspace_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uq_msg_dedupe
	ON mail_messages (workspace_id, account_id, rfc_message_id)
	WHERE rfc_message_id IS NOT NULL;
CREATE INDEX idx_msg_conversation ON mail_messages (workspace_id, conversation_id, received_at);
CREATE INDEX idx_msg_reply_link ON mail_messages (workspace_id, account_id, rfc_message_id)
	WHERE rfc_message_id IS NOT NULL;

-- Timeline events: assignment, status changes, merges, links (§14.5).
CREATE TABLE mail_conversation_events (
	id              uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	conversation_id uuid NOT NULL,
	kind            text NOT NULL CHECK (kind IN ('assigned', 'unassigned', 'status_changed', 'merged', 'linked', 'unlinked', 'snoozed', 'note_added', 'converted')),
	actor_id        uuid REFERENCES users(id) ON DELETE SET NULL,
	payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at      timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, conversation_id) REFERENCES mail_conversations (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_conv_events ON mail_conversation_events (workspace_id, conversation_id, created_at);

-- Internal notes — never sent (§14.5).
CREATE TABLE mail_conversation_comments (
	id              uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	conversation_id uuid NOT NULL,
	author_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	body            jsonb NOT NULL,                    -- rich text
	body_text       text NOT NULL DEFAULT '',
	mentions        uuid[] NOT NULL DEFAULT '{}',
	created_at      timestamptz NOT NULL DEFAULT now(),
	updated_at      timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, conversation_id) REFERENCES mail_conversations (workspace_id, id) ON DELETE CASCADE
);
CREATE TRIGGER trg_mail_conversation_comments_updated_at
	BEFORE UPDATE ON mail_conversation_comments
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Drafts double as the outbound queue: status 'sending' + scheduled_send_at
-- is the undo-send window (§14.5, §23 M5).
CREATE TABLE mail_drafts (
	id                uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	conversation_id   uuid NOT NULL,
	identity_id       uuid NOT NULL,                   -- from-address + signature
	created_by        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	last_edited_by    uuid REFERENCES users(id) ON DELETE SET NULL,
	body              jsonb NOT NULL,                  -- rich-text body (shared Yjs ref in a later phase)
	body_text         text NOT NULL DEFAULT '',
	recipients        jsonb NOT NULL,                  -- {to:[], cc:[], bcc:[]}
	in_reply_to_id    uuid,
	scheduled_send_at timestamptz,
	status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'sent', 'discarded')),
	sent_message_id   uuid,
	locked_by         uuid REFERENCES users(id) ON DELETE SET NULL, -- soft lock "X is editing"
	locked_until      timestamptz,
	version           int NOT NULL DEFAULT 1,
	created_at        timestamptz NOT NULL DEFAULT now(),
	updated_at        timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, conversation_id) REFERENCES mail_conversations (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, identity_id) REFERENCES mail_identities (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, in_reply_to_id) REFERENCES mail_messages (workspace_id, id) ON DELETE SET NULL,
	FOREIGN KEY (workspace_id, sent_message_id) REFERENCES mail_messages (workspace_id, id) ON DELETE SET NULL
);
CREATE INDEX idx_mail_drafts_due ON mail_drafts (status, scheduled_send_at)
	WHERE status = 'sending';
CREATE TRIGGER trg_mail_drafts_updated_at
	BEFORE UPDATE ON mail_drafts
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Links are real relations, not nullable columns (§14.3).
CREATE TABLE mail_conversation_tasks (
	workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	conversation_id uuid NOT NULL,
	task_id         uuid NOT NULL,
	created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at      timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, conversation_id, task_id),
	FOREIGN KEY (workspace_id, conversation_id) REFERENCES mail_conversations (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, task_id) REFERENCES issues (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE mail_conversation_docs (
	workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	conversation_id uuid NOT NULL,
	page_id         uuid NOT NULL,
	created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at      timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, conversation_id, page_id),
	FOREIGN KEY (workspace_id, conversation_id) REFERENCES mail_conversations (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, page_id) REFERENCES doc_pages (workspace_id, id) ON DELETE CASCADE
);

-- Attachment metadata joins inbound/outbound messages to quarantined files (§14.6).
CREATE TABLE mail_message_attachments (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	message_id   uuid NOT NULL,
	file_id      uuid NOT NULL,
	position     int NOT NULL DEFAULT 0,
	created_at   timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, message_id, file_id),
	FOREIGN KEY (workspace_id, message_id) REFERENCES mail_messages (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, file_id) REFERENCES files (workspace_id, id) ON DELETE CASCADE
);

-- ---------- 3. Expand notifications.kind for M5 mail events ----------
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
			'channel.access_granted',
			'approval.requested',
			'mail.assigned',
			'mail.mentioned',
			'mail.reply_needed'
		)
	);

-- ---------- 4. RLS policies (ENABLE + FORCE on every new tenant table) ----------
ALTER TABLE mail_inboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_inboxes FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_inboxes_tenant_isolation ON mail_inboxes
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE mail_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_accounts_tenant_isolation ON mail_accounts
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE mail_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_identities FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_identities_tenant_isolation ON mail_identities
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE mail_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_conversations_tenant_isolation ON mail_conversations
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE mail_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_messages_tenant_isolation ON mail_messages
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE mail_conversation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_conversation_events FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_conversation_events_tenant_isolation ON mail_conversation_events
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE mail_conversation_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_conversation_comments FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_conversation_comments_tenant_isolation ON mail_conversation_comments
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE mail_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_drafts_tenant_isolation ON mail_drafts
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE mail_conversation_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_conversation_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_conversation_tasks_tenant_isolation ON mail_conversation_tasks
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE mail_conversation_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_conversation_docs FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_conversation_docs_tenant_isolation ON mail_conversation_docs
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE mail_message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_message_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_message_attachments_tenant_isolation ON mail_message_attachments
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ---------- 5. SECURITY DEFINER helpers ----------
-- Pre-tenant inbound routing (§12.4, §14.2): the inbound-parse webhook carries
-- an opaque per-account token; this resolves it to the owning workspace +
-- account before a tenant context exists, preserving FORCE RLS.
CREATE OR REPLACE FUNCTION resolve_mail_inbound_route(p_token_hash text)
RETURNS TABLE (
	account_id uuid,
	workspace_id uuid,
	address citext,
	default_inbox_id uuid,
	account_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
	SELECT
		a.id,
		a.workspace_id,
		a.address,
		a.default_inbox_id,
		a.status
	FROM public.mail_accounts a
	WHERE a.provider = 'inbound_parse'
		AND a.config ->> 'inbound_token_hash' = p_token_hash;
$$;
REVOKE ALL ON FUNCTION resolve_mail_inbound_route(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_mail_inbound_route(text) TO huriro_app;

-- Worker sync discovery (§12.4): enumerate connected-mailbox accounts due for
-- polling before a tenant context exists (IMAP/Graph; Gmail rides Pub/Sub +
-- this same poll as backstop).
CREATE OR REPLACE FUNCTION list_mail_accounts_for_sync()
RETURNS TABLE (
	id uuid,
	workspace_id uuid,
	provider text,
	status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
	SELECT a.id, a.workspace_id, a.provider, a.status
	FROM public.mail_accounts a
	WHERE a.provider IN ('imap', 'gmail', 'graph')
		AND a.status IN ('active', 'error')
		AND (
			a.last_synced_at IS NULL
			OR a.last_synced_at <= now() - interval '60 seconds'
		);
$$;
REVOKE ALL ON FUNCTION list_mail_accounts_for_sync() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_mail_accounts_for_sync() TO huriro_app;

-- Worker outbound-due discovery: drafts past their undo-send window.
CREATE OR REPLACE FUNCTION list_mail_drafts_due_for_send()
RETURNS TABLE (
	id uuid,
	workspace_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
	SELECT d.id, d.workspace_id
	FROM public.mail_drafts d
	WHERE d.status = 'sending'
		AND d.scheduled_send_at IS NOT NULL
		AND d.scheduled_send_at <= now();
$$;
REVOKE ALL ON FUNCTION list_mail_drafts_due_for_send() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_mail_drafts_due_for_send() TO huriro_app;

-- ---------- 6. Grants ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON
	mail_inboxes,
	mail_accounts,
	mail_identities,
	mail_conversations,
	mail_messages,
	mail_conversation_events,
	mail_conversation_comments,
	mail_drafts,
	mail_conversation_tasks,
	mail_conversation_docs,
	mail_message_attachments
TO huriro_app;

GRANT SELECT ON
	mail_inboxes,
	mail_accounts,
	mail_identities,
	mail_conversations,
	mail_messages,
	mail_conversation_events,
	mail_conversation_comments,
	mail_drafts,
	mail_conversation_tasks,
	mail_conversation_docs,
	mail_message_attachments
TO huriro_maint;

GRANT DELETE ON
	mail_messages,
	mail_conversation_events,
	mail_message_attachments
TO huriro_maint;

-- ---------- permission backfill for existing workspaces ----------
-- New workspaces seed from packages/domain SYSTEM_ROLES; existing rows get the
-- new actions here (same pattern as 0015). Members reply from teammate
-- identities, so mail.send is granted alongside read/assign.
INSERT INTO role_permissions (workspace_id, role_id, permission)
SELECT r.workspace_id, r.id, 'mail.read'
FROM roles r
WHERE r.key IN ('owner', 'admin', 'member')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (workspace_id, role_id, permission)
SELECT r.workspace_id, r.id, 'mail.assign'
FROM roles r
WHERE r.key IN ('owner', 'admin', 'member')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (workspace_id, role_id, permission)
SELECT r.workspace_id, r.id, 'mail.send'
FROM roles r
WHERE r.key IN ('owner', 'admin', 'member')
ON CONFLICT DO NOTHING;
