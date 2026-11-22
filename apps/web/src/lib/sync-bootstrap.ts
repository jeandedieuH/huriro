/**
 * Workspace bootstrap & auxiliary HTTP/preview API bridge.
 *
 * Online: attaches `HttpSyncTransport` + `WsSignalClient` to live server endpoints.
 * Standalone preview / unit tests (no authenticated server): seeds an offline-first
 * local preview replica so all M1 workflows operate without blocking spinners (§9.5).
 */
import type {
	ImportDryRunBody,
	ImportDryRunPreviewDto,
	ImportExecuteBody,
	ImportJobDto,
	IssueCommentDto,
	IssueRelationDto,
	NotificationDto,
	ProjectDto,
	ProjectStatusDto,
	RelationKind,
	SearchHitDto,
	SearchResponse
} from '@huriro/contracts'
import { parseSearchQuery } from '@huriro/domain'
import {
	generateUuidV7,
	HttpSyncTransport,
	HuriroSyncEngine,
	MemoryReplicaStorage
} from '@huriro/sync-client'
import { env } from './env'

// Validated client env — unset means same-origin (dev proxy / single ingress).
const API_BASE = env.VITE_API_URL ?? ''

export const PREVIEW_WORKSPACE_ID = '0190a0b1-0000-7000-8000-000000000001'
export const PREVIEW_USER_ID = '0190a0b1-0000-7000-8000-000000000002'
export const PREVIEW_PROJECT_ENG_ID = '0190a0b1-0000-7000-8000-000000000010'
export const PREVIEW_PROJECT_SEC_ID = '0190a0b1-0000-7000-8000-000000000011'

export interface WorkspaceMemberSummary {
	readonly userId: string
	readonly displayName: string
	readonly email: string
	readonly role: string
}

export interface TaskApiBridge {
	listMembers(): Promise<WorkspaceMemberSummary[]>
	listComments(issueId: string): Promise<IssueCommentDto[]>
	createComment(issueId: string, bodyText: string): Promise<IssueCommentDto>
	listRelations(issueId: string): Promise<IssueRelationDto[]>
	createRelation(issueId: string, targetIssueId: string, kind: RelationKind): Promise<IssueRelationDto>
	searchIssues(query: string): Promise<SearchHitDto[]>
	markAllNotificationsRead(): Promise<void>
	archiveNotification(notificationId: string): Promise<void>
	importDryRun(body: ImportDryRunBody): Promise<ImportDryRunPreviewDto>
	importExecute(body: ImportExecuteBody): Promise<ImportJobDto>
}

export interface BootstrappedWorkspace {
	readonly engine: HuriroSyncEngine
	readonly api: TaskApiBridge
	readonly workspaceName: string
	readonly currentUserId: string
	readonly isPreview: boolean
}

function createLiveApiBridge(workspaceId: string): TaskApiBridge {
	async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
		const res = await fetch(`${API_BASE}${path}`, {
			credentials: 'include',
			...init,
			headers: {
				'content-type': 'application/json',
				'x-workspace-id': workspaceId,
				'x-huriro-client': 'huriro-web',
				...init?.headers
			}
		})
		if (!res.ok) {
			throw new Error(`Request to ${path} failed (${res.status})`)
		}
		return (await res.json()) as T
	}

	return {
		async listMembers() {
			const res = await apiFetch<{
				data: { userId: string; displayName: string; email: string; roleKey: string }[]
			}>('/api/v1/members')
			return res.data.map((m) => ({
				userId: m.userId,
				displayName: m.displayName,
				email: m.email,
				role: m.roleKey
			}))
		},
		async listComments(issueId) {
			const data = await apiFetch<{ comments: IssueCommentDto[] }>(
				`/api/v1/issues/${encodeURIComponent(issueId)}`
			)
			return data.comments
		},
		async createComment(issueId, bodyText) {
			return apiFetch<IssueCommentDto>(`/api/v1/issues/${encodeURIComponent(issueId)}/comments`, {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify({ body: bodyText, bodyText })
			})
		},
		async listRelations(issueId) {
			const data = await apiFetch<{ relations: IssueRelationDto[] }>(
				`/api/v1/issues/${encodeURIComponent(issueId)}`
			)
			return data.relations
		},
		async createRelation(issueId, targetIssueId, kind) {
			return apiFetch<IssueRelationDto>(`/api/v1/issues/${encodeURIComponent(issueId)}/relations`, {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify({ targetIssueId, kind })
			})
		},
		async searchIssues(query) {
			const data = await apiFetch<SearchResponse>(`/api/v1/search?q=${encodeURIComponent(query)}`)
			return data.hits
		},
		async markAllNotificationsRead() {
			await apiFetch('/api/v1/notifications/read-all', {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() }
			})
		},
		async archiveNotification(notificationId) {
			await apiFetch(`/api/v1/notifications/${encodeURIComponent(notificationId)}/archive`, {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() }
			})
		},
		async importDryRun(body) {
			return apiFetch<ImportDryRunPreviewDto>('/api/v1/imports/dry-run', {
				method: 'POST',
				body: JSON.stringify(body)
			})
		},
		async importExecute(body) {
			return apiFetch<ImportJobDto>('/api/v1/imports/execute', {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify(body)
			})
		}
	}
}

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
			dueDate: null,
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
			dueDate: null,
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
			dueDate: null,
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
		notifications
	}
}

