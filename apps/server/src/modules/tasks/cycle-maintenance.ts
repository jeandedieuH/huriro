/**
 * Full cycles engine — nightly maintenance sweep (§3.3, advanced-features-plan):
 * auto-activation, auto-completion + rollover, pre-creation of upcoming
 * cycles, and the daily burnup snapshot. Discovery goes through the SECURITY
 * DEFINER `list_cycle_maintenance_projects()` (0022) under `withSystem` —
 * the same pattern as the triage wake sweep — then each project is processed
 * in ONE `withWorkspace` tx as a system actor (nil user, actorId null,
 * actorType 'system' in event payloads).
 *
 * Everything is idempotent: guarded status flips match nothing on a second
 * run, pre-created windows already exist, and the snapshot upsert rewrites
 * only when a value actually changed — running twice with the same `now`
 * produces zero additional mutations.
 */
import type { CycleDto } from '@huriro/contracts'
import { type Queryable, type Sql, withSystem, withWorkspace } from '@huriro/db'
import {
	type CyclePolicy,
	type CycleWindow,
	isCycleDueToActivate,
	isCycleDueToComplete,
	nextCycleWindow,
	windowsToPreCreate
} from '@huriro/domain'
import { appendChanges, type ChangeLogEntry } from '../../api/changelog'
import { log } from '../../api/observability'
import { TASKS_EVENTS } from './events'
import {
	countProjectCycles,
	cycleScopeCounts,
	emitTasksEvents,
	getLabelMapForIssues,
	getProjectById,
	insertCycleRow,
	listCycleMaintenanceProjects,
	listProjectCyclesAscending,
	priorSnapshotTotalIssues,
	rolloverCycleIssues,
	transitionCycleStatus,
	upsertCycleSnapshotRow
} from './repo'

export interface CycleMaintenanceResult {
	readonly projectsProcessed: number
	readonly activated: number
	readonly completed: number
	/** Issues moved by rollover (summed over cycles and modes). */
	readonly rolledOver: number
	/** Snapshot rows actually written — re-runs of the same day count 0. */
	readonly snapshotted: number
	/** Cycles inserted by the engine (rollover targets + pre-creation). */
	readonly created: number
}

interface ProjectMaintenanceCounts {
	activated: number
	completed: number
	rolledOver: number
	snapshotted: number
	created: number
}

function zeroCounts(): ProjectMaintenanceCounts {
	return { activated: 0, completed: 0, rolledOver: 0, snapshotted: 0, created: 0 }
}

type OutboxEvent = {
	aggregate: string
	aggregateId: string
	eventType: string
	payload: Record<string, unknown>
}

/** ISO calendar date ('YYYY-MM-DD') of `d` in UTC — cycles are day-granular. */
function isoDateUtc(d: Date): string {
	return d.toISOString().slice(0, 10)
}

async function insertPlannedCycle(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly projectId: string
		readonly name: string
		readonly window: CycleWindow
	},
	events: OutboxEvent[],
	changes: ChangeLogEntry[]
): Promise<CycleDto> {
	const created = await insertCycleRow(tx, {
		workspaceId: args.workspaceId,
		projectId: args.projectId,
		name: args.name,
		description: '',
		status: 'planned',
		startsAt: args.window.startsAt,
		endsAt: args.window.endsAt
	})
	events.push({
		aggregate: 'cycle',
		aggregateId: created.id,
		eventType: TASKS_EVENTS.CycleCreated,
		payload: {
			cycleId: created.id,
			projectId: args.projectId,
			name: created.name,
			startsAt: created.startsAt,
			endsAt: created.endsAt,
			automatic: true,
			actorType: 'system'
		}
	})
	changes.push({
		entityType: 'cycle',
		entityId: created.id,
		action: 'upsert',
		scope: [`project:${args.projectId}`],
		payload: created as unknown as Record<string, unknown>,
		actorId: null
	})
	return created
}

/**
 * All four maintenance phases for one project inside the caller's tenant tx:
 *   a) complete expired active cycles + roll over their unfinished issues
 *   b) activate the earliest due planned cycle when none is active — running
 *      completion first lets a due successor activate the same night its
 *      predecessor closes instead of losing its first day
 *   c) pre-create upcoming cycles so `minAhead` future windows exist
 *   d) upsert today's burnup snapshot for every active cycle
 */
