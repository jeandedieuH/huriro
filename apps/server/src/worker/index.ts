/**
 * Worker role: pg-boss queue + the transactional-outbox drain (§4.3, §19.1).
 *
 * pg-boss manages its own `pgboss` schema and needs DDL rights — it connects
 * with the admin URL. Job HANDLERS do tenant work through the huriro_app pool
 * inside withWorkspace, same as the API (§12.4).
 */
import { isUuid, type Sql, withSystem, withWorkspace } from '@huriro/db'
import axios from 'axios'
import { PgBoss } from 'pg-boss'
import { resolveRootEnvelopeSecret } from '../api/crypto'
import type { DnsResolver } from '../api/egress'
import { log, outboxDeadLetters, outboxDeadLettersTotal, outboxLag } from '../api/observability'
import type { EmailPipeline } from '../email'
import { sweepExpiredApprovals } from '../modules/agents'
import { processEmbeddingOutboxEvent } from '../modules/ai'
import {
	executeDueAutomationRuns,
	processAutomationOutboxEvent,
	runAutomationCronOnce
} from '../modules/automations'
import { captureDailyBillingUsageOnce } from '../modules/billing'
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
	dispatchInstantNotificationEmails,
	dispatchMobilePushNotifications,
	dispatchWebPushNotifications,
	type EmailTransport,
	type ExpoPushConfig,
	processNotificationOutboxEvent,
	runEmailDigestOnce,
	type VapidConfig
} from '../modules/notifications'
import { processSearchOutboxEvent } from '../modules/search'
import { runCycleMaintenanceOnce, runTriageWakeOnce } from '../modules/tasks'
import { enqueueWebhookDeliveriesForOutboxEvent, processDueWebhookDeliveriesOnce } from '../modules/webhooks'
import type { RealtimePubSub } from '../realtime/pubsub'
import { processEmailLifecycleOutboxEvent } from './email-lifecycle'

export interface DrainOutboxOptions {
	readonly blobStorage?: BlobStorage | undefined
	readonly clamavHost?: string | undefined
	readonly clamavPort?: number | undefined
	readonly rootSecret?: string | undefined
	readonly githubClient?: GithubApiClient | undefined
	readonly vapid?: VapidConfig | undefined
	readonly expoPush?: ExpoPushConfig | undefined
	readonly email?: EmailPipeline | undefined
	readonly publicBaseUrl?: string | undefined
	readonly egressFetch?: typeof fetch | undefined
	readonly egressResolver?: DnsResolver | undefined
	readonly mail?: Partial<MailModuleConfig> | undefined
	/** When set, only this workspace's rows are claimed — used by tests so one
	 * fixture's drain doesn't chew through every other test's backlog. */
	readonly onlyWorkspaceId?: string | undefined
	/** Attempt budget before a failing row is dead-lettered (§5.5). Test seam;
	 * production uses OUTBOX_MAX_ATTEMPTS. */
	readonly maxAttempts?: number | undefined
	/** Base for the capped exponential backoff between attempts. Test seam —
	 * pass 0 so drained rows are due again immediately. */
	readonly backoffBaseMs?: number | undefined
}

export interface WorkerDeps extends DrainOutboxOptions {
	readonly adminUrl: string
	readonly app: Sql
	readonly mode?: 'selfhost' | 'cloud' | undefined
	readonly pubsub?: RealtimePubSub
	readonly heartbeatUrl?: string | undefined
	readonly outboxIntervalMs?: number
	readonly emailTransport?: EmailTransport | undefined
	readonly smtp?: { readonly host?: string; readonly port?: number; readonly from?: string } | undefined
	readonly mailSyncIntervalSeconds?: number | undefined
}

const OUTBOX_BATCH = 200

/** Dead-letter policy (§5.5): after OUTBOX_MAX_ATTEMPTS failures a row leaves
 * the retry loop and waits for operator replay — never silently dropped. With
 * the 10s→1h capped backoff below the budget spans roughly 17 hours, so
 * transient outages (deploys, ClamAV restarts, webhook endpoint flaps) recover
 * on their own while genuinely poisoned events stop retrying forever. */
export const OUTBOX_MAX_ATTEMPTS = 25
const OUTBOX_BACKOFF_BASE_MS = 10_000
const OUTBOX_BACKOFF_CAP_MS = 3_600_000

/** Capped exponential backoff with ±20% jitter, where `attempts` is the
 * failure count AFTER incrementing (first failure → base delay). A base of 0
 * makes every retry due immediately — the deterministic mode tests use. */
export function outboxBackoffMs(attempts: number, baseMs: number, capMs = OUTBOX_BACKOFF_CAP_MS): number {
	const exp = Math.min(baseMs * 2 ** Math.max(0, attempts - 1), capMs)
	if (exp <= 0) return 0
	return Math.round(exp * (0.8 + Math.random() * 0.4))
}

