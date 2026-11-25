/**
 * Offline-first preview replica & local API bridge (§9.5).
 * Lazy-loaded via dynamic `import('./preview-workspace')` so TipTap/Yjs/editor
 * stay out of the initial web shell bundle budget (<= 200 KB gzip).
 */
import type {
	AgentApprovalDto,
	AgentPrincipalDto,
	AiProviderDto,
	ChatChannelDto,
	ChatChannelMemberDto,
	ChatMessageDto,
	DocCommentDto,
	DocPageDetailDto,
	DocPageDto,
	DocVersionDto,
	EmailPipelineStatusDto,
	FileDto,
	GithubInstallationDto,
	IssueCommentDto,
	IssueGithubLinkDto,
	IssueRelationDto,
	MailAccountDto,
	MailConversationDto,
	MailConversationEventDto,
	MailDraftDto,
	MailIdentityDto,
	MailInboxDto,
	MailMessageDto,
	MailNoteDto,
	NotificationDto,
	NotificationPreferencesDto,
	ProjectDto,
	ProjectStatusDto,
	SearchHitDto,
	SendTestEmailResponse,
	WebhookDeliveryDto,
	WebhookEndpointDto,
	WebPushSubscriptionDto,
	WorkspaceExportDto
} from '@huriro/contracts'
import { computeDmKey, extractRichLinks, parseSearchQuery } from '@huriro/domain'
import {
	diffVersionText,
	extractDocumentContent,
	markdownToProseMirrorJson,
	prosemirrorJsonToYDoc,
	ydocToMarkdown
} from '@huriro/editor'
import {
	generateUuidV7,
	HuriroSyncEngine,
	MemoryReplicaStorage,
	type ReplicaStorage
} from '@huriro/sync-client'
import * as Y from 'yjs'
import {
	type AgentApiKeyDto,
	type BootstrappedWorkspace,
	type CreatedApiKeyDto,
	PREVIEW_PROJECT_ENG_ID,
	PREVIEW_PROJECT_SEC_ID,
	PREVIEW_USER_ID,
	PREVIEW_WORKSPACE_ID,
	type ResourceAclItemDto,
	type TaskApiBridge,
	type WorkspaceMemberSummary
} from './api-bridge'

export function createPreviewSeedSnapshot() {
	const now = '2026-11-22T12:00:00Z'
	const statusBacklogId = '0190a0b1-0000-7000-8000-000000000101'
	const statusTodoId = '0190a0b1-0000-7000-8000-000000000102'
	const statusProgressId = '0190a0b1-0000-7000-8000-000000000103'
	const statusDoneId = '0190a0b1-0000-7000-8000-000000000104'
	const secTodoId = '0190a0b1-0000-7000-8000-000000000105'
	const secDoneId = '0190a0b1-0000-7000-8000-000000000106'

	const projects: ProjectDto[] = [
		{
			id: PREVIEW_PROJECT_ENG_ID,
			workspaceId: PREVIEW_WORKSPACE_ID,
			key: 'ENG',
			name: 'Engineering',
			description: 'Core platform & offline-first sync architecture',
			visibility: 'workspace',
			position: 'F',
			archivedAt: null,
			createdBy: PREVIEW_USER_ID,
			createdAt: now,
			updatedAt: now,
			version: 1
		},
		{
			id: PREVIEW_PROJECT_SEC_ID,
			workspaceId: PREVIEW_WORKSPACE_ID,
			key: 'SEC',
			name: 'Security',
			description: 'Tenant isolation, RLS enforcement, and key rotation',
			visibility: 'private',
			position: 'V',
			archivedAt: null,
			createdBy: PREVIEW_USER_ID,
			createdAt: now,
			updatedAt: now,
			version: 1
		}
	]

	const projectStatuses: ProjectStatusDto[] = [
		{
			id: statusBacklogId,
			workspaceId: PREVIEW_WORKSPACE_ID,
			projectId: PREVIEW_PROJECT_ENG_ID,
			name: 'Backlog',
			category: 'backlog',
			color: 'neutral',
			position: 'D',
			isDefault: false,
			createdAt: now,
			updatedAt: now,
			version: 1
		},
		{
			id: statusTodoId,
			workspaceId: PREVIEW_WORKSPACE_ID,
			projectId: PREVIEW_PROJECT_ENG_ID,
			name: 'Todo',
			category: 'unstarted',
			color: 'info',
			position: 'F',
			isDefault: true,
			createdAt: now,
			updatedAt: now,
			version: 1
		},
		{
			id: statusProgressId,
			workspaceId: PREVIEW_WORKSPACE_ID,
			projectId: PREVIEW_PROJECT_ENG_ID,
			name: 'In Progress',
			category: 'started',
			color: 'warning',
			position: 'V',
			isDefault: false,
			createdAt: now,
			updatedAt: now,
			version: 1
		},
		{
			id: statusDoneId,
			workspaceId: PREVIEW_WORKSPACE_ID,
			projectId: PREVIEW_PROJECT_ENG_ID,
			name: 'Done',
			category: 'completed',
			color: 'success',
			position: 'l',
			isDefault: false,
			createdAt: now,
			updatedAt: now,
			version: 1
		},
		{
			id: secTodoId,
			workspaceId: PREVIEW_WORKSPACE_ID,
			projectId: PREVIEW_PROJECT_SEC_ID,
			name: 'Todo',
			category: 'unstarted',
			color: 'info',
			position: 'F',
			isDefault: true,
			createdAt: now,
			updatedAt: now,
			version: 1
		},
		{
			id: secDoneId,
			workspaceId: PREVIEW_WORKSPACE_ID,
			projectId: PREVIEW_PROJECT_SEC_ID,
			name: 'Done',
			category: 'completed',
			color: 'success',
			position: 'V',
			isDefault: false,
			createdAt: now,
			updatedAt: now,
			version: 1
		}
	]

	const issues = [
		{
			id: '0190a0b1-0000-7000-8000-000000000201',
			workspaceId: PREVIEW_WORKSPACE_ID,
			projectId: PREVIEW_PROJECT_ENG_ID,
			projectKey: 'ENG',
			number: 1,
			identifier: 'ENG-1',
			parentId: null,
			cycleId: null,
			title: 'Enforce contiguous cursor allocation on write commit',
			description: null,
			descriptionText: 'Allocate change_log cursors after domain and audit writes finish.',
			statusId: statusProgressId,
			priority: 4,
			assigneeType: 'user' as const,
			assigneeId: PREVIEW_USER_ID,
			creatorId: PREVIEW_USER_ID,
			position: 'F',
			startDate: null,
			dueDate: '2026-11-23T18:00:00Z',
			estimate: 3,
			closedAt: null,
			labelIds: ['0190a0b1-0000-7000-8000-000000000301'],
			createdAt: now,
			updatedAt: now,
			deletedAt: null,
			version: 1
		},
		{
			id: '0190a0b1-0000-7000-8000-000000000202',
			workspaceId: PREVIEW_WORKSPACE_ID,
			projectId: PREVIEW_PROJECT_ENG_ID,
			projectKey: 'ENG',
			number: 2,
			identifier: 'ENG-2',
			parentId: null,
			cycleId: null,
			title: 'Wire fractional index rebalancing at 64-character depth',
			description: null,
			descriptionText: 'Preserve sorted order cleanly across concurrent board moves.',
			statusId: statusTodoId,
			priority: 3,
			assigneeType: 'user' as const,
			assigneeId: PREVIEW_USER_ID,
			creatorId: PREVIEW_USER_ID,
			position: 'V',
			startDate: null,
			dueDate: '2026-11-25T18:00:00Z',
			estimate: 2,
			closedAt: null,
			labelIds: [],
			createdAt: now,
			updatedAt: now,
			deletedAt: null,
			version: 1
		},
		{
			id: '0190a0b1-0000-7000-8000-000000000203',
			workspaceId: PREVIEW_WORKSPACE_ID,
			projectId: PREVIEW_PROJECT_ENG_ID,
			projectKey: 'ENG',
			number: 3,
			identifier: 'ENG-3',
			parentId: null,
			cycleId: null,
			title: 'Implement OPFS replica storage with IndexedDB fallback',
			description: null,
			descriptionText: 'Keep 5,000 offline mutations durable across tab reloads.',
			statusId: statusDoneId,
			priority: 2,
			assigneeType: null,
			assigneeId: null,
			creatorId: PREVIEW_USER_ID,
			position: 'F',
			startDate: null,
			dueDate: null,
			estimate: 5,
			closedAt: now,
			labelIds: [],
			createdAt: now,
			updatedAt: now,
			deletedAt: null,
			version: 1
		},
		{
			id: '0190a0b1-0000-7000-8000-000000000204',
			workspaceId: PREVIEW_WORKSPACE_ID,
			projectId: PREVIEW_PROJECT_SEC_ID,
			projectKey: 'SEC',
			number: 1,
			identifier: 'SEC-1',
			parentId: null,
			cycleId: null,
			title: 'Audit FORCE ROW LEVEL SECURITY across M1 tables',
			description: null,
			descriptionText: 'Verify private project ACL isolation and cross-tenant deny paths.',
			statusId: secTodoId,
			priority: 4,
			assigneeType: 'user' as const,
			assigneeId: PREVIEW_USER_ID,
			creatorId: PREVIEW_USER_ID,
			position: 'F',
			startDate: null,
			dueDate: '2026-11-23T18:00:00Z',
			estimate: 3,
			closedAt: null,
			labelIds: [],
			createdAt: now,
			updatedAt: now,
			deletedAt: null,
			version: 1
		}
	]

	const notifications: NotificationDto[] = [
		{
			id: '0190a0b1-0000-7000-8000-000000000401',
			workspaceId: PREVIEW_WORKSPACE_ID,
			recipientUserId: PREVIEW_USER_ID,
			actorType: 'user',
			actorId: PREVIEW_USER_ID,
			kind: 'issue.assigned',
			entityType: 'issue',
			entityId: issues[0]?.id ?? '',
			title: 'Assigned ENG-1: Enforce contiguous cursor allocation on write commit',
			body: 'Priority set to Urgent',
			metadata: {},
			readAt: null,
			archivedAt: null,
			createdAt: now
		}
	]

	const docRootId = '0190a0b1-0000-7000-8000-000000000601'
	const docRfcId = '0190a0b1-0000-7000-8000-000000000602'
	const docSecId = '0190a0b1-0000-7000-8000-000000000603'
	const docPages: DocPageDto[] = [
		{
			id: docRootId,
			workspaceId: PREVIEW_WORKSPACE_ID,
			parentId: null,
			path: docRootId,
			depth: 0,
			slug: 'engineering-handbook',
			title: 'Engineering Handbook',
			icon: '📘',
			visibility: 'workspace',
			isTemplate: false,
			isFavorite: true,
			position: 'F',
			createdBy: PREVIEW_USER_ID,
			archivedAt: null,
			createdAt: now,
			updatedAt: now,
			version: 1,
			byteSize: 512
		},
		{
			id: docRfcId,
			workspaceId: PREVIEW_WORKSPACE_ID,
			parentId: docRootId,
			path: `${docRootId}/${docRfcId}`,
			depth: 1,
			slug: 'rfc-crdt-collab',
			title: 'RFC-008: CRDT Collaboration Architecture',
			icon: '⚡',
			visibility: 'workspace',
			isTemplate: false,
			isFavorite: false,
			position: 'F',
			createdBy: PREVIEW_USER_ID,
			archivedAt: null,
			createdAt: now,
			updatedAt: now,
			version: 1,
			byteSize: 768
		},
		{
			id: docSecId,
			workspaceId: PREVIEW_WORKSPACE_ID,
			parentId: null,
			path: docSecId,
			depth: 0,
			slug: 'incident-runbook',
			title: 'Incident Response Runbook',
			icon: '🛡️',
			visibility: 'private',
			isTemplate: false,
			isFavorite: false,
			position: 'V',
			createdBy: PREVIEW_USER_ID,
			archivedAt: null,
			createdAt: now,
			updatedAt: now,
			version: 1,
			byteSize: 384
		}
	]

	return {
		cursor: 1,
		serverTime: now,
		projects,
		projectStatuses,
		labels: [
			{
				id: '0190a0b1-0000-7000-8000-000000000301',
				workspaceId: PREVIEW_WORKSPACE_ID,
				name: 'sync-engine',
				color: 'info',
				createdAt: now,
				updatedAt: now,
				version: 1
			}
		],
		cycles: [],
		issues,
		savedViews: [
			{
				id: '0190a0b1-0000-7000-8000-000000000501',
				workspaceId: PREVIEW_WORKSPACE_ID,
				projectId: null,
				ownerUserId: PREVIEW_USER_ID,
				name: 'High Priority',
				layout: 'list' as const,
				filters: { priorities: [3] },
				sort: {},
				isShared: true,
				position: 'F',
				createdAt: now,
				updatedAt: now,
				version: 1
			}
		],
		notifications,
		docPages
	}
}

