import { type Static, Type } from 'typebox'

export const SearchEntityType = Type.Union([
	Type.Literal('issue'),
	Type.Literal('project'),
	Type.Literal('comment'),
	Type.Literal('doc_page'),
	Type.Literal('message'),
	Type.Literal('mail_message')
])
export type SearchEntityType = Static<typeof SearchEntityType>

export const SearchQuery = Type.Object({
	q: Type.String({ maxLength: 500 }),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 }))
})
export type SearchQuery = Static<typeof SearchQuery>

export const SearchHitDto = Type.Object({
	entityType: SearchEntityType,
	entityId: Type.String({ format: 'uuid' }),
	projectId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	identifier: Type.Union([Type.String(), Type.Null()]),
	title: Type.String(),
	snippet: Type.String(),
	score: Type.Number(),
	deepLink: Type.String(),
	updatedAt: Type.String()
})
export type SearchHitDto = Static<typeof SearchHitDto>

export const SearchResponse = Type.Object({
	query: Type.String(),
	mode: Type.Union([Type.Literal('all'), Type.Literal('actions')]),
	hits: Type.Array(SearchHitDto)
})
export type SearchResponse = Static<typeof SearchResponse>
