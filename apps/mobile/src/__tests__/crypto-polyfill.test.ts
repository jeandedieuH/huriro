import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { randomUUID as nodeRandomUUID } from 'node:crypto'
import { generateUuidV7, type SqliteDatabaseLike } from '@huriro/sync-client'
import { installMobileCryptoPolyfill, type MobileCryptoGlobalTarget } from '../lib/crypto-polyfill'
import { bootstrapMobileRuntime, MOBILE_PREVIEW_PROJ_ID } from '../lib/workspace-bootstrap'

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function createInMemorySqliteAdapter(): SqliteDatabaseLike {
	const db = new Database(':memory:')
	return {
		async execAsync(source) {
			db.run(source)
		},
		async getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null> {
			const row = db.query(source).get(...(params as [string | number | bigint | boolean | null]))
			return (row as T | null) ?? null
		},
		async getAllAsync<T>(source: string, ...params: unknown[]): Promise<T[]> {
			return db.query(source).all(...(params as [string | number | bigint | boolean | null])) as T[]
		},
		async runAsync(source: string, ...params: unknown[]): Promise<unknown> {
			return db.query(source).run(...(params as [string | number | bigint | boolean | null]))
		}
	}
}

function restoreGlobalDescriptor(key: string, desc: PropertyDescriptor | undefined): void {
	if (desc) {
		Object.defineProperty(globalThis, key, desc)
	} else {
		delete (globalThis as Record<string, unknown>)[key]
	}
}

