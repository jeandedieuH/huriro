/**
 * HuriroSyncEngine — client replication & mutation coordinator (§9.5, §9.6).
 */
import type {
	CreateIssueBody,
	CreateProjectBody,
	CreateSavedViewBody,
	IssueDto,
	MoveIssueBody,
	MutationEnvelope,
	MutationResultDto,
	MutationsBatchResponse,
	ProjectDto,
	SavedViewDto,
	SyncChangesResponse,
	SyncSnapshotResponse,
	UpdateIssueBody
} from '@huriro/contracts'
import { generateKeyBetween } from '@huriro/domain'
import { HuriroSyncCollections, type PersistedReplicaState } from './collections'
import {
	generateUuidV7,
	HuriroMutationOutbox,
	type MutationTransport,
	type QueuedMutation,
	type SyncConflict
} from './outbox'
import {
	createBestReplicaStorage,
	MemoryReplicaStorage,
	type ReplicaStorage,
	type ReplicaStorageMode
} from './storage'
import { WsSignalClient } from './ws-signal'

const REPLICA_KEY = 'huriro:replica:v1'
const CLIENT_ID_KEY = 'huriro:client_id:v1'

export interface SyncTransport extends MutationTransport {
	fetchChanges(since: number, limit: number, clientId: string): Promise<SyncChangesResponse>
	fetchSnapshot(scope?: string): Promise<SyncSnapshotResponse>
	fetchRealtimeTicket?(deviceId: string): Promise<{ ticket: string }>
}

export class HttpSyncTransport implements SyncTransport {
	private readonly baseUrl: string
	private readonly workspaceId: string
	private readonly getHeaders: (() => Record<string, string>) | undefined

	constructor(args: {
		readonly baseUrl?: string | undefined
		readonly workspaceId: string
		readonly getHeaders?: (() => Record<string, string>) | undefined
	}) {
		this.baseUrl = (args.baseUrl ?? '').replace(/\/$/, '')
		this.workspaceId = args.workspaceId
		this.getHeaders = args.getHeaders
	}

	private buildHeaders(extra?: Record<string, string>): Record<string, string> {
		return {
			'content-type': 'application/json',
			'x-workspace-id': this.workspaceId,
			'x-huriro-client': 'huriro-web',
			...(this.getHeaders ? this.getHeaders() : {}),
			...extra
		}
	}

	async fetchChanges(since: number, limit: number, clientId: string): Promise<SyncChangesResponse> {
		const url = `${this.baseUrl}/api/v1/sync/changes?since=${since}&limit=${limit}&clientId=${encodeURIComponent(clientId)}`
		const res = await fetch(url, { credentials: 'include', headers: this.buildHeaders() })
		if (res.status === 410) {
			const err = new Error('sync_cursor_expired') as Error & { status?: number }
			err.status = 410
			throw err
		}
		if (!res.ok) {
			const err = new Error(`sync/changes failed (${res.status})`) as Error & { status?: number }
			err.status = res.status
			throw err
		}
		return (await res.json()) as SyncChangesResponse
	}

	async fetchSnapshot(scope?: string): Promise<SyncSnapshotResponse> {
		const qs = scope ? `?scope=${encodeURIComponent(scope)}` : ''
		const res = await fetch(`${this.baseUrl}/api/v1/sync/snapshot${qs}`, {
			credentials: 'include',
			headers: this.buildHeaders()
		})
		if (!res.ok) {
			const err = new Error(`sync/snapshot failed (${res.status})`) as Error & { status?: number }
			err.status = res.status
			throw err
		}
		return (await res.json()) as SyncSnapshotResponse
	}

	async sendBatch(mutations: readonly MutationEnvelope[]): Promise<MutationsBatchResponse> {
		const idempotencyKey = mutations[0]?.mutationId ?? generateUuidV7()
		const res = await fetch(`${this.baseUrl}/api/v1/mutations`, {
			method: 'POST',
			credentials: 'include',
			headers: this.buildHeaders({ 'idempotency-key': idempotencyKey }),
			body: JSON.stringify({ mutations })
		})
		if (!res.ok) {
			const err = new Error(`mutations failed (${res.status})`) as Error & { status?: number }
			err.status = res.status
			throw err
		}
		return (await res.json()) as MutationsBatchResponse
	}

