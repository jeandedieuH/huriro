/**
 * Synced Blocks domain service & Hocuspocus room helpers (§4.2).
 */
import type {
	CollabTicketResponse,
	CreateSyncedBlockBody,
	DocSyncedBlockDto,
	UpdateSyncedBlockBody
} from '@huriro/contracts'
import { type Queryable, uuid7 } from '@huriro/db'
import { type ActorContext, can } from '@huriro/domain'
import {
	createEmptyYDocState,
	extractDocumentContent,
	markdownToProseMirrorJson,
	prosemirrorJsonToYDoc,
	replaceYDocContent
} from '@huriro/editor'
import * as Y from 'yjs'
import { HttpError } from '../../api/error'
import {
	type CollabTicketClaims,
	deriveCollabTicketKey,
	hashCollabTicket,
	signCollabTicket,
	TICKET_TTL_MS
} from './collab-ticket'
import { DOCS_EVENTS } from './events'
import { assertWithinMaxDocSize, authorizeWorkspaceDocAction, throwStaleVersion } from './page-access'
import { authorizeDocPage } from './policy'
import {
	auditDocsAction,
	consumeCollabTicketRow,
	emitDocsEvent,
	getDocPageById,
	insertCollabTicketRow
} from './repo'
import {
	acquireOrRenewSyncedBlockLease,
	expireSyncedBlockLease,
	getSyncedBlockRow,
	insertSyncedBlockRow,
	listSyncedBlockRows,
	mapSyncedBlockRow,
	saveFencedSyncedBlockState,
	saveUnfencedSyncedBlockState,
	updateSyncedBlockMetaRow
} from './repo-m9'

export function syncedBlockDocumentName(workspaceId: string, blockId: string): string {
	return `synced_block:${workspaceId}:${blockId}`
}

export async function listSyncedBlocks(
	tx: Queryable,
	actor: ActorContext,
	includeArchived = false
): Promise<DocSyncedBlockDto[]> {
	await authorizeWorkspaceDocAction(tx, actor, 'doc.read')
	const rows = await listSyncedBlockRows(tx, actor.workspaceId, includeArchived)
	return rows.map(mapSyncedBlockRow)
}

export async function getSyncedBlockDetail(
	tx: Queryable,
	actor: ActorContext,
	blockId: string
): Promise<DocSyncedBlockDto> {
	await authorizeWorkspaceDocAction(tx, actor, 'doc.read')
	const row = await getSyncedBlockRow(tx, actor.workspaceId, blockId)
	if (!row || row.archivedAt !== null) {
		throw new HttpError(404, 'not_found', 'Synced block not found')
	}
	return mapSyncedBlockRow(row)
}

export async function createSyncedBlock(
	tx: Queryable,
	actor: ActorContext,
	input: CreateSyncedBlockBody
): Promise<DocSyncedBlockDto> {
	await authorizeWorkspaceDocAction(tx, actor, 'doc.write')

	if (input.sourcePageId) {
		const page = await getDocPageById(tx, actor.workspaceId, input.sourcePageId, actor.userId)
		if (!page || page.archivedAt !== null) {
			throw new HttpError(404, 'not_found', 'Source document page not found')
		}
	}

	let ydoc = new Y.Doc()
	if (input.prosemirrorJson && typeof input.prosemirrorJson === 'object') {
		ydoc = prosemirrorJsonToYDoc(input.prosemirrorJson)
	} else if (input.markdown && input.markdown.trim().length > 0) {
		const pmJson = markdownToProseMirrorJson(input.markdown, `synced:${uuid7()}`)
		ydoc = prosemirrorJsonToYDoc(pmJson)
	} else {
		Y.applyUpdate(ydoc, createEmptyYDocState().state)
	}

	const stateBytes = Y.encodeStateAsUpdate(ydoc)
	const vectorBytes = Y.encodeStateVector(ydoc)
	assertWithinMaxDocSize(stateBytes)
	const extracted = extractDocumentContent(ydoc)

	const row = await insertSyncedBlockRow(tx, {
		workspaceId: actor.workspaceId,
		title: input.title?.trim() || 'Synced block',
		sourcePageId: input.sourcePageId ?? null,
		state: stateBytes,
		stateVector: vectorBytes,
		byteSize: stateBytes.byteLength,
		plainText: extracted.plainText,
		createdBy: actor.userId
	})

	await emitDocsEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'doc_synced_block',
		aggregateId: row.id,
		eventType: DOCS_EVENTS.SyncedBlockCreated,
		payload: { blockId: row.id, title: row.title, sourcePageId: row.sourcePageId, actorId: actor.principalId }
	})

	await auditDocsAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'doc.synced_block.created',
		targetType: 'doc_synced_block',
		targetId: row.id,
		metadata: { title: row.title }
	})

	return mapSyncedBlockRow(row)
}

