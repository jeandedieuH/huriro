// Runtime seam — the whole CLI is tested in-process by injecting this (§13.1a).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import axios from 'axios'

export type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>

// Statuses whose responses must not carry a body (per the Fetch spec).
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])

/**
 * The real network transport for the CLI, backed by axios (Node http adapter —
 * which also honors HTTP(S)_PROXY env vars, useful for corporate-network CLI
 * installs). Adapted back into a fetch `Response` so the `Io` injection seam
 * used by tests keeps its fetch-shaped contract.
 */
async function axiosFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
	const isRequest = typeof Request !== 'undefined' && url instanceof Request
	const headers: Record<string, string> = {}
	const mergeHeaders = (h: Headers): void => {
		h.forEach((v, k) => {
			headers[k] = v
		})
	}
	if (isRequest) mergeHeaders(url.headers)
	if (init?.headers) mergeHeaders(new Headers(init.headers))

	const signal = init?.signal ?? (isRequest ? url.signal : undefined)
	const res = await axios.request<string>({
		url: String(isRequest ? url.url : url),
		method: init?.method ?? (isRequest ? url.method : 'GET'),
		headers,
		// CLI request bodies are always strings today (JSON / urlencoded).
		data: (init?.body ?? (isRequest ? await url.text() : undefined)) as string | undefined,
		...(signal ? { signal } : {}),
		responseType: 'text',
		// Keep the raw body — callers parse JSON themselves through Response.
		transformResponse: [],
		validateStatus: () => true
	})
	const resHeaders = new Headers()
	for (const [k, v] of Object.entries(res.headers as Record<string, string | string[] | undefined>)) {
		if (v === undefined) continue
		for (const item of Array.isArray(v) ? v : [v]) resHeaders.append(k, item)
	}
	return new Response(NULL_BODY_STATUSES.has(res.status) || !res.data ? null : res.data, {
		status: res.status,
		statusText: res.statusText,
		headers: resHeaders
	})
}

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
		fetch: (url, init) => axiosFetch(url, init),
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
