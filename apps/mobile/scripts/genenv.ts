import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderEnvExample } from '@huriro/env'
import { mobileSchemas } from '@huriro/env/mobile'

const OUT_PATH = resolve(import.meta.dirname, '..', '.env.example')
const CHECK = process.argv.includes('--check')

const expected = renderEnvExample({
	schemas: mobileSchemas,
	generatedBy: '`bun run --cwd apps/mobile gen`',
	source: 'packages/env/mobile'
})

if (CHECK) {
	const actual = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, 'utf8') : ''
	if (actual !== expected) {
		console.error(`stale: ${OUT_PATH} — run \`bun run --cwd apps/mobile gen\``)
		process.exit(1)
	}
	process.exit(0)
}

writeFileSync(OUT_PATH, expected, 'utf8')
console.log(`wrote ${OUT_PATH}`)
