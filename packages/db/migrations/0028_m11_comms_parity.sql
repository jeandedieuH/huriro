-- 0028_m11_comms_parity.sql — M11 Chat Slack-Parity & Mail Front/Superhuman-Parity
-- (advaced-features-plan §5.1–§5.7, §6.1–§6.6, ADR-0029, ADR-0032):
--   * Broadcast thread replies, quoted replies, typed chat messages and metadata
--   * Workspace emoji, synced drafts, scheduled messages, saved reminders
--   * Sidebar sections, bookmarks, pins, channel canvas, statuses/DND, user groups
--   * Native polls, file transcripts, optional LiveKit huddle sessions
--   * Collaborative mail drafts + review-before-send state
--   * Contacts/organizations, tags, templates/snippets, macros, routing and SLA state
--   * Follow-up reminders, split-inbox configuration, private inboxes and JMAP profile support
--
-- Expand-phase only. Every new tenant table has workspace-scoped composite
-- keys/foreign keys, ENABLE + FORCE ROW LEVEL SECURITY, and grants for huriro_app.
--
-- Rollback note: drop SECURITY DEFINER helper functions
-- (list_chat_scheduled_messages_due, list_chat_saved_reminders_due,
-- list_mail_followups_due); drop tables in reverse dependency order
-- (chat_poll_votes -> chat_polls -> chat_huddle_sessions -> file_transcripts ->
-- chat_pinned_messages -> chat_channel_bookmarks -> chat_sidebar_section_items ->
-- chat_sidebar_sections -> chat_saved_items -> chat_scheduled_messages -> chat_drafts ->
-- user_group_members -> user_groups -> user_workspace_profiles -> workspace_emojis ->
-- mail_conversation_tags -> mail_tags -> mail_inbox_routing_state -> mail_sla_policies ->
-- mail_macros -> mail_templates -> contacts -> contact_organizations); restore prior
-- CHECK constraints on chat_messages, collab_tickets, acl_entries, notifications and
-- mail_conversation_events; drop added columns on chat_messages, chat_channels,
-- chat_read_state, notification_preferences, mail_inboxes, mail_conversations and mail_drafts.

-- ---------- 1. Shared CHECK/constraint expansion ----------
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

	FOR c_name IN
		SELECT con.conname
		FROM pg_constraint con
		JOIN pg_class rel ON rel.oid = con.conrelid
		JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
		WHERE nsp.nspname = 'public'
			AND rel.relname = 'mail_conversation_events'
			AND con.contype = 'c'
			AND pg_get_constraintdef(con.oid) LIKE '%kind%'
	LOOP
		EXECUTE format('ALTER TABLE public.mail_conversation_events DROP CONSTRAINT %I', c_name);
	END LOOP;
END
$$;

ALTER TABLE acl_entries ADD CONSTRAINT ck_acl_entries_resource_type
	CHECK (resource_type IN ('project', 'doc_page', 'teamspace', 'channel', 'mail_account', 'mail_inbox'));

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
			'chat.reminder_due',
			'channel.access_granted',
			'approval.requested',
			'mail.assigned',
			'mail.mentioned',
			'mail.reply_needed',
			'mail.review_requested',
			'mail.review_completed',
			'mail.follow_up_due',
			'mail.sla_breached'
		)
	);

ALTER TABLE mail_conversation_events ADD CONSTRAINT ck_mail_conversation_events_kind
	CHECK (
		kind IN (
			'assigned',
			'unassigned',
			'status_changed',
			'merged',
			'linked',
			'unlinked',
			'snoozed',
			'note_added',
			'converted',
			'split',
			'forwarded',
			'tag_added',
			'tag_removed',
			'review_requested',
			'review_approved',
			'review_changes_requested',
			'follow_up_due',
			'sla_breached',
			'draft_created'
		)
	);

