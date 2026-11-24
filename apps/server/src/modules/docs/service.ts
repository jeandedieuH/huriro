/**
 * Docs domain service (§7.3, §8.4, §10):
 *   authorize → validate/version check → domain rows + outbox + audit
 *   → change_log cursor LAST in the same transaction.
 */
import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import type {
	CollabTicketResponse,
	CreateDocCommentBody,
	CreateDocPageBody,
	DocAppendBody,
	DocCommentDto,
	DocExportMarkdownResponse,
	DocImportMarkdownBody,
	DocPageDetailDto,
	DocPageDto,
	DocVersionDetailDto,
	DocVersionDto,
	MoveDocPageBody,
	ResolveDocCommentBody,
	SplitDocPageBody,
	UpdateDocCommentBody,
	UpdateDocPageBody
} from '@huriro/contracts'
import { isAcceptableClientId, type Queryable, uuid7 } from '@huriro/db'
import { type ActorContext, generateKeyBetween, needsRebalance, rebalanceKeys } from '@huriro/domain'
import {
	appendProseMirrorNodesToYDoc,
	createEmptyYDocState,
	DOCUMENT_SIZE_MAX_BYTES,
	DOCUMENT_SIZE_WARN_BYTES,
	diffVersionText,
	extractDocumentContent,
	extractPersonHandleMentions,
	getBuiltinDocTemplate,
	markdownToProseMirrorJson,
	type ProseMirrorNodeJson,
	prosemirrorJsonToYDoc,
	replaceYDocContent,
	resolveProseMirrorAnchor,
	resolveTextAnchor,
	ydocToMarkdown,
	ydocToProseMirrorJson
} from '@huriro/editor'
import * as Y from 'yjs'
import { appendChange, appendChanges, type ChangeLogEntry } from '../../api/changelog'
import { HttpError } from '../../api/error'
import { log } from '../../api/observability'
import { grantAcl, resolveResourceAcl } from '../tenancy'
import { DOCS_EVENTS } from './events'
import { authorizeDocPage, canActorDocPage, isAdminDocBypass } from './policy'
import {
	acquireOrRenewRoomLease,
	archiveDocSubtreeRows,
	auditDocsAction,
	consumeCollabTicketRow,
	deleteExpiredCollabTickets,
	docSlugExists,
	emitDocsEvent,
	expireRoomLease,
	getDocCommentById,
	getDocPageById,
	getDocPageBySlug,
	getDocStateRow,
	getDocVersionWithState,
	getLastSiblingDocPosition,
	getLatestAutoDocVersion,
	getPreviousDocVersionPlainText,
	getSubtreeMaxDepth,
	insertCollabTicketRow,
	insertDocCommentRow,
	insertDocPageRow,
	insertDocStateRow,
	insertDocVersionRow,
	listDocCommentsForPage,
	listDocVersionRows,
	listSiblingDocPositions,
	listVisibleDocPages,
	resolveDocCommentRow,
	saveFencedDocState,
	saveUnfencedDocState,
	setDocCommentAnchorOrphaned,
	setDocFavoriteRow,
	softDeleteDocCommentRow,
	thinAutoDocVersions,
	updateDocCommentRow,
	updateDocPageParentAndPosition,
	updateDocPageRow,
	updateDocPositionOnly
} from './repo'

const MAX_DOC_DEPTH = 20
const AUTO_VERSION_INTERVAL_MS = 10 * 60 * 1000
const TICKET_TTL_MS = 60 * 1000
const HKDF_SALT = Buffer.from('huriro-collab-ticket-salt', 'utf8')
const HKDF_INFO = Buffer.from('huriro-collab-ticket-v1', 'utf8')

export interface CollabDirectBridge {
	readonly replaceDocument?: (
		workspaceId: string,
		pageId: string,
		snapshotState: Uint8Array,
		origin: string,
		actorId?: string | null
	) => Promise<boolean>
	readonly appendNodes?: (
		workspaceId: string,
		pageId: string,
		nodes: readonly ProseMirrorNodeJson[],
		origin: string,
		actorId?: string | null
	) => Promise<boolean>
	readonly isRoomLoaded?: (workspaceId: string, pageId: string) => boolean
}

export interface CollabTicketClaims {
	readonly jti: string
	readonly ws: string
	readonly page: string
	readonly uid: string
	readonly perm: 'read' | 'write'
	readonly exp: number
}

export function deriveCollabTicketKey(rawSecret: string): Buffer {
	return Buffer.from(hkdfSync('sha256', Buffer.from(rawSecret, 'utf8'), HKDF_SALT, HKDF_INFO, 32))
}

function hashCollabTicket(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function signCollabTicket(key: Buffer, claims: CollabTicketClaims): string {
	const payloadB64 = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
	const sigB64 = createHmac('sha256', key).update(payloadB64, 'utf8').digest('base64url')
	return `${payloadB64}.${sigB64}`
}

export function verifyCollabTicketSignature(rawSecret: string, token: string): CollabTicketClaims | null {
	const dot = token.indexOf('.')
	if (dot <= 0 || dot === token.length - 1) return null
	const payloadB64 = token.slice(0, dot)
	const sigB64 = token.slice(dot + 1)
	const key = deriveCollabTicketKey(rawSecret)
	const expectedSig = createHmac('sha256', key).update(payloadB64, 'utf8').digest()
	let providedSig: Buffer
	try {
		providedSig = Buffer.from(sigB64, 'base64url')
	} catch {
		return null
	}
	if (expectedSig.length !== providedSig.length || !timingSafeEqual(expectedSig, providedSig)) {
		return null
	}
	try {
		const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as CollabTicketClaims
		if (
			typeof parsed.jti !== 'string' ||
			typeof parsed.ws !== 'string' ||
			typeof parsed.page !== 'string' ||
			typeof parsed.uid !== 'string' ||
			(parsed.perm !== 'read' && parsed.perm !== 'write') ||
			typeof parsed.exp !== 'number'
		) {
			return null
		}
		if (parsed.exp <= Date.now()) return null
		return parsed
	} catch {
		return null
	}
}

function assertValidClientId(id: string | undefined, label: string): void {
	if (id !== undefined && !isAcceptableClientId(id)) {
		throw new HttpError(
			422,
			'validation_failed',
			`Invalid client-supplied ${label}: must be UUIDv7 within ±24h window`
		)
	}
}

function throwStaleVersion(
	entityLabel: string,
	currentVersion: number,
	yourVersion: number,
	currentEntity: Record<string, unknown>,
	changedFields?: string[]
): never {
	throw new HttpError(409, 'stale_version', `${entityLabel} changed since you loaded it`, undefined, {
		currentVersion,
		yourVersion,
		currentEntity,
		...(changedFields ? { changedFields } : {})
	})
}

export function slugifyDocTitle(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 100)
		.replace(/-+$/g, '')
	return slug.length > 0 ? slug : 'untitled'
}

async function ensureUniqueDocSlug(
	tx: Queryable,
	workspaceId: string,
	requestedSlug: string | undefined,
	title: string,
	pageId: string
): Promise<string> {
	if (requestedSlug !== undefined) {
		const conflict = await docSlugExists(tx, workspaceId, requestedSlug, pageId)
		if (conflict) {
			throw new HttpError(409, 'conflict', `Document slug "${requestedSlug}" is already in use`)
		}
		return requestedSlug
	}
	const base = slugifyDocTitle(title)
	if (!(await docSlugExists(tx, workspaceId, base, pageId))) {
		return base
	}
	for (let i = 2; i <= 20; i++) {
		const candidate = `${base.slice(0, 96)}-${i}`
		if (!(await docSlugExists(tx, workspaceId, candidate, pageId))) {
			return candidate
		}
	}
	return `${base.slice(0, 90)}-${pageId.slice(0, 8)}`
}

