/**
 * Mail service (§14): accounts/identities/inboxes, conversation timeline,
 * drafts + soft lock + undo-send, links & convert-to-issue, inbound ingest,
 * provider sync, retention & export. All tenant work happens inside
 * `withWorkspace` — worker entry points receive a tx from the outbox drain.
 */
import { createHash, randomBytes } from 'node:crypto'
import type {
	ConvertToIssueBody,
	CreateMailAccountBody,
	CreateMailIdentityBody,
	CreateMailInboxBody,
	CreateMailNoteBody,
	ListConversationsQuery,
	MailAccountDto,
	MailConversationDto,
	MailDraftDto,
	MailIdentityDto,
	MailInboxDto,
	MailMessageDto,
	MailNoteDto,
	MailTimelineDto,
	MergeConversationsBody,
	UpdateConversationBody,
	UpdateMailAccountBody,
	UpsertMailDraftBody
} from '@huriro/contracts'
import { type Queryable, uuid7 } from '@huriro/db'
import {
	type ActorContext,
	generateKeyBetween,
	isPlausibleEmail,
	normalizeEmail,
	normalizeMailSubject
} from '@huriro/domain'
import { prosemirrorJsonToYDoc } from '@huriro/editor'
import * as Y from 'yjs'
import { appendChanges } from '../../api/changelog'
import { decryptSecret, encryptSecret } from '../../api/crypto'
import { deleteEntityLinkByEndpoints, insertEntityLink } from '../../api/entity-links'
import { HttpError } from '../../api/error'
import { type BlobStorage, getFilesByIdsForAttachment, ingestInboundAttachmentFile } from '../files'
import { createIssue } from '../tasks'
import { grantAcl, resolveResourceAcl } from '../tenancy'
import { issueMailDraftCollabTicket } from './collab'
import { MAIL_EVENTS } from './events'
import { MAIL_PARSE_LIMITS, MimeParseError, type ParsedMime, parseMime } from './mime'
import {
	accessibleInboxIds,
	authorizeMailAccountAction,
	authorizeMailInboxAction,
	authorizeMailWorkspaceAction,
	canAccessMailInbox,
	isAdminMailBypass
} from './policy'
import {
	buildDomainRecords,
	createGmailPoller,
	createGmailTransport,
	createGraphPoller,
	createGraphTransport,
	createImapPoller,
	createSmtpTransport,
	type DnsLike,
	hashInboundToken,
	type MailPoller,
	MailProviderError,
	type MailTransport,
	nodeDnsResolver,
	type OAuthCredentials,
	refreshOAuthToken,
	verifyDomainRecords
} from './providers'
import * as repo from './repo'

const MAIL_CONSUMER = 'mail'

// ---------- DTO mappers ----------

function toAccountDto(
	r: repo.MailAccountRow,
	extras?: {
		readonly inboundUrl?: string | null
		readonly domainRecords?: readonly Record<string, string>[] | undefined
	}
): MailAccountDto {
	return {
		id: r.id,
		workspaceId: r.workspaceId,
		provider: r.provider,
		address: r.address,
		displayName: r.displayName,
		defaultInboxId: r.defaultInboxId,
		status: r.status,
		statusDetail: r.statusDetail,
		lastSyncedAt: r.lastSyncedAt,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
		version: r.version,
		inboundUrl: extras?.inboundUrl ?? null,
		...(extras?.domainRecords ? { domainRecords: [...extras.domainRecords] } : {})
	}
}

function toIdentityDto(r: repo.MailIdentityRow): MailIdentityDto {
	return {
		id: r.id,
		accountId: r.accountId,
		address: r.address,
		displayName: r.displayName,
		isDefault: r.isDefault,
		createdAt: r.createdAt
	}
}

function toInboxDto(r: repo.MailInboxRow): MailInboxDto {
	return {
		id: r.id,
		workspaceId: r.workspaceId,
		name: r.name,
		position: r.position,
		settings: r.settings,
		visibility: r.visibility ?? 'shared',
		ownerUserId: r.ownerUserId ?? null,
		openCount: r.openCount ?? 0,
		version: r.version,
		createdAt: r.createdAt
	}
}

function toConversationDto(
	r: repo.MailConversationRow & { assigneeName?: string | null }
): MailConversationDto {
	return {
		id: r.id,
		workspaceId: r.workspaceId,
		inboxId: r.inboxId,
		accountId: r.accountId,
		subject: r.subject,
		status: r.status,
		assigneeId: r.assigneeId,
		assigneeName: r.assigneeName ?? null,
		snoozedUntil: r.snoozedUntil,
		mergedIntoId: r.mergedIntoId,
		lastMessageAt: r.lastMessageAt,
		firstReplyAt: r.firstReplyAt,
		customerEmail: r.customerEmail,
		contactId: r.contactId ?? null,
		followUpAt: r.followUpAt ?? null,
		followUpCondition: r.followUpCondition ?? null,
		slaNextDueAt: r.slaNextDueAt ?? null,
		slaBreachedAt: r.slaBreachedAt ?? null,
		priority: r.priority ?? 'normal',
		snippet: r.snippet ?? '',
		messageCount: r.messageCount ?? 0,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
		version: r.version
	}
}

function toMessageDto(r: repo.MailMessageRow): MailMessageDto {
	return {
		id: r.id,
		conversationId: r.conversationId,
		direction: r.direction,
		rfcMessageId: r.rfcMessageId,
		fromAddr: { email: r.fromAddr.email, name: r.fromAddr.name ?? null },
		toAddrs: r.toAddrs.map((a) => ({ email: a.email, name: a.name ?? null })),
		ccAddrs: r.ccAddrs.map((a) => ({ email: a.email, name: a.name ?? null })),
		subject: r.subject,
		snippet: r.snippet,
		sentAt: r.sentAt,
		receivedAt: r.receivedAt,
		bodyHtml: r.bodyHtml,
		bodyText: r.bodyText,
		attachments: r.attachments.map((a) => ({
			fileId: typeof a['fileId'] === 'string' ? a['fileId'] : null,
			name: String(a['name'] ?? 'attachment'),
			contentType: String(a['contentType'] ?? 'application/octet-stream'),
			byteSize: Number(a['byteSize'] ?? 0),
			...(typeof a['scanStatus'] === 'string' ? { scanStatus: a['scanStatus'] } : {})
		})),
		authResults: r.authResults
			? {
					spf: typeof r.authResults['spf'] === 'string' ? r.authResults['spf'] : null,
					dkim: typeof r.authResults['dkim'] === 'string' ? r.authResults['dkim'] : null,
					dmarc: typeof r.authResults['dmarc'] === 'string' ? r.authResults['dmarc'] : null
				}
			: null,
		sendState: r.sendState,
		createdBy: r.createdBy,
		createdAt: r.createdAt
	}
}

function toDraftDto(r: repo.MailDraftRow): MailDraftDto {
	return {
		id: r.id,
		conversationId: r.conversationId,
		identityId: r.identityId,
		createdBy: r.createdBy,
		body: r.body,
		bodyText: r.bodyText,
		recipients: r.recipients,
		inReplyToId: r.inReplyToId,
		scheduledSendAt: r.scheduledSendAt,
		status: r.status,
		lockedBy: r.lockedBy,
		lockedUntil: r.lockedUntil,
		collabEnabled: r.collabEnabled ?? false,
		reviewStatus: r.reviewStatus ?? 'none',
		reviewerId: r.reviewerId ?? null,
		reviewedAt: r.reviewedAt ?? null,
		reviewNote: r.reviewNote ?? null,
		metadata: r.metadata ?? {},
		version: r.version,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt
	}
}

function toNoteDto(r: repo.MailCommentRow): MailNoteDto {
	return {
		id: r.id,
		conversationId: r.conversationId,
		authorId: r.authorId,
		authorName: r.authorName ?? null,
		body: r.body,
		bodyText: r.bodyText,
		mentions: [...r.mentions],
		createdAt: r.createdAt
	}
}

// ---------- helpers ----------

/** Accounts the actor may read — workspace-visible ones, plus ACL-granted private ones. */
async function accessibleAccountIds(tx: Queryable, actor: ActorContext): Promise<string[] | null> {
	if (isAdminMailBypass(actor)) return null // admin sees all
	const accounts = await repo.listMailAccounts(tx, actor.workspaceId)
	const out: string[] = []
	for (const a of accounts) {
		const vis = (a.config['visibility'] as string | undefined) === 'private' ? 'private' : 'workspace'
		if (vis === 'workspace') {
			out.push(a.id)
			continue
		}
		const acl = await resolveResourceAcl(tx, {
			workspaceId: actor.workspaceId,
			resourceType: 'mail_account',
			resourceId: a.id,
			userId: actor.userId
		})
		if (acl !== null) out.push(a.id)
	}
	return out
}

function accountVisibility(account: repo.MailAccountRow): 'workspace' | 'private' {
	return (account.config['visibility'] as string | undefined) === 'private' ? 'private' : 'workspace'
}

/**
 * Inbound-parse webhook URL. The webhook resolves by the raw token (hash in
 * config), never the account id — the token stays in config so self-host
 * operators can re-copy the URL from settings. config is never in the DTO.
 */
function inboundUrlFor(account: repo.MailAccountRow, cfg: MailModuleConfig): string | null {
	if (account.provider !== 'inbound_parse' || !cfg.publicBaseUrl) return null
	const token = account.config['inbound_token']
	return typeof token === 'string' && token.length > 0
		? `${cfg.publicBaseUrl}/api/v1/mail/inbound/${token}`
		: null
}

/** Fetch conversation + its account and authorize `action` against the account. */
async function requireConversation(
	tx: Queryable,
	actor: ActorContext,
	conversationId: string,
	action: 'mail.read' | 'mail.assign' | 'mail.send'
): Promise<{ conversation: repo.MailConversationRow; account: repo.MailAccountRow }> {
	const conversation = await repo.getMailConversation(tx, actor.workspaceId, conversationId)
	if (!conversation) throw new HttpError(404, 'not_found', 'Conversation not found')
	const account = await repo.getMailAccount(tx, actor.workspaceId, conversation.accountId)
	if (!account) throw new HttpError(404, 'not_found', 'Mail account not found')
	await authorizeMailAccountAction(tx, actor, action, {
		id: account.id,
		visibility: accountVisibility(account)
	})
	const inbox = await repo.getMailInbox(tx, actor.workspaceId, conversation.inboxId)
	if (!inbox) throw new HttpError(404, 'not_found', 'Mail inbox not found')
	await authorizeMailInboxAction(tx, actor, action, inbox)
	return { conversation, account }
}

