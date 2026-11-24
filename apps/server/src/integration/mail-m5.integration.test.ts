/**
 * Real PostgreSQL 18 + FORCE RLS integration suite for Milestone M5 (Gate G5):
 *  1. G5 end-to-end: inbound webhook MIME → parse/thread → assign → teammate
 *     reply via due-draft sweep → convert to issue, with notification fan-out
 *  2. Undo-send: queued draft is not sent inside the window; undo restores it
 *  3. Dedupe: same Message-Id delivered twice → one conversation, one message
 *  4. Quarantine: unparseable MIME lands as a visible conversation, not a drop
 *  5. Deny paths: outsider/suspended/guest 403, cross-tenant 404, bad token 404
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { withWorkspace } from '@huriro/db'
import type { TestDb } from '@huriro/test-utils'
import type { MailModuleConfig, OutboundMail } from '../modules/mail'
import { sendDueDraft } from '../modules/mail'
import { drainOutboxOnce as drainOutboxBatch } from '../worker'
import { apiRequest, createIntegrationServer, getTestDb, seedM1Fixture } from './test-harness'

async function drainOutboxOnce(...args: Parameters<typeof drainOutboxBatch>): Promise<number> {
	let total = 0
	while (true) {
		const drained = await drainOutboxBatch(...args)
		total += drained
		if (drained === 0) break
	}
	return total
}

let db: TestDb | null = null

beforeAll(async () => {
	db = await getTestDb()
})

const CUSTOMER_MIME = [
	'From: Customer Jane <jane@customer.example>',
	'To: Support <support@test.huriro.dev>',
	'Subject: Login broken on mobile',
	'Message-Id: <cust-001@customer.example>',
	'Date: Tue, 01 Apr 2025 10:00:00 +0000',
	'MIME-Version: 1.0',
	'Content-Type: text/plain; charset="utf-8"',
	'',
	'When I tap sign in on my phone the app hangs forever.'
].join('\r\n')

const CUSTOMER_REPLY_MIME = [
	'From: Customer Jane <jane@customer.example>',
	'To: Support <support@test.huriro.dev>',
	'Subject: Re: Login broken on mobile',
	'Message-Id: <cust-002@customer.example>',
	'In-Reply-To: <cust-001@customer.example>',
	'References: <cust-001@customer.example>',
	'MIME-Version: 1.0',
	'Content-Type: text/html; charset="utf-8"',
	'',
	'<p>Still broken after update<script>alert(1)</script></p>'
].join('\r\n')

const mailCfg: MailModuleConfig = {
	rootSecret: 'huriro-integration-test-root-secret-32chars',
	maxMessageBytes: 52_428_800,
	undoSendSeconds: 10,
	publicBaseUrl: 'http://localhost'
}

function extractInboundToken(inboundUrl: unknown): string {
	const token = /\/inbound\/(.+)$/.exec(String(inboundUrl))?.[1]
	if (!token) throw new Error('inbound URL missing opaque token')
	return token
}

async function postRawMime(
	app: ReturnType<typeof createIntegrationServer>['app'],
	path: string,
	raw: string
): Promise<Response> {
	return app.handle(
		new Request(`http://localhost${path}`, {
			method: 'POST',
			headers: { 'content-type': 'message/rfc822', 'x-huriro-client': 'huriro-test' },
			body: raw
		})
	)
}

describe('M5 shared inbox (PostgreSQL 18)', () => {
	test('1. G5: inbound → assign → teammate reply → convert to issue end to end', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub, blobStorage, rootSecret } = createIntegrationServer(db, {
			mail: { publicBaseUrl: 'http://localhost' }
		})
		const drain = () =>
			drainOutboxOnce(db!.app, pubsub, {
				blobStorage,
				rootSecret,
				mail: {},
				onlyWorkspaceId: fixture.workspaceId
			})

		// --- account + identity (member administers the shared inbox) ---
		const acctRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/mail/accounts',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { provider: 'inbound_parse', address: 'support@test.huriro.dev', displayName: 'Support' }
		})
		expect(acctRes.status).toBe(201)
		const accountId = String(acctRes.json['id'])
		const inboundUrl = String(acctRes.json['inboundUrl'])
		const token = /\/inbound\/(.+)$/.exec(inboundUrl)?.[1]
		expect(token).toBeTruthy()

		const idRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/mail/identities',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { accountId, address: 'support@test.huriro.dev', displayName: 'Support', isDefault: true }
		})
		expect(idRes.status).toBe(201)
		const identityId = String(idRes.json['id'])

		// --- a real customer email arrives over the token-authed webhook ---
		const inbound = await postRawMime(app, `/api/v1/mail/inbound/${token}`, CUSTOMER_MIME)
		expect(inbound.status).toBe(200)
		await drain()

		const convList = await apiRequest(app, {
			path: '/api/v1/mail/conversations',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		expect(convList.status).toBe(200)
		const conv = (convList.json['data'] as Record<string, unknown>[])[0]!
		expect(conv['subject']).toBe('Login broken on mobile')
		expect(conv['customerEmail']).toBe('jane@customer.example')
		const convId = String(conv['id'])

		// --- customer replies; threading attaches to the same conversation ---
		const replyInbound = await postRawMime(app, `/api/v1/mail/inbound/${token}`, CUSTOMER_REPLY_MIME)
		expect(replyInbound.status).toBe(200)
		await drain()

		const timeline = await apiRequest(app, {
			path: `/api/v1/mail/conversations/${convId}/timeline`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		expect(timeline.status).toBe(200)
		const messages = timeline.json['messages'] as Record<string, unknown>[]
		expect(messages.length).toBe(2)
		// Sanitizer ran at ingest: script is gone, html kept (§14.6).
		const htmlMsg = messages.find((m) => m['bodyHtml'] !== null)!
		expect(String(htmlMsg['bodyHtml'])).not.toContain('<script')

		// --- assign to teammate B; assignment notification fans out ---
		const assign = await apiRequest(app, {
			method: 'PATCH',
			path: `/api/v1/mail/conversations/${convId}`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { assigneeId: fixture.memberBId }
		})
		expect(assign.status).toBe(200)
		await drain()

		const notifs = await apiRequest(app, {
			path: '/api/v1/notifications',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId
		})
		const kinds = ((notifs.json['data'] ?? []) as { kind: string }[]).map((n) => n.kind)
		expect(kinds).toContain('mail.assigned')

		// --- teammate B answers from the shared identity (undo window 0) ---
		const draft = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/mail/conversations/${convId}/drafts`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId,
			body: {
				identityId,
				inReplyToId: messages[0]!['id'],
				recipients: { to: [{ email: 'jane@customer.example', name: 'Customer Jane' }] },
				bodyText: 'Sorry about that — fix ships today.'
			}
		})
		expect(draft.status).toBe(201)
		const draftId = String(draft.json['id'])

		const send = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/mail/drafts/${draftId}/send`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId,
			body: { undoSeconds: 0 }
		})
		expect(send.status).toBe(200)
		expect(send.json['status']).toBe('sending')

		// Worker's due sweep with a fake transport (self-host/test seam).
		const sent: OutboundMail[] = []
		const sentOk = await withWorkspace(db.app, { workspaceId: fixture.workspaceId }, (tx) =>
			sendDueDraft(tx, fixture.workspaceId, draftId, {
				storage: blobStorage,
				cfg: mailCfg,
				transportOverride: {
					send: async (m) => {
						sent.push(m)
						return { providerMessageId: 'fake-1', accepted: m.to.map((a) => a.email), rejected: [] }
					}
				}
			})
		)
		expect(sentOk).toBe(true)
		expect(sent.length).toBe(1)
		expect(sent[0]!.from.email).toBe('support@test.huriro.dev')
		expect(sent[0]!.to[0]!.email).toBe('jane@customer.example')
		expect(sent[0]!.inReplyTo).toBe('<cust-001@customer.example>')

		const timeline2 = await apiRequest(app, {
			path: `/api/v1/mail/conversations/${convId}/timeline`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		const messages2 = timeline2.json['messages'] as Record<string, unknown>[]
		expect(messages2.some((m) => m['direction'] === 'outbound')).toBe(true)

		// --- convert to issue end to end ---
		const proj = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/projects',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { key: 'SUP', name: 'Support Desk', visibility: 'workspace' }
		})
		expect(proj.status).toBe(201)
		const projectId = String(proj.json['id'])

		const converted = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/mail/conversations/${convId}/convert-to-issue`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId,
			body: { projectId }
		})
		expect(converted.status).toBe(200)
		expect(converted.json['identifier']).toBe('SUP-1')
		const issueId = String(converted.json['issueId'])

		const timeline3 = await apiRequest(app, {
			path: `/api/v1/mail/conversations/${convId}/timeline`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		expect((timeline3.json['linkedTasks'] as { taskId: string }[]).some((t) => t.taskId === issueId)).toBe(
			true
		)
		expect((timeline3.json['events'] as { kind: string }[]).some((e) => e.kind === 'converted')).toBe(true)
	}, 30_000)

	test('2. undo-send: due sweep skips inside the window; undo restores the draft', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub, blobStorage, rootSecret } = createIntegrationServer(db, {
			mail: { publicBaseUrl: 'http://localhost' }
		})
		const drain = () =>
			drainOutboxOnce(db!.app, pubsub, {
				blobStorage,
				rootSecret,
				mail: {},
				onlyWorkspaceId: fixture.workspaceId
			})

		const acctRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/mail/accounts',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { provider: 'inbound_parse', address: 'support@test.huriro.dev' }
		})
		const accountId = String(acctRes.json['id'])
		const token = extractInboundToken(acctRes.json['inboundUrl'])

		const idRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/mail/identities',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { accountId, address: 'support@test.huriro.dev' }
		})
		const identityId = String(idRes.json['id'])

		await postRawMime(app, `/api/v1/mail/inbound/${token}`, CUSTOMER_MIME)
		await drain()
		const convList = await apiRequest(app, {
			path: '/api/v1/mail/conversations',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		const convId = String((convList.json['data'] as Record<string, unknown>[])[0]!['id'])

		const draft = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/mail/conversations/${convId}/drafts`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: {
				identityId,
				recipients: { to: [{ email: 'jane@customer.example' }] },
				bodyText: 'Premature reply'
			}
		})
		const draftId = String(draft.json['id'])

		// 60s undo window — the sweep must NOT send it yet.
		await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/mail/drafts/${draftId}/send`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { undoSeconds: 60 }
		})
		const sentEarly = await withWorkspace(db.app, { workspaceId: fixture.workspaceId }, (tx) =>
			sendDueDraft(tx, fixture.workspaceId, draftId, { storage: blobStorage, cfg: mailCfg })
		)
		expect(sentEarly).toBe(false)

		const undo = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/mail/drafts/${draftId}/undo`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		expect(undo.status).toBe(200)
		expect(undo.json['status']).toBe('draft')

		// After undo the row is a plain draft again — sweep stays a no-op.
		const sentAfterUndo = await withWorkspace(db.app, { workspaceId: fixture.workspaceId }, (tx) =>
			sendDueDraft(tx, fixture.workspaceId, draftId, { storage: blobStorage, cfg: mailCfg })
		)
		expect(sentAfterUndo).toBe(false)

		// A second undo hits the window-expired contract.
		const undoAgain = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/mail/drafts/${draftId}/undo`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		expect(undoAgain.status).toBe(409)
	}, 30_000)

	test('3. dedupe + quarantine: replayed Message-Id is a no-op, garbage is visible', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub, blobStorage, rootSecret } = createIntegrationServer(db, {
			mail: { publicBaseUrl: 'http://localhost' }
		})
		const drain = () =>
			drainOutboxOnce(db!.app, pubsub, {
				blobStorage,
				rootSecret,
				mail: {},
				onlyWorkspaceId: fixture.workspaceId
			})

		const acctRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/mail/accounts',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { provider: 'inbound_parse', address: 'support@test.huriro.dev' }
		})
		const token = extractInboundToken(acctRes.json['inboundUrl'])

		await postRawMime(app, `/api/v1/mail/inbound/${token}`, CUSTOMER_MIME)
		await postRawMime(app, `/api/v1/mail/inbound/${token}`, CUSTOMER_MIME) // MTA redelivery
		await postRawMime(app, `/api/v1/mail/inbound/${token}`, '\x00\x01\x02 not mail \x03\x04')
		await drain()

		const convList = await apiRequest(app, {
			path: '/api/v1/mail/conversations',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		const convs = convList.json['data'] as Record<string, unknown>[]
		const real = convs.find((c) => c['subject'] === 'Login broken on mobile')!
		const quarantined = convs.find((c) => c['subject'] === '[unparseable message]')!
		expect(quarantined).toBeTruthy()

		const timeline = await apiRequest(app, {
			path: `/api/v1/mail/conversations/${real['id']}/timeline`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		// Two webhook deliveries → exactly one message.
		expect((timeline.json['messages'] as unknown[]).length).toBe(1)

		const qTimeline = await apiRequest(app, {
			path: `/api/v1/mail/conversations/${quarantined['id']}/timeline`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		const qMsg = (qTimeline.json['messages'] as Record<string, unknown>[])[0]!
		expect(String(qMsg['snippet'])).toContain('Parse failed')
	}, 30_000)

	test('4. deny paths: outsider/suspended/guest 403, cross-tenant 404, bad token 404', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub, blobStorage, rootSecret } = createIntegrationServer(db, {
			mail: { publicBaseUrl: 'http://localhost' }
		})

		const acctRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/mail/accounts',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { provider: 'inbound_parse', address: 'support@test.huriro.dev' }
		})
		const token = extractInboundToken(acctRes.json['inboundUrl'])
		await postRawMime(app, `/api/v1/mail/inbound/${token}`, CUSTOMER_MIME)
		await drainOutboxOnce(db!.app, pubsub, {
			blobStorage,
			rootSecret,
			mail: {},
			onlyWorkspaceId: fixture.workspaceId
		})
		const convList = await apiRequest(app, {
			path: '/api/v1/mail/conversations',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		const convId = String((convList.json['data'] as Record<string, unknown>[])[0]!['id'])

		for (const denied of [fixture.outsiderId, fixture.suspendedId, fixture.guestId]) {
			const list = await apiRequest(app, {
				path: '/api/v1/mail/conversations',
				workspaceId: fixture.workspaceId,
				userId: denied
			})
			expect(list.status).toBe(403)
		}

		// Cross-tenant BOLA: workspace B member hits A's conversation id → 404
		// (RLS hides the row entirely — same contract as issues/docs).
		const cross = await apiRequest(app, {
			path: `/api/v1/mail/conversations/${convId}/timeline`,
			workspaceId: fixture.otherWorkspaceId,
			userId: fixture.otherTenantUserId
		})
		expect(cross.status).toBe(404)

		// Unknown inbound token → 404; no rows land anywhere.
		const badInbound = await postRawMime(app, '/api/v1/mail/inbound/mi_deadbeef', CUSTOMER_MIME)
		expect(badInbound.status).toBe(404)
	}, 30_000)
})
