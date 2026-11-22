import type { NotificationDto, NotificationsListQuery, NotificationsListResponse } from '@huriro/contracts'
import { decodeCursor, encodeCursor } from '@huriro/contracts'
import type { Queryable } from '@huriro/db'
import type { ActorContext } from '@huriro/domain'
import { appendChange, appendChanges, type ChangeLogEntry } from '../../api/changelog'
import { HttpError } from '../../api/error'
import { NOTIFICATIONS_CONSUMER } from './events'
import { assertActiveWorkspaceMember } from './policy'
import {
	archiveNotificationRow,
	claimNotificationOutboxEvent,
	insertNotificationRow,
	listNotificationsForUser,
	markAllNotificationsReadRows,
	markNotificationReadRow,
	resolveWorkspaceUserIdsByHandles
} from './repo'

export interface OutboxNotificationEvent {
	readonly id: string
	readonly workspaceId: string | null
	readonly eventType: string
	readonly payload: Record<string, unknown>
}

function asActorType(raw: unknown): 'user' | 'agent' | 'system' {
	return raw === 'agent' ? 'agent' : raw === 'user' ? 'user' : 'system'
}

export async function processNotificationOutboxEvent(
	tx: Queryable,
	event: OutboxNotificationEvent
): Promise<{ readonly cursor: number | null }> {
	if (!event.workspaceId) return { cursor: null }
	const claimed = await claimNotificationOutboxEvent(tx, NOTIFICATIONS_CONSUMER, event.id)
	if (!claimed) return { cursor: null }

	const p = event.payload
	const actorId = typeof p['actorId'] === 'string' ? p['actorId'] : null
	const actorType = asActorType(p['actorType'])
	const createdNotifications: NotificationDto[] = []

	if (event.eventType === 'tasks.issue.assigned.v1') {
		const recipient = typeof p['assigneeUserId'] === 'string' ? p['assigneeUserId'] : null
		const issueId = typeof p['issueId'] === 'string' ? p['issueId'] : null
		if (recipient && issueId && recipient !== actorId) {
			createdNotifications.push(
				await insertNotificationRow(tx, {
					workspaceId: event.workspaceId,
					recipientUserId: recipient,
					actorType,
					actorId,
					kind: 'issue.assigned',
					entityType: 'issue',
					entityId: issueId,
					title: `Assigned to ${String(p['identifier'] ?? 'issue')}: ${String(p['title'] ?? '')}`,
					body: '',
					metadata: { identifier: p['identifier'] ?? null, projectId: p['projectId'] ?? null }
				})
			)
		}
	} else if (event.eventType === 'tasks.issue_comment.created.v1') {
		const issueId = typeof p['issueId'] === 'string' ? p['issueId'] : null
		if (issueId) {
			const handles = Array.isArray(p['mentionedHandles'])
				? p['mentionedHandles'].filter((h): h is string => typeof h === 'string')
				: []
			const mentionedIds = await resolveWorkspaceUserIdsByHandles(tx, event.workspaceId, handles)
			const mentionedSet = new Set(mentionedIds.filter((id) => id !== actorId))

			for (const uid of mentionedSet) {
				createdNotifications.push(
					await insertNotificationRow(tx, {
						workspaceId: event.workspaceId,
						recipientUserId: uid,
						actorType,
						actorId,
						kind: 'issue.mentioned',
						entityType: 'issue',
						entityId: issueId,
						title: `Mentioned on ${String(p['identifier'] ?? 'issue')}: ${String(p['issueTitle'] ?? '')}`,
						body: String(p['bodyText'] ?? '').slice(0, 240),
						metadata: { identifier: p['identifier'] ?? null, commentId: p['commentId'] ?? null }
					})
				)
			}

			const watchers = new Set<string>()
			if (typeof p['assigneeUserId'] === 'string') watchers.add(p['assigneeUserId'])
			if (typeof p['creatorId'] === 'string') watchers.add(p['creatorId'])
			for (const uid of watchers) {
				if (uid === actorId || mentionedSet.has(uid)) continue
				createdNotifications.push(
					await insertNotificationRow(tx, {
						workspaceId: event.workspaceId,
						recipientUserId: uid,
						actorType,
						actorId,
						kind: 'issue.commented',
						entityType: 'issue',
						entityId: issueId,
						title: `New comment on ${String(p['identifier'] ?? 'issue')}`,
						body: String(p['bodyText'] ?? '').slice(0, 240),
						metadata: { identifier: p['identifier'] ?? null, commentId: p['commentId'] ?? null }
					})
				)
			}
		}
	} else if (event.eventType === 'tasks.issue.status_changed.v1') {
		const issueId = typeof p['issueId'] === 'string' ? p['issueId'] : null
		if (issueId) {
			const recipients = new Set<string>()
			if (typeof p['assigneeUserId'] === 'string') recipients.add(p['assigneeUserId'])
			if (typeof p['creatorId'] === 'string') recipients.add(p['creatorId'])
			for (const uid of recipients) {
				if (uid === actorId) continue
				createdNotifications.push(
					await insertNotificationRow(tx, {
						workspaceId: event.workspaceId,
						recipientUserId: uid,
						actorType,
						actorId,
						kind: 'issue.status_changed',
						entityType: 'issue',
						entityId: issueId,
						title: `Status updated on ${String(p['identifier'] ?? 'issue')}: ${String(p['title'] ?? '')}`,
						body: '',
						metadata: { identifier: p['identifier'] ?? null, statusId: p['statusId'] ?? null }
					})
				)
			}
		}
	} else if (event.eventType === 'tenancy.acl.granted.v1') {
		if (p['resourceType'] === 'project' && p['principalType'] === 'user') {
			const uid = typeof p['principalId'] === 'string' ? p['principalId'] : null
			const resourceId = typeof p['resourceId'] === 'string' ? p['resourceId'] : null
			const grantedBy = typeof p['grantedBy'] === 'string' ? p['grantedBy'] : null
			if (uid && resourceId && uid !== grantedBy) {
				createdNotifications.push(
					await insertNotificationRow(tx, {
						workspaceId: event.workspaceId,
						recipientUserId: uid,
						actorType: 'user',
						actorId: grantedBy,
						kind: 'project.access_granted',
						entityType: 'project',
						entityId: resourceId,
						title: 'Granted access to a private project',
						body: '',
						metadata: { permission: p['permission'] ?? 'read' }
					})
				)
			}
		} else if (p['resourceType'] === 'doc_page' && p['principalType'] === 'user') {
			const uid = typeof p['principalId'] === 'string' ? p['principalId'] : null
			const resourceId = typeof p['resourceId'] === 'string' ? p['resourceId'] : null
			const grantedBy = typeof p['grantedBy'] === 'string' ? p['grantedBy'] : null
			if (uid && resourceId && uid !== grantedBy) {
				createdNotifications.push(
					await insertNotificationRow(tx, {
						workspaceId: event.workspaceId,
						recipientUserId: uid,
						actorType: 'user',
						actorId: grantedBy,
						kind: 'doc.access_granted',
						entityType: 'doc_page',
						entityId: resourceId,
						title: 'Granted access to a private document',
						body: '',
						metadata: { permission: p['permission'] ?? 'read' }
					})
				)
			}
		}
	} else if (event.eventType === 'docs.comment.created.v1') {
		const pageId = typeof p['pageId'] === 'string' ? p['pageId'] : null
		if (pageId) {
			const handles = Array.isArray(p['mentions'])
				? p['mentions'].filter((h): h is string => typeof h === 'string')
				: []
			const mentionedIds = await resolveWorkspaceUserIdsByHandles(tx, event.workspaceId, handles)
			const mentionedSet = new Set(mentionedIds.filter((id) => id !== actorId))
			const pageTitle = String(p['pageTitle'] ?? 'Document')
			const pageSlug = typeof p['pageSlug'] === 'string' ? p['pageSlug'] : null

			for (const uid of mentionedSet) {
				createdNotifications.push(
					await insertNotificationRow(tx, {
						workspaceId: event.workspaceId,
						recipientUserId: uid,
						actorType,
						actorId,
						kind: 'doc.mentioned',
						entityType: 'doc_page',
						entityId: pageId,
						title: `Mentioned in comment on ${pageTitle}`,
						body: String(p['bodyText'] ?? '').slice(0, 240),
						metadata: { slug: pageSlug, commentId: p['commentId'] ?? null }
					})
				)
			}

			const pageOwner = typeof p['pageCreatedBy'] === 'string' ? p['pageCreatedBy'] : null
			if (pageOwner && pageOwner !== actorId && !mentionedSet.has(pageOwner)) {
				createdNotifications.push(
					await insertNotificationRow(tx, {
						workspaceId: event.workspaceId,
						recipientUserId: pageOwner,
						actorType,
						actorId,
						kind: 'doc.commented',
						entityType: 'doc_page',
						entityId: pageId,
						title: `New comment on ${pageTitle}`,
						body: String(p['bodyText'] ?? '').slice(0, 240),
						metadata: { slug: pageSlug, commentId: p['commentId'] ?? null }
					})
				)
			}
		}
	} else if (event.eventType === 'docs.comment.resolved.v1') {
		const pageId = typeof p['pageId'] === 'string' ? p['pageId'] : null
		const commentAuthorId = typeof p['commentAuthorId'] === 'string' ? p['commentAuthorId'] : null
		if (pageId && commentAuthorId && p['resolved'] === true && commentAuthorId !== actorId) {
			createdNotifications.push(
				await insertNotificationRow(tx, {
					workspaceId: event.workspaceId,
					recipientUserId: commentAuthorId,
					actorType,
					actorId,
					kind: 'doc.comment_resolved',
					entityType: 'doc_page',
					entityId: pageId,
					title: `Comment resolved on ${String(p['pageTitle'] ?? 'Document')}`,
					body: '',
					metadata: {
						slug: typeof p['pageSlug'] === 'string' ? p['pageSlug'] : null,
						commentId: p['commentId'] ?? null
					}
				})
			)
		}
	} else if (event.eventType === 'docs.state.saved.v1') {
		const pageId = typeof p['pageId'] === 'string' ? p['pageId'] : null
		if (pageId) {
			const directUserIds = Array.isArray(p['newMentionUserIds'])
				? p['newMentionUserIds'].filter((id): id is string => typeof id === 'string')
				: []
			const handles = Array.isArray(p['newMentionHandles'])
				? p['newMentionHandles'].filter((h): h is string => typeof h === 'string')
				: []
			const resolvedIds = await resolveWorkspaceUserIdsByHandles(tx, event.workspaceId, handles)
			const recipients = new Set([...directUserIds, ...resolvedIds].filter((id) => id !== actorId))
			for (const uid of recipients) {
				createdNotifications.push(
					await insertNotificationRow(tx, {
						workspaceId: event.workspaceId,
						recipientUserId: uid,
						actorType,
						actorId,
						kind: 'doc.mentioned',
						entityType: 'doc_page',
						entityId: pageId,
						title: `Mentioned in ${String(p['title'] ?? 'Document')}`,
						body: String(p['plainText'] ?? '').slice(0, 240),
						metadata: { slug: typeof p['slug'] === 'string' ? p['slug'] : null }
					})
				)
			}
		}
	}

	if (createdNotifications.length === 0) return { cursor: null }

	const changes: ChangeLogEntry[] = createdNotifications.map((n) => ({
		entityType: 'notification',
		entityId: n.id,
		action: 'upsert',
		scope: [`user:${n.recipientUserId}`],
		payload: n as unknown as Record<string, unknown>,
		actorId
	}))
	const cursor = await appendChanges(tx, event.workspaceId, changes)
	return { cursor }
}

