/**
 * Worker role: pg-boss queue + the transactional-outbox drain (§4.3, §19.1).
 *
 * pg-boss manages its own `pgboss` schema and needs DDL rights — it connects
 * with the admin URL. Job HANDLERS do tenant work through the huriro_app pool
 * inside withWorkspace, same as the API (§12.4).
 */
import { isUuid, type Sql, withSystem, withWorkspace } from '@huriro/db'
import { PgBoss } from 'pg-boss'
import { resolveRootEnvelopeSecret } from '../api/crypto'
import type { DnsResolver } from '../api/egress'
import { log, outboxLag } from '../api/observability'
import { sweepExpiredApprovals } from '../modules/agents'
import { processEmbeddingOutboxEvent } from '../modules/ai'
import { processChatLinkPreviewOutboxEvent } from '../modules/chat'
import { runDocMaintenanceOnce } from '../modules/docs'
import { type BlobStorage, processFileQuarantineOutboxEvent } from '../modules/files'
import {
	type GithubApiClient,
	processGithubOutboundOutboxEvent,
	processPendingGithubWebhooksOnce
} from '../modules/integrations'
import {
	type MailModuleConfig,
	processMailOutboxEvent,
	runRetentionSweep,
	sendDueDraft,
	syncAccount
} from '../modules/mail'
import {
	dispatchWebPushNotifications,
	type EmailTransport,
	processNotificationOutboxEvent,
	runEmailDigestOnce,
	type VapidConfig
} from '../modules/notifications'
import { processSearchOutboxEvent } from '../modules/search'
import { enqueueWebhookDeliveriesForOutboxEvent, processDueWebhookDeliveriesOnce } from '../modules/webhooks'
import type { RealtimePubSub } from '../realtime/pubsub'

export interface DrainOutboxOptions {
	readonly blobStorage?: BlobStorage | undefined
	readonly clamavHost?: string | undefined
	readonly clamavPort?: number | undefined
	readonly rootSecret?: string | undefined
	readonly githubClient?: GithubApiClient | undefined
	readonly vapid?: VapidConfig | undefined
	readonly egressFetch?: typeof fetch | undefined
	readonly egressResolver?: DnsResolver | undefined
	readonly mail?: Partial<MailModuleConfig> | undefined
	/** When set, only this workspace's rows are claimed — used by tests so one
	 * fixture's drain doesn't chew through every other test's backlog. */
	readonly onlyWorkspaceId?: string | undefined
}

export interface WorkerDeps extends DrainOutboxOptions {
	readonly adminUrl: string
	readonly app: Sql
	readonly pubsub?: RealtimePubSub
	readonly heartbeatUrl?: string | undefined
	readonly outboxIntervalMs?: number
	readonly emailTransport?: EmailTransport | undefined
	readonly smtp?: { readonly host?: string; readonly port?: number; readonly from?: string } | undefined
	readonly mailSyncIntervalSeconds?: number | undefined
}

const OUTBOX_BATCH = 200

interface PendingOutboxRow {
	readonly id: string
	readonly workspaceId: string | null
	readonly eventType: string
	readonly payload: Record<string, unknown>
}

/**
 * Drain pending outbox rows: dispatch to search, notifications, webhook
 * enqueueing, and file quarantine inside `withWorkspace`, then run external
 * HTTP consumers (`chat-unfurl`, `github-outbound`, `web-push`) outside DB tx locks.
 */
