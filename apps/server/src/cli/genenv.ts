/**
 * `huriro genenv` — emit .env.example FROM the env schema in @huriro/env
 * (single source of truth, §7.5). `--check` fails CI if the file drifted.
 */
import { renderEnvExample } from '@huriro/env'
import { serverSchemas } from '@huriro/env/server'

export function renderServerEnvExample(): string {
	return renderEnvExample({
		schemas: serverSchemas,
		generatedBy: '`huriro genenv`',
		source: 'packages/env/server'
	})
}

export async function genenv(args: string[]): Promise<void> {
	// Path is resolved from this file, not cwd — turbo/bun run it from anywhere.
	const target = `${import.meta.dir}/../../.env.example`
	if (args.includes('--check')) {
		const current = await Bun.file(target).text()
		if (current !== renderServerEnvExample()) {
			console.error(`${target} is stale — run \`bun run --cwd apps/server gen\``)
			process.exit(1)
		}
		console.log(`${target} is up to date`)
		return
	}
	await Bun.write(target, renderServerEnvExample())
	console.log(`wrote ${target}`)
}

// Direct invocation: `bun src/cli/genenv.ts [--check]`
if (import.meta.main) await genenv(Bun.argv.slice(2))
