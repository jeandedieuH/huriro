/**
 * Agents module data access. Every query runs inside a tenant transaction —
 * callers (dispatch/service/routes) are always inside `withWorkspace`, so RLS
 * is the backstop and workspace_id predicates are belt-and-braces (§12.4).
 */

import type { AgentApprovalDto, AgentToolCallDto } from '@huriro/contracts'
import type { Queryable } from '@huriro/db'
import type { ActorContext } from '@huriro/domain'
import { HttpError } from '../../api/error'
import { resolveActor } from '../tenancy'

export interface AgentPrincipalRow {
	readonly id: string
	readonly workspaceId: string
	readonly kind: 'external_mcp' | 'builtin_assistant' | 'automation'
	readonly name: string
	readonly ownerUserId: string
	readonly oauthClientId: string | null
	readonly scopeCeiling: string[]
	readonly tierOverrides: Record<string, string>
	readonly requireApprovalAllWrites: boolean
	readonly status: 'active' | 'suspended' | 'revoked'
	readonly lastActiveAt: Date | null
	readonly createdAt: Date
}

export async function getPrincipalByClient(
	tx: Queryable,
	workspaceId: string,
	ownerUserId: string,
	clientId: string
): Promise<AgentPrincipalRow | null> {
	const rows = await tx<AgentPrincipalRow[]>`
		SELECT id, workspace_id AS "workspaceId", kind, name,
			owner_user_id AS "ownerUserId", oauth_client_id AS "oauthClientId",
			scope_ceiling AS "scopeCeiling", tier_overrides AS "tierOverrides",
			require_approval_all_writes AS "requireApprovalAllWrites",
			status, last_active_at AS "lastActiveAt", created_at AS "createdAt"
		FROM agent_principals
		WHERE workspace_id = ${workspaceId}
			AND owner_user_id = ${ownerUserId}
			AND oauth_client_id = ${clientId}
	`
	return rows[0] ?? null
}

export async function getPrincipalById(
	tx: Queryable,
	workspaceId: string,
	id: string
): Promise<AgentPrincipalRow | null> {
	const rows = await tx<AgentPrincipalRow[]>`
		SELECT id, workspace_id AS "workspaceId", kind, name,
			owner_user_id AS "ownerUserId", oauth_client_id AS "oauthClientId",
			scope_ceiling AS "scopeCeiling", tier_overrides AS "tierOverrides",
			require_approval_all_writes AS "requireApprovalAllWrites",
			status, last_active_at AS "lastActiveAt", created_at AS "createdAt"
		FROM agent_principals
		WHERE workspace_id = ${workspaceId} AND id = ${id}
	`
	return rows[0] ?? null
}

export async function listPrincipals(
	tx: Queryable,
	workspaceId: string,
	opts?: { readonly ownerUserId?: string }
): Promise<AgentPrincipalRow[]> {
	return tx<AgentPrincipalRow[]>`
		SELECT id, workspace_id AS "workspaceId", kind, name,
			owner_user_id AS "ownerUserId", oauth_client_id AS "oauthClientId",
			scope_ceiling AS "scopeCeiling", tier_overrides AS "tierOverrides",
			require_approval_all_writes AS "requireApprovalAllWrites",
			status, last_active_at AS "lastActiveAt", created_at AS "createdAt"
		FROM agent_principals
		WHERE workspace_id = ${workspaceId}
			${opts?.ownerUserId ? tx`AND owner_user_id = ${opts.ownerUserId}` : tx``}
		ORDER BY created_at DESC
	`
}

export async function findActiveAutomationPrincipalByName(
	tx: Queryable,
	workspaceId: string,
	ownerUserId: string,
	name: string
): Promise<AgentPrincipalRow | null> {
	const rows = await tx<AgentPrincipalRow[]>`
		SELECT id, workspace_id AS "workspaceId", kind, name,
			owner_user_id AS "ownerUserId", oauth_client_id AS "oauthClientId",
			scope_ceiling AS "scopeCeiling", tier_overrides AS "tierOverrides",
			require_approval_all_writes AS "requireApprovalAllWrites",
			status, last_active_at AS "lastActiveAt", created_at AS "createdAt"
		FROM agent_principals
		WHERE workspace_id = ${workspaceId}
			AND owner_user_id = ${ownerUserId}
			AND kind = 'automation'
			AND name = ${name}
			AND status = 'active'
	`
	return rows[0] ?? null
}