export async function drainOutboxOnce(
	app: Sql,
	pubsub?: RealtimePubSub,
	opts?: DrainOutboxOptions
): Promise<number> {
	const rows = await app.begin(async (tx) => {
		const picked = opts?.onlyWorkspaceId
			? await tx<PendingOutboxRow[]>`
				SELECT id, workspace_id AS "workspaceId", event_type AS "eventType", payload
				FROM outbox
				WHERE published_at IS NULL AND workspace_id = ${opts.onlyWorkspaceId}
				ORDER BY created_at ASC
				LIMIT ${OUTBOX_BATCH}
				FOR UPDATE SKIP LOCKED
			`
			: await tx<PendingOutboxRow[]>`
				SELECT id, workspace_id AS "workspaceId", event_type AS "eventType", payload
				FROM outbox
				WHERE published_at IS NULL
				ORDER BY created_at ASC
				LIMIT ${OUTBOX_BATCH}
				FOR UPDATE SKIP LOCKED
			`
		return picked
	})

	if (rows.length === 0) return 0

	const rootSecret = opts?.rootSecret ?? resolveRootEnvelopeSecret()
	const scanOpts = {
		...(opts?.clamavHost ? { clamavHost: opts.clamavHost } : {}),
		...(opts?.clamavPort ? { clamavPort: opts.clamavPort } : {})
	}
	const mailDeps =
		opts?.blobStorage && opts.mail
			? {
					storage: opts.blobStorage,
					cfg: {
						rootSecret,
						maxMessageBytes: opts.mail.maxMessageBytes ?? 52_428_800,
						undoSendSeconds: opts.mail.undoSendSeconds ?? 10,
						inboundDomain: opts.mail.inboundDomain,
						publicBaseUrl: opts.mail.publicBaseUrl,
						gmailClientId: opts.mail.gmailClientId,
						gmailClientSecret: opts.mail.gmailClientSecret,
						msClientId: opts.mail.msClientId,
						msClientSecret: opts.mail.msClientSecret,
						smtpRelay: opts.mail.smtpRelay
					} satisfies MailModuleConfig
				}
			: null
	let processedCount = 0
	const cursorsToPublish = new Map<string, number>()

	for (const row of rows) {
		try {
			if (row.workspaceId) {
				const actorId =
					typeof row.payload['actorId'] === 'string' && isUuid(row.payload['actorId'])
						? row.payload['actorId']
						: undefined
				const txResult = await withWorkspace(
					app,
					actorId ? { workspaceId: row.workspaceId, userId: actorId } : { workspaceId: row.workspaceId },
					async (tx) => {
						await processSearchOutboxEvent(tx, row)
						const notifRes = await processNotificationOutboxEvent(tx, row)
						await enqueueWebhookDeliveriesForOutboxEvent(tx, row)
						if (opts?.blobStorage) {
							await processFileQuarantineOutboxEvent(tx, row, opts.blobStorage, scanOpts)
						}
						if (mailDeps) {
							await processMailOutboxEvent(tx, row, mailDeps)
						}
						await tx`
						INSERT INTO processed_events (consumer, event_id)
						VALUES ('outbox-drain', ${row.id})
						ON CONFLICT (consumer, event_id) DO NOTHING
					`
						await tx`UPDATE outbox SET published_at = now() WHERE id = ${row.id}`
						return notifRes
					}
				)
				if (txResult.cursor !== null) {
					const prev = cursorsToPublish.get(row.workspaceId)
					cursorsToPublish.set(
						row.workspaceId,
						prev === undefined ? txResult.cursor : Math.max(prev, txResult.cursor)
					)
				}

				if (txResult.pendingWebPush.length > 0 && opts?.vapid) {
					await dispatchWebPushNotifications(app, row.workspaceId, txResult.pendingWebPush, {
						vapid: opts.vapid,
						fetchImpl: opts.egressFetch,
						resolver: opts.egressResolver
					}).catch((err) => log.warn({ err, outboxId: row.id }, 'web push dispatch error'))
				}

				await processChatLinkPreviewOutboxEvent(
					app,
					row,
					{
						fetchImpl: opts?.egressFetch,
						resolver: opts?.egressResolver
					},
					pubsub
				).catch((err) => log.warn({ err, outboxId: row.id }, 'chat link preview unfurl failed'))

				await processGithubOutboundOutboxEvent(app, row, {
					rootSecret,
					githubClient: opts?.githubClient,
					fetchImpl: opts?.egressFetch,
					resolver: opts?.egressResolver
				}).catch((err) => log.warn({ err, outboxId: row.id }, 'github outbound sync error'))

				// AI embeddings ride the same row (§11.1): re-embeds changed chunks
				// only when the workspace has AI enabled + a provider configured.
				await processEmbeddingOutboxEvent(app, row, {
					sql: app,
					rootSecret,
					...(opts?.egressFetch ? { fetcher: opts.egressFetch } : {}),
					...(opts?.egressResolver ? { resolver: opts.egressResolver } : {})
				}).catch((err) => log.warn({ err, outboxId: row.id }, 'embedding consumer failed'))
			} else {
				await app.begin(async (tx) => {
					await tx`
						INSERT INTO processed_events (consumer, event_id)
						VALUES ('outbox-drain', ${row.id})
						ON CONFLICT (consumer, event_id) DO NOTHING
					`
					await tx`UPDATE outbox SET published_at = now() WHERE id = ${row.id}`
				})
			}
			processedCount++
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			log.error({ err, outboxId: row.id, eventType: row.eventType }, 'outbox consumer failed')
			await app`
				UPDATE outbox
				SET attempts = attempts + 1, last_error = ${msg}
				WHERE id = ${row.id}
			`.catch(() => {})
		}
	}

	if (pubsub) {
		for (const [wsId, cursor] of cursorsToPublish.entries()) {
			await pubsub.publishCursor(wsId, cursor).catch(() => {})
		}
	}

	if (processedCount > 0) log.info({ count: processedCount }, 'outbox drained')
	return processedCount
}

