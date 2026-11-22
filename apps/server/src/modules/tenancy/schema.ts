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
	displayName: Type.String({ minLength: 1, maxLength: 120 })
})

export const CompleteSetupResponse = Type.Object({
	workspaceId: Type.String({ format: 'uuid' }),
	userId: Type.String({ format: 'uuid' }),
	slug: Type.String()
})

export const HealthResponse = Type.Object({ status: Type.Literal('ok') })

export const ReadyResponse = Type.Object({
	ready: Type.Boolean(),
	checks: Type.Object({
		database: Type.Boolean(),
		migrationsPending: Type.Integer()
	})
})
