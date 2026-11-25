/**
 * Gate G7 benchmark runner (§9 Gate G7):
 *
 *   bun --cwd apps/server scripts/g7-bench.ts
 *
 * Requires the same disposable-test database environment as the integration
 * suite (DATABASE_ADMIN_URL/DATABASE_URL pointing at huriro_test). The process
 * exits non-zero when either exact product gate is missed; the env-gated
 * integration test uses wider regression thresholds to avoid CI flake.
 */
import { getTestDb } from '@huriro/test-utils'
import { measureBootBenchmark, measureBulkBenchmark } from '../src/integration/g7-perf-harness'
import { ensureG7ScaleFixture } from '../src/integration/g7-scale.seed'
import { createIntegrationServer } from '../src/integration/test-harness'

if (process.argv.includes('--help')) {
	console.log('Usage: bun --cwd apps/server scripts/g7-bench.ts')
	process.exit(0)
}

async function main() {
	const db = await getTestDb()
	if (!db) {
		console.error('Database unavailable: set DATABASE_URL/DATABASE_ADMIN_URL or HURIRO_TESTCONTAINERS=1')
		process.exit(1)
	}

	const { app, pubsub } = createIntegrationServer(db)
	try {
		const seedStarted = performance.now()
		const fixture = await ensureG7ScaleFixture(db.owner)
		const seedElapsedMs = performance.now() - seedStarted
		const boot = await measureBootBenchmark({ db, app, fixture, warmupRuns: 3, measuredRuns: 20 })
		const bulk = await measureBulkBenchmark({ db, app, fixture, measuredRuns: 30 })

		const pass = boot.duration.p95Ms < 1500 && bulk.duration.p95Ms < 300
		const report = {
			gate: 'G7',
			generatedAt: new Date().toISOString(),
			percentileMethod:
				'nearest-rank over end-to-end in-process API calls (including body read + JSON parse)',
			seed: {
				elapsedMs: seedElapsedMs,
				workspaceSlug: 'g7-scale',
				counts: fixture.counts
			},
			boot: {
				gateMs: 1500,
				pass: boot.duration.p95Ms < 1500,
				measuredRuns: boot.measuredRuns,
				warmupRuns: boot.warmupRuns,
				duration: boot.duration,
				samplesMs: boot.samplesMs,
				warmupSamplesMs: boot.warmupSamplesMs,
				response: boot.response,
				tierCounts: boot.tierCounts,
				untieredSize: boot.untieredSize,
				tierReductionPercent: boot.tierCounts.activeIssuesWithoutTiering
					? (1 - boot.tierCounts.tier1CoreIssues / boot.tierCounts.activeIssuesWithoutTiering) * 100
					: 0
			},
			bulk: {
				gateMs: 300,
				pass: bulk.duration.p95Ms < 300,
				measuredRuns: bulk.measuredRuns,
				issuesPerCall: bulk.issuesPerCall,
				duration: bulk.duration,
				samplesMs: bulk.samplesMs,
				totalOutboxRows: bulk.totalOutboxRows,
				averageOutboxRowsPerCall: bulk.averageOutboxRowsPerCall,
				observedOutboxRowsPerIssue: bulk.observedOutboxRowsPerIssue,
				totalChangeLogRows: bulk.totalChangeLogRows,
				observedChangeLogRowsPerIssue: bulk.observedChangeLogRowsPerIssue,
				iterations: bulk.iterations,
				outboxBatchEvidence:
					'bulkUpdateIssues calls emitTasksEvents once per request; emitTasksEvents executes one multi-row INSERT. Alternating status writes observed 400 rows/call = 2 rows/issue (issue.updated + issue.status_changed).'
			},
			pass
		}

		console.log(
			`G7 boot p50=${boot.duration.p50Ms.toFixed(1)}ms p95=${boot.duration.p95Ms.toFixed(1)}ms ` +
				`core=${boot.response.issueCount}/${boot.tierCounts.activeIssuesWithoutTiering} issues bytes=${boot.response.bytes} ` +
				`untieredBytes=${boot.untieredSize.serializedBytes}`
		)
		console.log(
			`G7 bulk p50=${bulk.duration.p50Ms.toFixed(1)}ms p95=${bulk.duration.p95Ms.toFixed(1)}ms ` +
				`outboxRows/call=${bulk.averageOutboxRowsPerCall.toFixed(0)} rows/issue=${bulk.observedOutboxRowsPerIssue.toFixed(1)}`
		)
		console.log(JSON.stringify(report, null, 2))
		if (!pass) process.exitCode = 1
	} finally {
		await pubsub.close()
		await db.stop()
	}
}

void main()
