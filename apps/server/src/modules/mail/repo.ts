/**
 * Mail repo (§14.3): tenant-scoped queries only — every call happens inside
 * `withWorkspace`, so `workspace_id` is pinned by RLS and the composite FKs.
 */
import type { Queryable } from '@huriro/db'

export interface MailAccountRow {
	readonly id: string
	readonly workspaceId: string
	readonly provider: 'inbound_parse' | 'gmail' | 'graph' | 'imap' | 'jmap'
	readonly address: string
	readonly displayName: string | null
	readonly credentialsEncrypted: string | null
	readonly config: Record<string, unknown>
	readonly syncState: Record<string, unknown>
	readonly defaultInboxId: string | null
	readonly status: 'active' | 'pending_verification' | 'error' | 'disconnected'
	readonly statusDetail: string | null
	readonly lastSyncedAt: string | null
	readonly createdBy: string | null
	readonly createdAt: string
	readonly updatedAt: string
	readonly version: number
}

export interface MailIdentityRow {
	readonly id: string
	readonly workspaceId: string
	readonly accountId: string
	readonly address: string
	readonly displayName: string | null
	readonly signature: Record<string, unknown>
	readonly isDefault: boolean
	readonly createdBy: string | null
	readonly createdAt: string
	readonly updatedAt: string
	readonly version: number
}

export interface MailInboxRow {
	readonly id: string
	readonly workspaceId: string
	readonly name: string
	readonly position: string
	readonly settings: Record<string, unknown>
	readonly createdBy: string | null
	readonly createdAt: string
	readonly updatedAt: string
	readonly version: number
	readonly openCount?: number
}

export interface MailConversationRow {
	readonly id: string
	readonly workspaceId: string
	readonly inboxId: string
	readonly accountId: string
	readonly subject: string
	readonly normalizedSubject: string
	readonly status: 'open' | 'pending' | 'snoozed' | 'closed' | 'spam'
	readonly assigneeId: string | null
	readonly snoozedUntil: string | null
	readonly mergedIntoId: string | null
	readonly lastMessageAt: string
	readonly firstReplyAt: string | null
	readonly customerEmail: string | null
	readonly snippet?: string | undefined
	readonly messageCount?: number | undefined
	readonly createdAt: string
	readonly updatedAt: string
	readonly version: number
	readonly accountProvider?: string | undefined
	readonly accountAddress?: string | undefined
	readonly accountVisibility?: 'workspace' | 'private' | undefined
}

export interface MailMessageRow {
	readonly id: string
	readonly workspaceId: string
	readonly conversationId: string
	readonly accountId: string
	readonly direction: 'inbound' | 'outbound'
	readonly rfcMessageId: string | null
	readonly inReplyTo: string | null
	readonly referencesIds: readonly string[]
	readonly fromAddr: { email: string; name?: string | null }
	readonly toAddrs: readonly { email: string; name?: string | null }[]
	readonly ccAddrs: readonly { email: string; name?: string | null }[]
	readonly subject: string | null
	readonly snippet: string
	readonly sentAt: string | null
	readonly receivedAt: string
	readonly rawBlobKey: string | null
	readonly bodyHtml: string | null
	readonly bodyText: string | null
	readonly attachments: readonly Record<string, unknown>[]
	readonly authResults: Record<string, unknown> | null
	readonly providerRef: Record<string, unknown>
	readonly sendState: 'queued' | 'sending' | 'sent' | 'delivered' | 'bounced' | 'failed' | null
	readonly createdBy: string | null
	readonly createdAt: string
}

export interface MailEventRow {
	readonly id: string
	readonly workspaceId: string
	readonly conversationId: string
	readonly kind: string
	readonly actorId: string | null
	readonly actorName?: string | null
	readonly payload: Record<string, unknown>
	readonly createdAt: string
}

export interface MailCommentRow {
	readonly id: string
	readonly workspaceId: string
	readonly conversationId: string
	readonly authorId: string
	readonly authorName?: string | null
	readonly body: Record<string, unknown>
	readonly bodyText: string
	readonly mentions: readonly string[]
	readonly createdAt: string
	readonly updatedAt: string
}

export interface MailDraftRow {
	readonly id: string
	readonly workspaceId: string
	readonly conversationId: string
	readonly identityId: string
	readonly createdBy: string
	readonly lastEditedBy: string | null
	readonly body: Record<string, unknown>
	readonly bodyText: string
	readonly recipients: Record<string, unknown>
	readonly inReplyToId: string | null
	readonly scheduledSendAt: string | null
	readonly status: 'draft' | 'sending' | 'sent' | 'discarded'
	readonly sentMessageId: string | null
	readonly lockedBy: string | null
	readonly lockedUntil: string | null
	readonly version: number
	readonly createdAt: string
	readonly updatedAt: string
	readonly identityAddress?: string | undefined
	readonly identityName?: string | null | undefined
}

export interface LinkedTaskRow {
	readonly taskId: string
	readonly identifier: string | null
	readonly title: string | null
}

export interface LinkedDocRow {
	readonly pageId: string
	readonly slug: string | null
	readonly title: string | null
}

// ---------- accounts ----------
export async function listMailAccounts(tx: Queryable, workspaceId: string): Promise<MailAccountRow[]> {
	return tx<MailAccountRow[]>`
		SELECT id, workspace_id AS "workspaceId", provider, address, display_name AS "displayName",
			credentials_encrypted AS "credentialsEncrypted", config, sync_state AS "syncState",
			default_inbox_id AS "defaultInboxId", status, status_detail AS "statusDetail",
			last_synced_at AS "lastSyncedAt", created_by AS "createdBy",
			created_at AS "createdAt", updated_at AS "updatedAt", version
		FROM mail_accounts
		WHERE workspace_id = ${workspaceId}
		ORDER BY created_at ASC
	`
}