export interface MailConversationEndpoint {
	readonly id: string
	readonly subject: string
	readonly status: string
	readonly inboxId: string
	readonly inboxName: string | null
	readonly accountId: string
	readonly customerEmail: string | null
	readonly updatedAt: string
}

/**
 * Cross-module conversation access seam for the entity graph. Authorization is
 * the owning account's normal mail policy; the small projection avoids loading
 * the whole timeline for hover/traversal checks.
 */
export async function requireMailConversationAccess(
	tx: Queryable,
	actor: ActorContext,
	conversationId: string,
	action: 'mail.read' | 'mail.assign'
): Promise<MailConversationEndpoint> {
	const { conversation } = await requireConversation(tx, actor, conversationId, action)
	const inbox = await repo.getMailInbox(tx, actor.workspaceId, conversation.inboxId)
	return {
		id: conversation.id,
		subject: conversation.subject,
		status: conversation.status,
		inboxId: conversation.inboxId,
		inboxName: inbox?.name ?? null,
		accountId: conversation.accountId,
		customerEmail: conversation.customerEmail,
		updatedAt: conversation.updatedAt
	}
}

async function insertOutbox(
	tx: Queryable,
	workspaceId: string,
	aggregate: string,
	aggregateId: string,
	eventType: string,
	payload: Record<string, unknown>
): Promise<void> {
	await tx`
		INSERT INTO outbox (workspace_id, aggregate, aggregate_id, event_type, payload)
		VALUES (${workspaceId}, ${aggregate}, ${aggregateId}, ${eventType}, ${tx.json(payload as never)})
	`
}

// ---------- accounts ----------

export interface MailModuleConfig {
	readonly inboundDomain?: string | undefined
	readonly publicBaseUrl?: string | undefined
	readonly rootSecret: string
	readonly collabTicketSecret?: string | undefined
	readonly maxMessageBytes: number
	readonly undoSendSeconds: number
	readonly gmailClientId?: string | undefined
	readonly gmailClientSecret?: string | undefined
	readonly msClientId?: string | undefined
	readonly msClientSecret?: string | undefined
	readonly smtpRelay?:
		| { host: string; port: number; secure: boolean; user?: string; pass?: string }
		| undefined
}

export async function listAccounts(
	tx: Queryable,
	actor: ActorContext,
	cfg: MailModuleConfig
): Promise<MailAccountDto[]> {
	authorizeMailWorkspaceAction(actor, 'mail.read')
	const rows = await repo.listMailAccounts(tx, actor.workspaceId)
	const allowed = await accessibleAccountIds(tx, actor)
	return rows
		.filter((r) => allowed === null || allowed.includes(r.id))
		.map((r) =>
			toAccountDto(r, {
				inboundUrl: inboundUrlFor(r, cfg)
			})
		)
}

export async function createAccount(
	tx: Queryable,
	actor: ActorContext,
	body: CreateMailAccountBody,
	cfg: MailModuleConfig
): Promise<MailAccountDto> {
	// Account administration rides the mail.assign (manage) permission.
	authorizeMailWorkspaceAction(actor, 'mail.assign')
	const address = normalizeEmail(body.address)
	if (!isPlausibleEmail(address)) {
		throw new HttpError(422, 'validation_failed', 'Invalid mail account address')
	}
	const existing = await repo.getMailAccountByAddress(tx, actor.workspaceId, address)
	if (existing) throw new HttpError(409, 'conflict', 'A mail account already uses this address')

	const config: Record<string, unknown> = { visibility: 'workspace' }
	let credentialsEncrypted: string | null = null
	let status: repo.MailAccountRow['status'] = 'active'

	if (body.provider === 'inbound_parse') {
		// Opaque webhook token — stored hashed; raw value returned once via config.
		const token = `mi_${randomBytes(24).toString('base64url')}`
		config['inbound_token_hash'] = hashInboundToken(token)
		config['inbound_token'] = token // returned in DTO once via extras — see route
	} else if (body.provider === 'imap') {
		const c = body.config
		if (!c?.imapHost || !c.imapUser || !c.imapPassword) {
			throw new HttpError(422, 'mail_provider_unconfigured', 'IMAP requires imapHost, imapUser, imapPassword')
		}
		credentialsEncrypted = encryptSecret(
			cfg.rootSecret,
			`mail-account:${actor.workspaceId}`,
			JSON.stringify(c)
		)
	} else if (body.provider === 'gmail' || body.provider === 'graph') {
		const c = body.config
		if (!c || Object.keys(c).length === 0) {
			status = 'pending_verification' // OAuth handoff completes separately
		} else {
			credentialsEncrypted = encryptSecret(
				cfg.rootSecret,
				`mail-account:${actor.workspaceId}`,
				JSON.stringify(c)
			)
		}
	}

	const row = await repo.insertMailAccount(tx, {
		workspaceId: actor.workspaceId,
		provider: body.provider,
		address,
		displayName: body.displayName ?? null,
		credentialsEncrypted,
		config,
		defaultInboxId: body.defaultInboxId ?? null,
		createdBy: actor.userId,
		status
	})

	const domain = address.split('@')[1]!
	const domainRecords =
		body.provider === 'inbound_parse'
			? buildDomainRecords({
					domain,
					selector: 'huriro',
					dkimPublicKey: String(config['dkim_public_key'] ?? 'PENDING'),
					spfInclude: cfg.inboundDomain ?? 'huriro.local'
				}).map((r) => ({ host: r.host, value: r.value, kind: r.kind }))
			: undefined

	return toAccountDto(row, {
		inboundUrl: inboundUrlFor(row, cfg),
		domainRecords
	})
}

export async function getAccount(
	tx: Queryable,
	actor: ActorContext,
	accountId: string,
	cfg: MailModuleConfig
): Promise<MailAccountDto> {
	const row = await repo.getMailAccount(tx, actor.workspaceId, accountId)
	if (!row) throw new HttpError(404, 'not_found', 'Mail account not found')
	await authorizeMailAccountAction(tx, actor, 'mail.read', {
		id: row.id,
		visibility: accountVisibility(row)
	})
	return toAccountDto(row, {
		inboundUrl: inboundUrlFor(row, cfg)
	})
}

export async function updateAccount(
	tx: Queryable,
	actor: ActorContext,
	accountId: string,
	body: UpdateMailAccountBody
): Promise<MailAccountDto> {
	const existing = await repo.getMailAccount(tx, actor.workspaceId, accountId)
	if (!existing) throw new HttpError(404, 'not_found', 'Mail account not found')
	await authorizeMailAccountAction(tx, actor, 'mail.assign', {
		id: existing.id,
		visibility: accountVisibility(existing)
	})
	const row = await repo.updateMailAccount(tx, actor.workspaceId, accountId, {
		displayName: body.displayName,
		defaultInboxId: body.defaultInboxId,
		status: body.status
	})
	if (!row) throw new HttpError(404, 'not_found', 'Mail account not found')
	return toAccountDto(row)
}

export async function verifyAccountDomain(
	tx: Queryable,
	actor: ActorContext,
	accountId: string,
	cfg: MailModuleConfig,
	dns: DnsLike = nodeDnsResolver()
): Promise<{ verified: boolean; missingRecords: string[] }> {
	const account = await repo.getMailAccount(tx, actor.workspaceId, accountId)
	if (!account) throw new HttpError(404, 'not_found', 'Mail account not found')
	await authorizeMailAccountAction(tx, actor, 'mail.assign', {
		id: account.id,
		visibility: accountVisibility(account)
	})
	const domain = account.address.split('@')[1]!
	const records = buildDomainRecords({
		domain,
		selector: 'huriro',
		dkimPublicKey: String(account.config['dkim_public_key'] ?? 'PENDING'),
		spfInclude: cfg.inboundDomain ?? 'huriro.local'
	})
	const result = await verifyDomainRecords(
		records.map((r) => ({ host: r.host, value: r.value })),
		dns
	)
	if (result.verified && account.status === 'pending_verification') {
		await repo.updateMailAccount(tx, actor.workspaceId, accountId, { status: 'active' })
	}
	return { verified: result.verified, missingRecords: result.missing }
}

// ---------- identities ----------

export async function listIdentities(
	tx: Queryable,
	actor: ActorContext,
	accountId?: string
): Promise<MailIdentityDto[]> {
	authorizeMailWorkspaceAction(actor, 'mail.read')
	const rows = await repo.listMailIdentities(tx, actor.workspaceId, accountId)
	return rows.map(toIdentityDto)
}

export async function createIdentity(
	tx: Queryable,
	actor: ActorContext,
	body: CreateMailIdentityBody
): Promise<MailIdentityDto> {
	const account = await repo.getMailAccount(tx, actor.workspaceId, body.accountId)
	if (!account) throw new HttpError(404, 'not_found', 'Mail account not found')
	await authorizeMailAccountAction(tx, actor, 'mail.assign', {
		id: account.id,
		visibility: accountVisibility(account)
	})
	const address = normalizeEmail(body.address)
	if (!isPlausibleEmail(address)) {
		throw new HttpError(422, 'validation_failed', 'Invalid identity address')
	}
	const row = await repo.insertMailIdentity(tx, {
		workspaceId: actor.workspaceId,
		accountId: account.id,
		address,
		displayName: body.displayName ?? null,
		signature: body.signatureText ? { text: body.signatureText } : {},
		isDefault: body.isDefault ?? false,
		createdBy: actor.userId
	})
	return toIdentityDto(row)
}

// ---------- inboxes ----------

