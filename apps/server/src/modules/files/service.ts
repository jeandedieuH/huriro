import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import type { FileDto, InitUploadBody, InitUploadResponse } from '@huriro/contracts'
import { type Queryable, uuid7 } from '@huriro/db'
import type { ActorContext } from '@huriro/domain'
import { HttpError } from '../../api/error'
import { fileScansTotal } from '../../api/observability'
import { FILES_EVENTS } from './events'
import { authorizeFileAction } from './policy'
import {
	getFileRowById,
	insertPendingFileRow,
	listFileRowsByIds,
	type RawFileRow,
	updateFileScanResult,
	updateFileUploadChecksum
} from './repo'
import { scanBufferForMalware, sniffContentType, stripImageMetadata } from './scanner'
import type { BlobStorage } from './storage'

export const MAX_FILE_UPLOAD_BYTES = 26_214_400 // 25 MiB

function toPublicFileDto(row: RawFileRow): FileDto {
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		uploadedBy: row.uploadedBy,
		filename: row.filename,
		contentType: row.contentType,
		declaredContentType: row.declaredContentType,
		byteSize: row.byteSize,
		checksum: row.checksum,
		scanStatus: row.scanStatus,
		scanDetail: row.scanDetail,
		reencoded: row.reencoded,
		createdAt: row.createdAt,
		scannedAt: row.scannedAt,
		promotedAt: row.promotedAt
	}
}

