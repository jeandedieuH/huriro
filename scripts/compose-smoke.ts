#!/usr/bin/env bun
/**
 * Compose smoke test (§19 exit gate). Two modes:
 *   bun scripts/compose-smoke.ts          config + topology assertions (no pulls)
 *   bun scripts/compose-smoke.ts --up     full boot: postgres→huriro→/health→down
 *
 * Topology assertions encode the §19.4 invariants so a regression in
 * infra/compose/compose.yml fails loudly instead of shipping a misconfig.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const COMPOSE = join(ROOT, 'infra/compose/compose.yml')
const UP = process.argv.includes('--up')

function run(cmd: string[], opts: { capture?: boolean } = {}) {
	const r = spawnSync(cmd[0]!, cmd.slice(1), {
		cwd: ROOT,
		encoding: 'utf8',
		stdio: opts.capture ? 'pipe' : 'inherit',
		env: { ...process.env, COMPOSE_PROJECT_NAME: 'huriro-smoke' }
	})
	return r
}

function fail(msg: string): never {
	console.error(`smoke: ${msg}`)
	process.exit(1)
}

// 1. compose config must render — catches YAML/interpolation errors before pull.
const cfg = run(['docker', 'compose', '-f', COMPOSE, 'config', '--quiet'], { capture: true })
if (cfg.status !== 0) fail(`compose config failed:\n${cfg.stderr}`)

const rendered = run(['docker', 'compose', '-f', COMPOSE, 'config'], { capture: true })
if (rendered.status !== 0) fail(`compose config render failed:\n${rendered.stderr}`)
const yml = rendered.stdout
console.log('compose config: renders cleanly')

// 2. Security/topology assertions (§19.4).
const assert = (cond: boolean, name: string) => {
	if (!cond) fail(`invariant violated: ${name}`)
	console.log(`  ok: ${name}`)
}

assert(/name:\s*huriro/.test(yml), 'project name is huriro')
assert(/networks:[\s\S]*edge:[\s\S]*data:/.test(yml), 'edge + data networks exist')
// Postgres block must stay off the edge network and stay hardened.
// Services render alphabetically (caddy, clamav, garage, huriro, postgres,
// valkey) — anchor on the indented service key so image names don't match.
const services = yml.slice(yml.indexOf('\nservices:'), yml.indexOf('\nnetworks:'))
const pgBlock = services.slice(services.indexOf('\n  postgres:'))
assert(!/edge:/.test(pgBlock), 'postgres is NOT on the edge network')
assert(/data:/.test(pgBlock), 'postgres is on the data network')
assert(/read_only:\s*true/.test(pgBlock), 'postgres read_only fs')
assert(/no-new-privileges/.test(pgBlock), 'postgres no-new-privileges')
assert(/cap_drop[\s\S]*ALL/.test(pgBlock), 'postgres drops all caps')
assert(/pg_isready/.test(pgBlock), 'postgres healthcheck present')
const appBlock = services.slice(services.indexOf('\n  huriro:'), services.indexOf('\n  postgres:'))
assert(/read_only:\s*true/.test(appBlock), 'app read_only fs')
assert(/no-new-privileges/.test(appBlock), 'app no-new-privileges')
assert(/secret_key/.test(yml) && /setup_token_hash/.test(yml), 'required secrets declared')
assert(!/environment:[\s\S]*PASSWORD:\s*\S+/.test(yml), 'no inline passwords in environment')

// Secret files must exist for --up; config mode only warns.
const secretsDir = join(ROOT, 'secrets')
const needSecrets = ['pg_password', 'app_db_password', 'maint_db_password', 'auth_db_password', 'database_url', 'database_admin_url', 'database_auth_url', 'secret_key', 'setup_token_hash']
const missing = needSecrets.filter((s) => !existsSync(join(secretsDir, s)))
if (UP && missing.length > 0) fail(`missing secrets (run \`huriro init\` first): ${missing.join(', ')}`)

if (!UP) {
	console.log('smoke: config + invariants pass (use --up for a full boot test)')
	process.exit(0)
}

// 3. Full boot: pull/build is slow — this is the manual drill path.
console.log('smoke: bringing stack up (build may take several minutes)...')
const up = run(['docker', 'compose', '-f', COMPOSE, 'up', '-d', '--build', '--wait'])
if (up.status !== 0) {
	run(['docker', 'compose', '-f', COMPOSE, 'logs', '--tail', '50'])
	run(['docker', 'compose', '-f', COMPOSE, 'down', '-v'])
	fail('stack did not become healthy')
}
// Health endpoint through the app's healthcheck already passed via --wait;
// hit the HTTP endpoint through Caddy as the final assertion.
const health = run(['docker', 'compose', '-f', COMPOSE, 'exec', '-T', 'caddy', 'wget', '-qO-', 'http://huriro:3000/health'], { capture: true })
const ok = health.status === 0 && /ok|healthy|status/i.test(health.stdout)
run(['docker', 'compose', '-f', COMPOSE, 'down', '-v'])
if (!ok) fail(`/health check failed: ${health.stdout} ${health.stderr}`)
console.log('smoke: full stack booted, /health ok, torn down cleanly')
