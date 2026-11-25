/**
 * Gate G7 performance evidence tests (§9 Gate G7).
 *
 * The 50k-row fixture is intentionally far too slow for the default integration
 * suite. Set HURIRO_PERF=1 (with DATABASE_URL/DATABASE_ADMIN_URL pointing at
 * huriro_test) to run these regression gates. Assertions use 2× the gate values
 * to avoid CI flake; the printed p50/p95 values are the actual evidence.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import type { TestDb } from '@huriro/test-utils'
import { measureBootBenchmark, measureBulkBenchmark } from './g7-perf-harness'
import { ensureG7ScaleFixture } from './g7-scale.seed'
import { createIntegrationServer, getTestDb } from './test-harness'

const PERF_ENABLED = process.env['HURIRO_PERF'] === '1'

let db: TestDb | null = null

beforeAll(async () => {
	if (PERF_ENABLED) {
		db = await getTestDb()
	}
})

describe('Gate G7 performance evidence (HURIRO_PERF=1 only)', () => {
	test('50k-row workspace boot: tiered core snapshot p95 regression gate', async () => {
		if (!PERF_ENABLED || !db) return
		const fixture = await ensureG7ScaleFixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			const result = await measureBootBenchmark({ db, app, fixture, warmupRuns: 3, measuredRuns: 20 })
			console.log(
				`G7 boot: p50=${result.duration.p50Ms.toFixed(1)}ms p95=${result.duration.p95Ms.toFixed(1)}ms ` +
					`mean=${result.duration.meanMs.toFixed(1)}ms bytes=${result.response.bytes} ` +
					`coreIssues=${result.response.issueCount} untieredActive=${result.tierCounts.activeIssuesWithoutTiering} ` +
					`untieredBytes=${result.untieredSize.serializedBytes} tier2=${result.tierCounts.tier2HistoryIssues}`
			)

			expect(result.tierCounts.totalIssues).toBe(50_000)
			expect(result.tierCounts.activeIssuesWithoutTiering).toBe(50_000)
			expect(result.tierCounts.tier1CoreIssues).toBe(4_500)
			expect(result.tierCounts.tier2HistoryIssues).toBe(45_500)
			expect(result.response.issueCount).toBe(result.tierCounts.tier1CoreIssues)
			expect(result.untieredSize.activeIssueCount).toBe(50_000)
			expect(result.untieredSize.additionalIssueCount).toBe(45_500)
			expect(result.untieredSize.serializedBytes).toBeGreaterThan(result.response.bytes)
			expect(result.response.projectCount).toBe(10)
			expect(result.response.labelCount).toBe(20)
			expect(result.response.cycleCount).toBe(30)
			// Regression gate is deliberately 2× the <1.5s product gate; the exact
			// measured p50/p95 above are the evidence reported for Gate G7.
			expect(result.duration.p95Ms).toBeLessThan(3_000)
		} finally {
			await pubsub.close()
		}
	}, 360_000)

	test('bulk 200 issues: alternating status/priority writes p95 regression gate + outbox shape', async () => {
		if (!PERF_ENABLED || !db) return
		const fixture = await ensureG7ScaleFixture(db.owner)
		const { app, pubsub } = createIntegrationServer(db)
		try {
			const result = await measureBulkBenchmark({ db, app, fixture, measuredRuns: 30 })
			const firstDeltas = result.iterations[0]
			console.log(
				`G7 bulk: p50=${result.duration.p50Ms.toFixed(1)}ms p95=${result.duration.p95Ms.toFixed(1)}ms ` +
					`mean=${result.duration.meanMs.toFixed(1)}ms rows/call=${result.averageOutboxRowsPerCall.toFixed(0)} ` +
					`outboxRows/issue=${result.observedOutboxRowsPerIssue.toFixed(1)} ` +
					`firstDelta=${firstDeltas?.outboxDelta ?? 0}`
			)

			expect(result.issuesPerCall).toBe(200)
			expect(result.iterations).toHaveLength(30)
			// S3a's implementation emits per-issue domain events in ONE multi-row
			// outbox INSERT. Because this benchmark crosses a status boundary for all
			// 200 issues on every alternating call, the row-level amplification is:
			//   200 tasks.issue.updated.v1 + 200 tasks.issue.status_changed.v1 = 400 rows.
			// The insert-statement batching itself is statically enforced by the single
			// emitTasksEvents() call in service-bulk.ts; these assertions catch drift in
			// the observable row amplification.
			for (const iteration of result.iterations) {
				expect(iteration.status).toBe(200)
				expect(iteration.issueUpdatedOutboxDelta).toBe(200)
				expect(iteration.statusChangedOutboxDelta).toBe(200)
				expect(iteration.outboxDelta).toBe(400)
				expect(iteration.changeLogDelta).toBe(200)
			}
			expect(result.observedOutboxRowsPerIssue).toBe(2)
			expect(result.observedChangeLogRowsPerIssue).toBe(1)
			// Regression gate is deliberately 2× the <300ms product gate; exact
			// measurements are printed above and emitted as JSON by scripts/g7-bench.ts.
			expect(result.duration.p95Ms).toBeLessThan(600)
		} finally {
			await pubsub.close()
		}
	}, 240_000)
})