	async fetchRealtimeTicket(deviceId: string): Promise<{ ticket: string }> {
		const res = await fetch(`${this.baseUrl}/api/v1/realtime/ticket`, {
			method: 'POST',
			credentials: 'include',
			headers: this.buildHeaders(),
			body: JSON.stringify({ deviceId })
		})
		if (!res.ok) throw new Error(`ticket failed (${res.status})`)
		return (await res.json()) as { ticket: string }
	}
}

export interface SyncEngineStatus {
	readonly cursor: number
	readonly online: boolean
	readonly wsConnected: boolean
	readonly syncing: boolean
	readonly pendingCount: number
	readonly conflictCount: number
	readonly storageMode: ReplicaStorageMode
	readonly lastError: string | null
	readonly revokedReason: string | null
}

export interface HuriroSyncEngineOptions {
	readonly workspaceId: string
	readonly currentUserId: string
	readonly transport?: SyncTransport | undefined
	readonly storage?: ReplicaStorage | undefined
	readonly wsUrl?: string | undefined
	readonly pollIntervalMs?: number | undefined
	readonly useRealtimeTicket?: boolean | undefined
	readonly onMutationRejected?: ((error: string) => void) | undefined
	readonly onSessionInvalid?: (() => void) | undefined
}

export class HuriroSyncEngine {
	readonly workspaceId: string
	readonly currentUserId: string
	readonly collections = new HuriroSyncCollections()
	private storage: ReplicaStorage
	private outbox: HuriroMutationOutbox
	private readonly transport: SyncTransport | null
	private readonly wsUrl: string | undefined
	private readonly pollIntervalMs: number | undefined
	private readonly useRealtimeTicket: boolean
	private readonly onMutationRejected: ((error: string) => void) | undefined
	private readonly onSessionInvalid: (() => void) | undefined

	private wsClient: WsSignalClient | null = null
	private cursor = 0
	private clientId = generateUuidV7()
	private online =
		typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? navigator.onLine : true
	private wsConnected = false
	private syncing = false
	private lastError: string | null = null
	private revokedReason: string | null = null
	private disposed = false
	private syncPromise: Promise<void> | null = null
	private listeners = new Set<() => void>()
	private cachedStatus: SyncEngineStatus | null = null
	private onlineHandler: (() => void) | null = null
	private offlineHandler: (() => void) | null = null

	constructor(opts: HuriroSyncEngineOptions) {
		this.workspaceId = opts.workspaceId
		this.currentUserId = opts.currentUserId
		this.storage = opts.storage ?? new MemoryReplicaStorage()
		this.outbox = new HuriroMutationOutbox(this.storage)
		this.transport = opts.transport ?? null
		this.wsUrl = opts.wsUrl
		this.pollIntervalMs = opts.pollIntervalMs
		this.useRealtimeTicket = opts.useRealtimeTicket ?? false
		this.onMutationRejected = opts.onMutationRejected
		this.onSessionInvalid = opts.onSessionInvalid
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}

	private emit(): void {
		for (const l of this.listeners) l()
	}

	getStatus(): SyncEngineStatus {
		const pendingCount = this.outbox.getPendingCount()
		const conflictCount = this.outbox.getConflicts().length
		if (
			this.cachedStatus &&
			this.cachedStatus.cursor === this.cursor &&
			this.cachedStatus.online === this.online &&
			this.cachedStatus.wsConnected === this.wsConnected &&
			this.cachedStatus.syncing === this.syncing &&
			this.cachedStatus.pendingCount === pendingCount &&
			this.cachedStatus.conflictCount === conflictCount &&
			this.cachedStatus.storageMode === this.storage.mode &&
			this.cachedStatus.lastError === this.lastError &&
			this.cachedStatus.revokedReason === this.revokedReason
		) {
			return this.cachedStatus
		}
		this.cachedStatus = {
			cursor: this.cursor,
			online: this.online,
			wsConnected: this.wsConnected,
			syncing: this.syncing,
			pendingCount,
			conflictCount,
			storageMode: this.storage.mode,
			lastError: this.lastError,
			revokedReason: this.revokedReason
		}
		return this.cachedStatus
	}

