import { type Static, Type } from 'typebox'

export const DocDatabasePropertyType = Type.Union([
	Type.Literal('title'),
	Type.Literal('text'),
	Type.Literal('number'),
	Type.Literal('select'),
	Type.Literal('multi_select'),
	Type.Literal('status'),
	Type.Literal('date'),
	Type.Literal('person'),
	Type.Literal('checkbox'),
	Type.Literal('url'),
	Type.Literal('email'),
	Type.Literal('phone'),
	Type.Literal('file'),
	Type.Literal('relation'),
	Type.Literal('rollup'),
	Type.Literal('formula'),
	Type.Literal('created_time'),
	Type.Literal('created_by'),
	Type.Literal('updated_time'),
	Type.Literal('updated_by')
])
export type DocDatabasePropertyType = Static<typeof DocDatabasePropertyType>

export const DocDatabaseViewType = Type.Union([
	Type.Literal('table'),
	Type.Literal('board'),
	Type.Literal('gallery'),
	Type.Literal('calendar'),
	Type.Literal('timeline'),
	Type.Literal('list')
])
export type DocDatabaseViewType = Static<typeof DocDatabaseViewType>

/** Property/view configuration remains intentionally typed as JSON at the wire boundary. */
export const JsonObject = Type.Record(Type.String(), Type.Unknown())
export type JsonObject = Static<typeof JsonObject>

export const DocDatabaseDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	teamspaceId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	parentPageId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	title: Type.String(),
	icon: Type.Union([Type.String(), Type.Null()]),
	isInline: Type.Boolean(),
	createdBy: Type.String({ format: 'uuid' }),
	createdAt: Type.String({ format: 'date-time' }),
	updatedAt: Type.String({ format: 'date-time' }),
	version: Type.Integer({ minimum: 1 })
})
export type DocDatabaseDto = Static<typeof DocDatabaseDto>

export const DocDatabasePropertyDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	databaseId: Type.String({ format: 'uuid' }),
	name: Type.String(),
	propType: DocDatabasePropertyType,
	config: JsonObject,
	position: Type.String(),
	createdAt: Type.String({ format: 'date-time' }),
	updatedAt: Type.String({ format: 'date-time' }),
	version: Type.Integer({ minimum: 1 })
})
export type DocDatabasePropertyDto = Static<typeof DocDatabasePropertyDto>

export const DocDatabaseViewDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	databaseId: Type.String({ format: 'uuid' }),
	name: Type.String(),
	viewType: DocDatabaseViewType,
	config: JsonObject,
	position: Type.String(),
	createdAt: Type.String({ format: 'date-time' }),
	updatedAt: Type.String({ format: 'date-time' }),
	version: Type.Integer({ minimum: 1 })
})
export type DocDatabaseViewDto = Static<typeof DocDatabaseViewDto>

/** Sparse typed cell columns mirror Postgres exactly; property type determines interpretation. */
export const DocDatabaseCellValueDto = Type.Object({
	text: Type.Union([Type.String(), Type.Null()]),
	number: Type.Union([Type.Number(), Type.Null()]),
	boolean: Type.Union([Type.Boolean(), Type.Null()]),
	dateStart: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
	dateEnd: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
	json: Type.Unknown()
})
export type DocDatabaseCellValueDto = Static<typeof DocDatabaseCellValueDto>

export const DocDatabaseRowDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	databaseId: Type.String({ format: 'uuid' }),
	pageId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	title: Type.String(),
	position: Type.String(),
	createdBy: Type.String({ format: 'uuid' }),
	updatedBy: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	archivedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
	createdAt: Type.String({ format: 'date-time' }),
	updatedAt: Type.String({ format: 'date-time' }),
	version: Type.Integer({ minimum: 1 }),
	cells: Type.Record(Type.String({ format: 'uuid' }), DocDatabaseCellValueDto)
})
export type DocDatabaseRowDto = Static<typeof DocDatabaseRowDto>

export const CreateDocDatabaseBody = Type.Object({
	id: Type.Optional(Type.String({ format: 'uuid' })),
	/** Client-generated ids keep offline optimistic creates convergent with server bootstrap rows. */
	titlePropertyId: Type.Optional(Type.String({ format: 'uuid' })),
	tableViewId: Type.Optional(Type.String({ format: 'uuid' })),
	teamspaceId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	parentPageId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	title: Type.String({ minLength: 1, maxLength: 300 }),
	icon: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
	isInline: Type.Optional(Type.Boolean())
})
export type CreateDocDatabaseBody = Static<typeof CreateDocDatabaseBody>

export const UpdateDocDatabaseBody = Type.Object({
	title: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
	icon: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
	teamspaceId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
	version: Type.Integer({ minimum: 1 })
})
export type UpdateDocDatabaseBody = Static<typeof UpdateDocDatabaseBody>

