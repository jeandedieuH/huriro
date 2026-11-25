/**
 * In-house MIT Suggestion Mode domain service (§4.3, ADR-0027).
 * Coordinates Y.Doc CRDT suggestion marks, live Hocuspocus transforms, and the
 * `doc_suggestions` Postgres index + notifications.
 */
import type { DocPageDto, DocSuggestionDto, ProposeDocSuggestionBody } from '@huriro/contracts'
import { type Queryable, uuid7 } from '@huriro/db'
import type { ActorContext } from '@huriro/domain'
import {
	applyAllSuggestionsDecisionToYDoc,
	applySuggestionDecisionToYDoc,
	createEmptyYDocState,
	extractDocumentContent,
	extractSuggestionsFromYDoc,
	proposeSuggestionOnYDoc
} from '@huriro/editor'
import * as Y from 'yjs'
import { appendChange } from '../../api/changelog'
import { HttpError } from '../../api/error'
import type { CollabDirectBridge } from './collab-ticket'
import { DOCS_EVENTS } from './events'
import { assertPageUnlocked, assertWithinMaxDocSize, requireDocPageAccess } from './page-access'
import { auditDocsAction, emitDocsEvent, getDocStateRow, saveUnfencedDocState } from './repo'
import {
	bulkUpdateOpenDocSuggestionsRow,
	listDocSuggestionRows,
	markMissingDocSuggestionsStatus,
	updateDocSuggestionDecisionRow,
	upsertDocSuggestionRow
} from './repo-m9'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type RunInWorkspace = <T>(fn: (tx: Queryable, actor: ActorContext) => Promise<T>) => Promise<T>

export async function listDocSuggestions(
	tx: Queryable,
	actor: ActorContext,
	pageId: string
): Promise<DocSuggestionDto[]> {
	await requireDocPageAccess(tx, actor, pageId, 'doc.read')
	return listDocSuggestionRows(tx, actor.workspaceId, pageId)
}

export async function syncDocSuggestionsFromYDoc(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly pageId: string
		readonly pageTitle: string
		readonly pageCreatedBy: string
		readonly ydoc: Y.Doc
		readonly fallbackActorId: string | null
	}
): Promise<void> {
	const extracted = extractSuggestionsFromYDoc(args.ydoc)
	const activeGroupIds: string[] = []

	for (const s of extracted) {
		activeGroupIds.push(s.groupId)
		const authorId = UUID_RE.test(s.authorId) ? s.authorId : (args.fallbackActorId ?? args.pageCreatedBy)
		const res = await upsertDocSuggestionRow(tx, {
			workspaceId: args.workspaceId,
			pageId: args.pageId,
			groupId: s.groupId,
			kind: s.kind,
			authorType: s.authorType,
			authorId,
			anchorBlockId: s.anchorBlockId,
			beforeText: s.beforeText,
			afterText: s.afterText,
			status: 'open'
		})
		if (res.inserted) {
			await emitDocsEvent(tx, {
				workspaceId: args.workspaceId,
				aggregate: 'doc_suggestion',
				aggregateId: res.row.id,
				eventType: DOCS_EVENTS.SuggestionCreated,
				payload: {
					pageId: args.pageId,
					pageTitle: args.pageTitle,
					pageCreatedBy: args.pageCreatedBy,
					suggestionId: res.row.id,
					groupId: s.groupId,
					kind: s.kind,
					actorId: authorId
				}
			})
		}
	}

	await markMissingDocSuggestionsStatus(tx, {
		workspaceId: args.workspaceId,
		pageId: args.pageId,
		activeGroupIds,
		status: 'rejected',
		resolvedBy: args.fallbackActorId
	})
}

function validateProposeInput(input: ProposeDocSuggestionBody): void {
	if (input.kind === 'insert' && (!input.replacementText || input.replacementText.length === 0)) {
		throw new HttpError(422, 'validation_failed', 'Insert suggestions require non-empty replacementText')
	}
	if ((input.kind === 'delete' || input.kind === 'replace') && !input.targetText) {
		throw new HttpError(422, 'validation_failed', 'Delete and replace suggestions require targetText')
	}
}

