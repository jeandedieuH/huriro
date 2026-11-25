/**
 * M7 workflow automation integration (ADR-0028): outbox matcher + executor,
 * FilterExpr conditions, quota/kill switch, dry-run rollback, cron optimistic
 * claiming, YAML round-trip, permissions, and the R23 depth-5 loop guard.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { TestDb } from '@huriro/test-utils'
import { runAutomationCronOnce } from '../modules/automations'
import { drainOutboxOnce } from '../worker'
import { apiRequest, createIntegrationServer, getTestDb, seedM1Fixture } from './test-harness'

let db: TestDb | null = null

beforeAll(async () => {
	db = await getTestDb()
})

type App = ReturnType<typeof createIntegrationServer>['app']
type Fixture = Awaited<ReturnType<typeof seedM1Fixture>>

function req(app: App, fixture: Fixture, opts: Parameters<typeof apiRequest>[1]) {
	return apiRequest(app, { workspaceId: fixture.workspaceId, userId: fixture.ownerId, ...opts })
}

async function createProject(app: App, fixture: Fixture, key = 'AUTO'): Promise<string> {
	const res = await req(app, fixture, {
		method: 'POST',
		path: '/api/v1/projects',
		headers: { 'idempotency-key': randomUUID() },
		body: { key, name: 'Automation' }
	})
	expect(res.status).toBe(201)
	return String(res.json['id'])
}

async function createIssue(
	app: App,
	fixture: Fixture,
	projectId: string,
	body: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
	const res = await req(app, fixture, {
		method: 'POST',
		path: '/api/v1/issues',
		headers: { 'idempotency-key': randomUUID() },
		body: { projectId, title: `automation-${randomUUID().slice(0, 8)}`, ...body }
	})
	expect(res.status).toBe(201)
	return res.json
}

async function createEventRule(
	app: App,
	fixture: Fixture,
	body: {
		readonly name: string
		readonly eventTypes: readonly string[]
		readonly actions: readonly Record<string, unknown>[]
		readonly condition?: unknown
	}
): Promise<Record<string, unknown>> {
	const res = await req(app, fixture, {
		method: 'POST',
		path: '/api/v1/automations/rules',
		body: {
			name: body.name,
			enabled: true,
			triggerKind: 'event',
			triggerConfig: { eventTypes: body.eventTypes },
			...(body.condition !== undefined ? { condition: body.condition } : {}),
			actions: body.actions
		}
	})
	expect(res.status).toBe(201)
	return res.json
}

async function drainWorkspace(database: TestDb, workspaceId: string, passes = 1): Promise<void> {
	for (let i = 0; i < passes; i++) {
		await drainOutboxOnce(database.app, undefined, { onlyWorkspaceId: workspaceId, backoffBaseMs: 0 })
	}
}

async function runsForRule(app: App, fixture: Fixture, ruleId: string): Promise<Record<string, unknown>[]> {
	const res = await req(app, fixture, { path: `/api/v1/automations/runs?ruleId=${ruleId}&limit=100` })
	expect(res.status).toBe(200)
	return res.json['data'] as Record<string, unknown>[]
}

describe('M7 workflow automation engine (PostgreSQL 18)', () => {
	test('event match executes, conditions skip/pass, failures abort remaining steps, and permissions hold', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		try {
			const projectId = await createProject(app, fixture)
			const passRule = await createEventRule(app, fixture, {
				name: 'urgent gets triaged down',
				eventTypes: ['tasks.issue.created.v1'],
				condition: { kind: 'pred', field: 'priority', op: 'eq', value: 4 },
				actions: [{ kind: 'issue.update', issueId: '{{issueId}}', priority: 2 }]
			})
			const skipRule = await createEventRule(app, fixture, {
				name: 'low priority only',
				eventTypes: ['tasks.issue.created.v1'],
				condition: { kind: 'pred', field: 'priority', op: 'eq', value: 3 },
				actions: [{ kind: 'issue.update', issueId: '{{issueId}}', priority: 1 }]
			})
			const failureRule = await createEventRule(app, fixture, {
				name: 'failure aborts tail',
				eventTypes: ['tasks.issue.created.v1'],
				actions: [
					{ kind: 'issue.update', issueId: '{{issueId}}', priority: 1 },
					{ kind: 'chat.post_message', channelId: randomUUID(), bodyText: 'cannot post here' },
					{ kind: 'issue.update', issueId: '{{issueId}}', priority: 0 }
				]
			})

			const issue = await createIssue(app, fixture, projectId, { priority: 4 })
			await drainWorkspace(db, fixture.workspaceId)

			const after = await req(app, fixture, { path: `/api/v1/issues/${String(issue['id'])}` })
			const afterIssue = (after.json['issue'] ?? after.json) as Record<string, unknown>
			// passRule sets 2; failureRule's first step then sets 1 before its second step fails.
			expect(afterIssue['priority']).toBe(1)

			const passRuns = await runsForRule(app, fixture, String(passRule['id']))
			expect(passRuns.map((r) => r['status'])).toContain('succeeded')
			const skipRuns = await runsForRule(app, fixture, String(skipRule['id']))
			expect(skipRuns).toHaveLength(1)
			expect(skipRuns[0]?.['status']).toBe('skipped')
			const failureRuns = await runsForRule(app, fixture, String(failureRule['id']))
			expect(failureRuns).toHaveLength(1)
			expect(failureRuns[0]?.['status']).toBe('failed')
			const failedDetail = await req(app, fixture, {
				path: `/api/v1/automations/runs/${String(failureRuns[0]?.['id'])}`
			})
			expect((failedDetail.json['steps'] as unknown[]).length).toBe(3)
			expect((failedDetail.json['steps'] as Record<string, unknown>[])[1]?.['status']).toBe('failed')
			expect((failedDetail.json['steps'] as Record<string, unknown>[])[2]?.['status']).toBe('skipped')

			// Member may read but not manage; guest has neither automation permission.
			const memberRead = await apiRequest(app, {
				path: '/api/v1/automations/rules',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId
			})
			expect(memberRead.status).toBe(200)
			const memberWrite = await apiRequest(app, {
				method: 'POST',
				path: '/api/v1/automations/rules',
				workspaceId: fixture.workspaceId,
				userId: fixture.memberAId,
				body: {
					name: 'member denied',
					triggerKind: 'event',
					triggerConfig: { eventTypes: ['tasks.issue.created.v1'] },
					actions: [{ kind: 'issue.update', issueId: '{{issueId}}', priority: 1 }]
				}
			})
			expect(memberWrite.status).toBe(403)
			const guestRead = await apiRequest(app, {
				path: '/api/v1/automations/rules',
				workspaceId: fixture.workspaceId,
				userId: fixture.guestId
			})
			expect(guestRead.status).toBe(403)
			const crossTenant = await apiRequest(app, {
				path: `/api/v1/automations/rules/${String(passRule['id'])}`,
				workspaceId: fixture.otherWorkspaceId,
				userId: fixture.otherTenantUserId
			})
			expect([403, 404]).toContain(crossTenant.status)

			const deleted = await req(app, fixture, {
				method: 'DELETE',
				path: `/api/v1/automations/rules/${String(passRule['id'])}`
			})
			expect(deleted.status).toBe(204)
		} finally {
			await app.stop()
		}
	}, 60_000)

	test('chat.message.created can execute issue.create through the actor seam', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		try {
			const projectId = await createProject(app, fixture)
			const rule = await createEventRule(app, fixture, {
				name: 'chat intake creates issue',
				eventTypes: ['chat.message.created.v1'],
				actions: [{ kind: 'issue.create', projectId, title: 'Created from chat intake', priority: 2 }]
			})
			const channel = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/chat/channels',
				body: { name: `intake-${randomUUID().slice(0, 8)}` }
			})
			expect(channel.status).toBe(201)
			const message = await req(app, fixture, {
				method: 'POST',
				path: `/api/v1/chat/channels/${String(channel.json['id'])}/messages`,
				body: { bodyText: 'please turn this into work' }
			})
			expect(message.status).toBe(201)
			await drainWorkspace(db, fixture.workspaceId)
			const runs = await runsForRule(app, fixture, String(rule['id']))
			expect(runs.map((r) => r['status'])).toContain('succeeded')
			const issues = await req(app, fixture, { path: `/api/v1/issues?projectId=${projectId}` })
			const titles = (issues.json['data'] as Record<string, unknown>[]).map((issue) => issue['title'])
			expect(titles).toContain('Created from chat intake')
		} finally {
			await app.stop()
		}
	}, 60_000)

	test('depth propagation self-loop trips at depth 5 with no further mutation', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		try {
			const projectId = await createProject(app, fixture)
			const rule = await createEventRule(app, fixture, {
				name: 'self looping priority update',
				eventTypes: ['tasks.issue.updated.v1'],
				actions: [{ kind: 'issue.update', issueId: '{{issueId}}', priority: 4 }]
			})
			const issue = await createIssue(app, fixture, projectId)
			const patch = await req(app, fixture, {
				method: 'PATCH',
				path: `/api/v1/issues/${String(issue['id'])}`,
				body: { version: Number(issue['version']), title: 'manual trigger' }
			})
			expect(patch.status).toBe(200)

			// One pass handles the manual depth-0 event; each following pass handles
			// the depth-N event emitted by the prior automation run.
			await drainWorkspace(db, fixture.workspaceId, 6)
			const runs = await runsForRule(app, fixture, String(rule['id']))
			const statuses = runs.map((r) => r['status'])
			expect(statuses.filter((s) => s === 'succeeded')).toHaveLength(5)
			expect(statuses).toContain('loop_guard_tripped')
			const guard = runs.find((r) => r['status'] === 'loop_guard_tripped')
			expect(guard?.['depth']).toBe(5)

			const finalIssue = await req(app, fixture, { path: `/api/v1/issues/${String(issue['id'])}` })
			const finalBody = (finalIssue.json['issue'] ?? finalIssue.json) as Record<string, unknown>
			// Manual patch + exactly five successful automation mutations; the guard
			// run performs no action and therefore emits no sixth mutation.
			expect(finalBody['version']).toBe(7)
		} finally {
			await app.stop()
		}
	}, 60_000)

	test('quota and workspace kill switch suppress execution as specified', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		try {
			const projectId = await createProject(app, fixture)
			await db.owner`
				UPDATE workspaces
				SET settings = settings || jsonb_build_object('automation_max_runs_per_minute', 1)
				WHERE id = ${fixture.workspaceId}
			`
			const first = await createEventRule(app, fixture, {
				name: 'quota first',
				eventTypes: ['tasks.issue.created.v1'],
				actions: [{ kind: 'issue.update', issueId: '{{issueId}}', priority: 1 }]
			})
			const second = await createEventRule(app, fixture, {
				name: 'quota second',
				eventTypes: ['tasks.issue.created.v1'],
				actions: [{ kind: 'issue.update', issueId: '{{issueId}}', priority: 2 }]
			})
			await createIssue(app, fixture, projectId)
			await drainWorkspace(db, fixture.workspaceId)
			const statuses = [
				...(await runsForRule(app, fixture, String(first['id']))),
				...(await runsForRule(app, fixture, String(second['id'])))
			].map((r) => r['status'])
			expect(statuses).toContain('succeeded')
			expect(statuses).toContain('quota_exceeded')

			await db.owner`
				UPDATE workspaces
				SET settings = settings || jsonb_build_object('automations_enabled', false)
				WHERE id = ${fixture.workspaceId}
			`
			const disabledRule = await createEventRule(app, fixture, {
				name: 'kill switch rule',
				eventTypes: ['tasks.issue.created.v1'],
				actions: [{ kind: 'issue.update', issueId: '{{issueId}}', priority: 3 }]
			})
			await createIssue(app, fixture, projectId)
			await drainWorkspace(db, fixture.workspaceId)
			expect(await runsForRule(app, fixture, String(disabledRule['id']))).toHaveLength(0)
		} finally {
			await app.stop()
		}
	}, 60_000)

	test('dry-run rolls mutations back, cron claiming is idempotent, and YAML round-trips', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		try {
			const projectId = await createProject(app, fixture)
			const issue = await createIssue(app, fixture, projectId, { priority: 0 })
			const rule = await createEventRule(app, fixture, {
				name: 'portable simulation rule',
				eventTypes: ['tasks.issue.created.v1'],
				condition: { kind: 'pred', field: 'priority', op: 'gte', value: 0 },
				actions: [{ kind: 'issue.update', issueId: '{{issueId}}', priority: 4 }]
			})
			// Simulation is the pre-enable check: disabling the rule must not make
			// the dry-run useless (and this exercises the version-locked PATCH route).
			const disable = await req(app, fixture, {
				method: 'PATCH',
				path: `/api/v1/automations/rules/${String(rule['id'])}`,
				body: { enabled: false, version: Number(rule['version']) }
			})
			expect(disable.status).toBe(200)

			const simulation = await req(app, fixture, {
				method: 'POST',
				path: `/api/v1/automations/rules/${String(rule['id'])}/simulate`,
				body: { eventType: 'tasks.issue.created.v1', payload: { issueId: String(issue['id']), projectId } }
			})
			expect(simulation.status).toBe(200)
			expect(simulation.json['status']).toBe('succeeded')
			expect((simulation.json['steps'] as Record<string, unknown>[])[0]?.['status']).toBe('simulated')
			expect((simulation.json['run'] as Record<string, unknown>)['dryRun']).toBe(true)
			const unchanged = await req(app, fixture, { path: `/api/v1/issues/${String(issue['id'])}` })
			expect(((unchanged.json['issue'] ?? unchanged.json) as Record<string, unknown>)['priority']).toBe(0)
			const dryRuns = await runsForRule(app, fixture, String(rule['id']))
			expect(dryRuns.some((r) => r['dryRun'] === true && r['status'] === 'dry_run')).toBe(true)

			const exported = await req(app, fixture, {
				path: `/api/v1/automations/rules/${String(rule['id'])}/yaml`
			})
			expect(exported.status).toBe(200)
			const yamlText = String(exported.json['raw'])
			expect(yamlText).toContain('portable simulation rule')
			const imported = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/automations/rules/import',
				body: { yaml: yamlText }
			})
			expect(imported.status).toBe(201)
			expect(imported.json['id']).toBe(rule['id'])
			const exportedAgain = await req(app, fixture, {
				path: `/api/v1/automations/rules/${String(imported.json['id'])}/yaml`
			})
			expect(String(exportedAgain.json['raw'])).toBe(yamlText)

			// Cron: backdate the schedule as fixture state, then prove the optimistic
			// next_run_at advance makes a duplicate tick a no-op.
			const cronRuleRes = await req(app, fixture, {
				method: 'POST',
				path: '/api/v1/automations/rules',
				body: {
					name: 'cron rule',
					enabled: true,
					triggerKind: 'cron',
					triggerConfig: { cron: '* * * * *', timezone: 'UTC' },
					actions: [{ kind: 'issue.update', issueId: String(issue['id']), priority: 3 }]
				}
			})
			expect(cronRuleRes.status).toBe(201)
			const cronRuleId = String(cronRuleRes.json['id'])
			const now = new Date()
			await db.owner`
				UPDATE automation_rules
				SET next_run_at = ${new Date(now.getTime() - 60_000).toISOString()}
				WHERE id = ${cronRuleId}
			`
			const firstTick = await runAutomationCronOnce(db.app, now)
			expect(firstTick.runIds.some((r) => r.workspaceId === fixture.workspaceId)).toBe(true)
			const secondTick = await runAutomationCronOnce(db.app, now)
			expect(secondTick.runIds.some((r) => r.workspaceId === fixture.workspaceId)).toBe(false)
			const cronRuns = await runsForRule(app, fixture, cronRuleId)
			expect(cronRuns.filter((r) => r['status'] === 'succeeded')).toHaveLength(1)
		} finally {
			await app.stop()
		}
	}, 60_000)
})