async function maintainProjectCycles(
	tx: Queryable,
	workspaceId: string,
	projectId: string,
	today: string
): Promise<ProjectMaintenanceCounts> {
	const counts = zeroCounts()
	const project = await getProjectById(tx, workspaceId, projectId)
	// Discovery can be stale (project deleted/disabled mid-run) — skip quietly.
	if (!project?.cycleEnabled) return counts

	const policy: CyclePolicy = {
		durationDays: project.cycleDurationDays,
		cooldownDays: project.cycleCooldownDays,
		startWeekday: project.cycleStartWeekday,
		rolloverMode: project.cycleAutoRolloverMode
	}

	const events: OutboxEvent[] = []
	const changes: ChangeLogEntry[] = []
	const cycles = await listProjectCyclesAscending(tx, workspaceId, projectId)

	// ---- a) COMPLETE + ROLLOVER expired active cycles (before activation so a
	// due successor activates the same night its predecessor closes).
	for (const c of [...cycles]) {
		if (!isCycleDueToComplete(c, today)) continue
		const completedRow = await transitionCycleStatus(tx, {
			workspaceId,
			cycleId: c.id,
			fromStatus: 'active',
			toStatus: 'completed'
		})
		// Null means a concurrent/duplicate transition already ran — skip the
		// rollover too, it belongs to whoever won the status flip.
		if (!completedRow) continue
		counts.completed++
		cycles.splice(cycles.indexOf(c), 1, completedRow)
		events.push({
			aggregate: 'cycle',
			aggregateId: completedRow.id,
			eventType: TASKS_EVENTS.CycleCompleted,
			payload: {
				cycleId: completedRow.id,
				projectId,
				name: completedRow.name,
				startsAt: completedRow.startsAt,
				endsAt: completedRow.endsAt,
				actorType: 'system'
			}
		})
		changes.push({
			entityType: 'cycle',
			entityId: completedRow.id,
			action: 'upsert',
			scope: [`project:${projectId}`],
			payload: completedRow as unknown as Record<string, unknown>,
			actorId: null
		})

		const mode = policy.rolloverMode
		if (mode === 'none') continue

		let targetCycleId: string | null = null
		if (mode === 'next_cycle') {
			const existing = cycles.find((o) => o.status === 'planned' && o.startsAt > completedRow.endsAt)
			if (existing) {
				targetCycleId = existing.id
			} else {
				// No planned successor — create one on the spot so issues always
				// have a landing zone. Prefer the first pre-creation chain window;
				// when the chain is already satisfied by non-planned windows fall
				// back to the window directly after the LATEST existing end,
				// which can never collide with an existing cycle.
				const windows = cycles.map((o) => ({ startsAt: o.startsAt, endsAt: o.endsAt }))
				const chain = windowsToPreCreate(windows, policy, today, 2)
				const latestEnd = windows.reduce<string | null>(
					(acc, w) => (acc === null || w.endsAt > acc ? w.endsAt : acc),
					null
				)
				const window = chain[0] ?? nextCycleWindow(latestEnd ?? completedRow.endsAt, policy, today)
				const base = await countProjectCycles(tx, workspaceId, projectId)
				const created = await insertPlannedCycle(
					tx,
					{ workspaceId, projectId, name: `Cycle ${base + 1}`, window },
					events,
					changes
				)
				counts.created++
				cycles.push(created)
				targetCycleId = created.id
			}
		}

		const rolled = await rolloverCycleIssues(tx, { workspaceId, cycleId: completedRow.id, targetCycleId })
		counts.rolledOver += rolled.length
		events.push({
			aggregate: 'cycle',
			aggregateId: completedRow.id,
			eventType: TASKS_EVENTS.CycleRolledOver,
			payload: {
				cycleId: completedRow.id,
				projectId,
				issueCount: rolled.length,
				mode,
				...(targetCycleId ? { targetCycleId } : {}),
				actorType: 'system'
			}
		})
		if (rolled.length > 0) {
			const labelMap = await getLabelMapForIssues(
				tx,
				workspaceId,
				rolled.map((r) => r.id)
			)
			for (const r of rolled) {
				changes.push({
					entityType: 'issue',
					entityId: r.id,
					action: 'upsert',
					scope: [`project:${r.projectId}`],
					payload: {
						...r,
						identifier: `${r.projectKey}-${r.number}`,
						labelIds: labelMap.get(r.id) ?? []
					} as unknown as Record<string, unknown>,
					actorId: null
				})
			}
		}
	}

	// ---- b) ACTIVATE: earliest due planned cycle, only when nothing is active.
	const hasActive = cycles.some((c) => c.status === 'active')
	if (!hasActive) {
		const due = cycles.find((c) => isCycleDueToActivate(c, today, false))
		if (due) {
			const activated = await transitionCycleStatus(tx, {
				workspaceId,
				cycleId: due.id,
				fromStatus: 'planned',
				toStatus: 'active'
			})
			if (activated) {
				counts.activated++
				// Mutate the local copy so completion/snapshot see post-tx state.
				cycles.splice(cycles.indexOf(due), 1, activated)
				events.push({
					aggregate: 'cycle',
					aggregateId: activated.id,
					eventType: TASKS_EVENTS.CycleActivated,
					payload: {
						cycleId: activated.id,
						projectId,
						name: activated.name,
						startsAt: activated.startsAt,
						endsAt: activated.endsAt,
						actorType: 'system'
					}
				})
				changes.push({
					entityType: 'cycle',
					entityId: activated.id,
					action: 'upsert',
					scope: [`project:${projectId}`],
					payload: activated as unknown as Record<string, unknown>,
					actorId: null
				})
			}
		}
	}

	// ---- c) PRE-CREATE: top up so minAhead future cycles are planned (§3.3).
	const windowsNow = cycles.map((o) => ({ startsAt: o.startsAt, endsAt: o.endsAt }))
	const toCreate = windowsToPreCreate(windowsNow, policy, today, 2)
	if (toCreate.length > 0) {
		const base = await countProjectCycles(tx, workspaceId, projectId)
		for (const [i, window] of toCreate.entries()) {
			const created = await insertPlannedCycle(
				tx,
				{ workspaceId, projectId, name: `Cycle ${base + i + 1}`, window },
				events,
				changes
			)
			counts.created++
			cycles.push(created)
		}
	}

	// ---- d) SNAPSHOT: today's burnup row per active cycle.
	for (const c of cycles) {
		if (c.status !== 'active') continue
		const scope = await cycleScopeCounts(tx, workspaceId, c.id)
		const prev = await priorSnapshotTotalIssues(tx, workspaceId, c.id, today)
		// NET delta vs the previous snapshot's total — the exact per-issue
		// membership tracking (who entered/left the cycle and when) arrives
		// with issue_activity in M8; until then this net approximation is the
		// documented scope-creep signal. No prior snapshot → no baseline → 0/0.
		const scopeAdded = prev === null ? 0 : Math.max(0, scope.totalIssues - prev)
		const scopeRemoved = prev === null ? 0 : Math.max(0, prev - scope.totalIssues)
		const written = await upsertCycleSnapshotRow(tx, {
			workspaceId,
			cycleId: c.id,
			snapshotDate: today,
			totalIssues: scope.totalIssues,
			completedIssues: scope.completedIssues,
			startedIssues: scope.startedIssues,
			cancelledIssues: scope.cancelledIssues,
			totalEstimate: scope.totalEstimate,
			completedEstimate: scope.completedEstimate,
			scopeAddedCount: scopeAdded,
			scopeRemovedCount: scopeRemoved
		})
		if (written) counts.snapshotted++
	}

	// Outbox + change_log go LAST in the tx — the cursor allocation on
	// workspace_seq serializes commit order (§9.2, repo rule 3).
	await emitTasksEvents(tx, workspaceId, events)
	await appendChanges(tx, workspaceId, changes)
	return counts
}

/**
 * One nightly pass over every cycle-enabled project. A failing project is
 * logged and skipped — it must never block the other tenants.
 */
export async function runCycleMaintenanceOnce(app: Sql, now?: Date): Promise<CycleMaintenanceResult> {
	const today = isoDateUtc(now ?? new Date())
	const projects = await withSystem(app, (tx) => listCycleMaintenanceProjects(tx))
	const total = zeroCounts()
	let projectsProcessed = 0
	for (const p of projects) {
		const counts = await withWorkspace(app, { workspaceId: p.workspaceId }, (tx) =>
			maintainProjectCycles(tx, p.workspaceId, p.projectId, today)
		).catch((err) => {
			log.warn(
				{ err, workspaceId: p.workspaceId, projectId: p.projectId },
				'cycle maintenance failed for project'
			)
			return null
		})
		if (counts === null) continue
		projectsProcessed++
		total.activated += counts.activated
		total.completed += counts.completed
		total.rolledOver += counts.rolledOver
		total.snapshotted += counts.snapshotted
		total.created += counts.created
	}
	return { projectsProcessed, ...total }
}
