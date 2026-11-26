// Chat tables — owned by the `chat` module (§5.4, §15.1).
import { sql } from 'drizzle-orm'
import {
	bigint,
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
import { files } from './files'
import { users } from './identity'
import { workspaces } from './tenancy'

export const chatChannels = pgTable(
	'chat_channels',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: ['public', 'private', 'dm'] })
			.notNull()
			.default('public'),
		name: text('name'),
		topic: text('topic').notNull().default(''),
		dmKey: text('dm_key'),
		canvasPageId: uuid('canvas_page_id'),
		lastMsgSeq: bigint('last_msg_seq', { mode: 'number' }).notNull().default(0),
		lastRev: bigint('last_rev', { mode: 'number' }).notNull().default(0),
		createdBy: uuid('created_by')
			.notNull()
			.references(() => users.id),
		archivedAt: timestamp('archived_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_chat_channels_ws_id').on(t.workspaceId, t.id),
		unique('uq_chat_channels_ws_name').on(t.workspaceId, t.name)
	]
)

export const chatChannelMembers = pgTable(
	'chat_channel_members',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		channelId: uuid('channel_id').notNull(),
		principalType: text('principal_type', { enum: ['user', 'agent'] })
			.notNull()
			.default('user'),
		principalId: uuid('principal_id').notNull(),
		role: text('role', { enum: ['member', 'admin'] })
			.notNull()
			.default('member'),
		position: text('position'),
		joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.workspaceId, t.channelId, t.principalType, t.principalId] }),
		foreignKey({
			columns: [t.workspaceId, t.channelId],
			foreignColumns: [chatChannels.workspaceId, chatChannels.id],
			name: 'fk_chat_channel_members_channel'
		}).onDelete('cascade')
	]
)

export const chatMessages = pgTable(
	'chat_messages',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		channelId: uuid('channel_id').notNull(),
		channelSeq: bigint('channel_seq', { mode: 'number' }),
		threadSeq: bigint('thread_seq', { mode: 'number' }),
		rev: bigint('rev', { mode: 'number' }).notNull(),
		authorType: text('author_type', { enum: ['user', 'agent'] })
			.notNull()
			.default('user'),
		authorId: uuid('author_id').notNull(),
		threadParentId: uuid('thread_parent_id'),
		lastThreadSeq: bigint('last_thread_seq', { mode: 'number' }).notNull().default(0),
		replyCount: integer('reply_count').notNull().default(0),
		lastReplyAt: timestamp('last_reply_at', { withTimezone: true }),
		clientId: text('client_id'),
		broadcastToChannel: boolean('broadcast_to_channel').notNull().default(false),
		replyToMessageId: uuid('reply_to_message_id'),
		messageKind: text('message_kind', { enum: ['text', 'poll', 'huddle_session', 'approval_card', 'system'] })
			.notNull()
			.default('text'),
		metadata: jsonb('metadata').notNull().default({}),
		body: jsonb('body').notNull().default({}),
		bodyText: text('body_text').notNull(),
		editedAt: timestamp('edited_at', { withTimezone: true }),
		deletedAt: timestamp('deleted_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_chat_messages_ws_id').on(t.workspaceId, t.id),
		unique('uq_chat_messages_chan_seq').on(t.workspaceId, t.channelId, t.channelSeq),
		unique('uq_chat_messages_thread_seq').on(t.workspaceId, t.threadParentId, t.threadSeq),
		foreignKey({
			columns: [t.workspaceId, t.channelId],
			foreignColumns: [chatChannels.workspaceId, chatChannels.id],
			name: 'fk_chat_messages_channel'
		}).onDelete('cascade')
	]
)

export const chatMessageReactions = pgTable(
	'chat_message_reactions',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		messageId: uuid('message_id').notNull(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		emoji: text('emoji').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.workspaceId, t.messageId, t.userId, t.emoji] }),
		foreignKey({
			columns: [t.workspaceId, t.messageId],
			foreignColumns: [chatMessages.workspaceId, chatMessages.id],
			name: 'fk_chat_message_reactions_msg'
		}).onDelete('cascade')
	]
)

