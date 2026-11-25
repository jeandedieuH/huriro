/**
 * HuriroSyncEngine — client replication & mutation coordinator (§9.5, §9.6).
 */
import type {
	CreateDocPageBody,
	CreateInitiativeBody,
	CreateIssueBody,
	CreateProjectBody,
	CreateProjectMilestoneBody,
	CreateProjectUpdateBody,
	CreateSavedViewBody,
	DocPageDto,
	InitiativeDto,
	IssueDto,
	MoveDocPageBody,
	MoveIssueBody,
	MutationEnvelope,
	MutationResultDto,
	MutationsBatchResponse,
	NotificationDto,
	ProjectDto,
	ProjectMilestoneDto,
	ProjectUpdateDto,
	SavedViewDto,
	SyncChangesResponse,
	SyncScopeSnapshotResponse,
	SyncSnapshotResponse,
	UpdateDocPageBody,
	UpdateInitiativeBody,
	UpdateIssueBody,
	UpdateProjectMilestoneBody
} from '@huriro/contracts'
import { generateKeyBetween } from '@huriro/domain'
import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios'
import {
	HuriroSyncCollections,
	isTier2Issue,
	type PersistedReplicaState,
	REPLICA_SCHEMA_VERSION
} from './collections'
import {
	type FlushOptions,
	generateUuidV7,
	HuriroMutationOutbox,
	type MutationTransport,
	type QueuedMutation,
	type SyncConflict
} from './outbox'
import { type PersistedScopeEntry, ScopedSyncManager, type ScopeRegistryEntry } from './scoped-sync'
import {
	createBestReplicaStorage,
	MemoryReplicaStorage,
	type ReplicaStorage,
	type ReplicaStorageMode
} from './storage'
import { WsSignalClient } from './ws-signal'

const REPLICA_KEY = 'huriro:replica:v1'
const CLIENT_ID_KEY = 'huriro:client_id:v1'
const SCOPES_KEY = 'huriro:scopes:v1'

/** Default tier-2 scope byte budget — ADR-0031 web quota; mobile passes 30 MB. */
export const DEFAULT_SCOPE_QUOTA_BYTES = 50 * 1024 * 1024

export interface SyncTransport extends MutationTransport {
	/**
	 * `scopes` is the comma-joined active tier-2 subscription list (§8.1,
	 * ADR-0031). Optional fourth parameter — pre-M7 transports keep working.
	 */
	fetchChanges(since: number, limit: number, clientId: string, scopes?: string): Promise<SyncChangesResponse>
	fetchSnapshot(scope?: string): Promise<SyncSnapshotResponse>
	/** Tier-2 scope hydration endpoint. Optional: engines degrade gracefully
	 * (scope subscriptions reject) when the transport predates M7. */
	fetchScopeSnapshot?(scope: string, after: string | null): Promise<SyncScopeSnapshotResponse>
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

