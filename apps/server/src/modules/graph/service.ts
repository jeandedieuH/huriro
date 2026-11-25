import type {
	CreateEntityLinkBody,
	EntityLinkDto,
	EntityType,
	KnowledgeGraphEdgeDto,
	KnowledgeGraphNodeDto,
	KnowledgeGraphResponse,
	PeekCardDto
} from '@huriro/contracts'
import type { Queryable } from '@huriro/db'
import type { ActorContext } from '@huriro/domain'
import {
	deleteEntityLink as deleteEntityLinkRow,
	type EntityLinkWriteResult,
	insertEntityLink
} from '../../api/entity-links'
import { HttpError } from '../../api/error'
import { getChatMessageEndpoint } from '../chat'
import { listAccessibleDocPages, listVisibleTeamspaces, requireDocPageAccess } from '../docs'
import { requireMailConversationAccess } from '../mail'
import { listProjectStatuses, requireIssueAccess } from '../tasks'
import { getEntityLinkRow, listEntityLinksForDocSources, listEntityLinksTouching } from './repo'

const UNSUPPORTED_IN_M7 = new Set<EntityType>(['doc_database_row', 'contact_org', 'vcs_pr'])

function notFound(): never {
	throw new HttpError(404, 'not_found', 'Entity not found')
}

function hidden(err: unknown): never {
	if (err instanceof HttpError && (err.status === 403 || err.status === 404)) notFound()
	throw err
}

/** Read one endpoint through its owning module's seam — never through foreign tables/policies. */
async function readEndpoint(
	tx: Queryable,
	actor: ActorContext,
	type: EntityType,
	id: string
): Promise<unknown> {
	if (UNSUPPORTED_IN_M7.has(type)) notFound()
	if (type === 'issue') return requireIssueAccess(tx, actor, id, 'issue.read')
	if (type === 'doc_page') return (await requireDocPageAccess(tx, actor, id, 'doc.read')).page
	if (type === 'mail_conversation') return requireMailConversationAccess(tx, actor, id, 'mail.read')
	if (type === 'chat_message') return getChatMessageEndpoint(tx, actor, id)
	notFound()
}

async function assertEndpointVisible(
	tx: Queryable,
	actor: ActorContext,
	type: EntityType,
	id: string
): Promise<void> {
	try {
		await readEndpoint(tx, actor, type, id)
	} catch (err) {
		hidden(err)
	}
}

async function isEndpointVisible(
	tx: Queryable,
	actor: ActorContext,
	type: EntityType,
	id: string
): Promise<boolean> {
	if (UNSUPPORTED_IN_M7.has(type)) return false
	try {
		await readEndpoint(tx, actor, type, id)
		return true
	} catch (err) {
		if (err instanceof HttpError && (err.status === 403 || err.status === 404)) return false
		throw err
	}
}

async function requireSourceWriteAccess(
	tx: Queryable,
	actor: ActorContext,
	type: EntityType,
	id: string
): Promise<void> {
	if (type === 'issue') {
		await requireIssueAccess(tx, actor, id, 'issue.write')
		return
	}
	if (type === 'doc_page') {
		await requireDocPageAccess(tx, actor, id, 'doc.write')
		return
	}
	if (type === 'mail_conversation') {
		await requireMailConversationAccess(tx, actor, id, 'mail.assign')
		return
	}
	throw new HttpError(422, 'validation_failed', 'Entity type is not linkable yet')
}

/**
 * Visibility-filtered neighborhood of one entity. Rows whose counterpart is
 * invisible are omitted entirely: even their type/id pair must not leak.
 */
export async function listEntityLinksFor(
	tx: Queryable,
	actor: ActorContext,
	type: EntityType,
	id: string
): Promise<EntityLinkDto[]> {
	await assertEndpointVisible(tx, actor, type, id)
	const rows = await listEntityLinksTouching(tx, actor.workspaceId, type, id)
	const visible: EntityLinkDto[] = []
	for (const row of rows) {
		const isSource = row.sourceType === type && row.sourceId === id
		const counterpartType = isSource ? row.targetType : row.sourceType
		const counterpartId = isSource ? row.targetId : row.sourceId
		if (await isEndpointVisible(tx, actor, counterpartType, counterpartId)) {
			visible.push(row)
		}
	}
	return visible
}