export async function listMyNotifications(
	tx: Queryable,
	actor: ActorContext,
	query: NotificationsListQuery
): Promise<NotificationsListResponse> {
	assertActiveWorkspaceMember(actor)
	const cursorPos = decodeCursor<{ createdAt: string; id: string }>(query.cursor)
	const res = await listNotificationsForUser(tx, {
		workspaceId: actor.workspaceId,
		userId: actor.principalId,
		unreadOnly: query.unreadOnly === true,
		cursorPos,
		limit: query.limit ?? 50
	})
	const last = res.items.at(-1)
	const nextCursor = res.hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null
	return {
		data: res.items,
		unreadCount: res.unreadCount,
		nextCursor,
		hasMore: res.hasMore
	}
}

export async function markNotificationRead(
	tx: Queryable,
	actor: ActorContext,
	notificationId: string
): Promise<{ readonly data: NotificationDto; readonly cursor: number }> {
	assertActiveWorkspaceMember(actor)
	const updated = await markNotificationReadRow(tx, actor.workspaceId, actor.principalId, notificationId)
	if (!updated) throw new HttpError(404, 'not_found', 'Notification not found')
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'notification',
		entityId: updated.id,
		action: 'upsert',
		scope: [`user:${actor.principalId}`],
		payload: updated as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})
	return { data: updated, cursor }
}

