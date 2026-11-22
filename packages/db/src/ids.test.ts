import { describe, expect, test } from 'bun:test'
import { isAcceptableClientId, isUuid, isUuidV7, listMigrationFiles, uuid7TimestampMs } from './index'

const V7 = '0190a0b1-9a9a-7f00-8000-000000000001'
const V4 = '0190a0b1-9a9a-4f00-8000-000000000001'

describe('uuid helpers', () => {
	test('isUuidV7 accepts only version-7 uuids', () => {
		expect(isUuidV7(V7)).toBe(true)
		expect(isUuidV7(V4)).toBe(false) // version nibble must be 7
		expect(isUuidV7('not-a-uuid')).toBe(false)
	})

	test('isUuid accepts any version', () => {
		expect(isUuid(V7)).toBe(true)
		expect(isUuid(V4)).toBe(true)
		expect(isUuid('zzzz')).toBe(false)
	})

	test('uuid7TimestampMs decodes the first 48 bits', () => {
		// 0x0190a0b19a9a — matches the literal prefix in the fixture id
		expect(uuid7TimestampMs(V7)).toBe(0x0190a0b19a9a)
		expect(uuid7TimestampMs(V4)).toBeNull()
	})

	test('client ids are accepted within the ±24 h skew window only', () => {
		const ref = Date.now()
		const goodTs = ref.toString(16).padStart(12, '0')
		const good = `${goodTs.slice(0, 8)}-${goodTs.slice(8)}-7f00-8000-000000000001`
		expect(isAcceptableClientId(good, ref)).toBe(true)

		const oldTs = (ref - 48 * 60 * 60 * 1000).toString(16).padStart(12, '0')
		const old = `${oldTs.slice(0, 8)}-${oldTs.slice(8)}-7f00-8000-000000000001`
		expect(isAcceptableClientId(old, ref)).toBe(false)
		expect(isAcceptableClientId('garbage', ref)).toBe(false)
	})
})

describe('listMigrationFiles', () => {
	const migrationsDir = `${import.meta.dir}/../migrations`

	test('returns ordered NNNN_name.sql entries', () => {
		const files = listMigrationFiles(migrationsDir)
		expect(files.length).toBeGreaterThanOrEqual(4)
		expect(files.map((f) => f.version)).toEqual([1, 2, 3, 4, 5])
		expect(files[0]?.name).toBe('0001_foundation.sql')
	})
})