async function authorizeWorkspaceDocAction(
	tx: Queryable,
	actor: ActorContext,
	action: 'doc.read' | 'doc.write'
): Promise<void> {
	await authorizeDocPage(tx, actor, action, { id: actor.workspaceId, visibility: 'workspace' }, null)
}

function assertWithinMaxDocSize(bytes: Uint8Array): void {
	if (bytes.byteLength > DOCUMENT_SIZE_MAX_BYTES) {
		throw new HttpError(413, 'doc_too_large', `Document size (${bytes.byteLength} bytes) exceeds 10 MB limit`)
	}
	if (bytes.byteLength > DOCUMENT_SIZE_WARN_BYTES) {
		log.warn({ byteSize: bytes.byteLength }, 'document exceeds 2 MB soft size threshold')
	}
}

async function rebalanceDocSiblings(
	tx: Queryable,
	workspaceId: string,
	parentId: string | null
): Promise<void> {
	const siblings = await listSiblingDocPositions(tx, workspaceId, parentId)
	if (siblings.length === 0) return
	const freshKeys = rebalanceKeys(siblings.length)
	for (let i = 0; i < siblings.length; i++) {
		const s = siblings[i]
		const key = freshKeys[i]
		if (s && key && s.position !== key) {
			await updateDocPositionOnly(tx, workspaceId, s.id, key)
		}
	}
}

async function requireDocPageAccess(
	tx: Queryable,
	actor: ActorContext,
	pageId: string,
	action: 'doc.read' | 'doc.comment' | 'doc.write' | 'doc.share'
): Promise<{ readonly page: DocPageDto; readonly canWrite: boolean; readonly canShare: boolean }> {
	const page = await getDocPageById(tx, actor.workspaceId, pageId, actor.userId)
	if (!page || page.archivedAt !== null) {
		throw new HttpError(404, 'not_found', 'Document page not found')
	}
	const acl = await resolveResourceAcl(tx, {
		workspaceId: actor.workspaceId,
		resourceType: 'doc_page',
		resourceId: page.id,
		userId: actor.userId
	})
	await authorizeDocPage(tx, actor, action, page, acl)
	return {
		page,
		canWrite: canActorDocPage(actor, 'doc.write', page, acl),
		canShare: canActorDocPage(actor, 'doc.share', page, acl)
	}
}

function buildDetailDto(args: {
	readonly page: DocPageDto
	readonly state: Buffer | Uint8Array
	readonly stateVector: Buffer | Uint8Array
	readonly byteSize: number
	readonly plainText: string
	readonly headings: readonly { blockId: string; level: number; text: string; offset: number }[]
	readonly comments: DocCommentDto[]
	readonly canWrite: boolean
	readonly canShare: boolean
}): DocPageDetailDto {
	return {
		page: args.page,
		stateBase64: Buffer.from(args.state).toString('base64'),
		stateVectorBase64: Buffer.from(args.stateVector).toString('base64'),
		byteSize: args.byteSize,
		plainText: args.plainText,
		headings: [...args.headings],
		comments: args.comments,
		canWrite: args.canWrite,
		canShare: args.canShare
	}
}

// ---------- Listing & Sync Helpers ----------

export async function listAccessibleDocPages(
	tx: Queryable,
	actor: ActorContext,
	query?: {
		readonly includeArchived?: boolean
		readonly includeTemplates?: boolean
		readonly parentId?: string
	}
): Promise<DocPageDto[]> {
	if (actor.membership !== 'active') return []
	return listVisibleDocPages(tx, {
		workspaceId: actor.workspaceId,
		userId: actor.userId,
		isGuest: actor.roleKey === 'guest',
		bypassAcl: isAdminDocBypass(actor),
		includeArchived: query?.includeArchived ?? false,
		includeTemplates: query?.includeTemplates ?? false,
		parentId: query?.parentId
	})
}

export async function listAccessibleDocPageIds(tx: Queryable, actor: ActorContext): Promise<Set<string>> {
	const pages = await listAccessibleDocPages(tx, actor, { includeTemplates: true })
	return new Set(pages.map((p) => p.id))
}

export async function getDocsSnapshotData(
	tx: Queryable,
	actor: ActorContext,
	scopePageId?: string
): Promise<{ readonly docPages: DocPageDto[] }> {
	const pages = await listAccessibleDocPages(tx, actor, { includeTemplates: true })
	if (!scopePageId) {
		return { docPages: pages }
	}
	return {
		docPages: pages.filter((p) => p.id === scopePageId || p.parentId === scopePageId)
	}
}

export async function getDocPageDetail(
	tx: Queryable,
	actor: ActorContext,
	pageId: string
): Promise<DocPageDetailDto> {
	const { page, canWrite, canShare } = await requireDocPageAccess(tx, actor, pageId, 'doc.read')
	const [stateRow, comments] = await Promise.all([
		getDocStateRow(tx, actor.workspaceId, page.id),
		listDocCommentsForPage(tx, actor.workspaceId, page.id)
	])
	if (!stateRow) {
		const empty = createEmptyYDocState()
		return buildDetailDto({
			page,
			state: empty.state,
			stateVector: empty.stateVector,
			byteSize: empty.state.byteLength,
			plainText: '',
			headings: [],
			comments,
			canWrite,
			canShare
		})
	}
	return buildDetailDto({
		page,
		state: stateRow.state,
		stateVector: stateRow.stateVector,
		byteSize: stateRow.byteSize,
		plainText: stateRow.plainText,
		headings: stateRow.headings,
		comments,
		canWrite,
		canShare
	})
}

export async function getDocPageBySlugDetail(
	tx: Queryable,
	actor: ActorContext,
	slug: string
): Promise<DocPageDetailDto> {
	const page = await getDocPageBySlug(tx, actor.workspaceId, slug, actor.userId)
	if (!page || page.archivedAt !== null) {
		throw new HttpError(404, 'not_found', 'Document page not found')
	}
	const acl = await resolveResourceAcl(tx, {
		workspaceId: actor.workspaceId,
		resourceType: 'doc_page',
		resourceId: page.id,
		userId: actor.userId
	})
	await authorizeDocPage(tx, actor, 'doc.read', page, acl)
	const [stateRow, comments] = await Promise.all([
		getDocStateRow(tx, actor.workspaceId, page.id),
		listDocCommentsForPage(tx, actor.workspaceId, page.id)
	])
	const canWrite = canActorDocPage(actor, 'doc.write', page, acl)
	const canShare = canActorDocPage(actor, 'doc.share', page, acl)
	if (!stateRow) {
		const empty = createEmptyYDocState()
		return buildDetailDto({
			page,
			state: empty.state,
			stateVector: empty.stateVector,
			byteSize: empty.state.byteLength,
			plainText: '',
			headings: [],
			comments,
			canWrite,
			canShare
		})
	}
	return buildDetailDto({
		page,
		state: stateRow.state,
		stateVector: stateRow.stateVector,
		byteSize: stateRow.byteSize,
		plainText: stateRow.plainText,
		headings: stateRow.headings,
		comments,
		canWrite,
		canShare
	})
}

// ---------- Page CRUD, Tree Move & Favorites ----------

