import { type Static, Type } from 'typebox'

/** Entity types admitted to the unified cross-entity graph (§7.1, ADR-0033). */
export const EntityTypeSchema = Type.Union([
	Type.Literal('issue'),
	Type.Literal('doc_page'),
	Type.Literal('doc_database_row'),
	Type.Literal('chat_message'),
	Type.Literal('mail_conversation'),
	Type.Literal('contact_org'),
	Type.Literal('vcs_pr')
])
export type EntityType = Static<typeof EntityTypeSchema>

export const RelationKindSchema = Type.Union([
	Type.Literal('references'),
	Type.Literal('blocks'),
	Type.Literal('duplicates'),
	Type.Literal('originated_from'),
	Type.Literal('tracked_by'),
	Type.Literal('requested_by')
])
// `RelationKind` is already the issue-relation wire type in tasks.ts; the
// graph keeps the required schema name and a non-colliding TypeScript alias.
export type EntityLinkRelationKind = Static<typeof RelationKindSchema>

export const EntityLinkDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	sourceType: EntityTypeSchema,
	sourceId: Type.String({ format: 'uuid' }),
	targetType: EntityTypeSchema,
	targetId: Type.String({ format: 'uuid' }),
	relationKind: RelationKindSchema,
	createdBy: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	createdAt: Type.String()
})
export type EntityLinkDto = Static<typeof EntityLinkDto>

export const CreateEntityLinkBody = Type.Object({
	sourceType: EntityTypeSchema,
	sourceId: Type.String({ format: 'uuid' }),
	targetType: EntityTypeSchema,
	targetId: Type.String({ format: 'uuid' }),
	relationKind: Type.Optional(RelationKindSchema)
})
export type CreateEntityLinkBody = Static<typeof CreateEntityLinkBody>

export const GraphLinksQuery = Type.Object({
	type: EntityTypeSchema,
	id: Type.String({ format: 'uuid' })
})
export type GraphLinksQuery = Static<typeof GraphLinksQuery>

export const GraphPeekQuery = Type.Object({
	type: EntityTypeSchema,
	id: Type.String({ format: 'uuid' })
})
export type GraphPeekQuery = Static<typeof GraphPeekQuery>

/** Uniform hover-card projection — endpoint-specific details stay in `meta`. */
export const PeekCardDto = Type.Object({
	type: EntityTypeSchema,
	id: Type.String({ format: 'uuid' }),
	title: Type.String(),
	subtitle: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	status: Type.Optional(
		Type.Object({
			kind: Type.String(),
			label: Type.String()
		})
	),
	meta: Type.Record(Type.String(), Type.Unknown()),
	updatedAt: Type.String()
})
export type PeekCardDto = Static<typeof PeekCardDto>

export const EntityLinkListResponse = Type.Object({
	data: Type.Array(EntityLinkDto)
})
export type EntityLinkListResponse = Static<typeof EntityLinkListResponse>