export async function createEntityLink(
	tx: Queryable,
	actor: ActorContext,
	input: CreateEntityLinkBody
): Promise<EntityLinkWriteResult> {
	if (input.sourceType === input.targetType && input.sourceId === input.targetId) {
		throw new HttpError(422, 'validation_failed', 'An entity cannot link to itself')
	}
	if (UNSUPPORTED_IN_M7.has(input.sourceType) || input.sourceType === 'chat_message') {
		throw new HttpError(422, 'validation_failed', 'Entity type is not linkable yet')
	}

	// Both endpoints must exist and be readable before the write check, and
	// every read denial is collapsed to 404 so existence never leaks.
	await assertEndpointVisible(tx, actor, input.sourceType, input.sourceId)
	await assertEndpointVisible(tx, actor, input.targetType, input.targetId)
	await requireSourceWriteAccess(tx, actor, input.sourceType, input.sourceId)

	return insertEntityLink(tx, {
		workspaceId: actor.workspaceId,
		sourceType: input.sourceType,
		sourceId: input.sourceId,
		targetType: input.targetType,
		targetId: input.targetId,
		...(input.relationKind ? { relationKind: input.relationKind } : {}),
		createdBy: actor.userId,
		actorId: actor.principalId
	})
}

export async function deleteEntityLinkForActor(
	tx: Queryable,
	actor: ActorContext,
	linkId: string
): Promise<boolean> {
	const row = await getEntityLinkRow(tx, actor.workspaceId, linkId)
	if (!row) return false
	await assertEndpointVisible(tx, actor, row.sourceType, row.sourceId)
	await requireSourceWriteAccess(tx, actor, row.sourceType, row.sourceId)
	return deleteEntityLinkRow(tx, { workspaceId: actor.workspaceId, linkId, actorId: actor.principalId })
}

/** Uniform live metadata projection behind hover peek cards (§7.1). */
export async function peekEntity(
	tx: Queryable,
	actor: ActorContext,
	type: EntityType,
	id: string
): Promise<PeekCardDto> {
	if (UNSUPPORTED_IN_M7.has(type)) {
		throw new HttpError(422, 'validation_failed', 'Entity type does not support peek yet')
	}

	try {
		if (type === 'issue') {
			const issue = await requireIssueAccess(tx, actor, id, 'issue.read')
			const statuses = await listProjectStatuses(tx, actor, issue.projectId)
			const status = statuses.find((s) => s.id === issue.statusId)
			return {
				type,
				id,
				title: issue.title,
				subtitle: issue.identifier,
				...(status ? { status: { kind: status.category, label: status.name } } : {}),
				meta: {
					identifier: issue.identifier,
					projectId: issue.projectId,
					statusId: issue.statusId,
					priority: issue.priority,
					assigneeType: issue.assigneeType,
					assigneeId: issue.assigneeId,
					dueDate: issue.dueDate,
					triageStatus: issue.triageStatus
				},
				updatedAt: issue.updatedAt
			}
		}

		if (type === 'doc_page') {
			const { page } = await requireDocPageAccess(tx, actor, id, 'doc.read')
			return {
				type,
				id,
				title: page.title,
				subtitle: page.path,
				meta: {
					slug: page.slug,
					path: page.path,
					visibility: page.visibility,
					parentId: page.parentId
				},
				updatedAt: page.updatedAt
			}
		}

		if (type === 'mail_conversation') {
			const conversation = await requireMailConversationAccess(tx, actor, id, 'mail.read')
			return {
				type,
				id,
				title: conversation.subject,
				subtitle: conversation.inboxName,
				status: { kind: conversation.status, label: conversation.status },
				meta: {
					inboxId: conversation.inboxId,
					inboxName: conversation.inboxName,
					accountId: conversation.accountId,
					customerEmail: conversation.customerEmail
				},
				updatedAt: conversation.updatedAt
			}
		}

		const message = await getChatMessageEndpoint(tx, actor, id)
		return {
			type,
			id,
			title: message.excerpt,
			subtitle: message.channelName,
			meta: {
				channelId: message.channelId,
				channelName: message.channelName,
				excerpt: message.excerpt
			},
			updatedAt: message.updatedAt
		}
	} catch (err) {
		hidden(err)
	}
}

