/**
 * Agents module orchestration: principal CRUD (human, session auth),
 * approval decision + execution, undo, activity feed.
 *
 * Approval execution re-resolves the AGENT principal and runs the STORED
 * args as the agent — never as the deciding human (§13.5, confused-deputy).
 */

import { getTool } from '@huriro/agent-tools'
import type {
	AgentApprovalDto,
	AgentPrincipalDto,
	CreateAgentBody,
	DecideApprovalBody,
	UpdateAgentBody
} from '@huriro/contracts'
import { decodeCursor, encodeCursor } from '@huriro/contracts'
import type { Sql } from '@huriro/db'
import { type Queryable, withWorkspace } from '@huriro/db'
import type { Action, ActorContext } from '@huriro/domain'
import { isAgentScope } from '@huriro/domain'
import { Value } from 'typebox/value'
import { HttpError } from '../../api/error'
import { deleteDocPage, prepareRestoreDocVersion } from '../docs'
import { deleteIssue, deleteIssueComment, updateIssue } from '../tasks'
import { argsHashOf } from './dispatch'
import { MAX_RESULT_BYTES, truncateBytes } from './markdown'
import { assertRaiseOnlyTierOverrides } from './policy'
import { resolveAgentActor } from './principal'
import type { AgentPrincipalRow } from './repo'
import {
	claimApprovalForExecution,
	claimUndoEntry,
	denyApproval,
	expireApprovals,
	finishApprovalExecution,
	getApproval,
	getPrincipalById,
	getUndoEntry,
	insertPrincipal,
	insertToolCall,
	listApprovals,
	listPrincipals,
	listToolCalls,
	updatePrincipal
} from './repo'
import { getToolHandler } from './tool-handlers'

function toDto(p: {
	id: string
	workspaceId: string
	kind: string
	name: string
	ownerUserId: string
	oauthClientId: string | null
	scopeCeiling: string[]
	tierOverrides: Record<string, string>
	requireApprovalAllWrites: boolean
	status: string
	lastActiveAt: Date | null
	createdAt: Date
}): AgentPrincipalDto {
	return {
		id: p.id,
		workspaceId: p.workspaceId,
		kind: p.kind as AgentPrincipalDto['kind'],
		name: p.name,
		ownerUserId: p.ownerUserId,
		oauthClientId: p.oauthClientId,
		scopeCeiling: p.scopeCeiling,
		tierOverrides: p.tierOverrides,
		requireApprovalAllWrites: p.requireApprovalAllWrites,
		status: p.status as AgentPrincipalDto['status'],
		lastActiveAt: p.lastActiveAt?.toISOString() ?? null,
		createdAt: p.createdAt.toISOString()
	}
}

export async function listAgents(tx: Queryable, actor: ActorContext): Promise<AgentPrincipalDto[]> {
	requirePerm(actor, 'agent.manage')
	return (await listPrincipals(tx, actor.workspaceId)).map(toDto)
}

export async function getAgent(tx: Queryable, actor: ActorContext, id: string): Promise<AgentPrincipalDto> {
	requirePerm(actor, 'agent.manage')
	const p = await getPrincipalById(tx, actor.workspaceId, id)
	if (!p) throw new HttpError(404, 'not_found', 'Agent not found')
	return toDto(p)
}

export async function createAgent(
	tx: Queryable,
	actor: ActorContext,
	body: CreateAgentBody
): Promise<AgentPrincipalDto> {
	requirePerm(actor, 'agent.manage')
	const ownerUserId = body.ownerUserId ?? actor.userId
	const ceiling = body.scopes.filter(isAgentScope)
	const p = await insertPrincipal(tx, {
		workspaceId: actor.workspaceId,
		ownerUserId,
		oauthClientId: null,
		kind: body.kind,
		name: body.name,
		scopeCeiling: ceiling
	})
	return toDto(p)
}