	getConflicts(): readonly SyncConflict[] {
		return this.outbox.getConflicts()
	}

	getPendingMutationIds(): ReadonlySet<string> {
		return new Set(this.outbox.getPendingMutations().map((m) => m.envelope.entityId))
	}

	async bootstrap(opts?: { readonly skipNetwork?: boolean }): Promise<void> {
		if (this.storage.mode === 'memory' && !opts?.skipNetwork) {
			// Only upgrade storage if caller didn't inject an explicit ReplicaStorage.
			const best = await createBestReplicaStorage(this.workspaceId)
			if (best.mode !== 'memory') {
				this.storage = best
				this.outbox = new HuriroMutationOutbox(best)
			}
		}

		// Step 1: Hydrate local replica + client id + outbox immediately (no spinners, §9.5).
		const savedClientId = await this.storage.get(CLIENT_ID_KEY)
		if (savedClientId) {
			this.clientId = savedClientId
		} else {
			await this.storage.set(CLIENT_ID_KEY, this.clientId)
		}

		const rawReplica = await this.storage.get(REPLICA_KEY)
		if (rawReplica) {
			try {
				const parsed = JSON.parse(rawReplica) as PersistedReplicaState
				this.cursor = parsed.cursor ?? 0
				this.collections.applyFullSnapshot(parsed)
			} catch {
				this.collections.markAllReady()
			}
		} else {
			this.collections.markAllReady()
		}

		await this.outbox.load()
		this.reapplyPendingOptimisticState()
		this.emit()

		if (typeof window !== 'undefined') {
			this.onlineHandler = () => {
				this.setOnline(true)
			}
			this.offlineHandler = () => {
				this.setOnline(false)
			}
			window.addEventListener('online', this.onlineHandler)
			window.addEventListener('offline', this.offlineHandler)
		}

		if (opts?.skipNetwork || !this.transport) return

		const fetchTicket = this.transport.fetchRealtimeTicket
		this.wsClient = new WsSignalClient({
			workspaceId: this.workspaceId,
			wsUrl: this.wsUrl,
			getCursor: () => this.cursor,
			getTicket:
				this.useRealtimeTicket && fetchTicket
					? async () => (await fetchTicket(this.clientId)).ticket
					: undefined,
			onCursorSignal: (remoteCursor) => {
				if (remoteCursor > this.cursor) {
					void this.syncNow()
				}
			},
			onRevokeSignal: (reason) => {
				void this.handleRevocation(reason)
			},
			onPollFallback: () => {
				if (this.online) void this.syncNow()
			},
			onConnectionChange: (connected) => {
				this.wsConnected = connected
				this.emit()
			},
			...(this.pollIntervalMs !== undefined ? { pollIntervalMs: this.pollIntervalMs } : {})
		})
		this.wsClient.start()

		if (this.online) {
			await this.flushOutbox()
			await this.syncNow()
		}
	}

	private reapplyPendingOptimisticState(): void {
		for (const item of this.outbox.getPendingMutations()) {
			const { envelope } = item
			if (envelope.entity === 'issue') {
				if (envelope.op === 'delete') {
					this.collections.issuesManaged.deleteMany([envelope.entityId])
				} else if (envelope.op === 'create') {
					const proj = this.collections.projects.get(String(envelope.patch['projectId'] ?? ''))
					const nowIso = envelope.queuedAt ?? new Date().toISOString()
					const synthetic: IssueDto = {
						id: envelope.entityId,
						workspaceId: this.workspaceId,
						projectId: String(envelope.patch['projectId'] ?? ''),
						projectKey: proj?.key ?? 'TMP',
						number: 0,
						identifier: `${proj?.key ?? 'TMP'}-…`,
						parentId: (envelope.patch['parentId'] as string | null) ?? null,
						cycleId: (envelope.patch['cycleId'] as string | null) ?? null,
						title: String(envelope.patch['title'] ?? ''),
						description: envelope.patch['description'] ?? null,
						descriptionText: String(envelope.patch['descriptionText'] ?? ''),
						statusId: String(envelope.patch['statusId'] ?? ''),
						priority: Number(envelope.patch['priority'] ?? 0),
						assigneeType: (envelope.patch['assigneeType'] as 'user' | 'agent' | null) ?? null,
						assigneeId: (envelope.patch['assigneeId'] as string | null) ?? null,
						creatorId: this.currentUserId,
						position: String(envelope.patch['position'] ?? 'V'),
						startDate: null,
						dueDate: null,
						estimate: null,
						closedAt: null,
						labelIds: (envelope.patch['labelIds'] as string[]) ?? [],
						createdAt: nowIso,
						updatedAt: nowIso,
						deletedAt: null,
						version: 1
					}
					this.collections.issuesManaged.upsertMany([synthetic])
				} else {
					const existing = this.collections.issues.get(envelope.entityId)
					if (existing) {
						this.collections.issuesManaged.upsertMany([
							{ ...existing, ...envelope.patch, updatedAt: new Date().toISOString() }
						])
					}
				}
			}
		}
	}

