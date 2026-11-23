/**
 * GitHub App two-way sync service (§16.6):
 *   - Pre-tenant raw-body HMAC-SHA256 webhook ingestion (`202` fast path)
 *   - Worker inbound processor (`issues` & `issue_comment` -> Huriro) with `lastSyncHash` echo guard
 *   - Outbound outbox processor (Huriro -> GitHub) skipping `origin === 'github_sync'` events
 *   - Surfacing `push_failed` + error details with manual retry support.
 */
import { createHash } from 'node:crypto'
import type {
	CreateGithubInstallationBody,
	CreateIssueGithubLinkBody,
	GithubInstallationDto,
	IssueGithubLinkDto,
	UpdateGithubInstallationBody
} from '@huriro/contracts'
import { type Queryable, type Sql, uuid7, withSystem, withWorkspace } from '@huriro/db'
import type { Action, ActorContext } from '@huriro/domain'
import { decryptSecret, encryptSecret, verifyGithubSignature256 } from '../../api/crypto'
import type { DnsResolver } from '../../api/egress'
import { HttpError } from '../../api/error'
import { githubSyncTotal } from '../../api/observability'
import type { RealtimePubSub } from '../../realtime/pubsub'
import {
	createIssue,
	createIssueComment,
	getIssueDetail,
	listProjectStatuses,
	TASKS_EVENTS,
	updateIssue
} from '../tasks'
import { GITHUB_OUTBOUND_CONSUMER, INTEGRATIONS_EVENTS } from './events'
import { createDefaultGithubClient, type GithubApiClient } from './github-client'
import { authorizeIntegrationsManage, authorizeIssueLinkRead } from './policy'
import {
	claimPendingGithubWebhookRows,
	deleteGithubInstallationRow,
	deleteIssueGithubLinkRow,
	getGithubInstallationWithSecrets,
	getIssueGithubLinkByRepoNumber,
	getIssueGithubLinkWithInstallation,
	insertGithubInstallationRow,
	insertGithubWebhookEventRow,
	insertIssueGithubLinkRow,
	listGithubInstallationRows,
	listIssueGithubLinkRows,
	listIssueLinksWithInstallation,
	markGithubWebhookEventStatus,
	resolveGithubInstallationRoutes,
	touchInstallationSyncedAt,
	updateGithubInstallationRow,
	updateIssueGithubLinkSyncState
} from './repo'

export interface IntegrationsOptions {
	readonly rootSecret: string
	readonly globalWebhookSecret?: string | undefined
	readonly githubClient?: GithubApiClient | undefined
	readonly fetchImpl?: typeof fetch | undefined
	readonly resolver?: DnsResolver | undefined
}

function installationAad(workspaceId: string, id: string): string {
	return `${workspaceId}:github_installation:${id}`
}

export function computeGithubSyncHash(input: {
	readonly title: string
	readonly body: string
	readonly state: 'open' | 'closed'
}): string {
	return createHash('sha256')
		.update(
			JSON.stringify({
				title: input.title.trim(),
				body: input.body.trim(),
				state: input.state
			})
		)
		.digest('hex')
}

async function resolveSyncActorContext(
	tx: Queryable,
	workspaceId: string,
	preferredUserId: string | null
): Promise<ActorContext> {
	const [member] = await tx<{ userId: string; roleId: string; roleKey: string; roleRank: number }[]>`
		SELECT
			m.user_id AS "userId",
			m.role_id AS "roleId",
			r.key AS "roleKey",
			r.rank AS "roleRank"
		FROM memberships m
		JOIN roles r ON r.workspace_id = m.workspace_id AND r.id = m.role_id
		WHERE m.workspace_id = ${workspaceId}
			AND m.status = 'active'
			AND (${preferredUserId}::uuid IS NULL OR m.user_id = ${preferredUserId} OR r.key IN ('owner', 'admin'))
		ORDER BY (CASE WHEN m.user_id = ${preferredUserId} THEN 0 ELSE 1 END), r.rank DESC
		LIMIT 1
	`
	if (!member) {
		throw new Error(`No active member found in workspace ${workspaceId} for GitHub sync`)
	}
	const perms = await tx<{ action: Action }[]>`
		SELECT permission AS action FROM role_permissions
		WHERE workspace_id = ${workspaceId} AND role_id = ${member.roleId}
	`
	return {
		principalId: member.userId,
		workspaceId,
		kind: 'user',
		membership: 'active',
		roleKey: member.roleKey,
		roleRank: member.roleRank,
		permissions: new Set(perms.map((p) => p.action))
	}
}

