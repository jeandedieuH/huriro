/**
 * Worker-side transactional lifecycle email consumer (§4.3 outbox pattern):
 * sends welcome, invitation-accepted, billing update, and GDPR export-ready
 * emails cleanly outside DB transactions, with idempotent `processed_events`
 * tracking under `email-lifecycle`.
 */
import { type Queryable, type Sql, withWorkspace } from '@huriro/db'
import { log } from '../api/observability'
import type { EmailPipeline } from '../email'

const EMAIL_LIFECYCLE_CONSUMER = 'email-lifecycle'

export interface LifecycleOutboxEvent {
	readonly id: string
	readonly workspaceId: string | null
	readonly eventType: string
	readonly payload: Record<string, unknown>
}

interface RecipientRow {
	readonly userId: string
	readonly email: string
	readonly displayName: string
	readonly workspaceName: string
	readonly workspaceSlug: string
}

async function claimLifecycleEvent(tx: Queryable, eventId: string): Promise<boolean> {
	const rows = await tx<{ eventId: string }[]>`
		INSERT INTO processed_events (consumer, event_id)
		VALUES (${EMAIL_LIFECYCLE_CONSUMER}, ${eventId})
		ON CONFLICT (consumer, event_id) DO NOTHING
		RETURNING event_id AS "eventId"
	`
	return rows.length > 0
}

async function resolveRecipients(
	tx: Queryable,
	workspaceId: string,
	userIds: readonly string[]
): Promise<Map<string, RecipientRow>> {
	const map = new Map<string, RecipientRow>()
	if (userIds.length === 0) return map
	const rows = await tx<RecipientRow[]>`
		SELECT
			user_id AS "userId",
			email,
			display_name AS "displayName",
			workspace_name AS "workspaceName",
			workspace_slug AS "workspaceSlug"
		FROM resolve_workspace_email_recipients(${workspaceId}, ${[...userIds]}::uuid[])
	`
	for (const r of rows) map.set(r.userId, r)
	return map
}

async function listOwners(tx: Queryable, workspaceId: string): Promise<RecipientRow[]> {
	return tx<RecipientRow[]>`
		SELECT
			user_id AS "userId",
			email,
			display_name AS "displayName",
			workspace_name AS "workspaceName",
			workspace_slug AS "workspaceSlug"
		FROM list_workspace_owners_for_email(${workspaceId})
	`
}

