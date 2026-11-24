import type { EraseAccountBody, EraseAccountResponse, WorkspaceExportDto } from '@huriro/contracts'
import { type Queryable, type Sql, uuid7 } from '@huriro/db'
import type { ActorContext } from '@huriro/domain'
import { HttpError } from '../../api/error'
import type { RealtimePubSub } from '../../realtime/pubsub'
import type { BlobStorage } from '../files'
import type { AuthSession } from '../identity'
import { GOVERNANCE_EVENTS } from './events'
import { authorizeWorkspaceExport } from './policy'
import {
	collectWorkspaceExportSnapshot,
	emitGovernanceOutbox,
	getWorkspaceExportRow,
	insertGovernanceAudit,
	insertWorkspaceExportRow,
	listWorkspaceExportRows,
	runEraseUserIdentity
} from './repo'

const EXPORT_TTL_MS = 24 * 60 * 60 * 1000

function toExportDto(row: WorkspaceExportDto & { storageKey?: string | null }): WorkspaceExportDto {
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		requestedBy: row.requestedBy,
		status: row.status,
		byteSize: row.byteSize,
		manifest: row.manifest,
		expiresAt: row.expiresAt,
		errorDetail: row.errorDetail,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	}
}

export async function listWorkspaceExports(
	tx: Queryable,
	actor: ActorContext
): Promise<WorkspaceExportDto[]> {
	authorizeWorkspaceExport(actor)
	return listWorkspaceExportRows(tx, actor.workspaceId)
}

export async function createWorkspaceExport(
	tx: Queryable,
	actor: ActorContext,
	storage: BlobStorage
): Promise<WorkspaceExportDto> {
	authorizeWorkspaceExport(actor)
	const exportId = uuid7()
	const snapshot = await collectWorkspaceExportSnapshot(tx, actor.workspaceId)
	const exportedAt = new Date().toISOString()
	const expiresAt = new Date(Date.now() + EXPORT_TTL_MS).toISOString()
	const bundle = {
		version: '1.0',
		exportedAt,
		workspaceId: actor.workspaceId,
		requestedBy: actor.userId,
		...snapshot
	}
	const bytes = new TextEncoder().encode(`${JSON.stringify(bundle, null, 2)}\n`)
	const storageKey = `exports/${actor.workspaceId}/${exportId}.json`
	const tmpKey = `exports/${actor.workspaceId}/.tmp-${exportId}`
	await storage.promoteToFiles(tmpKey, storageKey, bytes)

	const manifest = {
		members: snapshot.members.length,
		projects: snapshot.projects.length,
		issues: snapshot.issues.length,
		docPages: snapshot.docPages.length,
		chatChannels: snapshot.chatChannels.length,
		chatMessages: snapshot.chatMessages.length,
		mailConversations: snapshot.mailConversations.length,
		mailMessages: snapshot.mailMessages.length,
		auditSummary: snapshot.auditSummary.length
	}

	const created = await insertWorkspaceExportRow(tx, {
		id: exportId,
		workspaceId: actor.workspaceId,
		requestedBy: actor.userId,
		status: 'completed',
		storageKey,
		byteSize: bytes.byteLength,
		manifest,
		expiresAt
	})

	await insertGovernanceAudit(tx, {
		workspaceId: actor.workspaceId,
		actorId: actor.userId,
		action: 'governance.export.created',
		targetType: 'workspace_export',
		targetId: exportId,
		metadata: { byteSize: bytes.byteLength, manifest }
	})

	await emitGovernanceOutbox(tx, {
		workspaceId: actor.workspaceId,
		aggregateId: exportId,
		eventType: GOVERNANCE_EVENTS.WorkspaceExportCompleted,
		payload: {
			exportId,
			workspaceId: actor.workspaceId,
			requestedBy: actor.userId,
			byteSize: bytes.byteLength,
			manifest
		}
	})

	return toExportDto(created)
}

export async function downloadWorkspaceExport(
	tx: Queryable,
	actor: ActorContext,
	exportId: string,
	storage: BlobStorage
): Promise<{ readonly exportRow: WorkspaceExportDto; readonly bytes: Uint8Array }> {
	authorizeWorkspaceExport(actor)
	const row = await getWorkspaceExportRow(tx, actor.workspaceId, exportId)
	if (!row || !row.storageKey || row.status !== 'completed') {
		throw new HttpError(404, 'not_found', 'Workspace export not found or not ready')
	}
	if (row.expiresAt && Date.parse(row.expiresAt) <= Date.now()) {
		throw new HttpError(404, 'not_found', 'Workspace export has expired')
	}
	const bytes = await storage.readFile(row.storageKey).catch(() => {
		throw new HttpError(404, 'export_failed', 'Workspace export payload unavailable')
	})
	return { exportRow: toExportDto(row), bytes }
}

/**
 * GDPR Art. 17 self-service erasure (§22.2): validates explicit email
 * confirmation, executes `erase_user_identity`, audits, and revokes realtime
 * sockets across all affected workspaces.
 */
export async function eraseMyAccount(
	sql: Sql,
	session: AuthSession,
	body: EraseAccountBody,
	pubsub?: RealtimePubSub
): Promise<EraseAccountResponse> {
	if (body.confirmEmail.trim().toLowerCase() !== session.email.toLowerCase()) {
		throw new HttpError(422, 'validation_failed', 'Confirmation email does not match your account email')
	}

	const revokedWorkspaceIds = await sql.begin(async (tx) => {
		await tx`SELECT set_config('app.user_id', ${session.userId}, true)`
		const workspaceIds = await runEraseUserIdentity(tx, session.userId)
		await insertGovernanceAudit(tx, {
			workspaceId: null,
			actorId: session.userId,
			action: 'governance.account.erased',
			targetType: 'user',
			targetId: session.userId,
			metadata: { revokedWorkspaceCount: workspaceIds.length }
		})
		return workspaceIds
	})

	if (pubsub) {
		for (const wsId of revokedWorkspaceIds) {
			await pubsub.publishRevoke(wsId, session.userId, 'account_erased').catch(() => {})
		}
	}

	return {
		erased: true,
		userId: session.userId,
		revokedWorkspaceIds
	}
}