export async function listGithubInstallations(
	tx: Queryable,
	actor: ActorContext
): Promise<GithubInstallationDto[]> {
	authorizeIntegrationsManage(actor)
	return listGithubInstallationRows(tx, actor.workspaceId)
}

export async function createGithubInstallation(
	tx: Queryable,
	actor: ActorContext,
	input: CreateGithubInstallationBody,
	opts: IntegrationsOptions
): Promise<GithubInstallationDto> {
	authorizeIntegrationsManage(actor)
	const id = uuid7()
	const aad = installationAad(actor.workspaceId, id)
	const webhookSecretEncrypted = encryptSecret(opts.rootSecret, aad, input.webhookSecret)
	const accessTokenEncrypted = input.accessToken
		? encryptSecret(opts.rootSecret, aad, input.accessToken)
		: null

	const created = await insertGithubInstallationRow(tx, {
		id,
		workspaceId: actor.workspaceId,
		installationId: input.installationId,
		accountLogin: input.accountLogin.trim(),
		repoFullName: input.repoFullName.trim(),
		projectId: input.projectId,
		webhookSecretEncrypted,
		accessTokenEncrypted,
		syncEnabled: input.syncEnabled ?? true,
		createdBy: actor.principalId
	})

	await tx`
		INSERT INTO outbox (workspace_id, aggregate, aggregate_id, event_type, payload)
		VALUES (
			${actor.workspaceId},
			'github_installation',
			${created.id},
			${INTEGRATIONS_EVENTS.GithubInstallationCreated},
			${tx.json({ installationId: created.id, repoFullName: created.repoFullName } as never)}
		)
	`

	await tx`
		INSERT INTO audit_log (workspace_id, actor_type, actor_id, action, target_type, target_id, metadata)
		VALUES (
			${actor.workspaceId},
			${actor.kind},
			${actor.principalId},
			'integrations.github.installation.create',
			'github_installation',
			${created.id},
			${tx.json({ repoFullName: created.repoFullName, projectId: created.projectId } as never)}
		)
	`

	return created
}

export async function updateGithubInstallation(
	tx: Queryable,
	actor: ActorContext,
	id: string,
	input: UpdateGithubInstallationBody,
	opts: IntegrationsOptions
): Promise<GithubInstallationDto> {
	authorizeIntegrationsManage(actor)
	const existing = await getGithubInstallationWithSecrets(tx, actor.workspaceId, id)
	if (!existing) throw new HttpError(404, 'not_found', 'GitHub installation not found')
	if (existing.installation.version !== input.version) {
		throw new HttpError(409, 'stale_version', 'GitHub installation modified concurrently', undefined, {
			currentVersion: existing.installation.version,
			yourVersion: input.version
		})
	}

	const aad = installationAad(actor.workspaceId, id)
	const webhookSecretEncrypted = input.webhookSecret
		? encryptSecret(opts.rootSecret, aad, input.webhookSecret)
		: existing.webhookSecretEncrypted
	const accessTokenEncrypted = input.accessToken
		? encryptSecret(opts.rootSecret, aad, input.accessToken)
		: existing.accessTokenEncrypted

	const updated = await updateGithubInstallationRow(tx, {
		workspaceId: actor.workspaceId,
		id,
		expectedVersion: input.version,
		projectId: input.projectId ?? existing.installation.projectId,
		syncEnabled: input.syncEnabled ?? existing.installation.syncEnabled,
		webhookSecretEncrypted,
		accessTokenEncrypted
	})
	if (!updated) throw new HttpError(409, 'stale_version', 'GitHub installation modified concurrently')

	await tx`
		INSERT INTO audit_log (workspace_id, actor_type, actor_id, action, target_type, target_id, metadata)
		VALUES (
			${actor.workspaceId},
			${actor.kind},
			${actor.principalId},
			'integrations.github.installation.update',
			'github_installation',
			${updated.id},
			${tx.json({ syncEnabled: updated.syncEnabled, projectId: updated.projectId } as never)}
		)
	`
	return updated
}

