import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

export interface BlobStorage {
	putQuarantine(key: string, data: Uint8Array): Promise<void>
	readQuarantine(key: string): Promise<Uint8Array>
	promoteToFiles(quarantineKey: string, storageKey: string, processedBytes: Uint8Array): Promise<void>
	readFile(storageKey: string): Promise<Uint8Array>
	deleteObject(key: string): Promise<void>
}

/**
 * Missing-object contract: every implementation rejects reads of absent keys
 * with an error carrying a `code` — 'ENOENT' (fs/memory, mirroring Node) or
 * 'NoSuchKey' (future S3 backend). This is the single detection point so the
 * scan pipeline can treat a definitively-absent object as terminal instead of
 * retrying it forever (unlike transient I/O errors, which must still retry).
 */
export function isMissingBlobError(err: unknown): boolean {
	const code = (err as { readonly code?: unknown } | null | undefined)?.code
	return code === 'ENOENT' || code === 'NoSuchKey'
}

function blobNotFoundError(kind: string, key: string): Error {
	const err = new Error(`${kind} object "${key}" not found`) as Error & { code: string }
	err.code = 'ENOENT'
	return err
}

function assertSafeKey(key: string): string {
	const cleaned = key.replace(/\\/g, '/')
	if (!cleaned || cleaned.startsWith('/') || cleaned.includes('..')) {
		throw new Error(`Unsafe blob storage key "${key}"`)
	}
	return cleaned
}

export class FilesystemBlobStorage implements BlobStorage {
	private readonly rootDir: string

	constructor(rootDir: string) {
		this.rootDir = resolve(rootDir)
	}

	private resolvePath(key: string): string {
		const safe = assertSafeKey(key)
		const full = resolve(this.rootDir, safe)
		if (!full.startsWith(this.rootDir + sep)) {
			throw new Error(`Path traversal rejected for key "${key}"`)
		}
		return full
	}

	async putQuarantine(key: string, data: Uint8Array): Promise<void> {
		const path = this.resolvePath(key)
		await mkdir(dirname(path), { recursive: true })
		await writeFile(path, data)
	}

	async readQuarantine(key: string): Promise<Uint8Array> {
		const path = this.resolvePath(key)
		return new Uint8Array(await readFile(path))
	}

	async promoteToFiles(quarantineKey: string, storageKey: string, processedBytes: Uint8Array): Promise<void> {
		const dest = this.resolvePath(storageKey)
		await mkdir(dirname(dest), { recursive: true })
		await writeFile(dest, processedBytes)
		const src = this.resolvePath(quarantineKey)
		await rm(src, { force: true }).catch(() => {})
	}

	async readFile(storageKey: string): Promise<Uint8Array> {
		const path = this.resolvePath(storageKey)
		return new Uint8Array(await readFile(path))
	}

	async deleteObject(key: string): Promise<void> {
		const path = this.resolvePath(key)
		await rm(path, { force: true })
	}
}

export class MemoryBlobStorage implements BlobStorage {
	private readonly objects = new Map<string, Uint8Array>()

	async putQuarantine(key: string, data: Uint8Array): Promise<void> {
		this.objects.set(assertSafeKey(key), new Uint8Array(data))
	}

	async readQuarantine(key: string): Promise<Uint8Array> {
		const buf = this.objects.get(assertSafeKey(key))
		if (!buf) throw blobNotFoundError('Quarantine', key)
		return new Uint8Array(buf)
	}

	async promoteToFiles(quarantineKey: string, storageKey: string, processedBytes: Uint8Array): Promise<void> {
		this.objects.set(assertSafeKey(storageKey), new Uint8Array(processedBytes))
		this.objects.delete(assertSafeKey(quarantineKey))
	}

	async readFile(storageKey: string): Promise<Uint8Array> {
		const buf = this.objects.get(assertSafeKey(storageKey))
		if (!buf) throw blobNotFoundError('File', storageKey)
		return new Uint8Array(buf)
	}

	async deleteObject(key: string): Promise<void> {
		this.objects.delete(assertSafeKey(key))
	}
}
