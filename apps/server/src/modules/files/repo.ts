import type { FileDto, FileScanStatus } from '@huriro/contracts'
import type { Queryable } from '@huriro/db'

export interface RawFileRow extends FileDto {
	readonly storageKey: string
	readonly quarantineKey: string | null
}

export async function insertPendingFileRow(
	tx: Queryable,
	args: {
		readonly id: string
		readonly workspaceId: string
		readonly uploadedBy: string
		readonly storageKey: string
		readonly quarantineKey: string
		readonly filename: string
		readonly declaredContentType: string
		readonly byteSize: number
		readonly checksum: string
	}
): Promise<RawFileRow> {
	const [row] = await tx<RawFileRow[]>`
		INSERT INTO files (
			id, workspace_id, uploaded_by, storage_key, quarantine_key,
			filename, content_type, declared_content_type, byte_size, checksum, scan_status
		)
		VALUES (
			${args.id},
			${args.workspaceId},
			${args.uploadedBy},
			${args.storageKey},
			${args.quarantineKey},
			${args.filename},
			${args.declaredContentType},
			${args.declaredContentType},
			${args.byteSize},
			${args.checksum},
			'pending'
		)
		RETURNING
			id,
			workspace_id AS "workspaceId",
			uploaded_by AS "uploadedBy",
			storage_key AS "storageKey",
			quarantine_key AS "quarantineKey",
			filename,
			content_type AS "contentType",
			declared_content_type AS "declaredContentType",
			byte_size::int AS "byteSize",
			checksum,
			scan_status AS "scanStatus",
			scan_detail AS "scanDetail",
			reencoded,
			created_at::text AS "createdAt",
			scanned_at::text AS "scannedAt",
			promoted_at::text AS "promotedAt"
	`
	if (!row) throw new Error('Failed to insert file row')
	return row
}

export async function getFileRowById(
	tx: Queryable,
	workspaceId: string,
	fileId: string
): Promise<RawFileRow | null> {
	const [row] = await tx<RawFileRow[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			uploaded_by AS "uploadedBy",
			storage_key AS "storageKey",
			quarantine_key AS "quarantineKey",
			filename,
			content_type AS "contentType",
			declared_content_type AS "declaredContentType",
			byte_size::int AS "byteSize",
			checksum,
			scan_status AS "scanStatus",
			scan_detail AS "scanDetail",
			reencoded,
			created_at::text AS "createdAt",
			scanned_at::text AS "scannedAt",
			promoted_at::text AS "promotedAt"
		FROM files
		WHERE workspace_id = ${workspaceId} AND id = ${fileId}
	`
	return row ?? null
}

export async function listFileRowsByIds(
	tx: Queryable,
	workspaceId: string,
	fileIds: readonly string[]
): Promise<FileDto[]> {
	if (fileIds.length === 0) return []
	return tx<FileDto[]>`
		SELECT
			id,
			workspace_id AS "workspaceId",
			uploaded_by AS "uploadedBy",
			filename,
			content_type AS "contentType",
			declared_content_type AS "declaredContentType",
			byte_size::int AS "byteSize",
			checksum,
			scan_status AS "scanStatus",
			scan_detail AS "scanDetail",
			reencoded,
			created_at::text AS "createdAt",
			scanned_at::text AS "scannedAt",
			promoted_at::text AS "promotedAt"
		FROM files
		WHERE workspace_id = ${workspaceId}
			AND id = ANY(${[...fileIds]}::uuid[])
	`
}

export async function updateFileUploadChecksum(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly fileId: string
		readonly byteSize: number
		readonly checksum: string
	}
): Promise<RawFileRow | null> {
	const [row] = await tx<RawFileRow[]>`
		UPDATE files
		SET byte_size = ${args.byteSize},
			checksum = ${args.checksum}
		WHERE workspace_id = ${args.workspaceId} AND id = ${args.fileId}
		RETURNING
			id,
			workspace_id AS "workspaceId",
			uploaded_by AS "uploadedBy",
			storage_key AS "storageKey",
			quarantine_key AS "quarantineKey",
			filename,
			content_type AS "contentType",
			declared_content_type AS "declaredContentType",
			byte_size::int AS "byteSize",
			checksum,
			scan_status AS "scanStatus",
			scan_detail AS "scanDetail",
			reencoded,
			created_at::text AS "createdAt",
			scanned_at::text AS "scannedAt",
			promoted_at::text AS "promotedAt"
	`
	return row ?? null
}

export async function updateFileScanResult(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly fileId: string
		readonly contentType: string
		readonly byteSize: number
		readonly checksum: string
		readonly scanStatus: FileScanStatus
		readonly scanDetail: string
		readonly reencoded: boolean
		readonly promoted: boolean
	}
): Promise<RawFileRow | null> {
	const [row] = await tx<RawFileRow[]>`
		UPDATE files
		SET content_type = ${args.contentType},
			byte_size = ${args.byteSize},
			checksum = ${args.checksum},
			scan_status = ${args.scanStatus},
			scan_detail = ${args.scanDetail},
			reencoded = ${args.reencoded},
			scanned_at = now(),
			promoted_at = CASE WHEN ${args.promoted} THEN now() ELSE promoted_at END
		WHERE workspace_id = ${args.workspaceId} AND id = ${args.fileId}
		RETURNING
			id,
			workspace_id AS "workspaceId",
			uploaded_by AS "uploadedBy",
			storage_key AS "storageKey",
			quarantine_key AS "quarantineKey",
			filename,
			content_type AS "contentType",
			declared_content_type AS "declaredContentType",
			byte_size::int AS "byteSize",
			checksum,
			scan_status AS "scanStatus",
			scan_detail AS "scanDetail",
			reencoded,
			created_at::text AS "createdAt",
			scanned_at::text AS "scannedAt",
			promoted_at::text AS "promotedAt"
	`
	return row ?? null
}