export async function processEmailLifecycleOutboxEvent(
	app: Sql,
	event: LifecycleOutboxEvent,
	opts: { readonly email?: EmailPipeline | undefined }
): Promise<void> {
	if (!opts.email?.configured || !event.workspaceId) return

	const workspaceId = event.workspaceId
	const p = event.payload

	if (event.eventType === 'tenancy.workspace.created.v1') {
		const ownerUserId = typeof p['ownerUserId'] === 'string' ? p['ownerUserId'] : null
		if (!ownerUserId) return

		const prepared = await withWorkspace(app, { workspaceId }, async (tx) => {
			if (!(await claimLifecycleEvent(tx, event.id))) return null
			const recipients = await resolveRecipients(tx, workspaceId, [ownerUserId])
			return recipients.get(ownerUserId) ?? null
		})
		if (!prepared) return

		await opts.email
			.sendWelcome({
				to: prepared.email,
				recipientName: prepared.displayName,
				workspaceName: prepared.workspaceName,
				workspaceSlug: prepared.workspaceSlug
			})
			.catch((err) => log.warn({ err, outboxId: event.id }, 'welcome email delivery failed'))
		return
	}

	if (event.eventType === 'tenancy.invitation.accepted.v1') {
		const invitationId = typeof p['invitationId'] === 'string' ? p['invitationId'] : null
		const acceptedUserId = typeof p['userId'] === 'string' ? p['userId'] : null
		if (!invitationId || !acceptedUserId) return

		const prepared = await withWorkspace(app, { workspaceId }, async (tx) => {
			if (!(await claimLifecycleEvent(tx, event.id))) return null
			const [inv] = await tx<{ invitedBy: string | null; roleKey: string }[]>`
				SELECT i.invited_by AS "invitedBy", r.key AS "roleKey"
				FROM invitations i
				JOIN roles r ON r.workspace_id = i.workspace_id AND r.id = i.role_id
				WHERE i.workspace_id = ${workspaceId} AND i.id = ${invitationId}
			`
			if (!inv?.invitedBy || inv.invitedBy === acceptedUserId) return null
			const recipients = await resolveRecipients(tx, workspaceId, [inv.invitedBy, acceptedUserId])
			const inviter = recipients.get(inv.invitedBy)
			const member = recipients.get(acceptedUserId)
			if (!inviter || !member) return null
			return { inviter, member, role: inv.roleKey }
		})
		if (!prepared) return

		await opts.email
			.sendInvitationAccepted({
				to: prepared.inviter.email,
				inviterName: prepared.inviter.displayName,
				memberName: prepared.member.displayName,
				memberEmail: prepared.member.email,
				workspaceName: prepared.inviter.workspaceName,
				role: prepared.role
			})
			.catch((err) => log.warn({ err, outboxId: event.id }, 'invitation accepted email delivery failed'))
		return
	}

	if (event.eventType === 'billing.subscription.updated.v1') {
		const prepared = await withWorkspace(app, { workspaceId }, async (tx) => {
			if (!(await claimLifecycleEvent(tx, event.id))) return null
			const [sub] = await tx<
				{
					plan: 'free' | 'pro' | 'enterprise'
					status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete'
					provider: string
					billingEmail: string | null
					currency: 'USD' | 'RWF'
					amountCharged: number
					currentPeriodEnd: string | null
				}[]
			>`
				SELECT
					plan,
					status,
					provider,
					billing_email AS "billingEmail",
					currency,
					amount_charged::int AS "amountCharged",
					current_period_end::text AS "currentPeriodEnd"
				FROM billing_subscriptions
				WHERE workspace_id = ${workspaceId}
			`
			if (!sub) return null
			const owners = await listOwners(tx, workspaceId)
			const targets = new Map<string, { readonly email: string; readonly name?: string | undefined }>()
			for (const owner of owners) {
				targets.set(owner.email.toLowerCase(), { email: owner.email, name: owner.displayName })
			}
			if (sub.billingEmail?.trim()) {
				const normalized = sub.billingEmail.trim()
				if (!targets.has(normalized.toLowerCase())) {
					targets.set(normalized.toLowerCase(), { email: normalized })
				}
			}
			const workspaceName = owners[0]?.workspaceName ?? 'Huriro Workspace'
			return { sub, workspaceName, targets: [...targets.values()] }
		})
		if (!prepared || prepared.targets.length === 0) return

		for (const target of prepared.targets) {
			await opts.email
				.sendBillingUpdate({
					to: target.email,
					recipientName: target.name,
					workspaceName: prepared.workspaceName,
					plan: prepared.sub.plan,
					status: prepared.sub.status,
					provider: prepared.sub.provider,
					currency: prepared.sub.currency,
					amountCharged: prepared.sub.amountCharged,
					periodEndIso: prepared.sub.currentPeriodEnd,
					idempotencyKey: `billing:${event.id}:${target.email.toLowerCase()}`
				})
				.catch((err) => log.warn({ err, outboxId: event.id }, 'billing update email delivery failed'))
		}
		return
	}

	if (event.eventType === 'governance.export.completed.v1') {
		const exportId = typeof p['exportId'] === 'string' ? p['exportId'] : null
		const requestedBy = typeof p['requestedBy'] === 'string' ? p['requestedBy'] : null
		if (!exportId || !requestedBy) return

		const prepared = await withWorkspace(app, { workspaceId }, async (tx) => {
			if (!(await claimLifecycleEvent(tx, event.id))) return null
			const [exp] = await tx<
				{
					id: string
					byteSize: number
					expiresAt: string | null
					manifest: Record<string, unknown>
				}[]
			>`
				SELECT
					id,
					byte_size::double precision AS "byteSize",
					expires_at::text AS "expiresAt",
					manifest
				FROM workspace_exports
				WHERE workspace_id = ${workspaceId} AND id = ${exportId}
			`
			if (!exp) return null
			const recipients = await resolveRecipients(tx, workspaceId, [requestedBy])
			const requester = recipients.get(requestedBy)
			if (!requester) return null
			return { exp, requester }
		})
		if (!prepared) return

		const m = prepared.exp.manifest
		await opts.email
			.sendWorkspaceExportReady({
				to: prepared.requester.email,
				recipientName: prepared.requester.displayName,
				workspaceName: prepared.requester.workspaceName,
				exportId: prepared.exp.id,
				byteSize: Number(prepared.exp.byteSize ?? 0),
				expiresAtIso: prepared.exp.expiresAt,
				manifestSummary: {
					issues: typeof m['issues'] === 'number' ? m['issues'] : 0,
					docPages: typeof m['docPages'] === 'number' ? m['docPages'] : 0,
					chatMessages: typeof m['chatMessages'] === 'number' ? m['chatMessages'] : 0,
					mailConversations: typeof m['mailConversations'] === 'number' ? m['mailConversations'] : 0
				},
				idempotencyKey: `export:${prepared.exp.id}`
			})
			.catch((err) => log.warn({ err, outboxId: event.id }, 'workspace export email delivery failed'))
	}
}