export async function getMailAccount(
	tx: Queryable,
	workspaceId: string,
	accountId: string
): Promise<MailAccountRow | null> {
	const [row] = await tx<MailAccountRow[]>`
		SELECT id, workspace_id AS "workspaceId", provider, address, display_name AS "displayName",
			credentials_encrypted AS "credentialsEncrypted", config, sync_state AS "syncState",
			default_inbox_id AS "defaultInboxId", status, status_detail AS "statusDetail",
			last_synced_at AS "lastSyncedAt", created_by AS "createdBy",
			created_at AS "createdAt", updated_at AS "updatedAt", version
		FROM mail_accounts
		WHERE workspace_id = ${workspaceId} AND id = ${accountId}
	`
	return row ?? null
}

export async function getMailAccountByAddress(
	tx: Queryable,
	workspaceId: string,
	address: string
): Promise<MailAccountRow | null> {
	const [row] = await tx<MailAccountRow[]>`
		SELECT id, workspace_id AS "workspaceId", provider, address, display_name AS "displayName",
			credentials_encrypted AS "credentialsEncrypted", config, sync_state AS "syncState",
			default_inbox_id AS "defaultInboxId", status, status_detail AS "statusDetail",
			last_synced_at AS "lastSyncedAt", created_by AS "createdBy",
			created_at AS "createdAt", updated_at AS "updatedAt", version
		FROM mail_accounts
		WHERE workspace_id = ${workspaceId} AND address = ${address}
	`
	return row ?? null
}

export async function insertMailAccount(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly provider: MailAccountRow['provider']
		readonly address: string
		readonly displayName: string | null
		readonly credentialsEncrypted: string | null
		readonly config: Record<string, unknown>
		readonly defaultInboxId: string | null
		readonly createdBy: string | null
		readonly status?: MailAccountRow['status'] | undefined
	}
): Promise<MailAccountRow> {
	const [row] = await tx<MailAccountRow[]>`
		INSERT INTO mail_accounts (
			workspace_id, provider, address, display_name, credentials_encrypted,
			config, default_inbox_id, created_by, status
		)
		VALUES (
			${args.workspaceId}, ${args.provider}, ${args.address}, ${args.displayName},
			${args.credentialsEncrypted}, ${tx.json(args.config as never)},
			${args.defaultInboxId}, ${args.createdBy}, ${args.status ?? 'active'}
		)
		RETURNING id, workspace_id AS "workspaceId", provider, address, display_name AS "displayName",
			credentials_encrypted AS "credentialsEncrypted", config, sync_state AS "syncState",
			default_inbox_id AS "defaultInboxId", status, status_detail AS "statusDetail",
			last_synced_at AS "lastSyncedAt", created_by AS "createdBy",
			created_at AS "createdAt", updated_at AS "updatedAt", version
	`
	return row!
}

export async function updateMailAccount(
	tx: Queryable,
	workspaceId: string,
	accountId: string,
	patch: {
		readonly displayName?: string | null | undefined
		readonly defaultInboxId?: string | null | undefined
		readonly status?: MailAccountRow['status'] | undefined
		readonly statusDetail?: string | null | undefined
		readonly syncState?: Record<string, unknown> | undefined
		readonly config?: Record<string, unknown> | undefined
		readonly lastSyncedAt?: string | null | undefined
	},
	expectedVersion?: number
): Promise<MailAccountRow | null> {
	const [row] = await tx<MailAccountRow[]>`
		UPDATE mail_accounts SET
			display_name  = COALESCE(${patch.displayName ?? null}, display_name),
			default_inbox_id = COALESCE(${patch.defaultInboxId ?? null}, default_inbox_id),
			status        = COALESCE(${patch.status ?? null}, status),
			status_detail = COALESCE(${patch.statusDetail ?? null}, status_detail),
			sync_state    = COALESCE(${patch.syncState ? tx.json(patch.syncState as never) : null}, sync_state),
			config        = COALESCE(${patch.config ? tx.json(patch.config as never) : null}, config),
			last_synced_at = COALESCE(${patch.lastSyncedAt ?? null}, last_synced_at),
			version       = version + 1
		WHERE workspace_id = ${workspaceId}
			AND id = ${accountId}
			${expectedVersion !== undefined ? tx`AND version = ${expectedVersion}` : tx``}
		RETURNING id, workspace_id AS "workspaceId", provider, address, display_name AS "displayName",
			credentials_encrypted AS "credentialsEncrypted", config, sync_state AS "syncState",
			default_inbox_id AS "defaultInboxId", status, status_detail AS "statusDetail",
			last_synced_at AS "lastSyncedAt", created_by AS "createdBy",
			created_at AS "createdAt", updated_at AS "updatedAt", version
	`
	return row ?? null
}

// ---------- identities ----------
export async function listMailIdentities(
	tx: Queryable,
	workspaceId: string,
	accountId?: string
): Promise<MailIdentityRow[]> {
	return tx<MailIdentityRow[]>`
		SELECT id, workspace_id AS "workspaceId", account_id AS "accountId", address,
			display_name AS "displayName", signature, is_default AS "isDefault",
			created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version
		FROM mail_identities
		WHERE workspace_id = ${workspaceId}
			${accountId ? tx`AND account_id = ${accountId}` : tx``}
		ORDER BY account_id, is_default DESC, created_at ASC
	`
}

