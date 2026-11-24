// Minimal flag parser — no framework dependency (§7.1 lightweight deps).

export interface ParsedArgs {
	readonly positional: string[]
	readonly flags: Record<string, string | boolean>
}

/** Flags that take a value when written as `--flag value` (booleans otherwise). */
const VALUE_FLAGS = new Set([
	'url',
	'workspace',
	'profile',
	'input',
	'input-file',
	'state',
	'm',
	'message',
	'link',
	'scope',
	'timeout',
	'idempotency-key',
	'title',
	'body',
	'status',
	'priority',
	'project',
	'assignee',
	'query',
	'limit',
	'cursor',
	'id',
	'doc',
	'issue',
	'content',
	'format',
	'identifier',
	'slug'
])

export interface ArgsError {
	readonly message: string
}

export function parseArgs(argv: string[]): ParsedArgs | ArgsError {
	const positional: string[] = []
	const flags: Record<string, string | boolean> = {}
	for (let i = 0; i < argv.length; i++) {
		const tok = argv[i] as string
		if (tok === '--') {
			positional.push(...argv.slice(i + 1))
			break
		}
		if (tok.startsWith('--')) {
			const eq = tok.indexOf('=')
			const name = eq === -1 ? tok.slice(2) : tok.slice(2, eq)
			if (eq !== -1) {
				flags[name] = tok.slice(eq + 1)
				continue
			}
			if (VALUE_FLAGS.has(name)) {
				const next = argv[i + 1]
				if (next === undefined) return { message: `flag --${name} requires a value` }
				flags[name] = next
				i++
			} else {
				flags[name] = true
			}
			continue
		}
		if (tok.startsWith('-') && tok.length > 1) {
			const name = tok.slice(1)
			if (VALUE_FLAGS.has(name)) {
				const next = argv[i + 1]
				if (next === undefined) return { message: `flag -${name} requires a value` }
				flags[name] = next
				i++
			} else {
				flags[name] = true
			}
			continue
		}
		positional.push(tok)
	}
	return { positional, flags }
}

export function isArgsError(v: ParsedArgs | ArgsError): v is ArgsError {
	return typeof (v as ArgsError).message === 'string'
}

/** Convert `--foo-bar baz` flags to a camelCase input object for tool calls. */
export function flagsToInput(flags: Record<string, string | boolean>): Record<string, unknown> {
	const input: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(flags)) {
		const key = k.replace(/-([a-z])/g, (_, c) => String(c).toUpperCase())
		if (v === 'true' || v === 'false') input[key] = v === 'true'
		else if (typeof v === 'string' && /^\d+$/.test(v)) input[key] = Number(v)
		else input[key] = v
	}
	return input
}
