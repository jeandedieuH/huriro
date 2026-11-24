/**
 * Tool dispatcher (§13.4, §13.5) — the ONLY path that executes a tool.
 * Every surface (REST now, MCP in stage 3) goes through `invokeTool`:
 *
 *   validate input → scope check → tier math → R3 refuse → rate limit →
 *   R2 ⇒ approval_required (no write) → R1 needs_confirmation (MCP only) →
 *   execute handler in the caller's tenant tx → record agent_tool_calls.
 *
 * Denials and errors are also audited — the caller runs `invokeTool` inside
 * its own `withWorkspace` tx and denials are flushed in a short second tx so
 * a rolled-back main tx still leaves an audit row (§13.3).
 */

import { createHash } from 'node:crypto'
import type { ToolSpec } from '@huriro/agent-tools'
import { getTool } from '@huriro/agent-tools'
import type { Queryable, Sql } from '@huriro/db'
import { withWorkspace } from '@huriro/db'
import { isAgentExecutable, isAgentScope } from '@huriro/domain'
import { Value } from 'typebox/value'
import { withIdempotency } from '../../api/context'
import { HttpError } from '../../api/error'
import type { VerifiedAgentCredential } from '../identity'
import { AGENTS_EVENTS, emitAgentsEvent } from './events'
import { MAX_RESULT_BYTES, truncateBytes, trustForTool } from './markdown'
import { agentRateLimiter, assertToolScope, toolTierForCall } from './policy'
import type { ResolvedAgent } from './principal'
import { resolveAgentActor } from './principal'
import { getPrincipalByClient, insertApproval, insertToolCall, insertUndoEntry } from './repo'
import type { ToolDeps } from './tool-handlers'
import { getToolHandler } from './tool-handlers'

export interface InvokeArgs {
	readonly sql: Sql
	readonly credential: VerifiedAgentCredential
	readonly workspaceId: string
	readonly toolName: string
	readonly rawInput: unknown
	readonly transport: 'rest' | 'mcp'
	/** MCP elicitation answer — 'elicited' means the in-client confirm fired. */
	readonly confirmation?: 'elicited' | undefined
	/**
	 * Client elicitation support. When `false` on MCP, an R1 write can never
	 * surface `needs_confirmation` — it is treated as R2 (Huriro approval)
	 * because silently executing was never an option (§13.5).
	 */
	readonly mcpElicitation?: boolean | undefined
	/** Abort/cancellation signal (MCP tool timeout + client disconnect). */
	readonly signal?: AbortSignal | undefined
	readonly idempotencyKey?: string | undefined
	readonly requestId?: string | undefined
	readonly deps: ToolDeps
	readonly baseUrl: string
}

export type InvokeResult =
	| {
			readonly status: 'ok'
			readonly data: unknown
			readonly markdown: string
			readonly trust: 'trusted' | 'untrusted'
			readonly nextCursor?: string | null
			readonly undoId?: string
	  }
	| { readonly status: 'needs_confirmation'; readonly previewMd: string; readonly requestState: string }
	| {
			readonly status: 'approval_required'
			readonly approvalId: string
			readonly approveUrl: string
			readonly expiresAt: string
	  }

/** Canonical args hash — stable JSON (sorted keys) → sha256. */
export function argsHashOf(input: unknown): string {
	return createHash('sha256').update(canonicalJson(input), 'utf8').digest('hex')
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
	const obj = value as Record<string, unknown>
	return `{${Object.keys(obj)
		.sort()
		.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
		.join(',')}}`
}

export async function invokeTool(args: InvokeArgs): Promise<InvokeResult> {
	const started = Date.now()
	const tool = getTool(args.toolName)
	const ctx = {
		workspaceId: args.workspaceId,
		userId: args.credential.userId,
		requestId: args.requestId
	}

	try {
		// The tx + idempotency boundary lives HERE so REST and MCP share it:
		// nested begin() inside withWorkspace is a savepoint, so the replay
		// record commits atomically with the tool's domain write (§8.5).
		const { body } = (await withWorkspace(args.sql, ctx, (tx) =>
			withIdempotency(tx, {
				workspaceId: args.workspaceId,
				key: args.idempotencyKey,
				endpoint: `agent/${args.toolName}`,
				requestBody: args.rawInput,
				execute: () => (tool ? invokeInTx(tx, tool, args, started) : invokeUnknownTool(args.toolName))
			})
		)) as { body: InvokeResult }
		return body
	} catch (e) {
		// The main tx rolled back — write the denial/error audit row in a
		// SECOND short tx so denials survive (§13.3).
		await recordFailure(args, tool, started, e)
		throw e
	}
}

async function invokeUnknownTool(toolName: string): Promise<InvokeResult> {
	throw new HttpError(404, 'tool_unknown', `Unknown tool "${toolName}"`)
}

/**
 * Audit a failed call OUTSIDE the rolled-back tx. When a principal exists we
 * write agent_tool_calls; before one exists (agent_not_connected, unknown
 * tool) we fall back to audit_log with actor_id NULL (§13.3).
 */