export async function getMailIdentity(
	tx: Queryable,
	workspaceId: string,
	identityId: string
): Promise<MailIdentityRow | null> {
	const [row] = await tx<MailIdentityRow[]>`
		SELECT id, workspace_id AS "workspaceId", account_id AS "accountId", address,
			display_name AS "displayName", signature, is_default AS "isDefault",
			created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version
		FROM mail_identities
		WHERE workspace_id = ${workspaceId} AND id = ${identityId}
	`
	return row ?? null
}

export async function insertMailIdentity(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly accountId: string
		readonly address: string
		readonly displayName: string | null
		readonly signature: Record<string, unknown>
		readonly isDefault: boolean
		readonly createdBy: string | null
	}
): Promise<MailIdentityRow> {
	if (args.isDefault) {
		await tx`
			UPDATE mail_identities SET is_default = false
			WHERE workspace_id = ${args.workspaceId} AND account_id = ${args.accountId} AND is_default
		`
	}
	const [row] = await tx<MailIdentityRow[]>`
		INSERT INTO mail_identities (workspace_id, account_id, address, display_name, signature, is_default, created_by)
		VALUES (
			${args.workspaceId}, ${args.accountId}, ${args.address}, ${args.displayName},
			${tx.json(args.signature as never)}, ${args.isDefault}, ${args.createdBy}
		)
		RETURNING id, workspace_id AS "workspaceId", account_id AS "accountId", address,
			display_name AS "displayName", signature, is_default AS "isDefault",
			created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version
	`
	return row!
}

// ---------- inboxes ----------
export async function listMailInboxes(tx: Queryable, workspaceId: string): Promise<MailInboxRow[]> {
	return tx<MailInboxRow[]>`
		SELECT i.id, i.workspace_id AS "workspaceId", i.name, i.position, i.settings,
			i.created_by AS "createdBy", i.created_at AS "createdAt", i.updated_at AS "updatedAt", i.version,
			(SELECT COUNT(*) FROM mail_conversations c
			 WHERE c.workspace_id = i.workspace_id AND c.inbox_id = i.id AND c.status = 'open') AS "openCount"
		FROM mail_inboxes i
		WHERE i.workspace_id = ${workspaceId}
		ORDER BY i.position ASC
	`
}

export async function getMailInbox(
	tx: Queryable,
	workspaceId: string,
	inboxId: string
): Promise<MailInboxRow | null> {
	const [row] = await tx<MailInboxRow[]>`
		SELECT i.id, i.workspace_id AS "workspaceId", i.name, i.position, i.settings,
			i.created_by AS "createdBy", i.created_at AS "createdAt", i.updated_at AS "updatedAt", i.version,
			(SELECT COUNT(*) FROM mail_conversations c
			 WHERE c.workspace_id = i.workspace_id AND c.inbox_id = i.id AND c.status = 'open') AS "openCount"
		FROM mail_inboxes i
		WHERE i.workspace_id = ${workspaceId} AND i.id = ${inboxId}
	`
	return row ?? null
}

export async function insertMailInbox(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly name: string
		readonly position: string
		readonly settings: Record<string, unknown>
		readonly createdBy: string | null
	}
): Promise<MailInboxRow> {
	const [row] = await tx<MailInboxRow[]>`
		INSERT INTO mail_inboxes (workspace_id, name, position, settings, created_by)
		VALUES (${args.workspaceId}, ${args.name}, ${args.position}, ${tx.json(args.settings as never)}, ${args.createdBy})
		RETURNING id, workspace_id AS "workspaceId", name, position, settings,
			created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version,
			0 AS "openCount"
	`
	return row!
}

// ---------- conversations ----------
export async function listMailConversations(
	tx: Queryable,
	workspaceId: string,
	filter: {
		readonly inboxId?: string | undefined
		readonly status?: string | undefined
		readonly assigneeId?: string | null | undefined
		readonly unassigned?: boolean | undefined
		readonly q?: string | undefined
		readonly cursor?: { readonly lastMessageAt: string; readonly id: string } | undefined
		readonly limit: number
		readonly accountIds?: readonly string[] | undefined
	}
): Promise<MailConversationRow[]> {
	const accessible = filter.accountIds
	const lim = filter.limit + 1
	const rows = await tx<MailConversationRow[]>`
		SELECT c.id, c.workspace_id AS "workspaceId", c.inbox_id AS "inboxId", c.account_id AS "accountId",
			c.subject, c.normalized_subject AS "normalizedSubject", c.status,
			c.assignee_id AS "assigneeId", c.snoozed_until AS "snoozedUntil",
			c.merged_into_id AS "mergedIntoId", c.last_message_at AS "lastMessageAt",
			c.first_reply_at AS "firstReplyAt", c.customer_email AS "customerEmail",
			c.created_at AS "createdAt", c.updated_at AS "updatedAt", c.version,
			(SELECT m.snippet FROM mail_messages m
			 WHERE m.workspace_id = c.workspace_id AND m.conversation_id = c.id
			 ORDER BY m.received_at DESC LIMIT 1) AS "snippet",
			(SELECT COUNT(*) FROM mail_messages m
			 WHERE m.workspace_id = c.workspace_id AND m.conversation_id = c.id) AS "messageCount",
			a.provider AS "accountProvider", a.address AS "accountAddress",
			(CASE WHEN (a.config->>'visibility') = 'private' THEN 'private' ELSE 'workspace' END) AS "accountVisibility",
			(SELECT u.display_name FROM users u WHERE u.id = c.assignee_id) AS "assigneeName"
		FROM mail_conversations c
		JOIN mail_accounts a ON a.workspace_id = c.workspace_id AND a.id = c.account_id
		WHERE c.workspace_id = ${workspaceId}
			${filter.inboxId ? tx`AND c.inbox_id = ${filter.inboxId}` : tx``}
			${filter.status ? tx`AND c.status = ${filter.status}` : tx`AND c.status != 'snoozed'`}
			${filter.assigneeId !== undefined && filter.assigneeId !== null ? tx`AND c.assignee_id = ${filter.assigneeId}` : tx``}
			${filter.unassigned ? tx`AND c.assignee_id IS NULL` : tx``}
			${filter.q ? tx`AND (c.subject ILIKE ${`%${filter.q}%`} OR c.customer_email ILIKE ${`%${filter.q}%`})` : tx``}
			${accessible && accessible.length > 0 ? tx`AND c.account_id = ANY(${[...accessible]}::uuid[])` : tx``}
			${filter.cursor ? tx`AND (c.last_message_at, c.id) < (${filter.cursor.lastMessageAt}, ${filter.cursor.id})` : tx``}
		ORDER BY c.last_message_at DESC, c.id DESC
		LIMIT ${lim}
	`
	return rows.slice(0, filter.limit)
}

