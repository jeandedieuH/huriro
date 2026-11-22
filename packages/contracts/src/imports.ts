import { type Static, Type } from 'typebox'

export const ImportSource = Type.Union([Type.Literal('linear'), Type.Literal('github')])
export type ImportSource = Static<typeof ImportSource>

export const ImportJobStatus = Type.Union([
	Type.Literal('dry_run'),
	Type.Literal('pending'),
	Type.Literal('running'),
	Type.Literal('completed'),
	Type.Literal('failed'),
	Type.Literal('cancelled')
])
export type ImportJobStatus = Static<typeof ImportJobStatus>

export const LinearImportIssue = Type.Object({
	id: Type.String({ minLength: 1 }),
	identifier: Type.String({ minLength: 1 }),
	title: Type.String({ minLength: 1 }),
	description: Type.Optional(Type.String()),
	stateName: Type.Optional(Type.String()),
	stateType: Type.Optional(Type.String()),
	priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })),
	assigneeEmail: Type.Optional(Type.String()),
	labels: Type.Optional(Type.Array(Type.String())),
	url: Type.Optional(Type.String()),
	comments: Type.Optional(
		Type.Array(
			Type.Object({
				id: Type.String({ minLength: 1 }),
				body: Type.String(),
				authorEmail: Type.Optional(Type.String())
			})
		)
	)
})

export const LinearImportPayload = Type.Object({
	projectKey: Type.String({ pattern: '^[A-Z][A-Z0-9]{1,9}$' }),
	projectName: Type.String({ minLength: 1, maxLength: 120 }),
	issues: Type.Array(LinearImportIssue)
})
export type LinearImportPayload = Static<typeof LinearImportPayload>

export const GithubImportIssue = Type.Object({
	id: Type.Union([Type.String({ minLength: 1 }), Type.Integer()]),
	number: Type.Integer({ minimum: 1 }),
	title: Type.String({ minLength: 1 }),
	body: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	state: Type.Union([Type.Literal('open'), Type.Literal('closed')]),
	assigneeLogin: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	assigneeEmail: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	labels: Type.Optional(Type.Array(Type.String())),
	htmlUrl: Type.Optional(Type.String()),
	comments: Type.Optional(
		Type.Array(
			Type.Object({
				id: Type.Union([Type.String({ minLength: 1 }), Type.Integer()]),
				body: Type.String(),
				authorEmail: Type.Optional(Type.String())
			})
		)
	)
})

export const GithubImportPayload = Type.Object({
	repo: Type.String({ minLength: 1 }),
	projectKey: Type.String({ pattern: '^[A-Z][A-Z0-9]{1,9}$' }),
	projectName: Type.String({ minLength: 1, maxLength: 120 }),
	issues: Type.Array(GithubImportIssue)
})
export type GithubImportPayload = Static<typeof GithubImportPayload>

export const ImportDryRunBody = Type.Object({
	source: ImportSource,
	targetProjectId: Type.Optional(Type.String({ format: 'uuid' })),
	linear: Type.Optional(LinearImportPayload),
	github: Type.Optional(GithubImportPayload),
	/** Optional live API parameters — tokens are used transiently and never persisted (§4.2). */
	apiToken: Type.Optional(Type.String()),
	teamKey: Type.Optional(Type.String()),
	repo: Type.Optional(Type.String())
})
export type ImportDryRunBody = Static<typeof ImportDryRunBody>

export const ImportDryRunPreviewDto = Type.Object({
	jobId: Type.String({ format: 'uuid' }),
	source: ImportSource,
	projectKey: Type.String(),
	projectName: Type.String(),
	counts: Type.Object({
		issues: Type.Integer(),
		comments: Type.Integer(),
		labels: Type.Integer(),
		skippedExisting: Type.Integer()
	}),
	userMappings: Type.Array(
		Type.Object({
			remoteIdentifier: Type.String(),
			matchedUserId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
		})
	),
	unmappedFields: Type.Array(Type.String())
})
export type ImportDryRunPreviewDto = Static<typeof ImportDryRunPreviewDto>

export const ImportExecuteBody = Type.Object({
	jobId: Type.Optional(Type.String({ format: 'uuid' })),
	source: Type.Optional(ImportSource),
	targetProjectId: Type.Optional(Type.String({ format: 'uuid' })),
	linear: Type.Optional(LinearImportPayload),
	github: Type.Optional(GithubImportPayload),
	apiToken: Type.Optional(Type.String()),
	teamKey: Type.Optional(Type.String()),
	repo: Type.Optional(Type.String())
})
export type ImportExecuteBody = Static<typeof ImportExecuteBody>

export const ImportJobDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	source: ImportSource,
	status: ImportJobStatus,
	targetProjectId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	preview: Type.Record(Type.String(), Type.Unknown()),
	report: Type.Record(Type.String(), Type.Unknown()),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	completedAt: Type.Union([Type.String(), Type.Null()]),
	version: Type.Integer()
})
export type ImportJobDto = Static<typeof ImportJobDto>

export const ImportRedirectResponse = Type.Object({
	remoteIdentifier: Type.String(),
	localType: Type.String(),
	localId: Type.String({ format: 'uuid' }),
	identifier: Type.Union([Type.String(), Type.Null()]),
	deepLink: Type.String()
})
export type ImportRedirectResponse = Static<typeof ImportRedirectResponse>