export async function deleteGithubInstallation(
	tx: Queryable,
	actor: ActorContext,
	id: string
): Promise<void> {
	authorizeIntegrationsManage(actor)
	const ok = await deleteGithubInstallationRow(tx, actor.workspaceId, id)
	if (!ok) throw new HttpError(404, 'not_found', 'GitHub installation not found')
}

export async function listLinksForIssue(
	tx: Queryable,
	actor: ActorContext,
	issueId: string
): Promise<IssueGithubLinkDto[]> {
	authorizeIssueLinkRead(actor)
	return listIssueGithubLinkRows(tx, actor.workspaceId, issueId)
}

export async function createIssueGithubLink(
	tx: Queryable,
	actor: ActorContext,
	input: CreateIssueGithubLinkBody
): Promise<IssueGithubLinkDto> {
	authorizeIntegrationsManage(actor)
	const inst = await getGithubInstallationWithSecrets(tx, actor.workspaceId, input.installationId)
	if (!inst) throw new HttpError(404, 'not_found', 'GitHub installation not found')

	return insertIssueGithubLinkRow(tx, {
		workspaceId: actor.workspaceId,
		issueId: input.issueId,
		installationId: inst.installation.id,
		repoFullName: inst.installation.repoFullName,
		githubIssueNumber: input.githubIssueNumber,
		githubIssueId: input.githubIssueId ?? input.githubIssueNumber,
		githubUrl:
			input.githubUrl ??
			`https://github.com/${inst.installation.repoFullName}/issues/${input.githubIssueNumber}`,
		sourceOfTruth: input.sourceOfTruth ?? 'bidirectional'
	})
}

export async function deleteIssueGithubLink(
	tx: Queryable,
	actor: ActorContext,
	linkId: string
): Promise<void> {
	authorizeIntegrationsManage(actor)
	const ok = await deleteIssueGithubLinkRow(tx, actor.workspaceId, linkId)
	if (!ok) throw new HttpError(404, 'not_found', 'GitHub link not found')
}

// ---------- Pre-tenant Raw Webhook Ingestion (§16.6) ----------

export async function ingestGithubWebhook(
	sql: Sql,
	args: {
		readonly rawBody: string
		readonly deliveryId: string
		readonly eventName: string
		readonly signature256: string | null
		readonly opts: IntegrationsOptions
	}
): Promise<{ readonly accepted: true; readonly deliveryId: string; readonly queued: boolean }> {
	if (!args.signature256) {
		throw new HttpError(401, 'webhook_signature_invalid', 'Missing X-Hub-Signature-256 header')
	}

	let parsed: Record<string, unknown>
	try {
		parsed = JSON.parse(args.rawBody) as Record<string, unknown>
	} catch {
		throw new HttpError(400, 'validation_failed', 'Invalid JSON webhook payload')
	}

	const repoObj = parsed['repository'] as Record<string, unknown> | undefined
	const instObj = parsed['installation'] as Record<string, unknown> | undefined
	const repoFullName = typeof repoObj?.['full_name'] === 'string' ? repoObj['full_name'] : null
	const installationId =
		typeof instObj?.['id'] === 'number' && Number.isFinite(instObj['id']) ? instObj['id'] : null

	const verified = await withSystem(sql, async (tx) => {
		const candidateSecrets: string[] = []
		if (repoFullName) {
			const routes = await resolveGithubInstallationRoutes(tx, repoFullName, installationId)
			for (const r of routes) {
				try {
					candidateSecrets.push(
						decryptSecret(
							args.opts.rootSecret,
							installationAad(r.workspaceId, r.id),
							r.webhookSecretEncrypted
						)
					)
				} catch {
					// Ignore key mismatch for non-matching routes
				}
			}
		}
		if (args.opts.globalWebhookSecret) {
			candidateSecrets.push(args.opts.globalWebhookSecret)
		}

		const valid = candidateSecrets.some((sec) =>
			verifyGithubSignature256(sec, args.rawBody, args.signature256)
		)
		if (!valid) return null

		const inserted = await insertGithubWebhookEventRow(tx, {
			deliveryId: args.deliveryId,
			installationId,
			repoFullName,
			eventName: args.eventName,
			payload: parsed
		})
		return { queued: inserted }
	})

	if (!verified) {
		throw new HttpError(401, 'webhook_signature_invalid', 'Invalid GitHub webhook signature')
	}

	return { accepted: true, deliveryId: args.deliveryId, queued: verified.queued }
}