export async function proposeDocSuggestionInTx(
	tx: Queryable,
	actor: ActorContext,
	pageId: string,
	input: ProposeDocSuggestionBody,
	suppliedGroupId?: string
): Promise<{ readonly data: DocSuggestionDto; readonly cursor: number }> {
	validateProposeInput(input)
	const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.comment')
	assertPageUnlocked(page)

	const groupId = suppliedGroupId ?? input.groupId ?? uuid7()
	const stateRow = await getDocStateRow(tx, actor.workspaceId, page.id)
	const ydoc = new Y.Doc()
	Y.applyUpdate(ydoc, stateRow ? new Uint8Array(stateRow.state) : createEmptyYDocState().state)

	const proposed = proposeSuggestionOnYDoc(
		ydoc,
		{
			kind: input.kind,
			anchorBlockId: input.anchorBlockId ?? null,
			targetText: input.targetText,
			replacementText: input.replacementText,
			authorType: actor.kind === 'agent' ? 'agent' : 'user',
			authorId: actor.principalId,
			groupId
		},
		`huriro:suggestion:propose:${actor.principalId}`
	)
	if (!proposed.applied) {
		throw new HttpError(
			422,
			'validation_failed',
			'Target text for suggestion could not be matched in document'
		)
	}

	const nextState = Y.encodeStateAsUpdate(ydoc)
	const nextVector = Y.encodeStateVector(ydoc)
	assertWithinMaxDocSize(nextState)
	const extractedContent = extractDocumentContent(ydoc)
	await saveUnfencedDocState(tx, {
		workspaceId: actor.workspaceId,
		pageId: page.id,
		state: nextState,
		stateVector: nextVector,
		byteSize: nextState.byteLength,
		plainText: extractedContent.plainText,
		headings: extractedContent.headings
	})

	await syncDocSuggestionsFromYDoc(tx, {
		workspaceId: actor.workspaceId,
		pageId: page.id,
		pageTitle: page.title,
		pageCreatedBy: page.createdBy,
		ydoc,
		fallbackActorId: actor.principalId
	})

	const rows = await listDocSuggestionRows(tx, actor.workspaceId, page.id)
	const created = rows.find((r) => r.groupId === groupId)
	if (!created) {
		throw new HttpError(500, 'internal', 'Suggested edit was not indexed')
	}

	await auditDocsAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'doc.suggestion.created',
		targetType: 'doc_page',
		targetId: page.id,
		metadata: { groupId, kind: input.kind }
	})

	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'doc_page',
		entityId: page.id,
		action: 'upsert',
		scope: [`doc_page:${page.id}`, `visibility:${page.visibility}`],
		payload: page as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})

	return { data: created, cursor }
}

export async function proposeDocSuggestion(
	inWorkspace: RunInWorkspace,
	workspaceId: string,
	pageId: string,
	input: ProposeDocSuggestionBody,
	collabBridge?: CollabDirectBridge
): Promise<{ readonly data: DocSuggestionDto; readonly cursor: number }> {
	validateProposeInput(input)
	const groupId = input.groupId ?? uuid7()
	const isLive = Boolean(collabBridge?.isRoomLoaded?.(workspaceId, pageId) && collabBridge.applyYDocTransform)
	if (!isLive) {
		return inWorkspace((tx, actor) => proposeDocSuggestionInTx(tx, actor, pageId, input, groupId))
	}

	const pre = await inWorkspace(async (tx, actor) => {
		const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.comment')
		assertPageUnlocked(page)
		return {
			page,
			actorId: actor.principalId,
			actorType: (actor.kind === 'agent' ? 'agent' : 'user') as 'user' | 'agent'
		}
	})

	await collabBridge?.applyYDocTransform?.(
		workspaceId,
		pageId,
		`huriro:suggestion:propose:${pre.actorId}`,
		pre.actorId,
		(liveDoc) => {
			const res = proposeSuggestionOnYDoc(
				liveDoc,
				{
					kind: input.kind,
					anchorBlockId: input.anchorBlockId ?? null,
					targetText: input.targetText,
					replacementText: input.replacementText,
					authorType: pre.actorType,
					authorId: pre.actorId,
					groupId
				},
				`huriro:suggestion:propose:${pre.actorId}`
			)
			if (!res.applied) {
				throw new HttpError(
					422,
					'validation_failed',
					'Target text for suggestion could not be matched in document'
				)
			}
		}
	)

	return inWorkspace(async (tx, actor) => {
		const rows = await listDocSuggestionRows(tx, actor.workspaceId, pre.page.id)
		const created = rows.find((r) => r.groupId === groupId)
		if (!created) {
			throw new HttpError(500, 'internal', 'Suggested edit was not persisted from live room')
		}
		await auditDocsAction(tx, {
			workspaceId: actor.workspaceId,
			actorType: pre.actorType,
			actorId: actor.principalId,
			action: 'doc.suggestion.created',
			targetType: 'doc_page',
			targetId: pre.page.id,
			metadata: { groupId, kind: input.kind, liveRoom: true }
		})
		const cursor = await appendChange(tx, actor.workspaceId, {
			entityType: 'doc_page',
			entityId: pre.page.id,
			action: 'upsert',
			scope: [`doc_page:${pre.page.id}`, `visibility:${pre.page.visibility}`],
			payload: pre.page as unknown as Record<string, unknown>,
			actorId: actor.principalId
		})
		return { data: created, cursor }
	})
}