/** Consent-screen seam (stage 3): upsert an OAuth-client principal for an owner. */
export async function connectAgent(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly ownerUserId: string
		readonly clientId: string
		readonly name: string
		readonly scopes: readonly string[]
	}
): Promise<AgentPrincipalDto> {
	const ceiling = args.scopes.filter(isAgentScope)
	const p = await insertPrincipal(tx, {
		workspaceId: args.workspaceId,
		ownerUserId: args.ownerUserId,
		oauthClientId: args.clientId,
		kind: 'external_mcp',
		name: args.name,
		scopeCeiling: ceiling
	})
	return toDto(p)
}

export async function updateAgent(
	tx: Queryable,
	actor: ActorContext,
	id: string,
	body: UpdateAgentBody
): Promise<AgentPrincipalDto> {
	requirePerm(actor, 'agent.manage')
	const existing = await getPrincipalById(tx, actor.workspaceId, id)
	if (!existing) throw new HttpError(404, 'not_found', 'Agent not found')
	if (existing.status === 'revoked') {
		throw new HttpError(409, 'conflict', 'A revoked agent cannot be modified')
	}
	if (body.tierOverrides) {
		assertRaiseOnlyTierOverrides(body.tierOverrides, (name) => getTool(name)?.tier)
	}
	const p = await updatePrincipal(tx, actor.workspaceId, id, {
		name: body.name,
		status: body.status,
		tierOverrides: body.tierOverrides ? { ...existing.tierOverrides, ...body.tierOverrides } : undefined,
		requireApprovalAllWrites: body.requireApprovalAllWrites
	})
	if (!p) throw new HttpError(404, 'not_found', 'Agent not found')
	return toDto(p)
}

export async function revokeAgent(
	tx: Queryable,
	actor: ActorContext,
	id: string
): Promise<AgentPrincipalDto> {
	requirePerm(actor, 'agent.manage')
	const p = await updatePrincipal(tx, actor.workspaceId, id, { status: 'revoked' })
	if (!p) throw new HttpError(404, 'not_found', 'Agent not found')
	// OAuth grant revocation (consent + refresh tokens) is handled by the
	// identity seam — wired in stage 3 when the consent screen lands.
	return toDto(p)
}

// ---------- activity ----------

export async function listAgentActivity(
	tx: Queryable,
	actor: ActorContext,
	agentId: string,
	query: { limit?: number; cursor?: string }
): Promise<{ data: unknown[]; nextCursor: string | null; hasMore: boolean }> {
	requirePerm(actor, 'agent.manage')
	const p = await getPrincipalById(tx, actor.workspaceId, agentId)
	if (!p) throw new HttpError(404, 'not_found', 'Agent not found')
	const limit = query.limit ?? 50
	const cursor = decodeCursor<{ createdAt: string; id: string }>(query.cursor)
	const calls = await listToolCalls(
		tx,
		actor.workspaceId,
		agentId,
		limit + 1,
		cursor ? { createdAt: new Date(cursor.createdAt), id: cursor.id } : undefined
	)
	const reports = await tx<{ id: string; state: string; message: string; createdAt: string }[]>`
		SELECT id, state, message,
			to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
		FROM agent_status_reports
		WHERE workspace_id = ${actor.workspaceId} AND agent_id = ${agentId}
		ORDER BY created_at DESC LIMIT ${limit}
	`
	const undos = await tx<
		{ id: string; tool: string; entityId: string; undoneAt: string; createdAt: string }[]
	>`
		SELECT id, tool, entity_id AS "entityId",
			to_char(undone_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "undoneAt",
			to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
		FROM agent_undo_log
		WHERE workspace_id = ${actor.workspaceId} AND agent_id = ${agentId}
		ORDER BY created_at DESC LIMIT ${limit}
	`

	const items = [
		...calls.map((c) => ({
			kind: 'tool_call' as const,
			id: c.id,
			createdAt: c.createdAt,
			summary: `${c.tool} → ${c.status}`,
			detail: {
				tool: c.tool,
				status: c.status,
				errorCode: c.errorCode,
				approvalId: c.approvalId,
				durationMs: c.durationMs
			}
		})),
		...reports.map((r) => ({
			kind: 'status_report' as const,
			id: r.id,
			createdAt: r.createdAt,
			summary: `status:${r.state}`,
			detail: { state: r.state }
		})),
		...undos.map((u) => ({
			kind: 'undo' as const,
			id: u.id,
			createdAt: u.createdAt,
			summary: `undo of ${u.tool}${u.undoneAt ? ' (used)' : ''}`,
			detail: { tool: u.tool, entityId: u.entityId, used: Boolean(u.undoneAt) }
		}))
	]
		.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
		.slice(0, limit)

	const last = items.at(-1)
	const nextCursor =
		items.length === limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null
	return { data: items, nextCursor, hasMore: nextCursor !== null }
}

