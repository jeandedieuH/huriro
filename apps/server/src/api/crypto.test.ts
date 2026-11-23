import { describe, expect, test } from 'bun:test'
import {
	decryptSecret,
	encryptSecret,
	signWebhookPayload,
	verifyGithubSignature256,
	verifyWebhookSignature
} from './crypto'

describe('envelope crypto & HMAC signatures (§12.7, §16.5, §16.6)', () => {
	test('encryptSecret/decryptSecret binds AAD to tenant/entity', () => {
		const root = 'super-secret-root-key-32-bytes-minimum'
		const aad = 'ws_1:webhook:ep_1'
		const ciphertext = encryptSecret(root, aad, 'whsec_test_123')
		expect(ciphertext).not.toContain('whsec_test_123')
		expect(decryptSecret(root, aad, ciphertext)).toBe('whsec_test_123')
		expect(() => decryptSecret(root, 'ws_2:webhook:ep_1', ciphertext)).toThrow()
	})

	test('signWebhookPayload & verifyWebhookSignature enforce replay window', () => {
		const secret = 'whsec_abc'
		const body = JSON.stringify({ event: 'issue.created' })
		const now = 1_700_000_000
		const sig = signWebhookPayload(secret, now, body)
		expect(verifyWebhookSignature(secret, sig, body, now + 60, 300)).toBe(true)
		expect(verifyWebhookSignature(secret, sig, body, now + 600, 300)).toBe(false)
		expect(verifyWebhookSignature('wrong', sig, body, now, 300)).toBe(false)
	})

	test('verifyGithubSignature256 validates sha256= HMAC', () => {
		const secret = 'gh-secret'
		const body = '{"action":"opened"}'
		const { createHmac } = require('node:crypto') as typeof import('node:crypto')
		const sig = `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`
		expect(verifyGithubSignature256(secret, body, sig)).toBe(true)
		expect(verifyGithubSignature256(secret, `${body} `, sig)).toBe(false)
		expect(verifyGithubSignature256(secret, body, 'sha256=deadbeef')).toBe(false)
	})
})
