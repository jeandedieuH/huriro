/**
 * Gate G7 performance measurement helpers. These are test/bench utilities only:
 * they drive the real Elysia app in-process, but they never change production
 * behavior or add measurement hooks to request paths.
 */
import { randomUUID } from 'node:crypto'
import type { IssueDto } from '@huriro/contracts'
import type { TestDb } from '@huriro/test-utils'
import type { G7ScaleFixture } from './g7-scale.seed'
import type { createIntegrationServer } from './test-harness'

type IntegrationApp = ReturnType<typeof createIntegrationServer>['app']

export interface DurationSummary {
	readonly count: number
	readonly minMs: number
	readonly p50Ms: number
	readonly p95Ms: number
	readonly maxMs: number
	readonly meanMs: number
}

export interface SnapshotTierCounts {
	readonly totalIssues: number
	readonly activeIssuesWithoutTiering: number
	readonly tier1CoreIssues: number
	readonly tier2HistoryIssues: number
}

export interface SnapshotUntieredSize {
	readonly activeIssueCount: number
	readonly additionalIssueCount: number
	readonly additionalSerializedBytes: number
	readonly serializedBytes: number
}

export interface SnapshotResponseMeasurement {
	readonly status: number
	readonly bytes: number
	readonly elapsedMs: number
	readonly issueCount: number
	readonly projectCount: number
	readonly projectStatusCount: number
	readonly labelCount: number
	readonly cycleCount: number
	readonly savedViewCount: number
	readonly notificationCount: number
	readonly docPageCount: number
}

export interface BootBenchmarkResult {
	readonly measuredRuns: number
	readonly warmupRuns: number
	readonly duration: DurationSummary
	readonly samplesMs: readonly number[]
	readonly warmupSamplesMs: readonly number[]
	readonly response: SnapshotResponseMeasurement
	readonly tierCounts: SnapshotTierCounts
	readonly untieredSize: SnapshotUntieredSize
}

export interface BulkIterationMeasurement {
	readonly run: number
	readonly status: number
	readonly elapsedMs: number
	readonly outboxDelta: number
	readonly issueUpdatedOutboxDelta: number
	readonly statusChangedOutboxDelta: number
	readonly changeLogDelta: number
}

export interface BulkBenchmarkResult {
	readonly measuredRuns: number
	readonly issuesPerCall: number
	readonly duration: DurationSummary
	readonly samplesMs: readonly number[]
	readonly iterations: readonly BulkIterationMeasurement[]
	readonly totalOutboxRows: number
	readonly averageOutboxRowsPerCall: number
	readonly observedOutboxRowsPerIssue: number
	readonly totalChangeLogRows: number
	readonly observedChangeLogRowsPerIssue: number
}

interface TimedResponse {
	readonly status: number
	readonly json: Record<string, unknown>
	readonly elapsedMs: number
	readonly bytes: number
}

/** Nearest-rank percentiles over a copy of the input; input order is preserved. */
export function summarizeDurations(samples: readonly number[]): DurationSummary {
	if (samples.length === 0) throw new Error('cannot summarize zero duration samples')
	const sorted = [...samples].sort((a, b) => a - b)
	const pick = (quantile: number): number => sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0
	const sum = samples.reduce((acc, value) => acc + value, 0)
	return {
		count: samples.length,
		minMs: sorted[0] ?? 0,
		p50Ms: pick(0.5),
		p95Ms: pick(0.95),
		maxMs: sorted[sorted.length - 1] ?? 0,
		meanMs: sum / samples.length
	}
}

/**
 * Same authenticated in-process request style as apiRequest(), while keeping
 * the raw byte length. The timer covers request construction, handler execution,
 * body consumption, and JSON parsing — comparable to the S3a integration-test
 * measurement style.
 */
async function timedApiRequest(
	app: IntegrationApp,
	opts: {
		readonly method?: string
		readonly path: string
		readonly workspaceId: string
		readonly userId: string
		readonly email?: string
		readonly body?: unknown
		readonly headers?: Record<string, string>
	}
): Promise<TimedResponse> {
	const started = performance.now()
	const headers: Record<string, string> = {
		'x-huriro-client': 'huriro-test',
		'x-workspace-id': opts.workspaceId,
		'x-test-user-id': opts.userId,
		'x-test-user-email': opts.email ?? 'g7-scale-owner@test.huriro.dev',
		...opts.headers
	}
	if (opts.body !== undefined) headers['content-type'] = 'application/json'
	const res = await app.handle(
		new Request(`http://localhost${opts.path}`, {
			method: opts.method ?? 'GET',
			headers,
			...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {})
		})
	)
	const text = await res.text()
	let json: Record<string, unknown> = {}
	if (text.length > 0) {
		try {
			json = JSON.parse(text) as Record<string, unknown>
		} catch {
			json = { raw: text }
		}
	}
	return {
		status: res.status,
		json,
		elapsedMs: performance.now() - started,
		bytes: Buffer.byteLength(text, 'utf8')
	}
}

