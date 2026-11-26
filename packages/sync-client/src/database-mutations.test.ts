import { describe, expect, test } from 'bun:test'
import type {
	DocDatabaseDto,
	DocDatabasePropertyDto,
	DocDatabaseRowDto,
	DocDatabaseViewDto,
	MutationEnvelope,
	SyncSnapshotResponse
} from '@huriro/contracts'
import { HuriroSyncEngine, MemoryReplicaStorage, type SyncTransport } from './index'

const WS_ID = '0190a0b1-9a9a-7000-8000-00000000d001'
const USER_ID = '0190a0b1-9a9a-7000-8000-00000000d002'
const NOW = '2026-11-26T00:00:00.000Z'

function cell(input: Partial<DocDatabaseRowDto['cells'][string]>): DocDatabaseRowDto['cells'][string] {
	return { text: null, number: null, boolean: null, dateStart: null, dateEnd: null, json: null, ...input }
}

function snapshot(): SyncSnapshotResponse {
	return {
		cursor: 1,
		serverTime: NOW,
		projects: [],
		projectStatuses: [],
		labels: [],
		cycles: [],
		issues: [],
		savedViews: [],
		notifications: [],
		docPages: []
	}
}

function baseRow(id: string, databaseId: string): DocDatabaseRowDto {
	return {
		id,
		workspaceId: WS_ID,
		databaseId,
		pageId: null,
		title: 'Server row',
		position: 'V',
		createdBy: USER_ID,
		updatedBy: USER_ID,
		archivedAt: null,
		createdAt: NOW,
		updatedAt: NOW,
		version: 1,
		cells: {}
	}
}

function ackEnvelope(m: MutationEnvelope, existing?: DocDatabaseRowDto): Record<string, unknown> {
	const base = {
		id: m.entityId,
		workspaceId: WS_ID,
		createdAt: NOW,
		updatedAt: NOW,
		version: 1
	}
	if (m.entity === 'doc_database') {
		return {
			...base,
			teamspaceId: (m.patch['teamspaceId'] as string | null | undefined) ?? null,
			parentPageId: (m.patch['parentPageId'] as string | null | undefined) ?? null,
			title: String(m.patch['title'] ?? 'Database'),
			icon: (m.patch['icon'] as string | null | undefined) ?? null,
			isInline: Boolean(m.patch['isInline'] ?? false),
			createdBy: USER_ID
		} satisfies DocDatabaseDto as unknown as Record<string, unknown>
	}
	if (m.entity === 'doc_database_property') {
		return {
			...base,
			databaseId: String(m.patch['databaseId']),
			name: String(m.patch['name'] ?? 'Property'),
			propType: (m.patch['propType'] as DocDatabasePropertyDto['propType'] | undefined) ?? 'text',
			config: (m.patch['config'] as Record<string, unknown> | undefined) ?? {},
			position: String(m.patch['position'] ?? 'V')
		} satisfies DocDatabasePropertyDto as unknown as Record<string, unknown>
	}
	if (m.entity === 'doc_database_view') {
		return {
			...base,
			databaseId: String(m.patch['databaseId']),
			name: String(m.patch['name'] ?? 'View'),
			viewType: (m.patch['viewType'] as DocDatabaseViewDto['viewType'] | undefined) ?? 'table',
			config: (m.patch['config'] as Record<string, unknown> | undefined) ?? {},
			position: String(m.patch['position'] ?? 'V')
		} satisfies DocDatabaseViewDto as unknown as Record<string, unknown>
	}
	return {
		...(existing ?? baseRow(m.entityId, String(m.patch['databaseId']))),
		...m.patch,
		updatedAt: NOW,
		version: (existing?.version ?? 0) + 1
	}
}

function makeHarness() {
	const storage = new MemoryReplicaStorage()
	const sent: MutationEnvelope[][] = []
	let cursor = 1
	const transport: SyncTransport = {
		async fetchSnapshot() {
			return snapshot()
		},
		async fetchChanges(since) {
			return { changes: [], nextCursor: since, hasMore: false, serverTime: new Date().toISOString() }
		},
		async sendBatch(mutations) {
			sent.push([...mutations])
			cursor += mutations.length
			return {
				cursor,
				results: mutations.map((m) => ({
					mutationId: m.mutationId,
					status: 200,
					outcome: 'applied' as const,
					data: ackEnvelope(m)
				}))
			}
		}
	}
	return { storage, sent, transport }
}

