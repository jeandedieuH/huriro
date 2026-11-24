import { describe, expect, it } from 'bun:test'
import { scrubSecrets } from '../../api/observability'
import { generateApiKey, hashApiKey, isApiKeyValue, verifyApiKeyHash } from './api-keys'

describe('api key format', () => {
	it('generates hrk_<8>_<43> and round-trips verify', () => {
		const { full, prefix, secretHash } = generateApiKey()
		expect(isApiKeyValue(full)).toBe(true)
		expect(full.startsWith(`hrk_${prefix}_`)).toBe(true)
		expect(prefix).toHaveLength(8)
		expect(verifyApiKeyHash(full, secretHash)).toBe(true)
	})
	it('rejects wrong secrets and malformed keys', () => {
		const { full, secretHash } = generateApiKey()
		const { full: other } = generateApiKey()
		expect(verifyApiKeyHash(other, secretHash)).toBe(false)
		expect(isApiKeyValue('hrk_short_x')).toBe(false)
		expect(verifyApiKeyHash('hrk_short_x', secretHash)).toBe(false)
		expect(hashApiKey(full)).toBe(secretHash)
	})
})

describe('log scrubbing', () => {
	it('redacts hrk_ keys in message strings', () => {
		const k = `hrk_${'a'.repeat(8)}_${'b'.repeat(43)}`
		expect(scrubSecrets(`failed for key ${k} on ws`)).toBe('failed for key [redacted] on ws')
	})
	it('leaves ordinary text alone', () => {
		expect(scrubSecrets('normal message')).toBe('normal message')
	})
})
