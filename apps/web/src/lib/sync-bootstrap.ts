/**
 * Workspace bootstrap & auxiliary HTTP/preview API bridge.
 *
 * Online: attaches `HttpSyncTransport` + `WsSignalClient` to live server endpoints.
 * Standalone preview / unit tests (no authenticated server): seeds an offline-first
 * local preview replica so all M1 workflows operate without blocking spinners (§9.5).
 */
import type {
	CollabTicketResponse,
	CreateDocCommentBody,
	DocCommentDto,
	DocExportMarkdownResponse,
	DocImportMarkdownBody,
	DocPageDetailDto,
	DocPageDto,
	DocVersionDetailDto,
	DocVersionDto,
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
	SearchResponse,
	UpdateDocCommentBody
} from '@huriro/contracts'
import { parseSearchQuery } from '@huriro/domain'
import {
	diffVersionText,
	extractDocumentContent,
	markdownToProseMirrorJson,
	prosemirrorJsonToYDoc,
	ydocToMarkdown
} from '@huriro/editor'
import {
	generateUuidV7,
	HttpSyncTransport,
	HuriroSyncEngine,
	MemoryReplicaStorage
} from '@huriro/sync-client'
import * as Y from 'yjs'
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

export interface ResourceAclItemDto {
	readonly id: string
	readonly principalType: 'user' | 'role' | 'workspace'
	readonly principalId: string | null
	readonly permission: 'read' | 'comment' | 'write' | 'manage'
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
	// Docs & ACLs
	getDocBySlug(slug: string): Promise<DocPageDetailDto>
	getDocDetail(pageId: string): Promise<DocPageDetailDto>
	issueCollabTicket(pageId: string): Promise<CollabTicketResponse>
	setDocFavorite(pageId: string, favorite: boolean): Promise<DocPageDto>
	splitDocPage(pageId: string, title: string, headingBlockId?: string, markdown?: string): Promise<DocPageDto>
	exportDocMarkdown(pageId: string): Promise<DocExportMarkdownResponse>
	importDocMarkdown(body: DocImportMarkdownBody): Promise<DocPageDto>
	listDocVersions(pageId: string): Promise<DocVersionDto[]>
	createDocVersion(pageId: string, label: string): Promise<DocVersionDto>
	getDocVersionDetail(pageId: string, versionId: string): Promise<DocVersionDetailDto>
	restoreDocVersion(
		pageId: string,
		versionId: string,
		label?: string
	): Promise<{ readonly detail: DocPageDetailDto; readonly checkpointVersion: DocVersionDto }>
	createDocComment(pageId: string, body: CreateDocCommentBody): Promise<DocCommentDto>
	updateDocComment(pageId: string, commentId: string, body: UpdateDocCommentBody): Promise<DocCommentDto>
	resolveDocComment(pageId: string, commentId: string, resolved: boolean): Promise<DocCommentDto>
	deleteDocComment(pageId: string, commentId: string): Promise<void>
	listResourceAcls(resourceType: 'project' | 'doc_page', resourceId: string): Promise<ResourceAclItemDto[]>
	grantResourceAcl(input: {
		readonly resourceType: 'project' | 'doc_page'
		readonly resourceId: string
		readonly principalType: 'user' | 'role' | 'workspace'
		readonly principalId: string | null
		readonly permission: 'read' | 'comment' | 'write' | 'manage'
	}): Promise<ResourceAclItemDto>
	revokeResourceAcl(aclId: string): Promise<void>
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
		},
		async getDocBySlug(slug) {
			return apiFetch<DocPageDetailDto>(`/api/v1/docs/by-slug/${encodeURIComponent(slug)}`)
		},
		async getDocDetail(pageId) {
			return apiFetch<DocPageDetailDto>(`/api/v1/docs/${encodeURIComponent(pageId)}`)
		},
		async issueCollabTicket(pageId) {
			return apiFetch<CollabTicketResponse>(`/api/v1/docs/${encodeURIComponent(pageId)}/collab-ticket`, {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() }
			})
		},
		async setDocFavorite(pageId, favorite) {
			const res = await apiFetch<{ data: DocPageDto }>(
				`/api/v1/docs/${encodeURIComponent(pageId)}/favorite`,
				{
					method: favorite ? 'POST' : 'DELETE',
					headers: { 'idempotency-key': generateUuidV7() }
				}
			)
			return res.data
		},
		async splitDocPage(pageId, title, headingBlockId, markdown) {
			return apiFetch<DocPageDto>(`/api/v1/docs/${encodeURIComponent(pageId)}/split`, {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify({
					title,
					...(headingBlockId ? { headingBlockId } : {}),
					...(markdown ? { markdown } : {})
				})
			})
		},
		async exportDocMarkdown(pageId) {
			return apiFetch<DocExportMarkdownResponse>(
				`/api/v1/docs/${encodeURIComponent(pageId)}/export?format=markdown`
			)
		},
		async importDocMarkdown(body) {
			return apiFetch<DocPageDto>('/api/v1/docs/import/markdown', {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify(body)
			})
		},
		async listDocVersions(pageId) {
			const res = await apiFetch<{ data: DocVersionDto[] }>(
				`/api/v1/docs/${encodeURIComponent(pageId)}/versions`
			)
			return res.data
		},
		async createDocVersion(pageId, label) {
			return apiFetch<DocVersionDto>(`/api/v1/docs/${encodeURIComponent(pageId)}/versions`, {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify({ label })
			})
		},
		async getDocVersionDetail(pageId, versionId) {
			return apiFetch<DocVersionDetailDto>(
				`/api/v1/docs/${encodeURIComponent(pageId)}/versions/${encodeURIComponent(versionId)}`
			)
		},
		async restoreDocVersion(pageId, versionId, label) {
			return apiFetch<{ readonly detail: DocPageDetailDto; readonly checkpointVersion: DocVersionDto }>(
				`/api/v1/docs/${encodeURIComponent(pageId)}/versions/${encodeURIComponent(versionId)}/restore`,
				{
					method: 'POST',
					headers: { 'idempotency-key': generateUuidV7() },
					body: JSON.stringify(label ? { label } : {})
				}
			)
		},
		async createDocComment(pageId, body) {
			return apiFetch<DocCommentDto>(`/api/v1/docs/${encodeURIComponent(pageId)}/comments`, {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify(body)
			})
		},
		async updateDocComment(pageId, commentId, body) {
			return apiFetch<DocCommentDto>(
				`/api/v1/docs/${encodeURIComponent(pageId)}/comments/${encodeURIComponent(commentId)}`,
				{ method: 'PATCH', body: JSON.stringify(body) }
			)
		},
		async resolveDocComment(pageId, commentId, resolved) {
			return apiFetch<DocCommentDto>(
				`/api/v1/docs/${encodeURIComponent(pageId)}/comments/${encodeURIComponent(commentId)}/resolve`,
				{ method: 'POST', body: JSON.stringify({ resolved }) }
			)
		},
		async deleteDocComment(pageId, commentId) {
			await apiFetch(`/api/v1/docs/${encodeURIComponent(pageId)}/comments/${encodeURIComponent(commentId)}`, {
				method: 'DELETE'
			})
		},
		async listResourceAcls(resourceType, resourceId) {
			const res = await apiFetch<{ data: ResourceAclItemDto[] }>(
				`/api/v1/acl?resourceType=${encodeURIComponent(resourceType)}&resourceId=${encodeURIComponent(resourceId)}`
			)
			return res.data
		},
		async grantResourceAcl(input) {
			return apiFetch<ResourceAclItemDto>('/api/v1/acl', {
				method: 'POST',
				headers: { 'idempotency-key': generateUuidV7() },
				body: JSON.stringify(input)
			})
		},
		async revokeResourceAcl(aclId) {
			await apiFetch(`/api/v1/acl/${encodeURIComponent(aclId)}`, { method: 'DELETE' })
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

export function createPreviewApiBridge(engine: HuriroSyncEngine): TaskApiBridge {
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

			return [...issueHits, ...docHits]
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
			const now = new Date().toISOString()
			const src =
				body.source ??
				(body.notion ? 'notion' : body.markdown ? 'markdown' : body.linear ? 'linear' : 'github')
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
			const payload = src === 'linear' ? body.linear : body.github
			const projectKey = payload?.projectKey ?? 'IMP'
			const project = await engine.createProject({
				key: projectKey,
				name: payload?.projectName ?? projectKey,
				visibility: 'workspace'
			})
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
		},
		async getDocBySlug(slug) {
			const page = engine.collections.docPages.toArray.find((p) => p.slug === slug && p.archivedAt === null)
			if (!page) throw new Error(`Document "${slug}" not found`)
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
			if (!page || page.archivedAt !== null) throw new Error('Document not found')
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