export async function createDocPage(
	tx: Queryable,
	actor: ActorContext,
	input: CreateDocPageBody,
	opts?: { readonly skipChangeLog?: boolean }
): Promise<{ readonly data: DocPageDto; readonly cursor: number }> {
	assertValidClientId(input.id, 'doc_page.id')

	let parent: DocPageDto | null = null
	if (input.parentId) {
		const access = await requireDocPageAccess(tx, actor, input.parentId, 'doc.write')
		parent = access.page
		if (parent.depth + 1 > MAX_DOC_DEPTH) {
			throw new HttpError(422, 'validation_failed', `Maximum page nesting depth (${MAX_DOC_DEPTH}) reached`)
		}
	} else {
		await authorizeWorkspaceDocAction(tx, actor, 'doc.write')
	}

	const pageId = input.id ?? uuid7()
	const visibility = input.visibility ?? parent?.visibility ?? 'workspace'
	const slug = await ensureUniqueDocSlug(tx, actor.workspaceId, input.slug, input.title, pageId)
	const path = parent ? `${parent.path}/${pageId}` : pageId
	const depth = parent ? parent.depth + 1 : 0

	const lastPos = await getLastSiblingDocPosition(tx, actor.workspaceId, input.parentId ?? null)
	const position = input.position ?? generateKeyBetween(lastPos, null)

	let ydoc = new Y.Doc()
	if (input.markdown && input.markdown.trim().length > 0) {
		const pmJson = markdownToProseMirrorJson(input.markdown, `create:${pageId}`)
		ydoc = prosemirrorJsonToYDoc(pmJson)
	} else if (input.templateId) {
		const builtin = getBuiltinDocTemplate(input.templateId)
		if (builtin) {
			const pmJson = markdownToProseMirrorJson(builtin.markdown, `tpl:${builtin.id}`)
			ydoc = prosemirrorJsonToYDoc(pmJson)
		} else {
			const tplPage = await getDocPageById(tx, actor.workspaceId, input.templateId, actor.userId)
			if (!tplPage || tplPage.archivedAt !== null || !tplPage.isTemplate) {
				throw new HttpError(404, 'not_found', 'Document template not found')
			}
			const tplAcl = await resolveResourceAcl(tx, {
				workspaceId: actor.workspaceId,
				resourceType: 'doc_page',
				resourceId: tplPage.id,
				userId: actor.userId
			})
			await authorizeDocPage(tx, actor, 'doc.read', tplPage, tplAcl)
			const tplState = await getDocStateRow(tx, actor.workspaceId, tplPage.id)
			if (tplState) {
				const sourceDoc = new Y.Doc()
				Y.applyUpdate(sourceDoc, new Uint8Array(tplState.state))
				const json = ydocToProseMirrorJson(sourceDoc)
				ydoc = prosemirrorJsonToYDoc(json)
			} else {
				const empty = createEmptyYDocState()
				Y.applyUpdate(ydoc, empty.state)
			}
		}
	} else {
		const empty = createEmptyYDocState()
		Y.applyUpdate(ydoc, empty.state)
	}

	const stateBytes = Y.encodeStateAsUpdate(ydoc)
	const stateVectorBytes = Y.encodeStateVector(ydoc)
	assertWithinMaxDocSize(stateBytes)
	const extracted = extractDocumentContent(ydoc)

	const page = await insertDocPageRow(tx, {
		id: pageId,
		workspaceId: actor.workspaceId,
		parentId: input.parentId ?? null,
		path,
		depth,
		slug,
		title: input.title,
		icon: input.icon ?? null,
		visibility,
		isTemplate: input.isTemplate ?? false,
		position,
		createdBy: actor.userId,
		byteSize: stateBytes.byteLength
	})

	await insertDocStateRow(tx, {
		workspaceId: actor.workspaceId,
		pageId: page.id,
		state: stateBytes,
		stateVector: stateVectorBytes,
		byteSize: stateBytes.byteLength,
		plainText: extracted.plainText,
		headings: extracted.headings
	})

	await emitDocsEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'doc_page',
		aggregateId: page.id,
		eventType: DOCS_EVENTS.PageCreated,
		payload: {
			pageId: page.id,
			title: page.title,
			slug: page.slug,
			visibility: page.visibility,
			plainText: extracted.plainText,
			headings: extracted.headings,
			blocks: extracted.blocks,
			actorId: actor.principalId
		}
	})

	await auditDocsAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'doc.page.created',
		targetType: 'doc_page',
		targetId: page.id,
		metadata: { slug: page.slug, visibility: page.visibility }
	})

	if (visibility === 'private' && actor.kind === 'user') {
		await grantAcl(tx, {
			workspaceId: actor.workspaceId,
			resourceType: 'doc_page',
			resourceId: page.id,
			principalType: 'user',
			principalId: actor.userId,
			permission: 'manage',
			grantedBy: actor.userId
		})
	}

	const cursor = opts?.skipChangeLog
		? 0
		: await appendChange(tx, actor.workspaceId, {
				entityType: 'doc_page',
				entityId: page.id,
				action: 'upsert',
				scope: [`doc_page:${page.id}`, `visibility:${page.visibility}`],
				payload: page as unknown as Record<string, unknown>,
				actorId: actor.principalId
			})

	if (needsRebalance([position])) {
		await rebalanceDocSiblings(tx, actor.workspaceId, page.parentId)
	}

	return { data: page, cursor }
}

export async function updateDocPage(
	tx: Queryable,
	actor: ActorContext,
	pageId: string,
	input: UpdateDocPageBody
): Promise<{ readonly data: DocPageDto; readonly cursor: number }> {
	const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.write')

	if (input.visibility !== undefined && input.visibility !== page.visibility) {
		await requireDocPageAccess(tx, actor, pageId, 'doc.share')
	}

	if (page.version !== input.version) {
		throwStaleVersion(
			'Document page',
			page.version,
			input.version,
			page as unknown as Record<string, unknown>
		)
	}

	const nextSlug =
		input.slug !== undefined && input.slug !== page.slug
			? await ensureUniqueDocSlug(tx, actor.workspaceId, input.slug, input.title ?? page.title, page.id)
			: page.slug

	const nextVisibility = input.visibility ?? page.visibility
	const nextArchivedAt =
		input.archived === true ? new Date().toISOString() : input.archived === false ? null : page.archivedAt

	const updated = await updateDocPageRow(tx, {
		workspaceId: actor.workspaceId,
		pageId: page.id,
		userId: actor.userId,
		expectedVersion: input.version,
		title: input.title ?? page.title,
		slug: nextSlug,
		icon: input.icon === undefined ? page.icon : input.icon,
		visibility: nextVisibility,
		isTemplate: input.isTemplate ?? page.isTemplate,
		archivedAt: nextArchivedAt
	})

	if (!updated) {
		const latest = await getDocPageById(tx, actor.workspaceId, pageId, actor.userId)
		throwStaleVersion(
			'Document page',
			latest?.version ?? page.version,
			input.version,
			(latest ?? page) as unknown as Record<string, unknown>
		)
	}

	if (nextVisibility === 'private' && page.visibility === 'workspace' && actor.kind === 'user') {
		await grantAcl(tx, {
			workspaceId: actor.workspaceId,
			resourceType: 'doc_page',
			resourceId: updated.id,
			principalType: 'user',
			principalId: actor.userId,
			permission: 'manage',
			grantedBy: actor.userId
		})
	}

	const stateRow = await getDocStateRow(tx, actor.workspaceId, updated.id)
	await emitDocsEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'doc_page',
		aggregateId: updated.id,
		eventType: DOCS_EVENTS.PageUpdated,
		payload: {
			pageId: updated.id,
			title: updated.title,
			slug: updated.slug,
			visibility: updated.visibility,
			plainText: stateRow?.plainText ?? '',
			headings: stateRow?.headings ?? [],
			actorId: actor.principalId
		}
	})

	await auditDocsAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'doc.page.updated',
		targetType: 'doc_page',
		targetId: updated.id,
		metadata: { slug: updated.slug, visibility: updated.visibility }
	})

	const isNewlyArchived = page.archivedAt === null && updated.archivedAt !== null
	const changePayload: Record<string, unknown> = {
		...(updated as unknown as Record<string, unknown>),
		...(nextVisibility !== page.visibility ? { previousVisibility: page.visibility } : {})
	}
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'doc_page',
		entityId: updated.id,
		action: isNewlyArchived ? 'delete' : 'upsert',
		scope: [`doc_page:${updated.id}`, `visibility:${updated.visibility}`],
		payload: isNewlyArchived ? null : changePayload,
		actorId: actor.principalId
	})

	return { data: updated, cursor }
}

