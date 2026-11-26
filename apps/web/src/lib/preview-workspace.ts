/**
 * Offline-first preview replica & local API bridge (§9.5).
 * Lazy-loaded via dynamic `import('./preview-workspace')` so TipTap/Yjs/editor
 * stay out of the initial web shell bundle budget (<= 200 KB gzip).
 */
import type {
	AgentApprovalDto,
	AgentPrincipalDto,
	AiMailAssistResponse,
	AiProviderDto,
	AvailabilityWindowDto,
	ChatChannelBookmarkDto,
	ChatChannelDto,
	ChatChannelMemberDto,
	ChatDraftDto,
	ChatHuddleSessionDto,
	ChatMessageDto,
	ChatPinnedMessageDto,
	ChatPollDto,
	ChatSavedItemDto,
	ChatScheduledMessageDto,
	ChatSidebarSectionDto,
	ContactDto,
	ContactOrganizationDto,
	CreateAvailabilityWindowBody,
	CycleDailySnapshotDto,
	CycleDto,
	DocCommentDto,
	DocPageDetailDto,
	DocPageDto,
	DocPublicShareDto,
	DocSuggestionDto,
	DocSyncedBlockDto,
	DocVerificationDto,
	DocVersionDto,
	EmailPipelineStatusDto,
	EntityLinkDto,
	FileDto,
	GithubInstallationDto,
	ImportDocDatabaseRowsResultDto,
	InitiativeDto,
	IssueCommentDto,
	IssueDto,
	IssueGithubLinkDto,
	IssueRelationDto,
	KnowledgeGraphResponse,
	MailAccountDto,
	MailConversationDto,
	MailConversationEventDto,
	MailDraftDto,
	MailIdentityDto,
	MailInboxDto,
	MailMacroDto,
	MailMessageDto,
	MailNoteDto,
	MailRoutingConfigDto,
	MailSlaPolicyDto,
	MailTagDto,
	MailTemplateDto,
	NotificationDto,
	NotificationPreferencesDto,
	ProjectDto,
	ProjectMilestoneDto,
	ProjectStatusDto,
	ProjectUpdateDto,
	SearchHitDto,
	SendTestEmailResponse,
	TeamspaceDto,
	TeamspaceMemberDto,
	UpdateAvailabilityWindowBody,
	UserAvailabilityDto,
	UserGroupDto,
	UserWorkspaceProfileDto,
	WebhookDeliveryDto,
	WebhookEndpointDto,
	WebPushSubscriptionDto,
	WorkspaceEmojiDto,
	WorkspaceExportDto
} from '@huriro/contracts'
import { computeDmKey, extractRichLinks, parseSearchQuery } from '@huriro/domain'
import {
	applyAllSuggestionsDecisionToYDoc,
	applySuggestionDecisionToYDoc,
	diffVersionText,
	extractDocumentContent,
	extractSuggestionsFromYDoc,
	markdownToProseMirrorJson,
	proposeSuggestionOnYDoc,
	proseMirrorJsonToSafeHtml,
	prosemirrorJsonToYDoc,
	renderStandaloneHtmlDocument,
	ydocToMarkdown,
	ydocToProseMirrorJson
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
			triageEnabled: false,
			cycleEnabled: false,
			cycleDurationDays: 14,
			cycleCooldownDays: 0,
			cycleAutoRolloverMode: 'next_cycle',
			cycleStartWeekday: 1,
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
			triageEnabled: false,
			cycleEnabled: false,
			cycleDurationDays: 14,
			cycleCooldownDays: 0,
			cycleAutoRolloverMode: 'next_cycle',
			cycleStartWeekday: 1,
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
			milestoneId: null,
			title: 'Enforce contiguous cursor allocation on write commit',
			description: null,
			descriptionText: 'Allocate change_log cursors after domain and audit writes finish.',
			statusId: statusProgressId,
			priority: 4,
			assigneeType: 'user' as const,
			assigneeId: PREVIEW_USER_ID,
			creatorId: PREVIEW_USER_ID,
			position: 'F',
			startDate: '2026-11-20',
			dueDate: '2026-11-23',
			estimate: 3,
			triageStatus: 'none' as const,
			triageSnoozedUntil: null,
			triageDeclinedReason: null,
			sourceKind: 'manual' as const,
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
			milestoneId: null,
			title: 'Wire fractional index rebalancing at 64-character depth',
			description: null,
			descriptionText: 'Preserve sorted order cleanly across concurrent board moves.',
			statusId: statusTodoId,
			priority: 3,
			assigneeType: 'user' as const,
			assigneeId: PREVIEW_USER_ID,
			creatorId: PREVIEW_USER_ID,
			position: 'V',
			startDate: '2026-11-24',
			dueDate: '2026-11-27',
			estimate: 2,
			triageStatus: 'none' as const,
			triageSnoozedUntil: null,
			triageDeclinedReason: null,
			sourceKind: 'manual' as const,
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
			milestoneId: null,
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
			triageStatus: 'none' as const,
			triageSnoozedUntil: null,
			triageDeclinedReason: null,
			sourceKind: 'manual' as const,
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
			milestoneId: null,
			title: 'Audit FORCE ROW LEVEL SECURITY across M1 tables',
			description: null,
			descriptionText: 'Verify private project ACL isolation and cross-tenant deny paths.',
			statusId: secTodoId,
			priority: 4,
			assigneeType: 'user' as const,
			assigneeId: PREVIEW_USER_ID,
			creatorId: PREVIEW_USER_ID,
			position: 'F',
			startDate: '2026-11-22',
			dueDate: '2026-11-25',
			estimate: 3,
			triageStatus: 'none' as const,
			triageSnoozedUntil: null,
			triageDeclinedReason: null,
			sourceKind: 'manual' as const,
			closedAt: null,
			labelIds: [],
			createdAt: now,
			updatedAt: now,
			deletedAt: null,
			version: 1
		}
	]

	const initiatives: InitiativeDto[] = [
		{
			id: '0190a0b1-0000-7000-8000-000000000701',
			workspaceId: PREVIEW_WORKSPACE_ID,
			name: 'Offline-first launch',
			description: null,
			descriptionText: 'Ship the local-first workspace foundation.',
			health: 'on_track',
			ownerId: PREVIEW_USER_ID,
			targetDate: '2026-12-04',
			position: 'F',
			projectIds: [PREVIEW_PROJECT_ENG_ID],
			createdAt: now,
			updatedAt: now,
			version: 1
		}
	]

	const projectMilestones: ProjectMilestoneDto[] = [
		{
			id: '0190a0b1-0000-7000-8000-000000000702',
			workspaceId: PREVIEW_WORKSPACE_ID,
			projectId: PREVIEW_PROJECT_ENG_ID,
			name: 'Sync preview complete',
			description: 'Timeline and offline mutation demo checkpoint',
			targetDate: '2026-11-26',
			status: 'planned',
			position: 'F',
			createdAt: now,
			updatedAt: now,
			version: 1
		}
	]

	const issueRelations: IssueRelationDto[] = [
		{
			id: '0190a0b1-0000-7000-8000-000000000703',
			workspaceId: PREVIEW_WORKSPACE_ID,
			sourceIssueId: issues[0]?.id ?? '',
			targetIssueId: issues[1]?.id ?? '',
			kind: 'blocks',
			createdBy: PREVIEW_USER_ID,
			createdAt: now
		}
	]

	const projectUpdates: ProjectUpdateDto[] = [
		{
			id: '0190a0b1-0000-7000-8000-000000000704',
			workspaceId: PREVIEW_WORKSPACE_ID,
			projectId: PREVIEW_PROJECT_ENG_ID,
			health: 'on_track',
			body: null,
			bodyText: 'Offline replication is green in preview.',
			completedIssues: 1,
			totalIssues: 3,
			scopeChange: 0,
			createdBy: PREVIEW_USER_ID,
			createdAt: now,
			updatedAt: now,
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

	const PREVIEW_TEAMSPACE_ENG_ID = '0190a0b1-0000-7000-8000-000000000680'
	const teamspaces: TeamspaceDto[] = [
		{
			id: PREVIEW_TEAMSPACE_ENG_ID,
			workspaceId: PREVIEW_WORKSPACE_ID,
			name: 'Engineering',
			slug: 'engineering',
			icon: '⚙️',
			description: 'Core architecture, specs, and operational runbooks.',
			visibility: 'open',
			defaultAcl: [{ principalType: 'workspace', principalId: null, permission: 'write' }],
			position: 'F',
			archivedAt: null,
			createdBy: PREVIEW_USER_ID,
			createdAt: now,
			updatedAt: now,
			version: 1
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
			teamspaceId: PREVIEW_TEAMSPACE_ENG_ID,
			path: docRootId,
			depth: 0,
			slug: 'engineering-handbook',
			title: 'Engineering Handbook',
			icon: '📘',
			coverGradient: 'ocean',
			coverPositionY: 50,
			fontStyle: 'sans',
			fullWidth: false,
			smallText: false,
			isLocked: false,
			verificationStatus: 'verified',
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
			teamspaceId: PREVIEW_TEAMSPACE_ENG_ID,
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
			teamspaceId: null,
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

	const userAvailability: UserAvailabilityDto[] = [
		{
			id: PREVIEW_USER_ID,
			userId: PREVIEW_USER_ID,
			displayName: 'Hagen (Owner)',
			handle: null,
			avatarUrl: null,
			manualState: 'auto',
			manualStateExpiresAt: null,
			effectiveState: 'available',
			statusEmoji: '💻',
			statusText: 'Shipping Chat v2',
			statusExpiresAt: null,
			dndUntil: null,
			workingHours: {
				enabled: false,
				timezone: 'UTC',
				days: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }
			},
			timezone: 'UTC',
			suppressNotificationsOffHours: false,
			allowUrgentOverride: true,
			withinWorkingHours: true,
			isRoutable: true,
			isAcceptingNotifications: true,
			nextAvailableAt: null,
			localTimeLabel: '12:15',
			delegateUserId: null,
			lastSeenAt: now,
			version: 1,
			windows: [],
			updatedAt: now
		},
		{
			id: '0190a0b1-0000-7000-8000-000000000003',
			userId: '0190a0b1-0000-7000-8000-000000000003',
			displayName: 'Ada Lovelace',
			handle: null,
			avatarUrl: null,
			manualState: 'busy',
			manualStateExpiresAt: null,
			effectiveState: 'busy',
			statusEmoji: '📐',
			statusText: 'Reviewing the RFC',
			statusExpiresAt: null,
			dndUntil: null,
			workingHours: {
				enabled: false,
				timezone: 'UTC',
				days: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }
			},
			timezone: 'UTC',
			suppressNotificationsOffHours: false,
			allowUrgentOverride: true,
			withinWorkingHours: true,
			isRoutable: true,
			isAcceptingNotifications: true,
			nextAvailableAt: null,
			localTimeLabel: '12:15',
			delegateUserId: null,
			lastSeenAt: now,
			version: 1,
			windows: [],
			updatedAt: now
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
		issueRelations,
		initiatives,
		projectMilestones,
		projectUpdates,
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
		docPages,
		teamspaces,
		userAvailability
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
	const previewEntityLinks: EntityLinkDto[] = []
	const previewCycleSnapshots: CycleDailySnapshotDto[] = []
	const previewPeekIssues: {
		id: string
		title: string
		identifier: string
		statusCategory: string
		updatedAt: string
	}[] = []
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
	const previewTeamspaceMembers = new Map<string, TeamspaceMemberDto[]>()
	const previewSyncedBlocks = new Map<string, DocSyncedBlockDto & { state: Uint8Array }>()
	const previewSuggestionsByPage = new Map<string, DocSuggestionDto[]>()
	const previewVerificationsByPage = new Map<string, DocVerificationDto>()
	const previewPublicSharesByPage = new Map<string, DocPublicShareDto>()

	// Seed preview teamspace membership, synced block, verification, and public share for M9.
	const seedNow = '2026-11-22T12:00:00Z'
	const seedSyncedId = '0190a0b1-0000-7000-8000-000000000690'
	const seedSyncedState = buildPreviewYDocState(
		'> Shared rollout checklist across engineering runbooks.',
		'synced-seed'
	)
	previewSyncedBlocks.set(seedSyncedId, {
		id: seedSyncedId,
		workspaceId: PREVIEW_WORKSPACE_ID,
		title: 'Rollout Checklist',
		sourcePageId: '0190a0b1-0000-7000-8000-000000000601',
		stateBase64: bytesToBase64(seedSyncedState.state),
		stateVectorBase64: bytesToBase64(seedSyncedState.stateVector),
		byteSize: seedSyncedState.state.byteLength,
		plainText: seedSyncedState.extracted.plainText,
		createdBy: PREVIEW_USER_ID,
		archivedAt: null,
		createdAt: seedNow,
		updatedAt: seedNow,
		version: 1,
		state: seedSyncedState.state
	})
	previewTeamspaceMembers.set('0190a0b1-0000-7000-8000-000000000680', [
		{
			workspaceId: PREVIEW_WORKSPACE_ID,
			teamspaceId: '0190a0b1-0000-7000-8000-000000000680',
			userId: PREVIEW_USER_ID,
			role: 'owner',
			createdAt: seedNow
		}
	])
	previewVerificationsByPage.set('0190a0b1-0000-7000-8000-000000000601', {
		id: '0190a0b1-0000-7000-8000-000000000695',
		workspaceId: PREVIEW_WORKSPACE_ID,
		pageId: '0190a0b1-0000-7000-8000-000000000601',
		status: 'verified',
		verifiedBy: PREVIEW_USER_ID,
		verifiedAt: seedNow,
		expiresAt: '2027-02-20T12:00:00Z',
		note: 'Verified architecture overview',
		createdAt: seedNow,
		updatedAt: seedNow,
		version: 1
	})

	function buildPreviewM9Extras(pageId: string) {
		return {
			canVerify: true,
			canPublish: true,
			verification: previewVerificationsByPage.get(pageId) ?? null,
			publicShare: previewPublicSharesByPage.get(pageId) ?? null,
			suggestions: previewSuggestionsByPage.get(pageId) ?? []
		}
	}

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
			lastMsgSeq: 2,
			lastRev: 2,
			createdBy: PREVIEW_USER_ID,
			archivedAt: null,
			createdAt: previewNow,
			updatedAt: previewNow,
			version: 1,
			unreadCount: 0,
			hasUnread: false,
			mentionCount: 0,
			muted: false,
			notifyLevel: 'default',
			mutedUntil: null,
			canvasPageId: null,
			lastReadSeq: 2,
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
	const previewPollMsgId = '0190a0b1-0000-7000-8000-000000000904'
	const previewPollId = '0190a0b1-0000-7000-8000-000000000905'
	const previewChannelPins = new Map<string, ChatPinnedMessageDto[]>()
	const previewChatDrafts = new Map<string, ChatDraftDto>()
	let previewScheduledMessages: ChatScheduledMessageDto[] = []
	let previewSavedItems: ChatSavedItemDto[] = [
		{
			id: '0190a0b1-0000-7000-8000-000000000910',
			messageId: previewMsg1Id,
			customText: '',
			note: 'Follow up after weekly sync',
			status: 'saved',
			remindAt: null,
			completedAt: null,
			version: 1,
			createdAt: previewNow,
			updatedAt: previewNow,
			channelId: PREVIEW_CHAN_GENERAL_ID,
			messageText: 'Welcome to Huriro M4! Review doc:engineering-handbook and issue:ENG-1.'
		}
	]
	let previewSidebarSections: ChatSidebarSectionDto[] = [
		{
			id: '0190a0b1-0000-7000-8000-000000000920',
			name: 'Starred',
			position: 'F',
			collapsed: false,
			unreadOnly: false,
			version: 1,
			createdAt: previewNow,
			updatedAt: previewNow,
			items: [{ channelId: PREVIEW_CHAN_GENERAL_ID, position: 'F' }]
		}
	]
	const previewHandbookPage = engine.collections.docPages.toArray.find(
		(p) => p.slug === 'engineering-handbook'
	)
	const previewBookmarksByChannel = new Map<string, ChatChannelBookmarkDto[]>([
		[
			PREVIEW_CHAN_GENERAL_ID,
			[
				...(previewHandbookPage
					? [
							{
								id: '0190a0b1-0000-7000-8000-000000000930',
								targetType: 'doc_page' as const,
								targetId: previewHandbookPage.id,
								title: 'Engineering Handbook',
								url: 'engineering-handbook',
								icon: '📘',
								folder: null,
								position: 'F',
								createdBy: PREVIEW_USER_ID,
								version: 1,
								createdAt: previewNow,
								updatedAt: previewNow
							}
						]
					: []),
				{
					id: '0190a0b1-0000-7000-8000-000000000931',
					targetType: 'external_url',
					targetId: null,
					title: 'Release Checklist',
					url: 'https://huriro.dev/docs/release-checklist',
					icon: null,
					folder: null,
					position: 'V',
					createdBy: PREVIEW_USER_ID,
					version: 1,
					createdAt: previewNow,
					updatedAt: previewNow
				}
			]
		]
	])
	let previewMyChatStatus: UserWorkspaceProfileDto = {
		statusEmoji: '💻',
		statusText: 'Shipping Chat v2',
		statusExpiresAt: null,
		dndUntil: null,
		workingHours: {},
		lastSeenAt: previewNow,
		updatedAt: previewNow
	}
	let previewAvailabilityWindows: AvailabilityWindowDto[] = []
	let previewUserGroups: UserGroupDto[] = [
		{
			id: '0190a0b1-0000-7000-8000-000000000940',
			handle: 'engineering',
			name: 'Engineering',
			description: 'Core platform engineers',
			autoJoinChannelIds: [PREVIEW_CHAN_ENG_ID],
			memberIds: [PREVIEW_USER_ID, PREVIEW_USER_ADA_ID],
			version: 1,
			createdAt: previewNow,
			updatedAt: previewNow
		}
	]
	let previewWorkspaceEmojis: WorkspaceEmojiDto[] = [
		{
			id: '0190a0b1-0000-7000-8000-000000000950',
			shortcode: 'huriro',
			fileId: '0190a0b1-0000-7000-8000-000000000951',
			createdBy: PREVIEW_USER_ID,
			createdAt: previewNow,
			filename: 'huriro.png',
			contentType: 'image/png'
		}
	]
	const previewPolls = new Map<string, ChatPollDto>([
		[
			previewPollId,
			{
				id: previewPollId,
				channelId: PREVIEW_CHAN_GENERAL_ID,
				messageId: previewPollMsgId,
				question: 'Which Sprint M11 polish item next?',
				options: [
					{ id: 'opt-1', label: 'Keyboard shortcuts' },
					{ id: 'opt-2', label: 'Channel Canvas' }
				],
				multiChoice: false,
				anonymous: false,
				status: 'open',
				closesAt: null,
				createdBy: PREVIEW_USER_ID,
				version: 1,
				createdAt: previewNow,
				totalVotes: 1,
				counts: { 'opt-1': 1 },
				voters: [{ userId: PREVIEW_USER_ADA_ID, optionIds: ['opt-1'] }]
			}
		]
	])
	const previewHuddlesByChannel = new Map<string, ChatHuddleSessionDto | null>()
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
				broadcastToChannel: false,
				replyToMessageId: null,
				messageKind: 'text',
				metadata: {},
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
			previewPollMsgId,
			{
				id: previewPollMsgId,
				workspaceId: PREVIEW_WORKSPACE_ID,
				channelId: PREVIEW_CHAN_GENERAL_ID,
				channelSeq: 2,
				threadSeq: null,
				rev: 2,
				authorType: 'user',
				authorId: PREVIEW_USER_ID,
				authorDisplayName: 'Hagen (Owner)',
				threadParentId: null,
				broadcastToChannel: false,
				replyToMessageId: null,
				messageKind: 'poll',
				metadata: { pollId: previewPollId, pollQuestion: 'Which Sprint M11 polish item next?' },
				replyCount: 0,
				lastReplyAt: null,
				clientId: null,
				body: { type: 'text', text: 'Which Sprint M11 polish item next?' },
				bodyText: 'Which Sprint M11 polish item next?',
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
				broadcastToChannel: false,
				replyToMessageId: null,
				messageKind: 'text',
				metadata: {},
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
				broadcastToChannel: false,
				replyToMessageId: null,
				messageKind: 'text',
				metadata: {},
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
		alertKeywords: [],
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
			visibility: 'shared',
			ownerUserId: null,
			openCount: 1,
			version: 1,
			createdAt: '2026-11-22T09:00:00Z'
		}
	]
	const PREVIEW_MAIL_CONV_2_ID = '0190a0b1-0000-7000-8000-000000000a02'
	const PREVIEW_MAIL_TAG_BILLING_ID = '0190a0b1-0000-7000-8000-000000000a31'
	const PREVIEW_MAIL_TAG_VIP_ID = '0190a0b1-0000-7000-8000-000000000a32'
	const PREVIEW_MAIL_ORG_ID = '0190a0b1-0000-7000-8000-000000000a41'
	const PREVIEW_MAIL_CONTACT_ID = '0190a0b1-0000-7000-8000-000000000a42'
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
			contactId: PREVIEW_MAIL_CONTACT_ID,
			followUpAt: null,
			followUpCondition: null,
			slaNextDueAt: null,
			slaBreachedAt: null,
			priority: 'normal',
			snippet: 'When I click Export in settings nothing happens…',
			messageCount: 2,
			createdAt: '2026-11-22T10:00:00Z',
			updatedAt: '2026-11-22T11:30:00Z',
			version: 1
		},
		{
			id: PREVIEW_MAIL_CONV_2_ID,
			workspaceId: PREVIEW_WORKSPACE_ID,
			inboxId: PREVIEW_MAIL_INBOX_ID,
			accountId: PREVIEW_MAIL_ACCOUNT_ID,
			subject: 'Annual seat renewal question',
			status: 'closed',
			assigneeId: PREVIEW_USER_ID,
			assigneeName: 'Hagen (Owner)',
			snoozedUntil: null,
			mergedIntoId: null,
			lastMessageAt: '2026-11-20T09:00:00Z',
			firstReplyAt: '2026-11-20T09:20:00Z',
			customerEmail: 'customer@acme.example',
			contactId: PREVIEW_MAIL_CONTACT_ID,
			followUpAt: null,
			followUpCondition: null,
			slaNextDueAt: null,
			slaBreachedAt: null,
			priority: 'normal',
			snippet: 'Can we add 15 seats ahead of Q1 onboarding?',
			messageCount: 1,
			createdAt: '2026-11-20T08:45:00Z',
			updatedAt: '2026-11-20T09:20:00Z',
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
		},
		{
			id: '0190a0b1-0000-7000-8000-000000000a13',
			conversationId: PREVIEW_MAIL_CONV_2_ID,
			direction: 'inbound',
			rfcMessageId: '<m2@acme.example>',
			fromAddr: { email: 'customer@acme.example', name: 'Acme Customer' },
			toAddrs: [{ email: 'support@preview.huriro.dev', name: null }],
			ccAddrs: [],
			subject: 'Annual seat renewal question',
			snippet: 'Can we add 15 seats ahead of Q1 onboarding?',
			sentAt: '2026-11-20T08:45:00Z',
			receivedAt: '2026-11-20T08:45:00Z',
			bodyHtml: null,
			bodyText: 'Hi team, can we add 15 seats ahead of our Q1 onboarding wave?',
			attachments: [],
			authResults: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
			sendState: null,
			createdBy: null,
			createdAt: '2026-11-20T08:45:00Z'
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
	const firstSeededIssue = engine.collections.issues.toArray[0]
	const firstSeededDoc = engine.collections.docPages.toArray[0]
	const previewMailLinkedTasks = new Map<
		string,
		{ readonly taskId: string; readonly identifier: string | null; readonly title: string | null }[]
	>(
		firstSeededIssue
			? [
					[
						PREVIEW_MAIL_CONV_ID,
						[
							{
								taskId: firstSeededIssue.id,
								identifier: firstSeededIssue.identifier,
								title: firstSeededIssue.title
							}
						]
					]
				]
			: []
	)
	const previewMailLinkedDocs = new Map<
		string,
		{ readonly pageId: string; readonly slug: string | null; readonly title: string | null }[]
	>(
		firstSeededDoc
			? [
					[
						PREVIEW_MAIL_CONV_ID,
						[
							{
								pageId: firstSeededDoc.id,
								slug: firstSeededDoc.slug,
								title: firstSeededDoc.title
							}
						]
					]
				]
			: []
	)
	let previewMailTags: MailTagDto[] = [
		{
			id: PREVIEW_MAIL_TAG_BILLING_ID,
			inboxId: PREVIEW_MAIL_INBOX_ID,
			name: 'billing',
			color: 'blue',
			version: 1,
			createdAt: '2026-11-22T09:00:00Z'
		},
		{
			id: PREVIEW_MAIL_TAG_VIP_ID,
			inboxId: null,
			name: 'vip',
			color: 'amber',
			version: 1,
			createdAt: '2026-11-22T09:00:00Z'
		}
	]
	const previewConversationTags = new Map<string, string[]>([
		[PREVIEW_MAIL_CONV_ID, [PREVIEW_MAIL_TAG_BILLING_ID]],
		[PREVIEW_MAIL_CONV_2_ID, [PREVIEW_MAIL_TAG_VIP_ID]]
	])
	let previewMailTemplates: MailTemplateDto[] = [
		{
			id: '0190a0b1-0000-7000-8000-000000000a51',
			inboxId: PREVIEW_MAIL_INBOX_ID,
			ownerUserId: null,
			name: 'Export fix confirmation',
			shortcut: ';export',
			bodyText: 'Hi {{customer}}, we shipped a fix for workspace exports — please retry now.',
			body: {},
			bodyHtml: null,
			attachmentFileIds: [],
			mergeVariables: ['customer'],
			version: 1,
			createdAt: '2026-11-22T09:00:00Z',
			updatedAt: '2026-11-22T09:00:00Z'
		},
		{
			id: '0190a0b1-0000-7000-8000-000000000a52',
			inboxId: null,
			ownerUserId: null,
			name: 'Refund policy notice',
			shortcut: ';refund',
			bodyText: 'Thanks for reaching out — your refund has been queued and takes 3-5 business days.',
			body: {},
			bodyHtml: null,
			attachmentFileIds: [],
			mergeVariables: [],
			version: 1,
			createdAt: '2026-11-22T09:00:00Z',
			updatedAt: '2026-11-22T09:00:00Z'
		}
	]
	let previewMailMacros: MailMacroDto[] = [
		{
			id: '0190a0b1-0000-7000-8000-000000000a61',
			inboxId: PREVIEW_MAIL_INBOX_ID,
			name: 'Resolve & tag billing',
			shortcut: 'close-billing',
			steps: [
				{ action: 'set_status', value: 'closed' },
				{ action: 'add_tag', value: PREVIEW_MAIL_TAG_BILLING_ID }
			],
			version: 1,
			createdAt: '2026-11-22T09:00:00Z',
			updatedAt: '2026-11-22T09:00:00Z'
		},
		{
			id: '0190a0b1-0000-7000-8000-000000000a62',
			inboxId: null,
			name: 'Escalate pending',
			shortcut: 'escalate',
			steps: [{ action: 'set_status', value: 'pending' }],
			version: 1,
			createdAt: '2026-11-22T09:00:00Z',
			updatedAt: '2026-11-22T09:00:00Z'
		}
	]
	let previewContactOrgs: ContactOrganizationDto[] = [
		{
			id: PREVIEW_MAIL_ORG_ID,
			name: 'Acme Corp',
			domain: 'acme.example',
			tier: 'vip',
			notes: 'Enterprise annual plan customer',
			metadata: {},
			version: 1,
			createdAt: '2026-11-20T09:00:00Z',
			updatedAt: '2026-11-22T09:00:00Z'
		}
	]
	let previewContacts: ContactDto[] = [
		{
			id: PREVIEW_MAIL_CONTACT_ID,
			email: 'customer@acme.example',
			displayName: 'Acme Customer',
			title: 'Operations Lead',
			phone: '+1-555-0140',
			vipTier: 'vip',
			notes: 'Prefers concise technical updates.',
			metadata: {},
			organizationId: PREVIEW_MAIL_ORG_ID,
			organizationName: 'Acme Corp',
			version: 1,
			createdAt: '2026-11-20T09:00:00Z',
			updatedAt: '2026-11-22T09:00:00Z'
		}
	]
	const previewMailRoutingByInbox = new Map<string, MailRoutingConfigDto>([
		[
			PREVIEW_MAIL_INBOX_ID,
			{
				enabled: true,
				maxOpenCap: 5,
				requireOnline: false,
				respectDnd: true,
				respectWorkingHours: false,
				respectOoo: true,
				useOooDelegate: true
			}
		]
	])
	let previewMailSlaPolicies: MailSlaPolicyDto[] = [
		{
			id: '0190a0b1-0000-7000-8000-000000000a71',
			inboxId: PREVIEW_MAIL_INBOX_ID,
			tagId: null,
			name: 'First reply in 1h',
			firstReplyMinutes: 60,
			nextReplyMinutes: 120,
			resolutionMinutes: 480,
			businessHours: {},
			active: true,
			version: 1,
			createdAt: '2026-11-22T09:00:00Z',
			updatedAt: '2026-11-22T09:00:00Z'
		}
	]
	let previewRoutingIndex = 0

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
							broadcastToChannel: false,
							replyToMessageId: null,
							messageKind: 'text',
							metadata: {},
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
				canShare: true,
				...buildPreviewM9Extras(page.id)
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
				canShare: true,
				...buildPreviewM9Extras(page.id)
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
		async appendDocPage(pageId, body) {
			const page = engine.collections.docPages.get(pageId)
			if (!page) throw new Error('Document not found')
			const st = ensurePreviewDocState(page)
			const currentDoc = new Y.Doc()
			Y.applyUpdate(currentDoc, st.state)
			const currentJson = ydocToProseMirrorJson(currentDoc)
			const existing = Array.isArray(currentJson['content'])
				? (currentJson['content'] as Record<string, unknown>[])
				: []
			const appended = body.nodes
				? [...body.nodes]
				: body.markdown
					? ((markdownToProseMirrorJson(body.markdown, `preview-append:${pageId}`)['content'] as unknown as
							| Record<string, unknown>[]
							| undefined) ?? [])
					: []
			if (appended.length === 0) throw new Error('Append requires content')
			const nextDoc = prosemirrorJsonToYDoc({ type: 'doc', content: [...existing, ...appended] })
			const state = Y.encodeStateAsUpdate(nextDoc)
			const extracted = extractDocumentContent(nextDoc)
			docStatesByPage.set(pageId, {
				state,
				stateVector: Y.encodeStateVector(nextDoc),
				plainText: extracted.plainText,
				headings: extracted.headings
			})
			return {
				page,
				stateBase64: bytesToBase64(state),
				stateVectorBase64: bytesToBase64(Y.encodeStateVector(nextDoc)),
				byteSize: state.byteLength,
				plainText: extracted.plainText,
				headings: extracted.headings,
				comments: docCommentsByPage.get(page.id) ?? [],
				canWrite: true,
				canShare: true,
				...buildPreviewM9Extras(page.id)
			}
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
					canShare: true,
					...buildPreviewM9Extras(pageId)
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
				.filter(
					(m) =>
						m.channelId === channelId &&
						m.deletedAt === null &&
						(m.threadParentId === null || m.broadcastToChannel === true)
				)
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
			const broadcastToChannel = Boolean(!isTop && body.broadcastToChannel)
			const nextSeq = isTop || broadcastToChannel ? c.lastMsgSeq + 1 : null
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
				broadcastToChannel,
				replyToMessageId: body.replyToMessageId ?? null,
				messageKind: 'text',
				metadata: body.replyToMessageId ? { quoteOf: body.replyToMessageId } : {},
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
		async updateChannelMute(channelId, muted, opts) {
			const notifyLevel = opts?.notifyLevel ?? (muted ? 'none' : 'default')
			const mutedUntil = opts?.mutedUntil ?? null
			previewChannels = previewChannels.map((c) =>
				c.id === channelId ? { ...c, muted, notifyLevel, mutedUntil } : c
			)
			return { channelId, muted, notifyLevel, mutedUntil }
		},
		async listPinnedMessages(channelId) {
			return previewChannelPins.get(channelId) ?? []
		},
		async pinMessage(messageId) {
			const msg = previewMessages.get(messageId)
			if (!msg) return {}
			const existing = previewChannelPins.get(msg.channelId) ?? []
			if (existing.some((p) => p.messageId === messageId)) return existing[0] ?? {}
			const pin: ChatPinnedMessageDto = {
				messageId: msg.id,
				pinnedBy: PREVIEW_USER_ID,
				position: existing.length + 1,
				createdAt: new Date().toISOString(),
				bodyText: msg.bodyText,
				authorId: msg.authorId ?? PREVIEW_USER_ID,
				messageCreatedAt: msg.createdAt
			}
			previewChannelPins.set(msg.channelId, [pin, ...existing])
			return pin
		},
		async unpinMessage(messageId) {
			const msg = previewMessages.get(messageId)
			if (msg) {
				previewChannelPins.set(
					msg.channelId,
					(previewChannelPins.get(msg.channelId) ?? []).filter((p) => p.messageId !== messageId)
				)
			} else {
				for (const [chId, list] of previewChannelPins.entries()) {
					previewChannelPins.set(
						chId,
						list.filter((p) => p.messageId !== messageId)
					)
				}
			}
			return { unpinned: true }
		},
		async listChatDrafts() {
			return [...previewChatDrafts.values()]
		},
		async upsertChatDraft(channelId, body) {
			const key = `${channelId}:${body.threadParentId ?? 'root'}`
			const empty = body.bodyText.trim().length === 0 && (body.attachmentFileIds ?? []).length === 0
			if (empty) {
				previewChatDrafts.delete(key)
				return { deleted: true, channelId, threadParentId: body.threadParentId ?? null }
			}
			const existing = previewChatDrafts.get(key)
			const ts = new Date().toISOString()
			const draft: ChatDraftDto = {
				id: existing?.id ?? generateUuidV7(),
				channelId,
				threadParentId: body.threadParentId ?? null,
				body: body.body ?? {},
				bodyText: body.bodyText,
				attachmentFileIds: [...(body.attachmentFileIds ?? [])],
				createdAt: existing?.createdAt ?? ts,
				updatedAt: ts
			}
			previewChatDrafts.set(key, draft)
			return draft
		},
		async deleteChatDraft(draftId) {
			for (const [k, d] of previewChatDrafts.entries()) {
				if (d.id === draftId) previewChatDrafts.delete(k)
			}
		},
		async listScheduledChatMessages() {
			return previewScheduledMessages
		},
		async scheduleChatMessage(channelId, body) {
			const ts = new Date().toISOString()
			const item: ChatScheduledMessageDto = {
				id: generateUuidV7(),
				channelId,
				threadParentId: body.threadParentId ?? null,
				bodyText: body.bodyText,
				attachmentFileIds: [...(body.attachmentFileIds ?? [])],
				scheduledFor: body.scheduledFor,
				status: 'scheduled',
				sentMessageId: null,
				errorDetail: null,
				version: 1,
				createdAt: ts,
				updatedAt: ts
			}
			previewScheduledMessages = [...previewScheduledMessages, item]
			return item
		},
		async cancelScheduledChatMessage(id, version) {
			previewScheduledMessages = previewScheduledMessages.map((item) =>
				item.id === id ? { ...item, status: 'cancelled', version: version + 1 } : item
			)
			return { id, status: 'cancelled', version: version + 1 }
		},
		async listSavedChatItems() {
			return previewSavedItems
		},
		async createSavedChatItem(body) {
			const msg = body.messageId ? previewMessages.get(body.messageId) : undefined
			const ts = new Date().toISOString()
			const existing = body.messageId
				? previewSavedItems.find((item) => item.messageId === body.messageId)
				: undefined
			if (existing) {
				const updated: ChatSavedItemDto = {
					...existing,
					note: body.note ?? existing.note,
					remindAt: body.remindAt ?? existing.remindAt,
					updatedAt: ts
				}
				previewSavedItems = previewSavedItems.map((i) => (i.id === existing.id ? updated : i))
				return updated
			}
			const created: ChatSavedItemDto = {
				id: generateUuidV7(),
				messageId: body.messageId ?? null,
				customText: body.customText ?? '',
				note: body.note ?? '',
				status: 'saved',
				remindAt: body.remindAt ?? null,
				completedAt: null,
				version: 1,
				createdAt: ts,
				updatedAt: ts,
				channelId: msg?.channelId ?? null,
				messageText: msg?.bodyText ?? null
			}
			previewSavedItems = [created, ...previewSavedItems]
			return created
		},
		async updateSavedChatItem(id, body) {
			const ts = new Date().toISOString()
			let result: ChatSavedItemDto | null = null
			previewSavedItems = previewSavedItems.map((item) => {
				if (item.id !== id) return item
				result = {
					...item,
					status: body.status ?? item.status,
					note: body.note ?? item.note,
					remindAt: body.remindAt === undefined ? item.remindAt : body.remindAt,
					completedAt: body.status === 'completed' ? ts : item.completedAt,
					version: item.version + 1,
					updatedAt: ts
				}
				return result
			})
			if (!result) throw new Error('Saved item not found')
			return result
		},
		async deleteSavedChatItem(id) {
			previewSavedItems = previewSavedItems.filter((item) => item.id !== id)
		},
		async listChatSidebarSections() {
			return previewSidebarSections
		},
		async createChatSidebarSection(body) {
			const ts = new Date().toISOString()
			const section: ChatSidebarSectionDto = {
				id: generateUuidV7(),
				name: body.name,
				position: body.position ?? 'Z',
				collapsed: body.collapsed ?? false,
				unreadOnly: body.unreadOnly ?? false,
				version: 1,
				createdAt: ts,
				updatedAt: ts,
				items: []
			}
			previewSidebarSections = [...previewSidebarSections, section]
			return section
		},
		async updateChatSidebarSection(id, body) {
			let updated: ChatSidebarSectionDto | null = null
			previewSidebarSections = previewSidebarSections.map((sec) => {
				if (sec.id !== id) return sec
				updated = {
					...sec,
					name: body.name ?? sec.name,
					position: body.position ?? sec.position,
					collapsed: body.collapsed ?? sec.collapsed,
					unreadOnly: body.unreadOnly ?? sec.unreadOnly,
					version: sec.version + 1
				}
				return updated
			})
			if (!updated) throw new Error('Sidebar section not found')
			return updated
		},
		async deleteChatSidebarSection(id) {
			previewSidebarSections = previewSidebarSections.filter((s) => s.id !== id)
		},
		async addChatSidebarSectionItem(sectionId, body) {
			const item = { channelId: body.channelId, position: body.position ?? 'F' }
			previewSidebarSections = previewSidebarSections.map((sec) => {
				if (sec.id !== sectionId) return sec
				const rest = (sec.items ?? []).filter((i) => i.channelId !== body.channelId)
				return { ...sec, items: [...rest, item] }
			})
			return item
		},
		async removeChatSidebarSectionItem(sectionId, channelId) {
			previewSidebarSections = previewSidebarSections.map((sec) =>
				sec.id === sectionId
					? { ...sec, items: (sec.items ?? []).filter((i) => i.channelId !== channelId) }
					: sec
			)
		},
		async listChannelBookmarks(channelId) {
			return previewBookmarksByChannel.get(channelId) ?? []
		},
		async createChannelBookmark(channelId, body) {
			const ts = new Date().toISOString()
			const created: ChatChannelBookmarkDto = {
				id: generateUuidV7(),
				targetType: body.targetType,
				targetId: body.targetId ?? null,
				title: body.title,
				url: body.url ?? null,
				icon: body.icon ?? null,
				folder: body.folder ?? null,
				position: body.position ?? 'Z',
				createdBy: PREVIEW_USER_ID,
				version: 1,
				createdAt: ts,
				updatedAt: ts
			}
			previewBookmarksByChannel.set(channelId, [...(previewBookmarksByChannel.get(channelId) ?? []), created])
			return created
		},
		async deleteChannelBookmark(id) {
			for (const [chId, list] of previewBookmarksByChannel.entries()) {
				previewBookmarksByChannel.set(
					chId,
					list.filter((b) => b.id !== id)
				)
			}
		},
		async getMyChatStatus() {
			return previewMyChatStatus
		},
		async updateMyChatStatus(body) {
			previewMyChatStatus = {
				...previewMyChatStatus,
				statusEmoji: body.statusEmoji !== undefined ? body.statusEmoji : previewMyChatStatus.statusEmoji,
				statusText: body.statusText !== undefined ? body.statusText : previewMyChatStatus.statusText,
				statusExpiresAt:
					body.statusExpiresAt !== undefined ? body.statusExpiresAt : previewMyChatStatus.statusExpiresAt,
				dndUntil: body.dndUntil !== undefined ? body.dndUntil : previewMyChatStatus.dndUntil,
				updatedAt: new Date().toISOString()
			}
			return previewMyChatStatus
		},
		async listAvailabilityWindows() {
			return previewAvailabilityWindows
		},
		async createAvailabilityWindow(body: CreateAvailabilityWindowBody) {
			const now = new Date().toISOString()
			const row: AvailabilityWindowDto = {
				id: crypto.randomUUID(),
				userId: PREVIEW_USER_ID,
				kind: body.kind ?? 'ooo',
				title: body.title ?? '',
				message: body.message ?? '',
				startsAt: body.startsAt,
				endsAt: body.endsAt,
				delegateUserId: body.delegateUserId ?? null,
				autoDeclineRouting: body.autoDeclineRouting ?? true,
				suppressNotifications: body.suppressNotifications ?? true,
				version: 1,
				createdAt: now,
				updatedAt: now
			}
			previewAvailabilityWindows = [...previewAvailabilityWindows, row]
			return row
		},
		async updateAvailabilityWindow(id: string, body: UpdateAvailabilityWindowBody) {
			const current = previewAvailabilityWindows.find((window) => window.id === id)
			if (!current) throw new Error('Availability window not found')
			const next: AvailabilityWindowDto = {
				...current,
				...(body.kind !== undefined ? { kind: body.kind } : {}),
				...(body.title !== undefined ? { title: body.title } : {}),
				...(body.message !== undefined ? { message: body.message } : {}),
				...(body.startsAt !== undefined ? { startsAt: body.startsAt } : {}),
				...(body.endsAt !== undefined ? { endsAt: body.endsAt } : {}),
				...(body.delegateUserId !== undefined ? { delegateUserId: body.delegateUserId } : {}),
				...(body.autoDeclineRouting !== undefined ? { autoDeclineRouting: body.autoDeclineRouting } : {}),
				...(body.suppressNotifications !== undefined
					? { suppressNotifications: body.suppressNotifications }
					: {}),
				version: current.version + 1,
				updatedAt: new Date().toISOString()
			}
			previewAvailabilityWindows = previewAvailabilityWindows.map((window) =>
				window.id === id ? next : window
			)
			return next
		},
		async deleteAvailabilityWindow(id: string) {
			previewAvailabilityWindows = previewAvailabilityWindows.filter((window) => window.id !== id)
			return { deleted: true as const }
		},
		async listUserGroups() {
			return previewUserGroups
		},
		async createUserGroup(body) {
			const ts = new Date().toISOString()
			const group: UserGroupDto = {
				id: generateUuidV7(),
				handle: body.handle,
				name: body.name,
				description: body.description ?? '',
				autoJoinChannelIds: [...(body.autoJoinChannelIds ?? [])],
				memberIds: [...(body.memberIds ?? [])],
				version: 1,
				createdAt: ts,
				updatedAt: ts
			}
			previewUserGroups = [...previewUserGroups, group]
			return group
		},
		async setUserGroupMembers(groupId, memberIds) {
			previewUserGroups = previewUserGroups.map((g) =>
				g.id === groupId ? { ...g, memberIds: [...memberIds], version: g.version + 1 } : g
			)
			return { memberIds }
		},
		async listWorkspaceEmojis() {
			return previewWorkspaceEmojis
		},
		async createWorkspaceEmoji(body) {
			const ts = new Date().toISOString()
			const emoji: WorkspaceEmojiDto = {
				id: generateUuidV7(),
				shortcode: body.shortcode,
				fileId: body.fileId,
				createdBy: PREVIEW_USER_ID,
				createdAt: ts,
				filename: `${body.shortcode}.png`,
				contentType: 'image/png'
			}
			previewWorkspaceEmojis = [...previewWorkspaceEmojis, emoji]
			return emoji
		},
		async deleteWorkspaceEmoji(id) {
			previewWorkspaceEmojis = previewWorkspaceEmojis.filter((e) => e.id !== id)
		},
		async listChannelPolls(channelId) {
			return [...previewPolls.values()].filter((p) => p.channelId === channelId)
		},
		async createChatPoll(channelId, body) {
			const pollId = generateUuidV7()
			const c = previewChannels.find((item) => item.id === channelId)
			if (!c) throw new Error('Channel not found')
			const ts = new Date().toISOString()
			const msgId = generateUuidV7()
			const nextSeq = c.lastMsgSeq + 1
			const nextRev = c.lastRev + 1
			const pollMsg: ChatMessageDto = {
				id: msgId,
				workspaceId: PREVIEW_WORKSPACE_ID,
				channelId,
				channelSeq: nextSeq,
				threadSeq: null,
				rev: nextRev,
				authorType: 'user',
				authorId: PREVIEW_USER_ID,
				authorDisplayName: 'Hagen (Owner)',
				threadParentId: body.threadParentId ?? null,
				broadcastToChannel: Boolean(body.threadParentId && body.broadcastToChannel),
				replyToMessageId: null,
				messageKind: 'poll',
				metadata: { pollId, pollQuestion: body.question, options: body.options },
				replyCount: 0,
				lastReplyAt: null,
				clientId: null,
				body: { type: 'text', text: body.question },
				bodyText: body.question,
				reactions: [],
				attachments: [],
				linkPreviews: [],
				richLinks: [],
				editedAt: null,
				deletedAt: null,
				createdAt: ts,
				updatedAt: ts,
				version: 1
			}
			previewMessages.set(msgId, pollMsg)
			previewChannels = previewChannels.map((item) =>
				item.id === channelId
					? { ...item, lastMsgSeq: nextSeq, lastRev: nextRev, lastReadSeq: nextSeq }
					: item
			)
			const poll: ChatPollDto = {
				id: pollId,
				channelId,
				messageId: msgId,
				question: body.question,
				options: body.options.map((o) => ({ id: o.id, label: o.label })),
				multiChoice: body.multiChoice ?? false,
				anonymous: body.anonymous ?? false,
				status: 'open',
				closesAt: body.closesAt ?? null,
				createdBy: PREVIEW_USER_ID,
				version: 1,
				createdAt: ts,
				totalVotes: 0,
				counts: {},
				voters: [],
				message: pollMsg
			}
			previewPolls.set(pollId, poll)
			return poll
		},
		async getChatPoll(pollId) {
			const poll = previewPolls.get(pollId)
			if (!poll) throw new Error('Poll not found')
			return poll
		},
		async voteChatPoll(pollId, body) {
			const poll = previewPolls.get(pollId)
			if (!poll) throw new Error('Poll not found')
			const others = (poll.voters ?? []).filter((v) => v.userId !== PREVIEW_USER_ID)
			const nextVoters = [...others, { userId: PREVIEW_USER_ID, optionIds: [...body.optionIds] }]
			const counts: Record<string, number> = {}
			for (const v of nextVoters) {
				for (const oid of v.optionIds) counts[oid] = (counts[oid] ?? 0) + 1
			}
			previewPolls.set(pollId, {
				...poll,
				totalVotes: nextVoters.length,
				counts,
				voters: poll.anonymous ? [] : nextVoters
			})
			return { pollId, userId: PREVIEW_USER_ID, optionIds: body.optionIds }
		},
		async closeChatPoll(pollId) {
			const poll = previewPolls.get(pollId)
			if (!poll) throw new Error('Poll not found')
			const updated = { ...poll, status: 'closed' as const, version: poll.version + 1 }
			previewPolls.set(pollId, updated)
			return { id: pollId, status: 'closed', version: updated.version }
		},
		async forwardChatMessage(messageId, body) {
			const source = previewMessages.get(messageId)
			const target = previewChannels.find((c) => c.id === body.targetChannelId)
			if (!source || !target) throw new Error('Message or channel not found')
			const ts = new Date().toISOString()
			const prefix = body.bodyText?.trim() ? `${body.bodyText.trim()}\n\n` : ''
			const msgId = generateUuidV7()
			const nextSeq = target.lastMsgSeq + 1
			const nextRev = target.lastRev + 1
			const created: ChatMessageDto = {
				id: msgId,
				workspaceId: PREVIEW_WORKSPACE_ID,
				channelId: target.id,
				channelSeq: nextSeq,
				threadSeq: null,
				rev: nextRev,
				authorType: 'user',
				authorId: PREVIEW_USER_ID,
				authorDisplayName: 'Hagen (Owner)',
				threadParentId: null,
				broadcastToChannel: false,
				replyToMessageId: null,
				messageKind: 'text',
				metadata: {
					forwardedFrom: { messageId: source.id, channelId: source.channelId, snapshot: true }
				},
				replyCount: 0,
				lastReplyAt: null,
				clientId: null,
				body: { type: 'text', text: `${prefix}${source.bodyText}` },
				bodyText: `${prefix}${source.bodyText}`,
				reactions: [],
				attachments: [],
				linkPreviews: [],
				richLinks: resolvePreviewRichLinks(source.bodyText),
				editedAt: null,
				deletedAt: null,
				createdAt: ts,
				updatedAt: ts,
				version: 1
			}
			previewMessages.set(msgId, created)
			previewChannels = previewChannels.map((c) =>
				c.id === target.id ? { ...c, lastMsgSeq: nextSeq, lastRev: nextRev } : c
			)
			return created
		},
		async ensureChannelCanvas(channelId) {
			const c = previewChannels.find((item) => item.id === channelId)
			if (!c) throw new Error('Channel not found')
			if (c.canvasPageId) {
				const existing = engine.collections.docPages.get(c.canvasPageId)
				if (existing) return { pageId: existing.id, slug: existing.slug, title: existing.title }
			}
			const label = c.name ? `#${c.name}` : 'Channel'
			const created = await engine.createDocPage({
				title: `${label} Canvas`,
				visibility: 'workspace'
			})
			const built = buildPreviewYDocState(
				`# ${label} Canvas\n\nShared channel notes, decisions, and runbooks.`,
				created.id
			)
			docStatesByPage.set(created.id, {
				state: built.state,
				stateVector: built.stateVector,
				plainText: built.extracted.plainText,
				headings: built.extracted.headings
			})
			previewChannels = previewChannels.map((item) =>
				item.id === channelId ? { ...item, canvasPageId: created.id } : item
			)
			return { pageId: created.id, slug: created.slug, title: created.title }
		},
		async getActiveChannelHuddle(channelId) {
			return previewHuddlesByChannel.get(channelId) ?? null
		},
		async startChatHuddle(channelId) {
			const ts = new Date().toISOString()
			const huddle: ChatHuddleSessionDto = {
				id: generateUuidV7(),
				channelId,
				roomName: `huriro_preview_${channelId.slice(0, 8)}`,
				status: 'active',
				startedAt: ts
			}
			previewHuddlesByChannel.set(channelId, huddle)
			return huddle
		},
		async joinChatHuddle(huddleId) {
			return {
				huddleId,
				roomName: 'huriro_preview',
				livekitUrl: 'wss://livekit.preview.local',
				token: 'preview-token',
				expiresIn: 900
			}
		},
		async endChatHuddle(huddleId) {
			for (const [chId, h] of previewHuddlesByChannel.entries()) {
				if (h?.id === huddleId) previewHuddlesByChannel.set(chId, null)
			}
			return { id: huddleId, status: 'ended' }
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
			const visibility = body.visibility ?? 'shared'
			const inbox: MailInboxDto = {
				id: generateUuidV7(),
				workspaceId: PREVIEW_WORKSPACE_ID,
				name: body.name,
				position: 'a9',
				settings: body.settings ?? {},
				visibility,
				ownerUserId: visibility === 'private' ? (body.ownerUserId ?? PREVIEW_USER_ID) : null,
				openCount: 0,
				version: 1,
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
					(!filter.status ? c.status !== 'snoozed' : c.status === filter.status) &&
					(assigneeTarget === undefined || c.assigneeId === assigneeTarget) &&
					(!filter.tagId || (previewConversationTags.get(c.id) ?? []).includes(filter.tagId)) &&
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
				drafts: previewMailDrafts.filter(
					(d) => d.conversationId === id && (d.status === 'draft' || d.status === 'sending')
				),
				linkedTasks: previewMailLinkedTasks.get(id) ?? [],
				linkedDocs: previewMailLinkedDocs.get(id) ?? []
			}
		},
		async updateMailConversation(id, body) {
			const existing = previewMailConversations.find((c) => c.id === id)
			if (!existing) throw new Error('conversation not found')
			const updated: MailConversationDto = {
				...existing,
				...(body.status !== undefined ? { status: body.status } : {}),
				...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
				...(body.snoozedUntil !== undefined
					? { snoozedUntil: body.snoozedUntil, ...(body.snoozedUntil ? { status: 'snoozed' as const } : {}) }
					: {}),
				...(body.priority !== undefined ? { priority: body.priority } : {}),
				...(body.followUpAt !== undefined ? { followUpAt: body.followUpAt } : {}),
				...(body.followUpCondition !== undefined ? { followUpCondition: body.followUpCondition } : {}),
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
		async linkMailConversation(id, body) {
			if (body.taskId) {
				const issue = engine.collections.issues.get(body.taskId)
				const current = previewMailLinkedTasks.get(id) ?? []
				if (!current.some((item) => item.taskId === body.taskId)) {
					previewMailLinkedTasks.set(id, [
						...current,
						{
							taskId: body.taskId,
							identifier: issue?.identifier ?? 'HR-1',
							title: issue?.title ?? 'Linked task'
						}
					])
				}
			}
			if (body.pageId) {
				const doc = engine.collections.docPages.get(body.pageId)
				const current = previewMailLinkedDocs.get(id) ?? []
				if (!current.some((item) => item.pageId === body.pageId)) {
					previewMailLinkedDocs.set(id, [
						...current,
						{
							pageId: body.pageId,
							slug: doc?.slug ?? null,
							title: doc?.title ?? 'Linked doc'
						}
					])
				}
			}
		},
		async unlinkMailTask(id, taskId) {
			previewMailLinkedTasks.set(
				id,
				(previewMailLinkedTasks.get(id) ?? []).filter((item) => item.taskId !== taskId)
			)
		},
		async unlinkMailDoc(id, pageId) {
			previewMailLinkedDocs.set(
				id,
				(previewMailLinkedDocs.get(id) ?? []).filter((item) => item.pageId !== pageId)
			)
		},
		async convertMailToIssue(id, body) {
			const issueId = generateUuidV7()
			const conv = previewMailConversations.find((c) => c.id === id)
			const current = previewMailLinkedTasks.get(id) ?? []
			const title = body.title ?? conv?.subject ?? 'Mail follow-up task'
			previewMailLinkedTasks.set(id, [...current, { taskId: issueId, identifier: 'HR-42', title }])
			return { issueId, identifier: 'HR-42' }
		},
		async upsertMailDraft(conversationId, body) {
			const draft: MailDraftDto = {
				id: generateUuidV7(),
				conversationId,
				identityId: body.identityId,
				createdBy: PREVIEW_USER_ID,
				body: body.body ?? { type: 'doc', content: [] },
				bodyText: body.bodyText ?? '',
				recipients: body.recipients ?? {},
				inReplyToId: body.inReplyToId ?? null,
				scheduledSendAt: body.scheduledSendAt ?? null,
				status: 'draft',
				lockedBy: null,
				lockedUntil: null,
				collabEnabled: body.collabEnabled ?? false,
				reviewStatus: 'none',
				reviewerId: null,
				reviewedAt: null,
				reviewNote: null,
				metadata: body.attachmentFileIds ? { attachmentFileIds: body.attachmentFileIds } : {},
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
			const existingMeta =
				existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
					? (existing.metadata as Record<string, unknown>)
					: {}
			const updated: MailDraftDto = {
				...existing,
				bodyText: body.bodyText ?? existing.bodyText,
				recipients: body.recipients ?? existing.recipients,
				collabEnabled: body.collabEnabled ?? existing.collabEnabled,
				scheduledSendAt: body.scheduledSendAt !== undefined ? body.scheduledSendAt : existing.scheduledSendAt,
				metadata:
					body.attachmentFileIds !== undefined
						? { ...existingMeta, attachmentFileIds: body.attachmentFileIds }
						: existingMeta,
				version: existing.version + 1,
				updatedAt: new Date().toISOString()
			}
			previewMailDrafts = previewMailDrafts.map((d) => (d.id === draftId ? updated : d))
			return updated
		},
		async issueMailDraftCollabTicket(draftId) {
			return {
				ticket: `preview-mail-draft-${draftId}`,
				documentName: `mail_draft:${PREVIEW_WORKSPACE_ID}:${draftId}`,
				permission: 'write',
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
				collabUrl: '/collab'
			}
		},
		async sendMailDraft(draftId, body) {
			const existing = previewMailDrafts.find((d) => d.id === draftId)
			if (!existing) throw new Error('draft not found')
			if (existing.reviewStatus === 'requested') {
				throw new Error('Draft requires review approval before sending')
			}
			const isScheduledFuture =
				typeof body?.scheduledSendAt === 'string' && Date.parse(body.scheduledSendAt) > Date.now()
			const sent: MailDraftDto = {
				...existing,
				status: isScheduledFuture ? 'sending' : 'sent',
				scheduledSendAt: isScheduledFuture
					? (body.scheduledSendAt ?? null)
					: new Date(Date.now() + 10_000).toISOString(),
				version: existing.version + 1,
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
				scheduledSendAt: null,
				version: existing.version + 1,
				updatedAt: new Date().toISOString()
			}
			previewMailDrafts = previewMailDrafts.map((d) => (d.id === draftId ? undone : d))
			return undone
		},
		async discardMailDraft(draftId) {
			previewMailDrafts = previewMailDrafts.filter((d) => d.id !== draftId)
		},
		async listMailTags(inboxId) {
			if (!inboxId) return previewMailTags
			return previewMailTags.filter((tag) => tag.inboxId === null || tag.inboxId === inboxId)
		},
		async createMailTag(body) {
			const created: MailTagDto = {
				id: generateUuidV7(),
				inboxId: body.inboxId ?? null,
				name: body.name.trim(),
				color: body.color ?? 'neutral',
				version: 1,
				createdAt: new Date().toISOString()
			}
			previewMailTags = [...previewMailTags, created]
			return created
		},
		async deleteMailTag(id) {
			previewMailTags = previewMailTags.filter((tag) => tag.id !== id)
			for (const [convId, list] of previewConversationTags.entries()) {
				previewConversationTags.set(
					convId,
					list.filter((tId) => tId !== id)
				)
			}
		},
		async listConversationTags(conversationId) {
			const ids = new Set(previewConversationTags.get(conversationId) ?? [])
			return previewMailTags.filter((tag) => ids.has(tag.id))
		},
		async setConversationTags(conversationId, body) {
			const tagIds = [...new Set(body.tagIds)]
			previewConversationTags.set(conversationId, tagIds)
			previewMailConversations = previewMailConversations.map((conv) =>
				conv.id === conversationId ? { ...conv, tagIds } : conv
			)
			return { tagIds }
		},
		async listMailTemplates(filter) {
			return previewMailTemplates.filter(
				(tpl) =>
					(!filter?.inboxId || tpl.inboxId === null || tpl.inboxId === filter.inboxId) &&
					(filter?.personal === undefined ||
						(filter.personal ? tpl.ownerUserId === PREVIEW_USER_ID : tpl.ownerUserId === null))
			)
		},
		async upsertMailTemplate(body, id) {
			const now = new Date().toISOString()
			if (id) {
				const updated = previewMailTemplates.find((t) => t.id === id)
				if (!updated) throw new Error('template not found')
				const next: MailTemplateDto = {
					...updated,
					inboxId: body.inboxId ?? null,
					ownerUserId: body.ownerUserId ?? null,
					name: body.name,
					shortcut: body.shortcut,
					bodyText: body.bodyText,
					body: body.body ?? {},
					bodyHtml: body.bodyHtml ?? null,
					attachmentFileIds: body.attachmentFileIds ?? [],
					mergeVariables: body.mergeVariables ?? [],
					version: updated.version + 1,
					updatedAt: now
				}
				previewMailTemplates = previewMailTemplates.map((t) => (t.id === id ? next : t))
				return next
			}
			const created: MailTemplateDto = {
				id: generateUuidV7(),
				inboxId: body.inboxId ?? null,
				ownerUserId: body.ownerUserId ?? null,
				name: body.name,
				shortcut: body.shortcut,
				bodyText: body.bodyText,
				body: body.body ?? {},
				bodyHtml: body.bodyHtml ?? null,
				attachmentFileIds: body.attachmentFileIds ?? [],
				mergeVariables: body.mergeVariables ?? [],
				version: 1,
				createdAt: now,
				updatedAt: now
			}
			previewMailTemplates = [...previewMailTemplates, created]
			return created
		},
		async deleteMailTemplate(id) {
			previewMailTemplates = previewMailTemplates.filter((t) => t.id !== id)
		},
		async renderMailTemplate(id, body) {
			const tpl = previewMailTemplates.find((t) => t.id === id)
			if (!tpl) throw new Error('template not found')
			let bodyText = tpl.bodyText
			for (const [key, value] of Object.entries(body.variables ?? {})) {
				bodyText = bodyText.replaceAll(`{{${key}}}`, value)
			}
			return { bodyText, shortcut: tpl.shortcut }
		},
		async listMailMacros(inboxId) {
			if (!inboxId) return previewMailMacros
			return previewMailMacros.filter((m) => m.inboxId === null || m.inboxId === inboxId)
		},
		async upsertMailMacro(body, id) {
			const now = new Date().toISOString()
			if (id) {
				const existing = previewMailMacros.find((m) => m.id === id)
				if (!existing) throw new Error('macro not found')
				const next: MailMacroDto = {
					...existing,
					inboxId: body.inboxId ?? null,
					name: body.name,
					shortcut: body.shortcut ?? null,
					steps: [...body.steps],
					version: existing.version + 1,
					updatedAt: now
				}
				previewMailMacros = previewMailMacros.map((m) => (m.id === id ? next : m))
				return next
			}
			const created: MailMacroDto = {
				id: generateUuidV7(),
				inboxId: body.inboxId ?? null,
				name: body.name,
				shortcut: body.shortcut ?? null,
				steps: [...body.steps],
				version: 1,
				createdAt: now,
				updatedAt: now
			}
			previewMailMacros = [...previewMailMacros, created]
			return created
		},
		async deleteMailMacro(id) {
			previewMailMacros = previewMailMacros.filter((m) => m.id !== id)
		},
		async applyMailMacro(id, body) {
			const macro = previewMailMacros.find((m) => m.id === id)
			if (!macro) throw new Error('macro not found')
			for (const convId of body.conversationIds) {
				for (const step of macro.steps) {
					if (step.action === 'set_status' && step.value) {
						previewMailConversations = previewMailConversations.map((c) =>
							c.id === convId
								? { ...c, status: step.value as MailConversationDto['status'], version: c.version + 1 }
								: c
						)
					} else if (step.action === 'add_tag' && step.value) {
						const existing = previewConversationTags.get(convId) ?? []
						if (!existing.includes(step.value)) {
							previewConversationTags.set(convId, [...existing, step.value])
						}
					} else if (step.action === 'remove_tag' && step.value) {
						previewConversationTags.set(
							convId,
							(previewConversationTags.get(convId) ?? []).filter((tId) => tId !== step.value)
						)
					}
				}
			}
			return { appliedCount: body.conversationIds.length }
		},
		async createOutboundConversation(body) {
			const now = new Date().toISOString()
			const convId = generateUuidV7()
			const recipientEmail = body.recipients.to[0]?.email ?? 'customer@acme.example'
			const newConv: MailConversationDto = {
				id: convId,
				workspaceId: PREVIEW_WORKSPACE_ID,
				inboxId: body.inboxId,
				accountId: PREVIEW_MAIL_ACCOUNT_ID,
				subject: body.subject,
				status: 'open',
				assigneeId: body.assigneeId ?? PREVIEW_USER_ID,
				assigneeName: 'Hagen (Owner)',
				snoozedUntil: null,
				mergedIntoId: null,
				lastMessageAt: now,
				firstReplyAt: null,
				customerEmail: recipientEmail,
				contactId: null,
				followUpAt: body.followUpAt ?? null,
				followUpCondition: body.followUpCondition ?? null,
				slaNextDueAt: null,
				slaBreachedAt: null,
				priority: 'normal',
				snippet: body.bodyText.slice(0, 120),
				messageCount: 0,
				createdAt: now,
				updatedAt: now,
				version: 1
			}
			previewMailConversations = [newConv, ...previewMailConversations]
			const draft: MailDraftDto = {
				id: generateUuidV7(),
				conversationId: convId,
				identityId: body.identityId,
				createdBy: PREVIEW_USER_ID,
				body: body.body ?? {},
				bodyText: body.bodyText,
				recipients: body.recipients,
				inReplyToId: null,
				scheduledSendAt: body.scheduledSendAt ?? null,
				status: 'draft',
				lockedBy: null,
				lockedUntil: null,
				collabEnabled: body.collabEnabled ?? false,
				reviewStatus: 'none',
				reviewerId: null,
				reviewedAt: null,
				reviewNote: null,
				metadata: body.attachmentFileIds ? { attachmentFileIds: body.attachmentFileIds } : {},
				version: 1,
				createdAt: now,
				updatedAt: now
			}
			previewMailDrafts = [draft, ...previewMailDrafts]
			return { conversationId: convId, draft }
		},
		async forwardConversation(conversationId, body) {
			const conv = previewMailConversations.find((c) => c.id === conversationId)
			if (!conv) throw new Error('conversation not found')
			const now = new Date().toISOString()
			const fwdConvId = generateUuidV7()
			const history = body.includeHistory
				? `\n\n--- Forwarded from "${conv.subject}" ---\n${conv.snippet}`
				: ''
			const newConv: MailConversationDto = {
				...conv,
				id: fwdConvId,
				subject: `Fwd: ${conv.subject}`,
				customerEmail: body.recipients.to[0]?.email ?? conv.customerEmail,
				followUpAt: body.followUpAt ?? null,
				followUpCondition: body.followUpCondition ?? null,
				lastMessageAt: now,
				createdAt: now,
				updatedAt: now,
				messageCount: 0,
				version: 1
			}
			previewMailConversations = [newConv, ...previewMailConversations]
			const draft: MailDraftDto = {
				id: generateUuidV7(),
				conversationId: fwdConvId,
				identityId: body.identityId,
				createdBy: PREVIEW_USER_ID,
				body: {},
				bodyText: `${body.bodyText}${history}`,
				recipients: body.recipients,
				inReplyToId: null,
				scheduledSendAt: body.scheduledSendAt ?? null,
				status: 'draft',
				lockedBy: null,
				lockedUntil: null,
				collabEnabled: false,
				reviewStatus: 'none',
				reviewerId: null,
				reviewedAt: null,
				reviewNote: null,
				metadata: body.attachmentFileIds ? { attachmentFileIds: body.attachmentFileIds } : {},
				version: 1,
				createdAt: now,
				updatedAt: now
			}
			previewMailDrafts = [draft, ...previewMailDrafts]
			return { conversationId: fwdConvId, draft }
		},
		async splitConversation(conversationId, body) {
			const conv = previewMailConversations.find((c) => c.id === conversationId)
			if (!conv) throw new Error('conversation not found')
			const now = new Date().toISOString()
			const newConvId = generateUuidV7()
			const newConv: MailConversationDto = {
				...conv,
				id: newConvId,
				subject: body.subject ?? `Split: ${conv.subject}`,
				lastMessageAt: now,
				createdAt: now,
				updatedAt: now,
				messageCount: 1,
				version: 1
			}
			previewMailConversations = [newConv, ...previewMailConversations]
			return { conversationId: newConvId }
		},
		async bulkTriageConversations(body) {
			const idSet = new Set(body.conversationIds)
			let updatedCount = 0
			previewMailConversations = previewMailConversations.map((conv) => {
				if (!idSet.has(conv.id)) return conv
				updatedCount += 1
				const currentTags = new Set(previewConversationTags.get(conv.id) ?? conv.tagIds ?? [])
				for (const tId of body.addTagIds ?? []) currentTags.add(tId)
				for (const tId of body.removeTagIds ?? []) currentTags.delete(tId)
				const tagIds = [...currentTags]
				previewConversationTags.set(conv.id, tagIds)
				return {
					...conv,
					...(body.status !== undefined ? { status: body.status } : {}),
					...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
					tagIds,
					version: conv.version + 1,
					updatedAt: new Date().toISOString()
				}
			})
			return { updatedCount }
		},
		async listContacts(q) {
			const query = q?.trim().toLowerCase()
			if (!query) return previewContacts
			return previewContacts.filter(
				(c) => c.email.toLowerCase().includes(query) || (c.displayName ?? '').toLowerCase().includes(query)
			)
		},
		async upsertContact(body, id) {
			const now = new Date().toISOString()
			const org = body.organizationId
				? (previewContactOrgs.find((o) => o.id === body.organizationId) ?? null)
				: null
			if (id) {
				const existing = previewContacts.find((c) => c.id === id)
				if (!existing) throw new Error('contact not found')
				const next: ContactDto = {
					...existing,
					email: body.email.toLowerCase(),
					displayName: body.displayName ?? null,
					title: body.title ?? null,
					phone: body.phone ?? null,
					vipTier: body.vipTier ?? existing.vipTier,
					notes: body.notes ?? null,
					metadata: body.metadata ?? existing.metadata,
					organizationId: body.organizationId ?? existing.organizationId,
					organizationName: org?.name ?? existing.organizationName ?? null,
					version: existing.version + 1,
					updatedAt: now
				}
				previewContacts = previewContacts.map((c) => (c.id === id ? next : c))
				return next
			}
			const created: ContactDto = {
				id: generateUuidV7(),
				email: body.email.toLowerCase(),
				displayName: body.displayName ?? null,
				title: body.title ?? null,
				phone: body.phone ?? null,
				vipTier: body.vipTier ?? 'standard',
				notes: body.notes ?? null,
				metadata: body.metadata ?? {},
				organizationId: body.organizationId ?? null,
				organizationName: org?.name ?? null,
				version: 1,
				createdAt: now,
				updatedAt: now
			}
			previewContacts = [created, ...previewContacts]
			return created
		},
		async listContactOrganizations() {
			return previewContactOrgs
		},
		async upsertContactOrganization(body, id) {
			const now = new Date().toISOString()
			if (id) {
				const existing = previewContactOrgs.find((o) => o.id === id)
				if (!existing) throw new Error('organization not found')
				const next: ContactOrganizationDto = {
					...existing,
					name: body.name,
					domain: body.domain ?? null,
					tier: body.tier ?? existing.tier,
					notes: body.notes ?? null,
					metadata: body.metadata ?? existing.metadata,
					version: existing.version + 1,
					updatedAt: now
				}
				previewContactOrgs = previewContactOrgs.map((o) => (o.id === id ? next : o))
				return next
			}
			const created: ContactOrganizationDto = {
				id: generateUuidV7(),
				name: body.name,
				domain: body.domain ?? null,
				tier: body.tier ?? 'standard',
				notes: body.notes ?? null,
				metadata: body.metadata ?? {},
				version: 1,
				createdAt: now,
				updatedAt: now
			}
			previewContactOrgs = [created, ...previewContactOrgs]
			return created
		},
		async getMailRoutingConfig(inboxId) {
			return (
				previewMailRoutingByInbox.get(inboxId) ?? {
					enabled: false,
					maxOpenCap: 10,
					requireOnline: true,
					respectDnd: true,
					respectWorkingHours: false,
					respectOoo: true,
					useOooDelegate: true
				}
			)
		},
		async upsertMailRoutingConfig(inboxId, body) {
			const next: MailRoutingConfigDto = {
				enabled: body.enabled,
				maxOpenCap: body.maxOpenCap ?? 10,
				requireOnline: body.requireOnline ?? true,
				respectDnd: body.respectDnd ?? true,
				respectWorkingHours: body.respectWorkingHours ?? false,
				respectOoo: body.respectOoo ?? true,
				useOooDelegate: body.useOooDelegate ?? true
			}
			previewMailRoutingByInbox.set(inboxId, next)
			return next
		},
		async routeConversationRoundRobin(conversationId) {
			const conv = previewMailConversations.find((c) => c.id === conversationId)
			if (!conv) throw new Error('conversation not found')
			const cfg = previewMailRoutingByInbox.get(conv.inboxId)
			if (!cfg?.enabled) return { assignedUserId: null }
			const candidates = [PREVIEW_USER_ID, '0190a0b1-0000-7000-8000-000000000002']
			const assignedUserId = candidates[previewRoutingIndex % candidates.length] ?? PREVIEW_USER_ID
			previewRoutingIndex += 1
			previewMailConversations = previewMailConversations.map((c) =>
				c.id === conversationId ? { ...c, assigneeId: assignedUserId, version: c.version + 1 } : c
			)
			return { assignedUserId }
		},
		async listMailSlaPolicies(inboxId) {
			if (!inboxId) return previewMailSlaPolicies
			return previewMailSlaPolicies.filter((p) => p.inboxId === null || p.inboxId === inboxId)
		},
		async upsertMailSlaPolicy(body, id) {
			const now = new Date().toISOString()
			if (id) {
				const existing = previewMailSlaPolicies.find((p) => p.id === id)
				if (!existing) throw new Error('policy not found')
				const next: MailSlaPolicyDto = {
					...existing,
					inboxId: body.inboxId ?? null,
					tagId: body.tagId ?? null,
					name: body.name,
					firstReplyMinutes: body.firstReplyMinutes ?? null,
					nextReplyMinutes: body.nextReplyMinutes ?? null,
					resolutionMinutes: body.resolutionMinutes ?? null,
					businessHours: body.businessHours ?? {},
					active: body.active ?? existing.active,
					version: existing.version + 1,
					updatedAt: now
				}
				previewMailSlaPolicies = previewMailSlaPolicies.map((p) => (p.id === id ? next : p))
				return next
			}
			const created: MailSlaPolicyDto = {
				id: generateUuidV7(),
				inboxId: body.inboxId ?? null,
				tagId: body.tagId ?? null,
				name: body.name,
				firstReplyMinutes: body.firstReplyMinutes ?? null,
				nextReplyMinutes: body.nextReplyMinutes ?? null,
				resolutionMinutes: body.resolutionMinutes ?? null,
				businessHours: body.businessHours ?? {},
				active: body.active ?? true,
				version: 1,
				createdAt: now,
				updatedAt: now
			}
			previewMailSlaPolicies = [...previewMailSlaPolicies, created]
			return created
		},
		async deleteMailSlaPolicy(id) {
			previewMailSlaPolicies = previewMailSlaPolicies.filter((p) => p.id !== id)
		},
		async getMailSlaAnalytics(inboxId) {
			const scoped = inboxId
				? previewMailConversations.filter((c) => c.inboxId === inboxId)
				: previewMailConversations
			const repliedCount = scoped.filter((c) => c.firstReplyAt !== null).length
			const breachedCount = scoped.filter((c) => c.slaBreachedAt !== null).length
			return {
				conversationCount: scoped.length,
				repliedCount,
				avgFirstReplyMinutes: repliedCount > 0 ? 15 : null,
				avgResolutionMinutes: null,
				breachedCount
			}
		},
		async requestMailDraftReview(draftId, body) {
			const existing = previewMailDrafts.find((d) => d.id === draftId)
			if (!existing) throw new Error('draft not found')
			const next: MailDraftDto = {
				...existing,
				reviewStatus: 'requested',
				reviewerId: body.reviewerId,
				reviewNote: body.note ?? null,
				version: existing.version + 1,
				updatedAt: new Date().toISOString()
			}
			previewMailDrafts = previewMailDrafts.map((d) => (d.id === draftId ? next : d))
			return next
		},
		async completeMailDraftReview(draftId, body) {
			const existing = previewMailDrafts.find((d) => d.id === draftId)
			if (!existing) throw new Error('draft not found')
			const next: MailDraftDto = {
				...existing,
				reviewStatus: body.decision,
				reviewedAt: new Date().toISOString(),
				reviewNote: body.note ?? existing.reviewNote,
				version: existing.version + 1,
				updatedAt: new Date().toISOString()
			}
			previewMailDrafts = previewMailDrafts.map((d) => (d.id === draftId ? next : d))
			return next
		},
		async updateMailInboxSettings(inboxId, body) {
			const existing = previewMailInboxes.find((i) => i.id === inboxId)
			if (!existing) throw new Error('inbox not found')
			const next: MailInboxDto = {
				...existing,
				settings: body.settings,
				version: (existing.version ?? 1) + 1
			}
			previewMailInboxes = previewMailInboxes.map((i) => (i.id === inboxId ? next : i))
			return next
		},
		async assistDocBlockWithAi(body) {
			return {
				pageId: body.pageId,
				blockId: body.blockId,
				text: `AI preview response for: ${body.instruction}`,
				model: 'preview-assistant',
				cached: false
			}
		},
		async assistMailWithAi(body) {
			const conv = previewMailConversations.find((c) => c.id === body.conversationId)
			if (!conv) throw new Error('conversation not found')
			const tasks = previewMailLinkedTasks.get(conv.id) ?? []
			const docs = previewMailLinkedDocs.get(conv.id) ?? []
			const citations: AiMailAssistResponse['citations'] = [
				...docs.map((d) => ({
					entityType: 'doc_page' as const,
					entityId: d.pageId,
					label: d.title ?? d.slug ?? d.pageId.slice(0, 8),
					slug: d.slug
				})),
				...tasks.map((task) => ({
					entityType: 'issue' as const,
					entityId: task.taskId,
					label: task.identifier
						? `${task.identifier}${task.title ? ` — ${task.title}` : ''}`
						: (task.title ?? task.taskId.slice(0, 8)),
					slug: null
				}))
			]
			if (body.mode === 'summarize') {
				return {
					conversationId: conv.id,
					mode: 'summarize',
					text: `• Customer (${conv.customerEmail ?? 'unknown'}) reported: ${conv.subject}.\n• Current status: ${conv.status} (${conv.messageCount} messages).\n• Next step: confirm resolution in customer's workspace.`,
					suggestedTags: [],
					citations,
					model: 'preview-assistant',
					cached: false
				}
			}
			if (body.mode === 'suggest_tags') {
				const matching = previewMailTags
					.filter((tag) => conv.inboxId === tag.inboxId || tag.inboxId === null)
					.slice(0, 2)
					.map((tag) => tag.name)
				return {
					conversationId: conv.id,
					mode: 'suggest_tags',
					text: `Suggested workspace tags for "${conv.subject}": ${matching.join(', ') || 'none'}.`,
					suggestedTags: matching,
					citations,
					model: 'preview-assistant',
					cached: false
				}
			}
			return {
				conversationId: conv.id,
				mode: 'suggest_reply',
				text: `Hi there,\n\nThanks for following up on "${conv.subject}". We verified the workspace export fix and everything is ready to retry now. Please let us know if you hit any further trouble.\n\nBest,\nHuriro Support`,
				suggestedTags: [],
				citations,
				model: 'preview-assistant',
				cached: false
			}
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
		},
		// M7 in the offline preview: read/write triage and cycles directly
		// against the local replica so full end-to-end flows work offline (§9.5).
		async listTriageQueue(projectId, state = 'pending') {
			return engine.collections.issues.toArray
				.filter((issue) => {
					if (issue.deletedAt !== null || issue.projectId !== projectId) return false
					if (state === 'resolved') {
						return (
							issue.triageStatus === 'accepted' ||
							issue.triageStatus === 'declined' ||
							issue.triageStatus === 'merged'
						)
					}
					return issue.triageStatus === state
				})
				.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
		},
		async triageIssue(issueId, body) {
			const current = engine.collections.issues.get(issueId)
			if (!current) throw new Error('Issue not found')
			const now = new Date().toISOString()
			const projectStatuses = engine.collections.projectStatuses.toArray
				.filter((s) => s.projectId === current.projectId)
				.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
			const defaultStatus = projectStatuses.find((s) => s.isDefault) ?? projectStatuses[0]
			const cancelledStatus =
				projectStatuses.find((s) => s.category === 'cancelled') ??
				projectStatuses.find((s) => s.category === 'completed')

			let updated: IssueDto
			if (body.action === 'accept') {
				const requestedStatus = body.statusId
					? projectStatuses.find((s) => s.id === body.statusId)
					: projectStatuses.find((s) => s.id === current.statusId)
				const nextStatus =
					requestedStatus &&
					requestedStatus.category !== 'completed' &&
					requestedStatus.category !== 'cancelled'
						? requestedStatus
						: (defaultStatus ?? requestedStatus)
				const assigneeId = body.assigneeId === undefined ? current.assigneeId : body.assigneeId
				const assigneeType =
					assigneeId === null
						? null
						: body.assigneeId !== undefined
							? ('user' as const)
							: current.assigneeType
				updated = {
					...current,
					statusId: nextStatus?.id ?? current.statusId,
					priority: body.priority ?? current.priority,
					assigneeId,
					assigneeType,
					labelIds: body.labelIds ?? current.labelIds,
					triageStatus: 'accepted',
					triageSnoozedUntil: null,
					triageDeclinedReason: null,
					updatedAt: now,
					version: current.version + 1
				}
			} else if (body.action === 'snooze') {
				updated = {
					...current,
					triageStatus: 'snoozed',
					triageSnoozedUntil: body.until,
					triageDeclinedReason: null,
					updatedAt: now,
					version: current.version + 1
				}
			} else if (body.action === 'decline') {
				updated = {
					...current,
					statusId: cancelledStatus?.id ?? current.statusId,
					closedAt: current.closedAt ?? now,
					triageStatus: 'declined',
					triageSnoozedUntil: null,
					triageDeclinedReason: body.reason,
					updatedAt: now,
					version: current.version + 1
				}
			} else {
				if (body.duplicateOfIssueId !== issueId) {
					engine.collections.issueRelationsManaged.upsertMany([
						{
							id: generateUuidV7(),
							workspaceId: PREVIEW_WORKSPACE_ID,
							sourceIssueId: issueId,
							targetIssueId: body.duplicateOfIssueId,
							kind: 'duplicates',
							createdBy: PREVIEW_USER_ID,
							createdAt: now
						}
					])
				}
				updated = {
					...current,
					statusId: cancelledStatus?.id ?? current.statusId,
					closedAt: current.closedAt ?? now,
					triageStatus: 'merged',
					triageSnoozedUntil: null,
					triageDeclinedReason: null,
					updatedAt: now,
					version: current.version + 1
				}
			}
			engine.collections.issuesManaged.upsertMany([updated])
			void engine.persistReplica()
			return updated
		},
		async getTriageSuggestions() {
			return { duplicates: [], suggestedPriority: null, suggestedLabelIds: [], suggestedAssigneeId: null }
		},
		async bulkUpdateIssues() {
			throw new Error('Bulk actions require a connected server')
		},
		async bulkRestoreIssues() {
			throw new Error('Bulk restore requires a connected server')
		},
		async queryIssues() {
			return { data: [], nextCursor: null, hasMore: false }
		},
		async createCycle(body) {
			const now = new Date().toISOString()
			const created: CycleDto = {
				id: generateUuidV7(),
				workspaceId: PREVIEW_WORKSPACE_ID,
				projectId: body.projectId,
				name: body.name.trim(),
				description: body.description ?? '',
				status: body.status ?? 'planned',
				startsAt: body.startsAt,
				endsAt: body.endsAt,
				createdAt: now,
				updatedAt: now,
				version: 1
			}
			engine.collections.cyclesManaged.upsertMany([created])
			void engine.persistReplica()
			return created
		},
		async listCycleSnapshots() {
			return previewCycleSnapshots
		},
		async listEntityLinks(type, id) {
			return previewEntityLinks.filter(
				(l) => (l.sourceType === type && l.sourceId === id) || (l.targetType === type && l.targetId === id)
			)
		},
		async createEntityLink(body) {
			const next: EntityLinkDto = {
				id: generateUuidV7(),
				workspaceId: PREVIEW_WORKSPACE_ID,
				sourceType: body.sourceType,
				sourceId: body.sourceId,
				targetType: body.targetType,
				targetId: body.targetId,
				relationKind: body.relationKind ?? 'references',
				createdBy: PREVIEW_USER_ID,
				createdAt: new Date().toISOString()
			}
			previewEntityLinks.push(next)
			return next
		},
		async deleteEntityLink(linkId) {
			const idx = previewEntityLinks.findIndex((l) => l.id === linkId)
			if (idx >= 0) previewEntityLinks.splice(idx, 1)
		},
		async peekEntity(type, id) {
			const issue = previewPeekIssues.find((i) => i.id === id)
			if (type === 'issue' && issue) {
				return {
					type,
					id,
					title: issue.title,
					subtitle: issue.identifier,
					status: { kind: 'status', label: issue.statusCategory },
					meta: {},
					updatedAt: issue.updatedAt
				}
			}
			// Replica fallback: any synced issue is peekable in preview — without
			// this every hover/focus peek degrades to "no access" even though the
			// working set is right there in the local collections.
			if (type === 'issue') {
				const row = engine.collections.issues.get(id)
				if (row) {
					const status = engine.collections.projectStatuses.get(row.statusId)
					return {
						type,
						id,
						title: row.title,
						subtitle: row.identifier,
						...(status ? { status: { kind: 'status' as const, label: status.name } } : {}),
						meta: {},
						updatedAt: row.updatedAt
					}
				}
			}
			return null
		},
		async listTeamspaces() {
			return engine.collections.teamspaces.toArray.filter((ts) => ts.archivedAt === null)
		},
		async createTeamspace(body) {
			const tsNow = new Date().toISOString()
			const id = generateUuidV7()
			const slugBase =
				body.name
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, '-')
					.replace(/^-+|-+$/g, '') || `teamspace-${id.slice(0, 6)}`
			const created: TeamspaceDto = {
				id,
				workspaceId: PREVIEW_WORKSPACE_ID,
				name: body.name,
				slug: body.slug ?? slugBase,
				icon: body.icon ?? '📁',
				description: body.description ?? '',
				visibility: body.visibility ?? 'open',
				defaultAcl: body.defaultAcl ?? [
					{ principalType: 'workspace', principalId: null, permission: 'write' }
				],
				position: `z${Date.now()}`,
				archivedAt: null,
				createdBy: PREVIEW_USER_ID,
				createdAt: tsNow,
				updatedAt: tsNow,
				version: 1
			}
			engine.collections.teamspacesManaged.upsertMany([created])
			previewTeamspaceMembers.set(id, [
				{
					workspaceId: PREVIEW_WORKSPACE_ID,
					teamspaceId: id,
					userId: PREVIEW_USER_ID,
					role: 'owner',
					createdAt: tsNow
				}
			])
			return created
		},
		async updateTeamspace(id, body) {
			const existing = engine.collections.teamspaces.get(id)
			if (!existing) throw new Error('Teamspace not found')
			const updated: TeamspaceDto = {
				...existing,
				...(body.name !== undefined ? { name: body.name } : {}),
				...(body.slug !== undefined ? { slug: body.slug } : {}),
				...(body.icon !== undefined ? { icon: body.icon } : {}),
				...(body.description !== undefined ? { description: body.description } : {}),
				...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
				...(body.defaultAcl !== undefined ? { defaultAcl: body.defaultAcl } : {}),
				...(body.archived !== undefined
					? { archivedAt: body.archived ? new Date().toISOString() : null }
					: {}),
				updatedAt: new Date().toISOString(),
				version: existing.version + 1
			}
			engine.collections.teamspacesManaged.upsertMany([updated])
			return updated
		},
		async archiveTeamspace(id) {
			const existing = engine.collections.teamspaces.get(id)
			if (!existing) return
			engine.collections.teamspacesManaged.upsertMany([
				{
					...existing,
					archivedAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					version: existing.version + 1
				}
			])
		},
		async listTeamspaceMembers(id) {
			return previewTeamspaceMembers.get(id) ?? []
		},
		async addTeamspaceMember(id, body) {
			const list = [...(previewTeamspaceMembers.get(id) ?? [])]
			const next: TeamspaceMemberDto = {
				workspaceId: PREVIEW_WORKSPACE_ID,
				teamspaceId: id,
				userId: body.userId,
				role: body.role ?? 'member',
				createdAt: new Date().toISOString()
			}
			const filtered = list.filter((m) => m.userId !== body.userId)
			filtered.push(next)
			previewTeamspaceMembers.set(id, filtered)
			return next
		},
		async removeTeamspaceMember(id, userId) {
			const list = previewTeamspaceMembers.get(id) ?? []
			previewTeamspaceMembers.set(
				id,
				list.filter((m) => m.userId !== userId)
			)
		},
		async listSyncedBlocks() {
			return [...previewSyncedBlocks.values()]
				.filter((b) => b.archivedAt === null)
				.map(({ state: _s, ...dto }) => dto)
		},
		async createSyncedBlock(body) {
			const id = generateUuidV7()
			const sbNow = new Date().toISOString()
			const ydoc = body.prosemirrorJson
				? prosemirrorJsonToYDoc(body.prosemirrorJson as Parameters<typeof prosemirrorJsonToYDoc>[0])
				: (() => {
						const doc = new Y.Doc()
						const built = buildPreviewYDocState(body.markdown ?? '> Shared block content', `synced-${id}`)
						Y.applyUpdate(doc, built.state)
						return doc
					})()
			const state = Y.encodeStateAsUpdate(ydoc)
			const stateVector = Y.encodeStateVector(ydoc)
			const extracted = extractDocumentContent(ydoc)
			const entry: DocSyncedBlockDto & { state: Uint8Array } = {
				id,
				workspaceId: PREVIEW_WORKSPACE_ID,
				title: body.title ?? 'Synced block',
				sourcePageId: body.sourcePageId ?? null,
				stateBase64: bytesToBase64(state),
				stateVectorBase64: bytesToBase64(stateVector),
				byteSize: state.byteLength,
				plainText: extracted.plainText,
				createdBy: PREVIEW_USER_ID,
				archivedAt: null,
				createdAt: sbNow,
				updatedAt: sbNow,
				version: 1,
				state
			}
			previewSyncedBlocks.set(id, entry)
			const { state: _s, ...dto } = entry
			return dto
		},
		async getSyncedBlock(id) {
			const entry = previewSyncedBlocks.get(id)
			if (!entry || entry.archivedAt !== null) {
				const err = new Error('Synced block not found') as Error & { status?: number }
				err.status = 404
				throw err
			}
			const { state: _s, ...dto } = entry
			return dto
		},
		async updateSyncedBlock(id, body) {
			const entry = previewSyncedBlocks.get(id)
			if (!entry) throw new Error('Synced block not found')
			let nextState = entry.state
			let nextSv = entry.stateVectorBase64
			let nextText = entry.plainText
			if (body.markdown !== undefined) {
				const built = buildPreviewYDocState(body.markdown, `synced-${id}`)
				nextState = built.state
				nextSv = bytesToBase64(built.stateVector)
				nextText = built.extracted.plainText
			}
			const updated: DocSyncedBlockDto & { state: Uint8Array } = {
				...entry,
				...(body.title !== undefined ? { title: body.title } : {}),
				...(body.archived !== undefined
					? { archivedAt: body.archived ? new Date().toISOString() : null }
					: {}),
				state: nextState,
				stateBase64: bytesToBase64(nextState),
				stateVectorBase64: nextSv,
				byteSize: nextState.byteLength,
				plainText: nextText,
				updatedAt: new Date().toISOString(),
				version: entry.version + 1
			}
			previewSyncedBlocks.set(id, updated)
			const { state: _s, ...dto } = updated
			return dto
		},
		async issueSyncedBlockCollabTicket(id) {
			return {
				ticket: `preview-synced-${id}`,
				documentName: `synced_block:${PREVIEW_WORKSPACE_ID}:${id}`,
				permission: 'write',
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
				collabUrl: '/collab'
			}
		},
		async listDocSuggestions(pageId) {
			const page = engine.collections.docPages.get(pageId)
			if (!page) return previewSuggestionsByPage.get(pageId) ?? []
			const st = ensurePreviewDocState(page)
			const ydoc = new Y.Doc()
			if (st.state.byteLength > 0) Y.applyUpdate(ydoc, st.state)
			const live = extractSuggestionsFromYDoc(ydoc)
			const existing = previewSuggestionsByPage.get(pageId) ?? []
			const existingByGroup = new Map(existing.map((s) => [s.groupId, s]))
			const merged: DocSuggestionDto[] = existing.filter(
				(s) => s.status !== 'open' || live.some((l) => l.groupId === s.groupId)
			)
			for (const g of live) {
				if (!existingByGroup.has(g.groupId)) {
					merged.push({
						id: generateUuidV7(),
						workspaceId: PREVIEW_WORKSPACE_ID,
						pageId,
						groupId: g.groupId,
						kind: g.kind,
						authorType: g.authorType,
						authorId: g.authorId || PREVIEW_USER_ID,
						anchorBlockId: g.anchorBlockId,
						beforeText: g.beforeText,
						afterText: g.afterText,
						status: 'open',
						resolvedBy: null,
						resolvedAt: null,
						createdAt: g.createdAt || new Date().toISOString(),
						updatedAt: g.createdAt || new Date().toISOString(),
						version: 1
					})
				}
			}
			previewSuggestionsByPage.set(pageId, merged)
			return merged
		},
		async proposeDocSuggestion(pageId, body) {
			const page = engine.collections.docPages.get(pageId)
			if (!page) throw new Error('Document not found')
			const st = ensurePreviewDocState(page)
			const ydoc = new Y.Doc()
			if (st.state.byteLength > 0) Y.applyUpdate(ydoc, st.state)
			const result = proposeSuggestionOnYDoc(ydoc, {
				kind: body.kind,
				authorType: 'user',
				authorId: PREVIEW_USER_ID,
				anchorBlockId: body.anchorBlockId ?? null,
				targetText: body.targetText,
				replacementText: body.replacementText,
				groupId: body.groupId
			})
			const nextState = Y.encodeStateAsUpdate(ydoc)
			const extracted = extractDocumentContent(ydoc)
			docStatesByPage.set(pageId, {
				state: nextState,
				stateVector: Y.encodeStateVector(ydoc),
				plainText: extracted.plainText,
				headings: extracted.headings
			})
			const sgNow = new Date().toISOString()
			const dto: DocSuggestionDto = {
				id: generateUuidV7(),
				workspaceId: PREVIEW_WORKSPACE_ID,
				pageId,
				groupId: result.groupId,
				kind: body.kind,
				authorType: 'user',
				authorId: PREVIEW_USER_ID,
				anchorBlockId: body.anchorBlockId ?? null,
				beforeText: body.targetText ?? '',
				afterText: body.replacementText ?? '',
				status: 'open',
				resolvedBy: null,
				resolvedAt: null,
				createdAt: sgNow,
				updatedAt: sgNow,
				version: 1
			}
			const list = previewSuggestionsByPage.get(pageId) ?? []
			previewSuggestionsByPage.set(pageId, [dto, ...list.filter((s) => s.groupId !== result.groupId)])
			return dto
		},
		async decideDocSuggestion(pageId, groupId, decision) {
			const page = engine.collections.docPages.get(pageId)
			if (!page) throw new Error('Document not found')
			const st = ensurePreviewDocState(page)
			const ydoc = new Y.Doc()
			if (st.state.byteLength > 0) Y.applyUpdate(ydoc, st.state)
			applySuggestionDecisionToYDoc(ydoc, groupId, decision)
			const nextState = Y.encodeStateAsUpdate(ydoc)
			const extracted = extractDocumentContent(ydoc)
			docStatesByPage.set(pageId, {
				state: nextState,
				stateVector: Y.encodeStateVector(ydoc),
				plainText: extracted.plainText,
				headings: extracted.headings
			})
			const list = previewSuggestionsByPage.get(pageId) ?? []
			const dNow = new Date().toISOString()
			const nextStatus = decision === 'accept' ? 'accepted' : 'rejected'
			let updatedDto: DocSuggestionDto | null = null
			const nextList = list.map((s) => {
				if (s.groupId !== groupId) return s
				updatedDto = {
					...s,
					status: nextStatus,
					resolvedBy: PREVIEW_USER_ID,
					resolvedAt: dNow,
					updatedAt: dNow,
					version: s.version + 1
				}
				return updatedDto
			})
			if (!updatedDto) {
				updatedDto = {
					id: generateUuidV7(),
					workspaceId: PREVIEW_WORKSPACE_ID,
					pageId,
					groupId,
					kind: 'replace',
					authorType: 'user',
					authorId: PREVIEW_USER_ID,
					anchorBlockId: null,
					beforeText: '',
					afterText: '',
					status: nextStatus,
					resolvedBy: PREVIEW_USER_ID,
					resolvedAt: dNow,
					createdAt: dNow,
					updatedAt: dNow,
					version: 1
				}
				nextList.unshift(updatedDto)
			}
			previewSuggestionsByPage.set(pageId, nextList)
			return updatedDto
		},
		async decideAllDocSuggestions(pageId, decision) {
			const page = engine.collections.docPages.get(pageId)
			if (!page) return { updatedCount: 0 }
			const st = ensurePreviewDocState(page)
			const ydoc = new Y.Doc()
			if (st.state.byteLength > 0) Y.applyUpdate(ydoc, st.state)
			applyAllSuggestionsDecisionToYDoc(ydoc, decision)
			const nextState = Y.encodeStateAsUpdate(ydoc)
			const extracted = extractDocumentContent(ydoc)
			docStatesByPage.set(pageId, {
				state: nextState,
				stateVector: Y.encodeStateVector(ydoc),
				plainText: extracted.plainText,
				headings: extracted.headings
			})
			const list = previewSuggestionsByPage.get(pageId) ?? []
			const dNow = new Date().toISOString()
			const nextStatus = decision === 'accept' ? 'accepted' : 'rejected'
			let updatedCount = 0
			previewSuggestionsByPage.set(
				pageId,
				list.map((s) => {
					if (s.status !== 'open') return s
					updatedCount += 1
					return {
						...s,
						status: nextStatus,
						resolvedBy: PREVIEW_USER_ID,
						resolvedAt: dNow,
						updatedAt: dNow,
						version: s.version + 1
					}
				})
			)
			return { updatedCount }
		},
		async getDocVerification(pageId) {
			return previewVerificationsByPage.get(pageId) ?? null
		},
		async setDocVerification(pageId, body) {
			const page = engine.collections.docPages.get(pageId)
			if (!page) throw new Error('Document not found')
			const vNow = new Date().toISOString()
			const existing = previewVerificationsByPage.get(pageId)
			const expiresAt =
				body.expiresAt !== undefined
					? body.expiresAt
					: body.ttlDays
						? new Date(Date.now() + body.ttlDays * 86_400_000).toISOString()
						: null
			const next: DocVerificationDto = {
				id: existing?.id ?? generateUuidV7(),
				workspaceId: PREVIEW_WORKSPACE_ID,
				pageId,
				status: body.status ?? 'verified',
				verifiedBy: PREVIEW_USER_ID,
				verifiedAt: vNow,
				expiresAt,
				note: body.note ?? '',
				createdAt: existing?.createdAt ?? vNow,
				updatedAt: vNow,
				version: (existing?.version ?? 0) + 1
			}
			previewVerificationsByPage.set(pageId, next)
			engine.collections.docPagesManaged.upsertMany([
				{
					...page,
					verificationStatus: next.status,
					verificationExpiresAt: next.expiresAt,
					updatedAt: vNow
				}
			])
			return next
		},
		async clearDocVerification(pageId) {
			previewVerificationsByPage.delete(pageId)
			const page = engine.collections.docPages.get(pageId)
			if (page) {
				engine.collections.docPagesManaged.upsertMany([
					{
						...page,
						verificationStatus: 'unverified',
						verificationExpiresAt: null,
						updatedAt: new Date().toISOString()
					}
				])
			}
		},
		async getDocPublicShare(pageId) {
			return previewPublicSharesByPage.get(pageId) ?? null
		},
		async upsertDocPublicShare(pageId, body) {
			const page = engine.collections.docPages.get(pageId)
			if (!page) throw new Error('Document not found')
			const existing = previewPublicSharesByPage.get(pageId)
			const psNow = new Date().toISOString()
			const next: DocPublicShareDto = {
				id: existing?.id ?? generateUuidV7(),
				workspaceId: PREVIEW_WORKSPACE_ID,
				pageId,
				publicSlug: body.publicSlug ?? existing?.publicSlug ?? page.slug,
				includeChildren: body.includeChildren ?? existing?.includeChildren ?? false,
				allowSearchIndexing: body.allowSearchIndexing ?? existing?.allowSearchIndexing ?? false,
				hasPassword: body.password === null ? false : Boolean(body.password || existing?.hasPassword),
				expiresAt: body.expiresAt !== undefined ? body.expiresAt : (existing?.expiresAt ?? null),
				revokedAt: null,
				createdBy: existing?.createdBy ?? PREVIEW_USER_ID,
				createdAt: existing?.createdAt ?? psNow,
				updatedAt: psNow,
				version: (existing?.version ?? 0) + 1
			}
			previewPublicSharesByPage.set(pageId, next)
			return next
		},
		async revokeDocPublicShare(pageId) {
			previewPublicSharesByPage.delete(pageId)
		},
		async exportDocHtml(pageId, print) {
			const page = engine.collections.docPages.get(pageId)
			if (!page) throw new Error('Document not found')
			const st = ensurePreviewDocState(page)
			const ydoc = new Y.Doc()
			if (st.state.byteLength > 0) Y.applyUpdate(ydoc, st.state)
			const bodyHtml = proseMirrorJsonToSafeHtml(ydocToProseMirrorJson(ydoc))
			const html = renderStandaloneHtmlDocument({
				title: page.title,
				html: bodyHtml,
				fontStyle: page.fontStyle ?? 'sans',
				fullWidth: page.fullWidth ?? false,
				smallText: page.smallText ?? false,
				printAuto: Boolean(print)
			})
			return { pageId: page.id, slug: page.slug, title: page.title, html }
		},
		async exportDocZip(pageId, includeChildren) {
			const page = engine.collections.docPages.get(pageId)
			if (!page) throw new Error('Document not found')
			const { zipSync, strToU8 } = await import('fflate')
			const pagesToPack = [page]
			if (includeChildren) {
				for (const p of engine.collections.docPages.toArray) {
					if (p.id !== page.id && p.archivedAt === null && p.path.startsWith(`${page.path}/`)) {
						pagesToPack.push(p)
					}
				}
			}
			const files: Record<string, Uint8Array> = {}
			for (const p of pagesToPack) {
				const st = ensurePreviewDocState(p)
				const ydoc = new Y.Doc()
				if (st.state.byteLength > 0) Y.applyUpdate(ydoc, st.state)
				files[`${p.slug}.md`] = strToU8(ydocToMarkdown(ydoc))
			}
			const zipped = zipSync(files)
			const ab = new ArrayBuffer(zipped.byteLength)
			new Uint8Array(ab).set(zipped)
			return new Blob([ab], { type: 'application/zip' })
		},
		async unfurlBookmark(url) {
			const parsed = new URL(url)
			return {
				url: parsed.toString(),
				title: parsed.hostname,
				description: 'Preview bookmark card',
				siteName: parsed.hostname,
				faviconUrl: null,
				imageUrl: null
			}
		},
		async triggerDocButton() {},
		async importDocDatabaseRows(databaseId, body) {
			// Preview mode intentionally keeps import simple: create title-only rows in
			// the local engine so offline behavior and change ordering stay realistic.
			const lines = body.format === 'csv' ? body.data.split(/\r?\n/).slice(1) : []
			let created = 0
			for (const line of lines) {
				const title = line.split(',')[0]?.trim()
				if (!title) continue
				await engine.createDocDatabaseRow(databaseId, { title })
				created += 1
			}
			const result: ImportDocDatabaseRowsResultDto = { created, skipped: 0, errors: [] }
			return result
		},
		async exportDocDatabaseRows(databaseId) {
			const rows = engine.collections.docDatabaseRows.toArray.filter(
				(row) => row.databaseId === databaseId && row.archivedAt === null
			)
			return ['Name', ...rows.map((row) => row.title.replaceAll('"', '""'))].join('\n')
		},
		async ensureDocDatabaseRowPage(_databaseId, rowId) {
			const row = engine.collections.docDatabaseRows.get(rowId)
			if (row?.pageId) return { pageId: row.pageId, created: false }
			return { pageId: generateUuidV7(), created: true }
		},
		async getKnowledgeGraph(teamspaceId) {
			const teamspaces = engine.collections.teamspaces.toArray.filter((t) => t.archivedAt === null)
			const pages = engine.collections.docPages.toArray.filter(
				(p) => p.archivedAt === null && !p.isTemplate && (!teamspaceId || p.teamspaceId === teamspaceId)
			)
			const pageIds = new Set(pages.map((p) => p.id))
			const nodes: KnowledgeGraphResponse['nodes'] = [
				...teamspaces
					.filter((ts) => !teamspaceId || ts.id === teamspaceId)
					.map((ts) => ({
						id: ts.id,
						kind: 'teamspace' as const,
						label: ts.name,
						subtitle: ts.visibility,
						slug: ts.slug,
						teamspaceId: ts.id,
						verificationStatus: null
					})),
				...pages.map((p) => ({
					id: p.id,
					kind: 'doc_page' as const,
					label: p.title,
					subtitle: p.slug,
					slug: p.slug,
					teamspaceId: p.teamspaceId ?? null,
					verificationStatus: p.verificationStatus ?? null
				}))
			]
			const edges: KnowledgeGraphResponse['edges'] = []
			for (const p of pages) {
				if (p.parentId && pageIds.has(p.parentId)) {
					edges.push({
						id: `parent:${p.parentId}:${p.id}`,
						sourceId: p.parentId,
						targetId: p.id,
						relationKind: 'contains'
					})
				} else if (p.teamspaceId) {
					edges.push({
						id: `ts:${p.teamspaceId}:${p.id}`,
						sourceId: p.teamspaceId,
						targetId: p.id,
						relationKind: 'teamspace'
					})
				}
			}
			for (const link of previewEntityLinks) {
				if (
					(link.sourceType === 'doc_page' && pageIds.has(link.sourceId)) ||
					(link.targetType === 'doc_page' && pageIds.has(link.targetId))
				) {
					edges.push({
						id: link.id,
						sourceId: link.sourceId,
						targetId: link.targetId,
						relationKind: link.relationKind
					})
				}
			}
			return { nodes, edges }
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
