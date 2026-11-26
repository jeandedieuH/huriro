import type {
	CreateWebPushSubscriptionBody,
	MobilePushTokenDto,
	NotificationDeliveryLogDto,
	NotificationDto,
	NotificationKind,
	NotificationPreferencesDto,
	NotificationsListQuery,
	NotificationsListResponse,
	RegisterMobilePushTokenBody,
	UpdateNotificationPreferencesBody,
	WebPushSubscriptionDto
} from '@huriro/contracts'
import { decodeCursor, encodeCursor } from '@huriro/contracts'
import type { Queryable } from '@huriro/db'
import { type ActorContext, evaluateNotificationSuppression, isWithinQuietHours } from '@huriro/domain'
import { appendChange, appendChanges, type ChangeLogEntry } from '../../api/changelog'
import { validateAndResolveEgressUrl } from '../../api/egress'
import { HttpError } from '../../api/error'
import type { PresenceRegistry } from '../../realtime/presence-registry'
import { getUsersAvailabilityMap } from '../availability'
import { getChannelNotificationContext, incrementChannelMentionCount } from '../chat'
import { NOTIFICATIONS_CONSUMER } from './events'
import { assertActiveWorkspaceMember } from './policy'
import {
	archiveNotificationRow,
	claimNotificationOutboxEvent,
	findCollapsibleUnreadNotification,
	getNotificationPreferencesMap,
	getOrDefaultNotificationPreferences,
	insertNotificationDeliveryLog,
	insertNotificationRow,
	listMobilePushTokensForUser,
	listNotificationDeliveryLogs,
	listNotificationsForUser,
	listWebPushSubscriptionsForUser,
	markAllNotificationsReadRows,
	markNotificationReadRow,
	resolveWorkspaceUserIdsByHandles,
	revokeMobilePushTokenById,
	revokeWebPushSubscriptionById,
	updateCollapsedNotificationRow,
	upsertMobilePushToken,
	upsertNotificationPreferences,
	upsertWebPushSubscription
} from './repo'

export interface OutboxNotificationEvent {
	readonly id: string
	readonly workspaceId: string | null
	readonly eventType: string
	readonly payload: Record<string, unknown>
}

export interface PendingWebPushDispatch {
	readonly userId: string
	readonly notification: NotificationDto
}

const INSTANT_EMAIL_KINDS = new Set<NotificationKind>([
	'issue.assigned',
	'issue.mentioned',
	'doc.mentioned',
	'chat.mentioned',
	'chat.dm',
	'approval.requested',
	'mail.assigned',
	'mail.mentioned',
	'project.access_granted',
	'doc.access_granted',
	'channel.access_granted'
])

function asActorType(raw: unknown): 'user' | 'agent' | 'system' {
	return raw === 'agent' ? 'agent' : raw === 'user' ? 'user' : 'system'
}

