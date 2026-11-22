/**
 * Domain event names + payloads for tenancy (§4.3 outbox).
 * Event names are versioned contracts — additive changes only.
 */
export const TENANCY_EVENTS = {
	WorkspaceCreated: 'tenancy.workspace.created.v1',
	MemberAdded: 'tenancy.member.added.v1',
	SetupCompleted: 'tenancy.setup.completed.v1'
} as const

export interface WorkspaceCreatedPayload {
	workspaceId: string
	slug: string
	ownerUserId: string
}

export interface SetupCompletedPayload {
	workspaceId: string
	userId: string
}
