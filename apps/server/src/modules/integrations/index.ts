import type { Sql } from '@huriro/db'
import { Elysia } from 'elysia'
import type { Auth } from '../identity'
import { workspaceDerive } from '../tenancy'
import { type GithubApiClient, GithubSyncError } from './github-client'
import {
	CreateGithubInstallationBody,
	CreateIssueGithubLinkBody,
	InstallationIdParam,
	IssueIdParam,
	LinkIdParam,
	UpdateGithubInstallationBody
} from './schema'
import {
	createGithubInstallation,
	createIssueGithubLink,
	deleteGithubInstallation,
	deleteIssueGithubLink,
	type IntegrationsOptions,
	ingestGithubWebhook,
	listGithubInstallations,
	listLinksForIssue,
	processGithubOutboundOutboxEvent,
	processPendingGithubWebhooksOnce,
	retryIssueGithubPush,
	updateGithubInstallation
} from './service'

export {
	type GithubApiClient,
	GithubSyncError,
	type IntegrationsOptions,
	processGithubOutboundOutboxEvent,
	processPendingGithubWebhooksOnce
}

/**
 * Unauthenticated raw-body GitHub App webhook receiver (§16.6):
 * registered before workspaceDerive so raw JSON bytes stay intact for
 * `X-Hub-Signature-256` HMAC verification.
 */
export function githubWebhookPublicModule(sql: Sql, opts: IntegrationsOptions) {
	return new Elysia({ name: 'huriro.githubWebhook' }).post(
		'/integrations/github/webhook',
		{ parse: 'text' },
		async ({ body, request, set }) => {
			const rawBody = typeof body === 'string' ? body : await request.text()
			const deliveryId = request.headers.get('x-github-delivery') ?? crypto.randomUUID()
			const eventName = request.headers.get('x-github-event') ?? 'ping'
			const signature256 = request.headers.get('x-hub-signature-256')
			const res = await ingestGithubWebhook(sql, {
				rawBody,
				deliveryId,
				eventName,
				signature256,
				opts
			})
			set.status = 202
			return res
		}
	)
}

export function integrationsModule(sql: Sql, auth: Auth | null, opts: IntegrationsOptions) {
	return new Elysia({ name: 'huriro.integrations' })
		.derive(workspaceDerive(sql, auth))
		.get('/integrations/github/installations', ({ inWorkspace }) =>
			inWorkspace(async (tx, actor) => ({ data: await listGithubInstallations(tx, actor) }))
		)
		.post(
			'/integrations/github/installations',
			{ body: CreateGithubInstallationBody },
			async ({ body, inWorkspace, set }) => {
				const created = await inWorkspace((tx, actor) => createGithubInstallation(tx, actor, body, opts))
				set.status = 201
				return created
			}
		)
		.patch(
			'/integrations/github/installations/:id',
			{ params: InstallationIdParam, body: UpdateGithubInstallationBody },
			({ params, body, inWorkspace }) =>
				inWorkspace((tx, actor) => updateGithubInstallation(tx, actor, params.id, body, opts))
		)
		.delete(
			'/integrations/github/installations/:id',
			{ params: InstallationIdParam },
			async ({ params, inWorkspace }) => {
				await inWorkspace((tx, actor) => deleteGithubInstallation(tx, actor, params.id))
				return { deleted: true, id: params.id }
			}
		)
		.get('/issues/:issueId/github-links', { params: IssueIdParam }, ({ params, inWorkspace }) =>
			inWorkspace(async (tx, actor) => ({ data: await listLinksForIssue(tx, actor, params.issueId) }))
		)
		.post(
			'/integrations/github/links',
			{ body: CreateIssueGithubLinkBody },
			async ({ body, inWorkspace, set }) => {
				const created = await inWorkspace((tx, actor) => createIssueGithubLink(tx, actor, body))
				set.status = 201
				return created
			}
		)
		.delete('/integrations/github/links/:id', { params: LinkIdParam }, async ({ params, inWorkspace }) => {
			await inWorkspace((tx, actor) => deleteIssueGithubLink(tx, actor, params.id))
			return { deleted: true, id: params.id }
		})
		.post(
			'/integrations/github/links/:id/retry',
			{ params: LinkIdParam },
			async ({ params, inWorkspace }) => {
				const actor = await inWorkspace(async (_tx, resolved) => resolved)
				return retryIssueGithubPush(sql, actor, params.id, opts)
			}
		)
}