async function recordFailure(
	args: InvokeArgs,
	tool: ToolSpec | undefined,
	started: number,
	e: unknown
): Promise<void> {
	const code = e instanceof HttpError ? e.code : 'internal'
	const status =
		code === 'tool_rate_limited'
			? 'rate_limited'
			: e instanceof HttpError && e.status < 500
				? 'denied'
				: 'error'
	try {
		await withWorkspace(
			args.sql,
			{ workspaceId: args.workspaceId, userId: args.credential.userId, requestId: args.requestId },
			async (tx) => {
				const principal = await getPrincipalByClient(
					tx,
					args.workspaceId,
					args.credential.userId,
					args.credential.clientId
				)
				if (tool && principal) {
					await insertToolCall(tx, {
						workspaceId: args.workspaceId,
						agentId: principal.id,
						ownerUserId: principal.ownerUserId,
						oauthClientId: args.credential.clientId,
						tokenId: args.credential.tokenId ?? null,
						tool: tool.name,
						argsHash: argsHashOf(args.rawInput),
						requestedScopes: args.credential.scopes,
						effectiveScopes: args.credential.scopes.filter(
							(s) => isAgentScope(s) && principal.scopeCeiling.includes(s)
						),
						requestedTier: tool.tier,
						effectiveTier: tool.tier,
						status,
						errorCode: code,
						durationMs: Date.now() - started,
						requestId: args.requestId ?? null
					})
					return
				}
				// No principal to attribute — structured security event instead.
				await tx`
					INSERT INTO audit_log (workspace_id, actor_type, actor_id, action, target_type, metadata)
					VALUES (${args.workspaceId}, 'agent', NULL, 'agent.tool_denied', 'tool',
						${tx.json({ clientId: args.credential.clientId, userId: args.credential.userId, tool: args.toolName, code } as never)})
				`
			}
		)
	} catch {
		// Never mask the original error — auditing is best-effort here.
	}
}

