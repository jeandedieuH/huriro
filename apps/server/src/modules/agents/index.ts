/**
 * Agents module controller (§13.1a). Three surfaces on the /api/v1 group:
 *
 *   - `/agent/*`     — agent tool surface. Bearer-only via
 *     `verifyAgentBearer(auth, req, {audience:'rest'})`; cookie sessions get
 *     401 and agent tokens stay rejected on every other route (audience
 *     split, ADR-0019). One POST per registry tool, generated from TOOLS.
 *   - `/agents*`     — human principal management (session + agent.manage).
 *   - `/approvals*`  — human approval decisions (session + approval.decide).
 *
 * `assertRegistryCoverage()` fails boot if a registry tool lacks a handler
 * or a handler lacks a spec.
 */
import { TOOLS, toolManifest } from '@huriro/agent-tools'
import type { ToolResult } from '@huriro/contracts'
import type { Sql } from '@huriro/db'
import { Elysia } from 'elysia'
import { Type } from 'typebox'
import { HttpError } from '../../api/error'
import type { CollabDirectBridge } from '../docs'
import type { Auth } from '../identity'
import { revokeAgentGrants } from '../identity'
import { workspaceDerive } from '../tenancy'
import { apiKeyRoutes, verifyRestAgentCredential } from './api-keys'
import { consentRoutes } from './consent'
import { type InvokeResult, invokeTool } from './dispatch'
import { markdownResponse, splitMdParam } from './markdown'
import {
	AgentIdParam,
	ApprovalIdParam,
	CreateAgentBody,
	DecideApprovalBody,
	ListAgentActivityQuery,
	ListApprovalsQuery,
	UndoIdParam,
	UpdateAgentBody
} from './schema'
import {
	createAgent,
	decideApproval,
	getAgent,
	getWorkspaceApproval,
	listAgentActivity,
	listAgents,
	listConnectedApps,
	listWorkspaceApprovals,
	revokeAgent,
	revokeConnectedApp,
	undoAgentAction,
	updateAgent
} from './service'
import { assertRegistryCoverage } from './tool-handlers'

export { invokeTool } from './dispatch'
export { AGENTS_EVENTS } from './events'
export { markdownResponse, renderDocument, renderIssue, splitMdParam } from './markdown'
export { type ResolvedAgent, resolveAgentActor } from './principal'
export { sweepExpiredApprovals } from './service'
export { assertRegistryCoverage }

const AgentHeaders = Type.Object(
	{
		'x-workspace-id': Type.String({ format: 'uuid' }),
		'idempotency-key': Type.Optional(Type.String({ maxLength: 128 }))
	},
	{ additionalProperties: true }
)

const ToolResultSchema = Type.Object(
	{
		data: Type.Unknown(),
		markdown: Type.String(),
		trust: Type.Union([Type.Literal('trusted'), Type.Literal('untrusted')]),
		nextCursor: Type.Union([Type.String(), Type.Null()]),
		undoId: Type.Optional(Type.String({ format: 'uuid' }))
	},
	{ additionalProperties: false }
)

const ApprovalRequiredSchema = Type.Object({
	status: Type.Literal('approval_required'),
	approvalId: Type.String({ format: 'uuid' }),
	approveUrl: Type.String(),
	expiresAt: Type.String({ format: 'date-time' })
})

const NeedsConfirmationSchema = Type.Object({
	status: Type.Literal('needs_confirmation'),
	previewMd: Type.String(),
	requestState: Type.String()
})

function operationId(toolName: string): string {
	return toolName.replaceAll('.', '_')
}

