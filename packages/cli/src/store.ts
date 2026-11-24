// Credential + profile store. Tokens live in credentials.json (0600, atomic
// writes); never logged — the CLI redacts access/refresh values in errors.
import { join } from 'node:path'
import type { Io } from './io'

export interface StoredCredential {
	readonly accessToken: string
	readonly refreshToken?: string | undefined
	readonly expiresAt?: number | undefined // ms epoch
	readonly scopes?: string[] | undefined
	readonly clientId?: string | undefined
	readonly userId?: string | undefined
	readonly workspaceId?: string | undefined
	readonly kind: 'oauth' | 'api-key'
}

interface StoreFile {
	readonly version: 1
	readonly servers: Record<string, StoredCredential>
}

export function credentialsPath(io: Io): string {
	return join(io.configDir, 'credentials.json')
}

function readStore(io: Io): StoreFile {
	try {
		const raw = io.readFile(credentialsPath(io))
		const parsed = JSON.parse(raw) as StoreFile
		if (parsed && parsed.version === 1 && typeof parsed.servers === 'object') return parsed
	} catch {
		/* missing/corrupt → empty store */
	}
	return { version: 1, servers: {} }
}

export function getCredential(io: Io, server: string): StoredCredential | undefined {
	return readStore(io).servers[normalizeServer(server)]
}

/** Atomic persist: write tmp + rename with 0600 (POSIX). */
export function setCredential(io: Io, server: string, cred: StoredCredential): void {
	const store = readStore(io)
	const next: StoreFile = {
		version: 1,
		servers: { ...store.servers, [normalizeServer(server)]: cred }
	}
	io.writeFile0600(credentialsPath(io), JSON.stringify(next, null, 2))
}

export function deleteCredential(io: Io, server: string): void {
	const store = readStore(io)
	const servers = { ...store.servers }
	delete servers[normalizeServer(server)]
	io.writeFile0600(credentialsPath(io), JSON.stringify({ version: 1, servers }, null, 2))
}

export function normalizeServer(url: string): string {
	return url.replace(/\/+$/, '')
}

/** Secret-bearing fields are never echoed — use in any error/log path. */
export function redactSecret(value: string | undefined): string {
	if (!value) return ''
	if (value.length <= 8) return '[redacted]'
	return `${value.slice(0, 4)}…[redacted]`
}