	setOnline(online: boolean): void {
		this.online = online
		this.emit()
		if (online && this.transport) {
			void this.flushOutbox().then(() => this.syncNow())
		}
	}

	async syncNow(): Promise<void> {
		if (!this.transport || !this.online || this.disposed) return
		if (this.syncPromise) return this.syncPromise

		this.syncPromise = this.runSync().finally(() => {
			this.syncPromise = null
		})
		return this.syncPromise
	}

	private async runSync(): Promise<void> {
		if (!this.transport) return
		this.syncing = true
		this.lastError = null
		this.emit()

		try {
			if (this.cursor === 0) {
				const snap = await this.transport.fetchSnapshot()
				this.collections.applyFullSnapshot(snap)
				this.cursor = snap.cursor
				await this.persistReplica()
				return
			}

			let hasMore = true
			while (hasMore && !this.disposed && this.online) {
				const page = await this.transport.fetchChanges(this.cursor, 500, this.clientId)
				if (page.changes.length > 0) {
					const { grantScopes } = this.collections.applyChanges(page.changes)
					for (const scope of grantScopes) {
						const scopedSnap = await this.transport.fetchSnapshot(scope)
						this.collections.applyScopedSnapshot(scopedSnap)
					}
				}
				this.cursor = page.nextCursor
				hasMore = page.hasMore
			}
			await this.persistReplica()
		} catch (err) {
			const status = (err as { status?: number }).status
			if (status === 401) {
				await this.signOutAndWipe()
				this.onSessionInvalid?.()
				return
			}
			if (status === 410) {
				// Retention expired → full snapshot resync (§9.3).
				const snap = await this.transport.fetchSnapshot()
				this.collections.applyFullSnapshot(snap)
				this.cursor = snap.cursor
				await this.persistReplica()
				return
			}
			this.lastError = err instanceof Error ? err.message : 'Sync failed'
		} finally {
			this.syncing = false
			this.emit()
		}
	}

	async flushOutbox(): Promise<void> {
		if (!this.transport || !this.online || this.disposed) return
		const { cursor } = await this.outbox.flush(this.transport, {
			onApplied: (item, result) => {
				this.applyAuthoritativeResult(item, result)
			},
			onConflict: () => {
				this.emit()
			},
			onRejected: (item, _status, error) => {
				this.rollbackOptimistic(item)
				this.onMutationRejected?.(error)
			}
		})
		if (cursor !== null && cursor > this.cursor) {
			this.wsClient?.broadcastCursor(cursor)
			await this.syncNow()
		}
		await this.persistReplica()
		this.emit()
	}

	private applyAuthoritativeResult(item: QueuedMutation, result: MutationResultDto): void {
		if (!result.data) return
		const { entity, entityId, op } = item.envelope
		if (entity === 'issue') {
			if (op === 'delete') {
				this.collections.issuesManaged.deleteMany([entityId])
			} else {
				this.collections.issuesManaged.upsertMany([result.data as unknown as IssueDto])
			}
		} else if (entity === 'project') {
			this.collections.projectsManaged.upsertMany([result.data as unknown as ProjectDto])
		} else if (entity === 'saved_view') {
			this.collections.viewsManaged.upsertMany([result.data as unknown as SavedViewDto])
		}
	}