export async function listInboxes(tx: Queryable, actor: ActorContext): Promise<MailInboxDto[]> {
	authorizeMailWorkspaceAction(actor, 'mail.read')
	const rows = await repo.listMailInboxes(tx, actor.workspaceId)
	const visible: repo.MailInboxRow[] = []
	for (const row of rows) {
		const decision = await canAccessMailInbox(tx, actor, 'mail.read', row)
		if (decision.allowed) visible.push(row)
	}
	return visible.map(toInboxDto)
}

export async function createInbox(
	tx: Queryable,
	actor: ActorContext,
	body: CreateMailInboxBody
): Promise<{ data: MailInboxDto; cursor: number }> {
	authorizeMailWorkspaceAction(actor, 'mail.assign')
	const last = (await repo.listMailInboxes(tx, actor.workspaceId)).at(-1)
	const position = generateKeyBetween(last?.position ?? null, null)
	// Private inboxes default their owner to the creator unless explicitly set.
	const visibility = body.visibility ?? 'shared'
	const ownerUserId =
		visibility === 'private' ? (body.ownerUserId ?? actor.userId) : (body.ownerUserId ?? null)
	const row = await repo.insertMailInbox(tx, {
		workspaceId: actor.workspaceId,
		name: body.name.trim(),
		position,
		settings: body.settings ?? {},
		createdBy: actor.userId,
		visibility,
		ownerUserId
	})
	if (visibility === 'private' && ownerUserId && actor.kind === 'user') {
		await grantAcl(tx, {
			workspaceId: actor.workspaceId,
			resourceType: 'mail_inbox',
			resourceId: row.id,
			principalType: 'user',
			principalId: ownerUserId,
			permission: 'manage',
			grantedBy: actor.userId
		})
	}
	const cursor = await appendChanges(tx, actor.workspaceId, [
		{
			entityType: 'mail_inbox',
			entityId: row.id,
			action: 'upsert',
			payload: toInboxDto(row) as unknown as Record<string, unknown>,
			actorId: actor.principalId
		}
	])
	return { data: toInboxDto(row), cursor }
}

// ---------- conversations ----------

export async function listConversations(
	tx: Queryable,
	actor: ActorContext,
	query: ListConversationsQuery
): Promise<{ data: MailConversationDto[]; nextCursor: string | null }> {
	authorizeMailWorkspaceAction(actor, 'mail.read')
	if (query.inboxId) {
		const targetInbox = await repo.getMailInbox(tx, actor.workspaceId, query.inboxId)
		if (targetInbox) {
			await authorizeMailInboxAction(tx, actor, 'mail.read', targetInbox)
		}
	}
	const [accountIds, inboxIds] = await Promise.all([
		accessibleAccountIds(tx, actor),
		accessibleInboxIds(tx, actor)
	])
	if ((accountIds !== null && accountIds.length === 0) || (inboxIds !== null && inboxIds.length === 0)) {
		return { data: [], nextCursor: null }
	}

	const limit = Math.min(query.limit ?? 50, 100)
	const cursor = query.cursor ? decodeCursor(query.cursor) : undefined
	const rows = await repo.listMailConversations(tx, actor.workspaceId, {
		inboxId: query.inboxId,
		status: query.status,
		assigneeId:
			query.assignee === 'me'
				? actor.userId
				: query.assignee && query.assignee !== 'unassigned'
					? query.assignee
					: undefined,
		unassigned: query.assignee === 'unassigned',
		tagId: query.tagId,
		q: query.q,
		cursor,
		limit,
		accountIds: accountIds ?? undefined,
		inboxIds: inboxIds ?? undefined
	})
	const nextCursor = rows.length === limit ? encodeCursor(rows.at(-1)!) : null
	return { data: rows.map(toConversationDto), nextCursor }
}

