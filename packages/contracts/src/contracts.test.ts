import { describe, expect, test } from 'bun:test'
import Value from 'typebox/value'
import {
	CreateIssueBody,
	CreateProjectBody,
	decodeCursor,
	ERROR_CODES,
	ERROR_DOC_BASE,
	encodeCursor,
	ImportDryRunBody,
	MutationEnvelope,
	problem
} from './index'

describe('problem()', () => {
	test('builds RFC 9457 body with stable code and doc URL', () => {
		const p = problem({
			status: 404,
			code: 'not_found',
			title: 'Workspace not found',
			requestId: 'req_1'
		})
		expect(p.type).toBe(`${ERROR_DOC_BASE}not_found`)
		expect(p.status).toBe(404)
		expect(p.code).toBe('not_found')
		expect(p.requestId).toBe('req_1')
		expect('detail' in p).toBe(false) // optional fields omitted, not null
	})

	test('merges extension fields without overwriting the core shape', () => {
		const p = problem(
			{ status: 409, code: 'stale_version', title: 'stale', requestId: 'r' },
			{ currentVersion: 5, yourVersion: 3 }
		)
		expect((p as { currentVersion?: unknown }).currentVersion).toBe(5)
		expect(p.code).toBe('stale_version')
	})
})

describe('error codes', () => {
	test('are unique', () => {
		expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
	})
})

describe('cursors', () => {
	test('round-trip an arbitrary payload', () => {
		const payload = { id: '0190a0b1-9a9a-7000-8000-000000000001', v: 2 }
		expect(decodeCursor<typeof payload>(encodeCursor(payload))).toEqual(payload)
	})

	test('decode returns undefined for empty/garbage input', () => {
		expect(decodeCursor(undefined)).toBeUndefined()
		expect(decodeCursor('not-a-cursor!!!')).toBeUndefined()
	})
})

describe('M1 wire contracts', () => {
	test('CreateProjectBody validates key format', () => {
		expect(Value.Check(CreateProjectBody, { key: 'ENG', name: 'Engineering' })).toBe(true)
		expect(Value.Check(CreateProjectBody, { key: 'bad-key', name: 'Engineering' })).toBe(false)
	})

	test('CreateIssueBody validates priority bounds', () => {
		const projectId = '0190a0b1-9a9a-7000-8000-000000000001'
		expect(Value.Check(CreateIssueBody, { projectId, title: 'Fix bug', priority: 3 })).toBe(true)
		expect(Value.Check(CreateIssueBody, { projectId, title: 'Fix bug', priority: 9 })).toBe(false)
	})

	test('MutationEnvelope validates op and entity enums', () => {
		expect(
			Value.Check(MutationEnvelope, {
				mutationId: '0190a0b1-9a9a-7000-8000-000000000001',
				workspaceId: '0190a0b1-9a9a-7000-8000-000000000002',
				entity: 'issue',
				entityId: '0190a0b1-9a9a-7000-8000-000000000003',
				op: 'update',
				patch: { title: 'New' },
				baseVersion: 1
			})
		).toBe(true)
	})

	test('ImportDryRunBody validates source union', () => {
		expect(Value.Check(ImportDryRunBody, { source: 'linear' })).toBe(true)
		expect(Value.Check(ImportDryRunBody, { source: 'jira' })).toBe(false)
	})
})