export async function moveDocPage(
	tx: Queryable,
	actor: ActorContext,
	pageId: string,
	input: MoveDocPageBody
): Promise<{ readonly data: DocPageDto; readonly rebalanced: boolean; readonly cursor: number }> {
	const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.write')
	if (page.version !== input.version) {
		throwStaleVersion(
			'Document page',
			page.version,
			input.version,
			page as unknown as Record<string, unknown>
		)
	}

	if (input.parentId === page.id) {
		throw new HttpError(422, 'validation_failed', 'Cannot move a page inside itself')
	}

	let targetParent: DocPageDto | null = null
	if (input.parentId !== null) {
		const parentAccess = await requireDocPageAccess(tx, actor, input.parentId, 'doc.write')
		targetParent = parentAccess.page
		if (targetParent.path === page.path || targetParent.path.startsWith(`${page.path}/`)) {
			throw new HttpError(422, 'validation_failed', 'Cannot move a page into its own descendant')
		}
	}

	const maxSubtreeDepth = await getSubtreeMaxDepth(tx, actor.workspaceId, page.path)
	const subtreeHeight = Math.max(0, maxSubtreeDepth - page.depth)
	const newDepth = targetParent ? targetParent.depth + 1 : 0
	if (newDepth + subtreeHeight > MAX_DOC_DEPTH) {
		throw new HttpError(
			422,
			'validation_failed',
			`Move exceeds maximum page nesting depth (${MAX_DOC_DEPTH})`
		)
	}

	const siblings = await listSiblingDocPositions(tx, actor.workspaceId, input.parentId)
	const otherSiblings = siblings.filter((s) => s.id !== page.id)
	let newPosition: string
	if (input.position) {
		newPosition = input.position
	} else {
		const afterItem = input.afterPageId ? otherSiblings.find((s) => s.id === input.afterPageId) : undefined
		const beforeItem = input.beforePageId ? otherSiblings.find((s) => s.id === input.beforePageId) : undefined
		let lower = afterItem?.position ?? null
		let upper = beforeItem?.position ?? null
		if (!afterItem && !beforeItem) {
			lower = otherSiblings.at(-1)?.position ?? null
		} else if (afterItem && !beforeItem) {
			const idx = otherSiblings.findIndex((s) => s.id === afterItem.id)
			upper = idx >= 0 ? (otherSiblings[idx + 1]?.position ?? null) : null
		} else if (!afterItem && beforeItem) {
			const idx = otherSiblings.findIndex((s) => s.id === beforeItem.id)
			lower = idx > 0 ? (otherSiblings[idx - 1]?.position ?? null) : null
		}
		if (lower !== null && upper !== null && lower >= upper) {
			await rebalanceDocSiblings(tx, actor.workspaceId, input.parentId)
			const rebalancedSibs = (await listSiblingDocPositions(tx, actor.workspaceId, input.parentId)).filter(
				(s) => s.id !== page.id
			)
			const a = input.afterPageId
				? (rebalancedSibs.find((s) => s.id === input.afterPageId)?.position ?? null)
				: null
			const b = input.beforePageId
				? (rebalancedSibs.find((s) => s.id === input.beforePageId)?.position ?? null)
				: null
			newPosition = generateKeyBetween(a, b)
		} else {
			newPosition = generateKeyBetween(lower, upper)
		}
	}

	const newPath = targetParent ? `${targetParent.path}/${page.id}` : page.id
	const { updated, movedIds } = await updateDocPageParentAndPosition(tx, {
		workspaceId: actor.workspaceId,
		pageId: page.id,
		userId: actor.userId,
		expectedVersion: input.version,
		newParentId: input.parentId,
		newPosition,
		oldPath: page.path,
		newPath,
		oldDepth: page.depth,
		newDepth
	})

	if (!updated) {
		const latest = await getDocPageById(tx, actor.workspaceId, pageId, actor.userId)
		throwStaleVersion(
			'Document page',
			latest?.version ?? page.version,
			input.version,
			(latest ?? page) as unknown as Record<string, unknown>
		)
	}

	const didRebalance = needsRebalance([newPosition])
	if (didRebalance) {
		await rebalanceDocSiblings(tx, actor.workspaceId, input.parentId)
	}

	await emitDocsEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'doc_page',
		aggregateId: updated.id,
		eventType: DOCS_EVENTS.PageMoved,
		payload: {
			pageId: updated.id,
			parentId: updated.parentId,
			movedIds,
			actorId: actor.principalId
		}
	})

	await auditDocsAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'doc.page.moved',
		targetType: 'doc_page',
		targetId: updated.id,
		metadata: { parentId: updated.parentId, movedCount: movedIds.length }
	})

	const changes: ChangeLogEntry[] = []
	for (const id of movedIds) {
		const movedRow =
			id === updated.id ? updated : await getDocPageById(tx, actor.workspaceId, id, actor.userId)
		if (!movedRow) continue
		changes.push({
			entityType: 'doc_page',
			entityId: movedRow.id,
			action: 'reorder',
			scope: [`doc_page:${movedRow.id}`, `visibility:${movedRow.visibility}`],
			payload: movedRow as unknown as Record<string, unknown>,
			actorId: actor.principalId
		})
	}
	const cursor = await appendChanges(tx, actor.workspaceId, changes)

	return { data: updated, rebalanced: didRebalance, cursor }
}

export async function deleteDocPage(
	tx: Queryable,
	actor: ActorContext,
	pageId: string,
	expectedVersion?: number
): Promise<{ readonly id: string; readonly archivedIds: string[]; readonly cursor: number }> {
	const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.write')
	if (expectedVersion !== undefined && page.version !== expectedVersion) {
		throwStaleVersion(
			'Document page',
			page.version,
			expectedVersion,
			page as unknown as Record<string, unknown>
		)
	}

	const archived = await archiveDocSubtreeRows(tx, actor.workspaceId, page.path)
	const archivedIds = archived.map((r) => r.id)
	for (const row of archived) {
		await emitDocsEvent(tx, {
			workspaceId: actor.workspaceId,
			aggregate: 'doc_page',
			aggregateId: row.id,
			eventType: DOCS_EVENTS.PageDeleted,
			payload: { pageId: row.id, title: row.title, slug: row.slug, actorId: actor.principalId }
		})
	}

	await auditDocsAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'doc.page.deleted',
		targetType: 'doc_page',
		targetId: page.id,
		metadata: { archivedCount: archivedIds.length }
	})

	const changes: ChangeLogEntry[] = archived.map((row) => ({
		entityType: 'doc_page',
		entityId: row.id,
		action: 'delete',
		scope: [`doc_page:${row.id}`, `visibility:${row.visibility}`],
		payload: null,
		actorId: actor.principalId
	}))
	const cursor = await appendChanges(tx, actor.workspaceId, changes)

	return { id: page.id, archivedIds, cursor }
}