// ---------- approvals ----------

function requirePerm(actor: ActorContext, action: 'agent.manage' | 'approval.decide'): void {
	if (actor.membership !== 'active') {
		throw new HttpError(403, 'not_workspace_member', 'Active membership required')
	}
	if (!actor.permissions.has(action)) {
		throw new HttpError(403, 'insufficient_role', `Missing ${action} permission`)
	}
}

export async function listWorkspaceApprovals(
	tx: Queryable,
	actor: ActorContext,
	query: { status?: string; limit?: number; cursor?: string }
): Promise<{ data: AgentApprovalDto[]; nextCursor: string | null; hasMore: boolean }> {
	requirePerm(actor, 'approval.decide')
	const limit = query.limit ?? 50
	const cursor = decodeCursor<{ createdAt: string; id: string }>(query.cursor)
	const rows = await listApprovals(tx, actor.workspaceId, {
		status: query.status,
		limit: limit + 1,
		...(cursor ? { cursor: { createdAt: new Date(cursor.createdAt), id: cursor.id } } : {})
	})
	const hasMore = rows.length > limit
	const data = hasMore ? rows.slice(0, limit) : rows
	const last = data.at(-1)
	return {
		data,
		nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
		hasMore
	}
}

export async function getWorkspaceApproval(
	tx: Queryable,
	actor: ActorContext,
	id: string
): Promise<AgentApprovalDto> {
	requirePerm(actor, 'approval.decide')
	const a = await getApproval(tx, actor.workspaceId, id)
	if (!a) throw new HttpError(404, 'not_found', 'Approval not found')
	return {
		id: a.id,
		workspaceId: a.workspaceId,
		agentId: a.agentId,
		agentName: '',
		ownerUserId: a.ownerUserId,
		tool: a.tool,
		argsHash: a.argsHash,
		tokenScopes: a.tokenScopes,
		previewMd: a.previewMd,
		tier: a.tier,
		status: a.status as AgentApprovalDto['status'],
		decidedBy: a.decidedBy,
		decidedAt: a.decidedAt?.toISOString() ?? null,
		decisionReason: a.decisionReason,
		expiresAt: a.expiresAt.toISOString(),
		errorCode: a.errorCode,
		createdAt: a.createdAt.toISOString()
	}
}

export interface DecideResult {
	readonly status: string
	readonly executionResult?: unknown
}

/**
 * Human decision. Approve = atomic pending→executing CAS, then the STORED
 * args execute AS THE AGENT in a fresh tx that re-resolves principal status,
 * owner membership/role, and scopes at execution time (§13.5). Deny is a
 * pending→denied CAS. Both paths are idempotent: acting on a non-pending
 * row returns its current state (double-approve is a no-op).
 */