	private rollbackOptimistic(item: QueuedMutation): void {
		const { entity, entityId, op } = item.envelope
		if (entity === 'issue') {
			if (op === 'create') {
				this.collections.issuesManaged.deleteMany([entityId])
			} else if (item.base) {
				this.collections.issuesManaged.upsertMany([item.base as unknown as IssueDto])
			}
		} else if (entity === 'project') {
			if (op === 'create') {
				this.collections.projectsManaged.deleteMany([entityId])
			} else if (item.base) {
				this.collections.projectsManaged.upsertMany([item.base as unknown as ProjectDto])
			}
		}
	}

	async resolveConflict(
		conflictId: string,
		choice: 'keep_local' | 'keep_server' | Record<string, unknown>
	): Promise<void> {
		const { conflict, rebased } = await this.outbox.resolveConflict(conflictId, choice)
		if (conflict.entity === 'issue') {
			if (rebased === null) {
				this.collections.issuesManaged.upsertMany([conflict.serverValues as unknown as IssueDto])
			} else {
				this.collections.issuesManaged.upsertMany([
					{ ...(conflict.serverValues as unknown as IssueDto), ...rebased.patch }
				])
			}
		}
		await this.persistReplica()
		this.emit()
		if (rebased && this.online && this.transport) {
			await this.flushOutbox()
		}
	}

	// ---------- Optimistic client write operations ----------

	async createIssue(input: Omit<CreateIssueBody, 'id'> & { readonly id?: string }): Promise<IssueDto> {
		const id = input.id ?? generateUuidV7()
		const proj = this.collections.projects.get(input.projectId)
		const statuses = this.collections.projectStatuses.toArray
			.filter((s) => s.projectId === input.projectId)
			.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
		const statusId = input.statusId ?? statuses.find((s) => s.isDefault)?.id ?? statuses[0]?.id ?? ''
		const colIssues = this.collections.issues.toArray
			.filter((i) => i.projectId === input.projectId && i.statusId === statusId)
			.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
		const position = input.position ?? generateKeyBetween(colIssues.at(-1)?.position ?? null, null)
		const nowIso = new Date().toISOString()

		const optimistic: IssueDto = {
			id,
			workspaceId: this.workspaceId,
			projectId: input.projectId,
			projectKey: proj?.key ?? 'TMP',
			number: 0,
			identifier: `${proj?.key ?? 'TMP'}-…`,
			parentId: input.parentId ?? null,
			cycleId: input.cycleId ?? null,
			title: input.title,
			description: input.description ?? null,
			descriptionText: input.descriptionText ?? '',
			statusId,
			priority: input.priority ?? 0,
			assigneeType: input.assigneeId ? (input.assigneeType ?? 'user') : null,
			assigneeId: input.assigneeId ?? null,
			creatorId: this.currentUserId,
			position,
			startDate: input.startDate ?? null,
			dueDate: input.dueDate ?? null,
			estimate: input.estimate ?? null,
			closedAt: null,
			labelIds: input.labelIds ?? [],
			createdAt: nowIso,
			updatedAt: nowIso,
			deletedAt: null,
			version: 1
		}

		await this.outbox.enqueue({
			envelope: {
				mutationId: generateUuidV7(),
				workspaceId: this.workspaceId,
				entity: 'issue',
				entityId: id,
				op: 'create',
				patch: {
					projectId: input.projectId,
					title: input.title,
					descriptionText: input.descriptionText ?? '',
					statusId,
					priority: input.priority ?? 0,
					position,
					...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
					...(input.assigneeId !== undefined
						? { assigneeId: input.assigneeId, assigneeType: input.assigneeType ?? 'user' }
						: {}),
					...(input.labelIds !== undefined ? { labelIds: input.labelIds } : {})
				},
				queuedAt: nowIso
			},
			title: input.title
		})

		this.collections.issuesManaged.upsertMany([optimistic])
		await this.persistReplica()
		this.emit()

		if (this.online && this.transport) {
			void this.flushOutbox()
		}
		return optimistic
	}