function decodeCursor(raw: string): { lastMessageAt: string; id: string } | undefined {
	try {
		const [ts, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|')
		return ts && id ? { lastMessageAt: ts, id } : undefined
	} catch {
		return undefined
	}
}

function encodeCursor(row: repo.MailConversationRow): string {
	return Buffer.from(`${row.lastMessageAt}|${row.id}`, 'utf8').toString('base64url')
}

export async function getConversationTimeline(
	tx: Queryable,
	actor: ActorContext,
	conversationId: string
): Promise<MailTimelineDto> {
	const { conversation } = await requireConversation(tx, actor, conversationId, 'mail.read')
	const [messages, notes, events, drafts, linkedTasks, linkedDocs] = await Promise.all([
		repo.listConversationMessages(tx, actor.workspaceId, conversationId),
		repo.listConversationComments(tx, actor.workspaceId, conversationId),
		repo.listConversationEvents(tx, actor.workspaceId, conversationId),
		repo.listConversationDrafts(tx, actor.workspaceId, conversationId),
		repo.listLinkedTasks(tx, actor.workspaceId, conversationId),
		repo.listLinkedDocs(tx, actor.workspaceId, conversationId)
	])
	return {
		conversation: toConversationDto(conversation),
		messages: messages.map(toMessageDto),
		notes: notes.map(toNoteDto),
		events: events.map((e) => ({
			id: e.id,
			kind: e.kind,
			actorId: e.actorId,
			actorName: e.actorName ?? null,
			payload: e.payload,
			createdAt: e.createdAt
		})),
		drafts: drafts.map(toDraftDto),
		linkedTasks,
		linkedDocs
	}
}

export async function updateConversation(
	tx: Queryable,
	actor: ActorContext,
	conversationId: string,
	body: UpdateConversationBody
): Promise<{ data: MailConversationDto; cursor: number }> {
	const { conversation, account } = await requireConversation(tx, actor, conversationId, 'mail.assign')

	const patch: {
		status?: 'open' | 'pending' | 'snoozed' | 'closed' | 'spam'
		assigneeId?: string | null
		snoozedUntil?: string | null
		priority?: 'low' | 'normal' | 'high' | 'urgent'
		followUpAt?: string | null
		followUpCondition?: 'if_no_reply' | 'always' | null
		followUpCompletedAt?: string | null
	} = {}
	const events: { kind: string; payload: Record<string, unknown> }[] = []

	if (body.assigneeId !== undefined && body.assigneeId !== conversation.assigneeId) {
		patch.assigneeId = body.assigneeId
		events.push({
			kind: body.assigneeId ? 'assigned' : 'unassigned',
			payload: { assigneeId: body.assigneeId }
		})
	}
	if (body.status && body.status !== conversation.status) {
		patch.status = body.status
		events.push({ kind: 'status_changed', payload: { from: conversation.status, to: body.status } })
	}
	if (body.snoozedUntil !== undefined) {
		patch.snoozedUntil = body.snoozedUntil
		if (body.snoozedUntil) {
			patch.status = 'snoozed'
			events.push({ kind: 'snoozed', payload: { until: body.snoozedUntil } })
		}
	}
	if (body.priority !== undefined) patch.priority = body.priority
	if (body.followUpAt !== undefined) {
		patch.followUpAt = body.followUpAt
		patch.followUpCompletedAt = null
	}
	if (body.followUpCondition !== undefined) patch.followUpCondition = body.followUpCondition
	if (Object.keys(patch).length === 0) {
		return { data: toConversationDto(conversation), cursor: 0 }
	}

	const row = await repo.updateMailConversation(
		tx,
		actor.workspaceId,
		conversationId,
		patch,
		body.expectedVersion
	)
	if (!row) throw new HttpError(409, 'conflict', 'Conversation was modified — reload and retry')

	for (const e of events) {
		await repo.insertConversationEvent(tx, {
			workspaceId: actor.workspaceId,
			conversationId,
			kind: e.kind,
			actorId: actor.principalId,
			payload: e.payload
		})
	}
	if (body.assigneeId) {
		await insertOutbox(
			tx,
			actor.workspaceId,
			'mail_conversation',
			conversationId,
			'mail.conversation.assigned.v1',
			{
				conversationId,
				assigneeUserId: body.assigneeId,
				actorType: actor.kind,
				actorId: actor.principalId,
				subject: row.subject,
				accountId: account.id
			}
		)
	}
	const cursor = await appendChanges(tx, actor.workspaceId, [
		{
			entityType: 'mail_conversation',
			entityId: conversationId,
			action: 'upsert',
			payload: toConversationDto(row) as unknown as Record<string, unknown>,
			actorId: actor.principalId
		}
	])
	return { data: toConversationDto(row), cursor }
}

// ---------- notes ----------

export async function createNote(
	tx: Queryable,
	actor: ActorContext,
	conversationId: string,
	body: CreateMailNoteBody
): Promise<MailNoteDto> {
	await requireConversation(tx, actor, conversationId, 'mail.read')
	const row = await repo.insertConversationComment(tx, {
		workspaceId: actor.workspaceId,
		conversationId,
		authorId: actor.userId,
		body: body.body ?? {
			type: 'doc',
			content: [{ type: 'paragraph', content: [{ type: 'text', text: body.bodyText }] }]
		},
		bodyText: body.bodyText,
		mentions: body.mentions ?? []
	})
	await repo.insertConversationEvent(tx, {
		workspaceId: actor.workspaceId,
		conversationId,
		kind: 'note_added',
		actorId: actor.principalId,
		payload: { noteId: row.id }
	})
	if (body.mentions && body.mentions.length > 0) {
		await insertOutbox(tx, actor.workspaceId, 'mail_conversation', conversationId, 'mail.note.mentioned.v1', {
			conversationId,
			mentionedUserIds: body.mentions,
			actorType: actor.kind,
			actorId: actor.principalId,
			bodyText: body.bodyText.slice(0, 300)
		})
	}
	return toNoteDto(row)
}

// ---------- drafts & undo-send ----------

const DRAFT_LOCK_TTL_MS = 60_000

function assertDraftEditable(draft: repo.MailDraftRow, actor: ActorContext): void {
	if (draft.status !== 'draft') {
		throw new HttpError(409, 'conflict', `Draft is ${draft.status}`)
	}
	const locked =
		draft.lockedBy &&
		draft.lockedUntil &&
		new Date(draft.lockedUntil).getTime() > Date.now() &&
		draft.lockedBy !== actor.userId
	if (locked) {
		throw new HttpError(423, 'mail_draft_locked', 'Another teammate is editing this draft')
	}
}

export async function upsertDraft(
	tx: Queryable,
	actor: ActorContext,
	conversationId: string,
	body: UpsertMailDraftBody,
	draftId?: string
): Promise<MailDraftDto> {
	const { account } = await requireConversation(tx, actor, conversationId, 'mail.send')
	const identity = await repo.getMailIdentity(tx, actor.workspaceId, body.identityId)
	if (!identity || identity.accountId !== account.id) {
		throw new HttpError(422, 'validation_failed', 'Identity does not belong to this conversation account')
	}
	const recipients = {
		to: body.recipients.to.map((a) => ({ email: normalizeEmail(a.email), name: a.name ?? null })),
		cc: (body.recipients.cc ?? []).map((a) => ({ email: normalizeEmail(a.email), name: a.name ?? null })),
		bcc: (body.recipients.bcc ?? []).map((a) => ({ email: normalizeEmail(a.email), name: a.name ?? null }))
	}
	for (const a of [...recipients.to, ...recipients.cc, ...recipients.bcc]) {
		if (!isPlausibleEmail(a.email)) {
			throw new HttpError(422, 'validation_failed', `Invalid recipient address: ${a.email.slice(0, 40)}`)
		}
	}
	const bodyDoc = body.body ?? {
		type: 'doc',
		content: [{ type: 'paragraph', content: [{ type: 'text', text: body.bodyText }] }]
	}

	if (draftId) {
		const existing = await repo.getMailDraft(tx, actor.workspaceId, draftId)
		if (!existing || existing.conversationId !== conversationId) {
			throw new HttpError(404, 'not_found', 'Draft not found')
		}
		assertDraftEditable(existing, actor)
		const existingMeta =
			existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
				? (existing.metadata as Record<string, unknown>)
				: {}
		const nextMeta =
			body.attachmentFileIds !== undefined
				? { ...existingMeta, attachmentFileIds: body.attachmentFileIds }
				: undefined
		const row = await repo.updateMailDraft(tx, actor.workspaceId, draftId, {
			body: bodyDoc,
			bodyText: body.bodyText,
			recipients: recipients as unknown as Record<string, unknown>,
			lastEditedBy: actor.userId,
			...(body.collabEnabled !== undefined ? { collabEnabled: body.collabEnabled } : {}),
			...(body.scheduledSendAt !== undefined ? { scheduledSendAt: body.scheduledSendAt } : {}),
			...(nextMeta !== undefined ? { metadata: nextMeta } : {})
		})
		if (!row) throw new HttpError(404, 'not_found', 'Draft not found')
		if (body.collabEnabled) {
			const ydoc = prosemirrorJsonToYDoc(bodyDoc as Record<string, unknown>)
			await tx`
				UPDATE mail_drafts
				SET draft_state = ${Buffer.from(Y.encodeStateAsUpdate(ydoc))},
					draft_state_vector = ${Buffer.from(Y.encodeStateVector(ydoc))}
				WHERE workspace_id = ${actor.workspaceId} AND id = ${row.id} AND draft_state IS NULL
			`
		}
		return toDraftDto(row)
	}
	const initialMeta: Record<string, unknown> =
		body.attachmentFileIds !== undefined ? { attachmentFileIds: body.attachmentFileIds } : {}
	const row = await repo.insertMailDraft(tx, {
		workspaceId: actor.workspaceId,
		conversationId,
		identityId: body.identityId,
		createdBy: actor.userId,
		body: bodyDoc,
		bodyText: body.bodyText,
		recipients: recipients as unknown as Record<string, unknown>,
		inReplyToId: body.inReplyToId ?? null,
		scheduledSendAt: body.scheduledSendAt ?? null,
		collabEnabled: body.collabEnabled ?? false,
		metadata: initialMeta
	})
	if (body.collabEnabled) {
		const ydoc = prosemirrorJsonToYDoc(bodyDoc as Record<string, unknown>)
		await tx`
			UPDATE mail_drafts
			SET draft_state = ${Buffer.from(Y.encodeStateAsUpdate(ydoc))},
				draft_state_vector = ${Buffer.from(Y.encodeStateVector(ydoc))}
			WHERE workspace_id = ${actor.workspaceId} AND id = ${row.id} AND draft_state IS NULL
		`
	}
	return toDraftDto(row)
}

export async function lockDraft(tx: Queryable, actor: ActorContext, draftId: string): Promise<MailDraftDto> {
	const draft = await repo.getMailDraft(tx, actor.workspaceId, draftId)
	if (!draft) throw new HttpError(404, 'not_found', 'Draft not found')
	await requireConversation(tx, actor, draft.conversationId, 'mail.send')
	assertDraftEditable(draft, actor)
	const row = await repo.updateMailDraft(tx, actor.workspaceId, draftId, {
		lockedBy: actor.userId,
		lockedUntil: new Date(Date.now() + DRAFT_LOCK_TTL_MS).toISOString()
	})
	if (!row) throw new HttpError(404, 'not_found', 'Draft not found')
	return toDraftDto(row)
}

export async function unlockDraft(
	tx: Queryable,
	actor: ActorContext,
	draftId: string
): Promise<MailDraftDto> {
	const draft = await repo.getMailDraft(tx, actor.workspaceId, draftId)
	if (!draft) throw new HttpError(404, 'not_found', 'Draft not found')
	await requireConversation(tx, actor, draft.conversationId, 'mail.send')
	if (draft.lockedBy && draft.lockedBy !== actor.userId && !isAdminMailBypass(actor)) {
		throw new HttpError(423, 'mail_draft_locked', 'Another teammate is editing this draft')
	}
	const row = await repo.updateMailDraft(tx, actor.workspaceId, draftId, {
		lockedBy: null,
		lockedUntil: null
	})
	if (!row) throw new HttpError(404, 'not_found', 'Draft not found')
	return toDraftDto(row)
}

/**
 * Queue a draft for send. The undo window keeps status='sending' with
 * `scheduled_send_at`; the worker only sends after that time. Within the
 * window `undoSend` flips it back to draft (§14.5).
 */
export async function sendDraft(
	tx: Queryable,
	actor: ActorContext,
	draftId: string,
	opts: {
		readonly undoSeconds?: number | undefined
		readonly scheduledSendAt?: string | undefined
		readonly expectedVersion?: number | undefined
	},
	cfg: MailModuleConfig
): Promise<MailDraftDto> {
	const draft = await repo.getMailDraft(tx, actor.workspaceId, draftId)
	if (!draft) throw new HttpError(404, 'not_found', 'Draft not found')
	await requireConversation(tx, actor, draft.conversationId, 'mail.send')
	assertDraftEditable(draft, actor)
	if (draft.reviewStatus === 'requested' || draft.reviewStatus === 'changes_requested') {
		throw new HttpError(409, 'mail_review_required', 'Draft review must be approved before sending')
	}
	let scheduledSendAt: string
	if (opts.scheduledSendAt) {
		const parsed = Date.parse(opts.scheduledSendAt)
		if (Number.isNaN(parsed)) {
			throw new HttpError(422, 'validation_failed', 'Invalid scheduledSendAt timestamp')
		}
		if (parsed <= Date.now()) {
			throw new HttpError(422, 'validation_failed', 'scheduledSendAt must be in the future')
		}
		if (parsed > Date.now() + 365 * 86_400_000) {
			throw new HttpError(422, 'validation_failed', 'scheduledSendAt cannot exceed 365 days')
		}
		scheduledSendAt = new Date(parsed).toISOString()
	} else {
		const undo = Math.min(Math.max(opts.undoSeconds ?? cfg.undoSendSeconds, 0), 120)
		scheduledSendAt = new Date(Date.now() + undo * 1000).toISOString()
	}
	const row = await repo.updateMailDraft(
		tx,
		actor.workspaceId,
		draftId,
		{
			status: 'sending',
			scheduledSendAt
		},
		opts.expectedVersion
	)
	if (!row) throw new HttpError(409, 'conflict', 'Draft was modified — reload and retry')
	// NOTE: no outbox event here — the worker's `mail-outbound-due` sweeper
	// picks up rows past scheduled_send_at. An eager event would be claimed
	// before the undo window elapsed and the send would never happen.
	return toDraftDto(row)
}

export async function requestDraftReview(
	tx: Queryable,
	actor: ActorContext,
	draftId: string,
	input: { readonly reviewerId: string; readonly note?: string | undefined }
): Promise<MailDraftDto> {
	const draft = await repo.getMailDraft(tx, actor.workspaceId, draftId)
	if (!draft) throw new HttpError(404, 'not_found', 'Draft not found')
	await requireConversation(tx, actor, draft.conversationId, 'mail.send')
	assertDraftEditable(draft, actor)
	const reviewer = await tx<{ id: string }[]>`
		SELECT user_id AS id FROM memberships
		WHERE workspace_id = ${actor.workspaceId} AND user_id = ${input.reviewerId} AND status = 'active'
	`
	if (!reviewer[0]) throw new HttpError(404, 'not_found', 'Reviewer is not an active workspace member')
	const row = await repo.updateMailDraft(tx, actor.workspaceId, draftId, {
		reviewStatus: 'requested',
		reviewerId: input.reviewerId,
		reviewedAt: null,
		reviewNote: input.note ?? null
	})
	if (!row) throw new HttpError(404, 'not_found', 'Draft not found')
	await repo.insertConversationEvent(tx, {
		workspaceId: actor.workspaceId,
		conversationId: draft.conversationId,
		kind: 'review_requested',
		actorId: actor.principalId,
		payload: { draftId, reviewerId: input.reviewerId }
	})
	await tx`
		INSERT INTO notifications (workspace_id, recipient_user_id, actor_type, actor_id, kind, entity_type, entity_id, title, body, metadata)
		VALUES (${actor.workspaceId}, ${input.reviewerId}, ${actor.kind}, ${actor.principalId}, 'mail.review_requested',
			'mail_draft', ${draftId}, 'Mail draft review requested', ${input.note ?? draft.bodyText.slice(0, 300)}, '{}'::jsonb)
	`
	return toDraftDto(row)
}

export async function completeDraftReview(
	tx: Queryable,
	actor: ActorContext,
	draftId: string,
	input: { readonly decision: 'approved' | 'changes_requested'; readonly note?: string | undefined }
): Promise<MailDraftDto> {
	const draft = await repo.getMailDraft(tx, actor.workspaceId, draftId)
	if (!draft) throw new HttpError(404, 'not_found', 'Draft not found')
	await requireConversation(tx, actor, draft.conversationId, 'mail.send')
	if (draft.reviewerId !== actor.userId && !isAdminMailBypass(actor)) {
		throw new HttpError(403, 'insufficient_role', 'Only the requested reviewer may complete this review')
	}
	if (draft.reviewStatus !== 'requested') {
		throw new HttpError(409, 'conflict', 'Draft review is not pending')
	}
	const row = await repo.updateMailDraft(tx, actor.workspaceId, draftId, {
		reviewStatus: input.decision,
		reviewedAt: new Date().toISOString(),
		reviewNote: input.note ?? null
	})
	if (!row) throw new HttpError(404, 'not_found', 'Draft not found')
	await repo.insertConversationEvent(tx, {
		workspaceId: actor.workspaceId,
		conversationId: draft.conversationId,
		kind: input.decision === 'approved' ? 'review_approved' : 'review_changes_requested',
		actorId: actor.principalId,
		payload: { draftId, note: input.note ?? null }
	})
	if (draft.createdBy !== actor.userId) {
		await tx`
			INSERT INTO notifications (workspace_id, recipient_user_id, actor_type, actor_id, kind, entity_type, entity_id, title, body, metadata)
			VALUES (${actor.workspaceId}, ${draft.createdBy}, ${actor.kind}, ${actor.principalId}, 'mail.review_completed',
				'mail_draft', ${draftId}, 'Mail draft review completed', ${input.note ?? ''}, '{}'::jsonb)
		`
	}
	return toDraftDto(row)
}

export async function issueDraftCollabTicket(
	tx: Queryable,
	actor: ActorContext,
	draftId: string,
	cfg: MailModuleConfig
) {
	if (!cfg.collabTicketSecret) {
		throw new HttpError(503, 'internal', 'Collaboration ticket signing is not configured')
	}
	const draft = await repo.getMailDraft(tx, actor.workspaceId, draftId)
	if (!draft) throw new HttpError(404, 'not_found', 'Draft not found')
	let canWrite = false
	try {
		await requireConversation(tx, actor, draft.conversationId, 'mail.send')
		canWrite = draft.status === 'draft'
	} catch {
		await requireConversation(tx, actor, draft.conversationId, 'mail.read')
	}
	return issueMailDraftCollabTicket({ tx, actor, draft, canWrite, ticketSecret: cfg.collabTicketSecret })
}

/** Realtime reauthorization seam for `/collab` mail-draft rooms. */
export async function verifyLiveMailDraftAccess(
	tx: Queryable,
	actor: ActorContext,
	draftId: string
): Promise<{ readonly allowed: boolean; readonly canWrite: boolean }> {
	const draft = await repo.getMailDraft(tx, actor.workspaceId, draftId)
	if (!draft || draft.status !== 'draft' || !draft.collabEnabled) return { allowed: false, canWrite: false }
	try {
		await requireConversation(tx, actor, draft.conversationId, 'mail.send')
		return { allowed: true, canWrite: true }
	} catch {
		try {
			await requireConversation(tx, actor, draft.conversationId, 'mail.read')
			return { allowed: true, canWrite: false }
		} catch {
			return { allowed: false, canWrite: false }
		}
	}
}

/** Undo-send: only valid inside the scheduled window (§14.5). */
export async function undoSend(tx: Queryable, actor: ActorContext, draftId: string): Promise<MailDraftDto> {
	const draft = await repo.getMailDraft(tx, actor.workspaceId, draftId)
	if (!draft) throw new HttpError(404, 'not_found', 'Draft not found')
	await requireConversation(tx, actor, draft.conversationId, 'mail.send')
	if (draft.status !== 'sending' || !draft.scheduledSendAt) {
		throw new HttpError(409, 'mail_send_window_expired', 'Nothing to undo — draft is not queued')
	}
	if (new Date(draft.scheduledSendAt).getTime() <= Date.now()) {
		throw new HttpError(410, 'mail_send_window_expired', 'Undo window has expired — message already sent')
	}
	const row = await repo.updateMailDraft(tx, actor.workspaceId, draftId, {
		status: 'draft',
		scheduledSendAt: null
	})
	if (!row) throw new HttpError(404, 'not_found', 'Draft not found')
	return toDraftDto(row)
}

export async function discardDraft(tx: Queryable, actor: ActorContext, draftId: string): Promise<void> {
	const draft = await repo.getMailDraft(tx, actor.workspaceId, draftId)
	if (!draft) return
	await requireConversation(tx, actor, draft.conversationId, 'mail.send')
	if (draft.createdBy !== actor.userId && !isAdminMailBypass(actor)) {
		throw new HttpError(403, 'insufficient_role', 'Only the draft author may discard it')
	}
	await repo.updateMailDraft(tx, actor.workspaceId, draftId, { status: 'discarded' })
}

// ---------- links & convert-to-issue ----------

export async function linkTask(
	tx: Queryable,
	actor: ActorContext,
	conversationId: string,
	taskId: string
): Promise<void> {
	await requireConversation(tx, actor, conversationId, 'mail.assign')
	const [exists] = await tx<{ id: string }[]>`
		SELECT id FROM issues WHERE workspace_id = ${actor.workspaceId} AND id = ${taskId}
	`
	if (!exists) throw new HttpError(404, 'not_found', 'Issue not found')
	await repo.linkConversationTask(tx, {
		workspaceId: actor.workspaceId,
		conversationId,
		taskId,
		createdBy: actor.userId
	})
	await repo.insertConversationEvent(tx, {
		workspaceId: actor.workspaceId,
		conversationId,
		kind: 'linked',
		actorId: actor.principalId,
		payload: { taskId }
	})
	// ADR-0033 dual-write: the legacy table remains authoritative for V1 reads,
	// while the graph edge serves traversal/peek and sync-v2 scopes.
	await insertEntityLink(tx, {
		workspaceId: actor.workspaceId,
		sourceType: 'mail_conversation',
		sourceId: conversationId,
		targetType: 'issue',
		targetId: taskId,
		relationKind: 'tracked_by',
		createdBy: actor.userId,
		actorId: actor.principalId
	})
}

export async function unlinkTask(
	tx: Queryable,
	actor: ActorContext,
	conversationId: string,
	taskId: string
): Promise<void> {
	await requireConversation(tx, actor, conversationId, 'mail.assign')
	const removed = await repo.unlinkConversationTask(tx, actor.workspaceId, conversationId, taskId)
	if (!removed) throw new HttpError(404, 'not_found', 'Link not found')
	await repo.insertConversationEvent(tx, {
		workspaceId: actor.workspaceId,
		conversationId,
		kind: 'unlinked',
		actorId: actor.principalId,
		payload: { taskId }
	})
	// Unlink is part of the same V1 write surface, so the dual-write window
	// removes the graph edge too rather than waiting for the later sweep.
	await deleteEntityLinkByEndpoints(tx, {
		workspaceId: actor.workspaceId,
		sourceType: 'mail_conversation',
		sourceId: conversationId,
		targetType: 'issue',
		targetId: taskId,
		relationKind: 'tracked_by',
		actorId: actor.principalId
	})
}

export async function linkDoc(
	tx: Queryable,
	actor: ActorContext,
	conversationId: string,
	pageId: string
): Promise<void> {
	await requireConversation(tx, actor, conversationId, 'mail.assign')
	const [exists] = await tx<{ id: string }[]>`
		SELECT id FROM doc_pages WHERE workspace_id = ${actor.workspaceId} AND id = ${pageId}
	`
	if (!exists) throw new HttpError(404, 'not_found', 'Doc page not found')
	await repo.linkConversationDoc(tx, {
		workspaceId: actor.workspaceId,
		conversationId,
		pageId,
		createdBy: actor.userId
	})
	await repo.insertConversationEvent(tx, {
		workspaceId: actor.workspaceId,
		conversationId,
		kind: 'linked',
		actorId: actor.principalId,
		payload: { pageId }
	})
	await insertEntityLink(tx, {
		workspaceId: actor.workspaceId,
		sourceType: 'mail_conversation',
		sourceId: conversationId,
		targetType: 'doc_page',
		targetId: pageId,
		relationKind: 'references',
		createdBy: actor.userId,
		actorId: actor.principalId
	})
}

export async function unlinkDoc(
	tx: Queryable,
	actor: ActorContext,
	conversationId: string,
	pageId: string
): Promise<void> {
	await requireConversation(tx, actor, conversationId, 'mail.assign')
	const removed = await repo.unlinkConversationDoc(tx, actor.workspaceId, conversationId, pageId)
	if (!removed) throw new HttpError(404, 'not_found', 'Link not found')
	await repo.insertConversationEvent(tx, {
		workspaceId: actor.workspaceId,
		conversationId,
		kind: 'unlinked',
		actorId: actor.principalId,
		payload: { pageId }
	})
	await deleteEntityLinkByEndpoints(tx, {
		workspaceId: actor.workspaceId,
		sourceType: 'mail_conversation',
		sourceId: conversationId,
		targetType: 'doc_page',
		targetId: pageId,
		relationKind: 'references',
		actorId: actor.principalId
	})
}

/** Convert conversation → issue (§14.6): creates the issue, links it, logs the event. */
export async function convertToIssue(
	tx: Queryable,
	actor: ActorContext,
	conversationId: string,
	body: ConvertToIssueBody
): Promise<{ issueId: string; identifier: string }> {
	const { conversation } = await requireConversation(tx, actor, conversationId, 'mail.assign')
	const messages = await repo.listConversationMessages(tx, actor.workspaceId, conversationId)
	const firstInbound = messages.find((m) => m.direction === 'inbound')
	const descriptionText = [
		`Converted from mail conversation: ${conversation.subject}`,
		'',
		firstInbound?.bodyText?.slice(0, 4000) ?? conversation.snippet ?? ''
	].join('\n')

	const { data: issue } = await createIssue(tx, actor, {
		projectId: body.projectId,
		title: (body.title ?? conversation.subject).slice(0, 300),
		descriptionText,
		description: null,
		sourceKind: 'mail'
	})

	await repo.linkConversationTask(tx, {
		workspaceId: actor.workspaceId,
		conversationId,
		taskId: issue.id,
		createdBy: actor.userId
	})
	await repo.insertConversationEvent(tx, {
		workspaceId: actor.workspaceId,
		conversationId,
		kind: 'converted',
		actorId: actor.principalId,
		payload: { taskId: issue.id, identifier: issue.identifier }
	})
	await insertEntityLink(tx, {
		workspaceId: actor.workspaceId,
		sourceType: 'mail_conversation',
		sourceId: conversationId,
		targetType: 'issue',
		targetId: issue.id,
		relationKind: 'tracked_by',
		createdBy: actor.userId,
		actorId: actor.principalId
	})
	return { issueId: issue.id, identifier: issue.identifier ?? '' }
}

/** Merge source conversation into target (messages keep rows, source marks merged). */
export async function mergeConversations(
	tx: Queryable,
	actor: ActorContext,
	targetConversationId: string,
	body: MergeConversationsBody
): Promise<MailConversationDto> {
	await requireConversation(tx, actor, targetConversationId, 'mail.assign')
	const { conversation: source } = await requireConversation(
		tx,
		actor,
		body.sourceConversationId,
		'mail.assign'
	)
	if (source.id === targetConversationId) {
		throw new HttpError(422, 'validation_failed', 'Cannot merge a conversation into itself')
	}
	await tx`
		UPDATE mail_conversations
		SET merged_into_id = ${targetConversationId}, status = 'closed', version = version + 1
		WHERE workspace_id = ${actor.workspaceId} AND id = ${source.id}
	`
	await repo.insertConversationEvent(tx, {
		workspaceId: actor.workspaceId,
		conversationId: targetConversationId,
		kind: 'merged',
		actorId: actor.principalId,
		payload: { sourceConversationId: source.id }
	})
	const target = await repo.getMailConversation(tx, actor.workspaceId, targetConversationId)
	if (!target) throw new HttpError(404, 'not_found', 'Conversation not found')
	return toConversationDto(target)
}

// ---------- inbound webhook → raw MIME quarantine ----------

export interface InboundRoute {
	readonly accountId: string
	readonly workspaceId: string
	readonly defaultInboxId: string | null
}

/** Pre-tenant token → account routing (§12.4). Called OUTSIDE withWorkspace. */
export async function resolveInboundRoute(tx: Queryable, rawToken: string): Promise<InboundRoute | null> {
	const tokenHash = hashInboundToken(rawToken)
	const [row] = await tx<
		{
			accountId: string
			workspaceId: string
			defaultInboxId: string | null
			accountStatus: string
		}[]
	>`
		SELECT account_id AS "accountId", workspace_id AS "workspaceId",
			default_inbox_id AS "defaultInboxId", account_status AS "accountStatus"
		FROM resolve_mail_inbound_route(${tokenHash})
	`
	if (!row || row.accountStatus !== 'active') return null
	return { accountId: row.accountId, workspaceId: row.workspaceId, defaultInboxId: row.defaultInboxId }
}

/**
 * Ingest raw MIME end-to-end inside a workspace tx (worker + webhook share
 * this path): parse → dedupe → thread → insert message → ingest attachments →
 * outbox events. Returns the created message id, or null on dedupe.
 */
export async function ingestRawMime(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly accountId: string
		readonly inboxId: string
		readonly raw: Uint8Array
		readonly providerRef?: Record<string, unknown> | undefined
	},
	storage: BlobStorage
): Promise<{ messageId: string; conversationId: string } | null> {
	if (args.raw.byteLength === 0 || args.raw.byteLength > MAIL_PARSE_LIMITS.maxBytes) {
		throw new HttpError(
			413,
			'mail_message_too_large',
			`Inbound message exceeds ${MAIL_PARSE_LIMITS.maxBytes} bytes`
		)
	}
	let parsed: ParsedMime
	try {
		parsed = await parseMime(args.raw)
	} catch (err) {
		if (err instanceof MimeParseError) {
			// Quarantined parse failures still land as a conversation with the raw
			// blob — operators need to see them (§14.6), never silently dropped.
			const conv = await repo.insertMailConversation(tx, {
				workspaceId: args.workspaceId,
				inboxId: args.inboxId,
				accountId: args.accountId,
				subject: '[unparseable message]',
				normalizedSubject: `[unparseable ${createHash('sha256').update(args.raw.subarray(0, 256)).digest('hex').slice(0, 16)}]`,
				customerEmail: null,
				lastMessageAt: new Date().toISOString()
			})
			const rawKey = `mail-raw/${args.workspaceId}/${conv.id}`
			await storage.putQuarantine(rawKey, args.raw)
			const msg = await repo.insertMailMessage(tx, {
				workspaceId: args.workspaceId,
				conversationId: conv.id,
				accountId: args.accountId,
				direction: 'inbound',
				rfcMessageId: null,
				inReplyTo: null,
				referencesIds: [],
				fromAddr: { email: 'unknown@invalid', name: null },
				toAddrs: [],
				ccAddrs: [],
				subject: '[unparseable message]',
				snippet: `Parse failed: ${err.reason}`,
				sentAt: null,
				receivedAt: new Date().toISOString(),
				rawBlobKey: rawKey,
				bodyHtml: null,
				bodyText: null,
				attachments: [],
				authResults: null,
				providerRef: { ...args.providerRef, parseError: err.reason },
				createdBy: null
			})
			return msg ? { messageId: msg.id, conversationId: conv.id } : null
		}
		throw err
	}

	// Dedupe on (account, rfc_message_id) — cheap insert ON CONFLICT also guards.
	if (parsed.messageId) {
		const existing = await repo.findMessageByRfcId(tx, args.workspaceId, args.accountId, parsed.messageId)
		if (existing) return null
	}

	const conversation = await findOrCreateConversation(tx, {
		workspaceId: args.workspaceId,
		accountId: args.accountId,
		inboxId: args.inboxId,
		parsed
	})

	const rawKey = `mail-raw/${args.workspaceId}/${conversation.id}/${parsed.messageId ?? uuid7()}.eml`
	await storage.putQuarantine(rawKey, args.raw)

	const msg = await repo.insertMailMessage(tx, {
		workspaceId: args.workspaceId,
		conversationId: conversation.id,
		accountId: args.accountId,
		direction: 'inbound',
		rfcMessageId: parsed.messageId,
		inReplyTo: parsed.inReplyTo,
		referencesIds: parsed.references,
		fromAddr: parsed.from ?? { email: 'unknown@invalid', name: null },
		toAddrs: [...parsed.to],
		ccAddrs: [...parsed.cc],
		subject: parsed.subject || conversation.subject,
		snippet: parsed.snippet,
		sentAt: parsed.date?.toISOString() ?? null,
		receivedAt: new Date().toISOString(),
		rawBlobKey: rawKey,
		bodyHtml: parsed.sanitizedHtml,
		bodyText: parsed.textBody,
		attachments: [],
		authResults: parsed.authResults as unknown as Record<string, unknown> | null,
		providerRef: args.providerRef ?? {},
		createdBy: null
	})
	if (!msg) return null // dedupe raced — ON CONFLICT swallowed it

	// Attachments ride the files quarantine pipeline (§14.6).
	let pos = 0
	const attachmentMeta: Record<string, unknown>[] = []
	for (const att of parsed.attachments) {
		if (att.inline) continue // cid images stay in the raw blob
		try {
			const file = await ingestInboundAttachmentFile(
				tx,
				{
					workspaceId: args.workspaceId,
					uploadedBy: null,
					filename: att.filename,
					declaredContentType: att.contentType,
					bytes: att.bytes
				},
				storage
			)
			await repo.insertMessageAttachment(tx, {
				workspaceId: args.workspaceId,
				messageId: msg.id,
				fileId: file.id,
				position: pos++
			})
			attachmentMeta.push({
				fileId: file.id,
				name: att.filename,
				contentType: att.contentType,
				byteSize: att.bytes.byteLength,
				scanStatus: file.scanStatus
			})
		} catch {
			// Oversized/failed attachments are skipped, not fatal to the message.
			attachmentMeta.push({
				fileId: null,
				name: att.filename,
				contentType: att.contentType,
				byteSize: att.bytes.byteLength
			})
		}
	}
	if (attachmentMeta.length > 0) {
		await tx`
			UPDATE mail_messages SET attachments = ${tx.json(attachmentMeta as never)}
			WHERE workspace_id = ${args.workspaceId} AND id = ${msg.id}
		`
	}

	await repo.updateConversationAfterMessage(tx, args.workspaceId, conversation.id, {
		lastMessageAt: msg.receivedAt,
		customerEmail: parsed.from?.email ?? conversation.customerEmail,
		// An inbound message on a snoozed/closed conversation re-opens it.
		status: conversation.status === 'snoozed' || conversation.status === 'closed' ? 'open' : undefined
	})

	await insertOutbox(
		tx,
		args.workspaceId,
		'mail_conversation',
		conversation.id,
		MAIL_EVENTS.ConversationChanged,
		{
			conversationId: conversation.id,
			kind: 'new_message',
			messageId: msg.id
		}
	)
	// Search indexes from a dedicated event — same pattern as tasks/issues.
	await insertOutbox(tx, args.workspaceId, 'mail_message', msg.id, 'mail.message.created.v1', {
		messageId: msg.id,
		conversationId: conversation.id,
		accountId: args.accountId,
		subject: parsed.subject || conversation.subject,
		snippet: parsed.snippet,
		bodyText: parsed.textBody?.slice(0, 8000) ?? '',
		customerEmail: parsed.from?.email ?? null,
		direction: 'inbound'
	})
	return { messageId: msg.id, conversationId: conversation.id }
}