export async function decideApproval(
	sql: Sql,
	actor: ActorContext,
	approvalId: string,
	body: DecideApprovalBody,
	deps: { readonly baseUrl: string; readonly hasCollabBridge: boolean }
): Promise<DecideResult> {
	requirePerm(actor, 'approval.decide')

	if (body.decision === 'deny') {
		const denied = await withWorkspace(
			sql,
			{ workspaceId: actor.workspaceId, userId: actor.userId },
			async (tx) => {
				const ok = await denyApproval(tx, actor.workspaceId, approvalId, actor.userId, body.reason ?? null)
				if (!ok) {
					const a = await getApproval(tx, actor.workspaceId, approvalId)
					if (!a) throw new HttpError(404, 'not_found', 'Approval not found')
					return { status: a.status }
				}
				return { status: 'denied' }
			}
		)
		return denied
	}

	// approve — claim + execute
	const claimed = await withWorkspace(
		sql,
		{ workspaceId: actor.workspaceId, userId: actor.userId },
		async (tx) => {
			const a = await getApproval(tx, actor.workspaceId, approvalId)
			if (!a) throw new HttpError(404, 'not_found', 'Approval not found')
			if (a.status !== 'pending') {
				// Idempotent: already decided/executed → return current status.
				return { approval: a, claimedNow: false }
			}
			if (a.expiresAt <= new Date()) {
				await tx`UPDATE agent_approvals SET status = 'expired'
					WHERE workspace_id = ${actor.workspaceId} AND id = ${approvalId} AND status = 'pending'`
				throw new HttpError(409, 'approval_expired', 'Approval expired and cannot be approved')
			}
			const ok = await claimApprovalForExecution(
				tx,
				actor.workspaceId,
				approvalId,
				actor.userId,
				body.reason ?? null
			)
			return { approval: a, claimedNow: ok }
		}
	)

	if (!claimed.claimedNow) {
		return { status: claimed.approval.status }
	}

	// Execute the STORED validated args as the AGENT — fresh tx, live re-resolve.
	const a = claimed.approval
	const tool = getTool(a.tool)
	const outcome = await withWorkspace(
		sql,
		{ workspaceId: actor.workspaceId, userId: a.ownerUserId },
		async (tx) => {
			let resolved: Awaited<ReturnType<typeof resolveAgentActor>> | null = null
			let clientId = 'approval'
			try {
				if (!tool) throw new HttpError(404, 'tool_unknown', `Unknown tool ${a.tool}`)
				// Tamper check: stored args must hash to stored hash (§13.5).
				if (argsHashOf(a.args) !== a.argsHash) {
					throw new HttpError(409, 'conflict', 'Stored args failed integrity check')
				}
				if (!Value.Check(tool.input, a.args)) {
					throw new HttpError(422, 'validation_failed', 'Stored args no longer satisfy the tool schema')
				}
				const principal = await getPrincipalById(tx, actor.workspaceId, a.agentId)
				clientId = principal?.oauthClientId ?? 'approval'
				const credential: import('../identity').VerifiedAgentCredential = {
					userId: a.ownerUserId,
					clientId,
					// API-key principals have no OAuth client — resolve by id.
					principalId: a.agentId,
					// Execute with the SCOPES THE TOKEN HAD when the call was
					// parked — never wider. resolveAgentActor intersects with the
					// current ceiling, so a narrowed ceiling still wins.
					scopes: a.tokenScopes,
					tokenId: a.tokenId ?? undefined,
					audience: 'rest'
				}
				const agent = await resolveAgentActor(tx, credential, actor.workspaceId, a.requestId ?? undefined)
				resolved = agent
				const handler = getToolHandler(tool)
				// Savepoint: a mid-handler failure must roll back EVERY domain
				// write — the approval then lands 'failed', never half-applied.
				const result = await tx.begin(async (sp) => {
					const r = await handler(sp, agent, a.args, { hasCollabBridge: deps.hasCollabBridge })
					await insertToolCall(sp, {
						workspaceId: actor.workspaceId,
						agentId: agent.principal.id,
						ownerUserId: agent.actor.userId,
						oauthClientId: credential.clientId,
						tokenId: credential.tokenId ?? null,
						tool: tool.name,
						argsHash: a.argsHash,
						requestedScopes: credential.scopes,
						effectiveScopes: agent.effectiveScopes,
						requestedTier: a.tier,
						effectiveTier: a.tier,
						status: 'ok',
						errorCode: null,
						durationMs: 0,
						approvalId: a.id,
						requestId: a.requestId
					})
					return r
				})
				return {
					ok: true as const,
					result: { data: result.data, markdown: truncateBytes(result.markdown, MAX_RESULT_BYTES).text }
				}
			} catch (e) {
				const code = e instanceof HttpError ? e.code : 'internal'
				// Record the failed execution as a tool call — the savepoint
				// already rolled the handler's writes back, so this row is the
				// only trace (§13.3).
				if (resolved) {
					const r: Awaited<ReturnType<typeof resolveAgentActor>> = resolved
					await insertToolCall(tx, {
						workspaceId: actor.workspaceId,
						agentId: r.principal.id,
						ownerUserId: r.actor.userId,
						oauthClientId: clientId,
						tokenId: a.tokenId,
						tool: a.tool,
						argsHash: a.argsHash,
						requestedScopes: a.tokenScopes,
						effectiveScopes: r.effectiveScopes,
						requestedTier: a.tier,
						effectiveTier: a.tier,
						status: 'error',
						errorCode: code,
						durationMs: 0,
						approvalId: a.id,
						requestId: a.requestId
					})
				}
				return { ok: false as const, errorCode: code }
			}
		}
	)

	await withWorkspace(sql, { workspaceId: actor.workspaceId, userId: actor.userId }, (tx) =>
		finishApprovalExecution(
			tx,
			actor.workspaceId,
			approvalId,
			outcome.ok ? { ok: true, result: outcome.result } : { ok: false, errorCode: outcome.errorCode }
		)
	)
	return {
		status: outcome.ok ? 'executed' : 'failed',
		executionResult: outcome.ok ? outcome.result : outcome.errorCode
	}
}

