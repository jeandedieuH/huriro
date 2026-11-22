import { describe, expect, test } from 'bun:test'
import { describeEnvSchemas, renderEnvExample } from '../index'
import { createServerEnv, serverSchemas } from './index'

const REQUIRED_SOURCE = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' }

describe('createServerEnv', () => {
	test('applies schema defaults', () => {
		const env = createServerEnv(REQUIRED_SOURCE)
		expect(env.PORT).toBe(3001)
		expect(env.WS_PORT).toBe(3005)
		expect(env.HURIRO_ENV).toBe('development')
		expect(env.HURIRO_MODE).toBe('selfhost')
		expect(env.BLOB_STORE).toBe('fs')
	})

	test('treats empty strings as unset', () => {
		const env = createServerEnv({ ...REQUIRED_SOURCE, HURIRO_DOMAIN: '', PORT: '' })
		expect(env.HURIRO_DOMAIN).toBeUndefined()
		expect(env.PORT).toBe(3001)
	})

	test('rejects invalid enum values and non-numeric ports', () => {
		expect(() => createServerEnv({ ...REQUIRED_SOURCE, HURIRO_ENV: 'staging' })).toThrow()
		expect(() => createServerEnv({ ...REQUIRED_SOURCE, PORT: 'abc' })).toThrow()
		expect(() => createServerEnv({ ...REQUIRED_SOURCE, PORT: '70000' })).toThrow()
	})

	test('rejects malformed URLs and short secrets', () => {
		expect(() => createServerEnv({ DATABASE_URL: 'not a url' })).toThrow()
		expect(() => createServerEnv({ ...REQUIRED_SOURCE, HURIRO_SECRET_KEY: 'too-short' })).toThrow()
	})

	test('SKIP_ENV_VALIDATION bypasses the schema', () => {
		const env = createServerEnv({ SKIP_ENV_VALIDATION: '1', HURIRO_ENV: 'staging' })
		expect(env).toMatchObject({ HURIRO_ENV: 'staging' })
	})

	test('OAuth provider vars are optional and empty strings collapse to undefined', () => {
		const env = createServerEnv({
			...REQUIRED_SOURCE,
			GOOGLE_CLIENT_ID: 'google-id',
			GOOGLE_CLIENT_SECRET: '',
			GITHUB_CLIENT_ID: '',
			APPLE_CLIENT_ID: 'apple-id'
		})
		expect(env.GOOGLE_CLIENT_ID).toBe('google-id')
		expect(env.GOOGLE_CLIENT_SECRET).toBeUndefined()
		expect(env.GITHUB_CLIENT_ID).toBeUndefined()
		expect(env.APPLE_CLIENT_ID).toBe('apple-id')
	})
})

describe('describeEnvSchemas', () => {
	test('reads .describe() metadata and defaults through wrappers', () => {
		const docs = describeEnvSchemas(serverSchemas)
		const url = docs.find((d) => d.key === 'HURIRO_URL')
		expect(url?.description).toContain('Public base URL')
		expect(url?.defaultValue).toBe('http://localhost:3000')
		expect(url?.required).toBe(false)

		const port = docs.find((d) => d.key === 'PORT')
		expect(port?.defaultValue).toBe('3001')
	})

	test('optional vars render no default', () => {
		const docs = describeEnvSchemas(serverSchemas)
		const domain = docs.find((d) => d.key === 'HURIRO_DOMAIN')
		expect(domain?.defaultValue).toBeUndefined()
		expect(domain?.required).toBe(false)
	})
})

describe('renderEnvExample', () => {
	test('emits comment + key lines in schema order', () => {
		const out = renderEnvExample({
			schemas: serverSchemas,
			generatedBy: '`huriro genenv`',
			source: 'packages/env/server'
		})
		expect(out).toContain('# Public base URL, e.g. https://app.example.com\nHURIRO_URL=http://localhost:3000')
		expect(out).toContain('HURIRO_DOMAIN=\n')
		expect(out).toContain('# Google OAuth client ID')
		expect(out).toContain('GOOGLE_CLIENT_ID=\n')
		expect(out).toContain('GITHUB_CLIENT_ID=\n')
		expect(out).toContain('APPLE_CLIENT_ID=\n')
	})
})