export async function markAllNotificationsRead(
	tx: Queryable,
	actor: ActorContext
): Promise<{ readonly updatedCount: number; readonly cursor: number | null }> {
	assertActiveWorkspaceMember(actor)
	const updated = await markAllNotificationsReadRows(tx, actor.workspaceId, actor.principalId)
	if (updated.length === 0) return { updatedCount: 0, cursor: null }
	const cursor = await appendChanges(
		tx,
		actor.workspaceId,
		updated.map((n) => ({
			entityType: 'notification' as const,
			entityId: n.id,
			action: 'upsert' as const,
			scope: [`user:${actor.principalId}`],
			payload: n as unknown as Record<string, unknown>,
			actorId: actor.principalId
		}))
	)
	return { updatedCount: updated.length, cursor }
}

export async function archiveNotification(
	tx: Queryable,
	actor: ActorContext,
	notificationId: string
): Promise<{ readonly archived: boolean; readonly cursor: number }> {
	assertActiveWorkspaceMember(actor)
	const archived = await archiveNotificationRow(tx, actor.workspaceId, actor.principalId, notificationId)
	if (!archived) throw new HttpError(404, 'not_found', 'Notification not found')
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'notification',
		entityId: archived.id,
		action: 'delete',
		scope: [`user:${actor.principalId}`],
		payload: null,
		actorId: actor.principalId
	})
	return { archived: true, cursor }
}

export async function getNotificationsSnapshot(
	tx: Queryable,
	actor: ActorContext
): Promise<NotificationDto[]> {
	if (actor.membership !== 'active') return []
	const res = await listNotificationsForUser(tx, {
		workspaceId: actor.workspaceId,
		userId: actor.principalId,
		unreadOnly: false,
		limit: 100
	})
	return res.items
}