// ---------- undo ----------

/** Human undo of an R1 write (§13.5): one-shot token, ≤7d, agent attribution. */
export async function undoAgentAction(
	sql: Sql,
	actor: ActorContext,
	undoId: string
): Promise<{ readonly undone: boolean }> {
	requirePerm(actor, 'agent.manage')
	return withWorkspace(sql, { workspaceId: actor.workspaceId, userId: actor.userId }, async (tx) => {
		const entry = await getUndoEntry(tx, actor.workspaceId, undoId)
		if (!entry) throw new HttpError(404, 'not_found', 'Undo token not found')
		if (entry.undoneAt) throw new HttpError(409, 'conflict', 'Undo token already used')
		if (entry.expiresAt <= new Date()) {
			throw new HttpError(409, 'conflict', 'Undo window expired')
		}

		// Execute the inverse AS THE ORIGINAL AGENT so attribution + ACLs match
		// the original call (§13.5).
		const principal = await getPrincipalById(tx, actor.workspaceId, entry.agentId)
		if (principal?.status !== 'active') {
			throw new HttpError(403, 'agent_suspended', 'The owning agent is no longer active')
		}
		const credential: import('../identity').VerifiedAgentCredential = {
			userId: principal.ownerUserId,
			clientId: principal.oauthClientId ?? 'undo',
			// API-key principals have no OAuth client — resolve by id.
			principalId: principal.id,
			scopes: principal.scopeCeiling,
			tokenId: undefined,
			audience: 'rest'
		}
		const resolved = await resolveAgentActor(tx, credential, actor.workspaceId, undefined)

		// The inverse op (delete a created issue/comment, restore a doc version)
		// needs actions beyond the write scopes that produced it — the undo is
		// human-authorized via agent.manage, so widen ONLY this actor's ceiling.
		const undoActor: ActorContext = {
			...resolved.actor,
			agentScopeCeiling: new Set([
				...(resolved.actor.agentScopeCeiling ?? []),
				'issue.delete',
				'issue.write',
				'doc.write'
			] as Action[])
		}

		const claimed = await claimUndoEntry(tx, actor.workspaceId, undoId, actor.userId)
		if (!claimed) throw new HttpError(409, 'conflict', 'Undo token already used or expired')

		const before = (entry.before ?? {}) as Record<string, unknown>
		if (entry.entityType === 'issue' && entry.tool === 'tasks.create') {
			await deleteIssue(tx, undoActor, entry.entityId)
		} else if (entry.entityType === 'issue' && entry.tool === 'tasks.update') {
			await updateIssue(tx, undoActor, entry.entityId, {
				...(before['title'] !== undefined ? { title: before['title'] as string } : {}),
				...(before['descriptionText'] !== undefined
					? { descriptionText: before['descriptionText'] as string }
					: {}),
				...(before['statusId'] !== undefined ? { statusId: before['statusId'] as string } : {}),
				...(before['priority'] !== undefined ? { priority: before['priority'] as number } : {}),
				...(before['assigneeId'] !== undefined ? { assigneeId: before['assigneeId'] as string | null } : {}),
				...(before['assigneeType'] !== undefined
					? { assigneeType: before['assigneeType'] as 'user' | 'agent' | null }
					: {}),
				version: (before['version'] as number | undefined) ?? 1
			})
		} else if (entry.entityType === 'issue_comment') {
			const issueId = (before['issueId'] ?? undefined) as string | undefined
			if (!issueId) throw new HttpError(409, 'conflict', 'Undo entry lacks the parent issue')
			await deleteIssueComment(tx, undoActor, issueId, entry.entityId)
		} else if (entry.entityType === 'doc_page' && before['versionId']) {
			// append → restore pre-write version checkpoint (only if no later edits)
			await prepareRestoreDocVersion(
				tx,
				undoActor,
				entry.entityId,
				before['versionId'] as string,
				false,
				`agent undo ${undoId}`
			)
		} else if (entry.entityType === 'doc_page') {
			// create → archive/delete if untouched
			await deleteDocPage(tx, undoActor, entry.entityId)
		} else {
			throw new HttpError(422, 'validation_failed', `No undo path for ${entry.tool}`)
		}
		return { undone: true }
	})
}

