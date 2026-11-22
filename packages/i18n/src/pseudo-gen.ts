#!/usr/bin/env bun
/**
 * Pseudo-locale generator (§17.8): wraps every en string in ⟪ ⟫, doubles vowels,
 * and pads ~35% to expose truncation/overflow — the classic pseudo-loc recipe.
 * Emits locales/pseudo.ts; run via `gen`, drift checked via `gen:check`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(import.meta.dir, '..', 'locales')
const CHECK = process.argv.includes('--check')

const VOWELS = 'aeiouyAEIOUY'
const ACCENTS: Record<string, string> = {
	a: 'à',
	e: 'é',
	i: 'í',
	o: 'ó',
	u: 'ú',
	y: 'ý',
	A: 'À',
	E: 'É',
	I: 'Í',
	O: 'Ó',
	U: 'Ú',
	Y: 'Ý'
}

function pseudoize(s: string): string {
	const accented = s
		.split('')
		.map((c) => (VOWELS.includes(c) ? `${ACCENTS[c] ?? c}${ACCENTS[c]?.toLowerCase() ?? c}` : c))
		.join('')
	return `⟪${accented}⟫ ${'~'.repeat(Math.max(1, Math.round(s.length * 0.35)))}`
}

const src = readFileSync(join(DIR, 'en.ts'), 'utf8')
const pairs = [...src.matchAll(/'([^']+)':\s*'((?:[^'\\]|\\.)*)'/g)]
const body = pairs.map((m) => `\t'${m[1]}': '${pseudoize(m[2] ?? '').replaceAll("'", "\\'")}'`).join(',\n')

const out = `// GENERATED from en.ts by pseudo-gen.ts — do not edit (bun run gen)
export const pseudo = {
${body}
} as const
`

const target = join(DIR, 'pseudo.ts')
const existing = (() => {
	try {
		return readFileSync(target, 'utf8')
	} catch {
		return null
	}
})()

if (CHECK) {
	if (existing !== out) {
		console.error('stale: locales/pseudo.ts — run `bun run gen` in @huriro/i18n')
		process.exit(1)
	}
	console.log('pseudo.ts up to date')
} else {
	writeFileSync(target, out)
	console.log(`wrote locales/pseudo.ts (${pairs.length} messages)`)
}