export function sanitizeDisplayFilename(raw: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: strip ASCII control characters
	const base = basename(raw).replace(/[\u0000-\u001F\u007F"\\;/<>]/g, '_')
	const trimmed = base.trim().slice(0, 200)
	return trimmed.length > 0 ? trimmed : 'attachment.bin'
}

function sha256Hex(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex')
}

export async function initiateFileUpload(
	tx: Queryable,
	actor: ActorContext,
	body: InitUploadBody
): Promise<InitUploadResponse> {
	authorizeFileAction(actor, 'file.write')
	if (body.byteSize > MAX_FILE_UPLOAD_BYTES) {
		throw new HttpError(413, 'file_too_large', 'Attachment exceeds 25 MB upload limit')
	}

	const id = uuid7()
	const quarantineKey = `quarantine/${actor.workspaceId}/${id}`
	const storageKey = `files/${actor.workspaceId}/${id}`
	const row = await insertPendingFileRow(tx, {
		id,
		workspaceId: actor.workspaceId,
		uploadedBy: actor.principalId,
		storageKey,
		quarantineKey,
		filename: sanitizeDisplayFilename(body.filename),
		declaredContentType: body.contentType,
		byteSize: body.byteSize,
		checksum: 'pending'
	})

	return {
		file: toPublicFileDto(row),
		uploadUrl: `/api/v1/files/uploads/${id}/content`,
		maxBytes: MAX_FILE_UPLOAD_BYTES
	}
}

export async function storeQuarantinedFileBytes(
	tx: Queryable,
	actor: ActorContext,
	fileId: string,
	rawBytes: Uint8Array,
	storage: BlobStorage
): Promise<FileDto> {
	authorizeFileAction(actor, 'file.write')
	if (rawBytes.byteLength === 0 || rawBytes.byteLength > MAX_FILE_UPLOAD_BYTES) {
		throw new HttpError(413, 'file_too_large', 'Upload payload must be between 1 byte and 25 MB')
	}

	const existing = await getFileRowById(tx, actor.workspaceId, fileId)
	if (!existing) throw new HttpError(404, 'not_found', 'File upload session not found')
	if (
		existing.uploadedBy &&
		existing.uploadedBy !== actor.principalId &&
		actor.roleKey !== 'admin' &&
		actor.roleKey !== 'owner'
	) {
		throw new HttpError(403, 'forbidden', 'Cannot overwrite another user upload session')
	}
	if (!existing.quarantineKey) {
		throw new HttpError(409, 'conflict', 'Upload session missing quarantine key')
	}

	await storage.putQuarantine(existing.quarantineKey, rawBytes)
	const updated = await updateFileUploadChecksum(tx, {
		workspaceId: actor.workspaceId,
		fileId: existing.id,
		byteSize: rawBytes.byteLength,
		checksum: sha256Hex(rawBytes)
	})
	if (!updated) throw new HttpError(404, 'not_found', 'File upload session not found')

	await tx`
		INSERT INTO outbox (workspace_id, aggregate, aggregate_id, event_type, payload)
		VALUES (
			${actor.workspaceId},
			'file',
			${updated.id},
			${FILES_EVENTS.Uploaded},
			${tx.json({ fileId: updated.id, actorId: actor.principalId } as never)}
		)
	`

	return toPublicFileDto(updated)
}

export async function scanAndPromoteQuarantinedFile(
	tx: Queryable,
	workspaceId: string,
	fileId: string,
	storage: BlobStorage,
	scanOpts?: { readonly clamavHost?: string | undefined; readonly clamavPort?: number | undefined }
): Promise<FileDto> {
	const existing = await getFileRowById(tx, workspaceId, fileId)
	if (!existing) throw new HttpError(404, 'not_found', 'File not found')
	if (existing.scanStatus !== 'pending') {
		return toPublicFileDto(existing)
	}
	if (!existing.quarantineKey) {
		throw new HttpError(409, 'conflict', 'Quarantine object missing')
	}

	const rawBytes = await storage.readQuarantine(existing.quarantineKey)
	const sniffedType = sniffContentType(rawBytes, existing.filename)
	const scan = await scanBufferForMalware(rawBytes, scanOpts)

	fileScansTotal.labels(scan.status).inc()

	if (scan.status === 'infected' || scan.status === 'failed') {
		if (scan.status === 'infected') {
			await storage.deleteObject(existing.quarantineKey).catch(() => {})
		}
		const blocked = await updateFileScanResult(tx, {
			workspaceId,
			fileId: existing.id,
			contentType: sniffedType,
			byteSize: rawBytes.byteLength,
			checksum: sha256Hex(rawBytes),
			scanStatus: scan.status,
			scanDetail: scan.detail,
			reencoded: false,
			promoted: false
		})
		await tx`
			INSERT INTO audit_log (workspace_id, actor_type, actor_id, action, target_type, target_id, metadata)
			VALUES (
				${workspaceId},
				'system',
				${existing.uploadedBy},
				'file.quarantine.rejected',
				'file',
				${existing.id},
				${tx.json({ status: scan.status, detail: scan.detail, sniffedType } as never)}
			)
		`
		return toPublicFileDto(blocked ?? existing)
	}

	const stripped = stripImageMetadata(rawBytes, sniffedType)
	await storage.promoteToFiles(existing.quarantineKey, existing.storageKey, stripped.bytes)
	const promoted = await updateFileScanResult(tx, {
		workspaceId,
		fileId: existing.id,
		contentType: sniffedType,
		byteSize: stripped.bytes.byteLength,
		checksum: sha256Hex(stripped.bytes),
		scanStatus: scan.status,
		scanDetail: scan.detail,
		reencoded: stripped.reencoded,
		promoted: true
	})

	await tx`
		INSERT INTO outbox (workspace_id, aggregate, aggregate_id, event_type, payload)
		VALUES (
			${workspaceId},
			'file',
			${existing.id},
			${FILES_EVENTS.Promoted},
			${tx.json({ fileId: existing.id, scanStatus: scan.status, contentType: sniffedType } as never)}
		)
	`

	return toPublicFileDto(promoted ?? existing)
}

export async function finalizeFileUpload(
	tx: Queryable,
	actor: ActorContext,
	fileId: string,
	storage: BlobStorage,
	scanOpts?: { readonly clamavHost?: string | undefined; readonly clamavPort?: number | undefined }
): Promise<FileDto> {
	authorizeFileAction(actor, 'file.write')
	return scanAndPromoteQuarantinedFile(tx, actor.workspaceId, fileId, storage, scanOpts)
}

export async function getFileMetadata(tx: Queryable, actor: ActorContext, fileId: string): Promise<FileDto> {
	authorizeFileAction(actor, 'file.read')
	const row = await getFileRowById(tx, actor.workspaceId, fileId)
	if (!row) throw new HttpError(404, 'not_found', 'File not found')
	return toPublicFileDto(row)
}

export async function loadFileForDownload(
	tx: Queryable,
	actor: ActorContext,
	fileId: string,
	storage: BlobStorage
): Promise<{ readonly file: FileDto; readonly bytes: Uint8Array }> {
	authorizeFileAction(actor, 'file.read')
	const row = await getFileRowById(tx, actor.workspaceId, fileId)
	if (!row) throw new HttpError(404, 'not_found', 'File not found')

	if (row.scanStatus === 'pending') {
		throw new HttpError(409, 'file_pending_scan', 'Attachment is still scanning in quarantine')
	}
	if (row.scanStatus === 'infected' || row.scanStatus === 'failed') {
		throw new HttpError(403, 'file_infected', 'Attachment blocked by malware quarantine')
	}

	const bytes = await storage.readFile(row.storageKey)
	return { file: toPublicFileDto(row), bytes }
}

export async function getFilesByIdsForAttachment(
	tx: Queryable,
	workspaceId: string,
	fileIds: readonly string[]
): Promise<FileDto[]> {
	return listFileRowsByIds(tx, workspaceId, fileIds)
}

export async function processFileQuarantineOutboxEvent(
	tx: Queryable,
	event: {
		readonly id: string
		readonly workspaceId: string | null
		readonly eventType: string
		readonly payload: Record<string, unknown>
	},
	storage: BlobStorage,
	scanOpts?: { readonly clamavHost?: string | undefined; readonly clamavPort?: number | undefined }
): Promise<boolean> {
	if (!event.workspaceId || event.eventType !== FILES_EVENTS.Uploaded) return false
	const claimed = await tx<{ eventId: string }[]>`
		INSERT INTO processed_events (consumer, event_id)
		VALUES ('files-quarantine', ${event.id})
		ON CONFLICT (consumer, event_id) DO NOTHING
		RETURNING event_id AS "eventId"
	`
	if (claimed.length === 0) return false
	const fileId = typeof event.payload['fileId'] === 'string' ? event.payload['fileId'] : null
	if (!fileId) return false
	await scanAndPromoteQuarantinedFile(tx, event.workspaceId, fileId, storage, scanOpts)
	return true
}