export async function processNotificationOutboxEvent(
	tx: Queryable,
	event: OutboxNotificationEvent,
	presence?: PresenceRegistry
): Promise<{
	readonly cursor: number | null
	readonly pendingWebPush: PendingWebPushDispatch[]
	readonly pendingMobilePush: PendingWebPushDispatch[]
	readonly pendingEmail: PendingWebPushDispatch[]
}> {
	if (!event.workspaceId) {
		return { cursor: null, pendingWebPush: [], pendingMobilePush: [], pendingEmail: [] }
	}
	const claimed = await claimNotificationOutboxEvent(tx, NOTIFICATIONS_CONSUMER, event.id)
	if (!claimed) return { cursor: null, pendingWebPush: [], pendingMobilePush: [], pendingEmail: [] }

	const p = event.payload
	const actorId = typeof p['actorId'] === 'string' ? p['actorId'] : null
	const actorType = asActorType(p['actorType'])
	const createdNotifications: NotificationDto[] = []
	const pendingWebPush: PendingWebPushDispatch[] = []
	const pendingMobilePush: PendingWebPushDispatch[] = []
	const pendingEmail: PendingWebPushDispatch[] = []
	const chatMobileHandled = new Set<string>()

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
		} else if (p['resourceType'] === 'channel' && p['principalType'] === 'user') {
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
						kind: 'channel.access_granted',
						entityType: 'channel',
						entityId: resourceId,
						title: 'Granted access to a private channel',
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
	} else if (event.eventType === 'chat.message.created.v1') {
		const channelId = typeof p['channelId'] === 'string' ? p['channelId'] : null
		const messageId = typeof p['messageId'] === 'string' ? p['messageId'] : null
		const threadParentId = typeof p['threadParentId'] === 'string' ? p['threadParentId'] : null
		if (channelId && messageId) {
			const ctx = await getChannelNotificationContext(tx, event.workspaceId, channelId, threadParentId)
			if (ctx) {
				const candidateSet = new Set(ctx.candidateUserIds.filter((uid) => uid !== actorId))
				const handles = Array.isArray(p['mentionedHandles'])
					? p['mentionedHandles'].filter((h): h is string => typeof h === 'string')
					: []
				const resolvedMentions = await resolveWorkspaceUserIdsByHandles(tx, event.workspaceId, handles)
				const directMentionSet = new Set(resolvedMentions.filter((uid) => candidateSet.has(uid)))
				const mentionChannel = p['mentionChannel'] === true || p['mentionHere'] === true
				const mutedSet = new Set(ctx.mutedUserIds)
				const threadSubSet = new Set(ctx.threadSubscriberIds)
				const prefsMap = await getNotificationPreferencesMap(tx, event.workspaceId, [...candidateSet])
				const nowIso = new Date().toISOString()

				const channelLabel = ctx.channelKind === 'dm' ? 'direct message' : `#${ctx.channelName ?? 'channel'}`
				const authorName =
					typeof p['authorDisplayName'] === 'string' && p['authorDisplayName']
						? p['authorDisplayName']
						: 'Someone'
				const previewBody = String(p['bodyText'] ?? '').slice(0, 240)

				for (const uid of candidateSet) {
					const pref = prefsMap.get(uid)!
					const isDirectMention = directMentionSet.has(uid)
					const isMuted = mutedSet.has(uid)

					if (isMuted && !isDirectMention) continue
					if (pref.chatLevel === 'none') continue

					let kind: NotificationKind | null = null
					let title = ''
					if (isDirectMention || mentionChannel) {
						kind = 'chat.mentioned'
						title = `${authorName} mentioned you in ${channelLabel}`
						await incrementChannelMentionCount(tx, event.workspaceId, channelId, uid)
					} else if (ctx.channelKind === 'dm') {
						kind = 'chat.dm'
						title = `${authorName} sent a direct message`
					} else if (threadParentId !== null && (threadSubSet.has(uid) || ctx.threadParentAuthorId === uid)) {
						kind = 'chat.reply'
						title = `${authorName} replied in ${channelLabel}`
					} else if (pref.chatLevel === 'all') {
						kind = 'chat.message'
						title = `${authorName} posted in ${channelLabel}`
					}

					if (!kind) continue

					// Collapse repeated unread notifications for the same (recipient, kind, channel) within 5m.
					const existing = await findCollapsibleUnreadNotification(tx, {
						workspaceId: event.workspaceId,
						recipientUserId: uid,
						kind,
						entityType: 'channel',
						entityId: channelId,
						withinMinutes: 5
					})

					let notif: NotificationDto
					if (existing) {
						const prevCount =
							typeof existing.metadata?.['collapsedCount'] === 'number'
								? existing.metadata['collapsedCount']
								: 1
						const nextCount = prevCount + 1
						notif = await updateCollapsedNotificationRow(tx, {
							workspaceId: event.workspaceId,
							id: existing.id,
							title: `${nextCount} new messages in ${channelLabel}`,
							body: previewBody,
							metadata: {
								...existing.metadata,
								channelId,
								channelName: ctx.channelName,
								messageId,
								threadParentId,
								collapsedCount: nextCount
							}
						})
					} else {
						notif = await insertNotificationRow(tx, {
							workspaceId: event.workspaceId,
							recipientUserId: uid,
							actorType,
							actorId,
							kind,
							entityType: 'channel',
							entityId: channelId,
							title,
							body: previewBody,
							metadata: {
								channelId,
								channelName: ctx.channelName,
								messageId,
								threadParentId,
								collapsedCount: 1
							}
						})
					}
					createdNotifications.push(notif)

					await insertNotificationDeliveryLog(tx, {
						workspaceId: event.workspaceId,
						notificationId: notif.id,
						userId: uid,
						channel: 'in_app',
						status: 'sent',
						dedupeKey: `in_app:${notif.id}`
					})

					if (
						pref.webPushEnabled &&
						!isWithinQuietHours(nowIso, pref.quietHoursStart, pref.quietHoursEnd, pref.timezone)
					) {
						pendingWebPush.push({ userId: uid, notification: notif })
					}
					if (
						pref.mobilePushEnabled &&
						!isWithinQuietHours(nowIso, pref.quietHoursStart, pref.quietHoursEnd, pref.timezone)
					) {
						pendingMobilePush.push({ userId: uid, notification: notif })
					}
					if (!existing && pref.emailInstantEnabled && INSTANT_EMAIL_KINDS.has(kind)) {
						if (isWithinQuietHours(nowIso, pref.quietHoursStart, pref.quietHoursEnd, pref.timezone)) {
							await insertNotificationDeliveryLog(tx, {
								workspaceId: event.workspaceId,
								notificationId: notif.id,
								userId: uid,
								channel: 'email_instant',
								status: 'skipped_quiet_hours',
								dedupeKey: `email_instant:${notif.id}`,
								detail: `Quiet hours (${pref.quietHoursStart}-${pref.quietHoursEnd} ${pref.timezone})`
							})
						} else {
							pendingEmail.push({ userId: uid, notification: notif })
						}
					}
					chatMobileHandled.add(notif.id)
				}
			}
		}
	} else if (event.eventType === 'agents.approval.requested.v1') {
		// R2 agent call parked for human review (§13.5): notify every active
		// member whose role grants approval.decide.
		const approvalId = typeof p['approvalId'] === 'string' ? p['approvalId'] : null
		if (approvalId) {
			const approvers = await tx<{ userId: string }[]>`
				SELECT DISTINCT m.user_id AS "userId"
				FROM memberships m
				JOIN role_permissions rp
					ON rp.workspace_id = m.workspace_id AND rp.role_id = m.role_id
				WHERE m.workspace_id = ${event.workspaceId}
					AND m.status = 'active'
					AND rp.permission = 'approval.decide'
			`
			for (const { userId } of approvers) {
				if (userId === actorId) continue
				createdNotifications.push(
					await insertNotificationRow(tx, {
						workspaceId: event.workspaceId,
						recipientUserId: userId,
						actorType,
						actorId,
						kind: 'approval.requested',
						entityType: 'agent_approval',
						entityId: approvalId,
						title: `Approval needed: ${String(p['tool'] ?? 'agent tool')} by ${String(
							p['agentName'] ?? 'agent'
						)}`,
						body: '',
						metadata: {
							approvalId,
							agentId: p['agentId'] ?? null,
							tool: p['tool'] ?? null,
							tier: p['tier'] ?? null
						}
					})
				)
			}
		}
	} else if (event.eventType === 'mail.conversation.assigned.v1') {
		const recipient = typeof p['assigneeUserId'] === 'string' ? p['assigneeUserId'] : null
		const conversationId = typeof p['conversationId'] === 'string' ? p['conversationId'] : null
		if (recipient && conversationId && recipient !== actorId) {
			createdNotifications.push(
				await insertNotificationRow(tx, {
					workspaceId: event.workspaceId,
					recipientUserId: recipient,
					actorType,
					actorId,
					kind: 'mail.assigned',
					entityType: 'mail_conversation',
					entityId: conversationId,
					title: `Assigned conversation: ${String(p['subject'] ?? '')}`,
					body: '',
					metadata: { accountId: p['accountId'] ?? null }
				})
			)
		}
	} else if (event.eventType === 'mail.note.mentioned.v1') {
		const conversationId = typeof p['conversationId'] === 'string' ? p['conversationId'] : null
		const mentioned = Array.isArray(p['mentionedUserIds'])
			? p['mentionedUserIds'].filter((u): u is string => typeof u === 'string')
			: []
		if (conversationId) {
			for (const uid of new Set(mentioned)) {
				if (uid === actorId) continue
				createdNotifications.push(
					await insertNotificationRow(tx, {
						workspaceId: event.workspaceId,
						recipientUserId: uid,
						actorType,
						actorId,
						kind: 'mail.mentioned',
						entityType: 'mail_conversation',
						entityId: conversationId,
						title: 'Mentioned in a mail note',
						body: String(p['bodyText'] ?? '').slice(0, 240),
						metadata: {}
					})
				)
			}
		}
	} else if (event.eventType === 'docs.verification.expiring.v1') {
		const pageId = typeof p['pageId'] === 'string' ? p['pageId'] : null
		if (pageId) {
			const targets = new Set<string>()
			if (typeof p['verifiedBy'] === 'string' && p['verifiedBy']) targets.add(p['verifiedBy'])
			if (typeof p['pageCreatedBy'] === 'string' && p['pageCreatedBy']) targets.add(p['pageCreatedBy'])
			const pageTitle = String(p['pageTitle'] ?? 'Document')
			for (const uid of targets) {
				createdNotifications.push(
					await insertNotificationRow(tx, {
						workspaceId: event.workspaceId,
						recipientUserId: uid,
						actorType: 'system',
						actorId: null,
						kind: 'doc.verification_expiring',
						entityType: 'doc_page',
						entityId: pageId,
						title: `Wiki verification expiring soon: ${pageTitle}`,
						body: `Expires at ${String(p['expiresAt'] ?? '')}`,
						metadata: {
							slug: typeof p['pageSlug'] === 'string' ? p['pageSlug'] : null,
							expiresAt: p['expiresAt'] ?? null
						}
					})
				)
			}
		}
	} else if (event.eventType === 'docs.suggestion.created.v1') {
		const pageId = typeof p['pageId'] === 'string' ? p['pageId'] : null
		const pageCreatedBy = typeof p['pageCreatedBy'] === 'string' ? p['pageCreatedBy'] : null
		if (pageId && pageCreatedBy && pageCreatedBy !== actorId) {
			const pageTitle = String(p['pageTitle'] ?? 'Document')
			createdNotifications.push(
				await insertNotificationRow(tx, {
					workspaceId: event.workspaceId,
					recipientUserId: pageCreatedBy,
					actorType,
					actorId,
					kind: 'doc.suggestion_created',
					entityType: 'doc_page',
					entityId: pageId,
					title: `New suggested edit on ${pageTitle}`,
					body: '',
					metadata: {
						suggestionId: p['suggestionId'] ?? null,
						groupId: p['groupId'] ?? null,
						kind: p['kind'] ?? null
					}
				})
			)
		}
	}

	if (createdNotifications.length === 0) {
		return { cursor: null, pendingWebPush, pendingMobilePush, pendingEmail }
	}

	const extraRecipientIds = [
		...new Set(createdNotifications.filter((n) => !chatMobileHandled.has(n.id)).map((n) => n.recipientUserId))
	]
	if (extraRecipientIds.length > 0) {
		const extraPrefs = await getNotificationPreferencesMap(tx, event.workspaceId, extraRecipientIds)
		const nowIso = new Date().toISOString()
		for (const notif of createdNotifications) {
			if (chatMobileHandled.has(notif.id)) continue
			const pref = extraPrefs.get(notif.recipientUserId)
			if (
				pref?.mobilePushEnabled &&
				!isWithinQuietHours(nowIso, pref.quietHoursStart, pref.quietHoursEnd, pref.timezone)
			) {
				pendingMobilePush.push({ userId: notif.recipientUserId, notification: notif })
			}
			if (pref?.emailInstantEnabled && INSTANT_EMAIL_KINDS.has(notif.kind)) {
				if (isWithinQuietHours(nowIso, pref.quietHoursStart, pref.quietHoursEnd, pref.timezone)) {
					await insertNotificationDeliveryLog(tx, {
						workspaceId: event.workspaceId,
						notificationId: notif.id,
						userId: notif.recipientUserId,
						channel: 'email_instant',
						status: 'skipped_quiet_hours',
						dedupeKey: `email_instant:${notif.id}`,
						detail: `Quiet hours (${pref.quietHoursStart}-${pref.quietHoursEnd} ${pref.timezone})`
					})
				} else {
					pendingEmail.push({ userId: notif.recipientUserId, notification: notif })
				}
			}
		}
	}

	if (pendingWebPush.length > 0 || pendingMobilePush.length > 0 || pendingEmail.length > 0) {
		const recipients = [
			...new Set([...pendingWebPush, ...pendingMobilePush, ...pendingEmail].map((item) => item.userId))
		]
		const availability = await getUsersAvailabilityMap(tx, event.workspaceId, recipients, presence)
		const atIso = new Date().toISOString()
		const webKept = await filterAvailabilitySuppressed(
			tx,
			event.workspaceId,
			pendingWebPush,
			'web_push',
			availability,
			atIso
		)
		const mobileKept = await filterAvailabilitySuppressed(
			tx,
			event.workspaceId,
			pendingMobilePush,
			'mobile_push',
			availability,
			atIso
		)
		const emailKept = await filterAvailabilitySuppressed(
			tx,
			event.workspaceId,
			pendingEmail,
			'email_instant',
			availability,
			atIso
		)
		pendingWebPush.splice(0, pendingWebPush.length, ...webKept)
		pendingMobilePush.splice(0, pendingMobilePush.length, ...mobileKept)
		pendingEmail.splice(0, pendingEmail.length, ...emailKept)
	}

	const changes: ChangeLogEntry[] = createdNotifications.map((n) => ({
		entityType: 'notification',
		entityId: n.id,
		action: 'upsert',
		scope: [`user:${n.recipientUserId}`],
		payload: n as unknown as Record<string, unknown>,
		actorId
	}))
	const cursor = await appendChanges(tx, event.workspaceId, changes)
	return { cursor, pendingWebPush, pendingMobilePush, pendingEmail }
}

