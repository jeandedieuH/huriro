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