-- ---------- 2. Chat core expansion (§5.1, §5.6) ----------
ALTER TABLE chat_messages
	ADD COLUMN broadcast_to_channel boolean NOT NULL DEFAULT false,
	ADD COLUMN reply_to_message_id uuid,
	ADD COLUMN message_kind text NOT NULL DEFAULT 'text',
	ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE chat_messages
	ADD CONSTRAINT ck_chat_messages_kind
		CHECK (message_kind IN ('text', 'poll', 'huddle_session', 'approval_card', 'system')),
	ADD CONSTRAINT fk_chat_messages_reply_to
		FOREIGN KEY (workspace_id, reply_to_message_id)
		REFERENCES chat_messages (workspace_id, id) ON DELETE SET NULL (reply_to_message_id);

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
			AND rel.relname = 'chat_messages'
			AND con.contype = 'c'
			AND pg_get_constraintdef(con.oid) LIKE '%thread_parent_id%'
	LOOP
		EXECUTE format('ALTER TABLE public.chat_messages DROP CONSTRAINT %I', c_name);
	END LOOP;
END
$$;

-- V1 enforced a strict top-level-XOR-thread shape. Broadcast replies deliberately
-- carry BOTH thread_seq and channel_seq so they render in the parent thread and in
-- the channel feed without duplicating the row or weakening per-channel ordering.
ALTER TABLE chat_messages ADD CONSTRAINT ck_chat_messages_thread_shape
	CHECK (
		(
			thread_parent_id IS NULL
			AND channel_seq IS NOT NULL
			AND thread_seq IS NULL
			AND broadcast_to_channel = false
		)
		OR (
			thread_parent_id IS NOT NULL
			AND thread_seq IS NOT NULL
			AND (
				(broadcast_to_channel = true AND channel_seq IS NOT NULL)
				OR (broadcast_to_channel = false AND channel_seq IS NULL)
			)
		)
	);

-- Required to enforce that pins stay inside their owning channel.
ALTER TABLE chat_messages ADD CONSTRAINT uq_chat_messages_ws_channel_id
	UNIQUE (workspace_id, channel_id, id);
CREATE INDEX idx_chat_messages_channel_feed
	ON chat_messages (workspace_id, channel_id, channel_seq DESC)
	WHERE deleted_at IS NULL AND channel_seq IS NOT NULL;

ALTER TABLE chat_channels
	ADD COLUMN canvas_page_id uuid;
ALTER TABLE chat_channels
	ADD CONSTRAINT fk_chat_channels_canvas_page
		FOREIGN KEY (workspace_id, canvas_page_id)
		REFERENCES doc_pages (workspace_id, id) ON DELETE SET NULL (canvas_page_id);

ALTER TABLE chat_read_state
	ADD COLUMN notify_level text NOT NULL DEFAULT 'default'
		CHECK (notify_level IN ('default', 'all', 'mentions', 'none')),
	ADD COLUMN muted_until timestamptz;

ALTER TABLE notification_preferences
	ADD COLUMN alert_keywords text[] NOT NULL DEFAULT '{}';