export async function getMailConversation(
	tx: Queryable,
	workspaceId: string,
	conversationId: string
): Promise<MailConversationRow | null> {
	const [row] = await tx<MailConversationRow[]>`
		SELECT c.id, c.workspace_id AS "workspaceId", c.inbox_id AS "inboxId", c.account_id AS "accountId",
			c.subject, c.normalized_subject AS "normalizedSubject", c.status,
			c.assignee_id AS "assigneeId", c.snoozed_until AS "snoozedUntil",
			c.merged_into_id AS "mergedIntoId", c.last_message_at AS "lastMessageAt",
			c.first_reply_at AS "firstReplyAt", c.customer_email AS "customerEmail",
			c.created_at AS "createdAt", c.updated_at AS "updatedAt", c.version,
			(SELECT m.snippet FROM mail_messages m
			 WHERE m.workspace_id = c.workspace_id AND m.conversation_id = c.id
			 ORDER BY m.received_at DESC LIMIT 1) AS "snippet",
			(SELECT COUNT(*) FROM mail_messages m
			 WHERE m.workspace_id = c.workspace_id AND m.conversation_id = c.id) AS "messageCount",
			a.provider AS "accountProvider", a.address AS "accountAddress",
			(CASE WHEN (a.config->>'visibility') = 'private' THEN 'private' ELSE 'workspace' END) AS "accountVisibility"
		FROM mail_conversations c
		JOIN mail_accounts a ON a.workspace_id = c.workspace_id AND a.id = c.account_id
		WHERE c.workspace_id = ${workspaceId} AND c.id = ${conversationId}
	`
	return row ?? null
}

export async function findConversationByThreadKey(
	tx: Queryable,
	workspaceId: string,
	accountId: string,
	normalizedSubject: string
): Promise<MailConversationRow | null> {
	// §14.4: same account + same normalized subject → candidate thread.
	// Messages inside are checked for Message-Id linkage in service.
	const [row] = await tx<MailConversationRow[]>`
		SELECT id, workspace_id AS "workspaceId", inbox_id AS "inboxId", account_id AS "accountId",
			subject, normalized_subject AS "normalizedSubject", status,
			assignee_id AS "assigneeId", snoozed_until AS "snoozedUntil",
			merged_into_id AS "mergedIntoId", last_message_at AS "lastMessageAt",
			first_reply_at AS "firstReplyAt", customer_email AS "customerEmail",
			created_at AS "createdAt", updated_at AS "updatedAt", version
		FROM mail_conversations
		WHERE workspace_id = ${workspaceId}
			AND account_id = ${accountId}
			AND normalized_subject = ${normalizedSubject}
			AND merged_into_id IS NULL
		ORDER BY last_message_at DESC
		LIMIT 5
	`
	return row ?? null
}

/** Collect rfc_message_ids in a conversation (threading candidates). */
export async function listMessageIdsInConversation(
	tx: Queryable,
	workspaceId: string,
	conversationId: string
): Promise<string[]> {
	const rows = await tx<{ rfcMessageId: string }[]>`
		SELECT rfc_message_id AS "rfcMessageId"
		FROM mail_messages
		WHERE workspace_id = ${workspaceId}
			AND conversation_id = ${conversationId}
			AND rfc_message_id IS NOT NULL
	`
	return rows.map((r) => r.rfcMessageId)
}

export async function findMessageByRfcId(
	tx: Queryable,
	workspaceId: string,
	accountId: string,
	rfcMessageId: string
): Promise<MailMessageRow | null> {
	const [row] = await tx<MailMessageRow[]>`
		SELECT id, workspace_id AS "workspaceId", conversation_id AS "conversationId", account_id AS "accountId",
			direction, rfc_message_id AS "rfcMessageId", in_reply_to AS "inReplyTo",
			references_ids AS "referencesIds", from_addr AS "fromAddr", to_addrs AS "toAddrs",
			cc_addrs AS "ccAddrs", subject, snippet, sent_at AS "sentAt", received_at AS "receivedAt",
			raw_blob_key AS "rawBlobKey", body_html AS "bodyHtml", body_text AS "bodyText",
			attachments, auth_results AS "authResults", provider_ref AS "providerRef",
			send_state AS "sendState", created_by AS "createdBy", created_at AS "createdAt"
		FROM mail_messages
		WHERE workspace_id = ${workspaceId} AND account_id = ${accountId} AND rfc_message_id = ${rfcMessageId}
	`
	return row ?? null
}

