/**
 * HuriroSyncEngine — client replication & mutation coordinator (§9.5, §9.6).
 */
import type {
	CreateDocPageBody,
	CreateIssueBody,
	CreateProjectBody,
	CreateSavedViewBody,
	DocPageDto,
	IssueDto,
	MoveDocPageBody,
	MoveIssueBody,
	MutationEnvelope,
	MutationResultDto,
	MutationsBatchResponse,
	NotificationDto,
	ProjectDto,
	SavedViewDto,
	SyncChangesResponse,
	SyncSnapshotResponse,
	UpdateDocPageBody,
	UpdateIssueBody
} from '@huriro/contracts'
import { generateKeyBetween } from '@huriro/domain'
import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios'
import { HuriroSyncCollections, type PersistedReplicaState, REPLICA_SCHEMA_VERSION } from './collections'
import {
	type FlushOptions,
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

function formatHttpError(label: string, status: number, data: unknown): Error & { status?: number } {
	const body = data && typeof data === 'object' ? (data as { detail?: unknown; title?: unknown }) : null
	const detail =
		typeof body?.detail === 'string' && body.detail.trim().length > 0
			? body.detail.trim()
			: typeof body?.title === 'string' && body.title.trim().length > 0
				? body.title.trim()
				: null
	const err = new Error(detail ? `${detail} (${status})` : `${label} (${status})`) as Error & {
		status?: number
	}
	err.status = status
	return err
}

function hasPersistedReplicaShape(state: PersistedReplicaState): boolean {
	return (
		Array.isArray(state.projects) &&
		Array.isArray(state.projectStatuses) &&
		Array.isArray(state.labels) &&
		Array.isArray(state.cycles) &&
		Array.isArray(state.issues) &&
		Array.isArray(state.savedViews) &&
		Array.isArray(state.notifications) &&
		(state.docPages === undefined || Array.isArray(state.docPages))
	)
}

export class HttpSyncTransport implements SyncTransport {
	private readonly baseUrl: string
	private readonly workspaceId: string
	private readonly getHeaders: (() => Record<string, string>) | undefined
	private readonly clientName: string
	private readonly http: AxiosInstance

	constructor(args: {
		readonly baseUrl?: string | undefined
		readonly workspaceId: string
		readonly getHeaders?: (() => Record<string, string>) | undefined
		readonly clientName?: string | undefined
		readonly credentials?: RequestCredentials | undefined
		/** Test seam — injects a custom axios adapter instead of real network I/O. */
		readonly httpAdapter?: AxiosRequestConfig['adapter'] | undefined
	}) {
		this.baseUrl = (args.baseUrl ?? '').replace(/\/$/, '')
		this.workspaceId = args.workspaceId
		this.getHeaders = args.getHeaders
		this.clientName = args.clientName ?? 'huriro-web'
		const credentials = args.credentials ?? 'include'
		this.http = axios.create({
			// fetch `credentials: 'include'` ⇔ axios `withCredentials: true`
			// ('same-origin' is the axios/XHR default for same-origin requests).
			withCredentials: credentials === 'include',
			// fetch resolves on any HTTP status — keep that contract so the
			// status-based branching below stays identical.
			validateStatus: () => true,
			...(args.httpAdapter ? { adapter: args.httpAdapter } : {})
		})
	}

	private buildHeaders(extra?: Record<string, string>): Record<string, string> {
		return {
			'content-type': 'application/json',
			'x-workspace-id': this.workspaceId,
			'x-huriro-client': this.clientName,
			...(this.getHeaders ? this.getHeaders() : {}),
			...extra
		}
	}

	async fetchChanges(since: number, limit: number, clientId: string): Promise<SyncChangesResponse> {
		const url = `${this.baseUrl}/api/v1/sync/changes?since=${since}&limit=${limit}&clientId=${encodeURIComponent(clientId)}`
		const res = await this.http.get(url, { headers: this.buildHeaders() })
		if (res.status === 410) {
			const err = new Error('sync_cursor_expired') as Error & { status?: number }
			err.status = 410
			throw err
		}
		if (res.status >= 300) {
			throw formatHttpError('sync/changes failed', res.status, res.data)
		}
		return res.data as SyncChangesResponse
	}

	async fetchSnapshot(scope?: string): Promise<SyncSnapshotResponse> {
		const qs = scope ? `?scope=${encodeURIComponent(scope)}` : ''
		const res = await this.http.get(`${this.baseUrl}/api/v1/sync/snapshot${qs}`, {
			headers: this.buildHeaders()
		})
		if (res.status >= 300) {
			throw formatHttpError('sync/snapshot failed', res.status, res.data)
		}
		return res.data as SyncSnapshotResponse
	}

	async sendBatch(mutations: readonly MutationEnvelope[]): Promise<MutationsBatchResponse> {
		const idempotencyKey = mutations[0]?.mutationId ?? generateUuidV7()
		const res = await this.http.post(
			`${this.baseUrl}/api/v1/mutations`,
			{ mutations },
			{
				headers: this.buildHeaders({ 'idempotency-key': idempotencyKey })
			}
		)
		if (res.status >= 300) {
			throw formatHttpError('mutations failed', res.status, res.data)
		}
		return res.data as MutationsBatchResponse
	}

	async fetchRealtimeTicket(deviceId: string): Promise<{ ticket: string }> {
		const res = await this.http.post(
			`${this.baseUrl}/api/v1/realtime/ticket`,
			{ deviceId },
			{ headers: this.buildHeaders() }
		)
		if (res.status >= 300) throw formatHttpError('ticket failed', res.status, res.data)
		return res.data as { ticket: string }
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
	readonly onChatSignal?: ((ev: { channelId: string; rev: number; lastMsgSeq: number }) => void) | undefined
	readonly onPresence?:
		| ((users: readonly { userId: string; status: 'online' | 'away'; lastSeenAt: number }[]) => void)
		| undefined
	readonly onTyping?: ((ev: { channelId: string; userId: string; until: number }) => void) | undefined
}

export class HuriroSyncEngine {
	readonly workspaceId: string
	readonly currentUserId: string
	readonly collections = new HuriroSyncCollections()
	private storage: ReplicaStorage
	private readonly hasExplicitStorage: boolean
	private outbox: HuriroMutationOutbox
	private readonly transport: SyncTransport | null
	private readonly wsUrl: string | undefined
	private readonly pollIntervalMs: number | undefined
	private readonly useRealtimeTicket: boolean
	private readonly onMutationRejected: ((error: string) => void) | undefined
	private readonly onSessionInvalid: (() => void) | undefined
	private readonly onChatSignal:
		| ((ev: { channelId: string; rev: number; lastMsgSeq: number }) => void)
		| undefined
	private readonly onPresence:
		| ((users: readonly { userId: string; status: 'online' | 'away'; lastSeenAt: number }[]) => void)
		| undefined
	private readonly onTyping: ((ev: { channelId: string; userId: string; until: number }) => void) | undefined

	private wsClient: WsSignalClient | null = null
	private cursor = 0
	private clientId = generateUuidV7()
	private online =
		typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? navigator.onLine : true
	private wsConnected = false
	private syncing = false
	private lastError: string | null = null
	private lastFlushError: string | null = null
	private lastSyncError: string | null = null
	private revokedReason: string | null = null
	private disposed = false
	private syncPromise: Promise<void> | null = null
	private snapshotResyncPromise: Promise<boolean> | null = null
	private retryTimer: ReturnType<typeof setTimeout> | null = null
	private listeners = new Set<() => void>()
	private cachedStatus: SyncEngineStatus | null = null
	private onlineHandler: (() => void) | null = null
	private offlineHandler: (() => void) | null = null

	constructor(opts: HuriroSyncEngineOptions) {
		this.workspaceId = opts.workspaceId
		this.currentUserId = opts.currentUserId
		this.hasExplicitStorage = opts.storage !== undefined
		this.storage = opts.storage ?? new MemoryReplicaStorage()
		this.outbox = new HuriroMutationOutbox(this.storage)
		this.transport = opts.transport ?? null
		this.wsUrl = opts.wsUrl
		this.pollIntervalMs = opts.pollIntervalMs
		this.useRealtimeTicket = opts.useRealtimeTicket ?? false
		this.onMutationRejected = opts.onMutationRejected
		this.onSessionInvalid = opts.onSessionInvalid
		this.onChatSignal = opts.onChatSignal
		this.onPresence = opts.onPresence
		this.onTyping = opts.onTyping
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
		if (!this.hasExplicitStorage && this.storage.mode === 'memory' && !opts?.skipNetwork) {
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
				if (!hasPersistedReplicaShape(parsed)) {
					throw new Error('Persisted replica shape is invalid')
				}
				// Hydrate even legacy rows for instant local rendering, but only a
				// current-schema replica proves the cursor matches those collections.
				this.collections.applyFullSnapshot(parsed)
				this.cursor =
					parsed.schemaVersion === REPLICA_SCHEMA_VERSION && Number.isFinite(parsed.cursor)
						? parsed.cursor
						: 0
			} catch {
				this.cursor = 0
				this.collections.markAllReady()
			}
		} else {
			this.collections.markAllReady()
		}

		await this.outbox.load()
		this.reapplyPendingOptimisticState()
		this.emit()

		if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
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

		const transport = this.transport
		const fetchTicket = transport.fetchRealtimeTicket?.bind(transport)
		const getTicket =
			this.useRealtimeTicket && fetchTicket
				? async () => (await fetchTicket(this.clientId)).ticket
				: undefined
		this.wsClient = new WsSignalClient({
			workspaceId: this.workspaceId,
			wsUrl: this.wsUrl,
			getCursor: () => this.cursor,
			getTicket,
			onCursorSignal: (remoteCursor) => {
				if (remoteCursor > this.cursor) {
					void this.syncNow()
				}
			},
			onChatSignal: (ev) => {
				this.onChatSignal?.(ev)
			},
			onPresence: (users) => {
				this.onPresence?.(users)
			},
			onTyping: (ev) => {
				this.onTyping?.(ev)
			},
			onRevokeSignal: (reason) => {
				void this.handleRevocation(reason)
			},
			onPollFallback: () => {
				if (!this.online) return
				if (this.outbox.getPendingCount() > 0) {
					void this.flushOutbox().then(() => this.syncNow())
				} else {
					void this.syncNow()
				}
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

	private clearRetryTimer(): void {
		if (this.retryTimer !== null) {
			clearTimeout(this.retryTimer)
			this.retryTimer = null
		}
	}

	private scheduleOutboxRetry(): void {
		this.clearRetryTimer()
		if (this.disposed || !this.online || !this.transport) return
		const nextAt = this.outbox.getNextAttemptAt()
		if (nextAt === null) return
		const delayMs = Math.max(50, nextAt - Date.now())
		this.retryTimer = setTimeout(() => {
			this.retryTimer = null
			if (!this.disposed && this.online && this.transport) {
				void this.flushOutbox()
			}
		}, delayMs)
	}

	private reapplyPendingOptimisticState(): void {
		for (const item of this.outbox.getPendingMutations()) {
			const { envelope } = item
			if (envelope.entity === 'project') {
				if (envelope.op === 'create') {
					const nowIso = envelope.queuedAt ?? new Date().toISOString()
					const synthetic: ProjectDto = {
						id: envelope.entityId,
						workspaceId: this.workspaceId,
						key: String(envelope.patch['key'] ?? 'TMP'),
						name: String(envelope.patch['name'] ?? 'Untitled Project'),
						description: String(envelope.patch['description'] ?? ''),
						visibility: (envelope.patch['visibility'] as 'workspace' | 'private') ?? 'workspace',
						position: String(envelope.patch['position'] ?? 'V'),
						archivedAt: null,
						createdBy: this.currentUserId,
						createdAt: nowIso,
						updatedAt: nowIso,
						version: 1
					}
					this.collections.projectsManaged.upsertMany([synthetic])
				} else if (envelope.op === 'update') {
					const existing = this.collections.projects.get(envelope.entityId)
					if (existing) {
						this.collections.projectsManaged.upsertMany([
							{ ...existing, ...envelope.patch, updatedAt: new Date().toISOString() }
						])
					}
				}
			} else if (envelope.entity === 'saved_view') {
				if (envelope.op === 'create') {
					const nowIso = envelope.queuedAt ?? new Date().toISOString()
					const synthetic: SavedViewDto = {
						id: envelope.entityId,
						workspaceId: this.workspaceId,
						projectId: (envelope.patch['projectId'] as string | null) ?? null,
						ownerUserId: this.currentUserId,
						name: String(envelope.patch['name'] ?? 'Saved view'),
						layout: (envelope.patch['layout'] as 'list' | 'board') ?? 'list',
						filters: (envelope.patch['filters'] as SavedViewDto['filters']) ?? {},
						sort: (envelope.patch['sort'] as Record<string, unknown>) ?? {},
						isShared: Boolean(envelope.patch['isShared'] ?? false),
						position: String(envelope.patch['position'] ?? 'V'),
						createdAt: nowIso,
						updatedAt: nowIso,
						version: 1
					}
					this.collections.viewsManaged.upsertMany([synthetic])
				} else if (envelope.op === 'update') {
					const existing = this.collections.savedViews.get(envelope.entityId)
					if (existing) {
						this.collections.viewsManaged.upsertMany([
							{ ...existing, ...envelope.patch, updatedAt: new Date().toISOString() }
						])
					}
				}
			} else if (envelope.entity === 'notification' && envelope.op === 'mark_read') {
				const existing: NotificationDto | undefined = this.collections.notifications.get(envelope.entityId)
				if (existing && existing.readAt === null) {
					this.collections.notificationsManaged.upsertMany([
						{ ...existing, readAt: envelope.queuedAt ?? new Date().toISOString() }
					])
				}
			} else if (envelope.entity === 'issue') {
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
			} else if (envelope.entity === 'doc_page') {
				if (envelope.op === 'delete') {
					this.collections.purgeDocPageScope(envelope.entityId)
				} else if (envelope.op === 'create') {
					const parentId = (envelope.patch['parentId'] as string | null) ?? null
					const parent = parentId ? this.collections.docPages.get(parentId) : undefined
					const nowIso = envelope.queuedAt ?? new Date().toISOString()
					const synthetic: DocPageDto = {
						id: envelope.entityId,
						workspaceId: this.workspaceId,
						parentId,
						path: parent ? `${parent.path}/${envelope.entityId}` : envelope.entityId,
						depth: parent ? parent.depth + 1 : 0,
						slug: String(envelope.patch['slug'] ?? envelope.entityId.slice(0, 8)),
						title: String(envelope.patch['title'] ?? 'Untitled'),
						icon: (envelope.patch['icon'] as string | null) ?? null,
						visibility: (envelope.patch['visibility'] as 'workspace' | 'private') ?? 'workspace',
						isTemplate: Boolean(envelope.patch['isTemplate'] ?? false),
						isFavorite: false,
						position: String(envelope.patch['position'] ?? 'V'),
						createdBy: this.currentUserId,
						archivedAt: null,
						createdAt: nowIso,
						updatedAt: nowIso,
						version: 1,
						byteSize: 0
					}
					this.collections.docPagesManaged.upsertMany([synthetic])
				} else {
					const existing = this.collections.docPages.get(envelope.entityId)
					if (existing) {
						this.collections.docPagesManaged.upsertMany([
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
			void this.flushOutbox({ force: true }).then(() => this.syncNow())
		} else if (!online) {
			this.clearRetryTimer()
		}
	}

	async syncNow(): Promise<void> {
		if (!this.transport || !this.online || this.disposed) return
		if (this.syncPromise) return this.syncPromise

		const run = this.runSync().finally(() => {
			if (this.syncPromise === run) {
				this.syncPromise = null
			}
		})
		this.syncPromise = run
		return run
	}

	/**
	 * Fetch an authoritative full snapshot to reconcile stale or purged records
	 * (for example, a doc archived remotely or missing after local replica drift).
	 */
	async resyncSnapshot(): Promise<boolean> {
		if (!this.transport || !this.online || this.disposed) return false
		if (this.snapshotResyncPromise) return this.snapshotResyncPromise

		// Capture any in-flight sync before assigning `syncPromise` so we never await ourselves.
		const inFlight = this.syncPromise
		let runVoid: Promise<void> | null = null
		const run = (async () => {
			if (inFlight) {
				await inFlight.catch(() => {})
			}
			if (!this.transport || !this.online || this.disposed) return false
			return this.runSnapshotResync()
		})().finally(() => {
			if (this.snapshotResyncPromise === run) {
				this.snapshotResyncPromise = null
			}
			if (runVoid && this.syncPromise === runVoid) {
				this.syncPromise = null
			}
		})
		runVoid = run.then(() => undefined)
		this.snapshotResyncPromise = run
		this.syncPromise = runVoid
		return run
	}

	private async runSnapshotResync(): Promise<boolean> {
		if (!this.transport) return false
		this.syncing = true
		this.lastSyncError = null
		this.lastError = this.lastFlushError
		this.emit()

		try {
			const snap = await this.transport.fetchSnapshot()
			this.collections.applyFullSnapshot(snap)
			this.cursor = snap.cursor
			// Keep pending local creates/edits visible when a full snapshot replaces collections.
			this.reapplyPendingOptimisticState()
			await this.persistReplica()
			return true
		} catch (err) {
			const status = (err as { status?: number }).status
			if (status === 401) {
				await this.signOutAndWipe()
				this.onSessionInvalid?.()
				return false
			}
			this.lastSyncError = err instanceof Error ? err.message : 'Sync failed'
			this.lastError = this.lastFlushError ?? this.lastSyncError
			return false
		} finally {
			this.syncing = false
			this.emit()
		}
	}

	private async runSync(): Promise<void> {
		if (!this.transport) return
		this.syncing = true
		this.lastSyncError = null
		this.lastError = this.lastFlushError
		this.emit()

		try {
			if (this.cursor === 0) {
				const snap = await this.transport.fetchSnapshot()
				this.collections.applyFullSnapshot(snap)
				this.cursor = snap.cursor
				// Keep pending local creates/edits visible when a full snapshot replaces collections.
				this.reapplyPendingOptimisticState()
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
				this.reapplyPendingOptimisticState()
				await this.persistReplica()
				return
			}
			this.lastSyncError = err instanceof Error ? err.message : 'Sync failed'
			this.lastError = this.lastFlushError ?? this.lastSyncError
		} finally {
			this.syncing = false
			this.emit()
		}
	}

	async flushOutbox(opts?: FlushOptions): Promise<void> {
		if (!this.transport || !this.online || this.disposed) return
		const result = await this.outbox.flush(
			this.transport,
			{
				onApplied: (item, mutationResult) => {
					this.applyAuthoritativeResult(item, mutationResult)
				},
				onConflict: () => {
					this.emit()
				},
				onRejected: (item, _status, error) => {
					this.rollbackOptimistic(item)
					this.onMutationRejected?.(error)
				}
			},
			opts
		)
		if (result.error !== null) {
			this.lastFlushError = result.error
		} else if (this.outbox.getPendingCount() === 0) {
			this.lastFlushError = null
		}
		this.lastError = this.lastFlushError ?? this.lastSyncError

		if (this.outbox.getPendingCount() > 0) {
			this.scheduleOutboxRetry()
		} else {
			this.clearRetryTimer()
		}

		if (result.cursor !== null && result.cursor > this.cursor) {
			this.wsClient?.broadcastCursor(result.cursor)
			await this.syncNow()
		}
		await this.persistReplica()
		this.emit()
	}

	private applyAuthoritativeResult(item: QueuedMutation, result: MutationResultDto): void {
		const { entity, entityId, op } = item.envelope
		if (op === 'delete') {
			if (entity === 'issue') {
				this.collections.issuesManaged.deleteMany([entityId])
			} else if (entity === 'doc_page') {
				this.collections.purgeDocPageScope(entityId)
			}
			return
		}
		if (!result.data) return
		if (entity === 'issue') {
			this.collections.issuesManaged.upsertMany([result.data as unknown as IssueDto])
		} else if (entity === 'project') {
			this.collections.projectsManaged.upsertMany([result.data as unknown as ProjectDto])
		} else if (entity === 'saved_view') {
			this.collections.viewsManaged.upsertMany([result.data as unknown as SavedViewDto])
		} else if (entity === 'doc_page') {
			this.collections.docPagesManaged.upsertMany([result.data as unknown as DocPageDto])
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
		} else if (entity === 'saved_view') {
			if (op === 'create') {
				this.collections.viewsManaged.deleteMany([entityId])
			} else if (item.base) {
				this.collections.viewsManaged.upsertMany([item.base as unknown as SavedViewDto])
			}
		} else if (entity === 'doc_page') {
			if (op === 'create') {
				this.collections.docPagesManaged.deleteMany([entityId])
			} else if (item.base) {
				this.collections.docPagesManaged.upsertMany([item.base as unknown as DocPageDto])
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
		} else if (conflict.entity === 'doc_page') {
			if (rebased === null) {
				this.collections.docPagesManaged.upsertMany([conflict.serverValues as unknown as DocPageDto])
			} else {
				this.collections.docPagesManaged.upsertMany([
					{ ...(conflict.serverValues as unknown as DocPageDto), ...rebased.patch }
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
					...(statusId ? { statusId } : {}),
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

	async createDocPage(input: Omit<CreateDocPageBody, 'id'> & { readonly id?: string }): Promise<DocPageDto> {
		const id = input.id ?? generateUuidV7()
		const parentId = input.parentId ?? null
		const parent = parentId ? this.collections.docPages.get(parentId) : undefined
		const tail =
			this.collections.docPages.toArray
				.filter((p) => p.parentId === parentId && p.archivedAt === null)
				.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
				.at(-1)?.position ?? null
		const position = input.position ?? generateKeyBetween(tail, null)
		const slugBase = input.title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 100)
			.replace(/-+$/g, '')
		const slug = input.slug ?? (slugBase || `doc-${id.slice(0, 6)}`)
		const nowIso = new Date().toISOString()

		const optimistic: DocPageDto = {
			id,
			workspaceId: this.workspaceId,
			parentId,
			path: parent ? `${parent.path}/${id}` : id,
			depth: parent ? parent.depth + 1 : 0,
			slug,
			title: input.title,
			icon: input.icon ?? null,
			visibility: input.visibility ?? parent?.visibility ?? 'workspace',
			isTemplate: input.isTemplate ?? false,
			isFavorite: false,
			position,
			createdBy: this.currentUserId,
			archivedAt: null,
			createdAt: nowIso,
			updatedAt: nowIso,
			version: 1,
			byteSize: 0
		}

		await this.outbox.enqueue({
			envelope: {
				mutationId: generateUuidV7(),
				workspaceId: this.workspaceId,
				entity: 'doc_page',
				entityId: id,
				op: 'create',
				patch: {
					parentId,
					title: input.title,
					visibility: optimistic.visibility,
					position,
					...(input.slug !== undefined ? { slug: input.slug } : {}),
					...(input.icon !== undefined ? { icon: input.icon } : {}),
					...(input.isTemplate !== undefined ? { isTemplate: input.isTemplate } : {}),
					...(input.templateId !== undefined ? { templateId: input.templateId } : {}),
					...(input.markdown !== undefined ? { markdown: input.markdown } : {})
				},
				queuedAt: nowIso
			},
			title: input.title
		})

		this.collections.docPagesManaged.upsertMany([optimistic])
		await this.persistReplica()
		this.emit()
		if (this.online && this.transport) void this.flushOutbox()
		return optimistic
	}

	async updateDocPage(pageId: string, patch: Omit<UpdateDocPageBody, 'version'>): Promise<void> {
		const current = this.collections.docPages.get(pageId)
		if (!current) throw new Error(`Doc page "${pageId}" not found in local replica`)

		const optimistic: DocPageDto = {
			...current,
			...(patch.title !== undefined ? { title: patch.title } : {}),
			...(patch.slug !== undefined ? { slug: patch.slug } : {}),
			...(patch.icon !== undefined ? { icon: patch.icon } : {}),
			...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
			...(patch.isTemplate !== undefined ? { isTemplate: patch.isTemplate } : {}),
			...(patch.archived !== undefined
				? { archivedAt: patch.archived ? new Date().toISOString() : null }
				: {}),
			updatedAt: new Date().toISOString()
		}

		await this.outbox.enqueue({
			envelope: {
				mutationId: generateUuidV7(),
				workspaceId: this.workspaceId,
				entity: 'doc_page',
				entityId: pageId,
				op: 'update',
				patch: patch as Record<string, unknown>,
				baseVersion: current.version,
				queuedAt: new Date().toISOString()
			},
			base: current as unknown as Record<string, unknown>,
			title: current.title
		})

		this.collections.docPagesManaged.upsertMany([optimistic])
		await this.persistReplica()
		this.emit()
		if (this.online && this.transport) void this.flushOutbox()
	}

	async moveDocPage(pageId: string, move: Omit<MoveDocPageBody, 'version'>): Promise<void> {
		const current = this.collections.docPages.get(pageId)
		if (!current) throw new Error(`Doc page "${pageId}" not found in local replica`)

		let position = move.position
		if (!position) {
			const afterPos = move.afterPageId
				? (this.collections.docPages.get(move.afterPageId)?.position ?? null)
				: null
			const beforePos = move.beforePageId
				? (this.collections.docPages.get(move.beforePageId)?.position ?? null)
				: null
			if (afterPos === null && beforePos === null) {
				const tail =
					this.collections.docPages.toArray
						.filter((p) => p.parentId === move.parentId && p.archivedAt === null && p.id !== pageId)
						.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
						.at(-1)?.position ?? null
				position = generateKeyBetween(tail, null)
			} else {
				position = generateKeyBetween(afterPos, beforePos)
			}
		}

		const parent = move.parentId ? this.collections.docPages.get(move.parentId) : undefined
		const optimistic: DocPageDto = {
			...current,
			parentId: move.parentId,
			path: parent ? `${parent.path}/${current.id}` : current.id,
			depth: parent ? parent.depth + 1 : 0,
			position,
			updatedAt: new Date().toISOString()
		}

		await this.outbox.enqueue({
			envelope: {
				mutationId: generateUuidV7(),
				workspaceId: this.workspaceId,
				entity: 'doc_page',
				entityId: pageId,
				op: 'move',
				patch: {
					parentId: move.parentId,
					position,
					...(move.afterPageId !== undefined ? { afterPageId: move.afterPageId } : {}),
					...(move.beforePageId !== undefined ? { beforePageId: move.beforePageId } : {})
				},
				baseVersion: current.version,
				queuedAt: new Date().toISOString()
			},
			base: current as unknown as Record<string, unknown>,
			title: current.title
		})

		this.collections.docPagesManaged.upsertMany([optimistic])
		await this.persistReplica()
		this.emit()
		if (this.online && this.transport) void this.flushOutbox()
	}

	async deleteDocPage(pageId: string): Promise<void> {
		const current = this.collections.docPages.get(pageId)
		if (!current) return
		await this.outbox.enqueue({
			envelope: {
				mutationId: generateUuidV7(),
				workspaceId: this.workspaceId,
				entity: 'doc_page',
				entityId: pageId,
				op: 'delete',
				patch: {},
				baseVersion: current.version,
				queuedAt: new Date().toISOString()
			},
			base: current as unknown as Record<string, unknown>,
			title: current.title
		})
		this.collections.purgeDocPageScope(pageId)
		await this.persistReplica()
		this.emit()
		if (this.online && this.transport) void this.flushOutbox()
	}

	private async handleRevocation(reason: string): Promise<void> {
		this.clearRetryTimer()
		this.lastFlushError = null
		this.lastSyncError = null
		this.lastError = null
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

	sendPresence(status: 'online' | 'away'): void {
		this.wsClient?.sendPresence(status)
	}

	sendTyping(channelId: string): void {
		this.wsClient?.sendTyping(channelId)
	}

	async signOutAndWipe(): Promise<void> {
		this.dispose()
		this.lastFlushError = null
		this.lastSyncError = null
		this.lastError = null
		await this.outbox.clearAll()
		this.collections.clearAll()
		await this.storage.clear()
		this.cursor = 0
		this.emit()
	}

	dispose(): void {
		this.disposed = true
		this.clearRetryTimer()
		this.wsClient?.stop()
		this.wsClient = null
		if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
			if (this.onlineHandler) window.removeEventListener('online', this.onlineHandler)
			if (this.offlineHandler) window.removeEventListener('offline', this.offlineHandler)
		}
	}
}
