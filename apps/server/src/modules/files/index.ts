import type { Sql } from '@huriro/db'
import { Elysia } from 'elysia'
import type { Auth } from '../identity'
import { workspaceDerive } from '../tenancy'
import { FileIdParam, InitUploadBody } from './schema'
import {
	finalizeFileUpload,
	getFileMetadata,
	getFilesByIdsForAttachment,
	initiateFileUpload,
	loadFileForDownload,
	processFileQuarantineOutboxEvent,
	sanitizeDisplayFilename,
	storeQuarantinedFileBytes
} from './service'
import { type BlobStorage, FilesystemBlobStorage, MemoryBlobStorage } from './storage'

export {
	type BlobStorage,
	FilesystemBlobStorage,
	getFilesByIdsForAttachment,
	MemoryBlobStorage,
	processFileQuarantineOutboxEvent
}

export function filesModule(
	sql: Sql,
	auth: Auth | null,
	storage: BlobStorage = new MemoryBlobStorage(),
	scanOpts?: { readonly clamavHost?: string | undefined; readonly clamavPort?: number | undefined }
) {
	return new Elysia({ name: 'huriro.files' })
		.derive(workspaceDerive(sql, auth))
		.post('/files/uploads', { body: InitUploadBody }, async ({ body, inWorkspace, set }) => {
			const res = await inWorkspace((tx, actor) => initiateFileUpload(tx, actor, body))
			set.status = 201
			return res
		})
		.put(
			'/files/uploads/:id/content',
			{ params: FileIdParam, parse: 'arrayBuffer' },
			async ({ params, body, request, inWorkspace }) => {
				const bytes =
					body instanceof ArrayBuffer
						? new Uint8Array(body)
						: body instanceof Uint8Array
							? body
							: new Uint8Array(await request.arrayBuffer())
				return inWorkspace((tx, actor) => storeQuarantinedFileBytes(tx, actor, params.id, bytes, storage))
			}
		)
		.post('/files/:id/finalize', { params: FileIdParam }, ({ params, inWorkspace }) =>
			inWorkspace((tx, actor) => finalizeFileUpload(tx, actor, params.id, storage, scanOpts))
		)
		.get('/files/:id', { params: FileIdParam }, ({ params, inWorkspace }) =>
			inWorkspace((tx, actor) => getFileMetadata(tx, actor, params.id))
		)
		.get('/files/:id/download', { params: FileIdParam }, async ({ params, inWorkspace }) => {
			const { file, bytes } = await inWorkspace((tx, actor) =>
				loadFileForDownload(tx, actor, params.id, storage)
			)
			const safeName = sanitizeDisplayFilename(file.filename)
			return new Response(bytes as unknown as BodyInit, {
				status: 200,
				headers: {
					'content-type': file.contentType,
					'content-length': String(bytes.byteLength),
					'content-disposition': `attachment; filename="${safeName}"`,
					'content-security-policy': 'sandbox',
					'x-content-type-options': 'nosniff',
					'cache-control': 'private, max-age=3600'
				}
			})
		})
}