export function createPreviewApiBridge(engine: HuriroSyncEngine): TaskApiBridge {
	const commentsByIssue = new Map<string, IssueCommentDto[]>()
	const relationsByIssue = new Map<string, IssueRelationDto[]>()

	return {
		async listMembers() {
			return [
				{
					userId: PREVIEW_USER_ID,
					displayName: 'Hagen (Owner)',
					email: 'hagen@huriro.local',
					role: 'owner'
				}
			]
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

			return engine.collections.issues.toArray
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
				.slice(0, 20)
				.map((issue) => ({
					entityType: 'issue' as const,
					entityId: issue.id,
					projectId: issue.projectId,
					identifier: issue.identifier,
					title: issue.title,
					snippet: issue.descriptionText.slice(0, 120),
					score: targetIdentifier === issue.identifier ? 1 : 0.8,
					deepLink: `/issues/${issue.identifier}`,
					updatedAt: issue.updatedAt
				}))
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
			const payload = body.source === 'linear' ? body.linear : body.github
			const issues = payload?.issues ?? []
			const comments = issues.reduce((acc, i) => acc + (i.comments?.length ?? 0), 0)
			const labels = new Set<string>()
			for (const issue of issues) {
				for (const l of issue.labels ?? []) labels.add(l)
			}
			return {
				jobId: generateUuidV7(),
				source: body.source,
				projectKey: payload?.projectKey ?? 'IMP',
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
			const src = body.source ?? (body.linear ? 'linear' : 'github')
			const payload = src === 'linear' ? body.linear : body.github
			const projectKey = payload?.projectKey ?? 'IMP'
			const project = await engine.createProject({
				key: projectKey,
				name: payload?.projectName ?? projectKey,
				visibility: 'workspace'
			})
			const now = new Date().toISOString()
			const issues = payload?.issues ?? []
			let importedIssues = 0
			let importedComments = 0
			for (const item of issues) {
				const descriptionText =
					'description' in item ? (item.description ?? '') : 'body' in item ? (item.body ?? '') : ''
				await engine.createIssue({
					projectId: project.id,
					title: item.title,
					descriptionText
				})
				importedIssues += 1
				importedComments += item.comments?.length ?? 0
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
		}
	}
}

export async function createPreviewWorkspace(
	storage = new MemoryReplicaStorage()
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
		api: createPreviewApiBridge(engine),
		workspaceName: 'Huriro Preview',
		currentUserId: PREVIEW_USER_ID,
		isPreview: true
	}
}

/**
 * Connect to live `/api/v1/workspaces/current` if authenticated; otherwise fall back
 * immediately to the offline-first preview workspace without blocking.
 */
export async function bootstrapWorkspace(): Promise<BootstrappedWorkspace> {
	try {
		const res = await fetch(`${API_BASE}/api/v1/workspaces/current`, {
			credentials: 'include',
			headers: { 'x-huriro-client': 'huriro-web' }
		})
		if (res.ok) {
			const payload = (await res.json()) as {
				data: { id: string; slug: string; name: string; roleKey: string }[]
			}
			const workspace = payload.data[0]
			if (workspace) {
				let userId = PREVIEW_USER_ID
				try {
					const sessionRes = await fetch(`${API_BASE}/api/auth/get-session`, {
						credentials: 'include'
					})
					if (sessionRes.ok) {
						const sessionJson = (await sessionRes.json()) as { user?: { id?: string } }
						if (sessionJson.user?.id) userId = sessionJson.user.id
					}
				} catch {
					// Keep fallback id
				}

				const api = createLiveApiBridge(workspace.id)
				if (userId === PREVIEW_USER_ID) {
					const members = await api.listMembers().catch(() => [])
					if (members[0]?.userId) userId = members[0].userId
				}

				const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
				const wsUrl = env.VITE_WS_URL ?? `${proto}//${window.location.host}/ws`
				const transport = new HttpSyncTransport({ workspaceId: workspace.id })
				const engine = new HuriroSyncEngine({
					workspaceId: workspace.id,
					currentUserId: userId,
					transport,
					wsUrl,
					useRealtimeTicket: true
				})
				await engine.bootstrap()
				return {
					engine,
					api,
					workspaceName: workspace.name,
					currentUserId: userId,
					isPreview: false
				}
			}
		}
	} catch {
		// Fall through to offline preview mode when backend is not running.
	}

	return createPreviewWorkspace()
}