export async function insertMailConversation(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly inboxId: string
		readonly accountId: string
		readonly subject: string
		readonly normalizedSubject: string
		readonly customerEmail: string | null
		readonly lastMessageAt: string
	}
): Promise<MailConversationRow> {
	const [row] = await tx<MailConversationRow[]>`
		INSERT INTO mail_conversations (
			workspace_id, inbox_id, account_id, subject, normalized_subject,
			customer_email, last_message_at
		)
		VALUES (
			${args.workspaceId}, ${args.inboxId}, ${args.accountId}, ${args.subject},
			${args.normalizedSubject}, ${args.customerEmail}, ${args.lastMessageAt}
		)
		RETURNING id, workspace_id AS "workspaceId", inbox_id AS "inboxId", account_id AS "accountId",
			subject, normalized_subject AS "normalizedSubject", status,
			assignee_id AS "assigneeId", snoozed_until AS "snoozedUntil",
			merged_into_id AS "mergedIntoId", last_message_at AS "lastMessageAt",
			first_reply_at AS "firstReplyAt", customer_email AS "customerEmail",
			created_at AS "createdAt", updated_at AS "updatedAt", version
	`
	return row!
}

export async function insertMailMessage(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly conversationId: string
		readonly accountId: string
		readonly direction: 'inbound' | 'outbound'
		readonly rfcMessageId: string | null
		readonly inReplyTo: string | null
		readonly referencesIds: readonly string[]
		readonly fromAddr: { email: string; name?: string | null }
		readonly toAddrs: readonly { email: string; name?: string | null }[]
		readonly ccAddrs: readonly { email: string; name?: string | null }[]
		readonly subject: string | null
		readonly snippet: string
		readonly sentAt: string | null
		readonly receivedAt: string
		readonly rawBlobKey: string | null
		readonly bodyHtml: string | null
		readonly bodyText: string | null
		readonly attachments: readonly Record<string, unknown>[]
		readonly authResults: Record<string, unknown> | null
		readonly providerRef: Record<string, unknown>
		readonly sendState?: MailMessageRow['sendState'] | undefined
		readonly createdBy: string | null
	}
): Promise<MailMessageRow> {
	const [row] = await tx<MailMessageRow[]>`
		INSERT INTO mail_messages (
			workspace_id, conversation_id, account_id, direction, rfc_message_id,
			in_reply_to, references_ids, from_addr, to_addrs, cc_addrs, subject,
			snippet, sent_at, received_at, raw_blob_key, body_html, body_text,
			attachments, auth_results, provider_ref, send_state, created_by
		)
		VALUES (
			${args.workspaceId}, ${args.conversationId}, ${args.accountId}, ${args.direction},
			${args.rfcMessageId}, ${args.inReplyTo}, ${args.referencesIds}::text[],
			${tx.json(args.fromAddr as never)}, ${tx.json([...args.toAddrs] as never)},
			${tx.json([...args.ccAddrs] as never)}, ${args.subject}, ${args.snippet},
			${args.sentAt}, ${args.receivedAt}, ${args.rawBlobKey}, ${args.bodyHtml},
			${args.bodyText}, ${tx.json([...args.attachments] as never)},
			${args.authResults ? tx.json(args.authResults as never) : null},
			${tx.json(args.providerRef as never)}, ${args.sendState ?? null}, ${args.createdBy}
		)
		ON CONFLICT (workspace_id, account_id, rfc_message_id)
			WHERE rfc_message_id IS NOT NULL
		DO NOTHING
		RETURNING id, workspace_id AS "workspaceId", conversation_id AS "conversationId",
			account_id AS "accountId", direction, rfc_message_id AS "rfcMessageId",
			in_reply_to AS "inReplyTo", references_ids AS "referencesIds",
			from_addr AS "fromAddr", to_addrs AS "toAddrs", cc_addrs AS "ccAddrs",
			subject, snippet, sent_at AS "sentAt", received_at AS "receivedAt",
			raw_blob_key AS "rawBlobKey", body_html AS "bodyHtml", body_text AS "bodyText",
			attachments, auth_results AS "authResults", provider_ref AS "providerRef",
			send_state AS "sendState", created_by AS "createdBy", created_at AS "createdAt"
	`
	return row ?? null!
}

export async function updateConversationAfterMessage(
	tx: Queryable,
	workspaceId: string,
	conversationId: string,
	patch: {
		readonly lastMessageAt: string
		readonly status?: MailConversationRow['status'] | undefined
		readonly firstReplyAt?: string | null | undefined
		readonly customerEmail?: string | null | undefined
		readonly mergedIntoId?: string | null | undefined
		readonly assigneeId?: string | null | undefined
		readonly snoozedUntil?: string | null | undefined
	}
): Promise<void> {
	await tx`
		UPDATE mail_conversations SET
			last_message_at = ${patch.lastMessageAt},
			status          = COALESCE(${patch.status ?? null}, status),
			first_reply_at  = COALESCE(${patch.firstReplyAt ?? null}, first_reply_at),
			customer_email  = COALESCE(${patch.customerEmail ?? null}, customer_email),
			merged_into_id  = COALESCE(${patch.mergedIntoId ?? null}, merged_into_id),
			assignee_id     = COALESCE(${patch.assigneeId ?? null}, assignee_id),
			snoozed_until   = COALESCE(${patch.snoozedUntil ?? null}, snoozed_until),
			version         = version + 1
		WHERE workspace_id = ${workspaceId} AND id = ${conversationId}
	`
}

