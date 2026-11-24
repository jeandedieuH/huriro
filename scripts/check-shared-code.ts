#!/usr/bin/env bun
/**
 * Shared client code ratio gate (Gate G6 / §18).
 *
 * Ensures >= 60% of client domain, sync, editor, contracts, design-tokens,
 * i18n, and env TypeScript LOC live in shared `packages/*` rather than
 * duplicated inside `apps/mobile/{src,app}`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const MIN_SHARED_RATIO = 0.6

const SHARED_DIRS = [
	'packages/contracts/src',
	'packages/domain/src',
	'packages/editor/src',
	'packages/i18n/src',
	'packages/i18n/locales',
	'packages/design-tokens/src',
	'packages/sync-client/src',
	'packages/env'
]

const MOBILE_DIRS = ['apps/mobile/src', 'apps/mobile/app']

function countTsLoc(dir: string): number {
	const abs = join(ROOT, dir)
	if (!existsSync(abs)) return 0
	let loc = 0
	const stack = [abs]
	while (stack.length > 0) {
		const cur = stack.pop()
		if (!cur) continue
		for (const entry of readdirSync(cur)) {
			if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
			const full = join(cur, entry)
			const st = statSync(full)
			if (st.isDirectory()) {
				stack.push(full)
				continue
			}
			if (!/\.(ts|tsx)$/.test(entry)) continue
			if (/\.(test|spec|stories)\.(ts|tsx)$/.test(entry) || entry.endsWith('.d.ts')) continue
			const text = readFileSync(full, 'utf8')
			for (const line of text.split('\n')) {
				const trimmed = line.trim()
				if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
					continue
				}
				loc += 1
			}
		}
	}
	return loc
}

const sharedLoc = SHARED_DIRS.reduce((sum, dir) => sum + countTsLoc(dir), 0)
const mobileLoc = MOBILE_DIRS.reduce((sum, dir) => sum + countTsLoc(dir), 0)
const total = sharedLoc + mobileLoc
const ratio = total === 0 ? 0 : sharedLoc / total

console.log(
	`shared code ratio: ${(ratio * 100).toFixed(1)}% (shared=${sharedLoc} LOC, mobile=${mobileLoc} LOC, min=${(MIN_SHARED_RATIO * 100).toFixed(0)}%)`
)

if (ratio < MIN_SHARED_RATIO) {
	console.error(
		`shared code gate failed: ${(ratio * 100).toFixed(1)}% < ${(MIN_SHARED_RATIO * 100).toFixed(0)}%`
	)
	process.exit(1)
}