async function emitDecisionSideEffects(
	tx: Queryable,
	actor: ActorContext,
	page: DocPageDto,
	groupId: string | 'all',
	decision: 'accept' | 'reject'
): Promise<number> {
	await emitDocsEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'doc_suggestion',
		aggregateId: page.id,
		eventType: DOCS_EVENTS.SuggestionDecided,
		payload: { pageId: page.id, groupId, decision, actorId: actor.principalId }
	})
	await auditDocsAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: `doc.suggestion.${decision}`,
		targetType: 'doc_page',
		targetId: page.id,
		metadata: { groupId, decision }
	})
	return appendChange(tx, actor.workspaceId, {
		entityType: 'doc_page',
		entityId: page.id,
		action: 'upsert',
		scope: [`doc_page:${page.id}`, `visibility:${page.visibility}`],
		payload: page as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})
}

export async function decideDocSuggestionInTx(
	tx: Queryable,
	actor: ActorContext,
	pageId: string,
	groupId: string,
	decision: 'accept' | 'reject'
): Promise<{ readonly data: DocSuggestionDto; readonly cursor: number }> {
	const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.write')
	assertPageUnlocked(page)

	const stateRow = await getDocStateRow(tx, actor.workspaceId, page.id)
	const ydoc = new Y.Doc()
	if (stateRow) Y.applyUpdate(ydoc, new Uint8Array(stateRow.state))

	const modified = applySuggestionDecisionToYDoc(ydoc, groupId, decision)
	if (modified) {
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
	}

	const status = decision === 'accept' ? 'accepted' : 'rejected'
	const updated = await updateDocSuggestionDecisionRow(tx, {
		workspaceId: actor.workspaceId,
		pageId: page.id,
		groupId,
		status,
		resolvedBy: actor.userId
	})
	if (!updated && !modified) {
		throw new HttpError(404, 'not_found', 'Suggestion not found on document')
	}

	const finalRow =
		updated ??
		(
			await upsertDocSuggestionRow(tx, {
				workspaceId: actor.workspaceId,
				pageId: page.id,
				groupId,
				kind: 'insert',
				authorType: 'user',
				authorId: actor.userId,
				anchorBlockId: null,
				beforeText: '',
				afterText: '',
				status
			})
		).row

	const cursor = await emitDecisionSideEffects(tx, actor, page, groupId, decision)
	return { data: finalRow, cursor }
}