function arrayLength(json: Record<string, unknown>, key: string): number {
	const value = json[key]
	return Array.isArray(value) ? value.length : 0
}

function problemDetail(json: Record<string, unknown>): string {
	const detail = json['detail'] ?? json['title'] ?? json['raw'] ?? JSON.stringify(json)
	return String(detail).slice(0, 240)
}

async function measureSnapshotOnce(
	app: IntegrationApp,
	fixture: G7ScaleFixture
): Promise<SnapshotResponseMeasurement> {
	const res = await timedApiRequest(app, {
		path: '/api/v1/sync/snapshot',
		workspaceId: fixture.workspaceId,
		userId: fixture.ownerId,
		email: fixture.ownerEmail
	})
	if (res.status !== 200) {
		throw new Error(`G7 snapshot benchmark request failed with ${res.status}: ${problemDetail(res.json)}`)
	}
	return {
		status: res.status,
		bytes: res.bytes,
		elapsedMs: res.elapsedMs,
		issueCount: arrayLength(res.json, 'issues'),
		projectCount: arrayLength(res.json, 'projects'),
		projectStatusCount: arrayLength(res.json, 'projectStatuses'),
		labelCount: arrayLength(res.json, 'labels'),
		cycleCount: arrayLength(res.json, 'cycles'),
		savedViewCount: arrayLength(res.json, 'savedViews'),
		notificationCount: arrayLength(res.json, 'notifications'),
		docPageCount: arrayLength(res.json, 'docPages')
	}
}

/** Count-only comparison of the tiered core against what untiered v1 would hydrate. */
export async function countSnapshotTiers(db: TestDb, workspaceId: string): Promise<SnapshotTierCounts> {
	const [row] = await db.owner<
		{
			total: number
			active: number
			tier1: number
			tier2: number
		}[]
	>`
		SELECT
			count(*)::int AS total,
			(count(*) FILTER (WHERE deleted_at IS NULL))::int AS active,
			(count(*) FILTER (
				WHERE deleted_at IS NULL AND (closed_at IS NULL OR closed_at >= now() - interval '30 days')
			))::int AS tier1,
			(count(*) FILTER (
				WHERE deleted_at IS NULL AND closed_at < now() - interval '30 days'
			))::int AS tier2
		FROM issues
		WHERE workspace_id = ${workspaceId}
	`
	return {
		totalIssues: row?.total ?? 0,
		activeIssuesWithoutTiering: row?.active ?? 0,
		tier1CoreIssues: row?.tier1 ?? 0,
		tier2HistoryIssues: row?.tier2 ?? 0
	}
}

type SnapshotIssueRow = Omit<IssueDto, 'identifier' | 'labelIds'>

/**
 * Computes the exact compact-JSON byte size the same snapshot would have if the
 * closed-over-30d predicate were removed. The snapshot wire format is compact
 * JSON.stringify output (verified by round-tripping the actual response), so the
 * delta is exactly the tier-2 DTO bytes plus one array comma per added issue.
 * This query mirrors the production ISSUE_COLS/toIssueDto mapping without
 * changing or parameterizing production code.
 */