describe('mobile WebCrypto polyfill', () => {
	test('installs getRandomValues and randomUUID on Hermes-like target using expo.uuidv4', () => {
		const uuids = ['00112233-4455-4eff-8fdd-66778899aabb', '10213243-5465-4ccc-9ddd-768798a9bacb']
		let calls = 0
		const target: MobileCryptoGlobalTarget = {
			expo: {
				uuidv4: () => {
					const next = uuids[calls % uuids.length] ?? '00000000-0000-4000-8000-000000000000'
					calls += 1
					return next
				}
			}
		}

		installMobileCryptoPolyfill(target)
		expect(typeof target.crypto?.getRandomValues).toBe('function')
		expect(typeof target.crypto?.randomUUID).toBe('function')

		const buf = new Uint8Array(16)
		const returned = target.crypto?.getRandomValues?.(buf)
		expect(returned).toBe(buf)
		// Byte 6 (4e) and byte 8 (8f) of the first UUID are fixed version/variant bits and must be skipped.
		expect(Array.from(buf)).toEqual([
			0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0xff, 0xdd, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0x10, 0x21
		])

		// @tanstack/db calls getRandomValues with Uint32Array(4).
		const u32 = new Uint32Array(4)
		target.crypto?.getRandomValues?.(u32)
		expect(Array.from(u32).every((n) => n !== 0)).toBe(true)

		// Views with non-zero byteOffset must only mutate the view's slice.
		const backing = new Uint8Array(16).fill(0xaa)
		const sub = new Uint8Array(backing.buffer, 4, 8)
		target.crypto?.getRandomValues?.(sub)
		expect(Array.from(backing.slice(0, 4))).toEqual([0xaa, 0xaa, 0xaa, 0xaa])
		expect(Array.from(backing.slice(12, 16))).toEqual([0xaa, 0xaa, 0xaa, 0xaa])
		expect(Array.from(sub)).not.toEqual([0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa])

		// Zero-length typed arrays succeed without calling native uuidv4.
		const callsBeforeEmpty = calls
		const empty = new Uint8Array(0)
		expect(target.crypto?.getRandomValues?.(empty)).toBe(empty)
		expect(calls).toBe(callsBeforeEmpty)

		// Unsupported views throw TypeError.
		expect(() => target.crypto?.getRandomValues?.(new Float32Array(4))).toThrow(TypeError)
		expect(() => target.crypto?.getRandomValues?.(new DataView(new ArrayBuffer(8)))).toThrow(TypeError)

		// Buffers over 65,536 bytes throw QuotaExceededError.
		let oversizedError: unknown = null
		try {
			target.crypto?.getRandomValues?.(new Uint8Array(65_537))
		} catch (err) {
			oversizedError = err
		}
		expect(oversizedError).toBeInstanceOf(Error)
		expect((oversizedError as { name?: string }).name).toBe('QuotaExceededError')

		// randomUUID lowercases expo.uuidv4 output.
		const upperTarget: MobileCryptoGlobalTarget = {
			expo: { uuidv4: () => 'AABBCCDD-EEFF-4123-9456-7890ABCDEF12' }
		}
		installMobileCryptoPolyfill(upperTarget)
		expect(upperTarget.crypto?.randomUUID?.()).toBe('aabbccdd-eeff-4123-9456-7890abcdef12')
	})

	test('fills missing randomUUID on partial crypto using existing getRandomValues', () => {
		let seed = 1
		const existingGetRandomValues = <T extends ArrayBufferView>(array: T): T => {
			const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
			for (let i = 0; i < view.length; i += 1) {
				seed = (seed * 33 + i + 7) & 0xff
				view[i] = seed
			}
			return array
		}
		const target: MobileCryptoGlobalTarget = {
			crypto: {
				getRandomValues: existingGetRandomValues
			}
		}

		installMobileCryptoPolyfill(target)
		expect(target.crypto?.getRandomValues).toBe(existingGetRandomValues)
		const uuid = target.crypto?.randomUUID?.() ?? ''
		expect(uuid).toMatch(UUID_V4_RE)
	})

	test('is idempotent when getRandomValues and randomUUID already exist', () => {
		const originalGetRandomValues = <T extends ArrayBufferView>(array: T): T => array
		const originalRandomUUID = () => '00000000-0000-4000-8000-000000000000' as const
		const target: MobileCryptoGlobalTarget = {
			crypto: {
				getRandomValues: originalGetRandomValues,
				randomUUID: originalRandomUUID
			}
		}

		installMobileCryptoPolyfill(target)
		expect(target.crypto?.getRandomValues).toBe(originalGetRandomValues)
		expect(target.crypto?.randomUUID).toBe(originalRandomUUID)
	})

	test('throws descriptive error when neither native crypto nor expo.uuidv4 is available', () => {
		const target: MobileCryptoGlobalTarget = {}
		installMobileCryptoPolyfill(target)

		expect(() => target.crypto?.getRandomValues?.(new Uint8Array(16))).toThrow(/expo\.uuidv4/)
		expect(() => target.crypto?.randomUUID?.()).toThrow(/expo\.uuidv4/)
	})

	test('supports generateUuidV7 and bootstrapMobileRuntime when globalThis.crypto starts undefined', async () => {
		const origCryptoDesc = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
		const origExpoDesc = Object.getOwnPropertyDescriptor(globalThis, 'expo')

		try {
			Object.defineProperty(globalThis, 'crypto', {
				value: undefined,
				configurable: true,
				writable: true
			})
			Object.defineProperty(globalThis, 'expo', {
				value: { uuidv4: () => nodeRandomUUID() },
				configurable: true,
				writable: true
			})

			installMobileCryptoPolyfill()

			const id = generateUuidV7()
			expect(id).toMatch(UUID_V7_RE)

			const rt = await bootstrapMobileRuntime({
				preview: true,
				sqliteDb: createInMemorySqliteAdapter()
			})
			try {
				rt.engine.setOnline(false)
				const issue = await rt.engine.createIssue({
					projectId: MOBILE_PREVIEW_PROJ_ID,
					title: 'Polyfilled crypto offline issue'
				})
				expect(issue.id).toMatch(UUID_V7_RE)
				expect(rt.engine.getStatus().pendingCount).toBe(1)
			} finally {
				rt.dispose()
			}
		} finally {
			restoreGlobalDescriptor('crypto', origCryptoDesc)
			restoreGlobalDescriptor('expo', origExpoDesc)
		}
	})
})