export async function insertPrincipal(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly ownerUserId: string
		readonly oauthClientId: string | null
		readonly kind: 'external_mcp' | 'builtin_assistant' | 'automation'
		readonly name: string
		readonly scopeCeiling: readonly string[]
	}
): Promise<AgentPrincipalRow> {
	const rows = await tx<AgentPrincipalRow[]>`
		INSERT INTO agent_principals (workspace_id, owner_user_id, oauth_client_id, kind, name, scope_ceiling)
		VALUES (${args.workspaceId}, ${args.ownerUserId}, ${args.oauthClientId}, ${args.kind}, ${args.name}, ${args.scopeCeiling as string[]})
		ON CONFLICT (workspace_id, owner_user_id, oauth_client_id) WHERE oauth_client_id IS NOT NULL
		DO UPDATE SET name = EXCLUDED.name
		RETURNING id, workspace_id AS "workspaceId", kind, name,
			owner_user_id AS "ownerUserId", oauth_client_id AS "oauthClientId",
			scope_ceiling AS "scopeCeiling", tier_overrides AS "tierOverrides",
			require_approval_all_writes AS "requireApprovalAllWrites",
			status, last_active_at AS "lastActiveAt", created_at AS "createdAt"
	`
	const row = rows[0]
	if (!row) throw new HttpError(500, 'internal', 'Failed to create agent principal')
	return row
}

export async function updatePrincipal(
	tx: Queryable,
	workspaceId: string,
	id: string,
	patch: {
		readonly name?: string | undefined
		readonly status?: 'active' | 'suspended' | 'revoked' | undefined
		readonly tierOverrides?: Record<string, string> | undefined
		readonly requireApprovalAllWrites?: boolean | undefined
	}
): Promise<AgentPrincipalRow | null> {
	const rows = await tx<AgentPrincipalRow[]>`
		UPDATE agent_principals SET
			name = COALESCE(${patch.name ?? null}, name),
			status = COALESCE(${patch.status ?? null}, status),
			tier_overrides = COALESCE(${patch.tierOverrides ? tx.json(patch.tierOverrides as never) : null}, tier_overrides),
			require_approval_all_writes = COALESCE(${patch.requireApprovalAllWrites ?? null}, require_approval_all_writes)
		WHERE workspace_id = ${workspaceId} AND id = ${id}
		RETURNING id, workspace_id AS "workspaceId", kind, name,
			owner_user_id AS "ownerUserId", oauth_client_id AS "oauthClientId",
			scope_ceiling AS "scopeCeiling", tier_overrides AS "tierOverrides",
			require_approval_all_writes AS "requireApprovalAllWrites",
			status, last_active_at AS "lastActiveAt", created_at AS "createdAt"
	`
	return rows[0] ?? null
}

/** Throttled last_active_at — at most one write per principal per minute. */
export async function touchLastActive(
	tx: Queryable,
	workspaceId: string,
	principalId: string
): Promise<void> {
	await tx`
		UPDATE agent_principals SET last_active_at = now()
		WHERE workspace_id = ${workspaceId} AND id = ${principalId}
			AND (last_active_at IS NULL OR last_active_at < now() - interval '1 minute')
	`
}

/** Owner's actor resolved fresh — powers the agent's live permission lookup. */
export async function resolveOwnerActor(
	tx: Queryable,
	workspaceId: string,
	ownerUserId: string,
	requestId?: string
): Promise<ActorContext> {
	return resolveActor(tx, { workspaceId, userId: ownerUserId, requestId })
}

// ---------- agent_tool_calls (append-only — no UPDATE/DELETE anywhere) ----------

export async function insertToolCall(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly agentId: string
		readonly ownerUserId: string
		readonly oauthClientId: string | null
		readonly tokenId: string | null
		readonly tool: string
		readonly argsHash: string
		readonly requestedScopes: readonly string[]
		readonly effectiveScopes: readonly string[]
		readonly requestedTier: string
		readonly effectiveTier: string
		readonly status: string
		readonly errorCode?: string | null
		readonly durationMs: number
		readonly approvalId?: string | null
		readonly requestId?: string | null
	}
): Promise<string> {
	const rows = await tx<{ id: string }[]>`
		INSERT INTO agent_tool_calls (
			workspace_id, agent_id, owner_user_id, oauth_client_id, token_id,
			tool, args_hash, requested_scopes, effective_scopes,
			requested_tier, effective_tier, status, error_code, duration_ms,
			approval_id, request_id
		) VALUES (
			${args.workspaceId}, ${args.agentId}, ${args.ownerUserId},
			${args.oauthClientId}, ${args.tokenId}, ${args.tool}, ${args.argsHash},
			${args.requestedScopes as string[]}, ${args.effectiveScopes as string[]},
			${args.requestedTier}, ${args.effectiveTier}, ${args.status},
			${args.errorCode ?? null}, ${args.durationMs},
			${args.approvalId ?? null}, ${args.requestId ?? null}
		) RETURNING id
	`
	return rows[0]?.id ?? ''
}

