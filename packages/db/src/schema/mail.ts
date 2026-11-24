// Mail (shared inbox) tables — owned by the `mail` module (§5.4, §14.3).
import { sql } from 'drizzle-orm'
import {
	boolean,
	foreignKey,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uuid
} from 'drizzle-orm/pg-core'
import { docPages } from './docs'
import { files } from './files'
import { users } from './identity'
import { issues } from './tasks'
import { workspaces } from './tenancy'

export const mailInboxes = pgTable(
	'mail_inboxes',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		position: text('position').notNull(),
		settings: jsonb('settings').notNull().default({}),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_mail_inboxes_ws_id').on(t.workspaceId, t.id),
		unique('uq_mail_inboxes_ws_name').on(t.workspaceId, t.name)
	]
)

export const mailAccounts = pgTable(
	'mail_accounts',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		provider: text('provider', { enum: ['inbound_parse', 'gmail', 'graph', 'imap', 'jmap'] }).notNull(),
		address: text('address').notNull(), // citext in SQL
		displayName: text('display_name'),
		credentialsEncrypted: text('credentials_encrypted'),
		config: jsonb('config').notNull().default({}),
		syncState: jsonb('sync_state').notNull().default({}),
		defaultInboxId: uuid('default_inbox_id'),
		status: text('status', { enum: ['active', 'pending_verification', 'error', 'disconnected'] })
			.notNull()
			.default('active'),
		statusDetail: text('status_detail'),
		lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_mail_accounts_ws_id').on(t.workspaceId, t.id),
		unique('uq_mail_accounts_ws_address').on(t.workspaceId, t.address),
		foreignKey({
			columns: [t.workspaceId, t.defaultInboxId],
			foreignColumns: [mailInboxes.workspaceId, mailInboxes.id],
			name: 'mail_accounts_workspace_id_default_inbox_id_fkey'
		}).onDelete('set null')
	]
)

export const mailIdentities = pgTable(
	'mail_identities',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		accountId: uuid('account_id').notNull(),
		address: text('address').notNull(), // citext in SQL
		displayName: text('display_name'),
		signature: jsonb('signature').notNull().default({}),
		isDefault: boolean('is_default').notNull().default(false),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_mail_identities_ws_id').on(t.workspaceId, t.id),
		unique('uq_mail_identities_addr').on(t.workspaceId, t.accountId, t.address, t.displayName),
		foreignKey({
			columns: [t.workspaceId, t.accountId],
			foreignColumns: [mailAccounts.workspaceId, mailAccounts.id],
			name: 'fk_mail_identities_account'
		}).onDelete('cascade')
	]
)

export const mailConversations = pgTable(
	'mail_conversations',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		inboxId: uuid('inbox_id').notNull(),
		accountId: uuid('account_id').notNull(),
		subject: text('subject').notNull(),
		normalizedSubject: text('normalized_subject').notNull(),
		status: text('status', { enum: ['open', 'pending', 'snoozed', 'closed', 'spam'] })
			.notNull()
			.default('open'),
		assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
		snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
		mergedIntoId: uuid('merged_into_id'),
		lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull(),
		firstReplyAt: timestamp('first_reply_at', { withTimezone: true }),
		customerEmail: text('customer_email'), // citext in SQL
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_mail_conversations_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.inboxId],
			foreignColumns: [mailInboxes.workspaceId, mailInboxes.id],
			name: 'fk_mail_conversations_inbox'
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.workspaceId, t.accountId],
			foreignColumns: [mailAccounts.workspaceId, mailAccounts.id],
			name: 'fk_mail_conversations_account'
		}).onDelete('cascade')
		// Self-FK fk_mail_conversations_merged_into lives in the migration only;
		// declaring it here would make the table's type self-referential (implicit any).
	]
)

export const mailMessages = pgTable(
	'mail_messages',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		conversationId: uuid('conversation_id').notNull(),
		accountId: uuid('account_id').notNull(),
		direction: text('direction', { enum: ['inbound', 'outbound'] }).notNull(),
		rfcMessageId: text('rfc_message_id'),
		inReplyTo: text('in_reply_to'),
		referencesIds: text('references_ids').array().notNull().default([]),
		fromAddr: jsonb('from_addr').notNull(),
		toAddrs: jsonb('to_addrs').notNull().default([]),
		ccAddrs: jsonb('cc_addrs').notNull().default([]),
		subject: text('subject'),
		snippet: text('snippet').notNull().default(''),
		sentAt: timestamp('sent_at', { withTimezone: true }),
		receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
		rawBlobKey: text('raw_blob_key'),
		bodyHtml: text('body_html'),
		bodyText: text('body_text'),
		attachments: jsonb('attachments').notNull().default([]),
		authResults: jsonb('auth_results'),
		providerRef: jsonb('provider_ref').notNull().default({}),
		sendState: text('send_state', { enum: ['queued', 'sending', 'sent', 'delivered', 'bounced', 'failed'] }),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_mail_messages_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.conversationId],
			foreignColumns: [mailConversations.workspaceId, mailConversations.id],
			name: 'fk_mail_messages_conversation'
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.workspaceId, t.accountId],
			foreignColumns: [mailAccounts.workspaceId, mailAccounts.id],
			name: 'fk_mail_messages_account'
		}).onDelete('cascade')
	]
)