export async function measureUntieredSnapshotSize(args: {
	readonly db: TestDb
	readonly fixture: G7ScaleFixture
	readonly tieredResponseBytes: number
}): Promise<SnapshotUntieredSize> {
	const visibleProjectIds = args.fixture.projects.map((project) => project.id)
	const rows = await args.db.owner<SnapshotIssueRow[]>`
		SELECT
			i.id,
			i.workspace_id AS "workspaceId",
			i.project_id AS "projectId",
			p.key AS "projectKey",
			i.number,
			i.parent_id AS "parentId",
			i.cycle_id AS "cycleId",
			i.title,
			i.description,
			i.description_text AS "descriptionText",
			i.status_id AS "statusId",
			i.priority,
			i.assignee_type AS "assigneeType",
			i.assignee_id AS "assigneeId",
			i.creator_id AS "creatorId",
			i.position,
			i.start_date::text AS "startDate",
			i.due_date::text AS "dueDate",
			i.estimate::float8 AS estimate,
			i.triage_status AS "triageStatus",
			i.triage_snoozed_until::text AS "triageSnoozedUntil",
			i.triage_declined_reason AS "triageDeclinedReason",
			i.source_kind AS "sourceKind",
			i.closed_at::text AS "closedAt",
			i.created_at::text AS "createdAt",
			i.updated_at::text AS "updatedAt",
			i.deleted_at::text AS "deletedAt",
			i.version
		FROM issues i
		JOIN projects p ON p.workspace_id = i.workspace_id AND p.id = i.project_id
		WHERE i.workspace_id = ${args.fixture.workspaceId}
			AND i.deleted_at IS NULL
			AND i.project_id = ANY(${[...visibleProjectIds]}::uuid[])
			AND i.closed_at < now() - interval '30 days'
	`
	const labelRows = await args.db.owner<{ issueId: string; labelId: string }[]>`
		SELECT il.issue_id AS "issueId", il.label_id AS "labelId"
		FROM issue_labels il
		JOIN issues i ON i.workspace_id = il.workspace_id AND i.id = il.issue_id
		WHERE il.workspace_id = ${args.fixture.workspaceId}
			AND i.deleted_at IS NULL
			AND i.project_id = ANY(${[...visibleProjectIds]}::uuid[])
			AND i.closed_at < now() - interval '30 days'
		ORDER BY il.created_at ASC
	`
	const labelsByIssue = new Map<string, string[]>()
	for (const row of labelRows) {
		const labels = labelsByIssue.get(row.issueId)
		if (labels) labels.push(row.labelId)
		else labelsByIssue.set(row.issueId, [row.labelId])
	}

	let additionalSerializedBytes = 0
	for (const row of rows) {
		const dto: IssueDto = {
			...row,
			identifier: `${row.projectKey}-${row.number}`,
			labelIds: labelsByIssue.get(row.id) ?? []
		}
		additionalSerializedBytes += Buffer.byteLength(JSON.stringify(dto), 'utf8') + 1
	}
	const tierCounts = await countSnapshotTiers(args.db, args.fixture.workspaceId)
	return {
		activeIssueCount: tierCounts.activeIssuesWithoutTiering,
		additionalIssueCount: rows.length,
		additionalSerializedBytes,
		serializedBytes: args.tieredResponseBytes + additionalSerializedBytes
	}
}

/** Warms the route/database cache, then measures full snapshot responses end-to-end. */
export async function measureBootBenchmark(args: {
	readonly db: TestDb
	readonly app: IntegrationApp
	readonly fixture: G7ScaleFixture
	readonly warmupRuns?: number
	readonly measuredRuns?: number
}): Promise<BootBenchmarkResult> {
	const warmupRuns = args.warmupRuns ?? 3
	const measuredRuns = args.measuredRuns ?? 20
	const warmupSamples: number[] = []
	for (let i = 0; i < warmupRuns; i++) {
		warmupSamples.push((await measureSnapshotOnce(args.app, args.fixture)).elapsedMs)
	}

	const samples: number[] = []
	let lastResponse: SnapshotResponseMeasurement | null = null
	for (let i = 0; i < measuredRuns; i++) {
		lastResponse = await measureSnapshotOnce(args.app, args.fixture)
		samples.push(lastResponse.elapsedMs)
	}
	if (!lastResponse) throw new Error('G7 boot benchmark produced no measurements')
	const tierCounts = await countSnapshotTiers(args.db, args.fixture.workspaceId)
	const untieredSize = await measureUntieredSnapshotSize({
		db: args.db,
		fixture: args.fixture,
		tieredResponseBytes: lastResponse.bytes
	})
	if (untieredSize.additionalIssueCount !== tierCounts.tier2HistoryIssues) {
		throw new Error(
			`G7 tier-size invariant failed: expected ${tierCounts.tier2HistoryIssues} tier-2 rows, serialized ${untieredSize.additionalIssueCount}`
		)
	}
	return {
		measuredRuns,
		warmupRuns,
		duration: summarizeDurations(samples),
		samplesMs: samples,
		warmupSamplesMs: warmupSamples,
		response: lastResponse,
		tierCounts,
		untieredSize
	}
}

interface BulkArtifactCounts {
	readonly totalOutbox: number
	readonly issueUpdatedOutbox: number
	readonly statusChangedOutbox: number
	readonly changeLog: number
}