export async function setDocFavorite(
	tx: Queryable,
	actor: ActorContext,
	pageId: string,
	favorite: boolean
): Promise<{ readonly data: DocPageDto }> {
	await requireDocPageAccess(tx, actor, pageId, 'doc.read')
	await setDocFavoriteRow(tx, actor.workspaceId, actor.principalId, pageId, favorite)
	const refreshed = await getDocPageById(tx, actor.workspaceId, pageId, actor.userId)
	if (!refreshed) throw new HttpError(404, 'not_found', 'Document page not found')
	return { data: refreshed }
}

// ---------- Split, Append, Import & Export ----------

export async function splitDocPage(
	tx: Queryable,
	actor: ActorContext,
	pageId: string,
	input: SplitDocPageBody
): Promise<{ readonly data: DocPageDto; readonly cursor: number }> {
	const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.write')
	let markdown = input.markdown ?? ''
	if (!markdown && input.headingBlockId) {
		const stateRow = await getDocStateRow(tx, actor.workspaceId, page.id)
		if (stateRow) {
			const ydoc = new Y.Doc()
			Y.applyUpdate(ydoc, new Uint8Array(stateRow.state))
			const json = ydocToProseMirrorJson(ydoc)
			const content = Array.isArray(json['content']) ? (json['content'] as ProseMirrorNodeJson[]) : []
			const idx = content.findIndex((n) => n.attrs?.['blockId'] === input.headingBlockId)
			if (idx >= 0) {
				const slice: ProseMirrorNodeJson[] = [content[idx]!]
				const startLevel = Number(content[idx]!.attrs?.['level'] ?? 2)
				for (let i = idx + 1; i < content.length; i++) {
					const node = content[i]
					if (!node) break
					if (node.type === 'heading' && Number(node.attrs?.['level'] ?? 2) <= startLevel) break
					slice.push(node)
				}
				const subDoc = prosemirrorJsonToYDoc({ type: 'doc', content: slice })
				markdown = ydocToMarkdown(subDoc)
			}
		}
	}

	const created = await createDocPage(tx, actor, {
		parentId: page.depth < MAX_DOC_DEPTH ? page.id : page.parentId,
		title: input.title,
		visibility: page.visibility,
		...(markdown.length > 0 ? { markdown } : {})
	})
	return created
}

export async function appendToDocPage(
	tx: Queryable,
	actor: ActorContext,
	pageId: string,
	input: DocAppendBody,
	hasCollabBridge: boolean
): Promise<{
	readonly nodes: ProseMirrorNodeJson[]
	readonly cursor: number
	readonly appliedInDb: boolean
}> {
	const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.write')
	const pmJson = markdownToProseMirrorJson(input.markdown, `append:${pageId}:${Date.now()}`)
	const nodes = Array.isArray(pmJson['content']) ? (pmJson['content'] as ProseMirrorNodeJson[]) : []

	if (hasCollabBridge) {
		await auditDocsAction(tx, {
			workspaceId: actor.workspaceId,
			actorType: actor.kind === 'agent' ? 'agent' : 'user',
			actorId: actor.principalId,
			action: 'doc.page.appended',
			targetType: 'doc_page',
			targetId: page.id,
			metadata: { origin: input.origin ?? 'api:append', nodeCount: nodes.length }
		})
		const { lastCursor } = await getWorkspaceCursorBoundsFast(tx, actor.workspaceId)
		return { nodes, cursor: lastCursor, appliedInDb: false }
	}

	const stateRow = await getDocStateRow(tx, actor.workspaceId, page.id)
	const ydoc = new Y.Doc()
	if (stateRow) {
		Y.applyUpdate(ydoc, new Uint8Array(stateRow.state))
	} else {
		Y.applyUpdate(ydoc, createEmptyYDocState().state)
	}
	appendProseMirrorNodesToYDoc(
		ydoc,
		nodes as unknown as Record<string, unknown>[],
		input.origin ?? 'api:append'
	)

	const nextState = Y.encodeStateAsUpdate(ydoc)
	const nextVector = Y.encodeStateVector(ydoc)
	assertWithinMaxDocSize(nextState)
	const extracted = extractDocumentContent(ydoc)

	await saveUnfencedDocState(tx, {
		workspaceId: actor.workspaceId,
		pageId: page.id,
		state: nextState,
		stateVector: nextVector,
		byteSize: nextState.byteLength,
		plainText: extracted.plainText,
		headings: extracted.headings
	})

	await emitDocsEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'doc_page',
		aggregateId: page.id,
		eventType: DOCS_EVENTS.StateSaved,
		payload: {
			pageId: page.id,
			title: page.title,
			slug: page.slug,
			visibility: page.visibility,
			plainText: extracted.plainText,
			headings: extracted.headings,
			blocks: extracted.blocks,
			newMentionUserIds: [],
			newMentionHandles: [],
			actorId: actor.principalId
		}
	})

	await auditDocsAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'doc.page.appended',
		targetType: 'doc_page',
		targetId: page.id,
		metadata: { origin: input.origin ?? 'api:append', nodeCount: nodes.length }
	})

	const updatedPage = await getDocPageById(tx, actor.workspaceId, page.id, actor.userId)
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'doc_page',
		entityId: page.id,
		action: 'upsert',
		scope: [`doc_page:${page.id}`, `visibility:${page.visibility}`],
		payload: (updatedPage ?? page) as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})

	return { nodes, cursor, appliedInDb: true }
}

async function getWorkspaceCursorBoundsFast(
	tx: Queryable,
	workspaceId: string
): Promise<{ lastCursor: number }> {
	const [row] = await tx<{ lastCursor: string | number }[]>`
		SELECT last_cursor AS "lastCursor" FROM workspace_seq WHERE workspace_id = ${workspaceId}
	`
	return { lastCursor: row ? Number(row.lastCursor) : 0 }
}

export async function exportDocPageMarkdown(
	tx: Queryable,
	actor: ActorContext,
	pageId: string
): Promise<DocExportMarkdownResponse> {
	const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.read')
	const stateRow = await getDocStateRow(tx, actor.workspaceId, page.id)
	const ydoc = new Y.Doc()
	if (stateRow) {
		Y.applyUpdate(ydoc, new Uint8Array(stateRow.state))
	} else {
		Y.applyUpdate(ydoc, createEmptyYDocState().state)
	}
	return {
		pageId: page.id,
		slug: page.slug,
		title: page.title,
		markdown: ydocToMarkdown(ydoc)
	}
}

export async function importDocPageMarkdown(
	tx: Queryable,
	actor: ActorContext,
	input: DocImportMarkdownBody
): Promise<{ readonly data: DocPageDto; readonly cursor: number }> {
	let inferredTitle = input.title
	if (!inferredTitle) {
		const headingMatch = /^\s*#\s+(.+)$/m.exec(input.markdown)
		inferredTitle = headingMatch?.[1]?.trim() || 'Imported Document'
	}
	return createDocPage(tx, actor, {
		parentId: input.parentId ?? null,
		title: inferredTitle.slice(0, 200),
		visibility: input.visibility ?? 'workspace',
		markdown: input.markdown
	})
}

// ---------- Collab Tickets & Room Lease Persistence ----------

export async function issueCollabTicket(
	tx: Queryable,
	actor: ActorContext,
	pageId: string,
	rawSecret: string,
	collabPath = '/collab'
): Promise<CollabTicketResponse> {
	const { page, canWrite } = await requireDocPageAccess(tx, actor, pageId, 'doc.read')
	const permission: 'read' | 'write' = canWrite ? 'write' : 'read'
	const jti = uuid7()
	const expiresAt = new Date(Date.now() + TICKET_TTL_MS)
	const key = deriveCollabTicketKey(rawSecret)
	const ticket = signCollabTicket(key, {
		jti,
		ws: actor.workspaceId,
		page: page.id,
		uid: actor.principalId,
		perm: permission,
		exp: expiresAt.getTime()
	})

	await insertCollabTicketRow(tx, {
		id: jti,
		workspaceId: actor.workspaceId,
		pageId: page.id,
		userId: actor.userId,
		permission,
		tokenHash: hashCollabTicket(ticket),
		expiresAt
	})

	return {
		ticket,
		documentName: `${actor.workspaceId}:${page.id}`,
		permission,
		expiresAt: expiresAt.toISOString(),
		collabUrl: collabPath
	}
}