interface PendingOutboxRow {
	readonly id: string
	readonly workspaceId: string | null
	readonly eventType: string
	readonly payload: Record<string, unknown>
	readonly attempts: number
	readonly changedAt: string
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
	// Due = unpublished, not dead-lettered, and past its backoff-scheduled
	// next_attempt_at. Dead letters stay in the table (§5.5 — no silent drops)
	// but out of this scan until an operator replays them.
	const rows = await app.begin(async (tx) => {
		const picked = opts?.onlyWorkspaceId
			? await tx<PendingOutboxRow[]>`
				SELECT id, workspace_id AS "workspaceId", event_type AS "eventType", payload, attempts,
					created_at::text AS "changedAt"
				FROM outbox
				WHERE published_at IS NULL
					AND dead_lettered_at IS NULL
					AND (next_attempt_at IS NULL OR next_attempt_at <= now())
					AND workspace_id = ${opts.onlyWorkspaceId}
				ORDER BY created_at ASC
				LIMIT ${OUTBOX_BATCH}
				FOR UPDATE SKIP LOCKED
			`
			: await tx<PendingOutboxRow[]>`
				SELECT id, workspace_id AS "workspaceId", event_type AS "eventType", payload, attempts,
					created_at::text AS "changedAt"
				FROM outbox
				WHERE published_at IS NULL
					AND dead_lettered_at IS NULL
					AND (next_attempt_at IS NULL OR next_attempt_at <= now())
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
						const automationRunRefs = await processAutomationOutboxEvent(tx, row)
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
						return { ...notifRes, automationRunRefs }
					}
				)
				if (txResult.cursor !== null) {
					const prev = cursorsToPublish.get(row.workspaceId)
					cursorsToPublish.set(
						row.workspaceId,
						prev === undefined ? txResult.cursor : Math.max(prev, txResult.cursor)
					)
				}

				if (txResult.automationRunRefs.length > 0) {
					await executeDueAutomationRuns(app, {
						runIds: txResult.automationRunRefs,
						batchSize: txResult.automationRunRefs.length
					}).catch((err) => log.warn({ err, outboxId: row.id }, 'automation executor failed'))
				}

				if (txResult.pendingWebPush.length > 0 && opts?.vapid) {
					await dispatchWebPushNotifications(app, row.workspaceId, txResult.pendingWebPush, {
						vapid: opts.vapid,
						fetchImpl: opts.egressFetch,
						resolver: opts.egressResolver
					}).catch((err) => log.warn({ err, outboxId: row.id }, 'web push dispatch error'))
				}

				if (txResult.pendingMobilePush.length > 0 && opts?.expoPush) {
					await dispatchMobilePushNotifications(app, row.workspaceId, txResult.pendingMobilePush, {
						expo: opts.expoPush,
						fetchImpl: opts.egressFetch,
						resolver: opts.egressResolver
					}).catch((err) => log.warn({ err, outboxId: row.id }, 'mobile push dispatch error'))
				}

				if (txResult.pendingEmail.length > 0 && opts?.email?.configured) {
					await dispatchInstantNotificationEmails(app, row.workspaceId, txResult.pendingEmail, {
						email: opts.email
					}).catch((err) => log.warn({ err, outboxId: row.id }, 'instant email dispatch error'))
				}

				await processEmailLifecycleOutboxEvent(app, row, {
					email: opts?.email
				}).catch((err) => log.warn({ err, outboxId: row.id }, 'lifecycle email consumer failed'))

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
			// These UPDATEs run in autocommit AFTER the consumer tx has rolled
			// back, so the attempt/dead-letter bookkeeping survives the failure
			// it records. Exhausting the attempt budget dead-letters the row:
			// it stays in outbox with payload + error for the operator dead-letter
			// view (`huriro dead-letters`) and is re-armed only by replay (§5.5).
			const msg = err instanceof Error ? err.message : String(err)
			const maxAttempts = opts?.maxAttempts ?? OUTBOX_MAX_ATTEMPTS
			const newAttempts = row.attempts + 1
			if (newAttempts >= maxAttempts) {
				log.error(
					{ err, outboxId: row.id, eventType: row.eventType, attempts: newAttempts },
					'outbox event dead-lettered'
				)
				outboxDeadLettersTotal.inc({ event_type: row.eventType })
				await app`
					UPDATE outbox
					SET attempts = ${newAttempts},
						last_error = ${msg},
						last_attempt_at = now(),
						next_attempt_at = NULL,
						dead_lettered_at = now()
					WHERE id = ${row.id} AND dead_lettered_at IS NULL
				`.catch(() => {})
			} else {
				log.error({ err, outboxId: row.id, eventType: row.eventType }, 'outbox consumer failed')
				const retryAt = new Date(
					Date.now() + outboxBackoffMs(newAttempts, opts?.backoffBaseMs ?? OUTBOX_BACKOFF_BASE_MS)
				)
				await app`
					UPDATE outbox
					SET attempts = ${newAttempts},
						last_error = ${msg},
						last_attempt_at = now(),
						next_attempt_at = ${retryAt}
					WHERE id = ${row.id}
				`.catch(() => {})
			}
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
	// Dead letters are terminal, not lag: they would pin the alert forever even
	// though the drain is healthy. They get their own gauge instead (§20.1).
	const [row] = await app<{ pending: number; dead: number }[]>`
		SELECT
			count(*) FILTER (WHERE dead_lettered_at IS NULL)::int AS pending,
			count(*) FILTER (WHERE dead_lettered_at IS NOT NULL)::int AS dead
		FROM outbox
		WHERE published_at IS NULL
	`
	outboxLag.set(row?.pending ?? 0)
	outboxDeadLetters.set(row?.dead ?? 0)
}

/**
 * Re-arm dead-lettered outbox rows for another round of draining (§5.5 replay):
 * clears the terminal marker and resets the attempt budget/backoff, so the row
 * is due immediately. Idempotent — replaying an already-replayed or unknown id
 * simply matches nothing. `ids === undefined` replays every dead letter;
 * an empty array replays none. Returns the number of rows re-armed.
 */
export async function replayDeadLetterEvents(app: Sql, ids?: readonly string[]): Promise<number> {
	if (ids !== undefined && ids.length === 0) return 0
	const rows = ids
		? await app<{ id: string }[]>`
			UPDATE outbox
			SET dead_lettered_at = NULL, attempts = 0, last_error = NULL, next_attempt_at = NULL
			WHERE dead_lettered_at IS NOT NULL AND id = ANY(${[...ids]}::uuid[])
			RETURNING id
		`
		: await app<{ id: string }[]>`
			UPDATE outbox
			SET dead_lettered_at = NULL, attempts = 0, last_error = NULL, next_attempt_at = NULL
			WHERE dead_lettered_at IS NOT NULL
			RETURNING id
		`
	return rows.length
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

	// Spillover/crash recovery for automation runs left status='running'; normal
	// execution happens immediately after each outbox row commits.
	await boss.createQueue('automation-runs')
	await boss.schedule('automation-runs', '*/30 * * * * *', {}, { tz: 'UTC' })
	await boss.work('automation-runs', async () => {
		await executeDueAutomationRuns(deps.app)
	})

	await boss.createQueue('automation-cron')
	await boss.schedule('automation-cron', '0 * * * * *', {}, { tz: 'UTC' })
	await boss.work('automation-cron', async () => {
		await runAutomationCronOnce(deps.app)
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

	// Snoozed triage issues past triage_snoozed_until flip back to pending (§3.1).
	await boss.createQueue('tasks-triage-wake')
	await boss.schedule('tasks-triage-wake', '* * * * *', {}, { tz: 'UTC' })
	await boss.work('tasks-triage-wake', async () => {
		const res = await runTriageWakeOnce(deps.app)
		if (res.woken > 0) log.info({ woken: res.woken }, 'triage snooze wake')
	})

	// Nightly cycle engine (§3.3): activate due cycles, complete expired ones
	// with rollover, pre-create upcoming windows, snapshot active-cycle burnup.
	await boss.createQueue('tasks-cycle-maintenance')
	await boss.schedule('tasks-cycle-maintenance', '0 2 * * *', {}, { tz: 'UTC' })
	await boss.work('tasks-cycle-maintenance', async () => {
		const res = await runCycleMaintenanceOnce(deps.app)
		if (res.activated + res.completed + res.created + res.snapshotted > 0) {
			log.info(res, 'cycle maintenance completed')
		}
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
			smtp: deps.smtp,
			...(deps.email !== undefined ? { email: deps.email } : {}),
			...(deps.publicBaseUrl !== undefined ? { baseUrl: deps.publicBaseUrl } : {})
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
	if (deps.mode === 'cloud') {
		await boss.createQueue('billing-usage-snapshot')
		await boss.schedule('billing-usage-snapshot', '0 1 * * *', {}, { tz: 'UTC' })
		await boss.work('billing-usage-snapshot', async () => {
			const count = await captureDailyBillingUsageOnce(deps.app)
			if (count > 0) log.info({ workspaces: count }, 'daily billing usage snapshot captured')
		})
	}

	const heartbeatMs = 60_000
	const heartbeat = deps.heartbeatUrl
		? setInterval(() => {
				if (deps.heartbeatUrl) {
					axios.get(deps.heartbeatUrl).catch((err) => log.warn({ err }, 'heartbeat ping failed'))
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