export async function decideDocSuggestion(
	inWorkspace: RunInWorkspace,
	workspaceId: string,
	pageId: string,
	groupId: string,
	decision: 'accept' | 'reject',
	collabBridge?: CollabDirectBridge
): Promise<{ readonly data: DocSuggestionDto; readonly cursor: number }> {
	const isLive = Boolean(collabBridge?.isRoomLoaded?.(workspaceId, pageId) && collabBridge.applyYDocTransform)
	if (!isLive) {
		return inWorkspace((tx, actor) => decideDocSuggestionInTx(tx, actor, pageId, groupId, decision))
	}

	const pre = await inWorkspace(async (tx, actor) => {
		const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.write')
		assertPageUnlocked(page)
		const existing = (await listDocSuggestionRows(tx, actor.workspaceId, page.id)).find(
			(s) => s.groupId === groupId
		)
		return { page, existing, actorId: actor.principalId }
	})

	let mutated = false
	await collabBridge?.applyYDocTransform?.(
		workspaceId,
		pageId,
		`huriro:suggestion:${decision}:${pre.actorId}`,
		pre.actorId,
		(liveDoc) => {
			mutated = applySuggestionDecisionToYDoc(liveDoc, groupId, decision)
		}
	)

	if (!mutated && !pre.existing) {
		throw new HttpError(404, 'not_found', 'Suggestion not found on document')
	}

	return inWorkspace(async (tx, actor) => {
		const status = decision === 'accept' ? 'accepted' : 'rejected'
		const updated = await updateDocSuggestionDecisionRow(tx, {
			workspaceId: actor.workspaceId,
			pageId: pre.page.id,
			groupId,
			status,
			resolvedBy: actor.userId
		})
		if (!updated) {
			throw new HttpError(404, 'not_found', 'Suggestion not found on document')
		}
		const cursor = await emitDecisionSideEffects(tx, actor, pre.page, groupId, decision)
		return { data: updated, cursor }
	})
}

export async function decideAllDocSuggestionsInTx(
	tx: Queryable,
	actor: ActorContext,
	pageId: string,
	decision: 'accept' | 'reject'
): Promise<{ readonly updatedCount: number; readonly cursor: number }> {
	const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.write')
	assertPageUnlocked(page)

	const stateRow = await getDocStateRow(tx, actor.workspaceId, page.id)
	const ydoc = new Y.Doc()
	if (stateRow) Y.applyUpdate(ydoc, new Uint8Array(stateRow.state))

	const modified = applyAllSuggestionsDecisionToYDoc(ydoc, decision)
	if (modified) {
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
	}

	const rows = await bulkUpdateOpenDocSuggestionsRow(tx, {
		workspaceId: actor.workspaceId,
		pageId: page.id,
		status: decision === 'accept' ? 'accepted' : 'rejected',
		resolvedBy: actor.userId
	})
	const cursor = await emitDecisionSideEffects(tx, actor, page, 'all', decision)
	return { updatedCount: rows.length, cursor }
}

export async function decideAllDocSuggestions(
	inWorkspace: RunInWorkspace,
	workspaceId: string,
	pageId: string,
	decision: 'accept' | 'reject',
	collabBridge?: CollabDirectBridge
): Promise<{ readonly updatedCount: number; readonly cursor: number }> {
	const isLive = Boolean(collabBridge?.isRoomLoaded?.(workspaceId, pageId) && collabBridge.applyYDocTransform)
	if (!isLive) {
		return inWorkspace((tx, actor) => decideAllDocSuggestionsInTx(tx, actor, pageId, decision))
	}

	const pre = await inWorkspace(async (tx, actor) => {
		const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.write')
		assertPageUnlocked(page)
		const openBefore = (await listDocSuggestionRows(tx, actor.workspaceId, page.id)).filter(
			(s) => s.status === 'open'
		)
		return { page, openGroupIds: openBefore.map((s) => s.groupId), actorId: actor.principalId }
	})

	await collabBridge?.applyYDocTransform?.(
		workspaceId,
		pageId,
		`huriro:suggestion:${decision}-all:${pre.actorId}`,
		pre.actorId,
		(liveDoc) => {
			applyAllSuggestionsDecisionToYDoc(liveDoc, decision)
		}
	)

	return inWorkspace(async (tx, actor) => {
		const status = decision === 'accept' ? 'accepted' : 'rejected'
		let count = 0
		for (const gid of pre.openGroupIds) {
			const res = await updateDocSuggestionDecisionRow(tx, {
				workspaceId: actor.workspaceId,
				pageId: pre.page.id,
				groupId: gid,
				status,
				resolvedBy: actor.userId
			})
			if (res) count += 1
		}
		const bulk = await bulkUpdateOpenDocSuggestionsRow(tx, {
			workspaceId: actor.workspaceId,
			pageId: pre.page.id,
			status,
			resolvedBy: actor.userId
		})
		const cursor = await emitDecisionSideEffects(tx, actor, pre.page, 'all', decision)
		return { updatedCount: count + bulk.length, cursor }
	})
}