export const CreateDocDatabasePropertyBody = Type.Object({
	id: Type.Optional(Type.String({ format: 'uuid' })),
	name: Type.String({ minLength: 1, maxLength: 200 }),
	propType: DocDatabasePropertyType,
	config: Type.Optional(JsonObject),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 128 }))
})
export type CreateDocDatabasePropertyBody = Static<typeof CreateDocDatabasePropertyBody>

export const UpdateDocDatabasePropertyBody = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
	config: Type.Optional(JsonObject),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	version: Type.Integer({ minimum: 1 })
})
export type UpdateDocDatabasePropertyBody = Static<typeof UpdateDocDatabasePropertyBody>

export const CreateDocDatabaseViewBody = Type.Object({
	id: Type.Optional(Type.String({ format: 'uuid' })),
	name: Type.String({ minLength: 1, maxLength: 200 }),
	viewType: DocDatabaseViewType,
	config: Type.Optional(JsonObject),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 128 }))
})
export type CreateDocDatabaseViewBody = Static<typeof CreateDocDatabaseViewBody>

export const UpdateDocDatabaseViewBody = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
	config: Type.Optional(JsonObject),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	version: Type.Integer({ minimum: 1 })
})
export type UpdateDocDatabaseViewBody = Static<typeof UpdateDocDatabaseViewBody>

export const CreateDocDatabaseRowBody = Type.Object({
	id: Type.Optional(Type.String({ format: 'uuid' })),
	title: Type.Optional(Type.String({ maxLength: 500 })),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	cells: Type.Optional(Type.Record(Type.String({ format: 'uuid' }), DocDatabaseCellValueDto))
})
export type CreateDocDatabaseRowBody = Static<typeof CreateDocDatabaseRowBody>

export const UpdateDocDatabaseRowBody = Type.Object({
	title: Type.Optional(Type.String({ maxLength: 500 })),
	position: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	archived: Type.Optional(Type.Boolean()),
	cells: Type.Optional(Type.Record(Type.String({ format: 'uuid' }), DocDatabaseCellValueDto)),
	version: Type.Integer({ minimum: 1 })
})
export type UpdateDocDatabaseRowBody = Static<typeof UpdateDocDatabaseRowBody>

export const DocDatabaseDetailDto = Type.Object({
	database: DocDatabaseDto,
	properties: Type.Array(DocDatabasePropertyDto),
	views: Type.Array(DocDatabaseViewDto)
})
export type DocDatabaseDetailDto = Static<typeof DocDatabaseDetailDto>

export const DocDatabaseRowsPageDto = Type.Object({
	rows: Type.Array(DocDatabaseRowDto),
	nextCursor: Type.Union([Type.String(), Type.Null()]),
	hasMore: Type.Boolean()
})
export type DocDatabaseRowsPageDto = Static<typeof DocDatabaseRowsPageDto>

export const DocDatabaseSortSpecDto = Type.Object({
	propertyId: Type.String({ format: 'uuid' }),
	direction: Type.Union([Type.Literal('asc'), Type.Literal('desc')])
})
export type DocDatabaseSortSpecDto = Static<typeof DocDatabaseSortSpecDto>

export const QueryDocDatabaseRowsBody = Type.Object({
	viewId: Type.Optional(Type.String({ format: 'uuid' })),
	/** Recursive filter AST is validated by the shared domain validator. */
	filter: Type.Optional(Type.Unknown()),
	sorts: Type.Optional(Type.Array(DocDatabaseSortSpecDto, { maxItems: 8 })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
	cursor: Type.Optional(Type.String()),
	includeArchived: Type.Optional(Type.Boolean())
})
export type QueryDocDatabaseRowsBody = Static<typeof QueryDocDatabaseRowsBody>

export const ImportDocDatabaseRowsBody = Type.Object({
	format: Type.Union([Type.Literal('csv'), Type.Literal('json')]),
	data: Type.String({ minLength: 1, maxLength: 5_000_000 })
})
export type ImportDocDatabaseRowsBody = Static<typeof ImportDocDatabaseRowsBody>

export const ImportDocDatabaseRowsResultDto = Type.Object({
	created: Type.Integer({ minimum: 0 }),
	skipped: Type.Integer({ minimum: 0 }),
	errors: Type.Array(Type.Object({ row: Type.Integer({ minimum: 1 }), message: Type.String() }))
})
export type ImportDocDatabaseRowsResultDto = Static<typeof ImportDocDatabaseRowsResultDto>

export const ExportDocDatabaseRowsQuery = Type.Object({
	format: Type.Union([Type.Literal('csv'), Type.Literal('json')]),
	viewId: Type.Optional(Type.String({ format: 'uuid' }))
})
export type ExportDocDatabaseRowsQuery = Static<typeof ExportDocDatabaseRowsQuery>