	async updateIssue(issueId: string, patch: Omit<UpdateIssueBody, 'version'>): Promise<void> {
		const current = this.collections.issues.get(issueId)
		if (!current) throw new Error(`Issue "${issueId}" not found in local replica`)

		const optimistic: IssueDto = {
			...current,
			...(patch.title !== undefined ? { title: patch.title } : {}),
			...(patch.descriptionText !== undefined ? { descriptionText: patch.descriptionText } : {}),
			...(patch.statusId !== undefined ? { statusId: patch.statusId } : {}),
			...(patch.priority !== undefined ? { priority: patch.priority } : {}),
			...(patch.assigneeId !== undefined
				? {
						assigneeId: patch.assigneeId,
						assigneeType: patch.assigneeId === null ? null : (patch.assigneeType ?? 'user')
					}
				: {}),
			...(patch.position !== undefined ? { position: patch.position } : {}),
			...(patch.labelIds !== undefined ? { labelIds: patch.labelIds } : {}),
			updatedAt: new Date().toISOString()
		}

		await this.outbox.enqueue({
			envelope: {
				mutationId: generateUuidV7(),
				workspaceId: this.workspaceId,
				entity: 'issue',
				entityId: issueId,
				op: 'update',
				patch: patch as Record<string, unknown>,
				baseVersion: current.version,
				queuedAt: new Date().toISOString()
			},
			base: current as unknown as Record<string, unknown>,
			title: current.title
		})

		this.collections.issuesManaged.upsertMany([optimistic])
		await this.persistReplica()
		this.emit()

		if (this.online && this.transport) {
			void this.flushOutbox()
		}
	}

	async moveIssue(issueId: string, move: Omit<MoveIssueBody, 'version'>): Promise<void> {
		const current = this.collections.issues.get(issueId)
		if (!current) throw new Error(`Issue "${issueId}" not found in local replica`)

		const targetStatusId = move.statusId ?? current.statusId
		let position = move.position
		if (!position) {
			const afterPos = move.afterIssueId
				? (this.collections.issues.get(move.afterIssueId)?.position ?? null)
				: null
			const beforePos = move.beforeIssueId
				? (this.collections.issues.get(move.beforeIssueId)?.position ?? null)
				: null
			if (afterPos === null && beforePos === null) {
				const tail =
					this.collections.issues.toArray
						.filter(
							(i) => i.projectId === current.projectId && i.statusId === targetStatusId && i.id !== issueId
						)
						.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
						.at(-1)?.position ?? null
				position = generateKeyBetween(tail, null)
			} else {
				position = generateKeyBetween(afterPos, beforePos)
			}
		}

		const optimistic: IssueDto = {
			...current,
			statusId: targetStatusId,
			position,
			updatedAt: new Date().toISOString()
		}

		await this.outbox.enqueue({
			envelope: {
				mutationId: generateUuidV7(),
				workspaceId: this.workspaceId,
				entity: 'issue',
				entityId: issueId,
				op: 'move',
				patch: {
					statusId: targetStatusId,
					position,
					...(move.afterIssueId !== undefined ? { afterIssueId: move.afterIssueId } : {}),
					...(move.beforeIssueId !== undefined ? { beforeIssueId: move.beforeIssueId } : {})
				},
				baseVersion: current.version,
				queuedAt: new Date().toISOString()
			},
			base: current as unknown as Record<string, unknown>,
			title: current.title
		})

		this.collections.issuesManaged.upsertMany([optimistic])
		await this.persistReplica()
		this.emit()

		if (this.online && this.transport) {
			void this.flushOutbox()
		}
	}

	async deleteIssue(issueId: string): Promise<void> {
		const current = this.collections.issues.get(issueId)
		if (!current) return
		await this.outbox.enqueue({
			envelope: {
				mutationId: generateUuidV7(),
				workspaceId: this.workspaceId,
				entity: 'issue',
				entityId: issueId,
				op: 'delete',
				patch: {},
				baseVersion: current.version,
				queuedAt: new Date().toISOString()
			},
			base: current as unknown as Record<string, unknown>,
			title: current.title
		})
		this.collections.issuesManaged.deleteMany([issueId])
		await this.persistReplica()
		this.emit()
		if (this.online && this.transport) {
			void this.flushOutbox()
		}
	}

