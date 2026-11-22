/**
 * License allowlist gate (§4.2): every production dependency must resolve to
 * an OSI license we ship under AGPL-3.0. DevDependencies are checked too —
 * dev tools still ship in the repo (just not the image).
 *
 * Data source: `bun pm ls --all` would be ideal; we read installed
 * package.json license fields via bun's lockfile-resolved tree instead —
 * simpler: `bun pm ls` isn't stable across versions, so walk node_modules.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const ALLOWED = new Set([
	'MIT',
	'MIT-0',
	'Apache-2.0',
	'BSD-2-Clause',
	'BSD-3-Clause',
	'0BSD',
	'ISC',
	'CC0-1.0',
	'Unlicense',
	'Python-2.0',
	'MPL-2.0',
	'BlueOak-1.0.0'
])

// Packages we ship ourselves; AGPL is OUR outbound license, not a dependency's.
const SELF = /^@huriro\//
const SKIP_DIRS = new Set(['node_modules', '.bin'])

async function* walk(dir: string, depth = 0): AsyncGenerator<string> {
	if (depth > 3) return
	let entries: string[]
	try {
		entries = await readdir(dir)
	} catch {
		return
	}
	for (const name of entries) {
		if (SKIP_DIRS.has(name)) continue
		const p = join(dir, name)
		if (name.startsWith('@')) {
			yield* walk(p, depth + 1)
			continue
		}
		const pkg = Bun.file(join(p, 'package.json'))
		if (await pkg.exists()) yield p
	}
}

const violations: string[] = []
let checked = 0

for await (const dir of walk('node_modules')) {
	const pkg = await Bun.file(join(dir, 'package.json')).json()
	if (SELF.test(pkg.name ?? '')) continue
	const license = pkg.license
	// license may be an SPDX expression ("MIT OR Apache-2.0") or a string[] —
	// normalize to bare identifiers and require every one to be allowlisted.
	const raw: string[] = typeof license === 'string' ? [license] : Array.isArray(license) ? license : []
	const licenses = raw.flatMap((l) => l.match(/[A-Za-z0-9.-]+/g) ?? []).filter((t) => t !== 'OR' && t !== 'AND')
	const ok = licenses.length > 0 && licenses.every((l) => ALLOWED.has(l))
	checked++
	if (!ok) {
		violations.push(`${pkg.name}@${pkg.version} — ${JSON.stringify(license)}`)
	}
}

if (violations.length > 0) {
	console.error(`License allowlist violations (${violations.length}):`)
	for (const v of violations) console.error(`  ${v}`)
	console.error('Allowlist: scripts/check-licenses.ts — additions need a comment + review.')
	process.exit(1)
}
console.log(`license check: ${checked} packages clean`)