CREATE TABLE workspace_emojis (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	shortcode    text NOT NULL CHECK (shortcode ~ '^[a-z0-9][a-z0-9_+-]{0,63}$'),
	file_id      uuid NOT NULL,
	created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, shortcode),
	FOREIGN KEY (workspace_id, file_id) REFERENCES files (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE chat_drafts (
	id                   uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id         uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	channel_id           uuid NOT NULL,
	thread_parent_id     uuid,
	user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	body                 jsonb NOT NULL DEFAULT '{}'::jsonb,
	body_text            text NOT NULL DEFAULT '',
	attachment_file_ids  uuid[] NOT NULL DEFAULT '{}',
	created_at           timestamptz NOT NULL DEFAULT now(),
	updated_at           timestamptz NOT NULL DEFAULT now(),
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, channel_id) REFERENCES chat_channels (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, thread_parent_id) REFERENCES chat_messages (workspace_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uq_chat_drafts_target
	ON chat_drafts (
		workspace_id,
		user_id,
		channel_id,
		COALESCE(thread_parent_id, '00000000-0000-0000-0000-000000000000'::uuid)
	);
CREATE TRIGGER trg_chat_drafts_updated_at
	BEFORE UPDATE ON chat_drafts
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE chat_scheduled_messages (
	id                   uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id         uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	channel_id           uuid NOT NULL,
	thread_parent_id     uuid,
	author_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	body                 jsonb NOT NULL DEFAULT '{}'::jsonb,
	body_text            text NOT NULL,
	attachment_file_ids  uuid[] NOT NULL DEFAULT '{}',
	scheduled_for        timestamptz NOT NULL,
	status               text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sent', 'cancelled', 'failed')),
	sent_message_id      uuid,
	error_detail         text,
	created_at           timestamptz NOT NULL DEFAULT now(),
	updated_at           timestamptz NOT NULL DEFAULT now(),
	version              int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, channel_id) REFERENCES chat_channels (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, thread_parent_id) REFERENCES chat_messages (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, sent_message_id) REFERENCES chat_messages (workspace_id, id) ON DELETE SET NULL
);
CREATE INDEX idx_chat_scheduled_due ON chat_scheduled_messages (scheduled_for)
	WHERE status = 'scheduled';
CREATE TRIGGER trg_chat_scheduled_messages_updated_at
	BEFORE UPDATE ON chat_scheduled_messages
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE chat_saved_items (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	message_id   uuid,
	custom_text  text NOT NULL DEFAULT '',
	note         text NOT NULL DEFAULT '',
	status       text NOT NULL DEFAULT 'saved' CHECK (status IN ('saved', 'in_progress', 'archived', 'completed')),
	remind_at    timestamptz,
	reminded_at  timestamptz,
	completed_at timestamptz,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	version      int NOT NULL DEFAULT 1,
	CHECK (message_id IS NOT NULL OR length(btrim(custom_text)) > 0),
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, message_id) REFERENCES chat_messages (workspace_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uq_chat_saved_items_message
	ON chat_saved_items (workspace_id, user_id, message_id)
	WHERE message_id IS NOT NULL;
CREATE INDEX idx_chat_saved_items_user ON chat_saved_items (workspace_id, user_id, status, updated_at DESC);
CREATE INDEX idx_chat_saved_items_due ON chat_saved_items (remind_at)
	WHERE reminded_at IS NULL AND status IN ('saved', 'in_progress');
CREATE TRIGGER trg_chat_saved_items_updated_at
	BEFORE UPDATE ON chat_saved_items
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE chat_sidebar_sections (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name         text NOT NULL,
	position     text COLLATE "C" NOT NULL,
	collapsed    boolean NOT NULL DEFAULT false,
	unread_only  boolean NOT NULL DEFAULT false,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	version      int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, user_id, name)
);
CREATE INDEX idx_chat_sidebar_sections_user ON chat_sidebar_sections (workspace_id, user_id, position COLLATE "C");
CREATE TRIGGER trg_chat_sidebar_sections_updated_at
	BEFORE UPDATE ON chat_sidebar_sections
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE chat_sidebar_section_items (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	section_id   uuid NOT NULL,
	channel_id   uuid NOT NULL,
	position     text COLLATE "C" NOT NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, section_id, channel_id),
	FOREIGN KEY (workspace_id, section_id) REFERENCES chat_sidebar_sections (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, channel_id) REFERENCES chat_channels (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_chat_sidebar_section_items_channel ON chat_sidebar_section_items (workspace_id, channel_id);

CREATE TABLE chat_channel_bookmarks (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	channel_id   uuid NOT NULL,
	target_type  text NOT NULL CHECK (target_type IN ('issue', 'saved_view', 'doc_page', 'mail_inbox', 'external_url')),
	target_id    uuid,
	title        text NOT NULL,
	url          text,
	icon         text,
	folder       text,
	position     text COLLATE "C" NOT NULL,
	created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	version      int NOT NULL DEFAULT 1,
	CHECK ((target_type = 'external_url' AND url IS NOT NULL) OR (target_type <> 'external_url' AND target_id IS NOT NULL)),
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, channel_id) REFERENCES chat_channels (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_chat_channel_bookmarks_channel
	ON chat_channel_bookmarks (workspace_id, channel_id, position COLLATE "C");
CREATE TRIGGER trg_chat_channel_bookmarks_updated_at
	BEFORE UPDATE ON chat_channel_bookmarks
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE chat_pinned_messages (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	channel_id   uuid NOT NULL,
	message_id   uuid NOT NULL,
	pinned_by    uuid REFERENCES users(id) ON DELETE SET NULL,
	position     text COLLATE "C" NOT NULL DEFAULT 'a0',
	created_at   timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, channel_id, message_id),
	FOREIGN KEY (workspace_id, channel_id) REFERENCES chat_channels (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, channel_id, message_id)
		REFERENCES chat_messages (workspace_id, channel_id, id) ON DELETE CASCADE
);

CREATE TABLE user_workspace_profiles (
	workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	status_emoji      text,
	status_text       text NOT NULL DEFAULT '',
	status_expires_at timestamptz,
	dnd_until         timestamptz,
	working_hours     jsonb NOT NULL DEFAULT '{}'::jsonb,
	last_seen_at      timestamptz,
	created_at        timestamptz NOT NULL DEFAULT now(),
	updated_at        timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX idx_user_workspace_profiles_dnd ON user_workspace_profiles (workspace_id, dnd_until)
	WHERE dnd_until IS NOT NULL;
CREATE TRIGGER trg_user_workspace_profiles_updated_at
	BEFORE UPDATE ON user_workspace_profiles
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_groups (
	id                    uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id          uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	handle                text NOT NULL CHECK (handle ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
	name                  text NOT NULL,
	description           text NOT NULL DEFAULT '',
	auto_join_channel_ids uuid[] NOT NULL DEFAULT '{}',
	created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at            timestamptz NOT NULL DEFAULT now(),
	updated_at            timestamptz NOT NULL DEFAULT now(),
	version               int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, handle)
);
CREATE TRIGGER trg_user_groups_updated_at
	BEFORE UPDATE ON user_groups
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_group_members (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	group_id     uuid NOT NULL,
	user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	created_at   timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, group_id, user_id),
	FOREIGN KEY (workspace_id, group_id) REFERENCES user_groups (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_user_group_members_user ON user_group_members (workspace_id, user_id);

CREATE TABLE chat_polls (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	channel_id   uuid NOT NULL,
	message_id   uuid NOT NULL,
	question     text NOT NULL,
	options      jsonb NOT NULL,
	multi_choice boolean NOT NULL DEFAULT false,
	anonymous    boolean NOT NULL DEFAULT false,
	status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
	closes_at    timestamptz,
	created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	version      int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, message_id),
	FOREIGN KEY (workspace_id, channel_id) REFERENCES chat_channels (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, channel_id, message_id)
		REFERENCES chat_messages (workspace_id, channel_id, id) ON DELETE CASCADE
);
CREATE TRIGGER trg_chat_polls_updated_at
	BEFORE UPDATE ON chat_polls
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE chat_poll_votes (
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	poll_id      uuid NOT NULL,
	user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	option_ids   text[] NOT NULL DEFAULT '{}',
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, poll_id, user_id),
	FOREIGN KEY (workspace_id, poll_id) REFERENCES chat_polls (workspace_id, id) ON DELETE CASCADE
);
CREATE TRIGGER trg_chat_poll_votes_updated_at
	BEFORE UPDATE ON chat_poll_votes
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE file_transcripts (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	file_id      uuid NOT NULL,
	status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
	transcript   text NOT NULL DEFAULT '',
	language     text,
	provider     text,
	error_detail text,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	version      int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, file_id),
	FOREIGN KEY (workspace_id, file_id) REFERENCES files (workspace_id, id) ON DELETE CASCADE
);
CREATE TRIGGER trg_file_transcripts_updated_at
	BEFORE UPDATE ON file_transcripts
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE chat_huddle_sessions (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	channel_id   uuid NOT NULL,
	message_id   uuid,
	room_name    text NOT NULL,
	status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
	started_by   uuid REFERENCES users(id) ON DELETE SET NULL,
	ended_by     uuid REFERENCES users(id) ON DELETE SET NULL,
	started_at   timestamptz NOT NULL DEFAULT now(),
	ended_at     timestamptz,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	version      int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, room_name),
	FOREIGN KEY (workspace_id, channel_id) REFERENCES chat_channels (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, message_id) REFERENCES chat_messages (workspace_id, id) ON DELETE SET NULL
);
CREATE INDEX idx_chat_huddles_active ON chat_huddle_sessions (workspace_id, channel_id, started_at DESC)
	WHERE status = 'active';