	async createProject(input: Omit<CreateProjectBody, 'id'> & { readonly id?: string }): Promise<ProjectDto> {
		const id = input.id ?? generateUuidV7()
		const tail =
			this.collections.projects.toArray
				.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
				.at(-1)?.position ?? null
		const position = input.position ?? generateKeyBetween(tail, null)
		const nowIso = new Date().toISOString()
		const optimistic: ProjectDto = {
			id,
			workspaceId: this.workspaceId,
			key: input.key,
			name: input.name,
			description: input.description ?? '',
			visibility: input.visibility ?? 'workspace',
			position,
			archivedAt: null,
			createdBy: this.currentUserId,
			createdAt: nowIso,
			updatedAt: nowIso,
			version: 1
		}
		await this.outbox.enqueue({
			envelope: {
				mutationId: generateUuidV7(),
				workspaceId: this.workspaceId,
				entity: 'project',
				entityId: id,
				op: 'create',
				patch: {
					key: input.key,
					name: input.name,
					description: input.description ?? '',
					visibility: input.visibility ?? 'workspace',
					position
				},
				queuedAt: nowIso
			},
			title: input.name
		})
		this.collections.projectsManaged.upsertMany([optimistic])
		await this.persistReplica()
		this.emit()
		if (this.online && this.transport) void this.flushOutbox()
		return optimistic
	}

	async createSavedView(input: Omit<CreateSavedViewBody, 'id'>): Promise<SavedViewDto> {
		const id = generateUuidV7()
		const tail =
			this.collections.savedViews.toArray
				.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
				.at(-1)?.position ?? null
		const position = input.position ?? generateKeyBetween(tail, null)
		const nowIso = new Date().toISOString()
		const optimistic: SavedViewDto = {
			id,
			workspaceId: this.workspaceId,
			projectId: input.projectId ?? null,
			ownerUserId: this.currentUserId,
			name: input.name,
			layout: input.layout ?? 'list',
			filters: input.filters ?? {},
			sort: input.sort ?? {},
			isShared: input.isShared ?? false,
			position,
			createdAt: nowIso,
			updatedAt: nowIso,
			version: 1
		}
		await this.outbox.enqueue({
			envelope: {
				mutationId: generateUuidV7(),
				workspaceId: this.workspaceId,
				entity: 'saved_view',
				entityId: id,
				op: 'create',
				patch: input as Record<string, unknown>,
				queuedAt: nowIso
			},
			title: input.name
		})
		this.collections.viewsManaged.upsertMany([optimistic])
		await this.persistReplica()
		this.emit()
		if (this.online && this.transport) void this.flushOutbox()
		return optimistic
	}

	async markNotificationRead(notificationId: string): Promise<void> {
		const current = this.collections.notifications.get(notificationId)
		if (!current || current.readAt !== null) return
		const nowIso = new Date().toISOString()
		this.collections.notificationsManaged.upsertMany([{ ...current, readAt: nowIso }])
		await this.outbox.enqueue({
			envelope: {
				mutationId: generateUuidV7(),
				workspaceId: this.workspaceId,
				entity: 'notification',
				entityId: notificationId,
				op: 'mark_read',
				patch: {},
				queuedAt: nowIso
			},
			base: current as unknown as Record<string, unknown>,
			title: current.title
		})
		await this.persistReplica()
		this.emit()
		if (this.online && this.transport) void this.flushOutbox()
	}

	private async handleRevocation(reason: string): Promise<void> {
		this.revokedReason = reason
		await this.outbox.clearAll()
		this.collections.clearAll()
		await this.persistReplica()
		this.emit()
	}

	async persistReplica(): Promise<void> {
		const state = this.collections.exportState(this.cursor)
		await this.storage.set(REPLICA_KEY, JSON.stringify(state))
	}

	async signOutAndWipe(): Promise<void> {
		this.dispose()
		await this.outbox.clearAll()
		this.collections.clearAll()
		await this.storage.clear()
		this.cursor = 0
		this.emit()
	}

	dispose(): void {
		this.disposed = true
		this.wsClient?.stop()
		this.wsClient = null
		if (typeof window !== 'undefined') {
			if (this.onlineHandler) window.removeEventListener('online', this.onlineHandler)
			if (this.offlineHandler) window.removeEventListener('offline', this.offlineHandler)
		}
	}
}
