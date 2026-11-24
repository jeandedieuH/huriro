// Runtime seam — the whole CLI is tested in-process by injecting this (§13.1a).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface Io {
	readonly fetch: FetchLike
	readonly env: Record<string, string | undefined>
	readonly stdout: (text: string) => void
	readonly stderr: (text: string) => void
	/** Read all of stdin (interactive prompt answers / piped --input -). */
	readonly readStdin: () => Promise<string>
	readonly configDir: string
	readonly readFile: (path: string) => string
	readonly sleep: (ms: number) => Promise<void>
	readonly randomId: () => string
	readonly now: () => number
	readonly writeFile0600: (path: string, data: string) => void
	readonly isTty: boolean
}

function realSleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms))
}

function write0600(path: string, data: string): void {
	mkdirSync(dirname(path), { recursive: true })
	const tmp = `${path}.${process.pid}.tmp`
	writeFileSync(tmp, data, { mode: 0o600 })
	renameSync(tmp, path)
}

export function defaultConfigDir(env: Record<string, string | undefined>): string {
	if (env['XDG_CONFIG_HOME']) return join(env['XDG_CONFIG_HOME'], 'huriro')
	if (env['APPDATA']) return join(env['APPDATA'], 'huriro')
	return join(env['HOME'] ?? env['USERPROFILE'] ?? '.', '.config', 'huriro')
}

export function defaultIo(env: Record<string, string | undefined> = process.env): Io {
	return {
		fetch: (url, init) => globalThis.fetch(url, init),
		env,
		stdout: (t) => process.stdout.write(`${t}\n`),
		stderr: (t) => process.stderr.write(`${t}\n`),
		readStdin: async () => {
			const chunks: Buffer[] = []
			for await (const c of process.stdin) chunks.push(c as Buffer)
			return Buffer.concat(chunks).toString('utf8')
		},
		configDir: defaultConfigDir(env),
		readFile: (p) => readFileSync(p, 'utf8'),
		sleep: realSleep,
		randomId: () => crypto.randomUUID(),
		now: () => Date.now(),
		writeFile0600: write0600,
		isTty: process.stdout.isTTY === true
	}
}

/** In-memory Io for tests — filesystem under configDir is faked. */
export function testIo(over: Partial<Io> = {}): Io & {
	out: string[]
	err: string[]
	files: Map<string, string>
	stdin: (text: string) => void
} {
	const out: string[] = []
	const err: string[] = []
	const files = new Map<string, string>()
	let stdinText = ''
	const base: Io = {
		fetch: over.fetch ?? (async () => new Response('{}', { status: 404 })),
		env: over.env ?? {},
		stdout: (t) => out.push(t),
		stderr: (t) => err.push(t),
		readStdin: async () => stdinText,
		configDir: over.configDir ?? '/cfg',
		readFile: (p) => files.get(p) ?? '',
		sleep: async () => {},
		randomId: () => `id-${out.length}-${err.length}`,
		now: () => 1_000_000,
		writeFile0600: (p, d) => void files.set(p, d),
		isTty: false,
		...over
	}
	return {
		...base,
		out,
		err,
		files,
		stdin: (t) => {
			stdinText = t
		}
	}
}