async function updateLagMetric(app: Sql) {
	const [row] = await app<{ n: number }[]>`SELECT count(*)::int AS n FROM outbox WHERE published_at IS NULL`
	outboxLag.set(row?.n ?? 0)
}

export async function startWorker(deps: WorkerDeps): Promise<{ stop(): Promise<void> }> {
	const boss = new PgBoss({ connectionString: deps.adminUrl })
	boss.on('error', (err: Error) => log.error({ err }, 'pg-boss error'))
	await boss.start()

	const rootSecret = deps.rootSecret ?? resolveRootEnvelopeSecret()

	await boss.createQueue('outbox-drain')
	await boss.schedule('outbox-drain', '*/5 * * * * *', {}, { tz: 'UTC' })
	await boss.work('outbox-drain', async () => {
		await drainOutboxOnce(deps.app, deps.pubsub, deps)
		await updateLagMetric(deps.app)
	})

	await boss.createQueue('doc-versions-thin')
	await boss.schedule('doc-versions-thin', '0 * * * *', {}, { tz: 'UTC' })
	await boss.work('doc-versions-thin', async () => {
		const res = await withSystem(deps.app, (tx) => runDocMaintenanceOnce(tx))
		if (res.thinnedVersions > 0 || res.deletedTickets > 0) {
			log.info(res, 'doc version retention & ticket cleanup completed')
		}
	})

	await boss.createQueue('webhook-deliver')
	await boss.schedule('webhook-deliver', '* * * * *', {}, { tz: 'UTC' })
	await boss.work('webhook-deliver', async () => {
		await processDueWebhookDeliveriesOnce(deps.app, {
			rootSecret,
			fetchImpl: deps.egressFetch,
			resolver: deps.egressResolver
		})
	})

	await boss.createQueue('github-sync-inbound')
	await boss.schedule('github-sync-inbound', '* * * * *', {}, { tz: 'UTC' })
	await boss.work('github-sync-inbound', async () => {
		await processPendingGithubWebhooksOnce(deps.app, {
			rootSecret,
			pubsub: deps.pubsub
		})
	})

	// Pending agent approvals past expires_at flip to 'expired' (§13.5).
	await boss.createQueue('agent-approvals-expire')
	await boss.schedule('agent-approvals-expire', '* * * * *', {}, { tz: 'UTC' })
	await boss.work('agent-approvals-expire', async () => {
		const expired = await sweepExpiredApprovals(deps.app)
		if (expired > 0) log.info({ expired }, 'agent approvals expired')
	})

	await boss.createQueue('notification-email-digest')
	await boss.schedule('notification-email-digest', '*/15 * * * *', {}, { tz: 'UTC' })
	await boss.work('notification-email-digest', async () => {
		await runEmailDigestOnce(deps.app, {
			transport: deps.emailTransport,
			smtp: deps.smtp
		})
	})

	// ---- M5 shared inbox (§14.7) ----
	const mailWorkerDeps =
		deps.blobStorage && deps.mail
			? {
					storage: deps.blobStorage,
					cfg: {
						rootSecret,
						maxMessageBytes: deps.mail.maxMessageBytes ?? 52_428_800,
						undoSendSeconds: deps.mail.undoSendSeconds ?? 10,
						inboundDomain: deps.mail.inboundDomain,
						publicBaseUrl: deps.mail.publicBaseUrl,
						gmailClientId: deps.mail.gmailClientId,
						gmailClientSecret: deps.mail.gmailClientSecret,
						msClientId: deps.mail.msClientId,
						msClientSecret: deps.mail.msClientSecret,
						smtpRelay: deps.mail.smtpRelay
					} satisfies MailModuleConfig
				}
			: null

	if (mailWorkerDeps) {
		// Connected-mailbox sync (IMAP/Graph poll + Gmail backstop). The helper
		// throttles by last_synced_at so a 1-minute tick is safe at any interval.
		await boss.createQueue('mail-account-sync')
		await boss.schedule('mail-account-sync', '* * * * *', {}, { tz: 'UTC' })
		await boss.work('mail-account-sync', async () => {
			const md = mailWorkerDeps
			const due = await withSystem(
				deps.app,
				(tx) =>
					tx<{ id: string; workspaceId: string }[]>`
						SELECT id, workspace_id AS "workspaceId" FROM list_mail_accounts_for_sync()
					`
			)
			for (const acct of due) {
				await withWorkspace(deps.app, { workspaceId: acct.workspaceId }, async (tx) => {
					await syncAccount(tx, acct.workspaceId, acct.id, md)
				}).catch(async (err) => {
					log.warn({ err, accountId: acct.id }, 'mail account sync failed')
					await withWorkspace(
						deps.app,
						{ workspaceId: acct.workspaceId },
						(tx) =>
							tx`
							UPDATE mail_accounts
							SET status = 'error', status_detail = ${'sync failed'}
							WHERE workspace_id = ${acct.workspaceId} AND id = ${acct.id}
						`
					).catch(() => {})
				})
			}
		})

		// Undo-send: drafts past scheduled_send_at go out for real (§14.5).
		await boss.createQueue('mail-outbound-due')
		await boss.schedule('mail-outbound-due', '*/15 * * * * *', {}, { tz: 'UTC' })
		await boss.work('mail-outbound-due', async () => {
			const md = mailWorkerDeps
			const due = await withSystem(
				deps.app,
				(tx) =>
					tx<{ id: string; workspaceId: string }[]>`
						SELECT id, workspace_id AS "workspaceId" FROM list_mail_drafts_due_for_send()
					`
			)
			for (const d of due) {
				await withWorkspace(deps.app, { workspaceId: d.workspaceId }, (tx) =>
					sendDueDraft(tx, d.workspaceId, d.id, md)
				).catch((err) => log.warn({ err, draftId: d.id }, 'outbound mail send failed'))
			}
		})

		// Retention sweep (§14.7): hourly, per workspace with retention configured.
		await boss.createQueue('mail-retention')
		await boss.schedule('mail-retention', '5 * * * *', {}, { tz: 'UTC' })
		await boss.work('mail-retention', async () => {
			const md = mailWorkerDeps
			const workspaces = await withSystem(
				deps.app,
				(tx) =>
					tx<{ workspaceId: string }[]>`
						SELECT DISTINCT workspace_id AS "workspaceId"
						FROM mail_inboxes
						WHERE COALESCE((settings->>'retentionDays')::int, 0) > 0
					`
			)
			for (const ws of workspaces) {
				await withWorkspace(deps.app, { workspaceId: ws.workspaceId }, (tx) =>
					runRetentionSweep(tx, ws.workspaceId, md.storage)
				).catch((err) => log.warn({ err, workspaceId: ws.workspaceId }, 'mail retention sweep failed'))
			}
		})
	}

	// Dead-man switch: page the operator if the worker loop goes quiet (§20.4).
	const heartbeatMs = 60_000
	const heartbeat = deps.heartbeatUrl
		? setInterval(() => {
				if (deps.heartbeatUrl) {
					fetch(deps.heartbeatUrl).catch((err) => log.warn({ err }, 'heartbeat ping failed'))
				}
			}, heartbeatMs)
		: null

	await updateLagMetric(deps.app)
	log.info(
		{
			queues: [
				'outbox-drain',
				'doc-versions-thin',
				'webhook-deliver',
				'github-sync-inbound',
				'notification-email-digest',
				'mail-account-sync',
				'mail-outbound-due',
				'mail-retention'
			]
		},
		'worker started'
	)

	return {
		stop: async () => {
			if (heartbeat) clearInterval(heartbeat)
			await boss.stop({ graceful: true, timeout: 10_000 })
		}
	}
}
