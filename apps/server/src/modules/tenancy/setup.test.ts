import { describe, expect, test } from 'bun:test'
import type { Sql } from '@huriro/db'
import type { Auth } from '../identity'
import {
	completeSetup,
	ensureBootstrapSetupToken,
	hashSetupToken,
	rotateBootstrapSetupToken,
	SetupError
} from './setup'

interface MockDbState {
	setupCompleted: boolean
	bootstrapTokenHash: unknown
	existingUsers: Record<string, string>
	advisoryLocks: number
	workspaces: { id: string; slug: string; name: string }[]
}

function createMockSql(initial?: Partial<MockDbState>): { sql: Sql; state: MockDbState } {
	const state: MockDbState = {
		setupCompleted: initial?.setupCompleted ?? false,
		bootstrapTokenHash: initial?.bootstrapTokenHash,
		existingUsers: initial?.existingUsers ?? {},
		advisoryLocks: 0,
		workspaces: []
	}

	const txFn = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
		const query = strings.join(' ? ').replace(/\s+/g, ' ').trim()
		if (query.startsWith('SELECT pg_advisory_xact_lock')) {
			state.advisoryLocks += 1
			return []
		}
		if (query.startsWith('SELECT set_config')) {
			return []
		}
		if (query.startsWith('SELECT value FROM instance_settings')) {
			if (values[0] === 'setup_completed' && state.setupCompleted) {
				return [{ value: true }]
			}
			return []
		}
		if (query.startsWith('SELECT value FROM huriro_bootstrap')) {
			return state.bootstrapTokenHash !== undefined ? [{ value: state.bootstrapTokenHash }] : []
		}
		if (query.startsWith('INSERT INTO huriro_bootstrap')) {
			state.bootstrapTokenHash = String(values[1])
			return []
		}
		if (query.startsWith('UPDATE huriro_bootstrap')) {
			state.bootstrapTokenHash = 'consumed'
			return []
		}
		if (query.startsWith('INSERT INTO instance_settings')) {
			if (values[0] === 'setup_completed') {
				state.setupCompleted = values[1] === true
			}
			return []
		}
		if (query.startsWith('SELECT id FROM users WHERE email =')) {
			const id = state.existingUsers[String(values[0])]
			return id ? [{ id }] : []
		}
		if (query.startsWith('INSERT INTO users')) {
			return [{ id: 'inserted-user-id' }]
		}
		if (query.startsWith('INSERT INTO workspaces')) {
			const row = { id: String(values[0]), slug: String(values[1]), name: String(values[2]) }
			state.workspaces.push(row)
			return [row]
		}
		if (query.startsWith('INSERT INTO roles')) {
			return [{ id: crypto.randomUUID() }]
		}
		return []
	}

	const tx = Object.assign(txFn, {
		json: (value: unknown) => value
	})

	const sql = Object.assign(txFn, {
		begin: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx)
	}) as unknown as Sql

	return { sql, state }
}

describe('tenancy setup & bootstrap tokens', () => {
	test('ensureBootstrapSetupToken returns configured without touching huriro_bootstrap', async () => {
		const { sql, state } = createMockSql({ setupCompleted: true })
		const res = await ensureBootstrapSetupToken(sql)
		expect(res).toEqual({ status: 'configured' })
		expect(state.bootstrapTokenHash).toBeUndefined()
		expect(state.advisoryLocks).toBe(1)
	})

	test('ensureBootstrapSetupToken preserves an existing non-empty token hash', async () => {
		const { sql, state } = createMockSql({
			setupCompleted: false,
			bootstrapTokenHash: 'existing-hash-value'
		})
		const res = await ensureBootstrapSetupToken(sql)
		expect(res).toEqual({ status: 'existing' })
		expect(state.bootstrapTokenHash).toBe('existing-hash-value')
	})

	test('ensureBootstrapSetupToken generates and stores hash when missing or empty', async () => {
		for (const initialHash of [undefined, '']) {
			const { sql, state } = createMockSql({
				setupCompleted: false,
				bootstrapTokenHash: initialHash
			})
			const res = await ensureBootstrapSetupToken(sql)
			expect(res.status).toBe('generated')
			if (res.status === 'generated') {
				expect(res.token.length).toBeGreaterThanOrEqual(32)
				expect(state.bootstrapTokenHash).toBe(hashSetupToken(res.token))
			}
		}
	})

	test('rotateBootstrapSetupToken rejects when already configured and rotates when pending', async () => {
		const done = createMockSql({ setupCompleted: true })
		await expect(rotateBootstrapSetupToken(done.sql)).rejects.toMatchObject({
			name: 'SetupError',
			code: 'already_configured'
		})

		const pending = createMockSql({
			setupCompleted: false,
			bootstrapTokenHash: 'old-hash'
		})
		const rotated = await rotateBootstrapSetupToken(pending.sql)
		expect(rotated.token.length).toBeGreaterThanOrEqual(32)
		expect(pending.state.bootstrapTokenHash).toBe(hashSetupToken(rotated.token))
		expect(pending.state.bootstrapTokenHash).not.toBe('old-hash')
	})

	test('completeSetup verifies password via signInEmail when reusing an existing user', async () => {
		const rawToken = 't'.repeat(43)
		const { sql, state } = createMockSql({
			setupCompleted: false,
			bootstrapTokenHash: hashSetupToken(rawToken),
			existingUsers: { 'ada@huriro.dev': 'db-user-unverified' }
		})

		let signInCalls = 0
		const auth = {
			api: {
				signUpEmail: async () => {
					throw new Error('User already exists')
				},
				signInEmail: async () => {
					signInCalls += 1
					return { user: { id: 'auth-verified-user-1' } }
				}
			}
		} as unknown as Auth

		const res = await completeSetup(sql, auth, {
			token: rawToken,
			workspaceName: 'Acme',
			slug: 'acme',
			email: 'Ada@huriro.dev',
			displayName: 'Ada Lovelace',
			password: 'CorrectPassword99!'
		})

		expect(signInCalls).toBe(1)
		expect(res.userId).toBe('auth-verified-user-1')
		expect(state.setupCompleted).toBe(true)
		expect(state.bootstrapTokenHash).toBe('consumed')
	})

	test('completeSetup rejects wrong password for existing user without consuming setup token', async () => {
		const rawToken = 't'.repeat(43)
		const expectedHash = hashSetupToken(rawToken)
		const { sql, state } = createMockSql({
			setupCompleted: false,
			bootstrapTokenHash: expectedHash,
			existingUsers: { 'ada@huriro.dev': 'db-user-unverified' }
		})

		const auth = {
			api: {
				signUpEmail: async () => {
					throw new Error('User already exists')
				},
				signInEmail: async () => {
					throw new Error('Invalid email or password')
				}
			}
		} as unknown as Auth

		let caught: unknown = null
		try {
			await completeSetup(sql, auth, {
				token: rawToken,
				workspaceName: 'Acme',
				slug: 'acme',
				email: 'ada@huriro.dev',
				displayName: 'Ada Lovelace',
				password: 'WrongPassword99!'
			})
		} catch (err) {
			caught = err
		}

		expect(caught).toBeInstanceOf(SetupError)
		expect((caught as SetupError).code).toBe('auth_failed')
		expect(state.setupCompleted).toBe(false)
		expect(state.bootstrapTokenHash).toBe(expectedHash)
	})
})