export async function updateSyncedBlock(
	tx: Queryable,
	actor: ActorContext,
	blockId: string,
	input: UpdateSyncedBlockBody
): Promise<DocSyncedBlockDto> {
	await authorizeWorkspaceDocAction(tx, actor, 'doc.write')
	const existing = await getSyncedBlockRow(tx, actor.workspaceId, blockId)
	if (!existing || existing.archivedAt !== null) {
		throw new HttpError(404, 'not_found', 'Synced block not found')
	}
	if (existing.version !== input.version) {
		throwStaleVersion(
			'Synced block',
			existing.version,
			input.version,
			mapSyncedBlockRow(existing) as unknown as Record<string, unknown>
		)
	}

	const nextArchivedAt =
		input.archived === true ? new Date().toISOString() : input.archived === false ? null : existing.archivedAt

	const metaUpdated = await updateSyncedBlockMetaRow(tx, {
		workspaceId: actor.workspaceId,
		blockId: existing.id,
		expectedVersion: input.version,
		title: input.title ?? existing.title,
		archivedAt: nextArchivedAt
	})
	if (!metaUpdated) {
		const latest = await getSyncedBlockRow(tx, actor.workspaceId, blockId)
		throwStaleVersion(
			'Synced block',
			latest?.version ?? existing.version,
			input.version,
			mapSyncedBlockRow(latest ?? existing) as unknown as Record<string, unknown>
		)
	}

	if (input.markdown !== undefined) {
		const ydoc = new Y.Doc()
		Y.applyUpdate(ydoc, new Uint8Array(metaUpdated.state))
		const pmJson = markdownToProseMirrorJson(input.markdown, `synced:${existing.id}`)
		replaceYDocContent(ydoc, pmJson, 'huriro:synced_block:update')
		const nextState = Y.encodeStateAsUpdate(ydoc)
		const nextVector = Y.encodeStateVector(ydoc)
		assertWithinMaxDocSize(nextState)
		const extracted = extractDocumentContent(ydoc)
		await saveUnfencedSyncedBlockState(tx, {
			workspaceId: actor.workspaceId,
			blockId: existing.id,
			state: nextState,
			stateVector: nextVector,
			byteSize: nextState.byteLength,
			plainText: extracted.plainText
		})
	}

	await emitDocsEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'doc_synced_block',
		aggregateId: existing.id,
		eventType: DOCS_EVENTS.SyncedBlockUpdated,
		payload: { blockId: existing.id, title: input.title ?? existing.title, actorId: actor.principalId }
	})

	await auditDocsAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'doc.synced_block.updated',
		targetType: 'doc_synced_block',
		targetId: existing.id
	})

	const reloaded = await getSyncedBlockRow(tx, actor.workspaceId, existing.id)
	return mapSyncedBlockRow(reloaded ?? metaUpdated)
}

export async function archiveSyncedBlock(
	tx: Queryable,
	actor: ActorContext,
	blockId: string,
	version?: number
): Promise<DocSyncedBlockDto> {
	let expectedVersion = version
	if (expectedVersion === undefined) {
		const existing = await getSyncedBlockRow(tx, actor.workspaceId, blockId)
		if (!existing || existing.archivedAt !== null) {
			throw new HttpError(404, 'not_found', 'Synced block not found')
		}
		expectedVersion = existing.version
	}
	return updateSyncedBlock(tx, actor, blockId, { archived: true, version: expectedVersion })
}

function canActorWriteWorkspaceDocs(actor: ActorContext): boolean {
	return (
		can(actor, 'doc.write', {
			type: 'doc_page',
			id: actor.workspaceId,
			visibility: 'workspace',
			acl: null
		}).effect === 'allow'
	)
}

export async function issueSyncedBlockCollabTicket(
	tx: Queryable,
	actor: ActorContext,
	blockId: string,
	rawSecret: string,
	collabPath = '/collab'
): Promise<CollabTicketResponse> {
	await authorizeWorkspaceDocAction(tx, actor, 'doc.read')
	const block = await getSyncedBlockRow(tx, actor.workspaceId, blockId)
	if (!block || block.archivedAt !== null) {
		throw new HttpError(404, 'not_found', 'Synced block not found')
	}

	const permission: 'read' | 'write' = canActorWriteWorkspaceDocs(actor) ? 'write' : 'read'
	const jti = uuid7()
	const expiresAt = new Date(Date.now() + TICKET_TTL_MS)
	const key = deriveCollabTicketKey(rawSecret)
	const ticket = signCollabTicket(key, {
		jti,
		ws: actor.workspaceId,
		page: block.id,
		kind: 'synced_block',
		uid: actor.principalId,
		perm: permission,
		exp: expiresAt.getTime()
	})

	await insertCollabTicketRow(tx, {
		id: jti,
		workspaceId: actor.workspaceId,
		roomKind: 'synced_block',
		pageId: null,
		syncedBlockId: block.id,
		userId: actor.userId,
		permission,
		tokenHash: hashCollabTicket(ticket),
		expiresAt
	})

	return {
		ticket,
		documentName: syncedBlockDocumentName(actor.workspaceId, block.id),
		permission,
		expiresAt: expiresAt.toISOString(),
		collabUrl: collabPath
	}
}

