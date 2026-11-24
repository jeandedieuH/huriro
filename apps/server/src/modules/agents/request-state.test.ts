import { describe, expect, test } from 'bun:test'
import { mintRequestState, verifyRequestState } from './request-state'

const SECRET = 's'.repeat(48)
const BASE = { principalId: 'p-1', tool: 'tasks.update', argsHash: 'a'.repeat(64) }

describe('request-state (signed MRTR state, §13.5)', () => {
	test('round-trips a minted state', () => {
		const st = mintRequestState(SECRET, BASE)
		const decoded = verifyRequestState(SECRET, st)
		expect(decoded?.principalId).toBe('p-1')
		expect(decoded?.tool).toBe('tasks.update')
		expect(decoded?.argsHash).toBe(BASE.argsHash)
	})

	test('tampered payload is rejected', () => {
		const st = mintRequestState(SECRET, BASE)
		const [, sig] = st.split('.')
		const evil = Buffer.from(JSON.stringify({ ...BASE, tool: 'tasks.bulk_update' })).toString('base64url')
		expect(verifyRequestState(SECRET, `${evil}.${sig}`)).toBeNull()
	})

	test('tampered signature / wrong secret is rejected', () => {
		const st = mintRequestState(SECRET, BASE)
		const [payload] = st.split('.')
		expect(verifyRequestState(SECRET, `${payload}.${'x'.repeat(43)}`)).toBeNull()
		expect(verifyRequestState('other'.repeat(10), st)).toBeNull()
	})

	test('malformed inputs are rejected', () => {
		expect(verifyRequestState(SECRET, '')).toBeNull()
		expect(verifyRequestState(SECRET, 'nodots')).toBeNull()
		expect(verifyRequestState(SECRET, 'a.b.c')).toBeNull()
		expect(
			verifyRequestState(SECRET, `${Buffer.from('not json').toString('base64url')}.${'x'.repeat(43)}`)
		).toBeNull()
	})

	test('expired state is rejected', () => {
		// Forge a payload stamped 11 minutes ago and sign it with the right
		// secret — only expiry should kill it.
		const payload = Buffer.from(JSON.stringify({ ...BASE, issuedAt: Date.now() - 11 * 60 * 1000 })).toString(
			'base64url'
		)
		const sig = require('node:crypto').createHmac('sha256', SECRET).update(payload).digest('base64url')
		expect(verifyRequestState(SECRET, `${payload}.${sig}`)).toBeNull()
	})
})
