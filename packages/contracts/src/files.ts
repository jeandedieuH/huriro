import { type Static, Type } from 'typebox'

export const FileScanStatus = Type.Union([
	Type.Literal('pending'),
	Type.Literal('clean'),
	Type.Literal('infected'),
	Type.Literal('failed'),
	Type.Literal('unscanned')
])
export type FileScanStatus = Static<typeof FileScanStatus>

export const FileDto = Type.Object({
	id: Type.String({ format: 'uuid' }),
	workspaceId: Type.String({ format: 'uuid' }),
	uploadedBy: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
	filename: Type.String(),
	contentType: Type.String(),
	declaredContentType: Type.Union([Type.String(), Type.Null()]),
	byteSize: Type.Integer({ minimum: 0 }),
	checksum: Type.String(),
	scanStatus: FileScanStatus,
	scanDetail: Type.Union([Type.String(), Type.Null()]),
	reencoded: Type.Boolean(),
	createdAt: Type.String(),
	scannedAt: Type.Union([Type.String(), Type.Null()]),
	promotedAt: Type.Union([Type.String(), Type.Null()])
})
export type FileDto = Static<typeof FileDto>

export const InitUploadBody = Type.Object({
	filename: Type.String({ minLength: 1, maxLength: 255 }),
	contentType: Type.String({ minLength: 1, maxLength: 150 }),
	byteSize: Type.Integer({ minimum: 1, maximum: 26_214_400 })
})
export type InitUploadBody = Static<typeof InitUploadBody>

export const InitUploadResponse = Type.Object({
	file: FileDto,
	uploadUrl: Type.String(),
	maxBytes: Type.Integer({ minimum: 1 })
})
export type InitUploadResponse = Static<typeof InitUploadResponse>
