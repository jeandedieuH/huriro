import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

export interface BlobStorage {
	putQuarantine(key: string, data: Uint8Array): Promise<void>
	readQuarantine(key: string): Promise<Uint8Array>
	promoteToFiles(quarantineKey: string, storageKey: string, processedBytes: Uint8Array): Promise<void>
	readFile(storageKey: string): Promise<Uint8Array>
	deleteObject(key: string): Promise<void>
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
		if (!buf) throw new Error(`Quarantine object "${key}" not found`)
		return new Uint8Array(buf)
	}

	async promoteToFiles(quarantineKey: string, storageKey: string, processedBytes: Uint8Array): Promise<void> {
		this.objects.set(assertSafeKey(storageKey), new Uint8Array(processedBytes))
		this.objects.delete(assertSafeKey(quarantineKey))
	}

	async readFile(storageKey: string): Promise<Uint8Array> {
		const buf = this.objects.get(assertSafeKey(storageKey))
		if (!buf) throw new Error(`File object "${storageKey}" not found`)
		return new Uint8Array(buf)
	}

	async deleteObject(key: string): Promise<void> {
		this.objects.delete(assertSafeKey(key))
	}
}
