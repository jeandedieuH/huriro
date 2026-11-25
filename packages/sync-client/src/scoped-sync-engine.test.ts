import { describe, expect, test } from 'bun:test'
import type {
	IssueDto,
	MutationsBatchResponse,
	ProjectDto,
	ProjectStatusDto,
	SyncChangesResponse,
	SyncScopeSnapshotResponse,
	SyncSnapshotResponse
} from '@huriro/contracts'
import {
	generateUuidV7,
	HttpSyncTransport,
	HuriroSyncEngine,
	MemoryReplicaStorage,
	type SyncTransport
} from './index'

const WS_ID = '0190a0b1-9a9a-7000-8000-000000000001'
const USER_ID = '0190a0b1-9a9a-7000-8000-000000000002'
const PROJ_ID = '0190a0b1-9a9a-7000-8000-000000000003'
const STATUS_TODO = '0190a0b1-9a9a-7000-8000-000000000004'
const HIST_SCOPE = `issue_hist:${PROJ_ID}`

const DAY_MS = 24 * 60 * 60 * 1000

function daysAgoIso(days: number): string {
	return new Date(Date.now() - days * DAY_MS).toISOString()
}

function baseProject(): ProjectDto {
	return {
		id: PROJ_ID,
		workspaceId: WS_ID,
		key: 'ENG',
		name: 'Engineering',
		description: '',
		visibility: 'workspace',
		position: 'V',
		archivedAt: null,
		triageEnabled: false,
		cycleEnabled: false,
		cycleDurationDays: 14,
		cycleCooldownDays: 0,
		cycleAutoRolloverMode: 'next_cycle',
		cycleStartWeekday: 1,
		createdBy: USER_ID,
		createdAt: '2026-11-22T00:00:00Z',
		updatedAt: '2026-11-22T00:00:00Z',
		version: 1
	}
}

function baseStatus(): ProjectStatusDto {
	return {
		id: STATUS_TODO,
		workspaceId: WS_ID,
		projectId: PROJ_ID,
		name: 'Todo',
		category: 'unstarted',
		color: 'info',
		position: 'F',
		isDefault: true,
		createdAt: '2026-11-22T00:00:00Z',
		updatedAt: '2026-11-22T00:00:00Z',
		version: 1
	}
}

function makeIssue(id: string, over: Partial<IssueDto> = {}): IssueDto {
	return {
		id,
		workspaceId: WS_ID,
		projectId: PROJ_ID,
		projectKey: 'ENG',
		number: 1,
		identifier: 'ENG-1',
		parentId: null,
		cycleId: null,
		title: 'Initial title',
		description: null,
		descriptionText: '',
		statusId: STATUS_TODO,
		priority: 1,
		assigneeType: null,
		assigneeId: null,
		creatorId: USER_ID,
		position: 'V',
		startDate: null,
		dueDate: null,
		estimate: null,
		closedAt: null,
		triageStatus: 'none',
		triageSnoozedUntil: null,
		triageDeclinedReason: null,
		sourceKind: 'manual',
		labelIds: [],
		createdAt: '2026-11-22T00:00:00Z',
		updatedAt: '2026-11-22T00:00:00Z',
		deletedAt: null,
		version: 1,
		...over
	}
}

/** Tier-2 shaped row: closed over 30 days ago. */
function histIssue(id: string, over: Partial<IssueDto> = {}): IssueDto {
	return makeIssue(id, { closedAt: daysAgoIso(40), ...over })
}

interface ScopeHarness {
	readonly transport: SyncTransport
	readonly snapshotIssues: () => IssueDto[]
	readonly setSnapshotIssues: (issues: IssueDto[]) => void
	readonly scopePages: Record<string, { rows: IssueDto[]; nextAfter: string | null; hasMore: boolean }[]>
	readonly changesQueue: SyncChangesResponse['changes'][number][][]
	readonly fetchChangesCalls: { since: number; scopes: string | undefined }[]
	readonly scopeFetches: { scope: string; after: string | null }[]
}