describe('M10 database optimistic mutations', () => {
	test('offline create survives restart and replays database/property/view/row exactly once', async () => {
		const { storage, sent, transport } = makeHarness()
		const first = new HuriroSyncEngine({ workspaceId: WS_ID, currentUserId: USER_ID, storage, transport })
		await first.bootstrap()
		first.setOnline(false)

		const detail = await first.createDocDatabase({ title: 'Roadmap', isInline: false })
		expect(first.collections.docDatabases.get(detail.database.id)?.title).toBe('Roadmap')
		expect(first.collections.docDatabaseProperties.get(detail.properties[0]!.id)?.propType).toBe('title')
		expect(first.collections.docDatabaseViews.get(detail.views[0]!.id)?.viewType).toBe('table')
		const row = await first.createDocDatabaseRow(detail.database.id, {
			title: 'Alpha',
			cells: {
				[detail.properties[0]!.id]: cell({ text: 'Alpha' })
			}
		})
		expect(first.collections.docDatabaseRows.get(row.id)?.title).toBe('Alpha')
		first.dispose()

		const restarted = new HuriroSyncEngine({ workspaceId: WS_ID, currentUserId: USER_ID, storage, transport })
		await restarted.bootstrap({ skipNetwork: true })
		expect(restarted.collections.docDatabases.get(detail.database.id)?.title).toBe('Roadmap')
		expect(restarted.collections.docDatabaseRows.get(row.id)?.title).toBe('Alpha')

		restarted.setOnline(true)
		await restarted.flushOutbox()
		const flat = sent.flat()
		expect(flat).toHaveLength(2)
		expect(flat.map((m) => m.entity).sort()).toEqual(['doc_database', 'doc_database_row'])
		expect(flat.filter((m) => m.entityId === detail.database.id)).toHaveLength(1)
		expect(flat.find((m) => m.entity === 'doc_database')?.patch['titlePropertyId']).toBe(
			detail.properties[0]!.id
		)
		expect(flat.find((m) => m.entity === 'doc_database')?.patch['tableViewId']).toBe(detail.views[0]!.id)
		expect(restarted.getConflicts()).toHaveLength(0)
		restarted.dispose()
	})

	test('cell updates merge sparse values locally and archive uses a delete mutation', async () => {
		const { storage, sent, transport } = makeHarness()
		const engine = new HuriroSyncEngine({ workspaceId: WS_ID, currentUserId: USER_ID, storage, transport })
		await engine.bootstrap()
		engine.setOnline(false)
		const detail = await engine.createDocDatabase({ title: 'Ops' })
		const numberProp = await engine.createDocDatabaseProperty(detail.database.id, {
			name: 'Estimate',
			propType: 'number'
		})
		const doneProp = await engine.createDocDatabaseProperty(detail.database.id, {
			name: 'Done',
			propType: 'checkbox'
		})
		const row = await engine.createDocDatabaseRow(detail.database.id, {
			title: 'One',
			cells: { [numberProp.id]: cell({ number: 3 }) }
		})
		await engine.updateDocDatabaseRow(detail.database.id, row.id, {
			title: 'One updated',
			cells: { [doneProp.id]: cell({ boolean: true }) }
		})
		const optimistic = engine.collections.docDatabaseRows.get(row.id)
		expect(optimistic?.title).toBe('One updated')
		expect(optimistic?.cells[numberProp.id]?.number).toBe(3)
		expect(optimistic?.cells[doneProp.id]?.boolean).toBe(true)

		await engine.archiveDocDatabaseRow(detail.database.id, row.id)
		expect(engine.collections.docDatabaseRows.get(row.id)?.archivedAt).not.toBeNull()
		engine.setOnline(true)
		await engine.flushOutbox()
		const rowOps = sent.flat().filter((m) => m.entity === 'doc_database_row')
		expect(rowOps.map((m) => m.op)).toEqual(['create', 'update', 'delete'])
		expect(rowOps[1]?.patch['cells']).toEqual({ [doneProp.id]: cell({ boolean: true }) })
		expect(rowOps[2]?.patch['databaseId']).toBe(detail.database.id)
		engine.dispose()
	})

	test('rejected database create rolls back the entire optimistic scope', async () => {
		const storage = new MemoryReplicaStorage()
		const transport: SyncTransport = {
			async fetchSnapshot() {
				return snapshot()
			},
			async fetchChanges(since) {
				return { changes: [], nextCursor: since, hasMore: false, serverTime: new Date().toISOString() }
			},
			async sendBatch(mutations) {
				return {
					cursor: 2,
					results: mutations.map((m) => ({
						mutationId: m.mutationId,
						status: 403,
						outcome: 'forbidden' as const,
						error: 'Forbidden'
					}))
				}
			}
		}
		const engine = new HuriroSyncEngine({ workspaceId: WS_ID, currentUserId: USER_ID, storage, transport })
		await engine.bootstrap()
		engine.setOnline(false)
		const detail = await engine.createDocDatabase({ title: 'Rejected' })
		const row = await engine.createDocDatabaseRow(detail.database.id, { title: 'local only' })
		engine.setOnline(true)
		await engine.flushOutbox()
		expect(engine.collections.docDatabases.get(detail.database.id)).toBeUndefined()
		expect(engine.collections.docDatabaseProperties.get(detail.properties[0]!.id)).toBeUndefined()
		expect(engine.collections.docDatabaseViews.get(detail.views[0]!.id)).toBeUndefined()
		expect(engine.collections.docDatabaseRows.get(row.id)).toBeUndefined()
		engine.dispose()
	})
})