export async function updateMailConversation(
	tx: Queryable,
	workspaceId: string,
	conversationId: string,
	patch: {
		readonly status?: MailConversationRow['status'] | undefined
		readonly assigneeId?: string | null | undefined
		readonly snoozedUntil?: string | null | undefined
	},
	expectedVersion?: number
): Promise<MailConversationRow | null> {
	const [row] = await tx<MailConversationRow[]>`
		UPDATE mail_conversations SET
			status        = COALESCE(${patch.status ?? null}, status),
			-- undefined → keep, null → unassign, uuid → assign (CASE distinguishes them).
			assignee_id   = CASE WHEN ${patch.assigneeId !== undefined} THEN ${patch.assigneeId ?? null}::uuid ELSE assignee_id END,
			snoozed_until = CASE WHEN ${patch.snoozedUntil !== undefined} THEN ${patch.snoozedUntil ?? null}::timestamptz ELSE snoozed_until END,
			version       = version + 1
		WHERE workspace_id = ${workspaceId}
			AND id = ${conversationId}
			${expectedVersion !== undefined ? tx`AND version = ${expectedVersion}` : tx``}
		RETURNING id, workspace_id AS "workspaceId", inbox_id AS "inboxId", account_id AS "accountId",
			subject, normalized_subject AS "normalizedSubject", status,
			assignee_id AS "assigneeId", snoozed_until AS "snoozedUntil",
			merged_into_id AS "mergedIntoId", last_message_at AS "lastMessageAt",
			first_reply_at AS "firstReplyAt", customer_email AS "customerEmail",
			created_at AS "createdAt", updated_at AS "updatedAt", version
	`
	return row ?? null
}

// ---------- messages ----------
export async function listConversationMessages(
	tx: Queryable,
	workspaceId: string,
	conversationId: string
): Promise<MailMessageRow[]> {
	return tx<MailMessageRow[]>`
		SELECT id, workspace_id AS "workspaceId", conversation_id AS "conversationId", account_id AS "accountId",
			direction, rfc_message_id AS "rfcMessageId", in_reply_to AS "inReplyTo",
			references_ids AS "referencesIds", from_addr AS "fromAddr", to_addrs AS "toAddrs",
			cc_addrs AS "ccAddrs", subject, snippet, sent_at AS "sentAt", received_at AS "receivedAt",
			raw_blob_key AS "rawBlobKey", body_html AS "bodyHtml", body_text AS "bodyText",
			attachments, auth_results AS "authResults", provider_ref AS "providerRef",
			send_state AS "sendState", created_by AS "createdBy", created_at AS "createdAt"
		FROM mail_messages
		WHERE workspace_id = ${workspaceId} AND conversation_id = ${conversationId}
		ORDER BY received_at ASC, created_at ASC
	`
}

export async function getMailMessage(
	tx: Queryable,
	workspaceId: string,
	messageId: string
): Promise<MailMessageRow | null> {
	const [row] = await tx<MailMessageRow[]>`
		SELECT id, workspace_id AS "workspaceId", conversation_id AS "conversationId", account_id AS "accountId",
			direction, rfc_message_id AS "rfcMessageId", in_reply_to AS "inReplyTo",
			references_ids AS "referencesIds", from_addr AS "fromAddr", to_addrs AS "toAddrs",
			cc_addrs AS "ccAddrs", subject, snippet, sent_at AS "sentAt", received_at AS "receivedAt",
			raw_blob_key AS "rawBlobKey", body_html AS "bodyHtml", body_text AS "bodyText",
			attachments, auth_results AS "authResults", provider_ref AS "providerRef",
			send_state AS "sendState", created_by AS "createdBy", created_at AS "createdAt"
		FROM mail_messages
		WHERE workspace_id = ${workspaceId} AND id = ${messageId}
	`
	return row ?? null
}

export async function updateMailMessageSendState(
	tx: Queryable,
	workspaceId: string,
	messageId: string,
	sendState: MailMessageRow['sendState'],
	rawBlobKey?: string | null
): Promise<void> {
	await tx`
		UPDATE mail_messages SET
			send_state  = ${sendState},
			raw_blob_key = COALESCE(${rawBlobKey ?? null}, raw_blob_key)
		WHERE workspace_id = ${workspaceId} AND id = ${messageId}
	`
}

// ---------- events ----------
export async function insertConversationEvent(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly conversationId: string
		readonly kind: string
		readonly actorId: string | null
		readonly payload: Record<string, unknown>
	}
): Promise<MailEventRow> {
	const [row] = await tx<MailEventRow[]>`
		INSERT INTO mail_conversation_events (workspace_id, conversation_id, kind, actor_id, payload)
		VALUES (${args.workspaceId}, ${args.conversationId}, ${args.kind}, ${args.actorId}, ${tx.json(args.payload as never)})
		RETURNING id, workspace_id AS "workspaceId", conversation_id AS "conversationId",
			kind, actor_id AS "actorId", payload, created_at AS "createdAt"
	`
	return row!
}

export async function listConversationEvents(
	tx: Queryable,
	workspaceId: string,
	conversationId: string
): Promise<MailEventRow[]> {
	return tx<MailEventRow[]>`
		SELECT e.id, e.workspace_id AS "workspaceId", e.conversation_id AS "conversationId",
			e.kind, e.actor_id AS "actorId", e.payload, e.created_at AS "createdAt",
			u.display_name AS "actorName"
		FROM mail_conversation_events e
		LEFT JOIN users u ON u.id = e.actor_id
		WHERE e.workspace_id = ${workspaceId} AND e.conversation_id = ${conversationId}
		ORDER BY e.created_at ASC
	`
}

// ---------- comments (internal notes) ----------
export async function listConversationComments(
	tx: Queryable,
	workspaceId: string,
	conversationId: string
): Promise<MailCommentRow[]> {
	return tx<MailCommentRow[]>`
		SELECT c.id, c.workspace_id AS "workspaceId", c.conversation_id AS "conversationId",
			c.author_id AS "authorId", c.body, c.body_text AS "bodyText", c.mentions,
			c.created_at AS "createdAt", c.updated_at AS "updatedAt", u.display_name AS "authorName"
		FROM mail_conversation_comments c
		LEFT JOIN users u ON u.id = c.author_id
		WHERE c.workspace_id = ${workspaceId} AND c.conversation_id = ${conversationId}
		ORDER BY c.created_at ASC
	`
}

