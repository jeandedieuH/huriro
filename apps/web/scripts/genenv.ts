/**
 * `bun run gen` — emit .env.example FROM the web env schema in @huriro/env
 * (single source of truth, §7.5). `--check` fails CI if the file drifted.
 */
import { renderEnvExample } from '@huriro/env'
import { webSchemas } from '@huriro/env/web'

export function renderWebEnvExample(): string {
	return renderEnvExample({
		schemas: webSchemas,
		generatedBy: '`bun run gen`',
		source: 'packages/env/web'
	})
}

export async function genenv(args: string[]): Promise<void> {
	// Path is resolved from this file, not cwd — turbo/bun run it from anywhere.
	const target = `${import.meta.dir}/../.env.example`
	if (args.includes('--check')) {
		const current = await Bun.file(target)
			.text()
			.catch(() => '')
		if (current !== renderWebEnvExample()) {
			console.error(`${target} is stale — run \`bun run --cwd apps/web gen\``)
			process.exit(1)
		}
		console.log(`${target} is up to date`)
		return
	}
	await Bun.write(target, renderWebEnvExample())
	console.log(`wrote ${target}`)
}

// Direct invocation: `bun scripts/genenv.ts [--check]`
if (import.meta.main) await genenv(Bun.argv.slice(2))