CREATE TRIGGER trg_chat_huddle_sessions_updated_at
	BEFORE UPDATE ON chat_huddle_sessions
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- 3. Collaborative mail drafts & review gates (§6.1, ADR-0032) ----------
ALTER TABLE mail_drafts
	ADD COLUMN collab_enabled boolean NOT NULL DEFAULT false,
	ADD COLUMN draft_state bytea,
	ADD COLUMN draft_state_vector bytea,
	ADD COLUMN lease_node_id text,
	ADD COLUMN lease_epoch bigint NOT NULL DEFAULT 0,
	ADD COLUMN lease_expires_at timestamptz,
	ADD COLUMN review_status text NOT NULL DEFAULT 'none'
		CHECK (review_status IN ('none', 'requested', 'approved', 'changes_requested')),
	ADD COLUMN reviewer_id uuid REFERENCES users(id) ON DELETE SET NULL,
	ADD COLUMN reviewed_at timestamptz,
	ADD COLUMN review_note text,
	ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Expand collab_tickets from doc/synced-block rooms to mail draft rooms.
ALTER TABLE collab_tickets DROP CONSTRAINT IF EXISTS ck_collab_tickets_room_target;
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
			AND rel.relname = 'collab_tickets'
			AND con.contype = 'c'
			AND pg_get_constraintdef(con.oid) LIKE '%room_kind%'
	LOOP
		EXECUTE format('ALTER TABLE public.collab_tickets DROP CONSTRAINT %I', c_name);
	END LOOP;