async function countBulkArtifacts(db: TestDb, workspaceId: string): Promise<BulkArtifactCounts> {
	const [outbox] = await db.owner<
		{
			total: number
			issueUpdated: number
			statusChanged: number
		}[]
	>`
		SELECT
			count(*)::int AS total,
			(count(*) FILTER (WHERE event_type = 'tasks.issue.updated.v1'))::int AS "issueUpdated",
			(count(*) FILTER (WHERE event_type = 'tasks.issue.status_changed.v1'))::int AS "statusChanged"
		FROM outbox
		WHERE workspace_id = ${workspaceId}
	`
	const [changeLog] = await db.owner<{ n: number }[]>`
		SELECT count(*)::int AS n FROM change_log WHERE workspace_id = ${workspaceId}
	`
	return {
		totalOutbox: outbox?.total ?? 0,
		issueUpdatedOutbox: outbox?.issueUpdated ?? 0,
		statusChangedOutbox: outbox?.statusChanged ?? 0,
		changeLog: changeLog?.n ?? 0
	}
}

/**
 * Measures the §3.4 fast path over exactly 200 seeded issues. Operations
 * alternate Done/priority-4 ↔ Todo/priority-1, matching the S3a benchmark: every
 * call is a real write and every issue crosses a status boundary on every call.
 */
export async function measureBulkBenchmark(args: {
	readonly db: TestDb
	readonly app: IntegrationApp
	readonly fixture: G7ScaleFixture
	readonly measuredRuns?: number
}): Promise<BulkBenchmarkResult> {
	const measuredRuns = args.measuredRuns ?? 30
	const project = args.fixture.projects[0]
	if (!project) throw new Error('G7 bulk benchmark requires the seeded first project')
	const issueRows = await args.db.owner<{ id: string }[]>`
		SELECT id
		FROM issues
		WHERE workspace_id = ${args.fixture.workspaceId}
			AND project_id = ${project.id}
			AND number <= 5000
			AND number % 100 BETWEEN 94 AND 97
		ORDER BY number ASC
		LIMIT 200
	`
	const issueIds = issueRows.map((row) => row.id)
	if (issueIds.length !== 200) {
		throw new Error(`G7 bulk benchmark lane incomplete: expected 200 issues, found ${issueIds.length}`)
	}

	const iterations: BulkIterationMeasurement[] = []
	for (let i = 0; i < measuredRuns; i++) {
		const before = await countBulkArtifacts(args.db, args.fixture.workspaceId)
		const closing = i % 2 === 0
		const res = await timedApiRequest(args.app, {
			method: 'POST',
			path: '/api/v1/issues/bulk',
			workspaceId: args.fixture.workspaceId,
			userId: args.fixture.ownerId,
			email: args.fixture.ownerEmail,
			body: {
				issueIds,
				patch: closing
					? { statusId: project.statusIds.done, priority: 4 }
					: { statusId: project.statusIds.todo, priority: 1 }
			},
			// The endpoint is idempotency-protected; every measured call needs a new key.
			headers: { 'idempotency-key': randomUUID() }
		})
		const after = await countBulkArtifacts(args.db, args.fixture.workspaceId)
		if (res.status !== 200) {
			throw new Error(
				`G7 bulk benchmark request ${i + 1} failed with ${res.status}: ${problemDetail(res.json)}`
			)
		}
		if (arrayLength(res.json, 'data') !== issueIds.length) {
			throw new Error(`G7 bulk benchmark request ${i + 1} returned an incomplete data array`)
		}
		iterations.push({
			run: i + 1,
			status: res.status,
			elapsedMs: res.elapsedMs,
			outboxDelta: after.totalOutbox - before.totalOutbox,
			issueUpdatedOutboxDelta: after.issueUpdatedOutbox - before.issueUpdatedOutbox,
			statusChangedOutboxDelta: after.statusChangedOutbox - before.statusChangedOutbox,
			changeLogDelta: after.changeLog - before.changeLog
		})
	}

	const samples = iterations.map((it) => it.elapsedMs)
	const totalOutboxRows = iterations.reduce((sum, it) => sum + it.outboxDelta, 0)
	const totalChangeLogRows = iterations.reduce((sum, it) => sum + it.changeLogDelta, 0)
	return {
		measuredRuns,
		issuesPerCall: issueIds.length,
		duration: summarizeDurations(samples),
		samplesMs: samples,
		iterations,
		totalOutboxRows,
		averageOutboxRowsPerCall: totalOutboxRows / iterations.length,
		observedOutboxRowsPerIssue: totalOutboxRows / (iterations.length * issueIds.length),
		totalChangeLogRows,
		observedChangeLogRowsPerIssue: totalChangeLogRows / (iterations.length * issueIds.length)
	}
}
