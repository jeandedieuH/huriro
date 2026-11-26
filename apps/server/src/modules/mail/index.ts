/**
 * Mail controller & cross-module seam (§14, §7.2).
 *
 * Public pre-tenant routes (inbound parse webhook, provider push) mount BEFORE
 * `workspaceDerive`; they route by opaque token → `resolveInboundRoute`, then
 * open `withWorkspace` for the owning tenant. Everything else is a normal
 * workspace-scoped route over `inWorkspace`.
 */

import {
	ApplyMailMacroBody,
	CompleteDraftReviewBody,
	ContactBody,
	ContactOrganizationBody,
	ConversationTagsBody,
	ConvertToIssueBody,
	CreateMailAccountBody,
	CreateMailIdentityBody,
	CreateMailInboxBody,
	CreateMailNoteBody,
	CreateOutboundConversationBody,
	ForwardConversationBody,
	LinkConversationBody,
	ListConversationsQuery,
	MailBulkTriageBody,
	MailInboxSettingsBody,
	MailMacroBody,
	MailRoutingConfigBody,
	MailSlaPolicyBody,
	MailTagBody,
	MailTemplateBody,
	MergeConversationsBody,
	RenderMailTemplateBody,
	RequestDraftReviewBody,
	SendMailDraftBody,
	SplitConversationBody,
	UpdateConversationBody,
	UpdateMailAccountBody,
	UpsertMailDraftBody
} from '@huriro/contracts'
import { type Sql, withSystem, withWorkspace } from '@huriro/db'
import { Elysia } from 'elysia'
import { HttpError } from '../../api/error'
import type { PresenceRegistry } from '../../realtime/presence-registry'
import type { RealtimePubSub } from '../../realtime/pubsub'
import type { BlobStorage } from '../files'
import type { Auth } from '../identity'
import { workspaceDerive } from '../tenancy'
import * as mailV2 from './advanced-mail-service'
import { MAIL_EVENTS } from './events'
import { MAIL_PARSE_LIMITS } from './mime'
import { getMailDraft } from './repo'
import {
	InboundTokenParam,
	MailDraftParam,
	MailIdentitiesQuery,
	MailIdParam,
	MailLinkDocParam,
	MailLinkTaskParam,
	MailSyncBody,
	WebhookSyncBody
} from './schema'
import type { MailModuleConfig } from './service'
import * as svc from './service'

export { listMailTags, routeNextConversationInInbox } from './advanced-mail-service'
export {
	acquireMailDraftRoomAndState,
	consumeAndAuthorizeMailDraftTicket,
	persistMailDraftCollabState,
	releaseMailDraftRoomLease,
	renewMailDraftRoomLease
} from './collab'
export { MAIL_EVENTS } from './events'
export { runMailFollowupsOnce } from './followups'
export { MAIL_PARSE_LIMITS, MimeParseError, parseMime, sanitizeMailHtml } from './mime'
export type { DnsLike, MailPoller, MailTransport, OutboundMail } from './providers'
export {
	createImapPoller,
	createSmtpTransport,
	hashInboundToken,
	nodeDnsResolver
} from './providers'
export type { MailConversationEndpoint, MailModuleConfig, MailOutboxEvent, MailWorkerDeps } from './service'
export {
	createNote,
	exportConversation,
	getConversationTimeline,
	ingestRawMime,
	listAccounts,
	listConversations,
	processMailOutboxEvent,
	requireMailConversationAccess,
	resolveInboundRoute,
	runRetentionSweep,
	sendDueDraft,
	syncAccount,
	updateConversation,
	verifyLiveMailDraftAccess
} from './service'

