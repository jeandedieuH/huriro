import type { SearchResponse } from '@huriro/contracts'
import type { Queryable } from '@huriro/db'
import { type ActorContext, parseSearchQuery } from '@huriro/domain'
import { SEARCH_CONSUMER } from './events'
import { assertCanSearch } from './policy'
import {
	claimSearchOutboxEvent,
	deleteSearchDocument,
	executeSearchQuery,
	upsertSearchDocument
} from './repo'

export interface OutboxEventRecord {
	readonly id: string
	readonly workspaceId: string | null
	readonly eventType: string
	readonly payload: Record<string, unknown>
}

export async function processSearchOutboxEvent(tx: Queryable, event: OutboxEventRecord): Promise<boolean> {
	if (!event.workspaceId) return false
	const claimed = await claimSearchOutboxEvent(tx, SEARCH_CONSUMER, event.id)
	if (!claimed) return false

	const p = event.payload
	switch (event.eventType) {
		case 'tasks.project.created.v1':
		case 'tasks.project.updated.v1': {
			const projectId = String(p['projectId'] ?? '')
			if (!projectId) return false
			await upsertSearchDocument(tx, {
				workspaceId: event.workspaceId,
				entityType: 'project',
				entityId: projectId,
				projectId,
				containerId: projectId,
				identifier: typeof p['key'] === 'string' ? p['key'] : null,
				title: String(p['name'] ?? ''),
				body: String(p['description'] ?? '')
			})
			return true
		}
		case 'tasks.issue.created.v1':
		case 'tasks.issue.updated.v1': {
			const issueId = String(p['issueId'] ?? '')
			const projectId = typeof p['projectId'] === 'string' ? p['projectId'] : null
			if (!issueId) return false
			await upsertSearchDocument(tx, {
				workspaceId: event.workspaceId,
				entityType: 'issue',
				entityId: issueId,
				projectId,
				containerId: projectId,
				identifier: typeof p['identifier'] === 'string' ? p['identifier'] : null,
				title: String(p['title'] ?? ''),
				body: String(p['descriptionText'] ?? '')
			})
			return true
		}
		case 'tasks.issue.deleted.v1': {
			const issueId = String(p['issueId'] ?? '')
			if (!issueId) return false
			await deleteSearchDocument(tx, event.workspaceId, 'issue', issueId)
			return true
		}
		case 'tasks.issue_comment.created.v1':
		case 'tasks.issue_comment.updated.v1': {
			const commentId = String(p['commentId'] ?? '')
			const projectId = typeof p['projectId'] === 'string' ? p['projectId'] : null
			const issueId = typeof p['issueId'] === 'string' ? p['issueId'] : null
			if (!commentId) return false
			await upsertSearchDocument(tx, {
				workspaceId: event.workspaceId,
				entityType: 'comment',
				entityId: commentId,
				projectId,
				containerId: issueId,
				identifier: typeof p['identifier'] === 'string' ? p['identifier'] : null,
				title: String(p['issueTitle'] ?? ''),
				body: String(p['bodyText'] ?? '')
			})
			return true
		}
		default:
			return false
	}
}

export async function searchWorkspace(
	tx: Queryable,
	actor: ActorContext,
	rawQuery: string,
	limit = 20
): Promise<SearchResponse> {
	const { isGuest, bypassAcl } = assertCanSearch(actor)
	const parsed = parseSearchQuery(rawQuery)
	if (parsed.mode === 'actions') {
		return { query: rawQuery, mode: 'actions', hits: [] }
	}
	const hits = await executeSearchQuery(tx, {
		workspaceId: actor.workspaceId,
		userId: actor.principalId,
		isGuest,
		bypassAcl,
		parsed,
		limit
	})
	return { query: rawQuery, mode: 'all', hits }
}