/**
 * Threading (§14.4): Message-Id link wins; else normalized-subject match on
 * the same account. Ambiguous → new conversation (never wrong-attach).
 */
async function findOrCreateConversation(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly accountId: string
		readonly inboxId: string
		readonly parsed: ParsedMime
	}
): Promise<repo.MailConversationRow> {
	const normalized = normalizeMailSubject(args.parsed.subject)

	// 1. In-Reply-To / References direct hits on existing messages.
	const refs = [args.parsed.inReplyTo, ...args.parsed.references].filter((r): r is string => !!r)
	for (const ref of refs) {
		const parent = await repo.findMessageByRfcId(tx, args.workspaceId, args.accountId, ref)
		if (parent) {
			const conv = await repo.getMailConversation(tx, args.workspaceId, parent.conversationId)
			if (conv) return conv
		}
	}

	// 2. Same account + same normalized subject → thread (RFC 8621 heuristic).
	if (normalized) {
		const candidate = await repo.findConversationByThreadKey(tx, args.workspaceId, args.accountId, normalized)
		if (candidate) return candidate
	}

	return repo.insertMailConversation(tx, {
		workspaceId: args.workspaceId,
		inboxId: args.inboxId,
		accountId: args.accountId,
		subject: args.parsed.subject || '(no subject)',
		normalizedSubject: normalized || `(single-${uuid7()})`,
		customerEmail: args.parsed.from?.email ?? null,
		lastMessageAt: new Date().toISOString()
	})
}