export async function insertConversationComment(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly conversationId: string
		readonly authorId: string
		readonly body: Record<string, unknown>
		readonly bodyText: string
		readonly mentions: readonly string[]
	}
): Promise<MailCommentRow> {
	const [row] = await tx<MailCommentRow[]>`
		INSERT INTO mail_conversation_comments (
			workspace_id, conversation_id, author_id, body, body_text, mentions
		)
		VALUES (
			${args.workspaceId}, ${args.conversationId}, ${args.authorId},
			${tx.json(args.body as never)}, ${args.bodyText}, ${[...args.mentions]}::uuid[]
		)
		RETURNING id, workspace_id AS "workspaceId", conversation_id AS "conversationId",
			author_id AS "authorId", body, body_text AS "bodyText", mentions,
			created_at AS "createdAt", updated_at AS "updatedAt"
	`
	return row!
}

// ---------- drafts ----------
export async function listConversationDrafts(
	tx: Queryable,
	workspaceId: string,
	conversationId: string
): Promise<MailDraftRow[]> {
	return tx<MailDraftRow[]>`
		SELECT d.id, d.workspace_id AS "workspaceId", d.conversation_id AS "conversationId",
			d.identity_id AS "identityId", d.created_by AS "createdBy",
			d.last_edited_by AS "lastEditedBy", d.body, d.body_text AS "bodyText",
			d.recipients, d.in_reply_to_id AS "inReplyToId",
			d.scheduled_send_at AS "scheduledSendAt", d.status,
			d.sent_message_id AS "sentMessageId", d.locked_by AS "lockedBy",
			d.locked_until AS "lockedUntil", d.version,
			d.created_at AS "createdAt", d.updated_at AS "updatedAt",
			i.address AS "identityAddress", i.display_name AS "identityName"
		FROM mail_drafts d
		LEFT JOIN mail_identities i ON i.workspace_id = d.workspace_id AND i.id = d.identity_id
		WHERE d.workspace_id = ${workspaceId} AND d.conversation_id = ${conversationId}
		ORDER BY d.created_at ASC
	`
}

export async function getMailDraft(
	tx: Queryable,
	workspaceId: string,
	draftId: string
): Promise<MailDraftRow | null> {
	const [row] = await tx<MailDraftRow[]>`
		SELECT d.id, d.workspace_id AS "workspaceId", d.conversation_id AS "conversationId",
			d.identity_id AS "identityId", d.created_by AS "createdBy",
			d.last_edited_by AS "lastEditedBy", d.body, d.body_text AS "bodyText",
			d.recipients, d.in_reply_to_id AS "inReplyToId",
			d.scheduled_send_at AS "scheduledSendAt", d.status,
			d.sent_message_id AS "sentMessageId", d.locked_by AS "lockedBy",
			d.locked_until AS "lockedUntil", d.version,
			d.created_at AS "createdAt", d.updated_at AS "updatedAt",
			i.address AS "identityAddress", i.display_name AS "identityName"
		FROM mail_drafts d
		LEFT JOIN mail_identities i ON i.workspace_id = d.workspace_id AND i.id = d.identity_id
		WHERE d.workspace_id = ${workspaceId} AND d.id = ${draftId}
	`
	return row ?? null
}

export async function insertMailDraft(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly conversationId: string
		readonly identityId: string
		readonly createdBy: string
		readonly body: Record<string, unknown>
		readonly bodyText: string
		readonly recipients: Record<string, unknown>
		readonly inReplyToId: string | null
	}
): Promise<MailDraftRow> {
	const [row] = await tx<MailDraftRow[]>`
		INSERT INTO mail_drafts (
			workspace_id, conversation_id, identity_id, created_by, body,
			body_text, recipients, in_reply_to_id
		)
		VALUES (
			${args.workspaceId}, ${args.conversationId}, ${args.identityId}, ${args.createdBy},
			${tx.json(args.body as never)}, ${args.bodyText}, ${tx.json(args.recipients as never)},
			${args.inReplyToId}
		)
		RETURNING id, workspace_id AS "workspaceId", conversation_id AS "conversationId",
			identity_id AS "identityId", created_by AS "createdBy",
			last_edited_by AS "lastEditedBy", body, body_text AS "bodyText",
			recipients, in_reply_to_id AS "inReplyToId",
			scheduled_send_at AS "scheduledSendAt", status,
			sent_message_id AS "sentMessageId", locked_by AS "lockedBy",
			locked_until AS "lockedUntil", version,
			created_at AS "createdAt", updated_at AS "updatedAt"
	`
	return row!
}

