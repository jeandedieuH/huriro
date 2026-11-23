import { type Static, Type } from 'typebox'

export const GithubSourceOfTruth = Type.Union([
	Type.Literal('huriro'),
	Type.Literal('github'),
	Type.Literal('bidirectional')
])
export type GithubSourceOfTruth = Static<typeof GithubSourceOfTruth>

export const GithubSyncState = Type.Union([
	Type.Literal('synced'),
	Type.Literal('pending_push'),
	Type.Literal('push_failed')
])
export type GithubSyncState = Static<typeof GithubSyncState>

export const GithubInstallationDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	installationId: Type.Integer({ minimum: 1 }),
	accountLogin: Type.String(),
	repoFullName: Type.String(),
	projectId: Type.String({ format: 'uuid' }),
	syncEnabled: Type.Boolean(),
	lastSyncedAt: Type.Union([Type.String(), Type.Null()]),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	version: Type.Integer({ minimum: 1 })
})
export type GithubInstallationDto = Static<typeof GithubInstallationDto>

export const CreateGithubInstallationBody = Type.Object({
	installationId: Type.Integer({ minimum: 1 }),
	accountLogin: Type.String({ minLength: 1, maxLength: 120 }),
	repoFullName: Type.String({ minLength: 3, maxLength: 200, pattern: '^[^/\\s]+/[^/\\s]+$' }),
	projectId: Type.String({ format: 'uuid' }),
	webhookSecret: Type.String({ minLength: 8, maxLength: 256 }),
	accessToken: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
	syncEnabled: Type.Optional(Type.Boolean())
})
export type CreateGithubInstallationBody = Static<typeof CreateGithubInstallationBody>

export const UpdateGithubInstallationBody = Type.Object({
	projectId: Type.Optional(Type.String({ format: 'uuid' })),
	syncEnabled: Type.Optional(Type.Boolean()),
	webhookSecret: Type.Optional(Type.String({ minLength: 8, maxLength: 256 })),
	accessToken: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
	version: Type.Integer({ minimum: 1 })
})
export type UpdateGithubInstallationBody = Static<typeof UpdateGithubInstallationBody>

export const IssueGithubLinkDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	issueId: Type.String({ format: 'uuid' }),
	installationId: Type.String({ format: 'uuid' }),
	repoFullName: Type.String(),
	githubIssueNumber: Type.Integer({ minimum: 1 }),
	githubIssueId: Type.Integer({ minimum: 1 }),
	githubUrl: Type.String(),
	sourceOfTruth: GithubSourceOfTruth,
	lastSyncedAt: Type.Union([Type.String(), Type.Null()]),
	lastSyncHash: Type.Union([Type.String(), Type.Null()]),
	syncState: GithubSyncState,
	lastSyncError: Type.Union([Type.String(), Type.Null()]),
	createdAt: Type.String(),
	updatedAt: Type.String()
})
export type IssueGithubLinkDto = Static<typeof IssueGithubLinkDto>

export const CreateIssueGithubLinkBody = Type.Object({
	issueId: Type.String({ format: 'uuid' }),
	installationId: Type.String({ format: 'uuid' }),
	githubIssueNumber: Type.Integer({ minimum: 1 }),
	githubIssueId: Type.Optional(Type.Integer({ minimum: 1 })),
	githubUrl: Type.Optional(Type.String()),
	sourceOfTruth: Type.Optional(GithubSourceOfTruth)
})
export type CreateIssueGithubLinkBody = Static<typeof CreateIssueGithubLinkBody>