END
$$;

ALTER TABLE collab_tickets
	ADD COLUMN mail_draft_id uuid,
	ADD CONSTRAINT fk_collab_tickets_mail_draft
		FOREIGN KEY (workspace_id, mail_draft_id)
		REFERENCES mail_drafts (workspace_id, id) ON DELETE CASCADE,
	ADD CONSTRAINT ck_collab_tickets_room_kind
		CHECK (room_kind IN ('doc_page', 'synced_block', 'mail_draft')),
	ADD CONSTRAINT ck_collab_tickets_room_target
		CHECK (
			(room_kind = 'doc_page' AND page_id IS NOT NULL AND synced_block_id IS NULL AND mail_draft_id IS NULL)
			OR (room_kind = 'synced_block' AND synced_block_id IS NOT NULL AND page_id IS NULL AND mail_draft_id IS NULL)
			OR (room_kind = 'mail_draft' AND mail_draft_id IS NOT NULL AND page_id IS NULL AND synced_block_id IS NULL)
		);
CREATE INDEX idx_collab_tickets_mail_draft_user ON collab_tickets (workspace_id, mail_draft_id, user_id)
	WHERE mail_draft_id IS NOT NULL;

-- ---------- 4. Contacts, tags, templates, macros, routing & SLA (§6.2–§6.4) ----------
CREATE TABLE contact_organizations (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	name         text NOT NULL,
	domain       citext,
	tier         text NOT NULL DEFAULT 'standard' CHECK (tier IN ('standard', 'vip', 'strategic')),
	notes        text NOT NULL DEFAULT '',
	metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	version      int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id)
);
CREATE UNIQUE INDEX uq_contact_organizations_domain
	ON contact_organizations (workspace_id, domain)
	WHERE domain IS NOT NULL;
CREATE TRIGGER trg_contact_organizations_updated_at
	BEFORE UPDATE ON contact_organizations
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE contacts (
	id              uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	organization_id uuid,
	email           citext NOT NULL,
	display_name    text,
	title           text,
	phone           text,
	vip_tier        text NOT NULL DEFAULT 'standard' CHECK (vip_tier IN ('standard', 'vip', 'strategic')),
	notes           text NOT NULL DEFAULT '',
	metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at      timestamptz NOT NULL DEFAULT now(),
	updated_at      timestamptz NOT NULL DEFAULT now(),
	version         int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	UNIQUE (workspace_id, email),
	FOREIGN KEY (workspace_id, organization_id)
		REFERENCES contact_organizations (workspace_id, id) ON DELETE SET NULL (organization_id)
);
CREATE INDEX idx_contacts_org ON contacts (workspace_id, organization_id)
	WHERE organization_id IS NOT NULL;
