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
	HuriroSyncEngine,
	MAX_OUTBOX_MUTATIONS,
	MemoryReplicaStorage,
	type SyncTransport
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
})
