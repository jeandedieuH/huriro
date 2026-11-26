import { Type } from 'typebox'

export {
	CreateDocDatabaseBody,
	CreateDocDatabasePropertyBody,
	CreateDocDatabaseRowBody,
	CreateDocDatabaseViewBody,
	ExportDocDatabaseRowsQuery,
	ImportDocDatabaseRowsBody,
	QueryDocDatabaseRowsBody,
	UpdateDocDatabaseBody,
	UpdateDocDatabasePropertyBody,
	UpdateDocDatabaseRowBody,
	UpdateDocDatabaseViewBody
} from '@huriro/contracts'

export const DatabaseIdParam = Type.Object({ databaseId: Type.String({ format: 'uuid' }) })
export const DatabasePropertyParam = Type.Object({
	databaseId: Type.String({ format: 'uuid' }),
	propertyId: Type.String({ format: 'uuid' })
})
export const DatabaseViewParam = Type.Object({
	databaseId: Type.String({ format: 'uuid' }),
	viewId: Type.String({ format: 'uuid' })
})
export const DatabaseRowParam = Type.Object({
	databaseId: Type.String({ format: 'uuid' }),
	rowId: Type.String({ format: 'uuid' })
})
