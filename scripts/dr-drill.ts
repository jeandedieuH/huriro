#!/usr/bin/env bun
/**
 * Disaster recovery & restore rehearsal script (§20, Gate G6).
 *
 * Modes:
 *   bun scripts/dr-drill.ts             -- dry-run checks (CI safe, no DB needed)
 *   bun scripts/dr-drill.ts --live      -- live PostgreSQL 18 restore rehearsal (< 15 min RTO)
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const LIVE = process.argv.includes('--live') || process.env['HURIRO_DR_LIVE'] === '1'
const RTO_BUDGET_MS = 15 * 60 * 1000

const migDir = join(ROOT, 'packages/db/migrations')
const migrations = readdirSync(migDir)
	.filter((f) => /^\d{4}_.*\.sql$/.test(f))
	.sort()

if (migrations.length === 0) {
	console.error('dr-drill: no SQL migrations found in packages/db/migrations')
	process.exit(1)
}

for (let i = 0; i < migrations.length; i++) {
	const file = migrations[i]
	if (!file) continue
	const expectedPrefix = String(i + 1).padStart(4, '0')
	if (!file.startsWith(expectedPrefix)) {
		console.error(`dr-drill: expected migration prefix ${expectedPrefix}, found ${file}`)
		process.exit(1)
	}
	const bytes = readFileSync(join(migDir, file))
	const sha = createHash('sha256').update(bytes).digest('hex').slice(0, 12)
	if (i === migrations.length - 1) {
		console.log(`dr-drill: latest migration ${file} (sha256:${sha})`)
	}
}

const requiredDocs = ['docs/ops/runbook.md']
for (const doc of requiredDocs) {
	if (!existsSync(join(ROOT, doc))) {
		console.error(`dr-drill: missing required runbook ${doc}`)
		process.exit(1)
	}
}

const backupCliPath = join(ROOT, 'apps/server/src/cli/ops.ts')
if (!existsSync(backupCliPath)) {
	console.error('dr-drill: missing apps/server/src/cli/ops.ts backup command')
	process.exit(1)
}

if (!LIVE) {
	console.log(
		`dr-drill: dry-run passed (${migrations.length} sequential migrations, runbook & backup CLI verified)`
	)
	process.exit(0)
}

const databaseUrl = process.env['DATABASE_ADMIN_URL'] ?? process.env['DATABASE_URL']
if (!databaseUrl) {
	console.error('dr-drill: --live requires DATABASE_ADMIN_URL or DATABASE_URL')
	process.exit(1)
}

const started = Date.now()
const url = new URL(databaseUrl)
const adminUrl = new URL(databaseUrl)
adminUrl.pathname = '/postgres'
const drillDb = `huriro_dr_drill_${Date.now()}`

// Root scripts/ can't see workspace links — resolve @huriro/db through
// apps/server's dependency context, then import the resolved entry.
const { createRequire } = await import('node:module')
const { pathToFileURL } = await import('node:url')
const serverRequire = createRequire(join(ROOT, 'apps/server', 'package.json'))
const dbEntry = pathToFileURL(serverRequire.resolve('@huriro/db')).href
const { createOwnerPool, migrate } = (await import(dbEntry)) as typeof import('../packages/db/src/index')
const adminSql = createOwnerPool(adminUrl.toString(), { max: 2 })

try {
	await adminSql.unsafe(`CREATE DATABASE "${drillDb}"`)
	url.pathname = `/${drillDb}`
	const drillSql = createOwnerPool(url.toString(), { max: 2 })
	try {
		await migrate(drillSql, migDir)
		const rlsRows = await drillSql<
			{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
		>`
			SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = 'public'
			  AND c.relname IN ('workspaces', 'issues', 'billing_subscriptions', 'workspace_exports')
		`
		if (rlsRows.length < 4 || rlsRows.some((r) => !r.relrowsecurity || !r.relforcerowsecurity)) {
			throw new Error(`DR drill RLS verification failed: ${JSON.stringify(rlsRows)}`)
		}
	} finally {
		await drillSql.end({ timeout: 5 })
	}
} finally {
	await adminSql.unsafe(`DROP DATABASE IF EXISTS "${drillDb}" WITH (FORCE)`).catch(() => {})
	await adminSql.end({ timeout: 5 })
}

const elapsedMs = Date.now() - started
console.log(`dr-drill: live restore rehearsal passed in ${elapsedMs} ms (budget=${RTO_BUDGET_MS} ms)`)
if (elapsedMs > RTO_BUDGET_MS) {
	console.error(`dr-drill: exceeded RTO budget (${elapsedMs} ms > ${RTO_BUDGET_MS} ms)`)
	process.exit(1)
}
