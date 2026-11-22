/**
 * Client replica persistence (§6.3, §9.5):
 *   OPFS (primary web) → IndexedDB (fallback) → Memory (insecure-context / test fallback).
 * Implements `@tanstack/offline-transactions` `StorageAdapter` contract.
 */
import type { StorageAdapter } from '@tanstack/offline-transactions'

export type ReplicaStorageMode = 'opfs' | 'idb' | 'memory'

export interface ReplicaStorage extends StorageAdapter {
	readonly mode: ReplicaStorageMode
}

function encodeKey(key: string): string {
	return Array.from(new TextEncoder().encode(key))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
}

function decodeKey(hex: string): string | null {
	if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null
	const bytes = new Uint8Array(hex.length / 2)
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16)
	}
	return new TextDecoder().decode(bytes)
}

export class MemoryReplicaStorage implements ReplicaStorage {
	readonly mode: ReplicaStorageMode = 'memory'
	private readonly store = new Map<string, string>()

	async get(key: string): Promise<string | null> {
		return this.store.get(key) ?? null
	}

	async set(key: string, value: string): Promise<void> {
		this.store.set(key, value)
	}

	async delete(key: string): Promise<void> {
		this.store.delete(key)
	}

	async keys(): Promise<string[]> {
		return [...this.store.keys()]
	}

	async clear(): Promise<void> {
		this.store.clear()
	}
}

export class OpfsReplicaStorage implements ReplicaStorage {
	readonly mode: ReplicaStorageMode = 'opfs'
	private readonly dirName: string

	constructor(workspaceId: string) {
		this.dirName = `huriro-${workspaceId.replace(/[^a-zA-Z0-9_-]/g, '')}`
	}

	private async getDir(): Promise<FileSystemDirectoryHandle> {
		const root = await navigator.storage.getDirectory()
		return root.getDirectoryHandle(this.dirName, { create: true })
	}

	async get(key: string): Promise<string | null> {
		try {
			const dir = await this.getDir()
			const fh = await dir.getFileHandle(encodeKey(key))
			const file = await fh.getFile()
			return await file.text()
		} catch {
			return null
		}
	}

	async set(key: string, value: string): Promise<void> {
		const dir = await this.getDir()
		const fh = await dir.getFileHandle(encodeKey(key), { create: true })
		const writable = await fh.createWritable()
		await writable.write(value)
		await writable.close()
	}

	async delete(key: string): Promise<void> {
		try {
			const dir = await this.getDir()
			await dir.removeEntry(encodeKey(key))
		} catch {
			// Missing entry is already deleted.
		}
	}

	async keys(): Promise<string[]> {
		const dir = await this.getDir()
		const result: string[] = []
		const iter = (dir as unknown as { keys?: () => AsyncIterableIterator<string> }).keys?.()
		if (!iter) return result
		for await (const name of iter) {
			const decoded = decodeKey(name)
			if (decoded !== null) result.push(decoded)
		}
		return result
	}

	async clear(): Promise<void> {
		const root = await navigator.storage.getDirectory()
		await root.removeEntry(this.dirName, { recursive: true }).catch(() => {})
	}
}

export class IndexedDbReplicaStorage implements ReplicaStorage {
	readonly mode: ReplicaStorageMode = 'idb'
	private readonly dbName: string
	private readonly storeName = 'kv'

	constructor(workspaceId: string) {
		this.dbName = `huriro_replica_${workspaceId.replace(/[^a-zA-Z0-9_-]/g, '')}`
	}

	private openDb(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const req = indexedDB.open(this.dbName, 1)
			req.onupgradeneeded = () => {
				const db = req.result
				if (!db.objectStoreNames.contains(this.storeName)) {
					db.createObjectStore(this.storeName)
				}
			}
			req.onsuccess = () => resolve(req.result)
			req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'))
		})
	}

	async get(key: string): Promise<string | null> {
		const db = await this.openDb()
		try {
			return await new Promise<string | null>((resolve, reject) => {
				const tx = db.transaction(this.storeName, 'readonly')
				const req = tx.objectStore(this.storeName).get(key)
				req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null)
				req.onerror = () => reject(req.error ?? new Error('IDB read failed'))
			})
		} finally {
			db.close()
		}
	}

	async set(key: string, value: string): Promise<void> {
		const db = await this.openDb()
		try {
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(this.storeName, 'readwrite')
				tx.objectStore(this.storeName).put(value, key)
				tx.oncomplete = () => resolve()
				tx.onerror = () => reject(tx.error ?? new Error('IDB write failed'))
			})
		} finally {
			db.close()
		}
	}

	async delete(key: string): Promise<void> {
		const db = await this.openDb()
		try {
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(this.storeName, 'readwrite')
				tx.objectStore(this.storeName).delete(key)
				tx.oncomplete = () => resolve()
				tx.onerror = () => reject(tx.error ?? new Error('IDB delete failed'))
			})
		} finally {
			db.close()
		}
	}

	async keys(): Promise<string[]> {
		const db = await this.openDb()
		try {
			return await new Promise<string[]>((resolve, reject) => {
				const tx = db.transaction(this.storeName, 'readonly')
				const req = tx.objectStore(this.storeName).getAllKeys()
				req.onsuccess = () => resolve((req.result ?? []).map((k) => String(k)))
				req.onerror = () => reject(req.error ?? new Error('IDB keys failed'))
			})
		} finally {
			db.close()
		}
	}

	async clear(): Promise<void> {
		const db = await this.openDb()
		try {
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(this.storeName, 'readwrite')
				tx.objectStore(this.storeName).clear()
				tx.oncomplete = () => resolve()
				tx.onerror = () => reject(tx.error ?? new Error('IDB clear failed'))
			})
		} finally {
			db.close()
		}
	}
}

export async function createBestReplicaStorage(workspaceId: string): Promise<ReplicaStorage> {
	if (
		typeof navigator !== 'undefined' &&
		navigator.storage &&
		typeof navigator.storage.getDirectory === 'function'
	) {
		try {
			const opfs = new OpfsReplicaStorage(workspaceId)
			await opfs.set('__probe__', '1')
			await opfs.delete('__probe__')
			return opfs
		} catch {
			// OPFS unavailable (insecure context, private window, or jsdom)
		}
	}

	if (typeof indexedDB !== 'undefined') {
		try {
			const idb = new IndexedDbReplicaStorage(workspaceId)
			await idb.set('__probe__', '1')
			await idb.delete('__probe__')
			return idb
		} catch {
			// IndexedDB unavailable
		}
	}

	return new MemoryReplicaStorage()
}
