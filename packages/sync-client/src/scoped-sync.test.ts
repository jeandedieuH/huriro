import { describe, expect, test } from 'bun:test'
import { ScopedSyncManager, type ScopedSyncManagerOptions } from './scoped-sync'

/**
 * Harness with scripted pages per scope: each entry is a list of pages served
 * in order; a page whose `rows` promise rejects simulates a mid-pagination
 * network failure.
 */
function makeHarness(opts?: {
	quotaBytes?: number
	pages?: Record<string, { rows: { id: string }[]; nextAfter: string | null; hasMore: boolean }[]>
}) {
	const pages = opts?.pages ?? {}
	const fetchCalls: { scope: string; after: string | null }[] = []
	const applied: { scope: string; rows: unknown[] }[] = []
	const purged: { scope: string; rowIds: readonly string[] }[] = []
	const evicted: string[] = []
	const registryWrites: unknown[] = []
	let nowMs = 1_000

	const manager = new ScopedSyncManager({
		quotaBytes: opts?.quotaBytes ?? 1024 * 1024,
		now: () => nowMs,
		fetchPage: async (scope, after) => {
			fetchCalls.push({ scope, after })
			const script = pages[scope] ?? []
			const page = script[fetchCalls.filter((c) => c.scope === scope).length - 1]
			if (!page) return { rows: [], nextAfter: null, hasMore: false }
			return page
		},
		applyRows: (scope, rows) => {
			applied.push({ scope, rows: [...rows] })
		},
		purgeRows: (scope, rowIds) => {
			purged.push({ scope, rowIds })
		},
		onEvict: (scope) => {
			evicted.push(scope)
		},
		onRegistryChange: (entries) => {
			registryWrites.push(entries.map((e) => ({ ...e })))
		}
	} satisfies ScopedSyncManagerOptions)

	return {
		manager,
		fetchCalls,
		applied,
		purged,
		evicted,
		registryWrites,
		advance(ms: number) {
			nowMs += ms
		}
	}
}

function row(id: string, size = 10): { id: string; pad: string } {
	return { id, pad: 'x'.repeat(size) }
}