export const chatReadState = pgTable(
	'chat_read_state',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		channelId: uuid('channel_id').notNull(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		lastReadSeq: bigint('last_read_seq', { mode: 'number' }).notNull().default(0),
		mentionCount: integer('mention_count').notNull().default(0),
		muted: boolean('muted').notNull().default(false),
		notifyLevel: text('notify_level', { enum: ['default', 'all', 'mentions', 'none'] })
			.notNull()
			.default('default'),
		mutedUntil: timestamp('muted_until', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.workspaceId, t.channelId, t.userId] }),
		foreignKey({
			columns: [t.workspaceId, t.channelId],
			foreignColumns: [chatChannels.workspaceId, chatChannels.id],
			name: 'fk_chat_read_state_channel'
		}).onDelete('cascade')
	]
)

export const chatThreadReadState = pgTable(
	'chat_thread_read_state',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		channelId: uuid('channel_id').notNull(),
		threadParentId: uuid('thread_parent_id').notNull(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		lastReadThreadSeq: bigint('last_read_thread_seq', { mode: 'number' }).notNull().default(0),
		subscribed: boolean('subscribed').notNull().default(true),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.workspaceId, t.threadParentId, t.userId] }),
		foreignKey({
			columns: [t.workspaceId, t.channelId],
			foreignColumns: [chatChannels.workspaceId, chatChannels.id],
			name: 'fk_chat_thread_read_state_channel'
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.workspaceId, t.threadParentId],
			foreignColumns: [chatMessages.workspaceId, chatMessages.id],
			name: 'fk_chat_thread_read_state_parent'
		}).onDelete('cascade')
	]
)

export const chatMessageAttachments = pgTable(
	'chat_message_attachments',
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
			foreignColumns: [chatMessages.workspaceId, chatMessages.id],
			name: 'fk_chat_message_attachments_msg'
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.workspaceId, t.fileId],
			foreignColumns: [files.workspaceId, files.id],
			name: 'fk_chat_message_attachments_file'
		}).onDelete('cascade')
	]
)

export const chatLinkPreviews = pgTable(
	'chat_link_previews',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		url: text('url').notNull(),
		urlHash: text('url_hash').notNull(),
		canonicalUrl: text('canonical_url'),
		title: text('title').notNull().default(''),
		description: text('description').notNull().default(''),
		siteName: text('site_name').notNull().default(''),
		imageUrl: text('image_url'),
		status: text('status', { enum: ['pending', 'ok', 'blocked', 'failed'] })
			.notNull()
			.default('pending'),
		errorDetail: text('error_detail'),
		fetchedAt: timestamp('fetched_at', { withTimezone: true }),
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_chat_link_previews_ws_id').on(t.workspaceId, t.id),
		unique('uq_chat_link_previews_ws_hash').on(t.workspaceId, t.urlHash)
	]
)

export const chatMessageLinkPreviews = pgTable(
	'chat_message_link_previews',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		messageId: uuid('message_id').notNull(),
		previewId: uuid('preview_id').notNull(),
		position: integer('position').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.workspaceId, t.messageId, t.previewId] }),
		foreignKey({
			columns: [t.workspaceId, t.messageId],
			foreignColumns: [chatMessages.workspaceId, chatMessages.id],
			name: 'fk_chat_message_previews_msg'
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.workspaceId, t.previewId],
			foreignColumns: [chatLinkPreviews.workspaceId, chatLinkPreviews.id],
			name: 'fk_chat_message_previews_preview'
		}).onDelete('cascade')
	]
)

// ---------- M11 Slack-parity expansion (migration 0027) ----------

export const workspaceEmojis = pgTable(
	'workspace_emojis',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		shortcode: text('shortcode').notNull(),
		fileId: uuid('file_id').notNull(),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_workspace_emojis_ws_id').on(t.workspaceId, t.id),
		unique('uq_workspace_emojis_shortcode').on(t.workspaceId, t.shortcode),
		foreignKey({
			columns: [t.workspaceId, t.fileId],
			foreignColumns: [files.workspaceId, files.id],
			name: 'fk_workspace_emojis_file'
		}).onDelete('cascade')
	]
)