export function mailModule(
	sql: Sql,
	auth: Auth | null,
	storage: BlobStorage,
	cfg: MailModuleConfig,
	pubsub?: RealtimePubSub,
	presence?: PresenceRegistry
) {
	return (
		new Elysia({ name: 'huriro.mail' })
			// ---- pre-tenant webhook routes (§12.4: token → workspace resolution) ----
			.post(
				'/mail/inbound/:token',
				{ params: InboundTokenParam, parse: 'arrayBuffer' },
				async ({ params, body, request }) => {
					// Raw MIME arrives as the request body (mta→huriro forward).
					const raw =
						body instanceof ArrayBuffer
							? new Uint8Array(body)
							: body instanceof Uint8Array
								? body
								: new Uint8Array(await request.arrayBuffer())
					if (raw.byteLength === 0) {
						throw new HttpError(422, 'validation_failed', 'Empty message body')
					}
					if (raw.byteLength > MAIL_PARSE_LIMITS.maxBytes) {
						throw new HttpError(413, 'mail_message_too_large', 'Message exceeds inbound size limit')
					}
					const route = await withSystem(sql, (tx) => svc.resolveInboundRoute(tx, params.token))
					if (!route) throw new HttpError(404, 'not_found', 'Unknown inbound address')
					const rawBlobKey = `mail-raw/${route.workspaceId}/inbound/${crypto.randomUUID()}.eml`
					await storage.putQuarantine(rawBlobKey, raw)
					const inboxId =
						route.defaultInboxId ??
						(await withWorkspace(sql, { workspaceId: route.workspaceId }, async (tx) => {
							const [row] = await tx<{ id: string }[]>`
								SELECT id FROM mail_inboxes WHERE workspace_id = ${route.workspaceId} ORDER BY position ASC LIMIT 1
							`
							if (row) return row.id
							const [ins] = await tx<{ id: string }[]>`
								INSERT INTO mail_inboxes (workspace_id, name, position, settings)
								VALUES (${route.workspaceId}, 'Inbox', 'a0', '{}'::jsonb)
								RETURNING id
							`
							if (!ins) throw new HttpError(500, 'internal', 'Failed to create default inbox')
							return ins.id
						}))
					await withWorkspace(
						sql,
						{ workspaceId: route.workspaceId },
						(tx) => tx`
						INSERT INTO outbox (workspace_id, aggregate, aggregate_id, event_type, payload)
						VALUES (
							${route.workspaceId},
							'mail_account',
							${route.accountId},
							${MAIL_EVENTS.InboundReceived},
							${tx.json({
								rawBlobKey,
								accountId: route.accountId,
								inboxId,
								byteSize: raw.byteLength
							} as never)}
						)
					`
					)
					return { accepted: true }
				}
			)
			// Provider push notifications (Gmail Pub/Sub, Graph subscriptions) share
			// the same token auth: the opaque token resolves to the account, then
			// a sync event is queued. OIDC token validation is a phase-2 hardening
			// task — the sync itself re-fetches from the provider API.
			.post(
				'/mail/webhook/:token',
				{ params: InboundTokenParam, body: WebhookSyncBody },
				async ({ params }) => {
					const route = await withSystem(sql, (tx) => svc.resolveInboundRoute(tx, params.token))
					if (!route) throw new HttpError(404, 'not_found', 'Unknown webhook token')
					await withWorkspace(
						sql,
						{ workspaceId: route.workspaceId },
						(tx) => tx`
						INSERT INTO outbox (workspace_id, aggregate, aggregate_id, event_type, payload)
						VALUES (
							${route.workspaceId},
							'mail_account',
							${route.accountId},
							${MAIL_EVENTS.AccountSyncRequested},
							${tx.json({ accountId: route.accountId, reason: 'webhook' } as never)}
						)
					`
					)
					return { accepted: true }
				}
			)
			// ---- workspace-scoped routes ----
			.derive(workspaceDerive(sql, auth))
			// Accounts
			.get('/mail/accounts', ({ inWorkspace }) =>
				inWorkspace((tx, actor) => svc.listAccounts(tx, actor, cfg).then((data) => ({ data })))
			)
			.post('/mail/accounts', { body: CreateMailAccountBody }, async ({ body, inWorkspace, set }) => {
				const data = await inWorkspace((tx, actor) => svc.createAccount(tx, actor, body, cfg))
				set.status = 201
				return data
			})
			.get('/mail/accounts/:id', { params: MailIdParam }, ({ params, inWorkspace }) =>
				inWorkspace((tx, actor) => svc.getAccount(tx, actor, params.id, cfg))
			)
			.patch(
				'/mail/accounts/:id',
				{ params: MailIdParam, body: UpdateMailAccountBody },
				({ params, body, inWorkspace }) =>
					inWorkspace((tx, actor) => svc.updateAccount(tx, actor, params.id, body))
			)
			.post('/mail/accounts/:id/verify-domain', { params: MailIdParam }, ({ params, inWorkspace }) =>
				inWorkspace((tx, actor) => svc.verifyAccountDomain(tx, actor, params.id, cfg))
			)
			.post(
				'/mail/accounts/:id/sync',
				{ params: MailIdParam, body: MailSyncBody },
				async ({ params, workspaceCtx, inWorkspace, set }) => {
					const out = await inWorkspace(async (tx, actor) => {
						await svc.getAccount(tx, actor, params.id, cfg)
						await tx`
							INSERT INTO outbox (workspace_id, aggregate, aggregate_id, event_type, payload)
							VALUES (
								${workspaceCtx.workspaceId},
								'mail_account',
								${params.id},
								${MAIL_EVENTS.AccountSyncRequested},
								${tx.json({ accountId: params.id, reason: 'manual' } as never)}
							)
						`
						return true
					})
					set.status = 202
					return { queued: out }
				}
			)
			// Identities
			.get('/mail/identities', { query: MailIdentitiesQuery }, ({ query, inWorkspace }) =>
				inWorkspace((tx, actor) => svc.listIdentities(tx, actor, query.accountId).then((data) => ({ data })))
			)
			.post('/mail/identities', { body: CreateMailIdentityBody }, async ({ body, inWorkspace, set }) => {
				const data = await inWorkspace((tx, actor) => svc.createIdentity(tx, actor, body))
				set.status = 201
				return data
			})
			// Inboxes
			.get('/mail/inboxes', ({ inWorkspace }) =>
				inWorkspace((tx, actor) => svc.listInboxes(tx, actor).then((data) => ({ data })))
			)
			.post(
				'/mail/inboxes',
				{ body: CreateMailInboxBody },
				async ({ body, workspaceCtx, inWorkspace, set }) => {
					const res = await inWorkspace((tx, actor) => svc.createInbox(tx, actor, body))
					set.status = 201
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, res.cursor)
					return res.data
				}
			)
			// Conversations
			.get('/mail/conversations', { query: ListConversationsQuery }, ({ query, inWorkspace }) =>
				inWorkspace((tx, actor) => svc.listConversations(tx, actor, query))
			)
			.get('/mail/conversations/:id/timeline', { params: MailIdParam }, ({ params, inWorkspace }) =>
				inWorkspace((tx, actor) => svc.getConversationTimeline(tx, actor, params.id))
			)
			.patch(
				'/mail/conversations/:id',
				{ params: MailIdParam, body: UpdateConversationBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const res = await inWorkspace((tx, actor) => svc.updateConversation(tx, actor, params.id, body))
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, res.cursor)
					return res.data
				}
			)
			.post(
				'/mail/conversations/:id/merge',
				{ params: MailIdParam, body: MergeConversationsBody },
				({ params, body, inWorkspace }) =>
					inWorkspace((tx, actor) => svc.mergeConversations(tx, actor, params.id, body))
			)
			.post(
				'/mail/conversations/:id/notes',
				{ params: MailIdParam, body: CreateMailNoteBody },
				async ({ params, body, inWorkspace, set }) => {
					const data = await inWorkspace((tx, actor) => svc.createNote(tx, actor, params.id, body))
					set.status = 201
					return data
				}
			)
			.post(
				'/mail/conversations/:id/links',
				{ params: MailIdParam, body: LinkConversationBody },
				async ({ params, body, inWorkspace, set }) => {
					if (body.taskId) {
						const taskId = body.taskId
						await inWorkspace((tx, actor) => svc.linkTask(tx, actor, params.id, taskId))
					} else if (body.pageId) {
						const pageId = body.pageId
						await inWorkspace((tx, actor) => svc.linkDoc(tx, actor, params.id, pageId))
					} else {
						throw new HttpError(422, 'validation_failed', 'taskId or pageId required')
					}
					set.status = 204
				}
			)
			.delete(
				'/mail/conversations/:id/links/tasks/:taskId',
				{ params: MailLinkTaskParam },
				({ params, inWorkspace }) =>
					inWorkspace((tx, actor) => svc.unlinkTask(tx, actor, params.id, params.taskId))
			)
			.delete(
				'/mail/conversations/:id/links/docs/:pageId',
				{ params: MailLinkDocParam },
				({ params, inWorkspace }) =>
					inWorkspace((tx, actor) => svc.unlinkDoc(tx, actor, params.id, params.pageId))
			)
			.post(
				'/mail/conversations/:id/convert-to-issue',
				{ params: MailIdParam, body: ConvertToIssueBody },
				({ params, body, inWorkspace }) =>
					inWorkspace((tx, actor) => svc.convertToIssue(tx, actor, params.id, body))
			)
			.get('/mail/conversations/:id/export', { params: MailIdParam }, async ({ params, inWorkspace }) => {
				const { json, emls } = await inWorkspace((tx, actor) =>
					svc.exportConversation(tx, actor, params.id, storage)
				)
				return {
					conversation: json.conversation,
					messages: json.messages,
					emlCount: emls.length,
					exportedAt: new Date().toISOString()
				}
			})
			// Drafts
			.post(
				'/mail/conversations/:id/drafts',
				{ params: MailIdParam, body: UpsertMailDraftBody },
				async ({ params, body, inWorkspace, set }) => {
					const data = await inWorkspace((tx, actor) => svc.upsertDraft(tx, actor, params.id, body))
					set.status = 201
					return data
				}
			)
			.patch(
				'/mail/drafts/:draftId',
				{ params: MailDraftParam, body: UpsertMailDraftBody },
				({ params, body, inWorkspace }) =>
					inWorkspace(async (tx, actor) => {
						const draft = await getMailDraft(tx, actor.workspaceId, params.draftId)
						if (!draft) throw new HttpError(404, 'not_found', 'Draft not found')
						return svc.upsertDraft(tx, actor, draft.conversationId, body, params.draftId)
					})
			)
			.post('/mail/drafts/:draftId/lock', { params: MailDraftParam }, ({ params, inWorkspace }) =>
				inWorkspace((tx, actor) => svc.lockDraft(tx, actor, params.draftId))
			)
			.delete('/mail/drafts/:draftId/lock', { params: MailDraftParam }, ({ params, inWorkspace }) =>
				inWorkspace((tx, actor) => svc.unlockDraft(tx, actor, params.draftId))
			)
			.post(
				'/mail/drafts/:draftId/send',
				{ params: MailDraftParam, body: SendMailDraftBody },
				({ params, body, inWorkspace }) =>
					inWorkspace((tx, actor) =>
						svc.sendDraft(
							tx,
							actor,
							params.draftId,
							{
								undoSeconds: body.undoSeconds,
								scheduledSendAt: body.scheduledSendAt,
								expectedVersion: body.expectedVersion
							},
							cfg
						)
					)
			)
			.post(
				'/mail/drafts/:draftId/review',
				{ params: MailDraftParam, body: RequestDraftReviewBody },
				({ params, body, inWorkspace }) =>
					inWorkspace((tx, actor) => svc.requestDraftReview(tx, actor, params.draftId, body))
			)
			.post(
				'/mail/drafts/:draftId/review/complete',
				{ params: MailDraftParam, body: CompleteDraftReviewBody },
				({ params, body, inWorkspace }) =>
					inWorkspace((tx, actor) => svc.completeDraftReview(tx, actor, params.draftId, body))
			)
			.post('/mail/drafts/:draftId/collab-ticket', { params: MailDraftParam }, ({ params, inWorkspace }) =>
				inWorkspace((tx, actor) => svc.issueDraftCollabTicket(tx, actor, params.draftId, cfg))
			)
			.post('/mail/drafts/:draftId/undo', { params: MailDraftParam }, ({ params, inWorkspace }) =>
				inWorkspace((tx, actor) => svc.undoSend(tx, actor, params.draftId))
			)
			.delete('/mail/drafts/:draftId', { params: MailDraftParam }, async ({ params, inWorkspace }) => {
				await inWorkspace((tx, actor) => svc.discardDraft(tx, actor, params.draftId))
				return { deleted: true }
			})
			// M11 proactive compose / forward / thread split.
			.post(
				'/mail/outbound',
				{ body: CreateOutboundConversationBody },
				async ({ body, inWorkspace, set }) => {
					const data = await inWorkspace((tx, actor) => mailV2.createOutboundConversation(tx, actor, body))
					set.status = 201
					return data
				}
			)
			.post(
				'/mail/conversations/:id/forward',
				{ params: MailIdParam, body: ForwardConversationBody },
				async ({ params, body, inWorkspace, set }) => {
					const data = await inWorkspace((tx, actor) =>
						mailV2.forwardConversation(tx, actor, params.id, body)
					)
					set.status = 201
					return data
				}
			)
			.post(
				'/mail/conversations/:id/split',
				{ params: MailIdParam, body: SplitConversationBody },
				async ({ params, body, inWorkspace, set }) => {
					const data = await inWorkspace((tx, actor) => mailV2.splitConversation(tx, actor, params.id, body))
					set.status = 201
					return data
				}
			)
			// Contacts and organizations.
			.get('/mail/contacts', ({ inWorkspace, query }) =>
				inWorkspace((tx, actor) =>
					mailV2.listContacts(tx, actor, typeof query['q'] === 'string' ? query['q'] : undefined)
				)
			)
			.post('/mail/contacts', { body: ContactBody }, async ({ body, inWorkspace, set }) => {
				const data = await inWorkspace((tx, actor) => mailV2.upsertContact(tx, actor, body))
				set.status = 201
				return data
			})
			.patch(
				'/mail/contacts/:id',
				{ params: MailIdParam, body: ContactBody },
				({ params, body, inWorkspace }) =>
					inWorkspace((tx, actor) => mailV2.upsertContact(tx, actor, body, params.id))
			)
			.get('/mail/contact-organizations', ({ inWorkspace }) =>
				inWorkspace((tx, actor) => mailV2.listContactOrganizations(tx, actor))
			)
			.post(
				'/mail/contact-organizations',
				{ body: ContactOrganizationBody },
				async ({ body, inWorkspace, set }) => {
					const data = await inWorkspace((tx, actor) => mailV2.upsertContactOrganization(tx, actor, body))
					set.status = 201
					return data
				}
			)
			.patch(
				'/mail/contact-organizations/:id',
				{ params: MailIdParam, body: ContactOrganizationBody },
				({ params, body, inWorkspace }) =>
					inWorkspace((tx, actor) => mailV2.upsertContactOrganization(tx, actor, body, params.id))
			)
			// Tags.
			.get('/mail/tags', ({ inWorkspace, query }) =>
				inWorkspace((tx, actor) =>
					mailV2.listMailTags(tx, actor, typeof query['inboxId'] === 'string' ? query['inboxId'] : undefined)
				)
			)
			.post('/mail/tags', { body: MailTagBody }, async ({ body, inWorkspace, set }) => {
				const data = await inWorkspace((tx, actor) => mailV2.createMailTag(tx, actor, body))
				set.status = 201
				return data
			})
			.delete('/mail/tags/:id', { params: MailIdParam }, async ({ params, inWorkspace }) => {
				await inWorkspace((tx, actor) => mailV2.deleteMailTag(tx, actor, params.id))
				return { deleted: true }
			})
			.get('/mail/conversations/:id/tags', { params: MailIdParam }, ({ params, inWorkspace }) =>
				inWorkspace((tx, actor) => mailV2.listConversationTags(tx, actor, params.id))
			)
			.put(
				'/mail/conversations/:id/tags',
				{ params: MailIdParam, body: ConversationTagsBody },
				({ params, body, inWorkspace }) =>
					inWorkspace((tx, actor) => mailV2.setConversationTags(tx, actor, params.id, body.tagIds))
			)
			// Templates/snippets.
			.get('/mail/templates', ({ inWorkspace, query }) =>
				inWorkspace((tx, actor) =>
					mailV2.listMailTemplates(tx, actor, {
						inboxId: typeof query['inboxId'] === 'string' ? query['inboxId'] : undefined
					})
				)
			)
			.post('/mail/templates', { body: MailTemplateBody }, async ({ body, inWorkspace, set }) => {
				const data = await inWorkspace((tx, actor) => mailV2.upsertMailTemplate(tx, actor, body))
				set.status = 201
				return data
			})
			.patch(
				'/mail/templates/:id',
				{ params: MailIdParam, body: MailTemplateBody },
				({ params, body, inWorkspace }) =>
					inWorkspace((tx, actor) => mailV2.upsertMailTemplate(tx, actor, body, params.id))
			)
			.delete('/mail/templates/:id', { params: MailIdParam }, async ({ params, inWorkspace }) => {
				await inWorkspace((tx, actor) => mailV2.deleteMailTemplate(tx, actor, params.id))
				return { deleted: true }
			})
			.post(
				'/mail/templates/:id/render',
				{ params: MailIdParam, body: RenderMailTemplateBody },
				({ params, body, inWorkspace }) =>
					inWorkspace((tx, actor) => mailV2.renderMailTemplate(tx, actor, params.id, body.variables ?? {}))
			)
			// Macros and bulk triage.
			.get('/mail/macros', ({ inWorkspace, query }) =>
				inWorkspace((tx, actor) =>
					mailV2.listMailMacros(
						tx,
						actor,
						typeof query['inboxId'] === 'string' ? query['inboxId'] : undefined
					)
				)
			)
			.post('/mail/macros', { body: MailMacroBody }, async ({ body, inWorkspace, set }) => {
				const data = await inWorkspace((tx, actor) => mailV2.upsertMailMacro(tx, actor, body))
				set.status = 201
				return data
			})
			.patch(
				'/mail/macros/:id',
				{ params: MailIdParam, body: MailMacroBody },
				({ params, body, inWorkspace }) =>
					inWorkspace((tx, actor) => mailV2.upsertMailMacro(tx, actor, body, params.id))
			)
			.delete('/mail/macros/:id', { params: MailIdParam }, async ({ params, inWorkspace }) => {
				await inWorkspace((tx, actor) => mailV2.deleteMailMacro(tx, actor, params.id))
				return { deleted: true }
			})
			.post(
				'/mail/macros/:id/apply',
				{ params: MailIdParam, body: ApplyMailMacroBody },
				({ params, body, inWorkspace }) =>
					inWorkspace((tx, actor) => mailV2.applyMailMacro(tx, actor, params.id, body.conversationIds))
			)
			.post('/mail/bulk-triage', { body: MailBulkTriageBody }, ({ body, inWorkspace }) =>
				inWorkspace((tx, actor) => mailV2.bulkTriageConversations(tx, actor, body))
			)
			// Split-inbox metadata, routing and SLA administration.
			.patch(
				'/mail/inboxes/:id/settings',
				{ params: MailIdParam, body: MailInboxSettingsBody },
				({ params, body, inWorkspace }) =>
					inWorkspace((tx, actor) => mailV2.updateInboxSettings(tx, actor, params.id, body))
			)
			.get('/mail/inboxes/:id/routing', { params: MailIdParam }, ({ params, inWorkspace }) =>
				inWorkspace((tx, actor) => mailV2.getMailRoutingConfig(tx, actor, params.id))
			)
			.put(
				'/mail/inboxes/:id/routing',
				{ params: MailIdParam, body: MailRoutingConfigBody },
				({ params, body, inWorkspace }) =>
					inWorkspace((tx, actor) => mailV2.upsertMailRoutingConfig(tx, actor, params.id, body))
			)
			.post('/mail/conversations/:id/route', { params: MailIdParam }, ({ params, inWorkspace }) =>
				inWorkspace((tx, actor) => mailV2.routeConversationRoundRobin(tx, actor, params.id, presence))
			)
			.get('/mail/sla-policies', ({ inWorkspace, query }) =>
				inWorkspace((tx, actor) =>
					mailV2.listMailSlaPolicies(
						tx,
						actor,
						typeof query['inboxId'] === 'string' ? query['inboxId'] : undefined
					)
				)
			)
			.post('/mail/sla-policies', { body: MailSlaPolicyBody }, async ({ body, inWorkspace, set }) => {
				const data = await inWorkspace((tx, actor) => mailV2.upsertMailSlaPolicy(tx, actor, body))
				set.status = 201
				return data
			})
			.patch(
				'/mail/sla-policies/:id',
				{ params: MailIdParam, body: MailSlaPolicyBody },
				({ params, body, inWorkspace }) =>
					inWorkspace((tx, actor) => mailV2.upsertMailSlaPolicy(tx, actor, body, params.id))
			)
			.delete('/mail/sla-policies/:id', { params: MailIdParam }, async ({ params, inWorkspace }) => {
				await inWorkspace((tx, actor) => mailV2.deleteMailSlaPolicy(tx, actor, params.id))
				return { deleted: true }
			})
			.get('/mail/sla-analytics', ({ inWorkspace, query }) =>
				inWorkspace((tx, actor) =>
					mailV2.mailSlaAnalytics(
						tx,
						actor,
						typeof query['inboxId'] === 'string' ? query['inboxId'] : undefined
					)
				)
			)
	)
}
