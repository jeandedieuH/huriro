/** Mail outbox event types (§14.6–§14.7): consumed by the worker drain. */
export const MAIL_EVENTS = {
	/** Raw MIME landed in quarantine → parse, sanitize, thread, ingest. */
	InboundReceived: 'mail.inbound.received',
	/** Account needs a provider sync cycle (IMAP UID, Gmail historyId, Graph delta). */
	AccountSyncRequested: 'mail.account.sync',
	/** Draft's undo window elapsed → build MIME and send via relay/provider. */
	OutboundDue: 'mail.outbound.due',
	/** Conversation/message material changed → reindex + notify. */
	ConversationChanged: 'mail.conversation.changed',
	/** Retention sweep: delete expired messages + purge raw blobs. */
	RetentionSweep: 'mail.retention.sweep'
} as const

export type MailEventType = (typeof MAIL_EVENTS)[keyof typeof MAIL_EVENTS]

export interface MailInboundPayload {
	readonly messageId: string
	readonly accountId: string
	readonly rawBlobKey: string
	readonly byteSize: number
}

export interface MailAccountSyncPayload {
	readonly accountId: string
	readonly reason: 'poll' | 'webhook' | 'manual'
}

export interface MailOutboundPayload {
	readonly draftId: string
	readonly conversationId: string
}

export interface MailConversationChangedPayload {
	readonly conversationId: string
	readonly kind:
		| 'new_message'
		| 'assigned'
		| 'status_changed'
		| 'note_added'
		| 'merged'
		| 'linked'
		| 'converted'
	readonly messageId?: string
	readonly actorId?: string | null
	/** Notification recipients for assignment/note events. */
	readonly notifyUserIds?: readonly string[]
}

export interface MailRetentionPayload {
	readonly workspaceId: string
}