// ---------- worker entry points ----------

export interface MailWorkerDeps {
	readonly storage: BlobStorage
	readonly cfg: MailModuleConfig
	readonly dns?: DnsLike | undefined
	/** Test/self-host seam: bypasses provider transport resolution entirely. */
	readonly transportOverride?: MailTransport | undefined
}

function decryptedCreds(account: repo.MailAccountRow, rootSecret: string): Record<string, unknown> {
	if (!account.credentialsEncrypted) return {}
	return JSON.parse(
		decryptSecret(rootSecret, `mail-account:${account.workspaceId}`, account.credentialsEncrypted)
	) as Record<string, unknown>
}

/** Build the outbound transport for an account (relay vs provider API). */
function transportFor(
	account: repo.MailAccountRow,
	creds: Record<string, unknown>,
	cfg: MailModuleConfig,
	accessToken?: string
): MailTransport {
	if (account.provider === 'gmail' && accessToken) return createGmailTransport(accessToken)
	if (account.provider === 'graph' && accessToken) return createGraphTransport(accessToken)
	if (account.provider === 'imap' && creds['smtpHost']) {
		return createSmtpTransport({
			host: String(creds['smtpHost']),
			port: Number(creds['smtpPort'] ?? 465),
			secure: creds['smtpTls'] !== false,
			user: creds['smtpUser'] ? String(creds['smtpUser']) : undefined,
			pass: creds['smtpPassword'] ? String(creds['smtpPassword']) : undefined
		})
	}
	if (cfg.smtpRelay) return createSmtpTransport(cfg.smtpRelay)
	throw new MailProviderError('mail_provider_unconfigured', 'No outbound transport configured')
}