/** Visibility-filtered workspace Knowledge Graph across teamspaces, docs, and backlinks. */
export async function getKnowledgeGraph(
	tx: Queryable,
	actor: ActorContext,
	query?: { readonly teamspaceId?: string | undefined }
): Promise<KnowledgeGraphResponse> {
	if (actor.membership !== 'active') {
		return { nodes: [], edges: [] }
	}

	const [allTeamspaces, docs] = await Promise.all([
		listVisibleTeamspaces(tx, actor),
		listAccessibleDocPages(tx, actor, {
			includeTemplates: false,
			...(query?.teamspaceId ? { teamspaceId: query.teamspaceId } : {})
		})
	])

	const teamspaces = query?.teamspaceId
		? allTeamspaces.filter((t) => t.id === query.teamspaceId)
		: allTeamspaces

	const visibleTeamspaceIds = new Set(teamspaces.map((t) => t.id))
	const visibleDocIds = new Set(docs.map((d) => d.id))

	const nodes: KnowledgeGraphNodeDto[] = []
	const edges: KnowledgeGraphEdgeDto[] = []
	const seenEdgeKeys = new Set<string>()

	for (const ts of teamspaces) {
		nodes.push({
			id: ts.id,
			kind: 'teamspace',
			label: ts.name,
			subtitle: ts.visibility,
			slug: ts.slug
		})
	}

	for (const doc of docs) {
		nodes.push({
			id: doc.id,
			kind: 'doc_page',
			label: doc.title,
			subtitle: doc.visibility,
			slug: doc.slug,
			teamspaceId: doc.teamspaceId ?? null,
			verificationStatus: doc.verificationStatus ?? null
		})
		if (doc.teamspaceId && visibleTeamspaceIds.has(doc.teamspaceId)) {
			const edgeKey = `${doc.teamspaceId}->${doc.id}:contains`
			if (!seenEdgeKeys.has(edgeKey)) {
				seenEdgeKeys.add(edgeKey)
				edges.push({
					id: `ts:${doc.teamspaceId}:${doc.id}`,
					sourceId: doc.teamspaceId,
					targetId: doc.id,
					relationKind: 'contains'
				})
			}
		}
	}

	const docLinks = await listEntityLinksForDocSources(
		tx,
		actor.workspaceId,
		docs.map((d) => d.id)
	)
	const addedIssueNodes = new Set<string>()

	for (const link of docLinks) {
		if (link.targetType === 'doc_page') {
			if (!visibleDocIds.has(link.targetId)) continue
			const edgeKey = `${link.sourceId}->${link.targetId}:${link.relationKind}`
			if (!seenEdgeKeys.has(edgeKey)) {
				seenEdgeKeys.add(edgeKey)
				edges.push({
					id: link.id,
					sourceId: link.sourceId,
					targetId: link.targetId,
					relationKind: link.relationKind
				})
			}
		} else if (link.targetType === 'issue') {
			if (!(await isEndpointVisible(tx, actor, 'issue', link.targetId))) continue
			if (!addedIssueNodes.has(link.targetId)) {
				const issue = await requireIssueAccess(tx, actor, link.targetId, 'issue.read')
				addedIssueNodes.add(link.targetId)
				nodes.push({
					id: issue.id,
					kind: 'issue',
					label: issue.title,
					subtitle: issue.identifier,
					slug: null
				})
			}
			const edgeKey = `${link.sourceId}->${link.targetId}:${link.relationKind}`
			if (!seenEdgeKeys.has(edgeKey)) {
				seenEdgeKeys.add(edgeKey)
				edges.push({
					id: link.id,
					sourceId: link.sourceId,
					targetId: link.targetId,
					relationKind: link.relationKind
				})
			}
		}
	}

	return { nodes, edges }
}