// ---------- Worker Processors (Inbound + Outbound) ----------

export async function processPendingGithubWebhooksOnce(
	app: Sql,
	opts: { readonly rootSecret: string; readonly pubsub?: RealtimePubSub | undefined }
): Promise<{ readonly processed: number; readonly ignored: number; readonly failed: number }> {
	const events = await withSystem(app, (tx) => claimPendingGithubWebhookRows(tx, 50))
	if (events.length === 0) return { processed: 0, ignored: 0, failed: 0 }

	let processed = 0
	let ignored = 0
	let failed = 0

	for (const ev of events) {
		try {
			if (!ev.repoFullName) {
				await withSystem(app, (tx) => markGithubWebhookEventStatus(tx, ev.id, 'ignored', 'No repository'))
				ignored++
				continue
			}

			const routes = await withSystem(app, (tx) =>
				resolveGithubInstallationRoutes(tx, ev.repoFullName!, ev.installationId)
			)
			const enabledRoutes = routes.filter((r) => r.syncEnabled)
			if (enabledRoutes.length === 0) {
				await withSystem(app, (tx) =>
					markGithubWebhookEventStatus(tx, ev.id, 'ignored', 'No active installation route')
				)
				ignored++
				continue
			}

			for (const route of enabledRoutes) {
				const cursor = await withWorkspace(app, { workspaceId: route.workspaceId }, async (tx) => {
					const inst = await getGithubInstallationWithSecrets(tx, route.workspaceId, route.id)
					if (!inst) return 0
					const actor = await resolveSyncActorContext(tx, route.workspaceId, inst.createdBy)

					if (ev.eventName === 'issues') {
						const action = String(ev.payload['action'] ?? '')
						const issueObj = ev.payload['issue'] as Record<string, unknown> | undefined
						if (!issueObj || typeof issueObj['number'] !== 'number') return 0

						const ghNumber = issueObj['number']
						const ghId = typeof issueObj['id'] === 'number' ? issueObj['id'] : ghNumber
						const title = String(issueObj['title'] ?? 'Untitled issue')
						const body = typeof issueObj['body'] === 'string' ? issueObj['body'] : ''
						const ghState: 'open' | 'closed' = issueObj['state'] === 'closed' ? 'closed' : 'open'
						const htmlUrl =
							typeof issueObj['html_url'] === 'string'
								? issueObj['html_url']
								: `https://github.com/${ev.repoFullName}/issues/${ghNumber}`
						const nodeId = typeof issueObj['node_id'] === 'string' ? issueObj['node_id'] : null

						const incomingHash = computeGithubSyncHash({ title, body, state: ghState })
						const existingLink = await getIssueGithubLinkByRepoNumber(
							tx,
							route.workspaceId,
							ev.repoFullName!,
							ghNumber
						)

						if (existingLink) {
							if (existingLink.sourceOfTruth === 'huriro' || existingLink.lastSyncHash === incomingHash) {
								return 0
							}
							const statuses = await listProjectStatuses(tx, actor, inst.installation.projectId)
							const targetStatus =
								ghState === 'closed'
									? statuses.find((s) => s.category === 'completed')
									: (statuses.find((s) => s.category === 'unstarted' || s.isDefault) ??
										statuses.find((s) => s.category !== 'completed' && s.category !== 'cancelled'))

							const detail = await getIssueDetail(tx, actor, existingLink.issueId)
							const res = await updateIssue(
								tx,
								actor,
								existingLink.issueId,
								{
									title,
									descriptionText: body,
									...(targetStatus ? { statusId: targetStatus.id } : {}),
									version: detail.issue.version
								},
								{ origin: 'github_sync' }
							)
							await updateIssueGithubLinkSyncState(tx, {
								workspaceId: route.workspaceId,
								linkId: existingLink.id,
								syncState: 'synced',
								lastSyncHash: incomingHash,
								lastSyncError: null,
								synced: true
							})
							await touchInstallationSyncedAt(tx, route.workspaceId, inst.installation.id)
							githubSyncTotal.inc({ direction: 'inbound', status: 'ok' })
							return res.cursor
						}

						if (action === 'opened' || action === 'edited' || action === 'reopened') {
							const statuses = await listProjectStatuses(tx, actor, inst.installation.projectId)
							const targetStatus =
								ghState === 'closed'
									? statuses.find((s) => s.category === 'completed')
									: (statuses.find((s) => s.isDefault) ??
										statuses.find((s) => s.category !== 'completed' && s.category !== 'cancelled'))
							const created = await createIssue(
								tx,
								actor,
								{
									id: uuid7(),
									projectId: inst.installation.projectId,
									title,
									descriptionText: body,
									...(targetStatus ? { statusId: targetStatus.id } : {})
								},
								{ origin: 'github_sync' }
							)
							await insertIssueGithubLinkRow(tx, {
								workspaceId: route.workspaceId,
								issueId: created.data.id,
								installationId: inst.installation.id,
								repoFullName: inst.installation.repoFullName,
								githubIssueNumber: ghNumber,
								githubIssueId: ghId,
								githubNodeId: nodeId,
								githubUrl: htmlUrl,
								sourceOfTruth: 'bidirectional',
								lastSyncHash: incomingHash,
								syncState: 'synced'
							})
							await touchInstallationSyncedAt(tx, route.workspaceId, inst.installation.id)
							githubSyncTotal.inc({ direction: 'inbound', status: 'ok' })
							return created.cursor
						}
					} else if (ev.eventName === 'issue_comment') {
						const action = String(ev.payload['action'] ?? '')
						const issueObj = ev.payload['issue'] as Record<string, unknown> | undefined
						const commentObj = ev.payload['comment'] as Record<string, unknown> | undefined
						if (
							action === 'created' &&
							issueObj &&
							typeof issueObj['number'] === 'number' &&
							commentObj &&
							typeof commentObj['body'] === 'string'
						) {
							const existingLink = await getIssueGithubLinkByRepoNumber(
								tx,
								route.workspaceId,
								ev.repoFullName!,
								issueObj['number']
							)
							if (existingLink && existingLink.sourceOfTruth !== 'huriro') {
								const res = await createIssueComment(
									tx,
									actor,
									existingLink.issueId,
									{
										id: uuid7(),
										bodyText: commentObj['body']
									},
									{ origin: 'github_sync' }
								)
								githubSyncTotal.inc({ direction: 'inbound', status: 'ok' })
								return res.cursor
							}
						}
					}
					return 0
				})

				if (opts.pubsub && cursor > 0) {
					await opts.pubsub.publishCursor(route.workspaceId, cursor)
				}
			}

			await withSystem(app, (tx) => markGithubWebhookEventStatus(tx, ev.id, 'processed'))
			processed++
		} catch (err) {
			githubSyncTotal.inc({ direction: 'inbound', status: 'failed' })
			await withSystem(app, (tx) =>
				markGithubWebhookEventStatus(
					tx,
					ev.id,
					'failed',
					err instanceof Error ? err.message.slice(0, 400) : 'Inbound sync failed'
				)
			)
			failed++
		}
	}

	return { processed, ignored, failed }
}