export async function consumeAndAuthorizeCollabTicket(
	tx: Queryable,
	actor: ActorContext,
	claims: CollabTicketClaims,
	rawToken: string
): Promise<{ readonly permission: 'read' | 'write'; readonly readOnly: boolean }> {
	const consumed = await consumeCollabTicketRow(tx, {
		workspaceId: claims.ws,
		ticketId: claims.jti,
		pageId: claims.page,
		userId: claims.uid,
		tokenHash: hashCollabTicket(rawToken)
	})
	if (!consumed) {
		throw new HttpError(401, 'collab_ticket_invalid', 'Collaboration ticket is invalid, expired, or reused')
	}

	const { canWrite } = await requireDocPageAccess(tx, actor, claims.page, 'doc.read')
	const effectivePerm: 'read' | 'write' = canWrite && consumed.permission === 'write' ? 'write' : 'read'
	return {
		permission: effectivePerm,
		readOnly: effectivePerm !== 'write'
	}
}

export async function verifyLiveCollabSessionAccess(
	tx: Queryable,
	actor: ActorContext,
	pageId: string
): Promise<{ readonly allowed: boolean; readonly canWrite: boolean }> {
	try {
		const { canWrite } = await requireDocPageAccess(tx, actor, pageId, 'doc.read')
		return { allowed: true, canWrite }
	} catch {
		return { allowed: false, canWrite: false }
	}
}

export async function acquireCollabRoomAndState(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly pageId: string
		readonly nodeId: string
		readonly ttlMs: number
	}
): Promise<
	| {
			readonly acquired: true
			readonly epoch: number
			readonly state: Uint8Array
	  }
	| {
			readonly acquired: false
			readonly ownerNodeId: string
			readonly epoch: number
	  }
> {
	const page = await tx<{ id: string }[]>`
		SELECT id FROM doc_pages
		WHERE workspace_id = ${args.workspaceId} AND id = ${args.pageId} AND archived_at IS NULL
	`
	if (page.length === 0) {
		throw new HttpError(404, 'not_found', 'Document page not found')
	}

	const lease = await acquireOrRenewRoomLease(tx, {
		workspaceId: args.workspaceId,
		pageId: args.pageId,
		nodeId: args.nodeId,
		ttlMs: args.ttlMs
	})
	if (!lease.acquired) {
		return { acquired: false, ownerNodeId: lease.nodeId, epoch: lease.epoch }
	}

	const stateRow = await getDocStateRow(tx, args.workspaceId, args.pageId)
	return {
		acquired: true,
		epoch: lease.epoch,
		state: stateRow ? new Uint8Array(stateRow.state) : createEmptyYDocState().state
	}
}

export async function renewCollabRoomLease(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly pageId: string
		readonly nodeId: string
		readonly ttlMs: number
	}
): Promise<{ readonly acquired: boolean; readonly epoch: number; readonly ownerNodeId: string }> {
	const res = await acquireOrRenewRoomLease(tx, args)
	return { acquired: res.acquired, epoch: res.epoch, ownerNodeId: res.nodeId }
}

export async function releaseCollabRoomLease(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly pageId: string
		readonly nodeId: string
		readonly epoch: number
	}
): Promise<void> {
	await expireRoomLease(tx, args)
}

export async function persistCollabDocumentState(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly pageId: string
		readonly nodeId: string
		readonly leaseEpoch: number
		readonly ydoc: Y.Doc
		readonly authorUserIds: readonly string[]
		readonly actorId: string | null
	}
): Promise<{ readonly fenced: boolean; readonly currentEpoch: number; readonly cursor: number | null }> {
	const stateBytes = Y.encodeStateAsUpdate(args.ydoc)
	const stateVectorBytes = Y.encodeStateVector(args.ydoc)
	assertWithinMaxDocSize(stateBytes)

	const prevState = await getDocStateRow(tx, args.workspaceId, args.pageId)
	let prevMentions = new Set<string>()
	let prevHandles = new Set<string>()
	if (prevState) {
		const prevDoc = new Y.Doc()
		Y.applyUpdate(prevDoc, new Uint8Array(prevState.state))
		const prevExtracted = extractDocumentContent(prevDoc)
		prevMentions = new Set(
			prevExtracted.mentions.filter((m) => m.entityType === 'person').map((m) => m.entityId)
		)
		prevHandles = new Set(extractPersonHandleMentions(prevState.plainText))
	}

	const extracted = extractDocumentContent(args.ydoc)
	const saved = await saveFencedDocState(tx, {
		workspaceId: args.workspaceId,
		pageId: args.pageId,
		nodeId: args.nodeId,
		leaseEpoch: args.leaseEpoch,
		state: stateBytes,
		stateVector: stateVectorBytes,
		byteSize: stateBytes.byteLength,
		plainText: extracted.plainText,
		headings: extracted.headings
	})

	if (saved.fenced) {
		return { fenced: true, currentEpoch: saved.currentEpoch, cursor: null }
	}

	const [page] = await tx<{ id: string; title: string; slug: string; visibility: 'workspace' | 'private' }[]>`
		SELECT id, title, slug, visibility
		FROM doc_pages
		WHERE workspace_id = ${args.workspaceId} AND id = ${args.pageId} AND archived_at IS NULL
	`
	if (!page) {
		return { fenced: false, currentEpoch: args.leaseEpoch, cursor: null }
	}

	const latestAuto = await getLatestAutoDocVersion(tx, args.workspaceId, args.pageId)
	const shouldAutoCheckpoint =
		extracted.plainText.trim().length > 0 &&
		(!latestAuto ||
			(Date.now() - latestAuto.createdAtMs >= AUTO_VERSION_INTERVAL_MS &&
				latestAuto.plainText !== extracted.plainText))
	if (shouldAutoCheckpoint) {
		await insertDocVersionRow(tx, {
			workspaceId: args.workspaceId,
			pageId: args.pageId,
			kind: 'auto',
			label: null,
			state: stateBytes,
			byteSize: stateBytes.byteLength,
			plainText: extracted.plainText,
			authors: args.authorUserIds,
			createdBy: args.actorId
		})
	}

	await syncCommentAnchorOrphanStates(tx, args.workspaceId, args.pageId, args.ydoc)

	const nextMentionUserIds = extracted.mentions
		.filter((m) => m.entityType === 'person' && !prevMentions.has(m.entityId))
		.map((m) => m.entityId)
	const nextMentionHandles = extractPersonHandleMentions(extracted.plainText).filter(
		(h) => !prevHandles.has(h)
	)

	await emitDocsEvent(tx, {
		workspaceId: args.workspaceId,
		aggregate: 'doc_page',
		aggregateId: args.pageId,
		eventType: DOCS_EVENTS.StateSaved,
		payload: {
			pageId: page.id,
			title: page.title,
			slug: page.slug,
			visibility: page.visibility,
			plainText: extracted.plainText,
			headings: extracted.headings,
			blocks: extracted.blocks,
			newMentionUserIds: nextMentionUserIds,
			newMentionHandles: nextMentionHandles,
			actorId: args.actorId
		}
	})

	const updatedPage = await getDocPageById(
		tx,
		args.workspaceId,
		args.pageId,
		args.actorId ?? args.workspaceId
	)
	const cursor = await appendChange(tx, args.workspaceId, {
		entityType: 'doc_page',
		entityId: args.pageId,
		action: 'upsert',
		scope: [`doc_page:${args.pageId}`, `visibility:${page.visibility}`],
		payload: (updatedPage ?? page) as unknown as Record<string, unknown>,
		actorId: args.actorId
	})

	return { fenced: false, currentEpoch: args.leaseEpoch, cursor }
}