function buildPreviewYDocState(markdown: string, seed: string) {
	const json = markdownToProseMirrorJson(markdown, seed)
	const ydoc = prosemirrorJsonToYDoc(json)
	const state = Y.encodeStateAsUpdate(ydoc)
	const stateVector = Y.encodeStateVector(ydoc)
	const extracted = extractDocumentContent(ydoc)
	return { state, stateVector, extracted }
}

const PREVIEW_DOC_MARKDOWN: Record<string, string> = {
	'engineering-handbook': [
		'# Engineering Handbook',
		'',
		'Welcome to the **Huriro** workspace knowledge base. All documents are backed by CRDTs and offline persistence.',
		'',
		'## Core Principles',
		'',
		'- Local-first writes via TanStack DB & Yjs',
		'- [x] Strict PostgreSQL FORCE RLS multi-tenancy',
		'- [ ] Continuous WebSocket soak testing',
		'',
		'## Architecture Overview',
		'',
		'Use `/` to insert structured blocks (callouts, toggles, tables, or code fences).'
	].join('\n'),
	'rfc-crdt-collab': [
		'# RFC-008: CRDT Collaboration Architecture',
		'',
		'## Summary',
		'',
		'Documents synchronize peer edits via `HocuspocusProvider` over `/collab` with single-use HKDF tickets.',
		'',
		'## Fencing & Crash Recovery',
		'',
		'Each active document room acquires a PostgreSQL lease in `doc_room_leases` to prevent split-brain writes.'
	].join('\n'),
	'incident-runbook': [
		'# Incident Response Runbook',
		'',
		'1. Page on-call responder in Chat',
		'2. Capture diagnostic logs & `/metrics` snapshot',
		'3. Coordinate mitigation in this private doc'
	].join('\n')
}