export async function processGithubOutboundOutboxEvent(
	app: Sql,
	event: {
		readonly id: string
		readonly workspaceId: string | null
		readonly eventType: string
		readonly payload: Record<string, unknown>
	},
	opts: IntegrationsOptions
): Promise<number> {
	if (!event.workspaceId) return 0
	const isIssueUpdate =
		event.eventType === TASKS_EVENTS.IssueUpdated || event.eventType === TASKS_EVENTS.IssueStatusChanged
	const isCommentCreate = event.eventType === TASKS_EVENTS.IssueCommentCreated
	if (!isIssueUpdate && !isCommentCreate) return 0

	const issueId = typeof event.payload['issueId'] === 'string' ? event.payload['issueId'] : null
	if (!issueId) return 0

	// Echo-loop guard #1: suppress outbound writes triggered by inbound GitHub sync.
	if (event.payload['origin'] === 'github_sync') {
		await withWorkspace(app, { workspaceId: event.workspaceId }, async (tx) => {
			await tx`
				INSERT INTO processed_events (consumer, event_id)
				VALUES (${GITHUB_OUTBOUND_CONSUMER}, ${event.id})
				ON CONFLICT (consumer, event_id) DO NOTHING
			`
		})
		return 0
	}

	const prepared = await withWorkspace(app, { workspaceId: event.workspaceId }, async (tx) => {
		const claimed = await tx<{ eventId: string }[]>`
			INSERT INTO processed_events (consumer, event_id)
			VALUES (${GITHUB_OUTBOUND_CONSUMER}, ${event.id})
			ON CONFLICT (consumer, event_id) DO NOTHING
			RETURNING event_id AS "eventId"
		`
		if (claimed.length === 0) return null

		const links = await listIssueLinksWithInstallation(tx, event.workspaceId!, issueId)
		const pushable = links.filter((l) => l.syncEnabled && l.link.sourceOfTruth !== 'github')
		if (pushable.length === 0) return null

		const [issueRow] = await tx<{ title: string; descriptionText: string; category: string }[]>`
			SELECT
				i.title,
				i.description_text AS "descriptionText",
				ps.category
			FROM issues i
			JOIN project_statuses ps ON ps.workspace_id = i.workspace_id AND ps.id = i.status_id
			WHERE i.workspace_id = ${event.workspaceId!} AND i.id = ${issueId}
		`
		if (!issueRow) return null

		const state: 'open' | 'closed' =
			issueRow.category === 'completed' || issueRow.category === 'cancelled' ? 'closed' : 'open'
		const outgoingHash = computeGithubSyncHash({
			title: issueRow.title,
			body: issueRow.descriptionText,
			state
		})

		return {
			issue: { title: issueRow.title, body: issueRow.descriptionText, state },
			outgoingHash,
			commentBody: isCommentCreate ? String(event.payload['bodyText'] ?? '') : null,
			links: pushable.filter((l) => isCommentCreate || l.link.lastSyncHash !== outgoingHash)
		}
	})

	if (!prepared || prepared.links.length === 0) return 0

	const client =
		opts.githubClient ??
		createDefaultGithubClient({
			...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
			...(opts.resolver ? { resolver: opts.resolver } : {})
		})

	const results: {
		readonly linkId: string
		readonly ok: boolean
		readonly error: string | null
	}[] = []

	for (const item of prepared.links) {
		const accessToken = item.accessTokenEncrypted
			? decryptSecret(
					opts.rootSecret,
					installationAad(event.workspaceId, item.link.installationId),
					item.accessTokenEncrypted
				)
			: null

		try {
			if (prepared.commentBody !== null) {
				await client.createComment({
					repoFullName: item.link.repoFullName,
					issueNumber: item.link.githubIssueNumber,
					body: prepared.commentBody,
					accessToken
				})
			} else {
				await client.updateIssue({
					repoFullName: item.link.repoFullName,
					issueNumber: item.link.githubIssueNumber,
					title: prepared.issue.title,
					body: prepared.issue.body,
					state: prepared.issue.state,
					accessToken
				})
			}
			githubSyncTotal.inc({ direction: 'outbound', status: 'ok' })
			results.push({ linkId: item.link.id, ok: true, error: null })
		} catch (err) {
			githubSyncTotal.inc({ direction: 'outbound', status: 'failed' })
			results.push({
				linkId: item.link.id,
				ok: false,
				error: err instanceof Error ? err.message.slice(0, 500) : 'GitHub push failed'
			})
		}
	}

	await withWorkspace(app, { workspaceId: event.workspaceId }, async (tx) => {
		for (const r of results) {
			await updateIssueGithubLinkSyncState(tx, {
				workspaceId: event.workspaceId!,
				linkId: r.linkId,
				syncState: r.ok ? 'synced' : 'push_failed',
				lastSyncHash: r.ok && prepared.commentBody === null ? prepared.outgoingHash : null,
				lastSyncError: r.error,
				synced: r.ok
			})
		}
	})

	return results.length
}