export function agentsModule(
	sql: Sql,
	auth: Auth | null,
	opts: { readonly baseUrl: string; readonly collabBridge?: CollabDirectBridge | undefined }
) {
	assertRegistryCoverage()

	const human = new Elysia({ name: 'huriro.agents' })
		.derive(workspaceDerive(sql, auth))
		.get('/agents', ({ inWorkspace }) =>
			inWorkspace(async (tx, actor) => ({ data: await listAgents(tx, actor) }))
		)
		.post('/agents', { body: CreateAgentBody }, async ({ body, inWorkspace }) => ({
			data: await inWorkspace((tx, actor) => createAgent(tx, actor, body))
		}))
		.get('/agents/:id', { params: AgentIdParam }, async ({ params, inWorkspace }) => ({
			data: await inWorkspace((tx, actor) => getAgent(tx, actor, params.id))
		}))
		.patch(
			'/agents/:id',
			{ params: AgentIdParam, body: UpdateAgentBody },
			async ({ params, body, inWorkspace }) => ({
				data: await inWorkspace((tx, actor) => updateAgent(tx, actor, params.id, body))
			})
		)
		.delete('/agents/:id', { params: AgentIdParam }, async ({ params, inWorkspace }) => {
			const dto = await inWorkspace((tx, actor) => revokeAgent(tx, actor, params.id))
			// Tear down OAuth consent + tokens via the identity seam (auth-schema
			// writes can't join the tenant tx — post-commit, best-effort logged).
			if (auth && dto.oauthClientId) {
				await revokeAgentGrants(auth, dto.ownerUserId, dto.oauthClientId)
			}
			return { data: dto }
		})
		// Connected apps (§13.1b): owner-scoped, any active member — no
		// agent.manage needed to see or disconnect your own agents.
		.get('/me/connected-apps', ({ inWorkspace }) =>
			inWorkspace(async (tx, actor) => ({ data: await listConnectedApps(tx, actor) }))
		)
		.delete(
			'/me/connected-apps/:id',
			{ params: AgentIdParam },
			async ({ params, workspaceCtx, inWorkspace }) => {
				const revoked = await inWorkspace((tx, actor) => revokeConnectedApp(tx, actor, params.id))
				if (auth && revoked.oauthClientId) {
					await revokeAgentGrants(auth, workspaceCtx.session.userId, revoked.oauthClientId)
				}
				return { data: revoked }
			}
		)
		.get(
			'/agents/:id/activity',
			{ params: AgentIdParam, query: ListAgentActivityQuery },
			({ params, query, inWorkspace }) =>
				inWorkspace((tx, actor) =>
					listAgentActivity(tx, actor, params.id, {
						...(query.limit !== undefined ? { limit: query.limit } : {}),
						...(query.cursor !== undefined ? { cursor: query.cursor } : {})
					})
				)
		)
		.post('/agents/activity/:undoId/undo', { params: UndoIdParam }, ({ params, inWorkspace }) =>
			inWorkspace((_, actor) => undoAgentAction(sql, actor, params.undoId))
		)

	const approvals = new Elysia({ name: 'huriro.approvals' })
		.derive(workspaceDerive(sql, auth))
		.get('/approvals', { query: ListApprovalsQuery }, ({ query, inWorkspace }) =>
			inWorkspace((tx, actor) =>
				listWorkspaceApprovals(tx, actor, {
					...(query.status !== undefined ? { status: query.status } : {}),
					...(query.limit !== undefined ? { limit: query.limit } : {}),
					...(query.cursor !== undefined ? { cursor: query.cursor } : {})
				})
			)
		)
		.get('/approvals/:id', { params: ApprovalIdParam }, async ({ params, inWorkspace }) => ({
			data: await inWorkspace((tx, actor) => getWorkspaceApproval(tx, actor, params.id))
		}))
		.post(
			'/approvals/:id/decide',
			{ params: ApprovalIdParam, body: DecideApprovalBody },
			({ params, body, inWorkspace }) =>
				inWorkspace(async (_tx, actor) => ({
					data: await decideApproval(sql, actor, params.id, body, {
						baseUrl: opts.baseUrl,
						hasCollabBridge: Boolean(opts.collabBridge)
					})
				}))
		)

	// Bearer-only surface — verifyAgentBearer is the ONLY credential accepted.
	const agent = new Elysia({ name: 'huriro.agent' }).get(
		'/agent/tools',
		{
			detail: {
				tags: ['agent'],
				summary: 'Tool manifest (registry-generated)',
				description: 'Requires an OAuth bearer token bound to the /api/v1/agent audience.'
			}
		},
		async ({ request }) => {
			if (!auth) throw new HttpError(501, 'not_implemented', 'Auth not configured')
			await verifyRestAgentCredential(sql, auth, request)
			return { data: toolManifest() }
		}
	)

	for (const tool of TOOLS.values()) {
		agent.post(
			`/agent/tools/${tool.name}`,
			{
				headers: AgentHeaders,
				body: tool.input,
				detail: {
					tags: ['agent'],
					operationId: operationId(tool.name),
					summary: tool.title,
					description:
						tool.description +
						'\n\nAuth: OAuth bearer (audience /api/v1/agent). Headers: X-Workspace-Id (required), Idempotency-Key (optional for writes).'
				},
				response: {
					200: Type.Union([ToolResultSchema, ApprovalRequiredSchema, NeedsConfirmationSchema]),
					400: Type.Unknown(),
					401: Type.Unknown(),
					403: Type.Unknown(),
					404: Type.Unknown(),
					422: Type.Unknown(),
					429: Type.Unknown()
				}
			},
			async (ctx) => {
				if (!auth) throw new HttpError(501, 'not_implemented', 'Auth not configured')
				const credential = await verifyRestAgentCredential(sql, auth, ctx.request)
				const headers = ctx.headers as { 'x-workspace-id': string; 'idempotency-key'?: string }
				const body: unknown = ctx.body
				const requestId = (ctx.store as { requestId?: string } | undefined)?.requestId
				const workspaceId = headers['x-workspace-id']
				// invokeTool owns the withWorkspace + withIdempotency boundary so
				// REST and MCP share it; denials are audited in a second tx (§13.3).
				const result = await invokeTool({
					sql,
					credential,
					workspaceId,
					toolName: tool.name,
					rawInput: body,
					transport: 'rest',
					idempotencyKey: headers['idempotency-key'],
					...(requestId ? { requestId } : {}),
					deps: { hasCollabBridge: Boolean(opts.collabBridge) },
					baseUrl: opts.baseUrl
				})
				return shapeResult(result)
			}
		)
	}

	// Workspace discovery for CLI/device clients: lists the caller's active
	// memberships (same memberships-policy path as resolveMcpWorkspace) so a
	// token can pick its X-Workspace-Id without a session.
	agent.get('/agent/workspaces', async ({ request }) => {
		if (!auth) throw new HttpError(501, 'not_implemented', 'Auth not configured')
		const credential = await verifyRestAgentCredential(sql, auth, request)
		const rows = await sql.begin(async (tx) => {
			await tx`SELECT set_config('app.user_id', ${credential.userId}, true)`
			return tx<{ id: string; slug: string; name: string }[]>`
				SELECT w.id, w.slug, w.name
				FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
				WHERE m.user_id = ${credential.userId} AND m.status = 'active'
				ORDER BY m.joined_at DESC
			`
		})
		return { data: rows }
	})

	// `.md` representations over the same dispatcher — scoped + audited (§13.1b).
	// The suffix rides inside the param (Elysia has no param-suffix segments);
	// a non-`.md` hit gets 404 rather than a parallel JSON API.
	for (const [path, toolName, inputKey] of [
		['/agent/issues/:identifier', 'tasks.get', 'issue'],
		['/agent/docs/:idOrSlug', 'docs.get', 'page']
	] as const) {
		agent.get(
			path,
			{
				headers: AgentHeaders,
				detail: {
					tags: ['agent'],
					summary: `${toolName} as Markdown`,
					description: 'Returns text/markdown for `<id>.md` requests; 404 otherwise.'
				}
			},
			async (ctx) => {
				if (!auth) throw new HttpError(501, 'not_implemented', 'Auth not configured')
				const credential = await verifyRestAgentCredential(sql, auth, ctx.request)
				const headers = ctx.headers as { 'x-workspace-id': string }
				const raw = ctx.params as Record<string, string>
				const param = raw['identifier'] ?? raw['idOrSlug'] ?? ''
				const { id, markdown } = splitMdParam(param)
				if (!markdown) throw new HttpError(404, 'not_found', 'Not found')
				const result = await invokeTool({
					sql,
					credential,
					workspaceId: headers['x-workspace-id'],
					toolName,
					rawInput: { [inputKey]: id },
					transport: 'rest',
					deps: { hasCollabBridge: Boolean(opts.collabBridge) },
					baseUrl: opts.baseUrl
				})
				if (result.status !== 'ok') throw new HttpError(500, 'internal', 'Tool call failed')
				return markdownResponse(result.markdown)
			}
		)
	}

	return new Elysia({ name: 'huriro.agents.root' })
		.use(human)
		.use(approvals)
		.use(agent)
		.use(apiKeyRoutes(sql, auth))
		.use(consentRoutes(sql, auth))
}

function shapeResult(result: InvokeResult): ToolResult | InvokeResult {
	if (result.status !== 'ok') return result
	return {
		data: result.data,
		markdown: result.markdown,
		trust: result.trust,
		nextCursor: result.nextCursor ?? null,
		...(result.undoId ? { undoId: result.undoId } : {})
	}
}