function makeScopeTransport(opts?: { readonly initialSnapshotIssues?: IssueDto[] }): ScopeHarness {
	let snapshotIssues = opts?.initialSnapshotIssues ?? []
	const scopePages: ScopeHarness['scopePages'] = {}
	const changesQueue: SyncChangesResponse['changes'][number][][] = []
	const fetchChangesCalls: { since: number; scopes: string | undefined }[] = []
	const scopeFetches: { scope: string; after: string | null }[] = []
	let cursor = 10

	const transport: SyncTransport = {
		async fetchSnapshot(): Promise<SyncSnapshotResponse> {
			return {
				cursor,
				serverTime: new Date().toISOString(),
				projects: [baseProject()],
				projectStatuses: [baseStatus()],
				labels: [],
				cycles: [],
				issues: snapshotIssues,
				savedViews: [],
				notifications: [],
				docPages: []
			}
		},
		async fetchChanges(since, _limit, _clientId, scopes): Promise<SyncChangesResponse> {
			fetchChangesCalls.push({ since, scopes })
			const queued = changesQueue.shift()
			if (queued && queued.length > 0) {
				cursor += 1
				return {
					changes: queued,
					nextCursor: cursor,
					hasMore: false,
					serverTime: new Date().toISOString()
				}
			}
			return {
				changes: [],
				nextCursor: Math.max(since, cursor),
				hasMore: false,
				serverTime: new Date().toISOString()
			}
		},
		async fetchScopeSnapshot(scope, after): Promise<SyncScopeSnapshotResponse> {
			scopeFetches.push({ scope, after })
			const script = scopePages[scope] ?? []
			const page = script[scopeFetches.filter((c) => c.scope === scope).length - 1]
			const rows = page?.rows ?? []
			return {
				scope,
				rows,
				nextAfter: page?.nextAfter ?? null,
				hasMore: page?.hasMore ?? false
			}
		},
		async sendBatch(): Promise<MutationsBatchResponse> {
			return { cursor: 0, results: [] }
		}
	}

	return {
		transport,
		scopePages,
		changesQueue,
		fetchChangesCalls,
		scopeFetches,
		snapshotIssues: () => snapshotIssues,
		setSnapshotIssues: (issues) => {
			snapshotIssues = issues
		}
	}
}

function makeEngine(harness: ScopeHarness, storage?: MemoryReplicaStorage): HuriroSyncEngine {
	return new HuriroSyncEngine({
		workspaceId: WS_ID,
		currentUserId: USER_ID,
		storage: storage ?? new MemoryReplicaStorage(),
		transport: harness.transport
	})
}