export async function updateMailDraft(
	tx: Queryable,
	workspaceId: string,
	draftId: string,
	patch: {
		readonly body?: Record<string, unknown> | undefined
		readonly bodyText?: string | undefined
		readonly recipients?: Record<string, unknown> | undefined
		readonly status?: MailDraftRow['status'] | undefined
		readonly scheduledSendAt?: string | null | undefined
		readonly lockedBy?: string | null | undefined
		readonly lockedUntil?: string | null | undefined
		readonly lastEditedBy?: string | null | undefined
		readonly sentMessageId?: string | null | undefined
	},
	expectedVersion?: number
): Promise<MailDraftRow | null> {
	const [row] = await tx<MailDraftRow[]>`
		UPDATE mail_drafts SET
			body           = COALESCE(${patch.body ? tx.json(patch.body as never) : null}, body),
			body_text      = COALESCE(${patch.bodyText ?? null}, body_text),
			recipients     = COALESCE(${patch.recipients ? tx.json(patch.recipients as never) : null}, recipients),
			status         = COALESCE(${patch.status ?? null}, status),
			scheduled_send_at = COALESCE(${patch.scheduledSendAt ?? null}, scheduled_send_at),
			locked_by      = CASE WHEN ${patch.lockedBy !== undefined} THEN ${patch.lockedBy ?? null}::uuid ELSE locked_by END,
			locked_until   = COALESCE(${patch.lockedUntil ?? null}, locked_until),
			last_edited_by = COALESCE(${patch.lastEditedBy ?? null}, last_edited_by),
			sent_message_id = COALESCE(${patch.sentMessageId ?? null}, sent_message_id),
			version        = version + 1
		WHERE workspace_id = ${workspaceId}
			AND id = ${draftId}
			${expectedVersion !== undefined ? tx`AND version = ${expectedVersion}` : tx``}
		RETURNING id, workspace_id AS "workspaceId", conversation_id AS "conversationId",
			identity_id AS "identityId", created_by AS "createdBy",
			last_edited_by AS "lastEditedBy", body, body_text AS "bodyText",
			recipients, in_reply_to_id AS "inReplyToId",
			scheduled_send_at AS "scheduledSendAt", status,
			sent_message_id AS "sentMessageId", locked_by AS "lockedBy",
			locked_until AS "lockedUntil", version,
			created_at AS "createdAt", updated_at AS "updatedAt"
	`
	return row ?? null
}

// ---------- links ----------
export async function listLinkedTasks(
	tx: Queryable,
	workspaceId: string,
	conversationId: string
): Promise<LinkedTaskRow[]> {
	return tx<LinkedTaskRow[]>`
		SELECT t.task_id AS "taskId", (p.key || '-' || i.number) AS "identifier", i.title
		FROM mail_conversation_tasks t
		LEFT JOIN issues i ON i.workspace_id = t.workspace_id AND i.id = t.task_id
		LEFT JOIN projects p ON p.workspace_id = i.workspace_id AND p.id = i.project_id
		WHERE t.workspace_id = ${workspaceId} AND t.conversation_id = ${conversationId}
		ORDER BY t.created_at ASC
	`
}

export async function listLinkedDocs(
	tx: Queryable,
	workspaceId: string,
	conversationId: string
): Promise<LinkedDocRow[]> {
	return tx<LinkedDocRow[]>`
		SELECT d.page_id AS "pageId", p.slug, p.title
		FROM mail_conversation_docs d
		LEFT JOIN doc_pages p ON p.workspace_id = d.workspace_id AND p.id = d.page_id
		WHERE d.workspace_id = ${workspaceId} AND d.conversation_id = ${conversationId}
		ORDER BY d.created_at ASC
	`
}

export async function linkConversationTask(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly conversationId: string
		readonly taskId: string
		readonly createdBy: string | null
	}
): Promise<void> {
	await tx`
		INSERT INTO mail_conversation_tasks (workspace_id, conversation_id, task_id, created_by)
		VALUES (${args.workspaceId}, ${args.conversationId}, ${args.taskId}, ${args.createdBy})
		ON CONFLICT (workspace_id, conversation_id, task_id) DO NOTHING
	`
}

export async function unlinkConversationTask(
	tx: Queryable,
	workspaceId: string,
	conversationId: string,
	taskId: string
): Promise<boolean> {
	const res = await tx`
		DELETE FROM mail_conversation_tasks
		WHERE workspace_id = ${workspaceId} AND conversation_id = ${conversationId} AND task_id = ${taskId}
	`
	return res.count > 0
}

export async function linkConversationDoc(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly conversationId: string
		readonly pageId: string
		readonly createdBy: string | null
	}
): Promise<void> {
	await tx`
		INSERT INTO mail_conversation_docs (workspace_id, conversation_id, page_id, created_by)
		VALUES (${args.workspaceId}, ${args.conversationId}, ${args.pageId}, ${args.createdBy})
		ON CONFLICT (workspace_id, conversation_id, page_id) DO NOTHING
	`
}

export async function unlinkConversationDoc(
	tx: Queryable,
	workspaceId: string,
	conversationId: string,
	pageId: string
): Promise<boolean> {
	const res = await tx`
		DELETE FROM mail_conversation_docs
		WHERE workspace_id = ${workspaceId} AND conversation_id = ${conversationId} AND page_id = ${pageId}
	`
	return res.count > 0
}

// ---------- attachments ----------
export async function insertMessageAttachment(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly messageId: string
		readonly fileId: string
		readonly position: number
	}
): Promise<void> {
	await tx`
		INSERT INTO mail_message_attachments (workspace_id, message_id, file_id, position)
		VALUES (${args.workspaceId}, ${args.messageId}, ${args.fileId}, ${args.position})
		ON CONFLICT (workspace_id, message_id, file_id) DO NOTHING
	`
}

// ---------- notifications integration ----------
/** List user ids who should be notified for assignment/mention on this conversation. */
export async function listConversationWatchers(
	tx: Queryable,
	workspaceId: string,
	conversationId: string
): Promise<string[]> {
	const rows = await tx<{ userId: string }[]>`
		SELECT DISTINCT author_id AS "userId"
		FROM mail_conversation_comments
		WHERE workspace_id = ${workspaceId} AND conversation_id = ${conversationId}
		UNION
		SELECT DISTINCT created_by AS "userId"
		FROM mail_messages
		WHERE workspace_id = ${workspaceId} AND conversation_id = ${conversationId} AND created_by IS NOT NULL
	`
	return rows.map((r) => r.userId)
}
