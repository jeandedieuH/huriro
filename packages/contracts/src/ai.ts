// AI gateway wire contract (§11.2–§11.4). Provider keys are write-only — the
// API never returns them; responses expose `hasApiKey` instead.
import { type Static, Type } from 'typebox'

export const AiProviderKind = Type.Union([Type.Literal('openai_compatible'), Type.Literal('ollama')])
export type AiProviderKind = Static<typeof AiProviderKind>

export const AiProviderDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	kind: AiProviderKind,
	name: Type.String(),
	baseUrl: Type.String(),
	hasApiKey: Type.Boolean(),
	chatModel: Type.Union([Type.String(), Type.Null()]),
	embeddingModel: Type.Union([Type.String(), Type.Null()]),
	isDefault: Type.Boolean(),
	createdAt: Type.String()
})
export type AiProviderDto = Static<typeof AiProviderDto>

export const AiSettingsResponse = Type.Object({
	aiEnabled: Type.Boolean(),
	aiTracePrompts: Type.Boolean(),
	providers: Type.Array(AiProviderDto)
})
export type AiSettingsResponse = Static<typeof AiSettingsResponse>

export const AiSettingsPatch = Type.Object({
	aiEnabled: Type.Optional(Type.Boolean()),
	aiTracePrompts: Type.Optional(Type.Boolean())
})
export type AiSettingsPatch = Static<typeof AiSettingsPatch>

export const AiProviderUpsert = Type.Object({
	kind: AiProviderKind,
	name: Type.String({ minLength: 1, maxLength: 120 }),
	baseUrl: Type.String({ minLength: 1, maxLength: 500 }),
	// Omit → keep existing key; null → clear (keyless local provider).
	apiKey: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 500 }), Type.Null()])),
	chatModel: Type.Optional(Type.String({ maxLength: 200 })),
	embeddingModel: Type.Optional(Type.String({ maxLength: 200 }))
})
export type AiProviderUpsert = Static<typeof AiProviderUpsert>

export const AiSummarizeRequest = Type.Object({
	entityType: Type.Union([Type.Literal('issue'), Type.Literal('doc_page')]),
	entityId: Type.String({ format: 'uuid' })
})
export type AiSummarizeRequest = Static<typeof AiSummarizeRequest>

export const AiSummaryDto = Type.Object({
	entityType: Type.String(),
	entityId: Type.String({ format: 'uuid' }),
	summary: Type.String(),
	model: Type.String(),
	sourceCount: Type.Integer({ minimum: 0 }),
	cached: Type.Boolean()
})
export type AiSummaryDto = Static<typeof AiSummaryDto>

export const AiSemanticSearchQuery = Type.Object({
	q: Type.String({ minLength: 1, maxLength: 500 }),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 }))
})
export type AiSemanticSearchQuery = Static<typeof AiSemanticSearchQuery>

export const AiSemanticHitDto = Type.Object({
	entityType: Type.String(),
	entityId: Type.String({ format: 'uuid' }),
	title: Type.String(),
	snippet: Type.String(),
	score: Type.Number(),
	deepLink: Type.String()
})
export type AiSemanticHitDto = Static<typeof AiSemanticHitDto>

export const AiSemanticSearchResponse = Type.Object({
	query: Type.String(),
	mode: Type.Literal('semantic'),
	hits: Type.Array(AiSemanticHitDto)
})
export type AiSemanticSearchResponse = Static<typeof AiSemanticSearchResponse>
