import { describe, expect, test } from 'bun:test'
import type {
	MutationEnvelope,
	MutationsBatchResponse,
	SyncSnapshotResponse,
	UserAvailabilityDto
} from '@huriro/contracts'
import { HuriroSyncEngine, MemoryReplicaStorage, REPLICA_SCHEMA_VERSION, type SyncTransport } from './index'

const WS_ID = '0190a0b1-9a9a-7000-8000-000000000001'
const USER_ID = '0190a0b1-9a9a-7000-8000-000000000002'

function makeAvailability(over: Partial<UserAvailabilityDto> = {}): UserAvailabilityDto {
	return {
		id: USER_ID,
		userId: USER_ID,
		displayName: 'Hagen Owner',
		handle: null,
		avatarUrl: null,
		manualState: 'auto',
		manualStateExpiresAt: null,
		effectiveState: 'available',
		statusEmoji: null,
		statusText: '',
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
		localTimeLabel: '12:00',
		delegateUserId: null,
		lastSeenAt: '2026-11-27T10:00:00.000Z',
		version: 1,
		windows: [],
		updatedAt: '2026-11-27T10:00:00.000Z',
		...over
	}
}

function emptySnapshot(userAvailability: UserAvailabilityDto[] = [], cursor = 1): SyncSnapshotResponse {
	return {
		cursor,
		serverTime: '2026-11-27T10:00:00.000Z',
		projects: [],
		projectStatuses: [],
		labels: [],
		cycles: [],
		issues: [],
		issueRelations: [],
		initiatives: [],
		projectMilestones: [],
		projectUpdates: [],
		savedViews: [],
		notifications: [],
		docPages: [],
		teamspaces: [],
		userAvailability: userAvailability as unknown as Record<string, unknown>[]
	}
}

describe('user availability sync collection & engine', () => {
	test('exportState preserves userAvailability, clearAll removes it, and REPLICA_SCHEMA_VERSION is 4', () => {
		expect(REPLICA_SCHEMA_VERSION).toBe(4)

		const engine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID
		})
		try {
			const row = makeAvailability({ statusEmoji: '🎯', statusText: 'Focusing' })
			engine.collections.userAvailabilityManaged.upsertMany([row], { force: true })

			const exported = engine.collections.exportState(7)
			expect(exported.schemaVersion).toBe(4)
			expect(exported.userAvailability).toHaveLength(1)
			expect(exported.userAvailability?.[0]?.statusText).toBe('Focusing')

			engine.collections.clearAll()
			expect(engine.collections.exportState(0).userAvailability).toEqual([])
		} finally {
			engine.dispose()
		}
	})

	test('legacy schemaVersion 3 replica resets cursor to 0 and hydrates userAvailability from snapshot', async () => {
		const storage = new MemoryReplicaStorage()
		await storage.set(
			'huriro:replica:v1',
			JSON.stringify({
				schemaVersion: 3,
				cursor: 42,
				projects: [],
				projectStatuses: [],
				labels: [],
				cycles: [],
				issues: [],
				savedViews: [],
				notifications: []
			})
		)

		let snapshotCalled = 0
		const row = makeAvailability({ version: 1, statusText: 'Hydrated from v4 snapshot' })
		const transport: SyncTransport = {
			async fetchChanges() {
				throw new Error('Legacy schema v3 replica must reset cursor to 0 and fetch snapshot first')
			},
			async fetchSnapshot() {
				snapshotCalled += 1
				return emptySnapshot([row], 99)
			},
			async sendBatch(): Promise<MutationsBatchResponse> {
				return { results: [], cursor: 99 }
			}
		}

		const engine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport
		})
		try {
			engine.setOnline(true)
			await engine.bootstrap()
			expect(snapshotCalled).toBe(1)
			expect(engine.getStatus().cursor).toBe(99)
			expect(engine.collections.userAvailability.get(USER_ID)?.statusText).toBe('Hydrated from v4 snapshot')
		} finally {
			engine.dispose()
		}
	})

	test('version-0 offline update strips expectedVersion, applies server result with force, and rolls back rejected edits', async () => {
		const batches: MutationEnvelope[][] = []
		let mode: 'apply' | 'reject' = 'apply'
		const serverSaved = makeAvailability({
			version: 1,
			manualState: 'busy',
			statusText: 'Server normalized',
			timezone: 'Europe/Berlin'
		})

		const transport: SyncTransport = {
			async fetchChanges() {
				return { changes: [], nextCursor: 2, hasMore: false, serverTime: '2026-11-27T10:00:00.000Z' }
			},
			async fetchSnapshot() {
				return emptySnapshot([makeAvailability({ version: 0 })], 1)
			},
			async sendBatch(mutations): Promise<MutationsBatchResponse> {
				batches.push([...mutations])
				const first = mutations[0]
				if (!first) return { results: [], cursor: 1 }
				if (mode === 'apply') {
					return {
						cursor: 2,
						results: [
							{
								mutationId: first.mutationId,
								status: 200,
								outcome: 'applied',
								data: serverSaved as unknown as Record<string, unknown>
							}
						]
					}
				}
				return {
					cursor: 2,
					results: [
						{
							mutationId: first.mutationId,
							status: 422,
							outcome: 'validation_failed',
							error: 'Invalid timezone'
						}
					]
				}
			}
		}

		const storage = new MemoryReplicaStorage()
		const engine = new HuriroSyncEngine({
			workspaceId: WS_ID,
			currentUserId: USER_ID,
			storage,
			transport
		})
		try {
			engine.setOnline(true)
			await engine.bootstrap()
			engine.setOnline(false)

			const optimistic = await engine.updateMyAvailability({
				manualState: 'busy',
				statusText: 'First offline edit',
				expectedVersion: 0
			})
			expect(optimistic.version).toBe(1)
			expect(optimistic.statusText).toBe('First offline edit')
			expect(engine.getStatus().pendingCount).toBe(1)

			const persistedOutbox = JSON.parse((await storage.get('huriro:outbox:v1')) ?? '[]') as {
				readonly envelope: MutationEnvelope
			}[]
			expect(persistedOutbox).toHaveLength(1)
			expect(persistedOutbox[0]?.envelope.entity).toBe('user_availability')
			expect(persistedOutbox[0]?.envelope.baseVersion).toBe(0)
			expect('expectedVersion' in (persistedOutbox[0]?.envelope.patch ?? {})).toBe(false)

			engine.setOnline(true)
			await engine.flushOutbox({ force: true })
			expect(batches).toHaveLength(1)
			expect(engine.collections.userAvailability.get(USER_ID)?.statusText).toBe('Server normalized')
			expect(engine.collections.userAvailability.get(USER_ID)?.timezone).toBe('Europe/Berlin')

			// Next mutation rejected -> rolls back to item.base even when optimistic bumped version
			mode = 'reject'
			engine.setOnline(false)
			await engine.updateMyAvailability({
				statusText: 'Will reject',
				expectedVersion: 1
			})
			expect(engine.collections.userAvailability.get(USER_ID)?.statusText).toBe('Will reject')

			engine.setOnline(true)
			await engine.flushOutbox({ force: true })
			expect(engine.collections.userAvailability.get(USER_ID)?.statusText).toBe('Server normalized')
			expect(engine.collections.userAvailability.get(USER_ID)?.version).toBe(1)
		} finally {
			engine.dispose()
		}
	})
})
