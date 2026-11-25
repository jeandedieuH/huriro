/**
 * Wire schemas for tenancy endpoints — TypeBox on the edge (§7.5).
 */
import { Type } from 'typebox'

export const SetupStatusResponse = Type.Object({
	configured: Type.Boolean(),
	mode: Type.Union([Type.Literal('selfhost'), Type.Literal('cloud')])
})

export const CompleteSetupBody = Type.Object({
	token: Type.String({ minLength: 32, description: 'One-time setup token from `huriro init`' }),
	workspaceName: Type.String({ minLength: 1, maxLength: 80 }),
	slug: Type.String({ minLength: 2, maxLength: 48, pattern: '^[a-z0-9][a-z0-9-]*$' }),
	email: Type.String({ format: 'email' }),
	displayName: Type.String({ minLength: 1, maxLength: 120 }),
	// When present the owner credential is created through better-auth so the
	// first admin can log in immediately (§12.2).
	password: Type.Optional(Type.String({ minLength: 8, maxLength: 128 }))
})

export const CompleteSetupResponse = Type.Object({
	workspaceId: Type.String({ format: 'uuid' }),
	userId: Type.String({ format: 'uuid' }),
	slug: Type.String()
})

export const CreateWorkspaceBody = Type.Object({
	name: Type.String({ minLength: 1, maxLength: 80 }),
	slug: Type.String({ minLength: 2, maxLength: 48, pattern: '^[a-z0-9][a-z0-9-]*$' })
})

export const CreateWorkspaceResponse = Type.Object({
	id: Type.String({ format: 'uuid' }),
	slug: Type.String(),
	name: Type.String()
})

export const HealthResponse = Type.Object({ status: Type.Literal('ok') })

export const ReadyResponse = Type.Object({
	ready: Type.Boolean(),
	checks: Type.Object({
		database: Type.Boolean(),
		migrationsPending: Type.Integer()
	})
})

export const InviteBody = Type.Object({
	workspaceId: Type.String({ format: 'uuid' }),
	email: Type.String({ format: 'email' }),
	role: Type.Union([Type.Literal('admin'), Type.Literal('member'), Type.Literal('guest')])
})

export const AcceptBody = Type.Object({ token: Type.String({ minLength: 20 }) })

export const AclListQuery = Type.Object({
	resourceType: Type.Union([
		Type.Literal('project'),
		Type.Literal('doc_page'),
		Type.Literal('teamspace'),
		Type.Literal('channel'),
		Type.Literal('mail_account')
	]),
	resourceId: Type.String({ format: 'uuid' })
})

export const AclIdParam = Type.Object({
	id: Type.String({ format: 'uuid' })
})

export const GrantAclBody = Type.Object({
	resourceType: Type.Union([
		Type.Literal('project'),
		Type.Literal('doc_page'),
		Type.Literal('teamspace'),
		Type.Literal('channel'),
		Type.Literal('mail_account')
	]),
	resourceId: Type.String({ format: 'uuid' }),
	principalType: Type.Union([Type.Literal('user'), Type.Literal('role'), Type.Literal('workspace')]),
	principalId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	permission: Type.Union([
		Type.Literal('read'),
		Type.Literal('comment'),
		Type.Literal('write'),
		Type.Literal('manage')
	])
})

export const AgentsSettingsBody = Type.Object({
	mcpEnabled: Type.Boolean({
		description: 'Enable the /mcp + /api/v1/agent surfaces for this workspace (A13.1b)'
	})
})
export const AgentsSettingsResponse = Type.Object({ mcpEnabled: Type.Boolean() })