describe('HuriroSyncEngine tier-2 scoped sync (§8.1, ADR-0031)', () => {
	test('hydrates issue_hist pages into the issues collection in order', async () => {
		const harness = makeScopeTransport()
		const h1 = histIssue(generateUuidV7(), { title: 'Hist 1' })
		const h2 = histIssue(generateUuidV7(), { title: 'Hist 2' })
		const h3 = histIssue(generateUuidV7(), { title: 'Hist 3' })
		harness.scopePages[HIST_SCOPE] = [
			{ rows: [h1, h2], nextAfter: 'cur1', hasMore: true },
			{ rows: [h3], nextAfter: null, hasMore: false }
		]

		const engine = makeEngine(harness)
		await engine.bootstrap()
		// Tier-2 rows are not part of the core snapshot — absent before subscription.
		expect(engine.collections.issues.get(h1.id)).toBeUndefined()

		await engine.subscribeScope(HIST_SCOPE)
		expect(harness.scopeFetches).toEqual([
			{ scope: HIST_SCOPE, after: null },
			{ scope: HIST_SCOPE, after: 'cur1' }
		])
		expect(engine.collections.issues.get(h1.id)?.title).toBe('Hist 1')
		expect(engine.collections.issues.get(h2.id)?.title).toBe('Hist 2')
		expect(engine.collections.issues.get(h3.id)?.title).toBe('Hist 3')
		expect(engine.getScopeState(HIST_SCOPE)?.state).toBe('ready')
		expect(engine.activeScopes()).toEqual([HIST_SCOPE])
		engine.dispose()
	})

	test('version-guarded upsert: stale hydration rows never clobber newer change-feed rows', async () => {
		const harness = makeScopeTransport()
		const issueId = generateUuidV7()
		// The collection already carries v5 (delivered by the core feed earlier);
		// the history snapshot is staler (v4) — the guard must keep v5.
		const newer = makeIssue(issueId, { title: 'Newer v5', version: 5, closedAt: daysAgoIso(40) })
		const staler = makeIssue(issueId, { title: 'Stale v4', version: 4, closedAt: daysAgoIso(40) })
		harness.setSnapshotIssues([newer])
		harness.scopePages[HIST_SCOPE] = [{ rows: [staler], nextAfter: null, hasMore: false }]

		const engine = makeEngine(harness)
		await engine.bootstrap()
		expect(engine.collections.issues.get(issueId)?.version).toBe(5)

		await engine.subscribeScope(HIST_SCOPE)
		const after = engine.collections.issues.get(issueId)
		expect(after?.version).toBe(5)
		expect(after?.title).toBe('Newer v5')
		engine.dispose()
	})

	test('release purges tier-2 rows but reopened issues survive the purge', async () => {
		const harness = makeScopeTransport()
		const closedId = generateUuidV7()
		const reopenedId = generateUuidV7()
		const openId = generateUuidV7()
		harness.scopePages[HIST_SCOPE] = [
			{
				rows: [
					histIssue(closedId, { title: 'Still ancient' }),
					histIssue(reopenedId, { title: 'About to reopen' })
				],
				nextAfter: null,
				hasMore: false
			}
		]
		harness.setSnapshotIssues([makeIssue(openId, { title: 'Tier-1 open' })])

		const engine = makeEngine(harness)
		await engine.bootstrap()
		await engine.subscribeScope(HIST_SCOPE)
		expect(engine.collections.issues.get(closedId)).toBeDefined()

		// The change feed delivers the reopen: closedAt cleared, version bumped —
		// the row is now tier-1 shaped and must survive any scope purge.
		harness.changesQueue.push([
			{
				cursor: 11,
				entity: 'issue',
				id: reopenedId,
				action: 'upsert',
				scope: [`project:${PROJ_ID}`],
				data: makeIssue(reopenedId, { title: 'Reopened', version: 2, closedAt: null }) as unknown as Record<
					string,
					unknown
				>,
				changedAt: new Date().toISOString()
			}
		])
		await engine.syncNow()
		expect(engine.collections.issues.get(reopenedId)?.closedAt).toBeNull()

		engine.releaseScope(HIST_SCOPE)
		expect(engine.getScopeState(HIST_SCOPE)).toBeNull()
		// Ancient row purged, reopened + tier-1 rows survive.
		expect(engine.collections.issues.get(closedId)).toBeUndefined()
		expect(engine.collections.issues.get(reopenedId)?.title).toBe('Reopened')
		expect(engine.collections.issues.get(openId)?.title).toBe('Tier-1 open')
		expect(engine.activeScopes()).toEqual([])
		engine.dispose()
	})

	test('active scopes ride along on /sync/changes once hydrated', async () => {
		const harness = makeScopeTransport()
		harness.scopePages[HIST_SCOPE] = [
			{ rows: [histIssue(generateUuidV7())], nextAfter: null, hasMore: false }
		]

		const engine = makeEngine(harness)
		await engine.bootstrap()
		const callsBeforeSubscribe = harness.fetchChangesCalls.length

		await engine.subscribeScope(HIST_SCOPE)
		await engine.syncNow()

		const scopedCalls = harness.fetchChangesCalls.slice(callsBeforeSubscribe)
		expect(scopedCalls.length).toBeGreaterThan(0)
		for (const call of scopedCalls) {
			expect(call.scopes?.split(',')).toContain(HIST_SCOPE)
		}

		// After release the param disappears again — backwards-compatible absence.
		engine.releaseScope(HIST_SCOPE)
		await engine.syncNow()
		const last = harness.fetchChangesCalls.at(-1)
		expect(last?.scopes).toBeUndefined()
		engine.dispose()
	})

	test('scope metadata round-trips through storage; stale rows boot lazily', async () => {
		const storage = new MemoryReplicaStorage()
		const harness = makeScopeTransport()
		const histId = generateUuidV7()
		harness.scopePages[HIST_SCOPE] = [{ rows: [histIssue(histId)], nextAfter: null, hasMore: false }]

		const engine1 = makeEngine(harness, storage)
		await engine1.bootstrap()
		await engine1.subscribeScope(HIST_SCOPE)
		await engine1.persistReplica()
		// Registry writes are fire-and-forget — flush the microtask queue.
		await new Promise((r) => setTimeout(r, 10))
		engine1.dispose()

		// "Restart" on the same storage: rows render instantly, scope is stale.
		const engine2 = makeEngine(harness, storage)
		await engine2.bootstrap({ skipNetwork: true })
		expect(engine2.collections.issues.get(histId)).toBeDefined()
		expect(engine2.getScopeState(HIST_SCOPE)?.state).toBe('stale')
		// Stale scopes join activeScopes so the change feed keeps their rows fresh.
		expect(engine2.activeScopes()).toEqual([HIST_SCOPE])
		// Lazy: no rehydration until something subscribes.
		const fetchesAtBoot = harness.scopeFetches.length

		await engine2.subscribeScope(HIST_SCOPE)
		expect(harness.scopeFetches.length).toBeGreaterThan(fetchesAtBoot)
		expect(engine2.getScopeState(HIST_SCOPE)?.state).toBe('ready')
		engine2.dispose()
	})

	test('410 snapshot resync preserves tier-2 rows but drops missing tier-1 rows', async () => {
		const harness = makeScopeTransport()
		const tier1Id = generateUuidV7()
		const histId = generateUuidV7()
		harness.setSnapshotIssues([makeIssue(tier1Id, { title: 'Tier-1 row' })])
		harness.scopePages[HIST_SCOPE] = [{ rows: [histIssue(histId)], nextAfter: null, hasMore: false }]

		const engine = makeEngine(harness)
		await engine.bootstrap()
		await engine.subscribeScope(HIST_SCOPE)
		expect(engine.collections.issues.get(tier1Id)).toBeDefined()
		expect(engine.collections.issues.get(histId)).toBeDefined()

		// Server snapshot no longer contains the tier-1 row (deleted remotely) —
		// tier-2 rows are NEVER in snapshots, so their absence is not a deletion.
		harness.setSnapshotIssues([])
		harness.changesQueue.push([]) // force cursor-advancing pull
		const originalFetch = harness.transport.fetchChanges.bind(harness.transport)
		let thrown = false
		harness.transport.fetchChanges = async (since, limit, clientId, scopes) => {
			if (!thrown) {
				thrown = true
				const err = new Error('gone') as Error & { status?: number }
				err.status = 410
				throw err
			}
			return originalFetch(since, limit, clientId, scopes)
		}

		await engine.syncNow()
		expect(engine.collections.issues.get(tier1Id)).toBeUndefined()
		expect(engine.collections.issues.get(histId)).toBeDefined()
		engine.dispose()
	})

	test('signOutAndWipe hard-clears tier-2 rows and the scope registry', async () => {
		const storage = new MemoryReplicaStorage()
		const harness = makeScopeTransport()
		const histId = generateUuidV7()
		harness.scopePages[HIST_SCOPE] = [{ rows: [histIssue(histId)], nextAfter: null, hasMore: false }]

		const engine = makeEngine(harness, storage)
		await engine.bootstrap()
		await engine.subscribeScope(HIST_SCOPE)
		expect(engine.collections.issues.get(histId)).toBeDefined()

		await engine.signOutAndWipe()
		expect(engine.collections.issues.get(histId)).toBeUndefined()
		expect(engine.getScopeState(HIST_SCOPE)).toBeNull()
		expect(engine.activeScopes()).toEqual([])
		// No scope metadata survives in storage — it embeds project ids.
		expect(await storage.get('huriro:scopes:v1')).toBeNull()
		engine.dispose()
	})

	test('subscribeScope rejects cleanly when the transport predates scope hydration', async () => {
		const harness = makeScopeTransport()
		const transport: SyncTransport = {
			fetchSnapshot: harness.transport.fetchSnapshot.bind(harness.transport),
			fetchChanges: harness.transport.fetchChanges.bind(harness.transport),
			sendBatch: harness.transport.sendBatch.bind(harness.transport)
			// intentionally no fetchScopeSnapshot — pre-M7 transport shape
		}
		const engine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage: new MemoryReplicaStorage(),
			transport
		})
		await engine.bootstrap()
		await expect(engine.subscribeScope(HIST_SCOPE)).rejects.toThrow(/does not support/)
		expect(engine.getScopeState(HIST_SCOPE)?.state).toBe('error')
		engine.dispose()
	})

	test('LRU eviction purges rows and notifies through onScopeEvicted', async () => {
		const harness = makeScopeTransport()
		// Quota fits exactly one scope — the second hydration must evict the
		// first. Byte accounting mirrors the manager: JSON.stringify(row).length.
		const proj2 = '0190a0b1-9a9a-7000-8000-000000000099'
		const scope2 = `issue_hist:${proj2}`
		const pad = 'x'.repeat(150)
		const aId = generateUuidV7()
		const bId = generateUuidV7()
		const rowA = histIssue(aId, { title: pad })
		const rowB = histIssue(bId, { title: pad, projectId: proj2 })
		const quota = Math.max(JSON.stringify(rowA).length, JSON.stringify(rowB).length) + 8
		harness.scopePages[HIST_SCOPE] = [{ rows: [rowA], nextAfter: null, hasMore: false }]
		harness.scopePages[scope2] = [{ rows: [rowB], nextAfter: null, hasMore: false }]

		const evicted: string[] = []
		const storage = new MemoryReplicaStorage()
		const engine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport: harness.transport,
			scopeQuotaBytes: quota,
			onScopeEvicted: (scope) => {
				evicted.push(scope)
			}
		})

		await engine.bootstrap()
		await engine.subscribeScope(HIST_SCOPE)
		expect(engine.collections.issues.get(aId)).toBeDefined()
		await engine.subscribeScope(scope2)

		expect(evicted).toEqual([HIST_SCOPE])
		// Eviction purged the rows from the collection, not just the registry.
		expect(engine.collections.issues.get(aId)).toBeUndefined()
		expect(engine.collections.issues.get(bId)).toBeDefined()
		engine.dispose()
	})

	test('HttpSyncTransport encodes scopes and after params on the wire', async () => {
		const calls: string[] = []
		const transport = new HttpSyncTransport({
			baseUrl: 'https://huriro.example/',
			workspaceId: WS_ID,
			httpAdapter: async (config) => {
				calls.push(config.url ?? '')
				if ((config.url ?? '').includes('scope-snapshot')) {
					return {
						data: { scope: HIST_SCOPE, rows: [], nextAfter: null, hasMore: false },
						status: 200,
						statusText: 'OK',
						headers: {},
						config
					}
				}
				return {
					data: { changes: [], nextCursor: 1, hasMore: false, serverTime: new Date().toISOString() },
					status: 200,
					statusText: 'OK',
					headers: {},
					config
				}
			}
		})
		await transport.fetchChanges(5, 200, 'client-1', `${HIST_SCOPE},db:abc`)
		expect(calls[0]).toContain(`scopes=${encodeURIComponent(`${HIST_SCOPE},db:abc`)}`)

		await transport.fetchScopeSnapshot?.(HIST_SCOPE, 'cursor;with/special=chars')
		expect(calls[1]).toContain(`scope=${encodeURIComponent(HIST_SCOPE)}`)
		expect(calls[1]).toContain(`after=${encodeURIComponent('cursor;with/special=chars')}`)
	})
})
