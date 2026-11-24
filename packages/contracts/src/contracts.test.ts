import { describe, expect, test } from 'bun:test'
import Value from 'typebox/value'
import {
	CollabTicketResponse,
	CreateCheckoutBody,
	CreateDocCommentBody,
	CreateDocPageBody,
	CreateIssueBody,
	CreateProjectBody,
	decodeCursor,
	ERROR_CODES,
	ERROR_DOC_BASE,
	EraseAccountBody,
	encodeCursor,
	ImportDryRunBody,
	MutationEnvelope,
	problem,
	RegisterMobilePushTokenBody
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
		expect(Value.Check(ImportDryRunBody, { source: 'notion' })).toBe(true)
		expect(Value.Check(ImportDryRunBody, { source: 'markdown' })).toBe(true)
		expect(Value.Check(ImportDryRunBody, { source: 'slack' })).toBe(true)
		expect(Value.Check(ImportDryRunBody, { source: 'jira' })).toBe(true)
		expect(Value.Check(ImportDryRunBody, { source: 'trello' })).toBe(false)
	})
})

describe('M2 docs wire contracts', () => {
	test('CreateDocPageBody validates title and slug pattern', () => {
		expect(Value.Check(CreateDocPageBody, { title: 'Architecture RFC', slug: 'architecture-rfc' })).toBe(true)
		expect(Value.Check(CreateDocPageBody, { title: 'Bad Slug', slug: 'INVALID SLUG' })).toBe(false)
		expect(Value.Check(CreateDocPageBody, { title: '' })).toBe(false)
	})

	test('CreateDocCommentBody requires non-empty bodyText', () => {
		expect(Value.Check(CreateDocCommentBody, { bodyText: 'Looks good @alice', anchorQuote: 'heading' })).toBe(
			true
		)
		expect(Value.Check(CreateDocCommentBody, { bodyText: '' })).toBe(false)
	})

	test('CollabTicketResponse validates permission enum', () => {
		expect(
			Value.Check(CollabTicketResponse, {
				ticket: 'ct_abc',
				documentName: '0190a0b1-0000-7000-8000-000000000001:0190a0b1-0000-7000-8000-000000000002',
				permission: 'write',
				expiresAt: '2026-11-22T12:00:00Z',
				collabUrl: '/collab'
			})
		).toBe(true)
		expect(
			Value.Check(CollabTicketResponse, {
				ticket: 'ct_abc',
				documentName: 'x',
				permission: 'admin',
				expiresAt: '2026-11-22T12:00:00Z',
				collabUrl: '/collab'
			})
		).toBe(false)
	})

	test('MutationEnvelope supports doc_page', () => {
		expect(
			Value.Check(MutationEnvelope, {
				mutationId: '0190a0b1-9a9a-7000-8000-000000000001',
				workspaceId: '0190a0b1-9a9a-7000-8000-000000000002',
				entity: 'doc_page',
				entityId: '0190a0b1-9a9a-7000-8000-000000000003',
				op: 'create',
				patch: { title: 'Offline Doc' }
			})
		).toBe(true)
	})
})

describe('M6 mobile, billing & governance contracts', () => {
	test('RegisterMobilePushTokenBody validates platform and non-empty token', () => {
		expect(
			Value.Check(RegisterMobilePushTokenBody, {
				token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
				platform: 'expo',
				deviceId: 'iphone-15-pro',
				deviceName: 'Test Phone'
			})
		).toBe(true)
		expect(
			Value.Check(RegisterMobilePushTokenBody, {
				token: 'short',
				platform: 'windows',
				deviceId: 'x'
			})
		).toBe(false)
	})

	test('CreateCheckoutBody accepts Polar international and IremboPay Rwanda Mobile Money checkout', () => {
		expect(
			Value.Check(CreateCheckoutBody, {
				plan: 'pro',
				provider: 'polar',
				successUrl: 'https://app.huriro.dev/settings?billing=ok',
				cancelUrl: 'https://app.huriro.dev/settings?billing=cancel'
			})
		).toBe(true)
		expect(
			Value.Check(CreateCheckoutBody, {
				plan: 'pro',
				provider: 'irembopay',
				paymentMethod: 'mtn_momo',
				phoneNumber: '0788123456',
				billingEmail: 'founder@huriro.rw',
				successUrl: 'https://app.huriro.dev/settings?billing=ok',
				cancelUrl: 'https://app.huriro.dev/settings?billing=cancel'
			})
		).toBe(true)
		expect(
			Value.Check(CreateCheckoutBody, {
				plan: 'enterprise',
				provider: 'polar',
				successUrl: 'https://app.huriro.dev/settings',
				cancelUrl: 'https://app.huriro.dev/settings'
			})
		).toBe(false)
	})

	test('EraseAccountBody requires email-length confirmation string', () => {
		expect(Value.Check(EraseAccountBody, { confirmEmail: 'user@example.com' })).toBe(true)
		expect(Value.Check(EraseAccountBody, { confirmEmail: 'no' })).toBe(false)
	})
})