export async function retryIssueGithubPush(
	app: Sql,
	actor: ActorContext,
	linkId: string,
	opts: IntegrationsOptions
): Promise<IssueGithubLinkDto> {
	const prepared = await withWorkspace(
		app,
		{ workspaceId: actor.workspaceId, userId: actor.principalId },
		async (tx) => {
			authorizeIssueLinkRead(actor)
			const found = await getIssueGithubLinkWithInstallation(tx, actor.workspaceId, linkId)
			if (!found) throw new HttpError(404, 'not_found', 'GitHub link not found')

			const [issueRow] = await tx<{ title: string; descriptionText: string; category: string }[]>`
				SELECT
					i.title,
					i.description_text AS "descriptionText",
					ps.category
				FROM issues i
				JOIN project_statuses ps ON ps.workspace_id = i.workspace_id AND ps.id = i.status_id
				WHERE i.workspace_id = ${actor.workspaceId} AND i.id = ${found.link.issueId}
			`
			if (!issueRow) throw new HttpError(404, 'not_found', 'Linked issue not found')
			const state: 'open' | 'closed' =
				issueRow.category === 'completed' || issueRow.category === 'cancelled' ? 'closed' : 'open'
			return {
				found,
				issue: { title: issueRow.title, body: issueRow.descriptionText, state },
				hash: computeGithubSyncHash({
					title: issueRow.title,
					body: issueRow.descriptionText,
					state
				})
			}
		}
	)

	const client =
		opts.githubClient ??
		createDefaultGithubClient({
			...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
			...(opts.resolver ? { resolver: opts.resolver } : {})
		})

	const accessToken = prepared.found.accessTokenEncrypted
		? decryptSecret(
				opts.rootSecret,
				installationAad(actor.workspaceId, prepared.found.link.installationId),
				prepared.found.accessTokenEncrypted
			)
		: null

	let ok = true
	let errorMsg: string | null = null
	try {
		await client.updateIssue({
			repoFullName: prepared.found.link.repoFullName,
			issueNumber: prepared.found.link.githubIssueNumber,
			title: prepared.issue.title,
			body: prepared.issue.body,
			state: prepared.issue.state,
			accessToken
		})
		githubSyncTotal.inc({ direction: 'outbound', status: 'ok' })
	} catch (err) {
		ok = false
		errorMsg = err instanceof Error ? err.message.slice(0, 500) : 'GitHub push failed'
		githubSyncTotal.inc({ direction: 'outbound', status: 'failed' })
	}

	const updated = await withWorkspace(
		app,
		{ workspaceId: actor.workspaceId, userId: actor.principalId },
		(tx) =>
			updateIssueGithubLinkSyncState(tx, {
				workspaceId: actor.workspaceId,
				linkId,
				syncState: ok ? 'synced' : 'push_failed',
				lastSyncHash: ok ? prepared.hash : null,
				lastSyncError: errorMsg,
				synced: ok
			})
	)

	return updated ?? prepared.found.link
}