/** Worker job: expire pending approvals past expires_at. */
export async function sweepExpiredApprovals(sql: Sql): Promise<number> {
	// System context: pending approvals across tenants — worker-safe.
	const { withSystem } = await import('@huriro/db')
	return withSystem(sql, (tx) => expireApprovals(tx))
}

/** Connected apps (§13.1b): the owner's own principals — any active member may see/revoke their own. */
export async function listConnectedApps(tx: Queryable, actor: ActorContext): Promise<AgentPrincipalRow[]> {
	if (actor.membership !== 'active') {
		throw new HttpError(403, 'not_workspace_member', 'Active membership required')
	}
	return (await listPrincipals(tx, actor.workspaceId, { ownerUserId: actor.userId })).filter(
		(p) => p.status !== 'revoked' && p.oauthClientId !== null
	)
}

/**
 * Owner-scoped revoke: only the principal's owner may disconnect the app
 * (any member, no agent.manage needed — it's their credential). Returns the
 * revoked row so the caller can tear down OAuth grants via the identity seam.
 */
export async function revokeConnectedApp(
	tx: Queryable,
	actor: ActorContext,
	agentId: string
): Promise<AgentPrincipalRow> {
	if (actor.membership !== 'active') {
		throw new HttpError(403, 'not_workspace_member', 'Active membership required')
	}
	const p = await getPrincipalById(tx, actor.workspaceId, agentId)
	if (!p || p.ownerUserId !== actor.userId) {
		throw new HttpError(404, 'not_found', 'Connected app not found')
	}
	const updated = await updatePrincipal(tx, actor.workspaceId, agentId, { status: 'revoked' })
	if (!updated) throw new HttpError(404, 'not_found', 'Connected app not found')
	return updated
}