export async function listToolCalls(
	tx: Queryable,
	workspaceId: string,
	agentId: string,
	limit: number,
	cursor?: { createdAt: Date; id: string }
): Promise<AgentToolCallDto[]> {
	return tx<AgentToolCallDto[]>`
		SELECT id, tool, effective_tier AS tier, status, error_code AS "errorCode",
			approval_id AS "approvalId", duration_ms AS "durationMs",
			to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
		FROM agent_tool_calls
		WHERE workspace_id = ${workspaceId} AND agent_id = ${agentId}
			${cursor ? tx`AND (created_at, id) < (${cursor.createdAt}, ${cursor.id})` : tx``}
		ORDER BY created_at DESC, id DESC
		LIMIT ${limit}
	`
}

// ---------- agent_approvals ----------

export async function insertApproval(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly agentId: string
		readonly ownerUserId: string
		readonly tool: string
		readonly args: unknown
		readonly argsHash: string
		readonly previewMd: string
		readonly tier: string
		readonly requestId?: string | null | undefined
		readonly tokenId?: string | null | undefined
		readonly tokenScopes?: readonly string[] | undefined
		readonly idempotencyKey?: string | null | undefined
	}
): Promise<{ id: string; expiresAt: Date }> {
	const rows = await tx<{ id: string; expiresAt: Date }[]>`
		INSERT INTO agent_approvals (
			workspace_id, agent_id, owner_user_id, tool, args, args_hash,
			preview_md, tier, request_id, token_id, token_scopes, idempotency_key
		) VALUES (
			${args.workspaceId}, ${args.agentId}, ${args.ownerUserId}, ${args.tool},
			${tx.json(args.args as never)}, ${args.argsHash}, ${args.previewMd},
			${args.tier}, ${args.requestId ?? null}, ${args.tokenId ?? null},
			${(args.tokenScopes ?? []) as string[]}, ${args.idempotencyKey ?? null}
		) RETURNING id, expires_at AS "expiresAt"
	`
	const row = rows[0]
	if (!row) throw new HttpError(500, 'internal', 'Failed to create approval')
	return row
}

export async function getApproval(
	tx: Queryable,
	workspaceId: string,
	id: string
): Promise<{
	readonly id: string
	readonly workspaceId: string
	readonly agentId: string
	readonly ownerUserId: string
	readonly tool: string
	readonly args: unknown
	readonly argsHash: string
	readonly previewMd: string
	readonly tier: string
	readonly status: string
	readonly decidedBy: string | null
	readonly decidedAt: Date | null
	readonly decisionReason: string | null
	readonly expiresAt: Date
	readonly result: unknown
	readonly errorCode: string | null
	readonly requestId: string | null
	readonly tokenId: string | null
	readonly tokenScopes: string[]
	readonly createdAt: Date
} | null> {
	const rows = await tx`
		SELECT id, workspace_id AS "workspaceId", agent_id AS "agentId",
			owner_user_id AS "ownerUserId", tool, args, args_hash AS "argsHash",
			preview_md AS "previewMd", tier, status,
			decided_by AS "decidedBy", decided_at AS "decidedAt",
			decision_reason AS "decisionReason", expires_at AS "expiresAt",
			result, error_code AS "errorCode", request_id AS "requestId",
			token_id AS "tokenId", token_scopes AS "tokenScopes", created_at AS "createdAt"
		FROM agent_approvals
		WHERE workspace_id = ${workspaceId} AND id = ${id}
	`
	return (rows[0] as never) ?? null
}

export async function listApprovals(
	tx: Queryable,
	workspaceId: string,
	opts: {
		readonly status?: string | undefined
		readonly limit: number
		readonly cursor?: { createdAt: Date; id: string } | undefined
	}
): Promise<AgentApprovalDto[]> {
	return tx<AgentApprovalDto[]>`
		SELECT a.id, a.workspace_id AS "workspaceId", a.agent_id AS "agentId",
			p.name AS "agentName", a.owner_user_id AS "ownerUserId", a.tool,
			a.args_hash AS "argsHash", a.preview_md AS "previewMd", a.tier, a.status,
			a.decided_by AS "decidedBy",
			to_char(a.decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "decidedAt",
			a.decision_reason AS "decisionReason",
			to_char(a.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "expiresAt",
			a.error_code AS "errorCode", a.token_scopes AS "tokenScopes",
			to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
		FROM agent_approvals a
		JOIN agent_principals p ON p.workspace_id = a.workspace_id AND p.id = a.agent_id
		WHERE a.workspace_id = ${workspaceId}
			${opts.status ? tx`AND a.status = ${opts.status}` : tx``}
			${opts.cursor ? tx`AND (a.created_at, a.id) < (${opts.cursor.createdAt}, ${opts.cursor.id})` : tx``}
		ORDER BY a.created_at DESC, a.id DESC
		LIMIT ${opts.limit}
	`
}