async function syncCommentAnchorOrphanStates(
	tx: Queryable,
	workspaceId: string,
	pageId: string,
	ydoc: Y.Doc
): Promise<void> {
	const comments = await listDocCommentsForPage(tx, workspaceId, pageId)
	for (const c of comments) {
		if (!c.anchorFrom || !c.anchorTo) continue
		const resolved = resolveTextAnchor(ydoc, c.anchorFrom, c.anchorTo)
		const orphaned = resolved.status === 'orphaned'
		if (orphaned !== c.anchorOrphaned) {
			await setDocCommentAnchorOrphaned(tx, workspaceId, c.id, orphaned)
		}
	}
}

// ---------- Versions & Non-Destructive Restore (§10.4) ----------

export async function listDocVersions(
	tx: Queryable,
	actor: ActorContext,
	pageId: string
): Promise<DocVersionDto[]> {
	await requireDocPageAccess(tx, actor, pageId, 'doc.read')
	return listDocVersionRows(tx, actor.workspaceId, pageId)
}

export async function createNamedDocVersion(
	tx: Queryable,
	actor: ActorContext,
	pageId: string,
	label: string
): Promise<{ readonly data: DocVersionDto }> {
	const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.write')
	const stateRow = await getDocStateRow(tx, actor.workspaceId, page.id)
	const stateBytes = stateRow ? new Uint8Array(stateRow.state) : createEmptyYDocState().state
	const plainText = stateRow?.plainText ?? ''

	const version = await insertDocVersionRow(tx, {
		workspaceId: actor.workspaceId,
		pageId: page.id,
		kind: 'named',
		label,
		state: stateBytes,
		byteSize: stateBytes.byteLength,
		plainText,
		authors: [actor.principalId],
		createdBy: actor.userId
	})

	await emitDocsEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'doc_version',
		aggregateId: version.id,
		eventType: DOCS_EVENTS.VersionCreated,
		payload: { pageId: page.id, versionId: version.id, label, actorId: actor.principalId }
	})

	await auditDocsAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'doc.version.created',
		targetType: 'doc_page',
		targetId: page.id,
		metadata: { versionId: version.id, label }
	})

	return { data: version }
}

export async function getDocVersionDetail(
	tx: Queryable,
	actor: ActorContext,
	pageId: string,
	versionId: string
): Promise<DocVersionDetailDto> {
	await requireDocPageAccess(tx, actor, pageId, 'doc.read')
	const ver = await getDocVersionWithState(tx, actor.workspaceId, pageId, versionId)
	if (!ver) throw new HttpError(404, 'not_found', 'Document version not found')
	const prevText = await getPreviousDocVersionPlainText(tx, actor.workspaceId, pageId, ver.createdAt, ver.id)
	const { state: _state, ...dto } = ver
	return {
		version: dto,
		diff: diffVersionText(prevText, dto.plainText)
	}
}

export async function prepareRestoreDocVersion(
	tx: Queryable,
	actor: ActorContext,
	pageId: string,
	versionId: string,
	hasLiveRoomBridge: boolean,
	customLabel?: string
): Promise<{
	readonly checkpointVersion: DocVersionDto
	readonly targetState: Uint8Array
	readonly cursor: number
	readonly appliedInDb: boolean
}> {
	const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.write')
	const targetVer = await getDocVersionWithState(tx, actor.workspaceId, page.id, versionId)
	if (!targetVer) throw new HttpError(404, 'not_found', 'Document version not found')

	const currentStateRow = await getDocStateRow(tx, actor.workspaceId, page.id)
	const currentBytes = currentStateRow ? new Uint8Array(currentStateRow.state) : createEmptyYDocState().state
	const currentPlainText = currentStateRow?.plainText ?? ''

	const checkpointLabel =
		customLabel ?? `Pre-restore snapshot (${targetVer.label ?? targetVer.id.slice(0, 8)})`
	const checkpoint = await insertDocVersionRow(tx, {
		workspaceId: actor.workspaceId,
		pageId: page.id,
		kind: 'pre_restore',
		label: checkpointLabel,
		state: currentBytes,
		byteSize: currentBytes.byteLength,
		plainText: currentPlainText,
		authors: [actor.principalId],
		createdBy: actor.userId
	})

	const targetStateBytes = new Uint8Array(targetVer.state)
	let appliedInDb = false

	if (!hasLiveRoomBridge) {
		const liveDoc = new Y.Doc()
		Y.applyUpdate(liveDoc, currentBytes)
		const targetDoc = new Y.Doc()
		Y.applyUpdate(targetDoc, targetStateBytes)
		const targetJson = ydocToProseMirrorJson(targetDoc)
		replaceYDocContent(liveDoc, targetJson, 'huriro:restore')

		const nextState = Y.encodeStateAsUpdate(liveDoc)
		const nextVector = Y.encodeStateVector(liveDoc)
		const extracted = extractDocumentContent(liveDoc)

		await saveUnfencedDocState(tx, {
			workspaceId: actor.workspaceId,
			pageId: page.id,
			state: nextState,
			stateVector: nextVector,
			byteSize: nextState.byteLength,
			plainText: extracted.plainText,
			headings: extracted.headings
		})
		await syncCommentAnchorOrphanStates(tx, actor.workspaceId, page.id, liveDoc)

		await emitDocsEvent(tx, {
			workspaceId: actor.workspaceId,
			aggregate: 'doc_page',
			aggregateId: page.id,
			eventType: DOCS_EVENTS.StateSaved,
			payload: {
				pageId: page.id,
				title: page.title,
				slug: page.slug,
				visibility: page.visibility,
				plainText: extracted.plainText,
				headings: extracted.headings,
				blocks: extracted.blocks,
				newMentionUserIds: [],
				newMentionHandles: [],
				actorId: actor.principalId
			}
		})
		appliedInDb = true
	}

	await emitDocsEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'doc_version',
		aggregateId: targetVer.id,
		eventType: DOCS_EVENTS.VersionRestored,
		payload: {
			pageId: page.id,
			restoredVersionId: targetVer.id,
			preRestoreVersionId: checkpoint.id,
			actorId: actor.principalId
		}
	})

	await auditDocsAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'doc.version.restored',
		targetType: 'doc_page',
		targetId: page.id,
		metadata: { restoredVersionId: targetVer.id, preRestoreVersionId: checkpoint.id }
	})

	const updatedPage = await getDocPageById(tx, actor.workspaceId, page.id, actor.userId)
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'doc_page',
		entityId: page.id,
		action: 'upsert',
		scope: [`doc_page:${page.id}`, `visibility:${page.visibility}`],
		payload: (updatedPage ?? page) as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})

	return {
		checkpointVersion: checkpoint,
		targetState: targetStateBytes,
		cursor,
		appliedInDb
	}
}

// ---------- Anchored Comments (§10.2) ----------