/** Poll a connected-mailbox account and ingest its new messages. */
export async function syncAccount(
	tx: Queryable,
	workspaceId: string,
	accountId: string,
	deps: MailWorkerDeps
): Promise<{ ingested: number }> {
	const account = await repo.getMailAccount(tx, workspaceId, accountId)
	if (!account || account.status === 'disconnected') return { ingested: 0 }
	const creds = decryptedCreds(account, deps.cfg.rootSecret)

	let poller: MailPoller
	if (account.provider === 'imap') {
		poller = createImapPoller()
	} else if (account.provider === 'gmail') {
		const token = await refreshOAuthToken(
			'gmail',
			creds as unknown as OAuthCredentials,
			deps.cfg.gmailClientId ?? '',
			deps.cfg.gmailClientSecret ?? ''
		)
		poller = createGmailPoller(token.accessToken)
	} else if (account.provider === 'graph') {
		const token = await refreshOAuthToken(
			'graph',
			creds as unknown as OAuthCredentials,
			deps.cfg.msClientId ?? '',
			deps.cfg.msClientSecret ?? ''
		)
		poller = createGraphPoller(token.accessToken)
	} else {
		return { ingested: 0 } // inbound_parse accounts have no poller
	}

	const batch = await poller.poll({
		accountAddress: account.address,
		credentials: creds,
		syncState: account.syncState,
		maxMessages: 500
	})
	let ingested = 0
	for (const m of batch.messages) {
		const inboxId = account.defaultInboxId ?? (await ensureDefaultInbox(tx, workspaceId, account.createdBy))
		const res = await ingestRawMime(
			tx,
			{
				workspaceId,
				accountId: account.id,
				inboxId,
				raw: m.raw,
				providerRef: { provider: account.provider, providerMessageId: m.providerMessageId }
			},
			deps.storage
		)
		if (res) ingested++
	}
	await repo.updateMailAccount(tx, workspaceId, accountId, {
		syncState: batch.nextSyncState,
		lastSyncedAt: new Date().toISOString(),
		status: 'active',
		statusDetail: null
	})
	return { ingested }
}

async function ensureDefaultInbox(
	tx: Queryable,
	workspaceId: string,
	createdBy: string | null
): Promise<string> {
	const inboxes = await repo.listMailInboxes(tx, workspaceId)
	if (inboxes.length > 0) return inboxes[0]!.id
	const row = await repo.insertMailInbox(tx, {
		workspaceId,
		name: 'Inbox',
		position: 'a0',
		settings: {},
		createdBy
	})
	return row.id
}

/** Send a queued draft after its undo window (§14.5). */
export async function sendDueDraft(
	tx: Queryable,
	workspaceId: string,
	draftId: string,
	deps: MailWorkerDeps
): Promise<boolean> {
	const draft = await repo.getMailDraft(tx, workspaceId, draftId)
	if (!draft || draft.status !== 'sending') return false
	if (draft.scheduledSendAt && new Date(draft.scheduledSendAt).getTime() > Date.now()) return false

	const conv = await repo.getMailConversation(tx, workspaceId, draft.conversationId)
	if (!conv) return false
	const account = await repo.getMailAccount(tx, workspaceId, conv.accountId)
	if (!account) return false
	const identity = await repo.getMailIdentity(tx, workspaceId, draft.identityId)
	if (!identity) return false

	const creds = decryptedCreds(account, deps.cfg.rootSecret)
	let accessToken: string | undefined
	if ((account.provider === 'gmail' || account.provider === 'graph') && !deps.transportOverride) {
		const oauth = await refreshOAuthToken(
			account.provider,
			creds as unknown as OAuthCredentials,
			account.provider === 'gmail' ? (deps.cfg.gmailClientId ?? '') : (deps.cfg.msClientId ?? ''),
			account.provider === 'gmail' ? (deps.cfg.gmailClientSecret ?? '') : (deps.cfg.msClientSecret ?? '')
		)
		accessToken = oauth.accessToken
	}
	const transport = deps.transportOverride ?? transportFor(account, creds, deps.cfg, accessToken)

	const recipients = draft.recipients as {
		to: { email: string; name?: string | null }[]
		cc?: { email: string; name?: string | null }[]
		bcc?: { email: string; name?: string | null }[]
	}
	const metaObj =
		draft.metadata && typeof draft.metadata === 'object' && !Array.isArray(draft.metadata)
			? (draft.metadata as Record<string, unknown>)
			: {}
	const attachmentIds = Array.isArray(metaObj['attachmentFileIds'])
		? metaObj['attachmentFileIds'].filter((id): id is string => typeof id === 'string')
		: []
	const attachmentFiles =
		attachmentIds.length > 0 ? await getFilesByIdsForAttachment(tx, workspaceId, attachmentIds) : []
	const outboundAttachments: { filename: string; contentType: string; content: Uint8Array }[] = []
	const messageAttachmentsMeta: Record<string, unknown>[] = []
	for (const [idx, file] of attachmentFiles.entries()) {
		messageAttachmentsMeta.push({
			fileId: file.id,
			name: file.filename,
			contentType: file.contentType,
			byteSize: file.byteSize,
			scanStatus: file.scanStatus
		})
		if (file.scanStatus !== 'infected' && file.scanStatus !== 'failed') {
			try {
				const content = await deps.storage.readFile(`files/${workspaceId}/${file.id}`)
				outboundAttachments.push({ filename: file.filename, contentType: file.contentType, content })
			} catch {
				// Storage object may remain in quarantine in test/preview environments.
			}
		}
		void idx
	}
	const rfcMessageId = `<${uuid7()}@${account.address.split('@')[1]}>`
	const inReplyToMsg = draft.inReplyToId
		? await repo.getMailMessage(tx, workspaceId, draft.inReplyToId)
		: null

	try {
		const result = await transport.send({
			from: { email: identity.address, name: identity.displayName },
			to: recipients.to,
			cc: recipients.cc ?? [],
			bcc: recipients.bcc ?? [],
			subject: conv.subject,
			textBody: draft.bodyText,
			htmlBody: null,
			inReplyTo: inReplyToMsg?.rfcMessageId ?? null,
			references: inReplyToMsg
				? [...inReplyToMsg.referencesIds, inReplyToMsg.rfcMessageId ?? ''].filter(Boolean)
				: [],
			messageId: rfcMessageId,
			attachments: outboundAttachments
		})
		const msg = await repo.insertMailMessage(tx, {
			workspaceId,
			conversationId: conv.id,
			accountId: account.id,
			direction: 'outbound',
			rfcMessageId,
			inReplyTo: inReplyToMsg?.rfcMessageId ?? null,
			referencesIds: inReplyToMsg
				? [...inReplyToMsg.referencesIds, inReplyToMsg.rfcMessageId ?? ''].filter(Boolean)
				: [],
			fromAddr: { email: identity.address, name: identity.displayName },
			toAddrs: recipients.to,
			ccAddrs: recipients.cc ?? [],
			subject: conv.subject,
			snippet: draft.bodyText.slice(0, 200),
			sentAt: new Date().toISOString(),
			receivedAt: new Date().toISOString(),
			rawBlobKey: null,
			bodyHtml: null,
			bodyText: draft.bodyText,
			attachments: messageAttachmentsMeta,
			authResults: null,
			providerRef: { provider: account.provider, providerMessageId: result.providerMessageId },
			sendState: 'sent',
			createdBy: draft.lastEditedBy ?? draft.createdBy
		})
		if (msg) {
			for (const [position, file] of attachmentFiles.entries()) {
				await repo.insertMessageAttachment(tx, {
					workspaceId,
					messageId: msg.id,
					fileId: file.id,
					position
				})
			}
		}
		await repo.updateMailDraft(tx, workspaceId, draftId, {
			status: 'sent',
			sentMessageId: msg?.id ?? null
		})
		await repo.updateConversationAfterMessage(tx, workspaceId, conv.id, {
			lastMessageAt: new Date().toISOString(),
			firstReplyAt: conv.firstReplyAt ?? new Date().toISOString()
		})
		return true
	} catch (err) {
		await repo.updateMailDraft(tx, workspaceId, draftId, { status: 'draft' })
		if (err instanceof MailProviderError) {
			throw new HttpError(502, 'mail_provider_unconfigured', 'Outbound transport failed')
		}
		throw err
	}
}