CREATE TRIGGER trg_contacts_updated_at
	BEFORE UPDATE ON contacts
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE mail_inboxes
	ADD COLUMN visibility text NOT NULL DEFAULT 'shared' CHECK (visibility IN ('shared', 'private')),
	ADD COLUMN owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE mail_conversations
	ADD COLUMN contact_id uuid,
	ADD COLUMN follow_up_at timestamptz,
	ADD COLUMN follow_up_condition text CHECK (follow_up_condition IN ('if_no_reply', 'always')),
	ADD COLUMN follow_up_completed_at timestamptz,
	ADD COLUMN sla_next_due_at timestamptz,
	ADD COLUMN sla_breached_at timestamptz,
	ADD COLUMN sla_breach_count int NOT NULL DEFAULT 0,
	ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
ALTER TABLE mail_conversations
	ADD CONSTRAINT fk_mail_conversations_contact
		FOREIGN KEY (workspace_id, contact_id)
		REFERENCES contacts (workspace_id, id) ON DELETE SET NULL (contact_id);
CREATE INDEX idx_mail_conversations_followup ON mail_conversations (follow_up_at)
	WHERE follow_up_at IS NOT NULL AND follow_up_completed_at IS NULL;
CREATE INDEX idx_mail_conversations_sla ON mail_conversations (sla_next_due_at)
	WHERE sla_next_due_at IS NOT NULL AND sla_breached_at IS NULL;
CREATE INDEX idx_mail_conversations_contact ON mail_conversations (workspace_id, contact_id)
	WHERE contact_id IS NOT NULL;