const URGENT_NOTIFICATION_KINDS = new Set<NotificationKind>([
	'approval.requested',
	'issue.mentioned',
	'doc.mentioned',
	'chat.mentioned',
	'mail.mentioned'
])

async function filterAvailabilitySuppressed(
	tx: Queryable,
	workspaceId: string,
	list: readonly PendingWebPushDispatch[],
	channel: 'web_push' | 'mobile_push' | 'email_instant',
	availability: Awaited<ReturnType<typeof getUsersAvailabilityMap>>,
	atIso: string
): Promise<PendingWebPushDispatch[]> {
	const kept: PendingWebPushDispatch[] = []
	for (const item of list) {
		const resolved = availability.get(item.userId)
		if (!resolved) {
			// No durable row → no basis to suppress (safe default).
			kept.push(item)
			continue
		}
		const reason = evaluateNotificationSuppression({
			availability: {
				state: resolved.state,
				isAcceptingNotifications: resolved.isAcceptingNotifications
			},
			nowUtcIso: atIso,
			allowUrgentOverride: resolved.allowUrgentOverride,
			isUrgent: URGENT_NOTIFICATION_KINDS.has(item.notification.kind)
		})
		if (!reason) {
			kept.push(item)
			continue
		}
		await insertNotificationDeliveryLog(tx, {
			workspaceId,
			notificationId: item.notification.id,
			userId: item.userId,
			channel,
			status: reason,
			dedupeKey: `${channel}:${item.notification.id}`,
			detail: `Suppressed by availability (${resolved.state})`
		})
	}
	return kept
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
		userId: actor.userId,
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
		userId: actor.userId,
		unreadOnly: false,
		limit: 100
	})
	return res.items
}

