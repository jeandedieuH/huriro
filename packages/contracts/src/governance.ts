import { type Static, Type } from 'typebox'

export const WorkspaceExportStatus = Type.Union([
	Type.Literal('pending'),
	Type.Literal('processing'),
	Type.Literal('completed'),
	Type.Literal('failed')
])
export type WorkspaceExportStatus = Static<typeof WorkspaceExportStatus>

export const WorkspaceExportDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	requestedBy: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	status: WorkspaceExportStatus,
	byteSize: Type.Integer({ minimum: 0 }),
	manifest: Type.Record(Type.String(), Type.Unknown()),
	expiresAt: Type.Union([Type.String(), Type.Null()]),
	errorDetail: Type.Union([Type.String(), Type.Null()]),
	createdAt: Type.String(),
	updatedAt: Type.String()
})
export type WorkspaceExportDto = Static<typeof WorkspaceExportDto>

export const WorkspaceExportListResponse = Type.Object({
	data: Type.Array(WorkspaceExportDto)
})
export type WorkspaceExportListResponse = Static<typeof WorkspaceExportListResponse>

export const EraseAccountBody = Type.Object({
	confirmEmail: Type.String({ minLength: 3, maxLength: 320 })
})
export type EraseAccountBody = Static<typeof EraseAccountBody>

export const EraseAccountResponse = Type.Object({
	erased: Type.Literal(true),
	userId: Type.String({ format: 'uuid' }),
	revokedWorkspaceIds: Type.Array(Type.String({ format: 'uuid' }))
})
export type EraseAccountResponse = Static<typeof EraseAccountResponse>