CREATE TABLE mail_tags (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	inbox_id     uuid,
	name         text NOT NULL,
	color        text NOT NULL DEFAULT 'neutral',
	created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	version      int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, inbox_id) REFERENCES mail_inboxes (workspace_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uq_mail_tags_name
	ON mail_tags (workspace_id, COALESCE(inbox_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
CREATE TRIGGER trg_mail_tags_updated_at
	BEFORE UPDATE ON mail_tags
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE mail_conversation_tags (
	workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	conversation_id uuid NOT NULL,
	tag_id          uuid NOT NULL,
	created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at      timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (workspace_id, conversation_id, tag_id),
	FOREIGN KEY (workspace_id, conversation_id) REFERENCES mail_conversations (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, tag_id) REFERENCES mail_tags (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_mail_conversation_tags_tag ON mail_conversation_tags (workspace_id, tag_id);

CREATE TABLE mail_templates (
	id                   uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id         uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	inbox_id             uuid,
	owner_user_id        uuid REFERENCES users(id) ON DELETE CASCADE,
	name                 text NOT NULL,
	shortcut             text NOT NULL CHECK (shortcut ~ '^;[a-z0-9][a-z0-9_-]{0,63}$'),
	body                 jsonb NOT NULL DEFAULT '{}'::jsonb,
	body_html            text,
	body_text            text NOT NULL,
	attachment_file_ids  uuid[] NOT NULL DEFAULT '{}',
	merge_variables      jsonb NOT NULL DEFAULT '[]'::jsonb,
	created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at           timestamptz NOT NULL DEFAULT now(),
	updated_at           timestamptz NOT NULL DEFAULT now(),
	version              int NOT NULL DEFAULT 1,
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, inbox_id) REFERENCES mail_inboxes (workspace_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uq_mail_templates_shortcut
	ON mail_templates (
		workspace_id,
		COALESCE(inbox_id, '00000000-0000-0000-0000-000000000000'::uuid),
		COALESCE(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
		shortcut
	);
CREATE TRIGGER trg_mail_templates_updated_at
	BEFORE UPDATE ON mail_templates
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE mail_macros (
	id           uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	inbox_id     uuid,
	name         text NOT NULL,
	shortcut     text,
	steps        jsonb NOT NULL,
	created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	version      int NOT NULL DEFAULT 1,
	CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) > 0),
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, inbox_id) REFERENCES mail_inboxes (workspace_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uq_mail_macros_shortcut
	ON mail_macros (workspace_id, COALESCE(inbox_id, '00000000-0000-0000-0000-000000000000'::uuid), shortcut)
	WHERE shortcut IS NOT NULL;
CREATE TRIGGER trg_mail_macros_updated_at
	BEFORE UPDATE ON mail_macros
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE mail_sla_policies (
	id                     uuid PRIMARY KEY DEFAULT uuidv7(),
	workspace_id           uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	inbox_id               uuid,
	tag_id                 uuid,
	name                   text NOT NULL,
	first_reply_minutes    int CHECK (first_reply_minutes > 0),
	next_reply_minutes     int CHECK (next_reply_minutes > 0),
	resolution_minutes     int CHECK (resolution_minutes > 0),
	business_hours         jsonb NOT NULL DEFAULT '{}'::jsonb,
	active                 boolean NOT NULL DEFAULT true,
	created_by             uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at             timestamptz NOT NULL DEFAULT now(),
	updated_at             timestamptz NOT NULL DEFAULT now(),
	version                int NOT NULL DEFAULT 1,
	CHECK (first_reply_minutes IS NOT NULL OR next_reply_minutes IS NOT NULL OR resolution_minutes IS NOT NULL),
	UNIQUE (workspace_id, id),
	FOREIGN KEY (workspace_id, inbox_id) REFERENCES mail_inboxes (workspace_id, id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, tag_id) REFERENCES mail_tags (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_mail_sla_policies_active ON mail_sla_policies (workspace_id, inbox_id, tag_id)
	WHERE active;
CREATE TRIGGER trg_mail_sla_policies_updated_at
	BEFORE UPDATE ON mail_sla_policies
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE mail_inbox_routing_state (
	workspace_id           uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	inbox_id               uuid NOT NULL,
	enabled                boolean NOT NULL DEFAULT false,
	last_assigned_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
	max_open_cap           int NOT NULL DEFAULT 10 CHECK (max_open_cap > 0),
	require_online         boolean NOT NULL DEFAULT false,
	respect_dnd            boolean NOT NULL DEFAULT true,
	created_at             timestamptz NOT NULL DEFAULT now(),
	updated_at             timestamptz NOT NULL DEFAULT now(),
	version                int NOT NULL DEFAULT 1,
	PRIMARY KEY (workspace_id, inbox_id),
	FOREIGN KEY (workspace_id, inbox_id) REFERENCES mail_inboxes (workspace_id, id) ON DELETE CASCADE
);
CREATE TRIGGER trg_mail_inbox_routing_state_updated_at
	BEFORE UPDATE ON mail_inbox_routing_state
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- 5. Worker discovery helpers (SECURITY DEFINER, narrow projections) ----------
CREATE OR REPLACE FUNCTION list_chat_scheduled_messages_due()
RETURNS TABLE (workspace_id uuid, id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
	SELECT workspace_id, id
	FROM chat_scheduled_messages
	WHERE status = 'scheduled' AND scheduled_for <= now()
	ORDER BY scheduled_for ASC
	LIMIT 500;
$$;

CREATE OR REPLACE FUNCTION list_chat_saved_reminders_due()
RETURNS TABLE (workspace_id uuid, id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
	SELECT workspace_id, id
	FROM chat_saved_items
	WHERE remind_at IS NOT NULL
		AND reminded_at IS NULL
		AND remind_at <= now()
		AND status IN ('saved', 'in_progress')
	ORDER BY remind_at ASC
	LIMIT 500;
$$;

CREATE OR REPLACE FUNCTION list_mail_followups_due()
RETURNS TABLE (workspace_id uuid, id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
	SELECT workspace_id, id
	FROM mail_conversations
	WHERE follow_up_at IS NOT NULL
		AND follow_up_completed_at IS NULL
		AND follow_up_at <= now()
		AND status IN ('open', 'pending', 'snoozed')
	ORDER BY follow_up_at ASC
	LIMIT 500;
$$;

REVOKE ALL ON FUNCTION list_chat_scheduled_messages_due() FROM PUBLIC;
REVOKE ALL ON FUNCTION list_chat_saved_reminders_due() FROM PUBLIC;
REVOKE ALL ON FUNCTION list_mail_followups_due() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_chat_scheduled_messages_due() TO huriro_app;
GRANT EXECUTE ON FUNCTION list_chat_saved_reminders_due() TO huriro_app;
GRANT EXECUTE ON FUNCTION list_mail_followups_due() TO huriro_app;

-- ---------- 6. RLS Policies (ENABLE + FORCE on every new tenant table) ----------
ALTER TABLE workspace_emojis ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_emojis FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_emojis_tenant_isolation ON workspace_emojis
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE chat_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_drafts_tenant_isolation ON chat_drafts
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE chat_scheduled_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_scheduled_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_scheduled_messages_tenant_isolation ON chat_scheduled_messages
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE chat_saved_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_saved_items FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_saved_items_tenant_isolation ON chat_saved_items
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE chat_sidebar_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sidebar_sections FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_sidebar_sections_tenant_isolation ON chat_sidebar_sections
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE chat_sidebar_section_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sidebar_section_items FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_sidebar_section_items_tenant_isolation ON chat_sidebar_section_items
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE chat_channel_bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_channel_bookmarks FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_channel_bookmarks_tenant_isolation ON chat_channel_bookmarks
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE chat_pinned_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_pinned_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_pinned_messages_tenant_isolation ON chat_pinned_messages
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE user_workspace_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_workspace_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY user_workspace_profiles_tenant_isolation ON user_workspace_profiles
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE user_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY user_groups_tenant_isolation ON user_groups
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE user_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_group_members FORCE ROW LEVEL SECURITY;
CREATE POLICY user_group_members_tenant_isolation ON user_group_members
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE chat_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_polls FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_polls_tenant_isolation ON chat_polls
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE chat_poll_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_poll_votes FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_poll_votes_tenant_isolation ON chat_poll_votes
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE file_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_transcripts FORCE ROW LEVEL SECURITY;
CREATE POLICY file_transcripts_tenant_isolation ON file_transcripts
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE chat_huddle_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_huddle_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_huddle_sessions_tenant_isolation ON chat_huddle_sessions
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE contact_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY contact_organizations_tenant_isolation ON contact_organizations
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY contacts_tenant_isolation ON contacts
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE mail_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_tags FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_tags_tenant_isolation ON mail_tags
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE mail_conversation_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_conversation_tags FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_conversation_tags_tenant_isolation ON mail_conversation_tags
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE mail_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_templates_tenant_isolation ON mail_templates
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE mail_macros ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_macros FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_macros_tenant_isolation ON mail_macros
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE mail_sla_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_sla_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_sla_policies_tenant_isolation ON mail_sla_policies
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

ALTER TABLE mail_inbox_routing_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_inbox_routing_state FORCE ROW LEVEL SECURITY;
CREATE POLICY mail_inbox_routing_state_tenant_isolation ON mail_inbox_routing_state
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ---------- 7. Grants ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON
	workspace_emojis,
	chat_drafts,
	chat_scheduled_messages,
	chat_saved_items,
	chat_sidebar_sections,
	chat_sidebar_section_items,
	chat_channel_bookmarks,
	chat_pinned_messages,
	user_workspace_profiles,
	user_groups,
	user_group_members,
	chat_polls,
	chat_poll_votes,
	file_transcripts,
	chat_huddle_sessions,
	contact_organizations,
	contacts,
	mail_tags,
	mail_conversation_tags,
	mail_templates,
	mail_macros,
	mail_sla_policies,
	mail_inbox_routing_state
TO huriro_app;

GRANT SELECT ON
	workspace_emojis,
	chat_drafts,
	chat_scheduled_messages,
	chat_saved_items,
	chat_sidebar_sections,
	chat_sidebar_section_items,
	chat_channel_bookmarks,
	chat_pinned_messages,
	user_workspace_profiles,
	user_groups,
	user_group_members,
	chat_polls,
	chat_poll_votes,
	file_transcripts,
	chat_huddle_sessions,
	contact_organizations,
	contacts,
	mail_tags,
	mail_conversation_tags,
	mail_templates,
	mail_macros,
	mail_sla_policies,
	mail_inbox_routing_state
TO huriro_maint;