export const chatDrafts = pgTable(
	'chat_drafts',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		channelId: uuid('channel_id').notNull(),
		threadParentId: uuid('thread_parent_id'),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		body: jsonb('body').notNull().default({}),
		bodyText: text('body_text').notNull().default(''),
		attachmentFileIds: uuid('attachment_file_ids').array().notNull().default([]),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_chat_drafts_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.channelId],
			foreignColumns: [chatChannels.workspaceId, chatChannels.id],
			name: 'fk_chat_drafts_channel'
		}).onDelete('cascade')
	]
)

export const chatScheduledMessages = pgTable(
	'chat_scheduled_messages',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		channelId: uuid('channel_id').notNull(),
		threadParentId: uuid('thread_parent_id'),
		authorId: uuid('author_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		body: jsonb('body').notNull().default({}),
		bodyText: text('body_text').notNull(),
		attachmentFileIds: uuid('attachment_file_ids').array().notNull().default([]),
		scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
		status: text('status', { enum: ['scheduled', 'sent', 'cancelled', 'failed'] })
			.notNull()
			.default('scheduled'),
		sentMessageId: uuid('sent_message_id'),
		errorDetail: text('error_detail'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_chat_scheduled_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.channelId],
			foreignColumns: [chatChannels.workspaceId, chatChannels.id],
			name: 'fk_chat_scheduled_channel'
		}).onDelete('cascade')
	]
)

export const chatSavedItems = pgTable(
	'chat_saved_items',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		messageId: uuid('message_id'),
		customText: text('custom_text').notNull().default(''),
		note: text('note').notNull().default(''),
		status: text('status', { enum: ['saved', 'in_progress', 'archived', 'completed'] })
			.notNull()
			.default('saved'),
		remindAt: timestamp('remind_at', { withTimezone: true }),
		remindedAt: timestamp('reminded_at', { withTimezone: true }),
		completedAt: timestamp('completed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [unique('uq_chat_saved_items_ws_id').on(t.workspaceId, t.id)]
)

export const chatSidebarSections = pgTable(
	'chat_sidebar_sections',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		position: text('position').notNull(),
		collapsed: boolean('collapsed').notNull().default(false),
		unreadOnly: boolean('unread_only').notNull().default(false),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_chat_sidebar_sections_ws_id').on(t.workspaceId, t.id),
		unique('uq_chat_sidebar_sections_name').on(t.workspaceId, t.userId, t.name)
	]
)

export const chatSidebarSectionItems = pgTable(
	'chat_sidebar_section_items',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		sectionId: uuid('section_id').notNull(),
		channelId: uuid('channel_id').notNull(),
		position: text('position').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.workspaceId, t.sectionId, t.channelId] }),
		foreignKey({
			columns: [t.workspaceId, t.sectionId],
			foreignColumns: [chatSidebarSections.workspaceId, chatSidebarSections.id],
			name: 'fk_chat_sidebar_items_section'
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.workspaceId, t.channelId],
			foreignColumns: [chatChannels.workspaceId, chatChannels.id],
			name: 'fk_chat_sidebar_items_channel'
		}).onDelete('cascade')
	]
)

export const chatChannelBookmarks = pgTable(
	'chat_channel_bookmarks',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		channelId: uuid('channel_id').notNull(),
		targetType: text('target_type', {
			enum: ['issue', 'saved_view', 'doc_page', 'mail_inbox', 'external_url']
		}).notNull(),
		targetId: uuid('target_id'),
		title: text('title').notNull(),
		url: text('url'),
		icon: text('icon'),
		folder: text('folder'),
		position: text('position').notNull(),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_chat_channel_bookmarks_ws_id').on(t.workspaceId, t.id),
		foreignKey({
			columns: [t.workspaceId, t.channelId],
			foreignColumns: [chatChannels.workspaceId, chatChannels.id],
			name: 'fk_chat_bookmarks_channel'
		}).onDelete('cascade')
	]
)

