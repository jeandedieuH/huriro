/**
 * Workspace-level action guards. Thin wrappers over @huriro/domain.can() —
 * the pure policy function stays the single source of truth (§12.3).
 *
 * Note: "create a workspace" is deliberately NOT a `can()` call — can()
 * requires membership, and a user's first workspace precedes any membership.
 * Workspace creation is an instance-level entitlement (authenticated user +
 * feature flag on cloud), enforced in the setup service.
 */
import { type ActorContext, can } from '@huriro/domain'

export function canManageWorkspace(actor: ActorContext): boolean {
	return can(actor, 'workspace.manage', { type: 'workspace' }).effect === 'allow'
}
