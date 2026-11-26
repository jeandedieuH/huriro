import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import type {
	DocPageDto,
	IssueDto,
	MutationEnvelope,
	MutationsBatchResponse,
	ProjectDto,
	ProjectStatusDto,
	SyncChangesResponse,
	SyncSnapshotResponse
} from '@huriro/contracts'
import {
	generateUuidV7,
	HttpSyncTransport,
	HuriroSyncEngine,
	MAX_OUTBOX_MUTATIONS,
	MemoryReplicaStorage,
	type SqliteDatabaseLike,
	SqliteReplicaStorage,
	type SyncTransport,
	WsSignalClient
} from './index'

const WS_ID = '0190a0b1-9a9a-7000-8000-000000000001'
const USER_ID = '0190a0b1-9a9a-7000-8000-000000000002'
const PROJ_ID = '0190a0b1-9a9a-7000-8000-000000000003'
const STATUS_TODO = '0190a0b1-9a9a-7000-8000-000000000004'

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

describe('HuriroSyncEngine', () => {
	test('offline edit survives tab close (engine restart) and replays exactly once with Idempotency-Key', async () => {
		const storage = new MemoryReplicaStorage()
		const sentBatches: MutationEnvelope[][] = []
		let serverCursor = 1
		let createdFromServer: IssueDto | null = null

		const makeTransport = (): SyncTransport => ({
			async fetchSnapshot(): Promise<SyncSnapshotResponse> {
				return {
					cursor: serverCursor,
					serverTime: new Date().toISOString(),
					projects: [baseProject()],
					projectStatuses: [baseStatus()],
					labels: [],
					cycles: [],
					issues: createdFromServer ? [createdFromServer] : [],
					savedViews: [],
					notifications: [],
					docPages: []
				}
			},
			async fetchChanges(since): Promise<SyncChangesResponse> {
				return {
					changes: [],
					nextCursor: Math.max(since, serverCursor),
					hasMore: false,
					serverTime: new Date().toISOString()
				}
			},
			async sendBatch(mutations): Promise<MutationsBatchResponse> {
				sentBatches.push([...mutations])
				const m = mutations[0]
				if (!m) return { cursor: serverCursor, results: [] }
				serverCursor += 1
				createdFromServer = makeIssue(m.entityId, {
					title: String(m.patch['title']),
					number: 1,
					identifier: 'ENG-1'
				})
				return {
					cursor: serverCursor,
					results: [
						{
							mutationId: m.mutationId,
							status: 200,
							outcome: 'applied',
							data: createdFromServer as unknown as Record<string, unknown>
						}
					]
				}
			}
		})

		// First "tab" boots online, then goes offline, creates an issue, and closes.
		const tab1 = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport: makeTransport()
		})
		await tab1.bootstrap()
		tab1.setOnline(false)

		const created = await tab1.createIssue({ projectId: PROJ_ID, title: 'Offline queued issue' })
		expect(tab1.getStatus().pendingCount).toBe(1)
		expect(tab1.collections.issues.get(created.id)?.title).toBe('Offline queued issue')
		tab1.dispose()

		// Simulate tab reopen on the SAME persisted ReplicaStorage.
		const tab2 = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport: makeTransport()
		})
		tab2.setOnline(false)
		await tab2.bootstrap()
		// Rendered immediately from persisted replica + re-applied optimistic queue.
		expect(tab2.collections.issues.get(created.id)?.title).toBe('Offline queued issue')
		expect(tab2.getStatus().pendingCount).toBe(1)
		expect(sentBatches).toHaveLength(0)

		// Now network returns → replays exactly once!
		tab2.setOnline(true)
		await tab2.flushOutbox()

		expect(sentBatches).toHaveLength(1)
		expect(sentBatches[0]?.[0]?.entityId).toBe(created.id)
		expect(tab2.getStatus().pendingCount).toBe(0)
		expect(tab2.collections.issues.get(created.id)?.identifier).toBe('ENG-1')
		tab2.dispose()
	})

	test('409 stale_version auto-merges disjoint fields onto currentVersion', async () => {
		const storage = new MemoryReplicaStorage()
		const issueId = generateUuidV7()
		let serverIssue = makeIssue(issueId, { title: 'Original', priority: 1, version: 1 })
		let batchCall = 0

		const transport: SyncTransport = {
			async fetchSnapshot() {
				return {
					cursor: 1,
					serverTime: new Date().toISOString(),
					projects: [baseProject()],
					projectStatuses: [baseStatus()],
					labels: [],
					cycles: [],
					issues: [serverIssue],
					savedViews: [],
					notifications: [],
					docPages: []
				}
			},
			async fetchChanges(since) {
				return { changes: [], nextCursor: since, hasMore: false, serverTime: new Date().toISOString() }
			},
			async sendBatch(mutations) {
				batchCall += 1
				const m = mutations[0]
				if (!m) return { cursor: 1, results: [] }
				if (batchCall === 1) {
					// Simulate another user changed title to v2 while we edited priority offline.
					serverIssue = { ...serverIssue, title: 'Remote title', version: 2 }
					return {
						cursor: 2,
						results: [
							{
								mutationId: m.mutationId,
								status: 409,
								outcome: 'stale_version',
								currentVersion: 2,
								currentEntity: serverIssue as unknown as Record<string, unknown>,
								changedFields: ['title']
							}
						]
					}
				}
				expect(m.baseVersion).toBe(2)
				expect(m.patch).toEqual({ priority: 4 })
				serverIssue = { ...serverIssue, priority: 4, version: 3 }
				return {
					cursor: 3,
					results: [
						{
							mutationId: m.mutationId,
							status: 200,
							outcome: 'applied',
							data: serverIssue as unknown as Record<string, unknown>
						}
					]
				}
			}
		}

		const engine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport
		})
		await engine.bootstrap()
		engine.setOnline(false)
		await engine.updateIssue(issueId, { priority: 4 })

		engine.setOnline(true)
		await engine.flushOutbox()

		expect(batchCall).toBe(2)
		expect(engine.getConflicts()).toHaveLength(0)
		expect(engine.collections.issues.get(issueId)?.title).toBe('Remote title')
		expect(engine.collections.issues.get(issueId)?.priority).toBe(4)
		expect(engine.collections.issues.get(issueId)?.version).toBe(3)
		engine.dispose()
	})

	test('409 stale_version on overlapping field surfaces conflict and resolves cleanly', async () => {
		const storage = new MemoryReplicaStorage()
		const issueId = generateUuidV7()
		let serverIssue = makeIssue(issueId, { title: 'Original', priority: 1, version: 1 })
		let attempt = 0

		const transport: SyncTransport = {
			async fetchSnapshot() {
				return {
					cursor: 1,
					serverTime: new Date().toISOString(),
					projects: [baseProject()],
					projectStatuses: [baseStatus()],
					labels: [],
					cycles: [],
					issues: [serverIssue],
					savedViews: [],
					notifications: [],
					docPages: []
				}
			},
			async fetchChanges(since) {
				return { changes: [], nextCursor: since, hasMore: false, serverTime: new Date().toISOString() }
			},
			async sendBatch(mutations) {
				attempt += 1
				const m = mutations[0]
				if (!m) return { cursor: 1, results: [] }
				if (attempt === 1) {
					serverIssue = { ...serverIssue, title: 'Server won?', version: 2 }
					return {
						cursor: 2,
						results: [
							{
								mutationId: m.mutationId,
								status: 409,
								outcome: 'stale_version',
								currentVersion: 2,
								currentEntity: serverIssue as unknown as Record<string, unknown>,
								changedFields: ['title']
							}
						]
					}
				}
				serverIssue = { ...serverIssue, title: String(m.patch['title']), version: 3 }
				return {
					cursor: 3,
					results: [
						{
							mutationId: m.mutationId,
							status: 200,
							outcome: 'applied',
							data: serverIssue as unknown as Record<string, unknown>
						}
					]
				}
			}
		}

		const engine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport
		})
		await engine.bootstrap()
		engine.setOnline(false)
		await engine.updateIssue(issueId, { title: 'My local title' })
		engine.setOnline(true)
		await engine.flushOutbox()

		const conflicts = engine.getConflicts()
		expect(conflicts).toHaveLength(1)
		expect(conflicts[0]?.overlappingFields).toEqual(['title'])

		const firstConflict = conflicts[0]
		if (!firstConflict) throw new Error('expected conflict')
		await engine.resolveConflict(firstConflict.id, 'keep_local')
		expect(engine.getConflicts()).toHaveLength(0)
		expect(engine.collections.issues.get(issueId)?.title).toBe('My local title')
		expect(engine.collections.issues.get(issueId)?.version).toBe(3)
		engine.dispose()
	})

	test('handles 410 Gone snapshot resync, grant scoped snapshot, and revoke purge', async () => {
		const storage = new MemoryReplicaStorage()
		const issueId = generateUuidV7()
		let phase: 'initial' | 'expired' | 'grant' | 'revoke' = 'initial'
		let snapshotCalls = 0
		const requestedScopes: (string | undefined)[] = []

		const transport: SyncTransport = {
			async fetchSnapshot(scope) {
				snapshotCalls += 1
				requestedScopes.push(scope)
				return {
					cursor: snapshotCalls * 10,
					serverTime: new Date().toISOString(),
					projects: [baseProject()],
					projectStatuses: [baseStatus()],
					labels: [],
					cycles: [],
					issues: phase === 'grant' ? [makeIssue(issueId, { title: 'Granted secret issue' })] : [],
					savedViews: [],
					notifications: [],
					docPages: []
				}
			},
			async fetchChanges(since) {
				if (phase === 'expired') {
					phase = 'grant'
					const err = new Error('gone') as Error & { status?: number }
					err.status = 410
					throw err
				}
				if (phase === 'grant') {
					return {
						changes: [
							{
								cursor: since + 1,
								entity: 'project',
								id: PROJ_ID,
								action: 'grant',
								scope: [`project:${PROJ_ID}`],
								data: null,
								changedAt: new Date().toISOString()
							}
						],
						nextCursor: since + 1,
						hasMore: false,
						serverTime: new Date().toISOString()
					}
				}
				return {
					changes: [
						{
							cursor: since + 1,
							entity: 'project',
							id: PROJ_ID,
							action: 'revoke',
							scope: [`project:${PROJ_ID}`],
							data: null,
							changedAt: new Date().toISOString()
						}
					],
					nextCursor: since + 1,
					hasMore: false,
					serverTime: new Date().toISOString()
				}
			},
			async sendBatch() {
				return { results: [], cursor: 10 }
			}
		}

		const engine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport
		})
		await engine.bootstrap()
		expect(engine.getStatus().cursor).toBe(10)

		// 410 Gone triggers full snapshot resync
		phase = 'expired'
		await engine.syncNow()
		expect(snapshotCalls).toBe(2)

		// Grant event triggers scoped snapshot fetch
		phase = 'grant'
		await engine.syncNow()
		expect(requestedScopes).toContain(`project:${PROJ_ID}`)
		expect(engine.collections.issues.get(issueId)?.title).toBe('Granted secret issue')

		// Revoke event purges the project & all its issues from local replica
		phase = 'revoke'
		await engine.syncNow()
		expect(engine.collections.issues.get(issueId)).toBeUndefined()
		expect(engine.collections.projects.get(PROJ_ID)).toBeUndefined()
		engine.dispose()
	})

	test('enforces the 5,000-mutation outbox cap with explicit error', async () => {
		const storage = new MemoryReplicaStorage()
		await storage.set(
			'huriro:outbox:v1',
			JSON.stringify(
				Array.from({ length: MAX_OUTBOX_MUTATIONS }, (_, i) => ({
					envelope: {
						mutationId: `0190a0b1-9a9a-7000-8000-${String(i).padStart(12, '0')}`,
						workspaceId: WS_ID,
						entity: 'issue',
						entityId: generateUuidV7(),
						op: 'create',
						patch: { title: 'x' }
					},
					retryCount: 0,
					nextAttemptAt: 0
				}))
			)
		)
		const engine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage
		})
		await engine.bootstrap({ skipNetwork: true })

		await expect(engine.createIssue({ projectId: PROJ_ID, title: 'Overflow' })).rejects.toThrow(
			/5000|5,000|limit/
		)
		engine.dispose()
	})

	test('replicates doc_pages deltas, grant/revoke scopes, and optimistic create/update/move/delete', async () => {
		const storage = new MemoryReplicaStorage()
		const docId = generateUuidV7()
		const secretDocId = generateUuidV7()
		let phase: 'initial' | 'grant_doc' | 'revoke_doc' = 'initial'
		const requestedScopes: (string | undefined)[] = []

		const makeDoc = (id: string, over: Partial<DocPageDto> = {}): DocPageDto => ({
			id,
			workspaceId: WS_ID,
			parentId: null,
			path: id,
			depth: 0,
			slug: `doc-${id.slice(0, 6)}`,
			title: 'Doc Page',
			icon: null,
			visibility: 'workspace',
			isTemplate: false,
			isFavorite: false,
			position: 'V',
			createdBy: USER_ID,
			archivedAt: null,
			createdAt: '2026-11-22T00:00:00Z',
			updatedAt: '2026-11-22T00:00:00Z',
			version: 1,
			byteSize: 42,
			...over
		})

		const transport: SyncTransport = {
			async fetchSnapshot(scope) {
				requestedScopes.push(scope)
				return {
					cursor: 10,
					serverTime: new Date().toISOString(),
					projects: [],
					projectStatuses: [],
					labels: [],
					cycles: [],
					issues: [],
					savedViews: [],
					notifications: [],
					docPages:
						phase === 'grant_doc'
							? [makeDoc(secretDocId, { title: 'Private RFC', visibility: 'private' })]
							: []
				}
			},
			async fetchChanges(since) {
				if (phase === 'grant_doc') {
					return {
						changes: [
							{
								cursor: since + 1,
								entity: 'doc_page',
								id: secretDocId,
								action: 'grant',
								scope: [`doc_page:${secretDocId}`],
								data: null,
								changedAt: new Date().toISOString()
							}
						],
						nextCursor: since + 1,
						hasMore: false,
						serverTime: new Date().toISOString()
					}
				}
				return {
					changes: [
						{
							cursor: since + 1,
							entity: 'doc_page',
							id: secretDocId,
							action: 'revoke',
							scope: [`doc_page:${secretDocId}`],
							data: null,
							changedAt: new Date().toISOString()
						}
					],
					nextCursor: since + 1,
					hasMore: false,
					serverTime: new Date().toISOString()
				}
			},
			async sendBatch(mutations) {
				return {
					cursor: 11,
					results: mutations.map((m) => ({
						mutationId: m.mutationId,
						status: 200,
						outcome: 'applied',
						data: makeDoc(m.entityId, {
							id: m.entityId,
							title: String(m.patch['title'] ?? 'Updated Doc'),
							parentId: (m.patch['parentId'] as string | null) ?? null,
							version: (m.baseVersion ?? 0) + 1
						}) as unknown as Record<string, unknown>
					}))
				}
			}
		}

		const engine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport
		})
		await engine.bootstrap()

		// Grant scoped snapshot + revoke purge
		phase = 'grant_doc'
		await engine.syncNow()
		expect(requestedScopes).toContain(`doc_page:${secretDocId}`)
		expect(engine.collections.docPages.get(secretDocId)?.title).toBe('Private RFC')

		phase = 'revoke_doc'
		await engine.syncNow()
		expect(engine.collections.docPages.get(secretDocId)).toBeUndefined()

		// Optimistic doc lifecycle offline -> flush
		engine.setOnline(false)
		const created = await engine.createDocPage({ id: docId, title: 'Architecture' })
		expect(engine.collections.docPages.get(created.id)?.title).toBe('Architecture')
		await engine.updateDocPage(docId, { title: 'Architecture v2' })
		expect(engine.collections.docPages.get(docId)?.title).toBe('Architecture v2')
		await engine.moveDocPage(docId, { parentId: null, position: 'a' })
		expect(engine.collections.docPages.get(docId)?.position).toBe('a')

		engine.setOnline(true)
		await engine.flushOutbox()
		expect(engine.getStatus().pendingCount).toBe(0)

		await engine.deleteDocPage(docId)
		expect(engine.collections.docPages.get(docId)).toBeUndefined()
		engine.dispose()
	})

	test('SqliteReplicaStorage persists replica and outbox across HuriroSyncEngine restarts', async () => {
		const sqlite = new Database(':memory:')
		const dbAdapter: SqliteDatabaseLike = {
			async execAsync(source) {
				sqlite.run(source)
			},
			async getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null> {
				const row = sqlite.query(source).get(...(params as [string | number | bigint | boolean | null]))
				return (row as T | null) ?? null
			},
			async getAllAsync<T>(source: string, ...params: unknown[]): Promise<T[]> {
				return sqlite.query(source).all(...(params as [string | number | bigint | boolean | null])) as T[]
			},
			async runAsync(source: string, ...params: unknown[]): Promise<unknown> {
				return sqlite.query(source).run(...(params as [string | number | bigint | boolean | null]))
			}
		}

		const storage1 = new SqliteReplicaStorage(dbAdapter, WS_ID)
		await storage1.set('probe', 'value-1')
		expect(await storage1.get('probe')).toBe('value-1')
		expect(await storage1.keys()).toEqual(['probe'])
		await storage1.delete('probe')
		expect(await storage1.get('probe')).toBeNull()

		const sentBatches: MutationEnvelope[][] = []
		const serverDocs = new Map<string, IssueDto>()
		const issueId = generateUuidV7()

		const makeTransport = (): SyncTransport => ({
			async fetchSnapshot(): Promise<SyncSnapshotResponse> {
				return {
					cursor: 1,
					serverTime: new Date().toISOString(),
					projects: [baseProject()],
					projectStatuses: [baseStatus()],
					labels: [],
					cycles: [],
					issues: [...serverDocs.values()],
					savedViews: [],
					notifications: [],
					docPages: []
				}
			},
			async fetchChanges(since) {
				return {
					changes: [],
					nextCursor: since,
					hasMore: false,
					serverTime: new Date().toISOString()
				}
			},
			async sendBatch(mutations) {
				sentBatches.push([...mutations])
				for (const m of mutations) {
					if (m.entity === 'issue' && m.op === 'create') {
						serverDocs.set(
							m.entityId,
							makeIssue(m.entityId, {
								title: String(m.patch['title'] ?? 'Offline SQLite issue'),
								version: 1
							})
						)
					}
				}
				return {
					cursor: 2,
					results: mutations.map((m) => ({
						mutationId: m.mutationId,
						status: 201,
						outcome: 'applied',
						data: serverDocs.get(m.entityId) as unknown as Record<string, unknown>
					}))
				}
			}
		})

		const engine1 = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage: storage1,
			transport: makeTransport()
		})
		await engine1.bootstrap()
		expect(engine1.getStatus().storageMode).toBe('sqlite')
		engine1.setOnline(false)
		await engine1.createIssue({
			id: issueId,
			projectId: PROJ_ID,
			title: 'Created offline in SQLite'
		})
		expect(engine1.getStatus().pendingCount).toBe(1)
		engine1.dispose()

		// Re-open engine against the same SQLite database (simulates mobile app cold restart).
		const storage2 = new SqliteReplicaStorage(dbAdapter, WS_ID)
		const engine2 = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage: storage2,
			transport: makeTransport()
		})
		await engine2.bootstrap({ skipNetwork: true })
		expect(engine2.collections.issues.get(issueId)?.title).toBe('Created offline in SQLite')
		expect(engine2.getStatus().pendingCount).toBe(1)

		await engine2.flushOutbox()
		expect(engine2.getStatus().pendingCount).toBe(0)
		expect(sentBatches).toHaveLength(1)
		expect(serverDocs.get(issueId)?.title).toBe('Created offline in SQLite')
		await storage2.clear()
		expect(await storage2.keys()).toEqual([])
		engine2.dispose()
		sqlite.close()
	})

	test('HttpSyncTransport forwards clientName, credentials, and dynamic headers', async () => {
		const calls: { url: string; headers: Headers; withCredentials: boolean | undefined }[] = []
		const snapshot: SyncSnapshotResponse = {
			cursor: 1,
			serverTime: new Date().toISOString(),
			projects: [],
			projectStatuses: [],
			labels: [],
			cycles: [],
			issues: [],
			savedViews: [],
			notifications: [],
			docPages: []
		}

		const transport = new HttpSyncTransport({
			baseUrl: 'https://huriro.example/',
			workspaceId: WS_ID,
			clientName: 'huriro-mobile',
			credentials: 'omit',
			getHeaders: () => ({ authorization: 'Bearer test-mobile-token' }),
			httpAdapter: async (config) => {
				calls.push({
					url: config.url ?? '',
					headers: new Headers(config.headers as Record<string, string>),
					withCredentials: config.withCredentials
				})
				return { data: snapshot, status: 200, statusText: 'OK', headers: {}, config }
			}
		})
		await transport.fetchSnapshot()
		expect(calls).toHaveLength(1)
		expect(calls[0]?.url).toBe('https://huriro.example/api/v1/sync/snapshot')
		// fetch `credentials: 'omit'` ⇔ axios `withCredentials: false`
		expect(calls[0]?.withCredentials).toBe(false)
		expect(calls[0]?.headers.get('x-huriro-client')).toBe('huriro-mobile')
		expect(calls[0]?.headers.get('authorization')).toBe('Bearer test-mobile-token')
	})

	test('drains concurrent project and doc_page creates without a manual flush', async () => {
		const storage = new MemoryReplicaStorage()
		const sentIds: string[] = []
		const nowIso = '2026-11-24T00:00:00Z'

		const transport: SyncTransport = {
			async fetchSnapshot() {
				return {
					cursor: 1,
					serverTime: nowIso,
					projects: [],
					projectStatuses: [],
					labels: [],
					cycles: [],
					issues: [],
					savedViews: [],
					notifications: [],
					docPages: []
				}
			},
			async fetchChanges(since) {
				return { changes: [], nextCursor: since, hasMore: false, serverTime: nowIso }
			},
			async sendBatch(mutations) {
				// Delay first batch so createDocPage enqueues while flush #1 is still in flight.
				await new Promise((r) => setTimeout(r, 20))
				for (const m of mutations) sentIds.push(m.entityId)
				return {
					cursor: 2,
					results: mutations.map((m) => ({
						mutationId: m.mutationId,
						status: 200,
						outcome: 'applied',
						data:
							m.entity === 'project'
								? ({
										...baseProject(),
										id: m.entityId,
										key: String(m.patch['key']),
										name: String(m.patch['name'])
									} as unknown as Record<string, unknown>)
								: ({
										id: m.entityId,
										workspaceId: WS_ID,
										parentId: null,
										path: m.entityId,
										depth: 0,
										slug: String(m.patch['slug'] ?? 'concurrent-doc'),
										title: String(m.patch['title']),
										icon: null,
										visibility: 'workspace',
										isTemplate: false,
										isFavorite: false,
										position: 'V',
										createdBy: USER_ID,
										archivedAt: null,
										createdAt: nowIso,
										updatedAt: nowIso,
										version: 1,
										byteSize: 0
									} as unknown as Record<string, unknown>)
					}))
				}
			}
		}

		const engine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport
		})
		await engine.bootstrap()
		const proj = await engine.createProject({ key: 'CONC', name: 'Concurrent Proj' })
		const doc = await engine.createDocPage({ title: 'Concurrent Doc' })

		const deadline = Date.now() + 1000
		while (engine.getStatus().pendingCount > 0 && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 10))
		}

		expect(engine.getStatus().pendingCount).toBe(0)
		expect(sentIds).toEqual([proj.id, doc.id])
		expect(engine.collections.projects.get(proj.id)?.name).toBe('Concurrent Proj')
		expect(engine.collections.docPages.get(doc.id)?.title).toBe('Concurrent Doc')
		engine.dispose()
	})

	test('surfaces lastError on transient 500, force-flushes on demand, and schedules auto-retry', async () => {
		const storage = new MemoryReplicaStorage()
		let shouldFail = true
		const nowIso = '2026-11-24T00:00:00Z'

		const transport: SyncTransport = {
			async fetchSnapshot() {
				return {
					cursor: 1,
					serverTime: nowIso,
					projects: [],
					projectStatuses: [],
					labels: [],
					cycles: [],
					issues: [],
					savedViews: [],
					notifications: [],
					docPages: []
				}
			},
			async fetchChanges(since) {
				return { changes: [], nextCursor: since, hasMore: false, serverTime: nowIso }
			},
			async sendBatch(mutations) {
				if (shouldFail) {
					const err = new Error('mutations failed (500)') as Error & { status?: number }
					err.status = 500
					throw err
				}
				return {
					cursor: 2,
					results: mutations.map((m) => ({
						mutationId: m.mutationId,
						status: 200,
						outcome: 'applied',
						data: {
							...baseProject(),
							id: m.entityId,
							key: String(m.patch['key']),
							name: String(m.patch['name'])
						} as unknown as Record<string, unknown>
					}))
				}
			}
		}

		const engine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport
		})
		await engine.bootstrap()
		const proj = await engine.createProject({ key: 'RTRY', name: 'Retry Proj' })
		await engine.flushOutbox()

		expect(engine.getStatus().pendingCount).toBe(1)
		expect(engine.getStatus().lastError).toContain('500')

		// Subsequent syncNow() succeeds on GET /changes without clearing the active flush error.
		await engine.syncNow()
		expect(engine.getStatus().lastError).toContain('500')

		// Normal flushOutbox() respects backoff; force: true bypasses backoff immediately.
		shouldFail = false
		await engine.flushOutbox()
		expect(engine.getStatus().pendingCount).toBe(1)

		await engine.flushOutbox({ force: true })
		expect(engine.getStatus().pendingCount).toBe(0)
		expect(engine.getStatus().lastError).toBeNull()
		expect(engine.collections.projects.get(proj.id)?.key).toBe('RTRY')

		// Second transient failure drains automatically via scheduled timer (~1000-1300ms).
		shouldFail = true
		const proj2 = await engine.createProject({ key: 'AUTO', name: 'Auto Retry' })
		await engine.flushOutbox()
		expect(engine.getStatus().pendingCount).toBe(1)

		shouldFail = false
		const timerDeadline = Date.now() + 2500
		while (engine.getStatus().pendingCount > 0 && Date.now() < timerDeadline) {
			await new Promise((r) => setTimeout(r, 25))
		}
		expect(engine.getStatus().pendingCount).toBe(0)
		expect(engine.collections.projects.get(proj2.id)?.key).toBe('AUTO')
		engine.dispose()
	})

	test('preserves pending optimistic project, saved_view, and doc_page across full snapshot resyncs', async () => {
		const storage = new MemoryReplicaStorage()
		const nowIso = '2026-11-24T00:00:00Z'
		let triggerExpired = false

		const transport: SyncTransport = {
			async fetchSnapshot() {
				return {
					cursor: 5,
					serverTime: nowIso,
					projects: [],
					projectStatuses: [],
					labels: [],
					cycles: [],
					issues: [],
					savedViews: [],
					notifications: [],
					docPages: []
				}
			},
			async fetchChanges(since) {
				if (triggerExpired) {
					const err = new Error('sync_cursor_expired') as Error & { status?: number }
					err.status = 410
					throw err
				}
				return { changes: [], nextCursor: since, hasMore: false, serverTime: nowIso }
			},
			async sendBatch() {
				const err = new Error('upstream unavailable (503)') as Error & { status?: number }
				err.status = 503
				throw err
			}
		}

		const engine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport
		})
		await engine.bootstrap()
		const proj = await engine.createProject({ key: 'KEEP', name: 'Keep Optimistic' })
		const view = await engine.createSavedView({ name: 'Keep View', layout: 'board' })
		const doc = await engine.createDocPage({ title: 'Keep Doc' })
		await engine.flushOutbox()
		expect(engine.getStatus().pendingCount).toBe(3)

		// 410 Gone triggers full snapshot resync with empty server collections — pending items must stay visible.
		triggerExpired = true
		await engine.syncNow()

		expect(engine.getStatus().pendingCount).toBe(3)
		expect(engine.collections.projects.get(proj.id)?.name).toBe('Keep Optimistic')
		expect(engine.collections.savedViews.get(view.id)?.name).toBe('Keep View')
		expect(engine.collections.docPages.get(doc.id)?.title).toBe('Keep Doc')
		engine.dispose()
	})

	test('binds fetchRealtimeTicket method cleanly when useRealtimeTicket is enabled', async () => {
		const storage = new MemoryReplicaStorage()
		let ticketRequests = 0
		const nowIso = '2026-11-24T00:00:00Z'

		const transport = new HttpSyncTransport({
			baseUrl: 'https://huriro.example',
			workspaceId: WS_ID,
			httpAdapter: async (config) => {
				const url = config.url ?? ''
				if (url.endsWith('/api/v1/realtime/ticket')) {
					ticketRequests += 1
					return {
						data: { ticket: 'rt_bound_ok', expiresAt: nowIso },
						status: 200,
						statusText: 'OK',
						headers: {},
						config
					}
				}
				if (url.endsWith('/api/v1/sync/snapshot')) {
					return {
						data: {
							cursor: 1,
							serverTime: nowIso,
							projects: [],
							projectStatuses: [],
							labels: [],
							cycles: [],
							issues: [],
							savedViews: [],
							notifications: [],
							docPages: []
						},
						status: 200,
						statusText: 'OK',
						headers: {},
						config
					}
				}
				return {
					data: { changes: [], nextCursor: 1, hasMore: false, serverTime: nowIso },
					status: 200,
					statusText: 'OK',
					headers: {},
					config
				}
			}
		})

		const OrigWebSocket = globalThis.WebSocket
		const sentHellos: string[] = []
		class StubWebSocket {
			static OPEN = 1
			readyState = 1
			onopen: (() => void) | null = null
			onmessage: ((ev: { data: string }) => void) | null = null
			onclose: (() => void) | null = null
			onerror: (() => void) | null = null
			constructor(_url: string) {
				queueMicrotask(() => this.onopen?.())
			}
			send(data: string) {
				sentHellos.push(data)
			}
			close() {}
		}
		globalThis.WebSocket = StubWebSocket as unknown as typeof WebSocket

		const engine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport,
			wsUrl: 'wss://huriro.example/ws',
			useRealtimeTicket: true
		})
		try {
			await engine.bootstrap()
			const deadline = Date.now() + 500
			while (sentHellos.length === 0 && Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 10))
			}
			expect(ticketRequests).toBe(1)
			expect(sentHellos[0]).toContain('rt_bound_ok')
		} finally {
			engine.dispose()
			globalThis.WebSocket = OrigWebSocket
		}
	})

	test('treats 404 not_found on deleteDocPage and deleteIssue as idempotent while rolling back 403 forbidden deletes', async () => {
		const storage = new MemoryReplicaStorage()
		const ghostDocId = generateUuidV7()
		const forbiddenDocId = generateUuidV7()
		const ghostIssueId = generateUuidV7()
		const nowIso = '2026-11-24T00:00:00Z'
		const rejectedErrors: string[] = []

		const makeDoc = (id: string, title: string): DocPageDto => ({
			id,
			workspaceId: WS_ID,
			parentId: null,
			path: id,
			depth: 0,
			slug: title.toLowerCase().replace(/\s+/g, '-'),
			title,
			icon: null,
			visibility: 'workspace',
			isTemplate: false,
			isFavorite: false,
			position: 'V',
			createdBy: USER_ID,
			archivedAt: null,
			createdAt: nowIso,
			updatedAt: nowIso,
			version: 1,
			byteSize: 0
		})

		const transport: SyncTransport = {
			async fetchSnapshot() {
				return {
					cursor: 1,
					serverTime: nowIso,
					projects: [baseProject()],
					projectStatuses: [baseStatus()],
					labels: [],
					cycles: [],
					issues: [makeIssue(ghostIssueId, { title: 'Ghost issue' })],
					savedViews: [],
					notifications: [],
					docPages: [makeDoc(ghostDocId, 'Repro Doc'), makeDoc(forbiddenDocId, 'Protected Doc')]
				}
			},
			async fetchChanges(since) {
				return { changes: [], nextCursor: since, hasMore: false, serverTime: nowIso }
			},
			async sendBatch(mutations) {
				return {
					cursor: 2,
					results: mutations.map((m) => {
						if (m.entityId === forbiddenDocId) {
							return {
								mutationId: m.mutationId,
								status: 403,
								outcome: 'forbidden',
								error: 'Forbidden'
							}
						}
						return {
							mutationId: m.mutationId,
							status: 404,
							outcome: 'not_found',
							error: m.entity === 'doc_page' ? 'Document page not found' : 'Issue not found'
						}
					})
				}
			}
		}

		const engine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport,
			onMutationRejected: (err) => rejectedErrors.push(err)
		})
		await engine.bootstrap()
		engine.setOnline(false)

		await engine.deleteDocPage(ghostDocId)
		await engine.deleteIssue(ghostIssueId)
		expect(engine.collections.docPages.get(ghostDocId)).toBeUndefined()
		expect(engine.collections.issues.get(ghostIssueId)).toBeUndefined()

		engine.setOnline(true)
		await engine.flushOutbox()

		expect(engine.getStatus().pendingCount).toBe(0)
		expect(rejectedErrors).toEqual([])
		expect(engine.collections.docPages.get(ghostDocId)).toBeUndefined()
		expect(engine.collections.issues.get(ghostIssueId)).toBeUndefined()

		// Confirm persisted replica does not resurrect ghost records across reload.
		engine.dispose()
		const reloaded = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport
		})
		await reloaded.bootstrap({ skipNetwork: true })
		expect(reloaded.collections.docPages.get(ghostDocId)).toBeUndefined()
		expect(reloaded.collections.issues.get(ghostIssueId)).toBeUndefined()

		// 403 forbidden on delete still rolls back and reports rejection.
		reloaded.setOnline(true)
		await reloaded.deleteDocPage(forbiddenDocId)
		await reloaded.flushOutbox()
		expect(reloaded.collections.docPages.get(forbiddenDocId)?.title).toBe('Protected Doc')
		expect(rejectedErrors).toEqual([]) // `reloaded` didn't attach callback, verify via separate engine below
		reloaded.dispose()

		const rejected2: string[] = []
		const engine3 = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport,
			onMutationRejected: (err) => rejected2.push(err)
		})
		await engine3.bootstrap()
		await engine3.deleteDocPage(forbiddenDocId)
		await engine3.flushOutbox()
		expect(engine3.collections.docPages.get(forbiddenDocId)?.title).toBe('Protected Doc')
		expect(rejected2).toEqual(['Forbidden'])
		engine3.dispose()
	})

	test('resyncSnapshot purges stale ghost docPages while preserving pending optimistic creates', async () => {
		const storage = new MemoryReplicaStorage()
		const ghostDocId = generateUuidV7()
		const nowIso = '2026-11-24T00:00:00Z'
		let serverDocs: DocPageDto[] = [
			{
				id: ghostDocId,
				workspaceId: WS_ID,
				parentId: null,
				path: ghostDocId,
				depth: 0,
				slug: 'repro-doc',
				title: 'Repro Doc',
				icon: null,
				visibility: 'workspace',
				isTemplate: false,
				isFavorite: false,
				position: 'V',
				createdBy: USER_ID,
				archivedAt: null,
				createdAt: nowIso,
				updatedAt: nowIso,
				version: 1,
				byteSize: 0
			}
		]
		let failSnapshot = false

		const transport: SyncTransport = {
			async fetchSnapshot() {
				if (failSnapshot) {
					const err = new Error('snapshot error') as Error & { status?: number }
					err.status = 500
					throw err
				}
				return {
					cursor: serverDocs.length > 0 ? 1 : 2,
					serverTime: nowIso,
					projects: [],
					projectStatuses: [],
					labels: [],
					cycles: [],
					issues: [],
					savedViews: [],
					notifications: [],
					docPages: serverDocs
				}
			},
			async fetchChanges(since) {
				return { changes: [], nextCursor: since, hasMore: false, serverTime: nowIso }
			},
			async sendBatch() {
				return { cursor: 2, results: [] }
			}
		}

		const engine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport
		})
		await engine.bootstrap()
		expect(engine.collections.docPages.get(ghostDocId)?.title).toBe('Repro Doc')

		engine.setOnline(false)
		const localDoc = await engine.createDocPage({ title: 'Offline Draft' })
		engine.setOnline(true)

		// Server no longer has ghostDocId; resyncSnapshot removes it while keeping localDoc.
		serverDocs = []
		const ok = await engine.resyncSnapshot()
		expect(ok).toBe(true)
		expect(engine.collections.docPages.get(ghostDocId)).toBeUndefined()
		expect(engine.collections.docPages.get(localDoc.id)?.title).toBe('Offline Draft')

		failSnapshot = true
		const failed = await engine.resyncSnapshot()
		expect(failed).toBe(false)
		engine.dispose()
	})

	test('legacy persisted replica hydrates for instant render but does not trust its cursor', async () => {
		const storage = new MemoryReplicaStorage()
		const issue = makeIssue(generateUuidV7(), { title: 'Recovered task' })
		const fullSnapshot: SyncSnapshotResponse = {
			cursor: 58,
			serverTime: new Date().toISOString(),
			projects: [baseProject()],
			projectStatuses: [baseStatus()],
			labels: [],
			cycles: [],
			issues: [issue],
			savedViews: [],
			notifications: [],
			docPages: []
		}

		// Replicas written before replica schema versioning have no schemaVersion.
		// Their entity arrays may still be useful for offline-first rendering, but
		// their cursor cannot prove that the local collections are complete.
		await storage.set(
			'huriro:replica:v1',
			JSON.stringify({
				cursor: 58,
				projects: [],
				projectStatuses: [],
				labels: [],
				cycles: [],
				issues: [],
				savedViews: [],
				notifications: [],
				docPages: []
			})
		)

		let snapshotCalls = 0
		let changeCalls = 0
		const transport: SyncTransport = {
			async fetchSnapshot() {
				snapshotCalls += 1
				return fullSnapshot
			},
			async fetchChanges(since) {
				changeCalls += 1
				return { changes: [], nextCursor: since, hasMore: false, serverTime: new Date().toISOString() }
			},
			async sendBatch() {
				return { cursor: 58, results: [] }
			}
		}

		const engine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport
		})
		await engine.bootstrap()

		expect(snapshotCalls).toBe(1)
		expect(changeCalls).toBe(0)
		expect(engine.getStatus().cursor).toBe(58)
		expect(engine.collections.projects.get(PROJ_ID)?.name).toBe('Engineering')
		expect(engine.collections.issues.get(issue.id)?.title).toBe('Recovered task')
		engine.dispose()
	})

	test('schema-versioned persisted replica keeps trusting its cursor across restarts', async () => {
		const storage = new MemoryReplicaStorage()
		const transport: SyncTransport = {
			async fetchSnapshot() {
				return {
					cursor: 10,
					serverTime: new Date().toISOString(),
					projects: [baseProject()],
					projectStatuses: [baseStatus()],
					labels: [],
					cycles: [],
					issues: [],
					savedViews: [],
					notifications: [],
					docPages: []
				}
			},
			async fetchChanges(since) {
				return { changes: [], nextCursor: since, hasMore: false, serverTime: new Date().toISOString() }
			},
			async sendBatch() {
				return { cursor: 10, results: [] }
			}
		}

		const first = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport
		})
		await first.bootstrap()
		expect(first.collections.projects.get(PROJ_ID)?.name).toBe('Engineering')
		first.dispose()

		let snapshotCallsAfterRestart = 0
		let changeCallsAfterRestart = 0
		const restartTransport: SyncTransport = {
			...transport,
			async fetchSnapshot(scope) {
				snapshotCallsAfterRestart += 1
				return transport.fetchSnapshot(scope)
			},
			async fetchChanges(since, limit, clientId) {
				changeCallsAfterRestart += 1
				return transport.fetchChanges(since, limit, clientId)
			}
		}
		const restarted = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport: restartTransport
		})
		await restarted.bootstrap()

		expect(snapshotCallsAfterRestart).toBe(0)
		expect(changeCallsAfterRestart).toBe(1)
		expect(restarted.collections.projects.get(PROJ_ID)?.name).toBe('Engineering')
		restarted.dispose()
	})

	test('planning mutations survive restart, reapply optimistic rows, and replay with project-scoped patches', async () => {
		const storage = new MemoryReplicaStorage()
		const sentBatches: MutationEnvelope[][] = []
		const serverRows = new Map<string, Record<string, unknown>>()
		const transport: SyncTransport = {
			async fetchSnapshot() {
				return {
					cursor: 1,
					serverTime: new Date().toISOString(),
					projects: [baseProject()],
					projectStatuses: [baseStatus()],
					labels: [],
					cycles: [],
					issues: [],
					savedViews: [],
					notifications: [],
					docPages: []
				}
			},
			async fetchChanges(since) {
				return {
					changes: [],
					nextCursor: Math.max(since, 1),
					hasMore: false,
					serverTime: new Date().toISOString()
				}
			},
			async sendBatch(mutations) {
				sentBatches.push([...mutations])
				const results = mutations.map((mutation) => {
					const key = `${mutation.entity}:${mutation.entityId}`
					const base = serverRows.get(key) ?? {
						id: mutation.entityId,
						workspaceId: WS_ID,
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
						version: 1
					}
					const data = {
						...base,
						...mutation.patch,
						...(mutation.entity === 'project_update' ? { createdBy: USER_ID } : {}),
						version: mutation.op === 'create' ? 1 : 2
					}
					serverRows.set(key, data)
					return {
						mutationId: mutation.mutationId,
						status: 200,
						outcome: 'applied' as const,
						data
					}
				})
				return { cursor: 2, results }
			}
		}

		const first = new HuriroSyncEngine({ workspaceId: WS_ID, currentUserId: USER_ID, storage, transport })
		await first.bootstrap()
		first.setOnline(false)
		const initiative = await first.createInitiative({ name: 'Offline initiative', projectIds: [PROJ_ID] })
		await first.updateInitiative(initiative.id, { health: 'at_risk' })
		const milestone = await first.createProjectMilestone(PROJ_ID, { name: 'Offline milestone' })
		await first.updateProjectMilestone(PROJ_ID, milestone.id, { status: 'completed' })
		const update = await first.createProjectUpdate(PROJ_ID, {
			health: 'on_track',
			bodyText: 'Offline update'
		})
		expect(first.getStatus().pendingCount).toBe(5)
		first.dispose()

		const restarted = new HuriroSyncEngine({ workspaceId: WS_ID, currentUserId: USER_ID, storage, transport })
		restarted.setOnline(false)
		await restarted.bootstrap()
		expect(restarted.collections.initiatives.get(initiative.id)?.health).toBe('at_risk')
		expect(restarted.collections.projectMilestones.get(milestone.id)?.status).toBe('completed')
		expect(restarted.collections.projectUpdates.get(update.id)?.bodyText).toBe('Offline update')
		expect(restarted.getStatus().pendingCount).toBe(5)

		restarted.setOnline(true)
		await restarted.flushOutbox({ force: true })
		const envelopes = sentBatches.flat()
		expect(envelopes.map((envelope) => envelope.entity)).toEqual([
			'initiative',
			'initiative',
			'project_milestone',
			'project_milestone',
			'project_update'
		])
		expect(envelopes[2]?.patch['projectId']).toBe(PROJ_ID)
		expect(envelopes[3]?.patch['projectId']).toBe(PROJ_ID)
		expect(envelopes[4]?.patch['projectId']).toBe(PROJ_ID)
		expect(restarted.getStatus().pendingCount).toBe(0)
		expect(restarted.collections.initiatives.get(initiative.id)?.health).toBe('at_risk')
		expect(restarted.collections.projectMilestones.get(milestone.id)?.status).toBe('completed')
		expect(restarted.collections.projectUpdates.get(update.id)?.createdBy).toBe(USER_ID)
		restarted.dispose()
	})

	test('coalesces rapid concurrent updateDocPage calls without self-inflicted 409 conflicts', async () => {
		const storage = new MemoryReplicaStorage()
		const docId = generateUuidV7()
		const nowIso = '2026-11-25T00:00:00Z'
		let serverDoc: DocPageDto = {
			id: docId,
			workspaceId: WS_ID,
			parentId: null,
			path: docId,
			depth: 0,
			slug: 'handbook',
			title: 'Engineering handbook',
			icon: null,
			coverFileId: null,
			coverGradient: 'ocean',
			coverPositionY: 50,
			visibility: 'workspace',
			isTemplate: false,
			isFavorite: false,
			position: 'V',
			createdBy: USER_ID,
			archivedAt: null,
			createdAt: nowIso,
			updatedAt: nowIso,
			version: 1,
			byteSize: 0
		}
		const sentBatches: MutationEnvelope[][] = []

		const transport: SyncTransport = {
			async fetchSnapshot() {
				return {
					cursor: 1,
					serverTime: nowIso,
					projects: [],
					projectStatuses: [],
					labels: [],
					cycles: [],
					issues: [],
					savedViews: [],
					notifications: [],
					docPages: [serverDoc]
				}
			},
			async fetchChanges(since) {
				return { changes: [], nextCursor: since, hasMore: false, serverTime: nowIso }
			},
			async sendBatch(mutations) {
				sentBatches.push([...mutations])
				await new Promise((r) => setTimeout(r, 20))
				const results = mutations.map((m) => {
					if (m.baseVersion !== serverDoc.version) {
						return {
							mutationId: m.mutationId,
							status: 409,
							outcome: 'stale_version' as const,
							currentVersion: serverDoc.version,
							currentEntity: serverDoc as unknown as Record<string, unknown>,
							changedFields: ['coverPositionY']
						}
					}
					serverDoc = {
						...serverDoc,
						...(m.patch as Partial<DocPageDto>),
						version: serverDoc.version + 1
					}
					return {
						mutationId: m.mutationId,
						status: 200,
						outcome: 'applied' as const,
						data: serverDoc as unknown as Record<string, unknown>
					}
				})
				return { cursor: serverDoc.version, results }
			}
		}

		const engine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport
		})
		await engine.bootstrap()

		for (let pos = 30; pos < 80; pos += 1) {
			void engine.updateDocPage(docId, { coverPositionY: pos })
		}

		const deadline = Date.now() + 2000
		while (engine.getStatus().pendingCount > 0 && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 10))
		}

		expect(engine.getStatus().pendingCount).toBe(0)
		expect(engine.getConflicts()).toHaveLength(0)
		expect(engine.collections.docPages.get(docId)?.coverPositionY).toBe(79)
		expect(serverDoc.coverPositionY).toBe(79)
		expect(sentBatches.length).toBeLessThanOrEqual(3)
		engine.dispose()
	})

	test('coalesces offline doc_page updates, splits batches before move, and rebases cleanly', async () => {
		const storage = new MemoryReplicaStorage()
		const docId = generateUuidV7()
		const nowIso = '2026-11-25T00:00:00Z'
		let serverDoc: DocPageDto = {
			id: docId,
			workspaceId: WS_ID,
			parentId: null,
			path: docId,
			depth: 0,
			slug: 'handbook',
			title: 'Engineering handbook',
			icon: null,
			coverFileId: null,
			coverGradient: null,
			coverPositionY: 50,
			visibility: 'workspace',
			isTemplate: false,
			isFavorite: false,
			position: 'V',
			createdBy: USER_ID,
			archivedAt: null,
			createdAt: nowIso,
			updatedAt: nowIso,
			version: 1,
			byteSize: 0
		}

		const transport: SyncTransport = {
			async fetchSnapshot() {
				return {
					cursor: 1,
					serverTime: nowIso,
					projects: [],
					projectStatuses: [],
					labels: [],
					cycles: [],
					issues: [],
					savedViews: [],
					notifications: [],
					docPages: [serverDoc]
				}
			},
			async fetchChanges(since) {
				return { changes: [], nextCursor: since, hasMore: false, serverTime: nowIso }
			},
			async sendBatch(mutations) {
				const results = mutations.map((m) => {
					if (m.baseVersion !== serverDoc.version) {
						return {
							mutationId: m.mutationId,
							status: 409,
							outcome: 'stale_version' as const,
							currentVersion: serverDoc.version,
							currentEntity: serverDoc as unknown as Record<string, unknown>,
							changedFields: ['coverPositionY', 'position']
						}
					}
					serverDoc = {
						...serverDoc,
						...(m.op === 'move'
							? {
									parentId: (m.patch['parentId'] as string | null) ?? null,
									position: String(m.patch['position'] ?? serverDoc.position)
								}
							: (m.patch as Partial<DocPageDto>)),
						version: serverDoc.version + 1
					}
					return {
						mutationId: m.mutationId,
						status: 200,
						outcome: 'applied' as const,
						data: serverDoc as unknown as Record<string, unknown>
					}
				})
				return { cursor: serverDoc.version, results }
			}
		}

		const engine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport
		})
		await engine.bootstrap()
		engine.setOnline(false)

		await engine.updateDocPage(docId, { coverGradient: 'ocean' })
		await engine.updateDocPage(docId, { coverPositionY: 20 })
		await engine.updateDocPage(docId, { coverPositionY: 35 })
		await engine.updateDocPage(docId, { coverPositionY: 60 })
		await engine.updateDocPage(docId, { coverPositionY: 82 })
		await engine.moveDocPage(docId, { parentId: null, position: 'a' })

		expect(engine.getStatus().pendingCount).toBe(2)

		engine.setOnline(true)
		await engine.flushOutbox()

		expect(engine.getConflicts()).toHaveLength(0)
		expect(engine.getStatus().pendingCount).toBe(0)
		expect(engine.collections.docPages.get(docId)?.coverGradient).toBe('ocean')
		expect(engine.collections.docPages.get(docId)?.coverPositionY).toBe(82)
		expect(engine.collections.docPages.get(docId)?.position).toBe('a')
		expect(engine.collections.docPages.get(docId)?.version).toBe(3)
		engine.dispose()
	})

	test('preserves all fields on concurrent non-awaited updateDocPage calls with async storage', async () => {
		const innerStorage = new MemoryReplicaStorage()
		const delayedStorage = {
			mode: innerStorage.mode,
			get: (key: string) => innerStorage.get(key),
			async set(key: string, value: string) {
				await new Promise((r) => setTimeout(r, 10))
				await innerStorage.set(key, value)
			},
			delete: (key: string) => innerStorage.delete(key),
			keys: () => innerStorage.keys(),
			clear: () => innerStorage.clear()
		}
		const docId = generateUuidV7()
		const nowIso = '2026-11-25T00:00:00Z'
		let serverDoc: DocPageDto = {
			id: docId,
			workspaceId: WS_ID,
			parentId: null,
			path: docId,
			depth: 0,
			slug: 'handbook',
			title: 'Engineering handbook',
			icon: null,
			coverFileId: null,
			coverGradient: null,
			coverPositionY: 50,
			visibility: 'workspace',
			isTemplate: false,
			isFavorite: false,
			position: 'V',
			createdBy: USER_ID,
			archivedAt: null,
			createdAt: nowIso,
			updatedAt: nowIso,
			version: 1,
			byteSize: 0
		}
		const sentBatches: MutationEnvelope[][] = []

		const transport: SyncTransport = {
			async fetchSnapshot() {
				return {
					cursor: 1,
					serverTime: nowIso,
					projects: [],
					projectStatuses: [],
					labels: [],
					cycles: [],
					issues: [],
					savedViews: [],
					notifications: [],
					docPages: [serverDoc]
				}
			},
			async fetchChanges(since) {
				return { changes: [], nextCursor: since, hasMore: false, serverTime: nowIso }
			},
			async sendBatch(mutations) {
				sentBatches.push([...mutations])
				const m = mutations[0]
				if (!m) return { cursor: 1, results: [] }
				serverDoc = {
					...serverDoc,
					...(m.patch as Partial<DocPageDto>),
					version: serverDoc.version + 1
				}
				return {
					cursor: serverDoc.version,
					results: [
						{
							mutationId: m.mutationId,
							status: 200,
							outcome: 'applied',
							data: serverDoc as unknown as Record<string, unknown>
						}
					]
				}
			}
		}

		const engine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage: delayedStorage,
			transport
		})
		await engine.bootstrap()
		engine.setOnline(false)

		await Promise.all([
			engine.updateDocPage(docId, { coverGradient: 'ocean' }),
			engine.updateDocPage(docId, { coverPositionY: 75 })
		])

		expect(engine.getStatus().pendingCount).toBe(1)
		expect(engine.collections.docPages.get(docId)?.coverGradient).toBe('ocean')
		expect(engine.collections.docPages.get(docId)?.coverPositionY).toBe(75)

		engine.setOnline(true)
		await engine.flushOutbox()
		expect(sentBatches).toHaveLength(1)
		expect(sentBatches[0]?.[0]?.patch).toEqual({ coverGradient: 'ocean', coverPositionY: 75 })
		expect(serverDoc.coverGradient).toBe('ocean')
		expect(serverDoc.coverPositionY).toBe(75)
		engine.dispose()
	})

	test('deduplicates repeated conflicts for the same doc_page on bootstrap and during flush', async () => {
		const storage = new MemoryReplicaStorage()
		const docId = generateUuidV7()
		const nowIso = '2026-11-25T00:00:00Z'
		const baseDoc: DocPageDto = {
			id: docId,
			workspaceId: WS_ID,
			parentId: null,
			path: docId,
			depth: 0,
			slug: 'handbook',
			title: 'Engineering handbook',
			icon: null,
			coverFileId: null,
			coverGradient: 'ocean',
			coverPositionY: 50,
			visibility: 'workspace',
			isTemplate: false,
			isFavorite: false,
			position: 'V',
			createdBy: USER_ID,
			archivedAt: null,
			createdAt: nowIso,
			updatedAt: nowIso,
			version: 1,
			byteSize: 0
		}

		const duplicateConflicts = [10, 25, 40].map((pos) => ({
			id: generateUuidV7(),
			mutationId: generateUuidV7(),
			entity: 'doc_page',
			entityId: docId,
			title: baseDoc.title,
			overlappingFields: ['coverPositionY'],
			nonConflictingPatch: {},
			baseValues: { ...baseDoc },
			localValues: { coverPositionY: pos },
			serverValues: { ...baseDoc, coverPositionY: 51, version: 2 },
			serverVersion: 2
		}))
		await storage.set('huriro:conflicts:v1', JSON.stringify(duplicateConflicts))

		const serverDoc: DocPageDto = { ...baseDoc, coverPositionY: 51, version: 2 }
		const transport: SyncTransport = {
			async fetchSnapshot() {
				return {
					cursor: 2,
					serverTime: nowIso,
					projects: [],
					projectStatuses: [],
					labels: [],
					cycles: [],
					issues: [],
					savedViews: [],
					notifications: [],
					docPages: [serverDoc]
				}
			},
			async fetchChanges(since) {
				return { changes: [], nextCursor: since, hasMore: false, serverTime: nowIso }
			},
			async sendBatch(mutations) {
				return {
					cursor: 2,
					results: mutations.map((m) => ({
						mutationId: m.mutationId,
						status: 409,
						outcome: 'stale_version' as const,
						currentVersion: 2,
						currentEntity: serverDoc as unknown as Record<string, unknown>,
						changedFields: ['coverPositionY']
					}))
				}
			}
		}

		const engine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport
		})
		await engine.bootstrap({ skipNetwork: true })
		expect(engine.getConflicts()).toHaveLength(1)
		expect(engine.getConflicts()[0]?.localValues).toEqual({ coverPositionY: 40 })

		const rawPersisted = await storage.get('huriro:conflicts:v1')
		expect(rawPersisted).toBeTruthy()
		expect(JSON.parse(rawPersisted ?? '[]')).toHaveLength(1)
		engine.dispose()

		// Verify flush also merges a new conflict on the same entity into the existing single entry.
		const engine2 = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport
		})
		await engine2.bootstrap()
		engine2.setOnline(false)
		await engine2.updateDocPage(docId, { coverPositionY: 85 })
		engine2.setOnline(true)
		await engine2.flushOutbox()

		expect(engine2.getConflicts()).toHaveLength(1)
		expect(engine2.getConflicts()[0]?.localValues).toEqual({ coverPositionY: 85 })
		engine2.dispose()
	})

	test('createProject and updateProject preserve M7/M8 policy across restart and resolve conflicts', async () => {
		const storage = new MemoryReplicaStorage()
		const sentBatches: Parameters<SyncTransport['sendBatch']>[0][] = []
		let serverCursor = 1
		let serverProj = {
			...baseProject(),
			name: 'Existing Project',
			triageEnabled: false,
			cycleEnabled: false,
			version: 1
		}
		let simulateConflict = false

		const makeTransport = (): SyncTransport => ({
			async fetchSnapshot() {
				return {
					cursor: serverCursor,
					serverTime: new Date().toISOString(),
					projects: [serverProj],
					projectStatuses: [baseStatus()],
					labels: [],
					cycles: [],
					issues: [],
					savedViews: [],
					notifications: [],
					docPages: []
				}
			},
			async fetchChanges(since) {
				return {
					changes: [],
					nextCursor: Math.max(since, serverCursor),
					hasMore: false,
					serverTime: new Date().toISOString()
				}
			},
			async sendBatch(mutations) {
				sentBatches.push([...mutations])
				const results: MutationsBatchResponse['results'] = []
				for (const m of mutations) {
					if (m.entity === 'project' && m.op === 'create') {
						serverCursor += 1
						const createdRow = {
							...baseProject(),
							id: m.entityId,
							key: String(m.patch['key']),
							name: String(m.patch['name']),
							visibility: (m.patch['visibility'] as 'workspace' | 'private' | undefined) ?? 'workspace',
							triageEnabled: Boolean(m.patch['triageEnabled']),
							cycleEnabled: Boolean(m.patch['cycleEnabled']),
							cycleDurationDays: Number(m.patch['cycleDurationDays'] ?? 14),
							cycleCooldownDays: Number(m.patch['cycleCooldownDays'] ?? 0),
							cycleAutoRolloverMode:
								(m.patch['cycleAutoRolloverMode'] as 'next_cycle' | 'backlog' | 'none' | undefined) ??
								'next_cycle',
							cycleStartWeekday: Number(m.patch['cycleStartWeekday'] ?? 1),
							version: 1
						}
						results.push({
							mutationId: m.mutationId,
							status: 200,
							outcome: 'applied',
							data: createdRow as unknown as Record<string, unknown>
						})
					} else if (m.entity === 'project' && m.op === 'update') {
						if (simulateConflict) {
							simulateConflict = false
							serverProj = { ...serverProj, name: 'Remote Project Name', version: serverProj.version + 1 }
							results.push({
								mutationId: m.mutationId,
								status: 409,
								outcome: 'stale_version',
								currentVersion: serverProj.version,
								currentEntity: serverProj as unknown as Record<string, unknown>,
								changedFields: ['name']
							})
						} else {
							serverCursor += 1
							serverProj = {
								...serverProj,
								...(m.patch as Partial<typeof serverProj>),
								version: serverProj.version + 1
							}
							results.push({
								mutationId: m.mutationId,
								status: 200,
								outcome: 'applied',
								data: serverProj as unknown as Record<string, unknown>
							})
						}
					}
				}
				return { cursor: serverCursor, results }
			}
		})

		const tab1 = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport: makeTransport()
		})
		await tab1.bootstrap()
		tab1.setOnline(false)

		const createdProj = await tab1.createProject({
			key: 'OPS',
			name: 'Operations',
			visibility: 'private',
			triageEnabled: true,
			cycleEnabled: true,
			cycleDurationDays: 21,
			cycleCooldownDays: 7,
			cycleAutoRolloverMode: 'backlog',
			cycleStartWeekday: 3
		})
		await tab1.updateProject(PROJ_ID, {
			triageEnabled: true,
			cycleEnabled: true,
			cycleDurationDays: 7,
			cycleStartWeekday: 5
		})

		expect(tab1.collections.projects.get(createdProj.id)).toMatchObject({
			key: 'OPS',
			visibility: 'private',
			triageEnabled: true,
			cycleEnabled: true,
			cycleDurationDays: 21,
			cycleCooldownDays: 7,
			cycleAutoRolloverMode: 'backlog',
			cycleStartWeekday: 3
		})
		expect(tab1.collections.projects.get(PROJ_ID)).toMatchObject({
			triageEnabled: true,
			cycleEnabled: true,
			cycleDurationDays: 7,
			cycleStartWeekday: 5
		})
		tab1.dispose()

		const tab2 = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport: makeTransport()
		})
		tab2.setOnline(false)
		await tab2.bootstrap()
		expect(tab2.collections.projects.get(createdProj.id)?.cycleDurationDays).toBe(21)
		expect(tab2.collections.projects.get(PROJ_ID)?.triageEnabled).toBe(true)

		tab2.setOnline(true)
		await tab2.flushOutbox()

		const sent = sentBatches.flat()
		expect(sent.find((m) => m.entity === 'project' && m.op === 'create')?.patch).toMatchObject({
			key: 'OPS',
			triageEnabled: true,
			cycleEnabled: true,
			cycleDurationDays: 21,
			cycleCooldownDays: 7,
			cycleAutoRolloverMode: 'backlog',
			cycleStartWeekday: 3
		})
		expect(sent.find((m) => m.entity === 'project' && m.op === 'update')?.patch).toMatchObject({
			triageEnabled: true,
			cycleEnabled: true,
			cycleDurationDays: 7,
			cycleStartWeekday: 5
		})

		// Trigger and resolve a `project` conflict.
		tab2.setOnline(false)
		await tab2.updateProject(PROJ_ID, { name: 'Local Project Name' })
		simulateConflict = true
		tab2.setOnline(true)
		await tab2.flushOutbox()

		const conflicts = tab2.getConflicts()
		expect(conflicts).toHaveLength(1)
		expect(conflicts[0]?.entity).toBe('project')
		const conflict = conflicts[0]
		if (!conflict) throw new Error('expected project conflict')
		await tab2.resolveConflict(conflict.id, 'keep_local')
		expect(tab2.getConflicts()).toHaveLength(0)
		expect(tab2.collections.projects.get(PROJ_ID)?.name).toBe('Local Project Name')
		tab2.dispose()
	})

	test('createIssue preserves M7/M8 fields, triageStatus, assigneeType clearing, and offline restart', async () => {
		const storage = new MemoryReplicaStorage()
		const sentBatches: Parameters<SyncTransport['sendBatch']>[0][] = []
		const cycleId = generateUuidV7()
		const milestoneId = generateUuidV7()
		let serverCursor = 1
		let serverIssue: ReturnType<typeof makeIssue> | null = null

		const makeTransport = (): SyncTransport => ({
			async fetchSnapshot() {
				return {
					cursor: serverCursor,
					serverTime: new Date().toISOString(),
					projects: [{ ...baseProject(), triageEnabled: true, cycleEnabled: true }],
					projectStatuses: [baseStatus()],
					labels: [],
					cycles: [
						{
							id: cycleId,
							workspaceId: WS_ID,
							projectId: PROJ_ID,
							name: 'Sprint 1',
							description: '',
							status: 'active',
							startsAt: '2026-12-01',
							endsAt: '2026-12-14',
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							version: 1
						}
					],
					issues: [],
					savedViews: [],
					notifications: [],
					docPages: []
				}
			},
			async fetchChanges(since) {
				return {
					changes: [],
					nextCursor: Math.max(since, serverCursor),
					hasMore: false,
					serverTime: new Date().toISOString()
				}
			},
			async sendBatch(mutations) {
				sentBatches.push([...mutations])
				const results: MutationsBatchResponse['results'] = []
				for (const m of mutations) {
					serverCursor += 1
					if (m.op === 'create') {
						serverIssue = makeIssue(m.entityId, {
							title: String(m.patch['title']),
							cycleId: (m.patch['cycleId'] as string | null | undefined) ?? null,
							milestoneId: (m.patch['milestoneId'] as string | null | undefined) ?? null,
							startDate: (m.patch['startDate'] as string | null | undefined) ?? null,
							dueDate: (m.patch['dueDate'] as string | null | undefined) ?? null,
							estimate: (m.patch['estimate'] as number | null | undefined) ?? null,
							sourceKind: (m.patch['sourceKind'] as 'chat' | 'manual' | undefined) ?? 'manual',
							triageStatus: m.patch['triage'] ? 'pending' : 'none',
							assigneeId: (m.patch['assigneeId'] as string | null | undefined) ?? null,
							assigneeType: (m.patch['assigneeType'] as 'user' | 'agent' | null | undefined) ?? null,
							number: 1,
							identifier: 'ENG-1',
							version: 1
						})
					} else if (serverIssue) {
						serverIssue = {
							...serverIssue,
							...(m.patch as Partial<typeof serverIssue>),
							version: serverIssue.version + 1
						}
					}
					results.push({
						mutationId: m.mutationId,
						status: 200,
						outcome: 'applied',
						data: serverIssue as unknown as Record<string, unknown>
					})
				}
				return { cursor: serverCursor, results }
			}
		})

		const tab1 = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport: makeTransport()
		})
		await tab1.bootstrap()
		tab1.setOnline(false)

		const created = await tab1.createIssue({
			projectId: PROJ_ID,
			title: 'Full M7/M8 issue',
			statusId: STATUS_TODO,
			priority: 1,
			assigneeId: USER_ID,
			assigneeType: 'user',
			cycleId,
			milestoneId,
			startDate: '2026-12-01',
			dueDate: '2026-12-10',
			estimate: 5,
			sourceKind: 'chat',
			triage: true
		})

		expect(tab1.collections.issues.get(created.id)).toMatchObject({
			cycleId,
			milestoneId,
			startDate: '2026-12-01',
			dueDate: '2026-12-10',
			estimate: 5,
			sourceKind: 'chat',
			triageStatus: 'pending',
			assigneeId: USER_ID,
			assigneeType: 'user'
		})

		await tab1.updateIssue(created.id, { assigneeId: null })
		expect(tab1.collections.issues.get(created.id)?.assigneeId).toBeNull()
		expect(tab1.collections.issues.get(created.id)?.assigneeType).toBeNull()
		tab1.dispose()

		const tab2 = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport: makeTransport()
		})
		tab2.setOnline(false)
		await tab2.bootstrap()

		expect(tab2.collections.issues.get(created.id)).toMatchObject({
			cycleId,
			milestoneId,
			startDate: '2026-12-01',
			dueDate: '2026-12-10',
			estimate: 5,
			sourceKind: 'chat',
			triageStatus: 'pending',
			assigneeId: null,
			assigneeType: null
		})

		tab2.setOnline(true)
		await tab2.flushOutbox()

		const sent = sentBatches.flat()
		const createMut = sent.find((m) => m.entity === 'issue' && m.op === 'create')
		expect(createMut?.patch).toMatchObject({
			cycleId,
			milestoneId,
			startDate: '2026-12-01',
			dueDate: '2026-12-10',
			estimate: 5,
			sourceKind: 'chat',
			triage: true
		})
		const updateMut = sent.find((m) => m.entity === 'issue' && m.op === 'update')
		if (updateMut) {
			expect(updateMut.patch).toMatchObject({ assigneeId: null, assigneeType: null })
		} else {
			expect(createMut?.patch).toMatchObject({ assigneeId: null, assigneeType: null })
		}
		expect(tab2.collections.issues.get(created.id)?.assigneeType).toBeNull()
		expect(tab2.collections.issues.get(created.id)?.triageStatus).toBe('pending')
		tab2.dispose()
	})
})