export async function getMyNotificationPreferences(
	tx: Queryable,
	actor: ActorContext
): Promise<NotificationPreferencesDto> {
	assertActiveWorkspaceMember(actor)
	return getOrDefaultNotificationPreferences(tx, actor.workspaceId, actor.principalId)
}

export async function updateMyNotificationPreferences(
	tx: Queryable,
	actor: ActorContext,
	input: UpdateNotificationPreferencesBody
): Promise<NotificationPreferencesDto> {
	assertActiveWorkspaceMember(actor)
	if (input.timezone) {
		try {
			new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format(new Date())
		} catch {
			throw new HttpError(422, 'validation_failed', `Unknown IANA timezone "${input.timezone}"`)
		}
	}
	return upsertNotificationPreferences(tx, actor.workspaceId, actor.principalId, input)
}

export async function listMyWebPushSubscriptions(
	tx: Queryable,
	actor: ActorContext
): Promise<WebPushSubscriptionDto[]> {
	assertActiveWorkspaceMember(actor)
	return listWebPushSubscriptionsForUser(tx, actor.workspaceId, actor.principalId)
}

export async function registerWebPushSubscription(
	tx: Queryable,
	actor: ActorContext,
	input: CreateWebPushSubscriptionBody,
	resolver?: Parameters<typeof validateAndResolveEgressUrl>[1]
): Promise<WebPushSubscriptionDto> {
	assertActiveWorkspaceMember(actor)
	await validateAndResolveEgressUrl(input.endpoint, resolver)
	return upsertWebPushSubscription(tx, {
		workspaceId: actor.workspaceId,
		userId: actor.userId,
		endpoint: input.endpoint,
		p256dh: input.keys.p256dh,
		authSecret: input.keys.auth,
		userAgent: input.userAgent ?? ''
	})
}