export const chatPinnedMessages = pgTable(
	'chat_pinned_messages',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		channelId: uuid('channel_id').notNull(),
		messageId: uuid('message_id').notNull(),
		pinnedBy: uuid('pinned_by').references(() => users.id, { onDelete: 'set null' }),
		position: text('position').notNull().default('a0'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.workspaceId, t.channelId, t.messageId] })]
)

export const userGroups = pgTable(
	'user_groups',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		handle: text('handle').notNull(),
		name: text('name').notNull(),
		description: text('description').notNull().default(''),
		autoJoinChannelIds: uuid('auto_join_channel_ids').array().notNull().default([]),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_user_groups_ws_id').on(t.workspaceId, t.id),
		unique('uq_user_groups_handle').on(t.workspaceId, t.handle)
	]
)

export const userGroupMembers = pgTable(
	'user_group_members',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		groupId: uuid('group_id').notNull(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.workspaceId, t.groupId, t.userId] }),
		foreignKey({
			columns: [t.workspaceId, t.groupId],
			foreignColumns: [userGroups.workspaceId, userGroups.id],
			name: 'fk_user_group_members_group'
		}).onDelete('cascade')
	]
)

export const chatPolls = pgTable(
	'chat_polls',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		channelId: uuid('channel_id').notNull(),
		messageId: uuid('message_id').notNull(),
		question: text('question').notNull(),
		options: jsonb('options').notNull(),
		multiChoice: boolean('multi_choice').notNull().default(false),
		anonymous: boolean('anonymous').notNull().default(false),
		status: text('status', { enum: ['open', 'closed'] })
			.notNull()
			.default('open'),
		closesAt: timestamp('closes_at', { withTimezone: true }),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_chat_polls_ws_id').on(t.workspaceId, t.id),
		unique('uq_chat_polls_message').on(t.workspaceId, t.messageId)
	]
)

export const chatPollVotes = pgTable(
	'chat_poll_votes',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		pollId: uuid('poll_id').notNull(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		optionIds: text('option_ids').array().notNull().default([]),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.workspaceId, t.pollId, t.userId] }),
		foreignKey({
			columns: [t.workspaceId, t.pollId],
			foreignColumns: [chatPolls.workspaceId, chatPolls.id],
			name: 'fk_chat_poll_votes_poll'
		}).onDelete('cascade')
	]
)

export const fileTranscripts = pgTable(
	'file_transcripts',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		fileId: uuid('file_id').notNull(),
		status: text('status', { enum: ['pending', 'ready', 'failed'] })
			.notNull()
			.default('pending'),
		transcript: text('transcript').notNull().default(''),
		language: text('language'),
		provider: text('provider'),
		errorDetail: text('error_detail'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_file_transcripts_ws_id').on(t.workspaceId, t.id),
		unique('uq_file_transcripts_file').on(t.workspaceId, t.fileId),
		foreignKey({
			columns: [t.workspaceId, t.fileId],
			foreignColumns: [files.workspaceId, files.id],
			name: 'fk_file_transcripts_file'
		}).onDelete('cascade')
	]
)

export const chatHuddleSessions = pgTable(
	'chat_huddle_sessions',
	{
		id: uuid('id').primaryKey().default(sql`uuidv7()`),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		channelId: uuid('channel_id').notNull(),
		messageId: uuid('message_id'),
		roomName: text('room_name').notNull(),
		status: text('status', { enum: ['active', 'ended'] })
			.notNull()
			.default('active'),
		startedBy: uuid('started_by').references(() => users.id, { onDelete: 'set null' }),
		endedBy: uuid('ended_by').references(() => users.id, { onDelete: 'set null' }),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
		endedAt: timestamp('ended_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		version: integer('version').notNull().default(1)
	},
	(t) => [
		unique('uq_chat_huddles_ws_id').on(t.workspaceId, t.id),
		unique('uq_chat_huddles_room').on(t.workspaceId, t.roomName),
		foreignKey({
			columns: [t.workspaceId, t.channelId],
			foreignColumns: [chatChannels.workspaceId, chatChannels.id],
			name: 'fk_chat_huddles_channel'
		}).onDelete('cascade')
	]
)