export async function createDocComment(
	tx: Queryable,
	actor: ActorContext,
	pageId: string,
	input: CreateDocCommentBody
): Promise<{ readonly data: DocCommentDto; readonly cursor: number }> {
	assertValidClientId(input.id, 'doc_comment.id')
	const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.comment')

	if (input.parentId) {
		const parent = await getDocCommentById(tx, actor.workspaceId, page.id, input.parentId)
		if (!parent || parent.deletedAt !== null) {
			throw new HttpError(404, 'not_found', 'Parent comment not found')
		}
	}

	const comment = await insertDocCommentRow(tx, {
		id: input.id,
		workspaceId: actor.workspaceId,
		pageId: page.id,
		parentId: input.parentId ?? null,
		authorType: actor.kind === 'agent' ? 'agent' : 'user',
		authorId: actor.principalId,
		anchorFrom: input.anchorFrom ?? null,
		anchorTo: input.anchorTo ?? null,
		anchorQuote: input.anchorQuote ?? '',
		anchorBlockId: input.anchorBlockId ?? null,
		body: input.body ?? { type: 'text', text: input.bodyText },
		bodyText: input.bodyText
	})

	const mentions = extractPersonHandleMentions(input.bodyText)
	await emitDocsEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'doc_comment',
		aggregateId: comment.id,
		eventType: DOCS_EVENTS.CommentCreated,
		payload: {
			pageId: page.id,
			pageTitle: page.title,
			pageSlug: page.slug,
			pageCreatedBy: page.createdBy,
			commentId: comment.id,
			parentId: comment.parentId,
			bodyText: comment.bodyText,
			mentions,
			actorType: comment.authorType,
			actorId: actor.principalId
		}
	})

	await auditDocsAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'doc.comment.created',
		targetType: 'doc_comment',
		targetId: comment.id,
		metadata: { pageId: page.id, anchorBlockId: comment.anchorBlockId }
	})

	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'doc_comment',
		entityId: comment.id,
		action: 'upsert',
		scope: [`doc_page:${page.id}`, `visibility:${page.visibility}`],
		payload: comment as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})

	return { data: comment, cursor }
}

export async function updateDocComment(
	tx: Queryable,
	actor: ActorContext,
	pageId: string,
	commentId: string,
	input: UpdateDocCommentBody
): Promise<{ readonly data: DocCommentDto; readonly cursor: number }> {
	const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.comment')
	const existing = await getDocCommentById(tx, actor.workspaceId, page.id, commentId)
	if (!existing || existing.deletedAt !== null) {
		throw new HttpError(404, 'not_found', 'Document comment not found')
	}
	if (existing.authorId !== actor.principalId && !isAdminDocBypass(actor)) {
		throw new HttpError(403, 'insufficient_role', 'Only the author or an admin can edit this comment')
	}
	if (existing.version !== input.version) {
		throwStaleVersion(
			'Document comment',
			existing.version,
			input.version,
			existing as unknown as Record<string, unknown>
		)
	}

	const updated = await updateDocCommentRow(tx, {
		workspaceId: actor.workspaceId,
		pageId: page.id,
		commentId,
		expectedVersion: input.version,
		body: input.body ?? { type: 'text', text: input.bodyText },
		bodyText: input.bodyText
	})
	if (!updated) {
		const latest = await getDocCommentById(tx, actor.workspaceId, page.id, commentId)
		throwStaleVersion(
			'Document comment',
			latest?.version ?? existing.version,
			input.version,
			(latest ?? existing) as unknown as Record<string, unknown>
		)
	}

	await emitDocsEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'doc_comment',
		aggregateId: updated.id,
		eventType: DOCS_EVENTS.CommentUpdated,
		payload: {
			pageId: page.id,
			commentId: updated.id,
			bodyText: updated.bodyText,
			actorId: actor.principalId
		}
	})

	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'doc_comment',
		entityId: updated.id,
		action: 'upsert',
		scope: [`doc_page:${page.id}`, `visibility:${page.visibility}`],
		payload: updated as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})

	return { data: updated, cursor }
}

export async function resolveDocComment(
	tx: Queryable,
	actor: ActorContext,
	pageId: string,
	commentId: string,
	input: ResolveDocCommentBody
): Promise<{ readonly data: DocCommentDto; readonly cursor: number }> {
	const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.comment')
	const existing = await getDocCommentById(tx, actor.workspaceId, page.id, commentId)
	if (!existing || existing.deletedAt !== null) {
		throw new HttpError(404, 'not_found', 'Document comment not found')
	}

	const updated = await resolveDocCommentRow(tx, {
		workspaceId: actor.workspaceId,
		pageId: page.id,
		commentId,
		resolved: input.resolved,
		resolvedBy: actor.principalId
	})
	if (!updated) throw new HttpError(404, 'not_found', 'Document comment not found')

	await emitDocsEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'doc_comment',
		aggregateId: updated.id,
		eventType: DOCS_EVENTS.CommentResolved,
		payload: {
			pageId: page.id,
			pageTitle: page.title,
			pageSlug: page.slug,
			commentId: updated.id,
			commentAuthorId: updated.authorId,
			resolved: input.resolved,
			actorId: actor.principalId
		}
	})

	await auditDocsAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: input.resolved ? 'doc.comment.resolved' : 'doc.comment.reopened',
		targetType: 'doc_comment',
		targetId: updated.id,
		metadata: { pageId: page.id }
	})

	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'doc_comment',
		entityId: updated.id,
		action: 'upsert',
		scope: [`doc_page:${page.id}`, `visibility:${page.visibility}`],
		payload: updated as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})

	return { data: updated, cursor }
}

export async function deleteDocComment(
	tx: Queryable,
	actor: ActorContext,
	pageId: string,
	commentId: string
): Promise<{ readonly id: string; readonly cursor: number }> {
	const { page, canWrite } = await requireDocPageAccess(tx, actor, pageId, 'doc.comment')
	const existing = await getDocCommentById(tx, actor.workspaceId, page.id, commentId)
	if (!existing || existing.deletedAt !== null) {
		throw new HttpError(404, 'not_found', 'Document comment not found')
	}
	if (existing.authorId !== actor.principalId && !canWrite && !isAdminDocBypass(actor)) {
		throw new HttpError(403, 'insufficient_role', 'Cannot delete another user comment')
	}

	const ok = await softDeleteDocCommentRow(tx, actor.workspaceId, page.id, commentId)
	if (!ok) throw new HttpError(404, 'not_found', 'Document comment not found')

	await emitDocsEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'doc_comment',
		aggregateId: commentId,
		eventType: DOCS_EVENTS.CommentDeleted,
		payload: { pageId: page.id, commentId, actorId: actor.principalId }
	})

	await auditDocsAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'doc.comment.deleted',
		targetType: 'doc_comment',
		targetId: commentId,
		metadata: { pageId: page.id }
	})

	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'doc_comment',
		entityId: commentId,
		action: 'delete',
		scope: [`doc_page:${page.id}`, `visibility:${page.visibility}`],
		payload: null,
		actorId: actor.principalId
	})

	return { id: commentId, cursor }
}

// ---------- Worker Maintenance ----------

export async function runDocMaintenanceOnce(tx: Queryable): Promise<{
	readonly thinnedVersions: number
	readonly deletedTickets: number
}> {
	const thinnedVersions = await thinAutoDocVersions(tx)
	const deletedTickets = await deleteExpiredCollabTickets(tx)
	return { thinnedVersions, deletedTickets }
}

export async function getDocPageForRedirect(
	tx: Queryable,
	workspaceId: string,
	pageId: string
): Promise<{ readonly id: string; readonly slug: string } | null> {
	const [row] = await tx<{ id: string; slug: string }[]>`
		SELECT id, slug FROM doc_pages
		WHERE workspace_id = ${workspaceId} AND id = ${pageId} AND archived_at IS NULL
	`
	return row ?? null
}

export { resolveProseMirrorAnchor }