	async fetchChanges(
		since: number,
		limit: number,
		clientId: string,
		scopes?: string
	): Promise<SyncChangesResponse> {
		const scopesQs = scopes ? `&scopes=${encodeURIComponent(scopes)}` : ''
		const url = `${this.baseUrl}/api/v1/sync/changes?since=${since}&limit=${limit}&clientId=${encodeURIComponent(clientId)}${scopesQs}`
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

	async fetchScopeSnapshot(scope: string, after: string | null): Promise<SyncScopeSnapshotResponse> {
		const afterQs = after !== null ? `&after=${encodeURIComponent(after)}` : ''
		const res = await this.http.get(
			`${this.baseUrl}/api/v1/sync/scope-snapshot?scope=${encodeURIComponent(scope)}${afterQs}`,
			{ headers: this.buildHeaders() }
		)
		if (res.status >= 300) {
			throw formatHttpError('sync/scope-snapshot failed', res.status, res.data)
		}
		return res.data as SyncScopeSnapshotResponse
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
	/** Tier-2 scope byte budget (ADR-0031): 50 MB web default, 30 MB on mobile. */
	readonly scopeQuotaBytes?: number | undefined
	/** Notified when the LRU evicts a scope — the UI can resubscribe or go stale. */
	readonly onScopeEvicted?: ((scope: string) => void) | undefined
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
	private readonly onScopeEvicted: ((scope: string) => void) | undefined
	private readonly scopedSync: ScopedSyncManager

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
	private pendingScopeRegistryWrite: Promise<void> | null = null

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
		this.onScopeEvicted = opts.onScopeEvicted

		// Tier-2 lazy scope hydration (§8.1, ADR-0031). Rows land in the SAME
		// issues collection as the core feed — version-guarded upserts keep
		// mid-pagination pages from clobbering newer change-feed rows, and the
		// purge only deletes rows that are STILL tier-2 shaped so reopened
		// issues survive their scope's release/eviction.
		this.scopedSync = new ScopedSyncManager({
			quotaBytes: opts.scopeQuotaBytes ?? DEFAULT_SCOPE_QUOTA_BYTES,
			fetchPage: async (scope, after) => {
				if (!this.transport?.fetchScopeSnapshot) {
					throw new Error('Transport does not support tier-2 scope hydration')
				}
				const page = await this.transport.fetchScopeSnapshot(scope, after)
				return { rows: page.rows, nextAfter: page.nextAfter, hasMore: page.hasMore }
			},
			applyRows: (scope, rows) => {
				if (!scope.startsWith('issue_hist:')) {
					// Only issue_hist hydrates into collections in M7 — other scope
					// kinds are forward-compat no-ops (server returns empty rows).
					return
				}
				this.collections.issuesManaged.upsertMany(rows as unknown as IssueDto[])
				// Re-overlay pending optimistic edits so hydration pages never hide
				// a local offline change that is still queued in the outbox.
				this.reapplyPendingOptimisticState()
			},
			purgeRows: (scope, _rowIds) => {
				if (!scope.startsWith('issue_hist:')) return
				const projectId = scope.slice('issue_hist:'.length)
				const nowMs = Date.now()
				// Scan by project rather than trust the manager's id list: boot-restored
				// scopes have no recorded ids, and tier-1 rows that aged into tier-2 while
				// held belong to the scope's memory budget just the same. Rows that no
				// longer look like tier-2 (reopened, deletedAt cleared) survive the purge.
				const keys = this.collections.issuesManaged
					.values()
					.filter((i) => i.projectId === projectId && isTier2Issue(i, nowMs))
					.map((i) => i.id)
				this.collections.issuesManaged.deleteMany(keys)
			},
			onEvict: (scope) => {
				this.onScopeEvicted?.(scope)
				void this.persistReplica()
			},
			onRegistryChange: (entries) => {
				void this.persistScopeRegistry(entries)
				this.emit()
			}
		})
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

		// Restore the tier-2 scope registry AFTER the collections are hydrated:
		// boot-restored entries come back `stale` (rows already in the replica,
		// lazy rehydration on next subscribe) and an over-quota restore evicts
		// LRU-first — the eviction purge scans the collections, so they must be
		// populated before this runs.
		const rawScopes = await this.storage.get(SCOPES_KEY)
		if (rawScopes) {
			try {
				const parsed = JSON.parse(rawScopes) as PersistedScopeEntry[]
				if (Array.isArray(parsed)) {
					this.scopedSync.restoreRegistry(
						parsed.filter(
							(e) =>
								e &&
								typeof e === 'object' &&
								typeof (e as { scope?: unknown }).scope === 'string' &&
								Number.isFinite((e as { byteSize?: unknown }).byteSize) &&
								Number.isFinite((e as { lastAccess?: unknown }).lastAccess)
						)
					)
				}
			} catch {
				// Corrupt registry metadata is non-fatal — scopes simply rehydrate fresh.
			}
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
						triageEnabled: false,
						cycleEnabled: false,
						cycleDurationDays: 14,
						cycleCooldownDays: 0,
						cycleAutoRolloverMode: 'next_cycle',
						cycleStartWeekday: 1,
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
			} else if (envelope.entity === 'initiative') {
				if (envelope.op === 'delete') {
					this.collections.initiativesManaged.deleteMany([envelope.entityId])
				} else if (envelope.op === 'create') {
					const nowIso = envelope.queuedAt ?? new Date().toISOString()
					this.collections.initiativesManaged.upsertMany([
						{
							id: envelope.entityId,
							workspaceId: this.workspaceId,
							name: String(envelope.patch['name'] ?? 'Untitled initiative'),
							description: envelope.patch['description'] ?? null,
							descriptionText: String(envelope.patch['descriptionText'] ?? ''),
							health: (envelope.patch['health'] as InitiativeDto['health']) ?? 'on_track',
							ownerId: (envelope.patch['ownerId'] as string | null) ?? null,
							targetDate: (envelope.patch['targetDate'] as string | null) ?? null,
							position: String(envelope.patch['position'] ?? 'V'),
							projectIds: (envelope.patch['projectIds'] as string[]) ?? [],
							createdAt: nowIso,
							updatedAt: nowIso,
							version: 1
						}
					])
				} else {
					const existing = this.collections.initiatives.get(envelope.entityId)
					if (existing) {
						this.collections.initiativesManaged.upsertMany([
							{ ...existing, ...envelope.patch, updatedAt: new Date().toISOString() }
						])
					}
				}
			} else if (envelope.entity === 'project_milestone') {
				if (envelope.op === 'delete') {
					this.collections.milestonesManaged.deleteMany([envelope.entityId])
				} else if (envelope.op === 'create') {
					const nowIso = envelope.queuedAt ?? new Date().toISOString()
					this.collections.milestonesManaged.upsertMany([
						{
							id: envelope.entityId,
							workspaceId: this.workspaceId,
							projectId: String(envelope.patch['projectId'] ?? ''),
							name: String(envelope.patch['name'] ?? 'Milestone'),
							description: String(envelope.patch['description'] ?? ''),
							targetDate: (envelope.patch['targetDate'] as string | null) ?? null,
							status: (envelope.patch['status'] as ProjectMilestoneDto['status']) ?? 'planned',
							position: String(envelope.patch['position'] ?? 'V'),
							createdAt: nowIso,
							updatedAt: nowIso,
							version: 1
						}
					])
				} else {
					const existing = this.collections.projectMilestones.get(envelope.entityId)
					if (existing) {
						const { projectId: _projectId, ...patch } = envelope.patch
						this.collections.milestonesManaged.upsertMany([
							{ ...existing, ...patch, updatedAt: new Date().toISOString() }
						])
					}
				}
			} else if (envelope.entity === 'project_update' && envelope.op === 'create') {
				const nowIso = envelope.queuedAt ?? new Date().toISOString()
				this.collections.projectUpdatesManaged.upsertMany([
					{
						id: envelope.entityId,
						workspaceId: this.workspaceId,
						projectId: String(envelope.patch['projectId'] ?? ''),
						health: (envelope.patch['health'] as ProjectUpdateDto['health']) ?? 'on_track',
						body: envelope.patch['body'] ?? null,
						bodyText: String(envelope.patch['bodyText'] ?? ''),
						completedIssues: Number(envelope.patch['completedIssues'] ?? 0),
						totalIssues: Number(envelope.patch['totalIssues'] ?? 0),
						scopeChange: Number(envelope.patch['scopeChange'] ?? 0),
						createdBy: this.currentUserId,
						createdAt: nowIso,
						updatedAt: nowIso,
						version: 1
					}
				])
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
						filterExpr: null,
						displayOptions: {},
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
						triageStatus: 'none',
						triageSnoozedUntil: null,
						triageDeclinedReason: null,
						sourceKind: 'manual',
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
				// Active tier-2 scope subscriptions ride along on every delta pull
				// (§8.1) — recomputed per page because scopes can activate while a
				// long catch-up pagination is in flight. Pre-M7 servers ignore the
				// parameter; pre-M7 transports simply don't receive it (optional).
				const activeScopes = this.scopedSync.activeScopes()
				const page = await this.transport.fetchChanges(
					this.cursor,
					500,
					this.clientId,
					activeScopes.length > 0 ? activeScopes.join(',') : undefined
				)
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
			} else if (entity === 'initiative') {
				this.collections.initiativesManaged.deleteMany([entityId])
			} else if (entity === 'project_milestone') {
				this.collections.milestonesManaged.deleteMany([entityId])
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
		} else if (entity === 'initiative') {
			this.collections.initiativesManaged.upsertMany([result.data as unknown as InitiativeDto])
		} else if (entity === 'project_milestone') {
			this.collections.milestonesManaged.upsertMany([result.data as unknown as ProjectMilestoneDto])
		} else if (entity === 'project_update') {
			this.collections.projectUpdatesManaged.upsertMany([result.data as unknown as ProjectUpdateDto])
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
		} else if (entity === 'initiative') {
			if (op === 'create') {
				this.collections.initiativesManaged.deleteMany([entityId])
			} else if (item.base) {
				this.collections.initiativesManaged.upsertMany([item.base as unknown as InitiativeDto])
			}
		} else if (entity === 'project_milestone') {
			if (op === 'create') {
				this.collections.milestonesManaged.deleteMany([entityId])
			} else if (item.base) {
				this.collections.milestonesManaged.upsertMany([item.base as unknown as ProjectMilestoneDto])
			}
		} else if (entity === 'project_update' && op === 'create') {
			this.collections.projectUpdatesManaged.deleteMany([entityId])
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
		} else if (conflict.entity === 'initiative') {
			if (rebased === null) {
				this.collections.initiativesManaged.upsertMany([conflict.serverValues as unknown as InitiativeDto])
			} else {
				this.collections.initiativesManaged.upsertMany([
					{ ...(conflict.serverValues as unknown as InitiativeDto), ...rebased.patch }
				])
			}
		} else if (conflict.entity === 'project_milestone') {
			const { projectId: _projectId, ...rebasedPatch } = rebased?.patch ?? {}
			if (rebased === null) {
				this.collections.milestonesManaged.upsertMany([
					conflict.serverValues as unknown as ProjectMilestoneDto
				])
			} else {
				this.collections.milestonesManaged.upsertMany([
					{ ...(conflict.serverValues as unknown as ProjectMilestoneDto), ...rebasedPatch }
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
			triageStatus: 'none',
			triageSnoozedUntil: null,
			triageDeclinedReason: null,
			sourceKind: 'manual',
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
			...patch,
			projectKey: patch.projectId
				? (this.collections.projects.get(patch.projectId)?.key ?? current.projectKey)
				: current.projectKey,
			...(patch.assigneeId !== undefined
				? {
						assigneeId: patch.assigneeId,
						assigneeType: patch.assigneeId === null ? null : (patch.assigneeType ?? 'user')
					}
				: {}),
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

	async createInitiative(
		input: Omit<CreateInitiativeBody, 'id'> & { readonly id?: string }
	): Promise<InitiativeDto> {
		const id = input.id ?? generateUuidV7()
		const tail =
			this.collections.initiatives.toArray
				.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
				.at(-1)?.position ?? null
		const position = input.position ?? generateKeyBetween(tail, null)
		const nowIso = new Date().toISOString()
		const optimistic: InitiativeDto = {
			id,
			workspaceId: this.workspaceId,
			name: input.name,
			description: input.description ?? null,
			descriptionText: input.descriptionText ?? '',
			health: input.health ?? 'on_track',
			ownerId: input.ownerId ?? null,
			targetDate: input.targetDate ?? null,
			position,
			projectIds: input.projectIds ?? [],
			createdAt: nowIso,
			updatedAt: nowIso,
			version: 1
		}
		await this.outbox.enqueue({
			envelope: {
				mutationId: generateUuidV7(),
				workspaceId: this.workspaceId,
				entity: 'initiative',
				entityId: id,
				op: 'create',
				patch: { ...input, position, projectIds: optimistic.projectIds } as Record<string, unknown>,
				queuedAt: nowIso
			},
			title: input.name
		})
		this.collections.initiativesManaged.upsertMany([optimistic])
		await this.persistReplica()
		this.emit()
		if (this.online && this.transport) void this.flushOutbox()
		return optimistic
	}

	async updateInitiative(initiativeId: string, patch: Omit<UpdateInitiativeBody, 'version'>): Promise<void> {
		const current = this.collections.initiatives.get(initiativeId)
		if (!current) throw new Error(`Initiative "${initiativeId}" not found in local replica`)
		const optimistic: InitiativeDto = {
			...current,
			...patch,
			projectIds: patch.projectIds ?? current.projectIds,
			updatedAt: new Date().toISOString()
		}
		await this.outbox.enqueue({
			envelope: {
				mutationId: generateUuidV7(),
				workspaceId: this.workspaceId,
				entity: 'initiative',
				entityId: initiativeId,
				op: 'update',
				patch: patch as Record<string, unknown>,
				baseVersion: current.version,
				queuedAt: new Date().toISOString()
			},
			base: current as unknown as Record<string, unknown>,
			title: current.name
		})
		this.collections.initiativesManaged.upsertMany([optimistic])
		await this.persistReplica()
		this.emit()
		if (this.online && this.transport) void this.flushOutbox()
	}

	async deleteInitiative(initiativeId: string): Promise<void> {
		const current = this.collections.initiatives.get(initiativeId)
		if (!current) return
		await this.outbox.enqueue({
			envelope: {
				mutationId: generateUuidV7(),
				workspaceId: this.workspaceId,
				entity: 'initiative',
				entityId: initiativeId,
				op: 'delete',
				patch: {},
				baseVersion: current.version,
				queuedAt: new Date().toISOString()
			},
			base: current as unknown as Record<string, unknown>,
			title: current.name
		})
		this.collections.initiativesManaged.deleteMany([initiativeId])
		await this.persistReplica()
		this.emit()
		if (this.online && this.transport) void this.flushOutbox()
	}

	async createProjectMilestone(
		projectId: string,
		input: Omit<CreateProjectMilestoneBody, 'id'> & { readonly id?: string }
	): Promise<ProjectMilestoneDto> {
		const id = input.id ?? generateUuidV7()
		const tail =
			this.collections.projectMilestones.toArray
				.filter((milestone) => milestone.projectId === projectId)
				.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
				.at(-1)?.position ?? null
		const position = input.position ?? generateKeyBetween(tail, null)
		const nowIso = new Date().toISOString()
		const optimistic: ProjectMilestoneDto = {
			id,
			workspaceId: this.workspaceId,
			projectId,
			name: input.name,
			description: input.description ?? '',
			targetDate: input.targetDate ?? null,
			status: input.status ?? 'planned',
			position,
			createdAt: nowIso,
			updatedAt: nowIso,
			version: 1
		}
		await this.outbox.enqueue({
			envelope: {
				mutationId: generateUuidV7(),
				workspaceId: this.workspaceId,
				entity: 'project_milestone',
				entityId: id,
				op: 'create',
				patch: { ...input, projectId, position } as Record<string, unknown>,
				queuedAt: nowIso
			},
			title: input.name
		})
		this.collections.milestonesManaged.upsertMany([optimistic])
		await this.persistReplica()
		this.emit()
		if (this.online && this.transport) void this.flushOutbox()
		return optimistic
	}

	async updateProjectMilestone(
		projectId: string,
		milestoneId: string,
		patch: Omit<UpdateProjectMilestoneBody, 'version'>
	): Promise<void> {
		const current = this.collections.projectMilestones.get(milestoneId)
		if (!current || current.projectId !== projectId)
			throw new Error(`Milestone "${milestoneId}" not found in local replica`)
		const optimistic: ProjectMilestoneDto = { ...current, ...patch, updatedAt: new Date().toISOString() }
		await this.outbox.enqueue({
			envelope: {
				mutationId: generateUuidV7(),
				workspaceId: this.workspaceId,
				entity: 'project_milestone',
				entityId: milestoneId,
				op: 'update',
				patch: { ...patch, projectId } as Record<string, unknown>,
				baseVersion: current.version,
				queuedAt: new Date().toISOString()
			},
			base: current as unknown as Record<string, unknown>,
			title: current.name
		})
		this.collections.milestonesManaged.upsertMany([optimistic])
		await this.persistReplica()
		this.emit()
		if (this.online && this.transport) void this.flushOutbox()
	}

	async deleteProjectMilestone(projectId: string, milestoneId: string): Promise<void> {
		const current = this.collections.projectMilestones.get(milestoneId)
		if (!current || current.projectId !== projectId) return
		await this.outbox.enqueue({
			envelope: {
				mutationId: generateUuidV7(),
				workspaceId: this.workspaceId,
				entity: 'project_milestone',
				entityId: milestoneId,
				op: 'delete',
				patch: { projectId },
				baseVersion: current.version,
				queuedAt: new Date().toISOString()
			},
			base: current as unknown as Record<string, unknown>,
			title: current.name
		})
		this.collections.milestonesManaged.deleteMany([milestoneId])
		await this.persistReplica()
		this.emit()
		if (this.online && this.transport) void this.flushOutbox()
	}

	async createProjectUpdate(
		projectId: string,
		input: Omit<CreateProjectUpdateBody, 'id'> & { readonly id?: string }
	): Promise<ProjectUpdateDto> {
		const id = input.id ?? generateUuidV7()
		const projectIssues = this.collections.issues.toArray.filter(
			(issue) => issue.projectId === projectId && issue.deletedAt === null
		)
		const completedIssues = projectIssues.filter(
			(issue) => this.collections.projectStatuses.get(issue.statusId)?.category === 'completed'
		).length
		const nowIso = new Date().toISOString()
		const optimistic: ProjectUpdateDto = {
			id,
			workspaceId: this.workspaceId,
			projectId,
			health: input.health,
			body: input.body ?? null,
			bodyText: input.bodyText ?? '',
			completedIssues: input.completedIssues ?? completedIssues,
			totalIssues: input.totalIssues ?? projectIssues.length,
			scopeChange: input.scopeChange ?? 0,
			createdBy: this.currentUserId,
			createdAt: nowIso,
			updatedAt: nowIso,
			version: 1
		}
		await this.outbox.enqueue({
			envelope: {
				mutationId: generateUuidV7(),
				workspaceId: this.workspaceId,
				entity: 'project_update',
				entityId: id,
				op: 'create',
				patch: { ...input, projectId } as Record<string, unknown>,
				queuedAt: nowIso
			},
			title: optimistic.bodyText || optimistic.health
		})
		this.collections.projectUpdatesManaged.upsertMany([optimistic])
		await this.persistReplica()
		this.emit()
		if (this.online && this.transport) void this.flushOutbox()
		return optimistic
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
			triageEnabled: false,
			cycleEnabled: false,
			cycleDurationDays: 14,
			cycleCooldownDays: 0,
			cycleAutoRolloverMode: 'next_cycle',
			cycleStartWeekday: 1,
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
			filterExpr: input.filterExpr ?? null,
			displayOptions: input.displayOptions ?? {},
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
		// Drop all scope registrations WITHOUT purging — the hard collection wipe
		// below already removes every row, and purge scans would be wasted work.
		this.scopedSync.reset()
		await this.outbox.clearAll()
		this.collections.clearAll()
		await this.persistReplica()
		this.emit()
	}

	async persistReplica(): Promise<void> {
		const state = this.collections.exportState(this.cursor)
		await this.storage.set(REPLICA_KEY, JSON.stringify(state))
	}

	private async persistScopeRegistry(entries: readonly PersistedScopeEntry[]): Promise<void> {
		// Metadata only — rows live in the replica itself. Writes are fire-and-forget
		// but tracked so `signOutAndWipe` can wait for the in-flight one before
		// clearing storage — otherwise a late landing write could resurrect scope
		// metadata (which embeds project ids) after sign-out.
		const write = this.storage.set(SCOPES_KEY, JSON.stringify(entries)).catch(() => {})
		this.pendingScopeRegistryWrite = write
		await write
	}

	// ---------- Tier-2 scope subscriptions (§8.1, ADR-0031) ----------

	/**
	 * Subscribe a tier-2 scope (in M7: `issue_hist:<projectId>`). Resolves when
	 * hydrated; rejects when hydration fails — the caller owns a ref either way
	 * and MUST pair every call with `releaseScope`. Recovery from a failed
	 * hydration is release + re-subscribe.
	 */
	subscribeScope(scope: string): Promise<void> {
		const promise = this.scopedSync.subscribe(scope)
		// Persist hydrated rows once paging completes so offline restarts render
		// them immediately; failures leave the replica untouched.
		void promise.then(() => this.persistReplica()).catch(() => {})
		return promise
	}

	releaseScope(scope: string): void {
		this.scopedSync.release(scope)
		void this.persistReplica()
	}

	pinScope(scope: string): void {
		this.scopedSync.pin(scope)
	}

	unpinScope(scope: string): void {
		this.scopedSync.unpin(scope)
		void this.persistReplica()
	}

	/** Scopes threaded into `/sync/changes` — ready plus boot-restored stale ones. */
	activeScopes(): string[] {
		return this.scopedSync.activeScopes()
	}

	getScopeState(scope: string): ScopeRegistryEntry | null {
		return this.scopedSync.getScopeState(scope)
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
		// Scope registry is dropped before the storage clear, and any in-flight
		// registry write is awaited so it cannot resurrect scope metadata (which
		// embeds project ids) after the wipe.
		this.scopedSync.reset()
		if (this.pendingScopeRegistryWrite) {
			await this.pendingScopeRegistryWrite
			this.pendingScopeRegistryWrite = null
		}
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