/** Atomic pending→executing compare-and-set; returns false when not pending. */
export async function claimApprovalForExecution(
	tx: Queryable,
	workspaceId: string,
	id: string,
	decidedBy: string,
	reason: string | null
): Promise<boolean> {
	const rows = await tx<{ id: string }[]>`
		UPDATE agent_approvals
		SET status = 'executing', decided_by = ${decidedBy}, decided_at = now(),
			decision_reason = ${reason}
		WHERE workspace_id = ${workspaceId} AND id = ${id}
			AND status = 'pending' AND expires_at > now()
		RETURNING id
	`
	return rows.length > 0
}

export async function denyApproval(
	tx: Queryable,
	workspaceId: string,
	id: string,
	decidedBy: string,
	reason: string | null
): Promise<boolean> {
	const rows = await tx<{ id: string }[]>`
		UPDATE agent_approvals
		SET status = 'denied', decided_by = ${decidedBy}, decided_at = now(),
			decision_reason = ${reason}
		WHERE workspace_id = ${workspaceId} AND id = ${id} AND status = 'pending'
		RETURNING id
	`
	return rows.length > 0
}

export async function finishApprovalExecution(
	tx: Queryable,
	workspaceId: string,
	id: string,
	outcome: { readonly ok: boolean; readonly result?: unknown; readonly errorCode?: string }
): Promise<void> {
	await tx`
		UPDATE agent_approvals
		SET status = ${outcome.ok ? 'executed' : 'failed'},
			result = ${outcome.result !== undefined ? tx.json(outcome.result as never) : null},
			error_code = ${outcome.errorCode ?? null}
		WHERE workspace_id = ${workspaceId} AND id = ${id} AND status = 'executing'
	`
}

export async function expireApprovals(tx: Queryable): Promise<number> {
	const rows = await tx<{ id: string }[]>`
		UPDATE agent_approvals SET status = 'expired'
		WHERE status = 'pending' AND expires_at <= now()
		RETURNING id
	`
	return rows.length
}

// ---------- agent_status_reports ----------

export async function insertStatusReport(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly issueId: string
		readonly agentId: string
		readonly state: 'working' | 'needs_input' | 'done' | 'failed'
		readonly message: string
		readonly links: readonly string[]
	}
): Promise<string> {
	const rows = await tx<{ id: string }[]>`
		INSERT INTO agent_status_reports (workspace_id, issue_id, agent_id, state, message, links)
		VALUES (${args.workspaceId}, ${args.issueId}, ${args.agentId}, ${args.state}, ${args.message}, ${tx.json(args.links as never)})
		RETURNING id
	`
	return rows[0]?.id ?? ''
}

// ---------- agent_undo_log ----------

export async function insertUndoEntry(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly agentId: string
		readonly toolCallId: string
		readonly tool: string
		readonly entityType: string
		readonly entityId: string
		readonly before: unknown
	}
): Promise<string> {
	const rows = await tx<{ id: string }[]>`
		INSERT INTO agent_undo_log (workspace_id, agent_id, tool_call_id, tool, entity_type, entity_id, before)
		VALUES (${args.workspaceId}, ${args.agentId}, ${args.toolCallId}, ${args.tool}, ${args.entityType}, ${args.entityId},
			${args.before !== undefined ? tx.json(args.before as never) : null})
		RETURNING id
	`
	return rows[0]?.id ?? ''
}

export async function getUndoEntry(
	tx: Queryable,
	workspaceId: string,
	id: string
): Promise<{
	readonly id: string
	readonly agentId: string
	readonly toolCallId: string
	readonly tool: string
	readonly entityType: string
	readonly entityId: string
	readonly before: unknown
	readonly expiresAt: Date
	readonly undoneAt: Date | null
} | null> {
	const rows = await tx`
		SELECT id, agent_id AS "agentId", tool_call_id AS "toolCallId", tool,
			entity_type AS "entityType", entity_id AS "entityId", before,
			expires_at AS "expiresAt", undone_at AS "undoneAt"
		FROM agent_undo_log
		WHERE workspace_id = ${workspaceId} AND id = ${id}
	`
	return (rows[0] as never) ?? null
}

/** One-shot claim — second call returns false (replay-safe undo token). */
export async function claimUndoEntry(
	tx: Queryable,
	workspaceId: string,
	id: string,
	undoneBy: string
): Promise<boolean> {
	const rows = await tx<{ id: string }[]>`
		UPDATE agent_undo_log SET undone_at = now(), undone_by = ${undoneBy}
		WHERE workspace_id = ${workspaceId} AND id = ${id}
			AND undone_at IS NULL AND expires_at > now()
		RETURNING id
	`
	return rows.length > 0
}