export function createPreviewApiBridge(
	engine: HuriroSyncEngine,
	opts?: { readonly mode?: 'selfhost' | 'cloud' | undefined }
): TaskApiBridge {
	const commentsByIssue = new Map<string, IssueCommentDto[]>()
	const relationsByIssue = new Map<string, IssueRelationDto[]>()
	const docStatesByPage = new Map<
		string,
		{ state: Uint8Array; stateVector: Uint8Array; plainText: string; headings: DocPageDetailDto['headings'] }
	>()
	function bytesToBase64(bytes: Uint8Array): string {
		let bin = ''
		for (let i = 0; i < bytes.length; i++) {
			bin += String.fromCharCode(bytes[i] ?? 0)
		}
		return btoa(bin)
	}
	const docCommentsByPage = new Map<string, DocCommentDto[]>()
	const docVersionsByPage = new Map<string, Array<DocVersionDto & { state: Uint8Array }>>()
	const docAclsByResource = new Map<string, ResourceAclItemDto[]>()

	// M4 Preview State: members, channels, messages, files, prefs, webhooks & GitHub sync
	const now = '2026-11-22T12:00:00Z'
	let previewWorkspaceExports: WorkspaceExportDto[] = []
	const PREVIEW_USER_ADA_ID = '0190a0b1-0000-7000-8000-000000000003'
	const PREVIEW_CHAN_GENERAL_ID = '0190a0b1-0000-7000-8000-000000000801'
	const PREVIEW_CHAN_ENG_ID = '0190a0b1-0000-7000-8000-000000000802'
	const previewMembers: WorkspaceMemberSummary[] = [
		{
			userId: PREVIEW_USER_ID,
			displayName: 'Hagen (Owner)',
			email: 'hagen@huriro.local',
			role: 'owner'
		},
		{
			userId: PREVIEW_USER_ADA_ID,
			displayName: 'Ada Lovelace',
			email: 'ada@huriro.local',
			role: 'admin'
		}
	]
	const previewNow = '2026-11-22T12:15:00Z'
	let previewChannels: ChatChannelDto[] = [
		{
			id: PREVIEW_CHAN_GENERAL_ID,
			workspaceId: PREVIEW_WORKSPACE_ID,
			kind: 'public',
			name: 'general',
			topic: 'Workspace announcements and cross-team check-ins',
			lastMsgSeq: 1,
			lastRev: 1,
			createdBy: PREVIEW_USER_ID,
			archivedAt: null,
			createdAt: previewNow,
			updatedAt: previewNow,
			version: 1,
			unreadCount: 0,
			hasUnread: false,
			mentionCount: 0,
			muted: false,
			lastReadSeq: 1,
			isMember: true,
			memberCount: 2,
			members: [
				{
					channelId: PREVIEW_CHAN_GENERAL_ID,
					principalType: 'user',
					principalId: PREVIEW_USER_ID,
					role: 'admin',
					displayName: 'Hagen (Owner)',
					email: 'hagen@huriro.local',
					joinedAt: previewNow
				},
				{
					channelId: PREVIEW_CHAN_GENERAL_ID,
					principalType: 'user',
					principalId: PREVIEW_USER_ADA_ID,
					role: 'member',
					displayName: 'Ada Lovelace',
					email: 'ada@huriro.local',
					joinedAt: previewNow
				}
			]
		},
		{
			id: PREVIEW_CHAN_ENG_ID,
			workspaceId: PREVIEW_WORKSPACE_ID,
			kind: 'public',
			name: 'engineering',
			topic: 'Sync engine, Postgres RLS & M4 rollout',
			lastMsgSeq: 2,
			lastRev: 2,
			createdBy: PREVIEW_USER_ADA_ID,
			archivedAt: null,
			createdAt: previewNow,
			updatedAt: previewNow,
			version: 1,
			unreadCount: 2,
			hasUnread: true,
			mentionCount: 0,
			muted: false,
			lastReadSeq: 0,
			isMember: true,
			memberCount: 2,
			members: [
				{
					channelId: PREVIEW_CHAN_ENG_ID,
					principalType: 'user',
					principalId: PREVIEW_USER_ADA_ID,
					role: 'admin',
					displayName: 'Ada Lovelace',
					email: 'ada@huriro.local',
					joinedAt: previewNow
				},
				{
					channelId: PREVIEW_CHAN_ENG_ID,
					principalType: 'user',
					principalId: PREVIEW_USER_ID,
					role: 'member',
					displayName: 'Hagen (Owner)',
					email: 'hagen@huriro.local',
					joinedAt: previewNow
				}
			]
		}
	]
	const previewMsg1Id = '0190a0b1-0000-7000-8000-000000000901'
	const previewMsg2Id = '0190a0b1-0000-7000-8000-000000000902'
	const previewMsg3Id = '0190a0b1-0000-7000-8000-000000000903'
	const previewMessages = new Map<string, ChatMessageDto>([
		[
			previewMsg1Id,
			{
				id: previewMsg1Id,
				workspaceId: PREVIEW_WORKSPACE_ID,
				channelId: PREVIEW_CHAN_GENERAL_ID,
				channelSeq: 1,
				threadSeq: null,
				rev: 1,
				authorType: 'user',
				authorId: PREVIEW_USER_ADA_ID,
				authorDisplayName: 'Ada Lovelace',
				threadParentId: null,
				replyCount: 0,
				lastReplyAt: null,
				clientId: null,
				body: {
					type: 'text',
					text: 'Welcome to Huriro M4! Review doc:engineering-handbook and issue:ENG-1.'
				},
				bodyText: 'Welcome to Huriro M4! Review doc:engineering-handbook and issue:ENG-1.',
				reactions: [{ emoji: '🚀', count: 1, reactedByMe: true, userIds: [PREVIEW_USER_ID] }],
				attachments: [],
				linkPreviews: [],
				richLinks: [],
				editedAt: null,
				deletedAt: null,
				createdAt: previewNow,
				updatedAt: previewNow,
				version: 1
			}
		],
		[
			previewMsg2Id,
			{
				id: previewMsg2Id,
				workspaceId: PREVIEW_WORKSPACE_ID,
				channelId: PREVIEW_CHAN_ENG_ID,
				channelSeq: 1,
				threadSeq: null,
				rev: 1,
				authorType: 'user',
				authorId: PREVIEW_USER_ADA_ID,
				authorDisplayName: 'Ada Lovelace',
				threadParentId: null,
				replyCount: 0,
				lastReplyAt: null,
				clientId: null,
				body: { type: 'text', text: 'Partitioned channel sync feeds verified at 500 msgs/burst.' },
				bodyText: 'Partitioned channel sync feeds verified at 500 msgs/burst.',
				reactions: [],
				attachments: [],
				linkPreviews: [],
				richLinks: [],
				editedAt: null,
				deletedAt: null,
				createdAt: previewNow,
				updatedAt: previewNow,
				version: 1
			}
		],
		[
			previewMsg3Id,
			{
				id: previewMsg3Id,
				workspaceId: PREVIEW_WORKSPACE_ID,
				channelId: PREVIEW_CHAN_ENG_ID,
				channelSeq: 2,
				threadSeq: null,
				rev: 2,
				authorType: 'user',
				authorId: PREVIEW_USER_ADA_ID,
				authorDisplayName: 'Ada Lovelace',
				threadParentId: null,
				replyCount: 0,
				lastReplyAt: null,
				clientId: null,
				body: { type: 'text', text: 'Checking issue:ENG-2 fractional index rebalancing next.' },
				bodyText: 'Checking issue:ENG-2 fractional index rebalancing next.',
				reactions: [],
				attachments: [],
				linkPreviews: [],
				richLinks: [],
				editedAt: null,
				deletedAt: null,
				createdAt: previewNow,
				updatedAt: previewNow,
				version: 1
			}
		]
	])
	const previewFiles = new Map<string, FileDto>()
	let previewNotifPrefs: NotificationPreferencesDto = {
		workspaceId: PREVIEW_WORKSPACE_ID,
		userId: PREVIEW_USER_ID,
		chatLevel: 'mentions',
		emailDigestFrequency: 'off',
		quietHoursStart: '22:00',
		quietHoursEnd: '07:00',
		timezone: 'UTC',
		webPushEnabled: false,
		mobilePushEnabled: false,
		emailInstantEnabled: true,
		lastDigestSentAt: null,
		updatedAt: previewNow
	}
	let previewPushSubs: WebPushSubscriptionDto[] = []
	let previewWebhooks: WebhookEndpointDto[] = []
	const previewDeliveries = new Map<string, WebhookDeliveryDto[]>()
	let previewGithubInstallations: GithubInstallationDto[] = [
		{
			id: '0190a0b1-0000-7000-8000-000000000850',
			workspaceId: PREVIEW_WORKSPACE_ID,
			installationId: 4242,
			accountLogin: 'huriro-org',
			repoFullName: 'huriro-org/huriro',
			projectId: PREVIEW_PROJECT_ENG_ID,
			syncEnabled: true,
			lastSyncedAt: previewNow,
			createdAt: previewNow,
			updatedAt: previewNow,
			version: 1
		}
	]
	let previewGithubLinks: IssueGithubLinkDto[] = [
		{
			id: '0190a0b1-0000-7000-8000-000000000851',
			workspaceId: PREVIEW_WORKSPACE_ID,
			issueId: '0190a0b1-0000-7000-8000-000000000201',
			installationId: '0190a0b1-0000-7000-8000-000000000850',
			repoFullName: 'huriro-org/huriro',
			githubIssueNumber: 12,
			githubIssueId: 90012,
			githubUrl: 'https://github.com/huriro-org/huriro/issues/12',
			sourceOfTruth: 'bidirectional',
			lastSyncedAt: previewNow,
			lastSyncHash: null,
			syncState: 'synced',
			lastSyncError: null,
			createdAt: previewNow,
			updatedAt: previewNow
		},
		{
			id: '0190a0b1-0000-7000-8000-000000000852',
			workspaceId: PREVIEW_WORKSPACE_ID,
			issueId: '0190a0b1-0000-7000-8000-000000000202',
			installationId: '0190a0b1-0000-7000-8000-000000000850',
			repoFullName: 'huriro-org/huriro',
			githubIssueNumber: 15,
			githubIssueId: 90015,
			githubUrl: 'https://github.com/huriro-org/huriro/issues/15',
			sourceOfTruth: 'bidirectional',
			lastSyncedAt: previewNow,
			lastSyncHash: null,
			syncState: 'push_failed',
			lastSyncError: 'GitHub API rate limit reached (HTTP 429)',
			createdAt: previewNow,
			updatedAt: previewNow
		}
	]

	// ── M3 preview state: agent principals, API keys, approvals, AI ──────
	let previewAgents: AgentPrincipalDto[] = [
		{
			id: '0190a0b1-0000-7000-8000-000000000860',
			workspaceId: PREVIEW_WORKSPACE_ID,
			kind: 'external_mcp',
			name: 'Claude Code',
			ownerUserId: PREVIEW_USER_ID,
			oauthClientId: 'claude-code',
			scopeCeiling: ['tasks.read', 'tasks.write', 'docs.read', 'search.read'],
			tierOverrides: {},
			requireApprovalAllWrites: false,
			status: 'active',
			lastActiveAt: previewNow,
			createdAt: previewNow
		},
		{
			id: '0190a0b1-0000-7000-8000-000000000861',
			workspaceId: PREVIEW_WORKSPACE_ID,
			kind: 'automation',
			name: 'API key: CI deploy bot',
			ownerUserId: PREVIEW_USER_ID,
			oauthClientId: null,
			scopeCeiling: ['tasks.read', 'tasks.write'],
			tierOverrides: {},
			requireApprovalAllWrites: true,
			status: 'active',
			lastActiveAt: null,
			createdAt: previewNow
		}
	]
	let previewApiKeys: AgentApiKeyDto[] = [
		{
			id: '0190a0b1-0000-7000-8000-000000000870',
			name: 'CI deploy bot',
			prefix: 'a1b2c3d4',
			agentId: '0190a0b1-0000-7000-8000-000000000861',
			scopes: ['tasks.read', 'tasks.write'],
			status: 'active',
			expiresAt: null,
			lastUsedAt: previewNow,
			createdAt: previewNow
		}
	]
	let previewApprovals: AgentApprovalDto[] = [
		{
			id: '0190a0b1-0000-7000-8000-000000000880',
			workspaceId: PREVIEW_WORKSPACE_ID,
			agentId: '0190a0b1-0000-7000-8000-000000000860',
			agentName: 'Claude Code',
			ownerUserId: PREVIEW_USER_ID,
			tool: 'tasks.bulk_update',
			argsHash: '9f2c1a',
			tokenScopes: ['tasks.read', 'tasks.write'],
			previewMd: '## Update 21 issues\n\nSet status to **Done** for all issues tagged `sprint-4`.',
			tier: 'R2',
			status: 'pending',
			decidedBy: null,
			decidedAt: null,
			decisionReason: null,
			expiresAt: '2026-12-31T12:00:00Z',
			errorCode: null,
			createdAt: previewNow
		}
	]
	let previewAiEnabled = false
	let previewAiProviders: AiProviderDto[] = []

	// M5: preview-mode mail seed — enough shape for the shared inbox UI to render
	// a believable demo without a server.
	const PREVIEW_MAIL_ACCOUNT_ID = '0190a0b1-0000-7000-8000-000000000a01'
	const PREVIEW_MAIL_INBOX_ID = '0190a0b1-0000-7000-8000-000000000a02'
	const PREVIEW_MAIL_IDENTITY_ID = '0190a0b1-0000-7000-8000-000000000a03'
	const PREVIEW_MAIL_CONV_ID = '0190a0b1-0000-7000-8000-000000000a04'
	let previewMailAccounts: MailAccountDto[] = [
		{
			id: PREVIEW_MAIL_ACCOUNT_ID,
			workspaceId: PREVIEW_WORKSPACE_ID,
			provider: 'inbound_parse',
			address: 'support@preview.huriro.dev',
			displayName: 'Support',
			defaultInboxId: PREVIEW_MAIL_INBOX_ID,
			status: 'active',
			statusDetail: null,
			lastSyncedAt: '2026-11-22T11:00:00Z',
			createdAt: '2026-11-22T09:00:00Z',
			updatedAt: '2026-11-22T09:00:00Z',
			version: 1,
			inboundUrl: null
		}
	]
	let previewMailIdentities: MailIdentityDto[] = [
		{
			id: PREVIEW_MAIL_IDENTITY_ID,
			accountId: PREVIEW_MAIL_ACCOUNT_ID,
			address: 'support@preview.huriro.dev',
			displayName: 'Huriro Support',
			isDefault: true,
			createdAt: '2026-11-22T09:00:00Z'
		}
	]
	let previewMailInboxes: MailInboxDto[] = [
		{
			id: PREVIEW_MAIL_INBOX_ID,
			workspaceId: PREVIEW_WORKSPACE_ID,
			name: 'Support',
			position: 'a0',
			settings: {},
			openCount: 1,
			createdAt: '2026-11-22T09:00:00Z'
		}
	]
	let previewMailConversations: MailConversationDto[] = [
		{
			id: PREVIEW_MAIL_CONV_ID,
			workspaceId: PREVIEW_WORKSPACE_ID,
			inboxId: PREVIEW_MAIL_INBOX_ID,
			accountId: PREVIEW_MAIL_ACCOUNT_ID,
			subject: 'Cannot export my workspace data',
			status: 'open',
			assigneeId: PREVIEW_USER_ID,
			assigneeName: 'Hagen (Owner)',
			snoozedUntil: null,
			mergedIntoId: null,
			lastMessageAt: '2026-11-22T11:30:00Z',
			firstReplyAt: '2026-11-22T10:15:00Z',
			customerEmail: 'customer@acme.example',
			snippet: 'When I click Export in settings nothing happens…',
			messageCount: 2,
			createdAt: '2026-11-22T10:00:00Z',
			updatedAt: '2026-11-22T11:30:00Z',
			version: 1
		}
	]
	const previewMailMessages: MailMessageDto[] = [
		{
			id: '0190a0b1-0000-7000-8000-000000000a11',
			conversationId: PREVIEW_MAIL_CONV_ID,
			direction: 'inbound',
			rfcMessageId: '<m1@acme.example>',
			fromAddr: { email: 'customer@acme.example', name: 'Acme Customer' },
			toAddrs: [{ email: 'support@preview.huriro.dev', name: null }],
			ccAddrs: [],
			subject: 'Cannot export my workspace data',
			snippet: 'When I click Export in settings nothing happens…',
			sentAt: '2026-11-22T10:00:00Z',
			receivedAt: '2026-11-22T10:00:00Z',
			bodyHtml: null,
			bodyText: 'Hi, when I click Export in settings nothing happens. Can you check? Thanks.',
			attachments: [],
			authResults: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
			sendState: null,
			createdBy: null,
			createdAt: '2026-11-22T10:00:00Z'
		},
		{
			id: '0190a0b1-0000-7000-8000-000000000a12',
			conversationId: PREVIEW_MAIL_CONV_ID,
			direction: 'outbound',
			rfcMessageId: '<r1@preview.huriro.dev>',
			fromAddr: { email: 'support@preview.huriro.dev', name: 'Huriro Support' },
			toAddrs: [{ email: 'customer@acme.example', name: null }],
			ccAddrs: [],
			subject: 'Re: Cannot export my workspace data',
			snippet: 'Thanks for reporting — we found the issue…',
			sentAt: '2026-11-22T10:15:00Z',
			receivedAt: '2026-11-22T10:15:00Z',
			bodyHtml: null,
			bodyText: 'Thanks for reporting — we found the issue and a fix ships today.',
			attachments: [],
			authResults: null,
			sendState: 'sent',
			createdBy: PREVIEW_USER_ID,
			createdAt: '2026-11-22T10:15:00Z'
		}
	]
	const previewMailEvents: (MailConversationEventDto & { readonly conversationId: string })[] = [
		{
			id: '0190a0b1-0000-7000-8000-000000000a21',
			conversationId: PREVIEW_MAIL_CONV_ID,
			kind: 'assigned',
			actorId: PREVIEW_USER_ID,
			actorName: 'Hagen (Owner)',
			payload: { assigneeId: PREVIEW_USER_ID },
			createdAt: '2026-11-22T10:05:00Z'
		}
	]
	let previewMailNotes: MailNoteDto[] = []
	let previewMailDrafts: MailDraftDto[] = []

	function resolvePreviewRichLinks(bodyText: string): ChatMessageDto['richLinks'] {
		const tokens = extractRichLinks(bodyText)
		const out: ChatMessageDto['richLinks'][number][] = []
		for (const tok of tokens) {
			if (tok.kind === 'issue') {
				const hit = engine.collections.issues.toArray.find(
					(i) => i.identifier.toUpperCase() === tok.ref.toUpperCase()
				)
				if (hit) {
					out.push({
						kind: 'issue',
						ref: hit.identifier,
						entityId: hit.id,
						title: hit.title,
						subtitle: hit.priority > 0 ? `P${hit.priority}` : null,
						deepLink: `/tasks/issues/${hit.identifier}`
					})
				}
			} else if (tok.kind === 'doc_page') {
				const hit = engine.collections.docPages.toArray.find(
					(d) => d.slug.toLowerCase() === tok.ref.toLowerCase()
				)
				if (hit) {
					out.push({
						kind: 'doc_page',
						ref: hit.slug,
						entityId: hit.id,
						title: hit.title,
						subtitle: null,
						deepLink: `/docs/${hit.slug}`
					})
				}
			}
		}
		return out
	}

	function hydratePreviewMsg(msg: ChatMessageDto): ChatMessageDto {
		return { ...msg, richLinks: resolvePreviewRichLinks(msg.bodyText) }
	}

	// Seed preview document states, comments, and versions on first access.
	for (const p of engine.collections.docPages.toArray) {
		const md = PREVIEW_DOC_MARKDOWN[p.slug] ?? `# ${p.title}\n\nStart writing…`
		const built = buildPreviewYDocState(md, p.id)
		docStatesByPage.set(p.id, {
			state: built.state,
			stateVector: built.stateVector,
			plainText: built.extracted.plainText,
			headings: built.extracted.headings
		})
		docVersionsByPage.set(p.id, [
			{
				id: `0190a0b1-0000-7000-8000-${p.id.slice(-12)}`,
				workspaceId: PREVIEW_WORKSPACE_ID,
				pageId: p.id,
				kind: 'named',
				label: 'Initial baseline',
				byteSize: built.state.byteLength,
				plainText: built.extracted.plainText,
				authors: [PREVIEW_USER_ID],
				createdBy: PREVIEW_USER_ID,
				createdAt: '2026-11-22T12:00:00Z',
				state: built.state
			}
		])
		if (p.slug === 'engineering-handbook') {
			docCommentsByPage.set(p.id, [
				{
					id: '0190a0b1-0000-7000-8000-000000000701',
					workspaceId: PREVIEW_WORKSPACE_ID,
					pageId: p.id,
					parentId: null,
					authorType: 'user',
					authorId: PREVIEW_USER_ID,
					anchorFrom: null,
					anchorTo: null,
					anchorQuote: 'Local-first writes via TanStack DB & Yjs',
					anchorBlockId: built.extracted.headings[0]?.blockId ?? null,
					anchorOrphaned: false,
					body: { type: 'text', text: 'Let us keep latency under 50ms p95.' },
					bodyText: 'Let us keep latency under 50ms p95.',
					resolvedAt: null,
					resolvedBy: null,
					createdAt: '2026-11-22T12:05:00Z',
					updatedAt: '2026-11-22T12:05:00Z',
					deletedAt: null,
					version: 1
				}
			])
		}
	}

	function ensurePreviewDocState(page: DocPageDto) {
		let entry = docStatesByPage.get(page.id)
		if (!entry) {
			const built = buildPreviewYDocState(`# ${page.title}\n\n`, page.id)
			entry = {
				state: built.state,
				stateVector: built.stateVector,
				plainText: built.extracted.plainText,
				headings: built.extracted.headings
			}
			docStatesByPage.set(page.id, entry)
		}
		return entry
	}

	return {
		async listMembers() {
			return previewMembers
		},
		async listComments(issueId) {
			return commentsByIssue.get(issueId) ?? []
		},
		async createComment(issueId, bodyText) {
			const next: IssueCommentDto = {
				id: generateUuidV7(),
				workspaceId: PREVIEW_WORKSPACE_ID,
				issueId,
				authorType: 'user',
				authorId: PREVIEW_USER_ID,
				body: bodyText,
				bodyText,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				deletedAt: null,
				version: 1
			}
			commentsByIssue.set(issueId, [...(commentsByIssue.get(issueId) ?? []), next])
			return next
		},
		async listRelations(issueId) {
			return relationsByIssue.get(issueId) ?? []
		},
		async createRelation(issueId, targetIssueId, kind) {
			const next: IssueRelationDto = {
				id: generateUuidV7(),
				workspaceId: PREVIEW_WORKSPACE_ID,
				sourceIssueId: issueId,
				targetIssueId,
				kind,
				createdBy: PREVIEW_USER_ID,
				createdAt: new Date().toISOString()
			}
			relationsByIssue.set(issueId, [...(relationsByIssue.get(issueId) ?? []), next])
			return next
		},
		async searchIssues(raw) {
			const parsed = parseSearchQuery(raw)
			const q = parsed.freeText.toLowerCase()
			const targetIdentifier = parsed.issueIdentifier
				? `${parsed.issueIdentifier.projectKey}-${parsed.issueIdentifier.number}`
				: null

			const issueHits: SearchHitDto[] =
				parsed.entityType && parsed.entityType !== 'issue'
					? []
					: engine.collections.issues.toArray
							.filter((issue) => {
								if (targetIdentifier && issue.identifier !== targetIdentifier) return false
								if (parsed.projectKey && issue.projectKey !== parsed.projectKey) return false
								if (parsed.priority !== null && issue.priority !== parsed.priority) return false
								if (q.length > 0) {
									const matchesText =
										issue.title.toLowerCase().includes(q) ||
										issue.identifier.toLowerCase().includes(q) ||
										issue.descriptionText.toLowerCase().includes(q)
									if (!matchesText) return false
								}
								return true
							})
							.slice(0, 12)
							.map((issue) => ({
								entityType: 'issue' as const,
								entityId: issue.id,
								projectId: issue.projectId,
								identifier: issue.identifier,
								title: issue.title,
								snippet: issue.descriptionText.slice(0, 120),
								score: targetIdentifier === issue.identifier ? 1 : 0.8,
								deepLink: `/tasks/issues/${issue.identifier}`,
								updatedAt: issue.updatedAt
							}))

			const docHits: SearchHitDto[] =
				parsed.entityType && parsed.entityType !== 'doc_page'
					? []
					: engine.collections.docPages.toArray
							.filter((doc) => {
								if (doc.archivedAt !== null) return false
								if (q.length === 0) return true
								const st = docStatesByPage.get(doc.id)
								return (
									doc.title.toLowerCase().includes(q) ||
									doc.slug.toLowerCase().includes(q) ||
									Boolean(st?.plainText.toLowerCase().includes(q))
								)
							})
							.slice(0, 8)
							.map((doc) => {
								const st = docStatesByPage.get(doc.id)
								return {
									entityType: 'doc_page' as const,
									entityId: doc.id,
									projectId: null,
									identifier: doc.slug,
									title: doc.title,
									snippet: (st?.plainText ?? doc.title).slice(0, 120),
									score: 0.75,
									deepLink: `/docs/${doc.slug}`,
									updatedAt: doc.updatedAt
								}
							})

			const messageHits: SearchHitDto[] =
				parsed.entityType && parsed.entityType !== 'message'
					? []
					: [...previewMessages.values()]
							.filter((m) => {
								if (m.deletedAt !== null) return false
								const chan = previewChannels.find((c) => c.id === m.channelId)
								if (parsed.channelName && chan?.name?.toLowerCase() !== parsed.channelName.toLowerCase()) {
									return false
								}
								return q.length === 0 || m.bodyText.toLowerCase().includes(q)
							})
							.slice(0, 8)
							.map((m) => {
								const chan = previewChannels.find((c) => c.id === m.channelId)
								return {
									entityType: 'message' as const,
									entityId: m.id,
									projectId: null,
									identifier: chan?.name ?? null,
									title: chan?.name ? `#${chan.name}` : 'Direct message',
									snippet: m.bodyText.slice(0, 120),
									score: 0.72,
									deepLink: `/chat?channel=${m.channelId}&message=${m.id}`,
									updatedAt: m.updatedAt
								}
							})

			return [...issueHits, ...docHits, ...messageHits]
		},
		async markAllNotificationsRead() {
			const nowIso = new Date().toISOString()
			for (const n of engine.collections.notifications.toArray) {
				if (n.readAt === null) {
					engine.collections.notificationsManaged.upsertMany([{ ...n, readAt: nowIso }])
				}
			}
			await engine.persistReplica()
		},
		async archiveNotification(notificationId) {
			const n = engine.collections.notifications.get(notificationId)
			if (!n) return
			engine.collections.notificationsManaged.upsertMany([{ ...n, archivedAt: new Date().toISOString() }])
			await engine.persistReplica()
		},
		async importDryRun(body) {
			if (body.source === 'notion' || body.source === 'markdown') {
				const pagesCount =
					body.source === 'notion' ? (body.notion?.pages.length ?? 0) : (body.markdown?.files.length ?? 0)
				return {
					jobId: generateUuidV7(),
					source: body.source,
					projectKey: 'DOCS',
					projectName: body.source === 'notion' ? 'Notion Import' : 'Markdown Import',
					counts: {
						issues: 0,
						comments: 0,
						labels: 0,
						skippedExisting: 0,
						pages: pagesCount
					},
					userMappings: [],
					unmappedFields: []
				}
			}
			if (body.source === 'slack') {
				const chans = body.slack?.channels ?? []
				let messages = 0
				let threads = 0
				for (const ch of chans) {
					for (const m of body.slack?.messagesByChannel[ch.id] ??
						body.slack?.messagesByChannel[ch.name] ??
						[]) {
						if (m.threadTs && m.threadTs !== m.ts) threads++
						else messages++
					}
				}
				return {
					jobId: generateUuidV7(),
					source: 'slack',
					projectKey: 'CHAT',
					projectName: 'Slack Import',
					counts: {
						issues: 0,
						comments: 0,
						labels: 0,
						skippedExisting: 0,
						channels: chans.length,
						messages,
						threads
					},
					userMappings: [],
					unmappedFields: []
				}
			}
			const payload =
				body.source === 'linear' ? body.linear : body.source === 'jira' ? body.jira : body.github
			const issues =
				payload && 'issues' in payload && Array.isArray(payload.issues)
					? payload.issues
					: body.source === 'jira' && body.jira?.csv
						? body.jira.csv
								.split(/\r?\n/)
								.slice(1)
								.filter((l) => l.trim().length > 0)
								.map((l, idx) => ({
									key: `JIRA-${idx + 1}`,
									summary: l.split(',')[2] ?? l.split(',')[0] ?? 'Jira issue',
									comments: [] as unknown[],
									labels: [] as string[]
								}))
						: []
			const comments = issues.reduce(
				(acc, i) => acc + ('comments' in i && Array.isArray(i.comments) ? i.comments.length : 0),
				0
			)
			const labels = new Set<string>()
			for (const issue of issues) {
				if ('labels' in issue && Array.isArray(issue.labels)) {
					for (const l of issue.labels) labels.add(String(l))
				}
			}
			return {
				jobId: generateUuidV7(),
				source: body.source,
				projectKey: payload?.projectKey ?? (body.source === 'jira' ? 'JIRA' : 'IMP'),
				projectName: payload?.projectName ?? 'Imported',
				counts: {
					issues: issues.length,
					comments,
					labels: labels.size,
					skippedExisting: 0
				},
				userMappings: [],
				unmappedFields: []
			}
		},
		async importExecute(body) {
			const now = new Date().toISOString()
			const src =
				body.source ??
				(body.slack
					? 'slack'
					: body.jira
						? 'jira'
						: body.notion
							? 'notion'
							: body.markdown
								? 'markdown'
								: body.linear
									? 'linear'
									: 'github')
			if (src === 'slack') {
				const chans = body.slack?.channels ?? []
				let importedMessages = 0
				for (const ch of chans) {
					const slug = ch.name.toLowerCase().replace(/[^a-z0-9-_]+/g, '-') || 'slack-channel'
					let target = previewChannels.find((c) => c.name === slug)
					if (!target) {
						target = {
							id: generateUuidV7(),
							workspaceId: PREVIEW_WORKSPACE_ID,
							kind: ch.isPrivate ? 'private' : 'public',
							name: slug,
							topic: ch.topic ?? '',
							lastMsgSeq: 0,
							lastRev: 0,
							createdBy: PREVIEW_USER_ID,
							archivedAt: null,
							createdAt: now,
							updatedAt: now,
							version: 1,
							unreadCount: 0,
							hasUnread: false,
							mentionCount: 0,
							muted: false,
							lastReadSeq: 0,
							isMember: true,
							memberCount: 1,
							members: []
						}
						previewChannels = [...previewChannels, target]
					}
					const msgs = body.slack?.messagesByChannel[ch.id] ?? body.slack?.messagesByChannel[ch.name] ?? []
					for (const m of msgs) {
						target.lastMsgSeq += 1
						target.lastRev += 1
						const msgId = generateUuidV7()
						previewMessages.set(msgId, {
							id: msgId,
							workspaceId: PREVIEW_WORKSPACE_ID,
							channelId: target.id,
							channelSeq: target.lastMsgSeq,
							threadSeq: null,
							rev: target.lastRev,
							authorType: 'user',
							authorId: PREVIEW_USER_ID,
							authorDisplayName: 'Hagen (Owner)',
							threadParentId: null,
							replyCount: 0,
							lastReplyAt: null,
							clientId: null,
							body: { type: 'text', text: m.text },
							bodyText: m.text,
							reactions: [],
							attachments: [],
							linkPreviews: [],
							richLinks: [],
							editedAt: null,
							deletedAt: null,
							createdAt: now,
							updatedAt: now,
							version: 1
						})
						importedMessages++
					}
				}
				return {
					id: generateUuidV7(),
					workspaceId: PREVIEW_WORKSPACE_ID,
					source: 'slack',
					status: 'completed',
					targetProjectId: null,
					preview: { channels: chans.length, messages: importedMessages },
					report: { importedChannels: chans.length, importedMessages },
					createdAt: now,
					updatedAt: now,
					completedAt: now,
					version: 1
				}
			}
			if (src === 'notion' || src === 'markdown') {
				const items =
					src === 'notion'
						? (body.notion?.pages ?? []).map((p) => ({
								title: p.title ?? p.remotePath.replace(/\.md$/i, ''),
								markdown: p.markdown
							}))
						: (body.markdown?.files ?? []).map((f) => ({
								title: f.title ?? f.path.replace(/\.md$/i, ''),
								markdown: f.markdown
							}))
				for (const item of items) {
					const created = await engine.createDocPage({
						title: item.title.slice(0, 200) || 'Imported Doc',
						markdown: item.markdown
					})
					const built = buildPreviewYDocState(item.markdown, created.id)
					docStatesByPage.set(created.id, {
						state: built.state,
						stateVector: built.stateVector,
						plainText: built.extracted.plainText,
						headings: built.extracted.headings
					})
				}
				return {
					id: generateUuidV7(),
					workspaceId: PREVIEW_WORKSPACE_ID,
					source: src,
					status: 'completed',
					targetProjectId: null,
					preview: { pages: items.length },
					report: { importedPages: items.length, skippedPages: 0 },
					createdAt: now,
					updatedAt: now,
					completedAt: now,
					version: 1
				}
			}
			const payload = src === 'linear' ? body.linear : src === 'jira' ? body.jira : body.github
			const projectKey = payload?.projectKey ?? (src === 'jira' ? 'JIRA' : 'IMP')
			const project = await engine.createProject({
				key: projectKey,
				name: payload?.projectName ?? projectKey,
				visibility: 'workspace'
			})
			const rawIssues =
				payload && 'issues' in payload && Array.isArray(payload.issues)
					? payload.issues
					: src === 'jira' && body.jira?.csv
						? body.jira.csv
								.split(/\r?\n/)
								.slice(1)
								.filter((l) => l.trim().length > 0)
								.map((l) => {
									const cols = l.split(',')
									return {
										summary: cols[2] ?? cols[0] ?? 'Jira issue',
										description: cols[3] ?? '',
										comments: []
									}
								})
						: []
			let importedIssues = 0
			let importedComments = 0
			for (const item of rawIssues) {
				const title = 'title' in item ? item.title : 'summary' in item ? item.summary : 'Imported issue'
				const descriptionText =
					'description' in item ? (item.description ?? '') : 'body' in item ? (item.body ?? '') : ''
				await engine.createIssue({
					projectId: project.id,
					title,
					descriptionText
				})
				importedIssues += 1
				importedComments += 'comments' in item && Array.isArray(item.comments) ? item.comments.length : 0
			}
			return {
				id: generateUuidV7(),
				workspaceId: PREVIEW_WORKSPACE_ID,
				source: src,
				status: 'completed',
				targetProjectId: project.id,
				preview: { issues: importedIssues },
				report: {
					projectId: project.id,
					projectKey: project.key,
					importedIssues,
					skippedIssues: 0,
					importedComments
				},
				createdAt: now,
				updatedAt: now,
				completedAt: now,
				version: 1
			}
		},
		async getDocBySlug(slug) {
			const page = engine.collections.docPages.toArray.find((p) => p.slug === slug && p.archivedAt === null)
			if (!page) {
				const err = new Error(`Document "${slug}" not found`) as Error & { status?: number }
				err.status = 404
				throw err
			}
			const st = ensurePreviewDocState(page)
			return {
				page,
				stateBase64: bytesToBase64(st.state),
				stateVectorBase64: bytesToBase64(st.stateVector),
				byteSize: st.state.byteLength,
				plainText: st.plainText,
				headings: st.headings,
				comments: docCommentsByPage.get(page.id) ?? [],
				canWrite: true,
				canShare: true
			}
		},
		async getDocDetail(pageId) {
			const page = engine.collections.docPages.get(pageId)
			if (!page || page.archivedAt !== null) {
				const err = new Error('Document not found') as Error & { status?: number }
				err.status = 404
				throw err
			}
			const st = ensurePreviewDocState(page)
			return {
				page,
				stateBase64: bytesToBase64(st.state),
				stateVectorBase64: bytesToBase64(st.stateVector),
				byteSize: st.state.byteLength,
				plainText: st.plainText,
				headings: st.headings,
				comments: docCommentsByPage.get(page.id) ?? [],
				canWrite: true,
				canShare: true
			}
		},
		async issueCollabTicket(pageId) {
			return {
				ticket: `preview-${pageId}`,
				documentName: `${PREVIEW_WORKSPACE_ID}:${pageId}`,
				permission: 'write',
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
				collabUrl: '/collab'
			}
		},
		async setDocFavorite(pageId, favorite) {
			const current = engine.collections.docPages.get(pageId)
			if (!current) throw new Error('Document not found')
			const next = { ...current, isFavorite: favorite }
			engine.collections.docPagesManaged.upsertMany([next])
			await engine.persistReplica()
			return next
		},
		async splitDocPage(pageId, title, _headingBlockId, markdown) {
			const parent = engine.collections.docPages.get(pageId)
			const created = await engine.createDocPage({
				parentId: parent ? pageId : null,
				title,
				...(markdown ? { markdown } : {})
			})
			const built = buildPreviewYDocState(markdown ?? `# ${title}\n`, created.id)
			docStatesByPage.set(created.id, {
				state: built.state,
				stateVector: built.stateVector,
				plainText: built.extracted.plainText,
				headings: built.extracted.headings
			})
			return created
		},
		async exportDocMarkdown(pageId) {
			const page = engine.collections.docPages.get(pageId)
			if (!page) throw new Error('Document not found')
			const st = ensurePreviewDocState(page)
			const ydoc = new Y.Doc()
			Y.applyUpdate(ydoc, st.state)
			return {
				pageId: page.id,
				slug: page.slug,
				title: page.title,
				markdown: ydocToMarkdown(ydoc)
			}
		},
		async importDocMarkdown(body) {
			const created = await engine.createDocPage({
				title: body.title ?? 'Imported Document',
				markdown: body.markdown
			})
			const built = buildPreviewYDocState(body.markdown, created.id)
			docStatesByPage.set(created.id, {
				state: built.state,
				stateVector: built.stateVector,
				plainText: built.extracted.plainText,
				headings: built.extracted.headings
			})
			return created
		},
		async listDocVersions(pageId) {
			return (docVersionsByPage.get(pageId) ?? []).map(({ state: _s, ...dto }) => dto)
		},
		async createDocVersion(pageId, label) {
			const page = engine.collections.docPages.get(pageId)
			if (!page) throw new Error('Document not found')
			const st = ensurePreviewDocState(page)
			const next = {
				id: generateUuidV7(),
				workspaceId: PREVIEW_WORKSPACE_ID,
				pageId,
				kind: 'named' as const,
				label,
				byteSize: st.state.byteLength,
				plainText: st.plainText,
				authors: [PREVIEW_USER_ID],
				createdBy: PREVIEW_USER_ID,
				createdAt: new Date().toISOString(),
				state: st.state
			}
			docVersionsByPage.set(pageId, [next, ...(docVersionsByPage.get(pageId) ?? [])])
			const { state: _s, ...dto } = next
			return dto
		},
		async getDocVersionDetail(pageId, versionId) {
			const list = docVersionsByPage.get(pageId) ?? []
			const idx = list.findIndex((v) => v.id === versionId)
			const ver = list[idx]
			if (!ver) throw new Error('Version not found')
			const prev = list[idx + 1]
			const { state: _s, ...dto } = ver
			return {
				version: dto,
				diff: diffVersionText(prev?.plainText ?? '', dto.plainText)
			}
		},
		async restoreDocVersion(pageId, versionId, label) {
			const page = engine.collections.docPages.get(pageId)
			const list = docVersionsByPage.get(pageId) ?? []
			const target = list.find((v) => v.id === versionId)
			if (!page || !target) throw new Error('Version not found')
			const current = ensurePreviewDocState(page)
			const checkpoint = {
				id: generateUuidV7(),
				workspaceId: PREVIEW_WORKSPACE_ID,
				pageId,
				kind: 'pre_restore' as const,
				label: label ?? `Before restoring ${target.label ?? target.id.slice(0, 6)}`,
				byteSize: current.state.byteLength,
				plainText: current.plainText,
				authors: [PREVIEW_USER_ID],
				createdBy: PREVIEW_USER_ID,
				createdAt: new Date().toISOString(),
				state: current.state
			}
			const restoredDoc = new Y.Doc()
			Y.applyUpdate(restoredDoc, target.state)
			const extracted = extractDocumentContent(restoredDoc)
			docStatesByPage.set(pageId, {
				state: target.state,
				stateVector: Y.encodeStateVector(restoredDoc),
				plainText: extracted.plainText,
				headings: extracted.headings
			})
			docVersionsByPage.set(pageId, [checkpoint, ...list])
			const { state: _s, ...checkpointDto } = checkpoint
			return {
				checkpointVersion: checkpointDto,
				detail: {
					page,
					stateBase64: bytesToBase64(target.state),
					stateVectorBase64: bytesToBase64(Y.encodeStateVector(restoredDoc)),
					byteSize: target.state.byteLength,
					plainText: extracted.plainText,
					headings: extracted.headings,
					comments: docCommentsByPage.get(pageId) ?? [],
					canWrite: true,
					canShare: true
				}
			}
		},
		async createDocComment(pageId, body) {
			const next: DocCommentDto = {
				id: body.id ?? generateUuidV7(),
				workspaceId: PREVIEW_WORKSPACE_ID,
				pageId,
				parentId: body.parentId ?? null,
				authorType: 'user',
				authorId: PREVIEW_USER_ID,
				anchorFrom: body.anchorFrom ?? null,
				anchorTo: body.anchorTo ?? null,
				anchorQuote: body.anchorQuote ?? '',
				anchorBlockId: body.anchorBlockId ?? null,
				anchorOrphaned: false,
				body: body.body ?? { type: 'text', text: body.bodyText },
				bodyText: body.bodyText,
				resolvedAt: null,
				resolvedBy: null,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				deletedAt: null,
				version: 1
			}
			docCommentsByPage.set(pageId, [...(docCommentsByPage.get(pageId) ?? []), next])
			return next
		},
		async updateDocComment(pageId, commentId, body) {
			const list = docCommentsByPage.get(pageId) ?? []
			const existing = list.find((c) => c.id === commentId)
			if (!existing) throw new Error('Comment not found')
			const updated: DocCommentDto = {
				...existing,
				bodyText: body.bodyText,
				body: body.body ?? existing.body,
				version: existing.version + 1,
				updatedAt: new Date().toISOString()
			}
			docCommentsByPage.set(
				pageId,
				list.map((c) => (c.id === commentId ? updated : c))
			)
			return updated
		},
		async resolveDocComment(pageId, commentId, resolved) {
			const list = docCommentsByPage.get(pageId) ?? []
			const existing = list.find((c) => c.id === commentId)
			if (!existing) throw new Error('Comment not found')
			const updated: DocCommentDto = {
				...existing,
				resolvedAt: resolved ? new Date().toISOString() : null,
				resolvedBy: resolved ? PREVIEW_USER_ID : null,
				version: existing.version + 1
			}
			docCommentsByPage.set(
				pageId,
				list.map((c) => (c.id === commentId ? updated : c))
			)
			return updated
		},
		async deleteDocComment(pageId, commentId) {
			const list = docCommentsByPage.get(pageId) ?? []
			docCommentsByPage.set(
				pageId,
				list.filter((c) => c.id !== commentId)
			)
		},
		async listResourceAcls(resourceType, resourceId) {
			return docAclsByResource.get(`${resourceType}:${resourceId}`) ?? []
		},
		async grantResourceAcl(input) {
			const key = `${input.resourceType}:${input.resourceId}`
			const item: ResourceAclItemDto = {
				id: generateUuidV7(),
				principalType: input.principalType,
				principalId: input.principalId,
				permission: input.permission
			}
			docAclsByResource.set(key, [...(docAclsByResource.get(key) ?? []), item])
			return item
		},
		async revokeResourceAcl(aclId) {
			for (const [k, list] of docAclsByResource.entries()) {
				docAclsByResource.set(
					k,
					list.filter((i) => i.id !== aclId)
				)
			}
		},
		async listChannels() {
			return previewChannels.filter((c) => c.archivedAt === null)
		},
		async getChannel(channelId) {
			const c = previewChannels.find((item) => item.id === channelId)
			if (!c) throw new Error('Channel not found')
			return c
		},
		async createChannel(body) {
			const ts = new Date().toISOString()
			const next: ChatChannelDto = {
				id: generateUuidV7(),
				workspaceId: PREVIEW_WORKSPACE_ID,
				kind: body.kind ?? 'public',
				name: body.name.trim().toLowerCase(),
				topic: body.topic ?? '',
				lastMsgSeq: 0,
				lastRev: 0,
				createdBy: PREVIEW_USER_ID,
				archivedAt: null,
				createdAt: ts,
				updatedAt: ts,
				version: 1,
				unreadCount: 0,
				hasUnread: false,
				mentionCount: 0,
				muted: false,
				lastReadSeq: 0,
				isMember: true,
				memberCount: 1 + (body.memberIds?.length ?? 0),
				members: [
					{
						channelId: '',
						principalType: 'user',
						principalId: PREVIEW_USER_ID,
						role: 'admin',
						displayName: 'Hagen (Owner)',
						email: 'hagen@huriro.local',
						joinedAt: ts
					}
				]
			}
			previewChannels = [...previewChannels, next]
			return next
		},
		async createOrGetDm(body) {
			const ts = new Date().toISOString()
			const ids = [PREVIEW_USER_ID, ...body.memberIds]
			const dmKey = computeDmKey(ids)
			const existing = previewChannels.find(
				(c) => c.kind === 'dm' && computeDmKey((c.members ?? []).map((m) => m.principalId)) === dmKey
			)
			if (existing) return existing
			const id = generateUuidV7()
			const members: ChatChannelMemberDto[] = ids.map((uid) => {
				const found = previewMembers.find((m) => m.userId === uid)
				return {
					channelId: id,
					principalType: 'user',
					principalId: uid,
					role: 'member',
					displayName: found?.displayName ?? uid.slice(0, 8),
					email: found?.email ?? '',
					joinedAt: ts
				}
			})
			const dm: ChatChannelDto = {
				id,
				workspaceId: PREVIEW_WORKSPACE_ID,
				kind: 'dm',
				name: null,
				topic: '',
				lastMsgSeq: 0,
				lastRev: 0,
				createdBy: PREVIEW_USER_ID,
				archivedAt: null,
				createdAt: ts,
				updatedAt: ts,
				version: 1,
				unreadCount: 0,
				hasUnread: false,
				mentionCount: 0,
				muted: false,
				lastReadSeq: 0,
				isMember: true,
				memberCount: members.length,
				members
			}
			previewChannels = [...previewChannels, dm]
			return dm
		},
		async updateChannel(channelId, body) {
			const c = previewChannels.find((item) => item.id === channelId)
			if (!c) throw new Error('Channel not found')
			const updated: ChatChannelDto = {
				...c,
				name: body.name ?? c.name,
				topic: body.topic ?? c.topic,
				archivedAt: body.archived ? new Date().toISOString() : null,
				version: c.version + 1
			}
			previewChannels = previewChannels.map((item) => (item.id === channelId ? updated : item))
			return updated
		},
		async addChannelMember(channelId, body) {
			const c = previewChannels.find((item) => item.id === channelId)
			if (!c) throw new Error('Channel not found')
			const found = previewMembers.find((m) => m.userId === body.principalId)
			const member: ChatChannelMemberDto = {
				channelId,
				principalType: body.principalType ?? 'user',
				principalId: body.principalId,
				role: body.role ?? 'member',
				displayName: found?.displayName ?? body.principalId.slice(0, 8),
				email: found?.email ?? '',
				joinedAt: new Date().toISOString()
			}
			const existing = (c.members ?? []).filter((m) => m.principalId !== body.principalId)
			const updated = { ...c, members: [...existing, member], memberCount: existing.length + 1 }
			previewChannels = previewChannels.map((item) => (item.id === channelId ? updated : item))
			return member
		},
		async removeChannelMember(channelId, principalId) {
			previewChannels = previewChannels.map((c) => {
				if (c.id !== channelId) return c
				const next = (c.members ?? []).filter((m) => m.principalId !== principalId)
				return { ...c, members: next, memberCount: next.length }
			})
		},
		async listMessages(channelId) {
			const c = previewChannels.find((item) => item.id === channelId)
			if (!c) throw new Error('Channel not found')
			const msgs = [...previewMessages.values()]
				.filter((m) => m.channelId === channelId && m.threadParentId === null && m.deletedAt === null)
				.sort((a, b) => (a.channelSeq ?? 0) - (b.channelSeq ?? 0))
				.map(hydratePreviewMsg)
			return {
				data: msgs,
				nextBeforeSeq: null,
				hasMore: false,
				lastMsgSeq: c.lastMsgSeq,
				lastRev: c.lastRev
			}
		},
		async listChannelChanges(channelId, sinceRev) {
			const c = previewChannels.find((item) => item.id === channelId)
			if (!c) throw new Error('Channel not found')
			const changes = [...previewMessages.values()]
				.filter((m) => m.channelId === channelId && m.rev > sinceRev)
				.sort((a, b) => a.rev - b.rev)
				.map(hydratePreviewMsg)
			return {
				changes,
				nextRev: c.lastRev,
				lastMsgSeq: c.lastMsgSeq,
				hasMore: false
			}
		},
		async sendMessage(channelId, body) {
			const c = previewChannels.find((item) => item.id === channelId)
			if (!c) throw new Error('Channel not found')
			const ts = new Date().toISOString()
			const isTop = !body.threadParentId
			const nextSeq = isTop ? c.lastMsgSeq + 1 : null
			const nextRev = c.lastRev + 1
			let threadSeq: number | null = null
			if (body.threadParentId) {
				const parent = previewMessages.get(body.threadParentId)
				if (parent) {
					const existingReplies = [...previewMessages.values()].filter(
						(m) => m.threadParentId === parent.id && m.deletedAt === null
					)
					threadSeq = existingReplies.length + 1
					previewMessages.set(parent.id, {
						...parent,
						replyCount: parent.replyCount + 1,
						lastReplyAt: ts
					})
				}
			}
			const attachments = (body.attachmentFileIds ?? [])
				.map((fid) => previewFiles.get(fid))
				.filter((f): f is FileDto => Boolean(f))
				.map((f) => ({
					fileId: f.id,
					filename: f.filename,
					contentType: f.contentType,
					byteSize: f.byteSize,
					scanStatus: f.scanStatus,
					downloadUrl: `/api/v1/files/${f.id}/download`
				}))
			const msgId = body.id ?? generateUuidV7()
			const created: ChatMessageDto = {
				id: msgId,
				workspaceId: PREVIEW_WORKSPACE_ID,
				channelId,
				channelSeq: nextSeq,
				threadSeq,
				rev: nextRev,
				authorType: 'user',
				authorId: PREVIEW_USER_ID,
				authorDisplayName: 'Hagen (Owner)',
				threadParentId: body.threadParentId ?? null,
				replyCount: 0,
				lastReplyAt: null,
				clientId: body.clientId ?? null,
				body: body.body ?? { type: 'text', text: body.bodyText },
				bodyText: body.bodyText,
				reactions: [],
				attachments,
				linkPreviews: [],
				richLinks: resolvePreviewRichLinks(body.bodyText),
				editedAt: null,
				deletedAt: null,
				createdAt: ts,
				updatedAt: ts,
				version: 1
			}
			previewMessages.set(msgId, created)
			previewChannels = previewChannels.map((item) =>
				item.id === channelId
					? {
							...item,
							lastMsgSeq: nextSeq ?? item.lastMsgSeq,
							lastRev: nextRev,
							lastReadSeq: nextSeq ?? item.lastReadSeq
						}
					: item
			)
			return created
		},
		async updateMessage(messageId, body) {
			const existing = previewMessages.get(messageId)
			if (!existing) throw new Error('Message not found')
			const c = previewChannels.find((item) => item.id === existing.channelId)
			const nextRev = (c?.lastRev ?? existing.rev) + 1
			const updated: ChatMessageDto = {
				...existing,
				bodyText: body.bodyText,
				body: body.body ?? existing.body,
				rev: nextRev,
				editedAt: new Date().toISOString(),
				version: existing.version + 1,
				richLinks: resolvePreviewRichLinks(body.bodyText)
			}
			previewMessages.set(messageId, updated)
			previewChannels = previewChannels.map((item) =>
				item.id === existing.channelId ? { ...item, lastRev: nextRev } : item
			)
			return updated
		},
		async deleteMessage(messageId) {
			const existing = previewMessages.get(messageId)
			if (!existing) throw new Error('Message not found')
			const deleted: ChatMessageDto = {
				...existing,
				bodyText: '',
				deletedAt: new Date().toISOString(),
				version: existing.version + 1
			}
			previewMessages.set(messageId, deleted)
			return deleted
		},
		async listThread(parentMessageId) {
			const parent = previewMessages.get(parentMessageId)
			if (!parent) throw new Error('Parent message not found')
			const replies = [...previewMessages.values()]
				.filter((m) => m.threadParentId === parentMessageId && m.deletedAt === null)
				.sort((a, b) => (a.threadSeq ?? 0) - (b.threadSeq ?? 0))
				.map(hydratePreviewMsg)
			return { parent: hydratePreviewMsg(parent), replies }
		},
		async addReaction(messageId, emoji) {
			const existing = previewMessages.get(messageId)
			if (!existing) throw new Error('Message not found')
			const current = existing.reactions.find((r) => r.emoji === emoji)
			const nextReactions = current
				? existing.reactions.map((r) =>
						r.emoji === emoji && !r.userIds.includes(PREVIEW_USER_ID)
							? { ...r, count: r.count + 1, reactedByMe: true, userIds: [...r.userIds, PREVIEW_USER_ID] }
							: r
					)
				: [...existing.reactions, { emoji, count: 1, reactedByMe: true, userIds: [PREVIEW_USER_ID] }]
			const updated = { ...existing, reactions: nextReactions }
			previewMessages.set(messageId, updated)
			return updated
		},
		async removeReaction(messageId, emoji) {
			const existing = previewMessages.get(messageId)
			if (!existing) throw new Error('Message not found')
			const nextReactions = existing.reactions
				.map((r) =>
					r.emoji === emoji
						? {
								...r,
								userIds: r.userIds.filter((uid) => uid !== PREVIEW_USER_ID),
								count: r.userIds.filter((uid) => uid !== PREVIEW_USER_ID).length,
								reactedByMe: false
							}
						: r
				)
				.filter((r) => r.count > 0)
			const updated = { ...existing, reactions: nextReactions }
			previewMessages.set(messageId, updated)
			return updated
		},
		async markChannelRead(channelId, seq) {
			previewChannels = previewChannels.map((c) =>
				c.id === channelId
					? {
							...c,
							lastReadSeq: Math.max(c.lastReadSeq, seq),
							unreadCount: Math.max(0, c.lastMsgSeq - Math.max(c.lastReadSeq, seq)),
							hasUnread: c.lastMsgSeq > Math.max(c.lastReadSeq, seq),
							mentionCount: 0
						}
					: c
			)
			const c = previewChannels.find((item) => item.id === channelId)
			return {
				channelId,
				lastReadSeq: c?.lastReadSeq ?? seq,
				unreadCount: c?.unreadCount ?? 0
			}
		},
		async updateChannelMute(channelId, muted) {
			previewChannels = previewChannels.map((c) => (c.id === channelId ? { ...c, muted } : c))
			return { channelId, muted }
		},
		async listThreads() {
			const parents = [...previewMessages.values()].filter((m) => m.replyCount > 0 && m.deletedAt === null)
			return parents.map((parent) => {
				const chan = previewChannels.find((c) => c.id === parent.channelId)
				const replies = [...previewMessages.values()]
					.filter((r) => r.threadParentId === parent.id && r.deletedAt === null)
					.sort((a, b) => (a.threadSeq ?? 0) - (b.threadSeq ?? 0))
				return {
					parentMessage: hydratePreviewMsg(parent),
					channelId: parent.channelId,
					channelName: chan?.name ?? null,
					channelKind: chan?.kind ?? 'public',
					lastReadThreadSeq: 0,
					unreadReplyCount: replies.length,
					latestReplies: replies.slice(-3).map(hydratePreviewMsg)
				}
			})
		},
		async uploadFile(file) {
			const ts = new Date().toISOString()
			const dto: FileDto = {
				id: generateUuidV7(),
				workspaceId: PREVIEW_WORKSPACE_ID,
				uploadedBy: PREVIEW_USER_ID,
				filename: file.name,
				contentType: file.type || 'application/octet-stream',
				declaredContentType: file.type || 'application/octet-stream',
				byteSize: file.size,
				checksum: 'preview-sha256',
				scanStatus: 'clean',
				scanDetail: 'Preview scan clean',
				reencoded: false,
				createdAt: ts,
				scannedAt: ts,
				promotedAt: ts
			}
			previewFiles.set(dto.id, dto)
			return dto
		},
		async getNotificationPreferences() {
			return previewNotifPrefs
		},
		async updateNotificationPreferences(body) {
			previewNotifPrefs = {
				...previewNotifPrefs,
				...(body.chatLevel !== undefined ? { chatLevel: body.chatLevel } : {}),
				...(body.emailDigestFrequency !== undefined
					? { emailDigestFrequency: body.emailDigestFrequency }
					: {}),
				...(body.emailInstantEnabled !== undefined ? { emailInstantEnabled: body.emailInstantEnabled } : {}),
				...(body.quietHoursStart !== undefined ? { quietHoursStart: body.quietHoursStart } : {}),
				...(body.quietHoursEnd !== undefined ? { quietHoursEnd: body.quietHoursEnd } : {}),
				...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
				...(body.webPushEnabled !== undefined ? { webPushEnabled: body.webPushEnabled } : {}),
				...(body.mobilePushEnabled !== undefined ? { mobilePushEnabled: body.mobilePushEnabled } : {}),
				updatedAt: new Date().toISOString()
			}
			return previewNotifPrefs
		},
		async getEmailStatus(): Promise<EmailPipelineStatusDto> {
			const mode = opts?.mode ?? 'selfhost'
			return {
				configured: true,
				mode,
				provider: mode === 'cloud' ? 'emailit' : 'resend',
				from: 'noreply@huriro.local',
				emailVerificationRequired: false
			}
		},
		async sendTestEmail(to): Promise<SendTestEmailResponse> {
			const mode = opts?.mode ?? 'selfhost'
			return {
				sent: true,
				provider: mode === 'cloud' ? 'emailit' : 'resend',
				messageId: `preview_msg_${generateUuidV7().slice(0, 8)}`,
				to: to?.trim() || 'hagen@huriro.local'
			}
		},
		async createInvitation(body) {
			const mode = opts?.mode ?? 'selfhost'
			return {
				id: generateUuidV7(),
				token: `preview_invite_${body.role}_${generateUuidV7().slice(0, 8)}`,
				resent: false,
				emailStatus: 'sent' as const,
				emailProvider: mode === 'cloud' ? 'emailit' : 'resend'
			}
		},
		async getVapidPublicKey() {
			return null
		},
		async listWebPushSubscriptions() {
			return previewPushSubs
		},
		async registerWebPushSubscription(body) {
			const sub: WebPushSubscriptionDto = {
				id: generateUuidV7(),
				workspaceId: PREVIEW_WORKSPACE_ID,
				userId: PREVIEW_USER_ID,
				endpoint: body.endpoint,
				userAgent: body.userAgent ?? 'preview-browser',
				lastUsedAt: null,
				revokedAt: null,
				createdAt: new Date().toISOString()
			}
			previewPushSubs = [sub, ...previewPushSubs]
			return sub
		},
		async deleteWebPushSubscription(id) {
			previewPushSubs = previewPushSubs.filter((s) => s.id !== id)
		},
		async listWebhooks() {
			return previewWebhooks
		},
		async createWebhook(body) {
			const ts = new Date().toISOString()
			const id = generateUuidV7()
			const signingSecret = `whsec_preview_${id.slice(0, 8)}`
			const endpoint: WebhookEndpointDto = {
				id,
				workspaceId: PREVIEW_WORKSPACE_ID,
				name: body.name,
				url: body.url,
				secretPrefix: signingSecret.slice(0, 12),
				events: [...body.events],
				enabled: body.enabled ?? true,
				createdBy: PREVIEW_USER_ID,
				createdAt: ts,
				updatedAt: ts,
				version: 1
			}
			previewWebhooks = [endpoint, ...previewWebhooks]
			previewDeliveries.set(id, [
				{
					id: generateUuidV7(),
					workspaceId: PREVIEW_WORKSPACE_ID,
					endpointId: id,
					eventId: generateUuidV7(),
					eventType: body.events[0] ?? 'tasks.issue.created.v1',
					payload: {},
					status: 'failed',
					attempts: 1,
					maxAttempts: 8,
					nextAttemptAt: ts,
					lastStatusCode: 500,
					lastResponseBody: 'Internal error',
					lastError: 'Receiver returned HTTP 500',
					deliveredAt: null,
					createdAt: ts,
					updatedAt: ts
				}
			])
			return { endpoint, signingSecret }
		},
		async updateWebhook(id, body) {
			const existing = previewWebhooks.find((e) => e.id === id)
			if (!existing) throw new Error('Webhook not found')
			const signingSecret = body.rotateSecret ? `whsec_rot_${generateUuidV7().slice(0, 8)}` : undefined
			const updated: WebhookEndpointDto = {
				...existing,
				...(body.name !== undefined ? { name: body.name } : {}),
				...(body.url !== undefined ? { url: body.url } : {}),
				...(body.events !== undefined ? { events: [...body.events] } : {}),
				...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
				...(signingSecret ? { secretPrefix: signingSecret.slice(0, 12) } : {}),
				version: existing.version + 1,
				updatedAt: new Date().toISOString()
			}
			previewWebhooks = previewWebhooks.map((e) => (e.id === id ? updated : e))
			return { endpoint: updated, ...(signingSecret ? { signingSecret } : {}) }
		},
		async deleteWebhook(id) {
			previewWebhooks = previewWebhooks.filter((e) => e.id !== id)
		},
		async listWebhookDeliveries(endpointId) {
			return previewDeliveries.get(endpointId) ?? []
		},
		async replayWebhookDelivery(deliveryId) {
			for (const [epId, list] of previewDeliveries.entries()) {
				const found = list.find((d) => d.id === deliveryId)
				if (found) {
					const replayed: WebhookDeliveryDto = {
						...found,
						status: 'delivered',
						attempts: found.attempts + 1,
						lastStatusCode: 200,
						lastError: null,
						deliveredAt: new Date().toISOString()
					}
					previewDeliveries.set(
						epId,
						list.map((d) => (d.id === deliveryId ? replayed : d))
					)
					return replayed
				}
			}
			throw new Error('Delivery not found')
		},
		async listGithubInstallations() {
			return previewGithubInstallations
		},
		async createGithubInstallation(body) {
			const ts = new Date().toISOString()
			const created: GithubInstallationDto = {
				id: generateUuidV7(),
				workspaceId: PREVIEW_WORKSPACE_ID,
				installationId: body.installationId,
				accountLogin: body.accountLogin,
				repoFullName: body.repoFullName,
				projectId: body.projectId,
				syncEnabled: body.syncEnabled ?? true,
				lastSyncedAt: null,
				createdAt: ts,
				updatedAt: ts,
				version: 1
			}
			previewGithubInstallations = [created, ...previewGithubInstallations]
			return created
		},
		async updateGithubInstallation(id, body) {
			const existing = previewGithubInstallations.find((i) => i.id === id)
			if (!existing) throw new Error('Installation not found')
			const updated: GithubInstallationDto = {
				...existing,
				...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
				...(body.syncEnabled !== undefined ? { syncEnabled: body.syncEnabled } : {}),
				version: existing.version + 1,
				updatedAt: new Date().toISOString()
			}
			previewGithubInstallations = previewGithubInstallations.map((i) => (i.id === id ? updated : i))
			return updated
		},
		async deleteGithubInstallation(id) {
			previewGithubInstallations = previewGithubInstallations.filter((i) => i.id !== id)
		},
		async listIssueGithubLinks(issueId) {
			return previewGithubLinks.filter((l) => l.issueId === issueId)
		},
		async createIssueGithubLink(body) {
			const ts = new Date().toISOString()
			const inst = previewGithubInstallations.find((i) => i.id === body.installationId)
			const created: IssueGithubLinkDto = {
				id: generateUuidV7(),
				workspaceId: PREVIEW_WORKSPACE_ID,
				issueId: body.issueId,
				installationId: body.installationId,
				repoFullName: inst?.repoFullName ?? 'owner/repo',
				githubIssueNumber: body.githubIssueNumber,
				githubIssueId: body.githubIssueId ?? body.githubIssueNumber,
				githubUrl:
					body.githubUrl ??
					`https://github.com/${inst?.repoFullName ?? 'owner/repo'}/issues/${body.githubIssueNumber}`,
				sourceOfTruth: body.sourceOfTruth ?? 'bidirectional',
				lastSyncedAt: ts,
				lastSyncHash: null,
				syncState: 'synced',
				lastSyncError: null,
				createdAt: ts,
				updatedAt: ts
			}
			previewGithubLinks = [created, ...previewGithubLinks]
			return created
		},
		async deleteIssueGithubLink(id) {
			previewGithubLinks = previewGithubLinks.filter((l) => l.id !== id)
		},
		async retryIssueGithubPush(linkId) {
			const existing = previewGithubLinks.find((l) => l.id === linkId)
			if (!existing) throw new Error('Link not found')
			const updated: IssueGithubLinkDto = {
				...existing,
				syncState: 'synced',
				lastSyncError: null,
				lastSyncedAt: new Date().toISOString()
			}
			previewGithubLinks = previewGithubLinks.map((l) => (l.id === linkId ? updated : l))
			return updated
		},
		// ── M3 preview stubs: agents, API keys, approvals, AI settings ────
		async listConnectedApps() {
			return previewAgents.filter((a) => a.status !== 'revoked' && a.oauthClientId !== null)
		},
		async revokeConnectedApp(agentId) {
			previewAgents = previewAgents.map((a) => (a.id === agentId ? { ...a, status: 'revoked' as const } : a))
		},
		async listAgents() {
			return previewAgents
		},
		async updateAgent(id, body) {
			const existing = previewAgents.find((a) => a.id === id)
			if (!existing) throw new Error('Agent not found')
			const updated: AgentPrincipalDto = {
				...existing,
				...(body.name !== undefined ? { name: body.name } : {}),
				...(body.status !== undefined ? { status: body.status } : {})
			}
			previewAgents = previewAgents.map((a) => (a.id === id ? updated : a))
			return updated
		},
		async revokeAgent(id) {
			previewAgents = previewAgents.map((a) => (a.id === id ? { ...a, status: 'revoked' as const } : a))
		},
		async listApiKeys() {
			return previewApiKeys
		},
		async createApiKey(body) {
			const id = generateUuidV7()
			const prefix = id.slice(0, 8)
			const created: CreatedApiKeyDto = {
				id,
				name: body.name,
				prefix,
				agentId: generateUuidV7(),
				scopes: [...body.scopes],
				status: 'active',
				expiresAt:
					body.expiresInDays !== undefined
						? new Date(Date.now() + body.expiresInDays * 86_400_000).toISOString()
						: null,
				lastUsedAt: null,
				createdAt: new Date().toISOString(),
				key: `hrk_${prefix}_preview-secret-${id.slice(-12)}`
			}
			previewApiKeys = [created, ...previewApiKeys]
			return created
		},
		async revokeApiKey(id) {
			previewApiKeys = previewApiKeys.map((k) => (k.id === id ? { ...k, status: 'revoked' as const } : k))
		},
		async listApprovals(status) {
			const data = status ? previewApprovals.filter((a) => a.status === status) : previewApprovals
			return { data, nextCursor: null, hasMore: false }
		},
		async decideApproval(id, body) {
			const existing = previewApprovals.find((a) => a.id === id)
			if (!existing) throw new Error('Approval not found')
			const updated: AgentApprovalDto = {
				...existing,
				status: body.decision === 'approve' ? 'approved' : 'denied',
				decidedBy: PREVIEW_USER_ID,
				decidedAt: new Date().toISOString(),
				decisionReason: body.reason ?? null
			}
			previewApprovals = previewApprovals.map((a) => (a.id === id ? updated : a))
			return updated
		},
		async getAiSettings() {
			return { aiEnabled: previewAiEnabled, aiTracePrompts: false, providers: previewAiProviders }
		},
		async updateAiSettings(body) {
			if (body.aiEnabled !== undefined) previewAiEnabled = body.aiEnabled
			return { aiEnabled: previewAiEnabled, aiTracePrompts: false, providers: previewAiProviders }
		},
		async upsertAiProvider(body) {
			const provider: AiProviderDto = {
				id: generateUuidV7(),
				kind: body.kind,
				name: body.name,
				baseUrl: body.baseUrl,
				hasApiKey: body.apiKey !== undefined && body.apiKey !== null,
				chatModel: body.chatModel ?? null,
				embeddingModel: body.embeddingModel ?? null,
				isDefault: previewAiProviders.length === 0,
				createdAt: new Date().toISOString()
			}
			previewAiProviders = [...previewAiProviders.filter((p) => p.name !== provider.name), provider]
			return provider
		},
		// M5: shared inbox mail — small in-memory seed so preview mode renders a real inbox
		async listMailAccounts() {
			return previewMailAccounts
		},
		async createMailAccount(body) {
			const account: MailAccountDto = {
				id: generateUuidV7(),
				workspaceId: PREVIEW_WORKSPACE_ID,
				provider: body.provider,
				address: body.address,
				displayName: body.displayName ?? null,
				defaultInboxId: body.defaultInboxId ?? null,
				status: 'pending_verification',
				statusDetail: null,
				lastSyncedAt: null,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				version: 1,
				inboundUrl: null
			}
			previewMailAccounts = [...previewMailAccounts, account]
			return account
		},
		async updateMailAccount(id, body) {
			const existing = previewMailAccounts.find((a) => a.id === id)
			if (!existing) throw new Error('mail account not found')
			const updated = { ...existing, ...body, updatedAt: new Date().toISOString() }
			previewMailAccounts = previewMailAccounts.map((a) => (a.id === id ? updated : a))
			return updated
		},
		async verifyMailAccountDomain() {
			return { verified: false, missingRecords: ['MX huriro.in'] }
		},
		async syncMailAccount() {},
		async listMailIdentities() {
			return previewMailIdentities
		},
		async createMailIdentity(body) {
			const identity: MailIdentityDto = {
				id: generateUuidV7(),
				accountId: body.accountId,
				address: body.address,
				displayName: body.displayName ?? null,
				isDefault: body.isDefault ?? false,
				createdAt: new Date().toISOString()
			}
			previewMailIdentities = [...previewMailIdentities, identity]
			return identity
		},
		async listMailInboxes() {
			return previewMailInboxes
		},
		async createMailInbox(body) {
			const inbox: MailInboxDto = {
				id: generateUuidV7(),
				workspaceId: PREVIEW_WORKSPACE_ID,
				name: body.name,
				position: 'a9',
				settings: {},
				openCount: 0,
				createdAt: new Date().toISOString()
			}
			previewMailInboxes = [...previewMailInboxes, inbox]
			return inbox
		},
		async listMailConversations(filter) {
			const assigneeTarget =
				filter.assignee === 'me' ? PREVIEW_USER_ID : filter.assignee === 'unassigned' ? null : filter.assignee
			const data = previewMailConversations.filter(
				(c) =>
					(!filter.inboxId || c.inboxId === filter.inboxId) &&
					(!filter.status || c.status === filter.status) &&
					(assigneeTarget === undefined || c.assigneeId === assigneeTarget) &&
					(!filter.q ||
						c.subject.toLowerCase().includes(filter.q.toLowerCase()) ||
						(c.customerEmail ?? '').toLowerCase().includes(filter.q.toLowerCase()))
			)
			return { data, nextCursor: null }
		},
		async getMailTimeline(id) {
			const conv = previewMailConversations.find((c) => c.id === id)
			if (!conv) throw new Error('conversation not found')
			return {
				conversation: conv,
				messages: previewMailMessages.filter((m) => m.conversationId === id),
				events: previewMailEvents.filter((e) => e.conversationId === id),
				notes: previewMailNotes.filter((n) => n.conversationId === id),
				drafts: previewMailDrafts.filter((d) => d.conversationId === id && d.status === 'draft'),
				linkedTasks: [],
				linkedDocs: []
			}
		},
		async updateMailConversation(id, body) {
			const existing = previewMailConversations.find((c) => c.id === id)
			if (!existing) throw new Error('conversation not found')
			const updated: MailConversationDto = {
				...existing,
				...(body.status !== undefined ? { status: body.status } : {}),
				...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
				...(body.snoozedUntil !== undefined ? { snoozedUntil: body.snoozedUntil } : {}),
				updatedAt: new Date().toISOString(),
				version: existing.version + 1
			}
			previewMailConversations = previewMailConversations.map((c) => (c.id === id ? updated : c))
			return updated
		},
		async createMailNote(conversationId, body) {
			const note: MailNoteDto = {
				id: generateUuidV7(),
				conversationId,
				authorId: PREVIEW_USER_ID,
				authorName: 'Hagen (Owner)',
				body: { type: 'doc', content: [] },
				bodyText: body.bodyText,
				mentions: [],
				createdAt: new Date().toISOString()
			}
			previewMailNotes = [...previewMailNotes, note]
			return note
		},
		async linkMailConversation() {},
		async unlinkMailTask() {},
		async unlinkMailDoc() {},
		async convertMailToIssue() {
			return { issueId: generateUuidV7(), identifier: 'HR-42' }
		},
		async upsertMailDraft(conversationId, body) {
			const draft: MailDraftDto = {
				id: generateUuidV7(),
				conversationId,
				identityId: body.identityId,
				createdBy: PREVIEW_USER_ID,
				body: { type: 'doc', content: [] },
				bodyText: body.bodyText ?? '',
				recipients: body.recipients ?? {},
				inReplyToId: body.inReplyToId ?? null,
				scheduledSendAt: null,
				status: 'draft',
				lockedBy: null,
				lockedUntil: null,
				version: 1,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString()
			}
			previewMailDrafts = [
				...previewMailDrafts.filter(
					(d) =>
						!(d.conversationId === conversationId && d.createdBy === PREVIEW_USER_ID && d.status === 'draft')
				),
				draft
			]
			return draft
		},
		async updateMailDraft(draftId, body) {
			const existing = previewMailDrafts.find((d) => d.id === draftId)
			if (!existing) throw new Error('draft not found')
			const updated = {
				...existing,
				bodyText: body.bodyText ?? existing.bodyText,
				recipients: body.recipients ?? existing.recipients,
				version: existing.version + 1,
				updatedAt: new Date().toISOString()
			}
			previewMailDrafts = previewMailDrafts.map((d) => (d.id === draftId ? updated : d))
			return updated
		},
		async sendMailDraft(draftId) {
			const existing = previewMailDrafts.find((d) => d.id === draftId)
			if (!existing) throw new Error('draft not found')
			const sent: MailDraftDto = {
				...existing,
				status: 'sent',
				updatedAt: new Date().toISOString()
			}
			previewMailDrafts = previewMailDrafts.map((d) => (d.id === draftId ? sent : d))
			return sent
		},
		async undoMailDraft(draftId) {
			const existing = previewMailDrafts.find((d) => d.id === draftId)
			if (!existing) throw new Error('draft not found')
			const undone: MailDraftDto = {
				...existing,
				status: 'draft',
				updatedAt: new Date().toISOString()
			}
			previewMailDrafts = previewMailDrafts.map((d) => (d.id === draftId ? undone : d))
			return undone
		},
		async discardMailDraft(draftId) {
			previewMailDrafts = previewMailDrafts.filter((d) => d.id !== draftId)
		},
		async getBillingSubscription() {
			return {
				subscription: {
					id: '0190a0b1-0000-7000-8000-000000000b01',
					workspaceId: PREVIEW_WORKSPACE_ID,
					plan: 'free',
					status: 'active',
					provider: 'manual',
					providerCustomerId: null,
					providerSubscriptionId: null,
					billingEmail: null,
					billingPhone: null,
					currency: 'USD',
					amountCharged: 0,
					paymentMethod: null,
					seatLimit: 5,
					storageLimitBytes: 1_073_741_824,
					currentPeriodStart: now,
					currentPeriodEnd: null,
					cancelAtPeriodEnd: false,
					createdAt: now,
					updatedAt: now,
					version: 1
				},
				usage: {
					activeSeats: 2,
					storageBytes: 12_582_912,
					aiTokensUsed: 4200
				},
				quote: {
					plan: 'pro',
					usdCents: 1000,
					usdAmount: 10,
					rwfAmount: 14000,
					exchangeRateUsdToRwf: 1400,
					exchangeRateSource: 'fallback',
					exchangeRateFetchedAt: now
				},
				webOnlyCheckout: true,
				providers: { polar: true, irembopay: true }
			}
		},
		async createBillingCheckout(body) {
			if (body.provider === 'irembopay') {
				const channel = body.paymentMethod ?? 'mtn_momo'
				return {
					provider: 'irembopay',
					sessionId: 'preview-irembo-inv-001',
					url: 'https://payments.irembopay.rw/checkout/preview-irembo-inv-001',
					currency: 'RWF',
					amount: 14000,
					exchangeRateUsdToRwf: 1400,
					paymentMethod: channel,
					invoiceNumber: 'INV-PREVIEW-001',
					mobileMoneyPromptSent: channel !== 'irembopay_hosted',
					instructions:
						channel === 'irembopay_hosted'
							? 'Complete 14,000 RWF payment on IremboPay hosted checkout.'
							: 'Dial *182*7*1# or approve the Mobile Money prompt on your phone (14,000 RWF).'
				}
			}
			return {
				provider: 'polar',
				sessionId: 'preview-polar-chk-001',
				url: 'https://polar.sh/checkout/preview-polar-chk-001',
				currency: 'USD',
				amount: 10,
				exchangeRateUsdToRwf: null,
				paymentMethod: 'card',
				invoiceNumber: null,
				mobileMoneyPromptSent: false,
				instructions: null
			}
		},
		async createBillingPortal(body) {
			return { url: body.returnUrl }
		},
		async listWorkspaceExports() {
			return previewWorkspaceExports
		},
		async createWorkspaceExport() {
			const created = {
				id: generateUuidV7(),
				workspaceId: PREVIEW_WORKSPACE_ID,
				requestedBy: PREVIEW_USER_ID,
				status: 'completed' as const,
				byteSize: 2048,
				manifest: { format: 'huriro-json-v1', counts: { issues: 4, docs: 3 } },
				expiresAt: null,
				errorDetail: null,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString()
			}
			previewWorkspaceExports = [created, ...previewWorkspaceExports]
			return created
		},
		getWorkspaceExportDownloadUrl(exportId) {
			return `#preview-export-${encodeURIComponent(exportId)}`
		},
		async eraseMyAccount(_body) {
			return {
				erased: true,
				userId: PREVIEW_USER_ID,
				revokedWorkspaceIds: [PREVIEW_WORKSPACE_ID]
			}
		}
	}
}

export async function createPreviewWorkspace(
	storage: ReplicaStorage = new MemoryReplicaStorage(),
	opts?: { readonly mode?: 'selfhost' | 'cloud' }
): Promise<BootstrappedWorkspace> {
	const seed = createPreviewSeedSnapshot()
	await storage.set('huriro:replica:v1', JSON.stringify(seed))
	const engine = new HuriroSyncEngine({
		workspaceId: PREVIEW_WORKSPACE_ID,
		currentUserId: PREVIEW_USER_ID,
		storage
	})
	await engine.bootstrap({ skipNetwork: true })
	return {
		engine,
		api: createPreviewApiBridge(engine, opts),
		workspaceName: 'Huriro Preview',
		currentUserId: PREVIEW_USER_ID,
		userDisplayName: 'Hagen (Owner)',
		isPreview: true,
		mode: opts?.mode ?? 'selfhost'
	}
}