async function invokeInTx(
	tx: Queryable,
	tool: ToolSpec,
	args: InvokeArgs,
	started: number
): Promise<InvokeResult> {
	const resolved = await resolveAgentActor(tx, args.credential, args.workspaceId, args.requestId)

	// Per-workspace kill switch (§13.1b): mcp_enabled:false in
	// workspaces.settings disables every agent surface in that workspace.
	const enabledRows = await tx<{ enabled: boolean }[]>`
		SELECT COALESCE((settings->>'mcp_enabled')::boolean, true) AS enabled
		FROM workspaces WHERE id = ${args.workspaceId}`
	if (enabledRows[0] && !enabledRows[0].enabled) {
		throw new HttpError(403, 'agents_disabled', 'Agents are disabled for this workspace')
	}

	// Input validation — TypeBox schemas carry additionalProperties:false.
	if (!Value.Check(tool.input, args.rawInput)) {
		const detail = [...Value.Errors(tool.input, args.rawInput)]
			.slice(0, 5)
			.map((e) => `${e.instancePath || '/'}: ${e.message}`)
			.join('; ')
		throw new HttpError(422, 'validation_failed', `Invalid arguments for ${tool.name}`, detail)
	}
	const input = Value.Decode(tool.input, Value.Clone(args.rawInput)) as unknown

	// Scope gate (403 insufficient_scope + RFC 6750 challenge).
	assertToolScope(tool, args.credential.scopes, resolved.effectiveScopes)

	// Tier math — raise-only overrides; R3 never executes (§13.5).
	const { requested, effective: computedTier } = toolTierForCall(tool, input, resolved.principal)
	// No-elicitation MCP clients can never confirm an R1 write in-band: the
	// call is treated as R2 (Huriro approval) — silently executing or losing
	// the confirmation gate were both rejected (§13.5).
	const effective =
		args.transport === 'mcp' &&
		args.mcpElicitation === false &&
		tool.kind === 'write' &&
		computedTier === 'R1'
			? ('R2' as const)
			: computedTier
	if (!isAgentExecutable(effective)) {
		throw new HttpError(403, 'agent_scope_exceeded', `Tool ${tool.name} is not executable by agents`)
	}

	// Rate limits — per-principal and per-(principal,tool) buckets.
	const limiterKey = `${resolved.principal.id}:${tool.name}`
	let release: () => void
	const principalHold = agentRateLimiter.acquire(resolved.principal.id)
	try {
		const toolHold = agentRateLimiter.acquire(limiterKey)
		release = () => {
			principalHold.release()
			toolHold.release()
		}
	} catch (e) {
		principalHold.release()
		throw e
	}

	try {
		// R2: create the approval and STOP — nothing is written (§13.5).
		if (effective === 'R2') {
			const approval = await insertApproval(tx, {
				workspaceId: args.workspaceId,
				agentId: resolved.principal.id,
				ownerUserId: resolved.principal.ownerUserId,
				tool: tool.name,
				args: input,
				argsHash: argsHashOf(input),
				previewMd: renderApprovalPreview(tool, input),
				tier: effective,
				requestId: args.requestId,
				tokenId: args.credential.tokenId,
				tokenScopes: args.credential.scopes,
				idempotencyKey: args.idempotencyKey
			})
			// Notify approvers (owner + approval.decide holders) via the
			// notifications consumer — same tx, no partial state (§13.5).
			await emitAgentsEvent(tx, {
				workspaceId: args.workspaceId,
				aggregate: 'agent_approval',
				aggregateId: approval.id,
				eventType: AGENTS_EVENTS.ApprovalRequested,
				payload: {
					approvalId: approval.id,
					tool: tool.name,
					agentId: resolved.principal.id,
					agentName: resolved.principal.name,
					ownerUserId: resolved.principal.ownerUserId,
					tier: effective,
					actorType: 'agent',
					actorId: resolved.principal.id
				}
			})
			await insertToolCall(
				tx,
				toolCallArgs(resolved, args, tool, requested, effective, {
					status: 'approval_required',
					approvalId: approval.id,
					started
				})
			)
			return {
				status: 'approval_required',
				approvalId: approval.id,
				approveUrl: `${args.baseUrl.replace(/\/+$/, '')}/approvals/${approval.id}`,
				expiresAt: approval.expiresAt.toISOString()
			}
		}

		// MCP transport: R1 writes require an in-client elicitation answer
		// (§13.5); REST treats R1 as pre-approved because a human launched it.
		// A client that cannot elicit never reaches `needs_confirmation` —
		// the write parks as R2 approval instead of executing unconfirmed.
		const elicitBlocked = args.transport === 'mcp' && args.mcpElicitation === false
		if (args.transport === 'mcp' && tool.kind === 'write' && effective === 'R1' && !elicitBlocked) {
			if (args.confirmation !== 'elicited') {
				await insertToolCall(
					tx,
					toolCallArgs(resolved, args, tool, requested, effective, {
						status: 'needs_confirmation',
						started
					})
				)
				return {
					status: 'needs_confirmation',
					previewMd: renderApprovalPreview(tool, input),
					requestState: Buffer.from(canonicalJson(input), 'utf8').toString('base64url')
				}
			}
		}

		args.signal?.throwIfAborted()
		const handler = getToolHandler(tool)
		const result = await handler(tx, resolved, input, args.deps)

		// Size cap: structured + markdown each bounded at 256 KB (§13.7).
		const markdown = truncateBytes(result.markdown, MAX_RESULT_BYTES).text
		let data = result.data
		if (Buffer.byteLength(JSON.stringify(data ?? null), 'utf8') > MAX_RESULT_BYTES) {
			data = { truncated: true, note: 'structured result exceeded 256 KB; use Markdown + cursors' }
		}

		// Read-volume cap for read tools (§13.6 slow-and-detectable).
		if (tool.kind === 'read' && args.credential.tokenId) {
			agentRateLimiter.chargeRead(args.credential.tokenId, Buffer.byteLength(markdown, 'utf8'))
		}

		const callId = await insertToolCall(
			tx,
			toolCallArgs(resolved, args, tool, requested, effective, { status: 'ok', started })
		)

		let undoId: string | undefined
		if (result.undo && tool.undoable) {
			undoId = await insertUndoEntry(tx, {
				workspaceId: args.workspaceId,
				agentId: resolved.principal.id,
				toolCallId: callId,
				tool: tool.name,
				entityType: result.undo.entityType,
				entityId: result.undo.entityId,
				before: result.undo.before
			})
		}

		return {
			status: 'ok',
			data,
			markdown,
			trust: trustForTool(tool.untrustedFields),
			...(result.nextCursor !== undefined ? { nextCursor: result.nextCursor } : {}),
			...(undoId ? { undoId } : {})
		}
	} finally {
		release()
	}
}

function toolCallArgs(
	resolved: ResolvedAgent,
	args: InvokeArgs,
	tool: ToolSpec,
	requestedTier: string,
	effectiveTier: string,
	outcome: {
		readonly status: string
		readonly approvalId?: string
		readonly started: number
		readonly errorCode?: string
	}
) {
	return {
		workspaceId: args.workspaceId,
		agentId: resolved.principal.id,
		ownerUserId: resolved.actor.userId,
		oauthClientId: args.credential.clientId,
		tokenId: args.credential.tokenId ?? null,
		tool: tool.name,
		argsHash: argsHashOf(args.rawInput),
		requestedScopes: args.credential.scopes,
		effectiveScopes: resolved.effectiveScopes,
		requestedTier,
		effectiveTier,
		status: outcome.status,
		errorCode: outcome.errorCode ?? null,
		durationMs: Date.now() - outcome.started,
		approvalId: outcome.approvalId ?? null,
		requestId: args.requestId ?? null
	}
}

/** Server-rendered preview — humans see what the server will do (§13.5). */
export function renderApprovalPreview(tool: ToolSpec, input: unknown): string {
	const pretty = JSON.stringify(input, null, 2).slice(0, 4000)
	return `### ${tool.title}\n\nTool: \`${tool.name}\`\n\n\`\`\`json\n${pretty}\n\`\`\`\n`
}