class MockWebSocket {
	static readonly OPEN = 1
	readyState = 0
	onopen: ((ev: Event) => void) | null = null
	onmessage: ((ev: MessageEvent) => void) | null = null
	onclose: ((ev: CloseEvent) => void) | null = null
	onerror: ((ev: Event) => void) | null = null
	readonly sent: string[] = []
	closedCode: number | null = null
	closedReason: string | null = null
	readonly url: string

	constructor(url: string) {
		this.url = url
	}

	send(data: string): void {
		this.sent.push(data)
	}

	close(code = 1000, reason = ''): void {
		this.closedCode = code
		this.closedReason = reason
		this.readyState = 3
	}

	simulateOpen(): void {
		this.readyState = 1
		this.onopen?.({} as Event)
	}

	simulateMessage(payload: unknown): void {
		this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent)
	}

	simulateClose(code = 1006, reason = ''): void {
		this.closedCode = code
		this.closedReason = reason
		this.readyState = 3
		this.onclose?.({} as CloseEvent)
	}
}

describe('Self-healing sync & WsSignalClient resilience', () => {
	test('WsSignalClient detects silent zombie sockets via heartbeat watchdog and emits onReconnect', async () => {
		const sockets: MockWebSocket[] = []
		const connStates: boolean[] = []
		let reconnectCount = 0
		const cursorSignals: number[] = []

		const client = new WsSignalClient({
			workspaceId: WS_ID,
			wsUrl: 'wss://huriro.example/ws',
			getCursor: () => 1,
			heartbeatTimeoutMs: 80,
			pollIntervalMs: 60_000,
			webSocketFactory: (url) => {
				const ws = new MockWebSocket(url)
				sockets.push(ws)
				return ws as unknown as WebSocket
			},
			onCursorSignal: (cursor) => {
				cursorSignals.push(cursor)
			},
			onRevokeSignal: () => {},
			onPollFallback: () => {},
			onConnectionChange: (connected) => {
				connStates.push(connected)
			},
			onReconnect: () => {
				reconnectCount += 1
			}
		})

		try {
			client.start()
			expect(sockets).toHaveLength(1)
			const ws1 = sockets[0]
			if (!ws1) throw new Error('expected first socket')
			ws1.simulateOpen()
			ws1.simulateMessage({ t: 'ready', serverCursor: 1, heartbeatMs: 40 })
			expect(connStates.at(-1)).toBe(true)
			expect(reconnectCount).toBe(0)

			// A ping at 45ms refreshes lastActivityAt and answers with pong without reconnecting.
			await new Promise((r) => setTimeout(r, 45))
			ws1.simulateMessage({ t: 'ping' })
			expect(ws1.sent.some((raw) => JSON.parse(raw).t === 'pong')).toBe(true)
			await new Promise((r) => setTimeout(r, 45))
			expect(sockets).toHaveLength(1)
			expect(ws1.readyState).toBe(1)

			// Stopping pings lets heartbeat watchdog expire and force-reconnect.
			const deadline = Date.now() + 400
			while (sockets.length < 2 && Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 15))
			}
			expect(sockets).toHaveLength(2)
			expect(ws1.closedCode).toBe(4000)
			expect(ws1.closedReason).toBe('heartbeat_timeout')

			const ws2 = sockets[1]
			if (!ws2) throw new Error('expected second socket')
			ws2.simulateOpen()
			ws2.simulateMessage({ t: 'ready', serverCursor: 3, heartbeatMs: 40 })
			expect(connStates.at(-1)).toBe(true)
			expect(reconnectCount).toBe(1)
			expect(cursorSignals).toContain(3)

			// Late onclose from the stale first socket must not clobber the healthy second socket.
			ws1.onclose?.({} as CloseEvent)
			expect(sockets).toHaveLength(2)
			expect(ws2.readyState).toBe(1)
			expect(connStates.at(-1)).toBe(true)
		} finally {
			client.stop()
		}
	})

	test('HuriroSyncEngine retries failed delta pulls automatically with backoff and clears lastError', async () => {
		const storage = new MemoryReplicaStorage()
		const nowIso = '2026-11-26T10:00:00Z'
		let failChanges = false
		let changeCalls = 0
		const recoveredIssue = makeIssue('0190a0b1-9a9a-7000-8000-000000000777', {
			title: 'Recovered via delta retry',
			version: 1
		})

		const transport: SyncTransport = {
			async fetchSnapshot() {
				return {
					cursor: 1,
					serverTime: nowIso,
					projects: [baseProject()],
					projectStatuses: [baseStatus()],
					labels: [],
					cycles: [],
					issues: [],
					savedViews: [],
					notifications: [],
					docPages: []
				}
			},
			async fetchChanges(since) {
				changeCalls += 1
				if (failChanges) {
					const err = new Error('delta temporarily unavailable (503)') as Error & { status?: number }
					err.status = 503
					throw err
				}
				if (since < 2) {
					return {
						changes: [
							{
								cursor: 2,
								entity: 'issue',
								id: recoveredIssue.id,
								action: 'upsert',
								scope: [`project:${PROJ_ID}`],
								data: recoveredIssue as unknown as Record<string, unknown>,
								changedAt: nowIso
							}
						],
						nextCursor: 2,
						hasMore: false,
						serverTime: nowIso
					}
				}
				return { changes: [], nextCursor: since, hasMore: false, serverTime: nowIso }
			},
			async sendBatch() {
				return { cursor: 2, results: [] }
			}
		}

		const engine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport,
			syncRetryBaseMs: 30
		})
		try {
			await engine.bootstrap()
			failChanges = true
			await engine.syncNow()
			expect(engine.getStatus().lastError).toContain('503')

			failChanges = false
			const deadline = Date.now() + 500
			while (engine.getStatus().lastError !== null && Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 15))
			}
			expect(changeCalls).toBeGreaterThanOrEqual(2)
			expect(engine.getStatus().lastError).toBeNull()
			expect(engine.getStatus().cursor).toBe(2)
			expect(engine.collections.issues.get(recoveredIssue.id)?.title).toBe('Recovered via delta retry')
		} finally {
			engine.dispose()
		}
	})

	test('HuriroSyncEngine resume() verifies socket liveness, flushes, pulls deltas, throttles, and listens to visibility/focus', async () => {
		const storage = new MemoryReplicaStorage()
		const nowIso = '2026-11-26T10:00:00Z'
		const sockets: MockWebSocket[] = []
		let resumeCallbacks = 0
		let changeCalls = 0
		let serverCursor = 1

		const transport: SyncTransport = {
			async fetchSnapshot() {
				return {
					cursor: 1,
					serverTime: nowIso,
					projects: [baseProject()],
					projectStatuses: [baseStatus()],
					labels: [],
					cycles: [],
					issues: [],
					savedViews: [],
					notifications: [],
					docPages: []
				}
			},
			async fetchChanges(since) {
				changeCalls += 1
				return { changes: [], nextCursor: Math.max(since, serverCursor), hasMore: false, serverTime: nowIso }
			},
			async sendBatch() {
				return { cursor: serverCursor, results: [] }
			}
		}

		const winListeners = new Map<string, Set<() => void>>()
		const docListeners = new Map<string, Set<() => void>>()
		const prevWin = (globalThis as Record<string, unknown>)['window']
		const prevDoc = (globalThis as Record<string, unknown>)['document']
		const mockDoc = {
			visibilityState: 'hidden' as DocumentVisibilityState,
			addEventListener: (ev: string, fn: () => void) => {
				const set = docListeners.get(ev) ?? new Set()
				set.add(fn)
				docListeners.set(ev, set)
			},
			removeEventListener: (ev: string, fn: () => void) => {
				docListeners.get(ev)?.delete(fn)
			}
		}
		const mockWin = {
			addEventListener: (ev: string, fn: () => void) => {
				const set = winListeners.get(ev) ?? new Set()
				set.add(fn)
				winListeners.set(ev, set)
			},
			removeEventListener: (ev: string, fn: () => void) => {
				winListeners.get(ev)?.delete(fn)
			}
		}
		;(globalThis as Record<string, unknown>)['window'] = mockWin
		;(globalThis as Record<string, unknown>)['document'] = mockDoc

		const engine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport,
			wsUrl: 'wss://huriro.example/ws',
			pollIntervalMs: 60_000,
			wsHeartbeatTimeoutMs: 60,
			webSocketFactory: (url) => {
				const ws = new MockWebSocket(url)
				sockets.push(ws)
				return ws as unknown as WebSocket
			},
			onResume: () => {
				resumeCallbacks += 1
			}
		})

		try {
			await engine.bootstrap()
			expect(sockets).toHaveLength(1)
			const s0 = sockets[0]
			if (!s0) throw new Error('expected initial socket')
			s0.simulateOpen()
			s0.simulateMessage({ t: 'ready', serverCursor: 1, heartbeatMs: 30 })

			// Simulate socket closed during laptop sleep.
			s0.readyState = 3
			serverCursor = 4
			const callsBeforeResume = changeCalls

			// Hidden visibilitychange must not trigger resume.
			for (const fn of docListeners.get('visibilitychange') ?? []) fn()
			expect(resumeCallbacks).toBe(0)

			// Becoming visible triggers resume(), revives socket, fires onResume, and pulls deltas.
			mockDoc.visibilityState = 'visible'
			for (const fn of docListeners.get('visibilitychange') ?? []) fn()
			await new Promise((r) => setTimeout(r, 20))
			expect(resumeCallbacks).toBe(1)
			expect(sockets).toHaveLength(2)
			expect(changeCalls).toBeGreaterThan(callsBeforeResume)
			expect(engine.getStatus().cursor).toBe(4)

			// Focus immediately afterward is throttled within 1 s.
			for (const fn of winListeners.get('focus') ?? []) fn()
			await new Promise((r) => setTimeout(r, 10))
			expect(resumeCallbacks).toBe(1)

			// Force resume bypasses the 1 s throttle.
			await engine.resume({ force: true })
			expect(resumeCallbacks).toBe(2)

			// Reconnecting socket triggers onReconnect -> onResume + delta pull.
			const s1 = sockets[1]
			if (!s1) throw new Error('expected reconnected socket')
			s1.simulateOpen()
			s1.simulateMessage({ t: 'ready', serverCursor: 4, heartbeatMs: 30 })
			await new Promise((r) => setTimeout(r, 20))
			expect(resumeCallbacks).toBe(3)
		} finally {
			engine.dispose()
			if (prevWin === undefined) delete (globalThis as Record<string, unknown>)['window']
			else (globalThis as Record<string, unknown>)['window'] = prevWin
			if (prevDoc === undefined) delete (globalThis as Record<string, unknown>)['document']
			else (globalThis as Record<string, unknown>)['document'] = prevDoc
		}
	})

	test('storageDegraded is false for explicit MemoryReplicaStorage and true only when auto-probe falls back to memory', async () => {
		const explicitEngine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage: new MemoryReplicaStorage()
		})
		await explicitEngine.bootstrap({ skipNetwork: true })
		expect(explicitEngine.getStatus().storageDegraded).toBe(false)
		explicitEngine.dispose()

		const nowIso = '2026-11-26T10:00:00Z'
		const probedEngine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			transport: {
				async fetchSnapshot() {
					return {
						cursor: 1,
						serverTime: nowIso,
						projects: [],
						projectStatuses: [],
						labels: [],
						cycles: [],
						issues: [],
						savedViews: [],
						notifications: [],
						docPages: []
					}
				},
				async fetchChanges(since) {
					return { changes: [], nextCursor: since, hasMore: false, serverTime: nowIso }
				},
				async sendBatch() {
					return { cursor: 1, results: [] }
				}
			}
		})
		await probedEngine.bootstrap()
		// Bun test environment has no OPFS/IndexedDB, so auto-probe falls back to memory.
		expect(probedEngine.getStatus().storageMode).toBe('memory')
		expect(probedEngine.getStatus().storageDegraded).toBe(true)
		probedEngine.dispose()
	})
})