export const mailConversationEvents = pgTable(
	'mail_conversation_events',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		conversationId: uuid('conversation_id').notNull(),
		kind: text('kind', {
			enum: [
				'assigned',
				'unassigned',
				'status_changed',
				'merged',
				'linked',
				'unlinked',
				'snoozed',
				'note_added',
				'converted'
			]
		}).notNull(),
		actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
		payload: jsonb('payload').notNull().default({}),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_mail_conversation_events_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.conversationId],
			foreignColumns: [mailConversations.workspaceId, mailConversations.id],
			name: 'fk_mail_conversation_events_conv'
		}).onDelete('cascade')
	]
)

export const mailConversationComments = pgTable(
	'mail_conversation_comments',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		conversationId: uuid('conversation_id').notNull(),
		authorId: uuid('author_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		body: jsonb('body').notNull(),
		bodyText: text('body_text').notNull().default(''),
		mentions: uuid('mentions').array().notNull().default([]),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_mail_conversation_comments_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.conversationId],
			foreignColumns: [mailConversations.workspaceId, mailConversations.id],
			name: 'fk_mail_conversation_comments_conv'
		}).onDelete('cascade')
	]
)

export const mailDrafts = pgTable(
	'mail_drafts',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		conversationId: uuid('conversation_id').notNull(),
		identityId: uuid('identity_id').notNull(),
		createdBy: uuid('created_by')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		lastEditedBy: uuid('last_edited_by').references(() => users.id, { onDelete: 'set null' }),
		body: jsonb('body').notNull(),
		bodyText: text('body_text').notNull().default(''),
		recipients: jsonb('recipients').notNull(),
		inReplyToId: uuid('in_reply_to_id'),
		scheduledSendAt: timestamp('scheduled_send_at', { withTimezone: true }),
		status: text('status', { enum: ['draft', 'sending', 'sent', 'discarded'] })
			.notNull()
			.default('draft'),
		sentMessageId: uuid('sent_message_id'),
		lockedBy: uuid('locked_by').references(() => users.id, { onDelete: 'set null' }),
		lockedUntil: timestamp('locked_until', { withTimezone: true }),
		version: integer('version').notNull().default(1),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_mail_drafts_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.conversationId],
			foreignColumns: [mailConversations.workspaceId, mailConversations.id],
			name: 'fk_mail_drafts_conversation'
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.workspaceId, t.identityId],
			foreignColumns: [mailIdentities.workspaceId, mailIdentities.id],
			name: 'fk_mail_drafts_identity'
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.workspaceId, t.inReplyToId],
			foreignColumns: [mailMessages.workspaceId, mailMessages.id],
			name: 'fk_mail_drafts_in_reply_to'
		}).onDelete('set null'),
		foreignKey({
			columns: [t.workspaceId, t.sentMessageId],
			foreignColumns: [mailMessages.workspaceId, mailMessages.id],
			name: 'fk_mail_drafts_sent_message'
		}).onDelete('set null')
	]
)

export const mailConversationTasks = pgTable(
	'mail_conversation_tasks',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		conversationId: uuid('conversation_id').notNull(),
		taskId: uuid('task_id').notNull(),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.workspaceId, t.conversationId, t.taskId] }),
		foreignKey({
			columns: [t.workspaceId, t.conversationId],
			foreignColumns: [mailConversations.workspaceId, mailConversations.id],
			name: 'fk_mail_conversation_tasks_conv'
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.workspaceId, t.taskId],
			foreignColumns: [issues.workspaceId, issues.id],
			name: 'fk_mail_conversation_tasks_issue'
		}).onDelete('cascade')
	]
)

export const mailConversationDocs = pgTable(
	'mail_conversation_docs',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		conversationId: uuid('conversation_id').notNull(),
		pageId: uuid('page_id').notNull(),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.workspaceId, t.conversationId, t.pageId] }),
		foreignKey({
			columns: [t.workspaceId, t.conversationId],
			foreignColumns: [mailConversations.workspaceId, mailConversations.id],
			name: 'fk_mail_conversation_docs_conv'
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.workspaceId, t.pageId],
			foreignColumns: [docPages.workspaceId, docPages.id],
			name: 'fk_mail_conversation_docs_page'
		}).onDelete('cascade')
	]
)

export const mailMessageAttachments = pgTable(
	'mail_message_attachments',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		messageId: uuid('message_id').notNull(),
		fileId: uuid('file_id').notNull(),
		position: integer('position').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.workspaceId, t.messageId, t.fileId] }),
		foreignKey({
			columns: [t.workspaceId, t.messageId],
			foreignColumns: [mailMessages.workspaceId, mailMessages.id],
			name: 'fk_mail_message_attachments_msg'
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.workspaceId, t.fileId],
			foreignColumns: [files.workspaceId, files.id],
			name: 'fk_mail_message_attachments_file'
		}).onDelete('cascade')
	]
)