describe('ScopedSyncManager', () => {
	test('hydration pages sequentially in keyset order and accounts bytes per row', async () => {
		const pages = {
			'issue_hist:p1': [
				{ rows: [row('a'), row('b')], nextAfter: 'cur1', hasMore: true },
				{ rows: [row('c')], nextAfter: 'cur2', hasMore: true },
				{ rows: [row('d'), row('e')], nextAfter: null, hasMore: false }
			]
		}
		const h = makeHarness({ pages })
		await h.manager.subscribe('issue_hist:p1')

		expect(h.fetchCalls).toEqual([
			{ scope: 'issue_hist:p1', after: null },
			{ scope: 'issue_hist:p1', after: 'cur1' },
			{ scope: 'issue_hist:p1', after: 'cur2' }
		])
		// Rows applied page by page, in order — never re-sorted or batched across pages.
		expect(h.applied.map((a) => a.rows.map((r) => (r as { id: string }).id))).toEqual([
			['a', 'b'],
			['c'],
			['d', 'e']
		])
		const expectedBytes = [row('a'), row('b'), row('c'), row('d'), row('e')].reduce(
			(sum, r) => sum + JSON.stringify(r).length,
			0
		)
		expect(h.manager.getScopeState('issue_hist:p1')?.byteSize).toBe(expectedBytes)
		expect(h.manager.totalBytes()).toBe(expectedBytes)
		expect(h.manager.getScopeState('issue_hist:p1')?.state).toBe('ready')
		expect(h.manager.activeScopes()).toEqual(['issue_hist:p1'])
	})

	test('refcounted subscribers share one hydration; purge happens at zero refs', async () => {
		const h = makeHarness({
			pages: { 'issue_hist:p1': [{ rows: [row('a')], nextAfter: null, hasMore: false }] }
		})
		const [first, second] = await Promise.all([
			h.manager.subscribe('issue_hist:p1'),
			h.manager.subscribe('issue_hist:p1')
		])
		expect(first).toBeUndefined()
		expect(second).toBeUndefined()
		// One hydration despite two subscribers.
		expect(h.fetchCalls).toHaveLength(1)
		expect(h.manager.getScopeState('issue_hist:p1')?.refCount).toBe(2)

		h.manager.release('issue_hist:p1')
		expect(h.purged).toHaveLength(0)
		expect(h.manager.getScopeState('issue_hist:p1')?.refCount).toBe(1)

		h.manager.release('issue_hist:p1')
		expect(h.purged).toHaveLength(1)
		expect(h.purged[0]?.scope).toBe('issue_hist:p1')
		expect(h.purged[0]?.rowIds).toEqual(['a'])
		expect(h.manager.getScopeState('issue_hist:p1')).toBeNull()
		expect(h.manager.activeScopes()).toEqual([])
		// Releasing an unknown scope is an idempotent no-op (eviction race safety).
		h.manager.release('issue_hist:p1')
		expect(h.purged).toHaveLength(1)
	})

	test('mid-pagination error keeps partial rows, leaves error state, requires release+resubscribe', async () => {
		let callCount = 0
		const manager = new ScopedSyncManager({
			quotaBytes: 1024 * 1024,
			fetchPage: async () => {
				callCount += 1
				if (callCount === 2) throw new Error('network down')
				return callCount === 1
					? { rows: [row('a')], nextAfter: 'cur1', hasMore: true }
					: { rows: [row('a'), row('b')], nextAfter: null, hasMore: false }
			},
			applyRows: () => {},
			purgeRows: () => {}
		})

		await expect(manager.subscribe('issue_hist:p1')).rejects.toThrow('network down')
		const errored = manager.getScopeState('issue_hist:p1')
		expect(errored?.state).toBe('error')
		// Not registered active — the partial rows can render but the feed ignores them.
		expect(manager.activeScopes()).toEqual([])
		// Byte accounting reflects the partial page that WAS applied.
		expect(errored?.byteSize).toBe(JSON.stringify(row('a')).length)

		// Re-subscribing an errored scope rejects immediately without a fresh fetch.
		const callsBefore = callCount
		await expect(manager.subscribe('issue_hist:p1')).rejects.toThrow()
		expect(callCount).toBe(callsBefore)

		// Recovery path: release (purges partial rows), then resubscribe fresh.
		manager.release('issue_hist:p1')
		manager.release('issue_hist:p1')
		expect(manager.getScopeState('issue_hist:p1')).toBeNull()

		await manager.subscribe('issue_hist:p1')
		expect(manager.getScopeState('issue_hist:p1')?.state).toBe('ready')
		expect(manager.getScopeState('issue_hist:p1')?.byteSize).toBe(
			JSON.stringify(row('a')).length + JSON.stringify(row('b')).length
		)
	})

	test('release during hydration drops the scope and late pages never apply', async () => {
		const resolveFirstRef: {
			current?: (v: { rows: { id: string }[]; nextAfter: string | null; hasMore: boolean }) => void
		} = {}
		const applied: unknown[][] = []
		const purged: string[] = []
		const manager = new ScopedSyncManager({
			quotaBytes: 1024 * 1024,
			fetchPage: (_scope, after) => {
				if (after === null) {
					return new Promise((resolve) => {
						resolveFirstRef.current = resolve
					})
				}
				return Promise.resolve({ rows: [row('late')], nextAfter: null, hasMore: false })
			},
			applyRows: (_scope, rows) => {
				applied.push([...rows])
			},
			purgeRows: (scope) => {
				purged.push(scope)
			}
		})

		const promise = manager.subscribe('issue_hist:p1')
		expect(manager.getScopeState('issue_hist:p1')?.state).toBe('hydrating')

		// Release before the first page resolves — generation guard engages.
		manager.release('issue_hist:p1')
		expect(purged).toEqual(['issue_hist:p1'])
		expect(manager.getScopeState('issue_hist:p1')).toBeNull()

		resolveFirstRef.current?.({ rows: [row('a')], nextAfter: 'cur1', hasMore: true })
		// The hydration promise settles without ever applying the late page.
		await promise.catch(() => {})
		expect(applied).toHaveLength(0)
	})

	test('LRU eviction order, pin exemption, and quota accounting after hydration', async () => {
		// Each row is ~33 bytes; quota fits ~2 scopes of 2 rows but not 3.
		const smallRow = (id: string) => ({ id })
		const rowBytes = JSON.stringify(smallRow('x')).length
		const quota = rowBytes * 4 + 4 // room for exactly 4 rows
		const h = makeHarness({
			quotaBytes: quota,
			pages: {
				'issue_hist:a': [{ rows: [smallRow('a1'), smallRow('a2')], nextAfter: null, hasMore: false }],
				'issue_hist:b': [{ rows: [smallRow('b1'), smallRow('b2')], nextAfter: null, hasMore: false }],
				'issue_hist:c': [{ rows: [smallRow('c1'), smallRow('c2')], nextAfter: null, hasMore: false }]
			}
		})

		await h.manager.subscribe('issue_hist:a')
		h.advance(100)
		await h.manager.subscribe('issue_hist:b')
		h.advance(100)
		// Pin scope b — it must survive the upcoming pressure even though it is
		// older than c (LRU picks strictly by lastAccess among UNPINNED entries).
		h.manager.pin('issue_hist:b')
		await h.manager.subscribe('issue_hist:c')

		// a was least-recently-accessed and unpinned → evicted when c pushed over quota.
		expect(h.evicted).toEqual(['issue_hist:a'])
		expect(h.manager.getScopeState('issue_hist:a')).toBeNull()
		expect(h.manager.getScopeState('issue_hist:b')?.state).toBe('ready')
		expect(h.manager.getScopeState('issue_hist:c')?.state).toBe('ready')
		expect(h.manager.totalBytes()).toBeLessThanOrEqual(quota)
		expect(h.purged.map((p) => p.scope)).toEqual(['issue_hist:a'])

		// Without the pin, b would have been the victim instead.
		const h2 = makeHarness({
			quotaBytes: quota,
			pages: {
				'issue_hist:a': [{ rows: [smallRow('a1'), smallRow('a2')], nextAfter: null, hasMore: false }],
				'issue_hist:b': [{ rows: [smallRow('b1'), smallRow('b2')], nextAfter: null, hasMore: false }],
				'issue_hist:c': [{ rows: [smallRow('c1'), smallRow('c2')], nextAfter: null, hasMore: false }]
			}
		})
		await h2.manager.subscribe('issue_hist:a')
		h2.advance(100)
		await h2.manager.subscribe('issue_hist:b')
		h2.advance(100)
		// touch() refreshes lastAccess — makes a strictly newer than b, so the
		// LRU victim is b even though a was hydrated first.
		h2.manager.touch('issue_hist:a')
		await h2.manager.subscribe('issue_hist:c')
		expect(h2.evicted).toEqual(['issue_hist:b'])
	})

	test('pinned zero-ref scopes survive release as warm cache; unpin purges them', async () => {
		const h = makeHarness({
			pages: { 'issue_hist:p1': [{ rows: [row('a')], nextAfter: null, hasMore: false }] }
		})
		h.manager.pin('issue_hist:p1')
		await h.manager.subscribe('issue_hist:p1')
		h.manager.release('issue_hist:p1')

		// Pinned → no purge, still ready, instantly resolvable on resubscribe.
		expect(h.purged).toHaveLength(0)
		expect(h.manager.getScopeState('issue_hist:p1')?.state).toBe('ready')
		expect(h.manager.activeScopes()).toEqual(['issue_hist:p1'])
		const fetchesBefore = h.fetchCalls.length
		await h.manager.subscribe('issue_hist:p1')
		expect(h.fetchCalls).toHaveLength(fetchesBefore)
		h.manager.release('issue_hist:p1')

		// Unpinning the zero-ref entry ends its life — same as a release.
		h.manager.unpin('issue_hist:p1')
		expect(h.purged).toHaveLength(1)
		expect(h.manager.getScopeState('issue_hist:p1')).toBeNull()
	})

	test('registry round-trip: entries restore stale, join activeScopes, lazily rehydrate', async () => {
		const h = makeHarness({
			pages: { 'issue_hist:p1': [{ rows: [row('a')], nextAfter: null, hasMore: false }] }
		})
		h.manager.pin('issue_hist:p1')
		await h.manager.subscribe('issue_hist:p1')
		const exported = h.manager.exportRegistry()
		expect(exported).toHaveLength(1)
		expect(exported[0]?.scope).toBe('issue_hist:p1')
		expect(exported[0]?.pinned).toBe(true)
		expect(exported[0]?.byteSize).toBeGreaterThan(0)

		// Fresh manager bootstraps from the persisted metadata only.
		const h2 = makeHarness({
			pages: { 'issue_hist:p1': [{ rows: [row('a'), row('b')], nextAfter: null, hasMore: false }] }
		})
		h2.manager.restoreRegistry(exported)
		const restored = h2.manager.getScopeState('issue_hist:p1')
		expect(restored?.state).toBe('stale')
		expect(restored?.refCount).toBe(0)
		expect(restored?.pinned).toBe(true)
		// Stale rows are held locally → the change feed must keep them fresh.
		expect(h2.manager.activeScopes()).toEqual(['issue_hist:p1'])
		// No fetch happened — rehydration is lazy.
		expect(h2.fetchCalls).toHaveLength(0)

		// Subscribing rehydrates fully and transitions to ready.
		await h2.manager.subscribe('issue_hist:p1')
		expect(h2.fetchCalls).toHaveLength(1)
		expect(h2.manager.getScopeState('issue_hist:p1')?.state).toBe('ready')
	})

	test('over-quota restore evicts stale entries LRU-first but spares pinned', async () => {
		const big = { id: 'x', pad: 'y'.repeat(40) }
		const bytes = JSON.stringify(big).length
		const h = makeHarness({ quotaBytes: bytes + 1 })
		h.manager.restoreRegistry([
			{ scope: 'issue_hist:old', byteSize: bytes, lastAccess: 100, pinned: false },
			{ scope: 'issue_hist:newer', byteSize: bytes, lastAccess: 200, pinned: false },
			{ scope: 'issue_hist:pinned', byteSize: bytes, lastAccess: 50, pinned: true }
		])
		// Total = 3x bytes, quota = ~1x → both unpinned entries evicted oldest-first,
		// the pinned one survives despite being the least recently accessed.
		expect(h.evicted).toEqual(['issue_hist:old', 'issue_hist:newer'])
		expect(h.manager.getScopeState('issue_hist:pinned')?.state).toBe('stale')
		expect(h.manager.totalBytes()).toBeLessThanOrEqual(bytes + 1)
	})

	test('hasMore without cursor surfaces a hydration error instead of looping forever', async () => {
		const manager = new ScopedSyncManager({
			quotaBytes: 1024,
			fetchPage: async () => ({ rows: [row('a')], nextAfter: null, hasMore: true }),
			applyRows: () => {},
			purgeRows: () => {}
		})
		await expect(manager.subscribe('issue_hist:p1')).rejects.toThrow(/stalled/)
		expect(manager.getScopeState('issue_hist:p1')?.state).toBe('error')
	})
})