export async function consumeAndAuthorizeSyncedBlockTicket(
	tx: Queryable,
	actor: ActorContext,
	claims: CollabTicketClaims,
	rawToken: string
): Promise<{ readonly permission: 'read' | 'write'; readonly readOnly: boolean }> {
	const consumed = await consumeCollabTicketRow(tx, {
		workspaceId: claims.ws,
		ticketId: claims.jti,
		roomKind: 'synced_block',
		syncedBlockId: claims.page,
		userId: claims.uid,
		tokenHash: hashCollabTicket(rawToken)
	})
	if (!consumed) {
		throw new HttpError(401, 'collab_ticket_invalid', 'Collaboration ticket is invalid, expired, or reused')
	}

	await authorizeDocPage(tx, actor, 'doc.read', { id: actor.workspaceId, visibility: 'workspace' }, null)
	const block = await getSyncedBlockRow(tx, actor.workspaceId, claims.page)
	if (!block || block.archivedAt !== null) {
		throw new HttpError(404, 'not_found', 'Synced block not found')
	}

	const effectivePerm: 'read' | 'write' =
		canActorWriteWorkspaceDocs(actor) && consumed.permission === 'write' ? 'write' : 'read'
	return { permission: effectivePerm, readOnly: effectivePerm !== 'write' }
}

export async function verifyLiveSyncedBlockAccess(
	tx: Queryable,
	actor: ActorContext,
	blockId: string
): Promise<{ readonly allowed: boolean; readonly canWrite: boolean }> {
	try {
		await authorizeDocPage(tx, actor, 'doc.read', { id: actor.workspaceId, visibility: 'workspace' }, null)
		const block = await getSyncedBlockRow(tx, actor.workspaceId, blockId)
		if (!block || block.archivedAt !== null) return { allowed: false, canWrite: false }
		return { allowed: true, canWrite: canActorWriteWorkspaceDocs(actor) }
	} catch {
		return { allowed: false, canWrite: false }
	}
}

export async function acquireSyncedBlockRoomAndState(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly blockId: string
		readonly nodeId: string
		readonly ttlMs: number
	}
): Promise<
	| { readonly acquired: true; readonly epoch: number; readonly state: Uint8Array }
	| { readonly acquired: false; readonly ownerNodeId: string; readonly epoch: number }
> {
	const block = await getSyncedBlockRow(tx, args.workspaceId, args.blockId)
	if (!block || block.archivedAt !== null) {
		throw new HttpError(404, 'not_found', 'Synced block not found')
	}
	const lease = await acquireOrRenewSyncedBlockLease(tx, args)
	if (!lease.acquired) {
		return { acquired: false, ownerNodeId: lease.nodeId, epoch: lease.epoch }
	}
	return { acquired: true, epoch: lease.epoch, state: new Uint8Array(block.state) }
}

export async function renewSyncedBlockRoomLease(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly blockId: string
		readonly nodeId: string
		readonly ttlMs: number
	}
): Promise<{ readonly acquired: boolean; readonly epoch: number; readonly ownerNodeId: string }> {
	const res = await acquireOrRenewSyncedBlockLease(tx, args)
	return { acquired: res.acquired, epoch: res.epoch, ownerNodeId: res.nodeId }
}

export async function releaseSyncedBlockRoomLease(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly blockId: string
		readonly nodeId: string
		readonly epoch: number
	}
): Promise<void> {
	await expireSyncedBlockLease(tx, args)
}

export async function persistSyncedBlockCollabState(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly blockId: string
		readonly nodeId: string
		readonly leaseEpoch: number
		readonly ydoc: Y.Doc
	}
): Promise<{ readonly fenced: boolean; readonly currentEpoch: number }> {
	const stateBytes = Y.encodeStateAsUpdate(args.ydoc)
	const stateVectorBytes = Y.encodeStateVector(args.ydoc)
	assertWithinMaxDocSize(stateBytes)
	const extracted = extractDocumentContent(args.ydoc)
	return saveFencedSyncedBlockState(tx, {
		workspaceId: args.workspaceId,
		blockId: args.blockId,
		nodeId: args.nodeId,
		leaseEpoch: args.leaseEpoch,
		state: stateBytes,
		stateVector: stateVectorBytes,
		byteSize: stateBytes.byteLength,
		plainText: extracted.plainText
	})
}
