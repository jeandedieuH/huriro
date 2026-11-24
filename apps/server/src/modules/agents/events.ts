/**
 * Outbox + audit helpers for the agents module (non-negotiable #3: every
 * domain write lands outbox + audit_log in the SAME transaction).
 */
import type { Queryable } from '@huriro/db'
import { type ActorContext, attributionOf } from '@huriro/domain'

export const AGENTS_EVENTS = {
	PrincipalConnected: 'agents.principal.connected.v1',
	PrincipalUpdated: 'agents.principal.updated.v1',
	PrincipalRevoked: 'agents.principal.revoked.v1',
	ApprovalRequested: 'agents.approval.requested.v1',
	ApprovalDecided: 'agents.approval.decided.v1',
	ApprovalExecuted: 'agents.approval.executed.v1',
	ApprovalExpired: 'agents.approval.expired.v1',
	ActionUndone: 'agents.action.undone.v1'
} as const

export async function emitAgentsEvent(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly aggregate: string
		readonly aggregateId: string
		readonly eventType: string
		readonly payload: Record<string, unknown>
	}
): Promise<void> {
	await tx`
		INSERT INTO outbox (workspace_id, aggregate, aggregate_id, event_type, payload)
		VALUES (${args.workspaceId}, ${args.aggregate}, ${args.aggregateId}, ${args.eventType}, ${tx.json(args.payload as never)})
	`
}

/** actor_type='agent' for agent calls, 'user' for human decisions — §13.1a. */
export async function auditAgentsAction(
	tx: Queryable,
	actor: ActorContext,
	args: {
		readonly action: string
		readonly targetType: string
		readonly targetId: string
		readonly metadata?: Record<string, unknown>
	}
): Promise<void> {
	const { actorType, actorId } = attributionOf(actor)
	await tx`
		INSERT INTO audit_log (workspace_id, actor_type, actor_id, action, target_type, target_id, metadata)
		VALUES (${actor.workspaceId}, ${actorType}, ${actorId}, ${args.action}, ${args.targetType}, ${args.targetId},
			${args.metadata ? tx.json(args.metadata as never) : null})
	`
}