export async function deleteMyWebPushSubscription(
	tx: Queryable,
	actor: ActorContext,
	subscriptionId: string
): Promise<void> {
	assertActiveWorkspaceMember(actor)
	const ok = await revokeWebPushSubscriptionById(tx, actor.workspaceId, subscriptionId, actor.principalId)
	if (!ok) throw new HttpError(404, 'not_found', 'Web Push subscription not found')
}

export async function listMyNotificationDeliveries(
	tx: Queryable,
	actor: ActorContext,
	limit = 50
): Promise<NotificationDeliveryLogDto[]> {
	assertActiveWorkspaceMember(actor)
	return listNotificationDeliveryLogs(tx, actor.workspaceId, actor.principalId, limit)
}

export async function listMyMobilePushTokens(
	tx: Queryable,
	actor: ActorContext
): Promise<MobilePushTokenDto[]> {
	assertActiveWorkspaceMember(actor)
	return listMobilePushTokensForUser(tx, actor.workspaceId, actor.principalId)
}

export async function registerMobilePushToken(
	tx: Queryable,
	actor: ActorContext,
	input: RegisterMobilePushTokenBody
): Promise<MobilePushTokenDto> {
	assertActiveWorkspaceMember(actor)
	return upsertMobilePushToken(tx, {
		workspaceId: actor.workspaceId,
		userId: actor.userId,
		token: input.token.trim(),
		platform: input.platform,
		deviceId: input.deviceId.trim(),
		deviceName: input.deviceName?.trim() ?? ''
	})
}

export async function deleteMyMobilePushToken(
	tx: Queryable,
	actor: ActorContext,
	tokenId: string
): Promise<void> {
	assertActiveWorkspaceMember(actor)
	const ok = await revokeMobilePushTokenById(tx, actor.workspaceId, tokenId, actor.principalId)
	if (!ok) throw new HttpError(404, 'not_found', 'Mobile push token not found')
}