/** Retention sweep (§14.7): delete expired messages + raw blobs per inbox policy. */
export async function runRetentionSweep(
	tx: Queryable,
	workspaceId: string,
	storage: BlobStorage
): Promise<{ deleted: number }> {
	const inboxes = await repo.listMailInboxes(tx, workspaceId)
	let deleted = 0
	for (const inbox of inboxes) {
		const days = Number(inbox.settings['retentionDays'] ?? 0)
		if (!days || days <= 0) continue
		const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
		const expired = await tx<{ id: string; rawBlobKey: string | null }[]>`
			SELECT m.id, m.raw_blob_key AS "rawBlobKey"
			FROM mail_messages m
			JOIN mail_conversations c ON c.workspace_id = m.workspace_id AND c.id = m.conversation_id
			WHERE m.workspace_id = ${workspaceId}
				AND c.inbox_id = ${inbox.id}
				AND m.received_at < ${cutoff}
		`
		for (const m of expired) {
			if (m.rawBlobKey) await storage.deleteObject(m.rawBlobKey).catch(() => undefined)
			await tx`DELETE FROM mail_messages WHERE workspace_id = ${workspaceId} AND id = ${m.id}`
			deleted++
		}
	}
	return { deleted }
}

/** Export a conversation as JSON + raw EML bundle (§14.7 retention+export). */
export async function exportConversation(
	tx: Queryable,
	actor: ActorContext,
	conversationId: string,
	storage: BlobStorage
): Promise<{ json: MailTimelineDto; emls: { messageId: string; data: Uint8Array }[] }> {
	const timeline = await getConversationTimeline(tx, actor, conversationId)
	const emls: { messageId: string; data: Uint8Array }[] = []
	const rows = await repo.listConversationMessages(tx, actor.workspaceId, conversationId)
	for (const m of rows) {
		if (!m.rawBlobKey) continue
		try {
			emls.push({ messageId: m.id, data: await storage.readQuarantine(m.rawBlobKey) })
		} catch {
			// Missing blob → still export the JSON side.
		}
	}
	return { json: timeline, emls }
}

// ---------- outbox dispatch ----------

export interface MailOutboxEvent {
	readonly id: string
	readonly workspaceId: string | null
	readonly eventType: string
	readonly payload: Record<string, unknown>
}

/**
 * Worker drain entry — claims the event (idempotent), then dispatches to the
 * matching handler. `true` means fully handled.
 */
export async function processMailOutboxEvent(
	tx: Queryable,
	event: MailOutboxEvent,
	deps: MailWorkerDeps
): Promise<boolean> {
	if (!event.workspaceId) return false
	const [claimed] = await tx<{ id: string }[]>`
		INSERT INTO processed_events (consumer, event_id)
		VALUES (${MAIL_CONSUMER}, ${event.id})
		ON CONFLICT (consumer, event_id) DO NOTHING
		RETURNING event_id AS "id"
	`
	if (!claimed) return false

	const p = event.payload
	if (event.eventType === MAIL_EVENTS.InboundReceived) {
		const rawKey = typeof p['rawBlobKey'] === 'string' ? p['rawBlobKey'] : null
		const accountId = typeof p['accountId'] === 'string' ? p['accountId'] : null
		const inboxId = typeof p['inboxId'] === 'string' ? p['inboxId'] : null
		if (!rawKey || !accountId || !inboxId) return true
		const raw = await deps.storage.readQuarantine(rawKey)
		await ingestRawMime(
			tx,
			{ workspaceId: event.workspaceId, accountId, inboxId, raw, providerRef: { origin: 'inbound_parse' } },
			deps.storage
		)
		return true
	}
	if (event.eventType === MAIL_EVENTS.AccountSyncRequested) {
		const accountId = typeof p['accountId'] === 'string' ? p['accountId'] : null
		if (!accountId) return true
		await syncAccount(tx, event.workspaceId, accountId, deps)
		return true
	}
	if (event.eventType === MAIL_EVENTS.OutboundDue) {
		const draftId = typeof p['draftId'] === 'string' ? p['draftId'] : null
		if (!draftId) return true
		await sendDueDraft(tx, event.workspaceId, draftId, deps)
		return true
	}
	if (event.eventType === MAIL_EVENTS.RetentionSweep) {
		await runRetentionSweep(tx, event.workspaceId, deps.storage)
		return true
	}
	if (event.eventType === 'tasks.issue.status_changed.v1') {
		const issueId = typeof p['issueId'] === 'string' ? p['issueId'] : null
		const statusId = typeof p['statusId'] === 'string' ? p['statusId'] : null
		if (!issueId || !statusId) return true
		const [status] = await tx<{ category: string }[]>`
			SELECT category FROM project_statuses
			WHERE workspace_id = ${event.workspaceId} AND id = ${statusId}
		`
		const links = await tx<{ conversationId: string }[]>`
			SELECT conversation_id AS "conversationId"
			FROM mail_conversation_tasks
			WHERE workspace_id = ${event.workspaceId} AND task_id = ${issueId}
		`
		for (const link of links) {
			const [conv] = await tx<
				{
					id: string
					status: string
					assigneeId: string | null
					subject: string
					customerEmail: string | null
				}[]
			>`
				SELECT id, status, assignee_id AS "assigneeId", subject, customer_email AS "customerEmail"
				FROM mail_conversations
				WHERE workspace_id = ${event.workspaceId} AND id = ${link.conversationId}
				FOR UPDATE
			`
			if (!conv) continue
			const [lastLoop] = await tx<{ kind: string }[]>`
				SELECT kind FROM mail_conversation_events
				WHERE workspace_id = ${event.workspaceId}
					AND conversation_id = ${conv.id}
					AND kind IN ('linked_issue_completed', 'linked_issue_reopened')
				ORDER BY created_at DESC LIMIT 1
			`
			if (status?.category === 'completed' && lastLoop?.kind !== 'linked_issue_completed') {
				await tx`
					UPDATE mail_conversations
					SET status = 'closed', version = version + 1
					WHERE workspace_id = ${event.workspaceId} AND id = ${conv.id}
				`
				await repo.insertConversationEvent(tx, {
					workspaceId: event.workspaceId,
					conversationId: conv.id,
					kind: 'linked_issue_completed',
					actorId: null,
					payload: { issueId, issueTitle: p['title'] ?? null }
				})
				// Resolution-loop draft: deterministic server-generated first draft today;
				// workspaces with AI enabled can replace this body through compose AI.
				if (conv.customerEmail) {
					const [identity] = await tx<{ id: string }[]>`
						SELECT i.id
						FROM mail_identities i
						JOIN mail_conversations c ON c.workspace_id = i.workspace_id AND c.account_id = i.account_id
						WHERE c.workspace_id = ${event.workspaceId} AND c.id = ${conv.id}
						ORDER BY i.is_default DESC, i.created_at ASC LIMIT 1
					`
					if (identity) {
						await tx`
							INSERT INTO mail_drafts (workspace_id, conversation_id, identity_id, recipients, body, body_text, status, metadata, created_by)
							VALUES (
								${event.workspaceId}, ${conv.id}, ${identity.id},
								${tx.json({ to: [{ email: conv.customerEmail }] } as never)},
								'{}'::jsonb,
								${`Hi,\n\nThe issue linked to this conversation (${String(p['identifier'] ?? '')}: ${String(p['title'] ?? '')}) has been completed. Please let us know if anything still needs attention.\n\nBest regards`},
								'draft', ${tx.json({ generatedBy: 'issue_resolution_loop', issueId } as never)}, NULL
							)
						`
					}
				}
			} else if (status && status.category !== 'completed' && lastLoop?.kind === 'linked_issue_completed') {
				await tx`
					UPDATE mail_conversations
					SET status = 'open', version = version + 1
					WHERE workspace_id = ${event.workspaceId} AND id = ${conv.id}
				`
				await repo.insertConversationEvent(tx, {
					workspaceId: event.workspaceId,
					conversationId: conv.id,
					kind: 'linked_issue_reopened',
					actorId: null,
					payload: { issueId, issueTitle: p['title'] ?? null }
				})
				if (conv.assigneeId) {
					await tx`
						INSERT INTO notifications (workspace_id, recipient_user_id, actor_type, actor_id, kind, entity_type, entity_id, title, body, metadata)
						VALUES (${event.workspaceId}, ${conv.assigneeId}, 'system', NULL, 'mail.linked_issue_reopened',
							'mail_conversation', ${conv.id}, 'Linked issue reopened', ${conv.subject}, '{}'::jsonb)
					`
				}
			}
		}
		return true
	}
	// mail.conversation.changed → nothing to do here; search/notifications
	// consume the same event via their own processed_events consumers.
	return true
}
