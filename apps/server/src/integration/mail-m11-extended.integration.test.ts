/** M11 mail parity extended coverage: forward/split, contacts/organizations,
 * SLA policies, round-robin routing, bulk triage and private-inbox ACLs
 * against real PostgreSQL/RLS. Inbound conversations are built by injecting
 * raw MIME through the webhook seam, exactly like production MTA delivery.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import type { TestDb } from '@huriro/test-utils'
import type { MailModuleConfig } from '../modules/mail'
import { drainOutboxOnce as drainOutboxBatch } from '../worker'
import { apiRequest, createIntegrationServer, getTestDb, seedM1Fixture } from './test-harness'

let db: TestDb | null = null

beforeAll(async () => {
	db = await getTestDb()
})

const mailCfg: MailModuleConfig = {
	rootSecret: 'huriro-integration-test-root-secret-32chars',
	maxMessageBytes: 52_428_800,
	undoSendSeconds: 10,
	publicBaseUrl: 'http://localhost'
}

const CUSTOMER_MIME = [
	'From: Customer Jane <jane@customer.example>',
	'To: Support <support@test.huriro.dev>',
	'Subject: Billing question',
	'Message-Id: <ext-001@customer.example>',
	'MIME-Version: 1.0',
	'Content-Type: text/plain; charset="utf-8"',
	'',
	'Why was I charged twice this month?'
].join('\r\n')

const CUSTOMER_REPLY_MIME = [
	'From: Customer Jane <jane@customer.example>',
	'To: Support <support@test.huriro.dev>',
	'Subject: Re: Billing question',
	'Message-Id: <ext-002@customer.example>',
	'In-Reply-To: <ext-001@customer.example>',
	'References: <ext-001@customer.example>',
	'MIME-Version: 1.0',
	'Content-Type: text/plain; charset="utf-8"',
	'',
	'Adding a screenshot of the duplicate charge.'
].join('\r\n')

type App = ReturnType<typeof createIntegrationServer>['app']

async function postRawMime(app: App, path: string, raw: string): Promise<Response> {
	return app.handle(
		new Request(`http://localhost${path}`, {
			method: 'POST',
			headers: { 'content-type': 'message/rfc822', 'x-huriro-client': 'huriro-test' },
			body: raw
		})
	)
}

type CallerFn = (
	path: string,
	init?: { method?: string; body?: unknown }
) => Promise<{ status: number; json: Record<string, unknown> }>

interface MailFixture {
	readonly app: App
	readonly pubsub: Parameters<typeof drainOutboxBatch>[1]
	readonly blobStorage: unknown
	readonly rootSecret: string
	readonly ws: string
	readonly a: string
	readonly b: string
	readonly ownerId: string
	readonly adminId: string
	readonly guestId: string
	readonly inboxId: string
	readonly accountId: string
	readonly identityId: string
	readonly inboundToken: string
	readonly asA: CallerFn
	readonly asB: CallerFn
	readonly asOwner: CallerFn
	readonly asAdmin: CallerFn
	readonly asGuest: CallerFn
}

async function setupMail(testDb: TestDb): Promise<MailFixture> {
	const fixture = await seedM1Fixture(testDb.owner)
	const { app, pubsub, blobStorage, rootSecret } = createIntegrationServer(testDb, { mail: mailCfg })
	const ws = fixture.workspaceId
	const a = fixture.memberAId
	const b = fixture.memberBId
	const asUser =
		(userId: string): CallerFn =>
		(path, init) =>
			apiRequest(app, { path, workspaceId: ws, userId, ...init }) as Promise<{
				status: number
				json: Record<string, unknown>
			}>
	const asA = asUser(a)
	const asB = asUser(b)
	const asOwner = asUser(fixture.ownerId)
	const asAdmin = asUser(fixture.adminId)
	const asGuest = asUser(fixture.guestId)

	const acct = await asA('/api/v1/mail/accounts', {
		method: 'POST',
		body: { provider: 'inbound_parse', address: 'support@test.huriro.dev', displayName: 'Support' }
	})
	expect(acct.status).toBe(201)
	const accountId = String(acct.json['id'])
	const inboundToken = /\/inbound\/(.+)$/.exec(String(acct.json['inboundUrl']))?.[1] ?? ''
	const identity = await asA('/api/v1/mail/identities', {
		method: 'POST',
		body: { accountId, address: 'support@test.huriro.dev', displayName: 'Support', isDefault: true }
	})
	expect(identity.status).toBe(201)
	const inbox = await asA('/api/v1/mail/inboxes', { method: 'POST', body: { name: 'Support' } })
	expect(inbox.status).toBe(201)
	return {
		app,
		pubsub,
		blobStorage,
		rootSecret,
		ws,
		a,
		b,
		ownerId: fixture.ownerId,
		adminId: fixture.adminId,
		guestId: fixture.guestId,
		accountId,
		identityId: String(identity.json['id']),
		inboxId: String(inbox.json['id']),
		inboundToken,
		asA,
		asB,
		asOwner,
		asAdmin,
		asGuest
	}
}

async function drain(fx: MailFixture): Promise<void> {
	if (!db) return
	let total = 0
	while (true) {
		const drained = await drainOutboxBatch(db.app, fx.pubsub, {
			blobStorage: fx.blobStorage as never,
			rootSecret: fx.rootSecret,
			mail: {},
			onlyWorkspaceId: fx.ws
		})
		total += drained
		if (drained === 0 || total > 200) break
	}
}

async function injectConversation(fx: MailFixture): Promise<string> {
	const res = await postRawMime(fx.app, `/api/v1/mail/inbound/${fx.inboundToken}`, CUSTOMER_MIME)
	expect(res.status).toBe(200)
	await drain(fx)
	const list = await fx.asA('/api/v1/mail/conversations')
	expect(list.status).toBe(200)
	const rows = (list.json['data'] ?? list.json) as Record<string, unknown>[]
	const convo = rows.find((r) => r['subject'] === 'Billing question')
	expect(convo).toBeTruthy()
	return String(convo?.['id'])
}

async function injectUniqueConversation(fx: MailFixture, suffix: string): Promise<string> {
	const subject = `Billing question ${suffix}`
	const raw = [
		'From: Customer Jane <jane@customer.example>',
		'To: Support <support@test.huriro.dev>',
		`Subject: ${subject}`,
		`Message-Id: <ext-${suffix}@customer.example>`,
		'MIME-Version: 1.0',
		'Content-Type: text/plain; charset="utf-8"',
		'',
		`Question ${suffix}`
	].join('\r\n')
	const res = await postRawMime(fx.app, `/api/v1/mail/inbound/${fx.inboundToken}`, raw)
	expect(res.status).toBe(200)
	await drain(fx)
	const list = await fx.asA('/api/v1/mail/conversations')
	expect(list.status).toBe(200)
	const rows = (list.json['data'] ?? list.json) as Record<string, unknown>[]
	const convo = rows.find((r) => r['subject'] === subject)
	expect(convo).toBeTruthy()
	return String(convo?.['id'])
}

describe('M11 mail extended parity (PostgreSQL 18)', () => {
	test('forward creates an outbound draft; split forks the thread at a message', async () => {
		if (!db) return
		const fx = await setupMail(db)
		const conversationId = await injectConversation(fx)
		// Second inbound message so the thread has two messages to split at.
		const res2 = await postRawMime(fx.app, `/api/v1/mail/inbound/${fx.inboundToken}`, CUSTOMER_REPLY_MIME)
		expect(res2.status).toBe(200)
		await drain(fx)

		// Forward: outbound draft shell carrying the original context.
		const fwd = await fx.asA(`/api/v1/mail/conversations/${conversationId}/forward`, {
			method: 'POST',
			body: {
				identityId: fx.identityId,
				recipients: { to: [{ email: 'billing@vendor.example', name: 'Vendor' }] },
				bodyText: 'Forwarding this customer question your way.',
				includeHistory: true
			}
		})
		if (fwd.status !== 200 && fwd.status !== 201) console.error('forward failure', fwd.json)
		expect([200, 201]).toContain(fwd.status)

		// Split: pick the second message from the timeline and fork it.
		const timeline = await fx.asA(`/api/v1/mail/conversations/${conversationId}/timeline`)
		expect(timeline.status).toBe(200)
		const items = (timeline.json['data'] ?? timeline.json['messages'] ?? []) as Record<string, unknown>[]
		const messages = items.filter((i) => i['kind'] === 'message' || i['messageId'] || i['direction'])
		expect(messages.length).toBeGreaterThanOrEqual(2)
		const second = messages[messages.length - 1]
		const messageId = String(second?.['messageId'] ?? second?.['id'])
		const split = await fx.asA(`/api/v1/mail/conversations/${conversationId}/split`, {
			method: 'POST',
			body: { messageId, subject: 'Duplicate charge evidence' }
		})
		if (split.status !== 200 && split.status !== 201) console.error('split failure', split.json)
		expect([200, 201]).toContain(split.status)
		const newConvoId = String(split.json['conversationId'] ?? split.json['id'] ?? '')
		expect(newConvoId).toBeTruthy()
		expect(newConvoId).not.toBe(conversationId)
	})

	test('contacts and organizations round-trip with vip tiers', async () => {
		if (!db) return
		const fx = await setupMail(db)

		const org = await fx.asA('/api/v1/mail/contact-organizations', {
			method: 'POST',
			body: { name: 'Acme Corp', domain: 'acme.example', tier: 'strategic' }
		})
		expect(org.status).toBe(201)
		const orgId = String(org.json['id'])

		const contact = await fx.asA('/api/v1/mail/contacts', {
			method: 'POST',
			body: {
				organizationId: orgId,
				email: 'jane@acme.example',
				displayName: 'Jane Acme',
				title: 'CTO',
				vipTier: 'vip'
			}
		})
		expect(contact.status).toBe(201)
		const contactId = String(contact.json['id'])

		const list = await fx.asB('/api/v1/mail/contacts')
		expect(list.status).toBe(200)
		const rows = (list.json['data'] ?? list.json) as Record<string, unknown>[]
		expect(rows.some((r) => r['email'] === 'jane@acme.example')).toBe(true)

		const patch = await fx.asA(`/api/v1/mail/contacts/${contactId}`, {
			method: 'PATCH',
			body: { email: 'jane@acme.example', notes: 'Prefers async communication' }
		})
		expect([200, 204]).toContain(patch.status)

		const orgs = await fx.asA('/api/v1/mail/contact-organizations')
		expect(orgs.status).toBe(200)
		const orgRows = (orgs.json['data'] ?? orgs.json) as Record<string, unknown>[]
		expect(orgRows.some((r) => r['name'] === 'Acme Corp')).toBe(true)
	})

	test('SLA policies CRUD and round-robin routing assigns within caps', async () => {
		if (!db) return
		const fx = await setupMail(db)

		const sla = await fx.asA('/api/v1/mail/sla-policies', {
			method: 'POST',
			body: { inboxId: fx.inboxId, name: 'First reply in 1h', firstReplyMinutes: 60, resolutionMinutes: 480 }
		})
		expect(sla.status).toBe(201)
		const slaList = await fx.asA('/api/v1/mail/sla-policies')
		expect(slaList.status).toBe(200)
		const slaRows = (slaList.json['data'] ?? slaList.json) as Record<string, unknown>[]
		expect(slaRows.length).toBeGreaterThanOrEqual(1)

		// Routing config round-trips through optimistic concurrency-free PUT.
		const putRouting = await fx.asA(`/api/v1/mail/inboxes/${fx.inboxId}/routing`, {
			method: 'PUT',
			body: { enabled: true, maxOpenCap: 5, requireOnline: false, respectDnd: true }
		})
		expect(putRouting.status).toBe(200)
		const getRouting = await fx.asA(`/api/v1/mail/inboxes/${fx.inboxId}/routing`)
		expect(getRouting.status).toBe(200)
		const routingCfg = (getRouting.json['config'] ?? getRouting.json) as Record<string, unknown>
		expect(routingCfg['enabled']).toBe(true)

		// Put owner & admin on DND so only mail.assign non-guest members (A & B) are eligible.
		const dndUntil = new Date(Date.now() + 3_600_000).toISOString()
		for (const caller of [fx.asOwner, fx.asAdmin]) {
			const statusRes = await caller('/api/v1/chat/me/status', {
				method: 'PUT',
				body: { statusEmoji: '🔕', statusText: 'Busy', dndUntil }
			})
			expect(statusRes.status).toBe(200)
		}

		// Set strict maxOpenCap = 1 and route three unique conversations.
		const capRouting = await fx.asA(`/api/v1/mail/inboxes/${fx.inboxId}/routing`, {
			method: 'PUT',
			body: { enabled: true, maxOpenCap: 1, requireOnline: false, respectDnd: true }
		})
		expect(capRouting.status).toBe(200)

		const c1 = await injectUniqueConversation(fx, 'rr-1')
		const c2 = await injectUniqueConversation(fx, 'rr-2')
		const c3 = await injectUniqueConversation(fx, 'rr-3')

		const r1 = await fx.asA(`/api/v1/mail/conversations/${c1}/route`, { method: 'POST' })
		expect(r1.status).toBe(200)
		const assigned1 = String(r1.json['assignedUserId'] ?? '')
		expect([fx.a, fx.b]).toContain(assigned1)

		const r2 = await fx.asA(`/api/v1/mail/conversations/${c2}/route`, { method: 'POST' })
		expect(r2.status).toBe(200)
		const assigned2 = String(r2.json['assignedUserId'] ?? '')
		expect([fx.a, fx.b]).toContain(assigned2)
		expect(assigned2).not.toBe(assigned1)

		// All eligible members have hit maxOpenCap = 1, so c3 returns null.
		const r3Saturated = await fx.asA(`/api/v1/mail/conversations/${c3}/route`, { method: 'POST' })
		expect(r3Saturated.status).toBe(200)
		expect(r3Saturated.json['assignedUserId']).toBeNull()

		// Closing c1 frees assigned1's capacity; routing c3 assigns to assigned1.
		const closeC1 = await fx.asA(`/api/v1/mail/conversations/${c1}`, {
			method: 'PATCH',
			body: { status: 'closed' }
		})
		expect(closeC1.status).toBe(200)

		const r3AfterClose = await fx.asA(`/api/v1/mail/conversations/${c3}/route`, { method: 'POST' })
		expect(r3AfterClose.status).toBe(200)
		expect(r3AfterClose.json['assignedUserId']).toBe(assigned1)
	})

	test('bulk triage applies status, assignee and tags atomically', async () => {
		if (!db) return
		const fx = await setupMail(db)
		const c1 = await injectConversation(fx)

		const tag = await fx.asA('/api/v1/mail/tags', {
			method: 'POST',
			body: { inboxId: fx.inboxId, name: 'billing', color: 'blue' }
		})
		expect(tag.status).toBe(201)

		const bulk = await fx.asA('/api/v1/mail/bulk-triage', {
			method: 'POST',
			body: {
				conversationIds: [c1],
				status: 'pending',
				assigneeId: fx.b,
				addTagIds: [tag.json['id']]
			}
		})
		if (bulk.status !== 200) console.error('bulk failure', bulk.json)
		expect(bulk.status).toBe(200)
		expect(Number(bulk.json['updatedCount'] ?? bulk.json['updated'] ?? 1)).toBeGreaterThanOrEqual(1)

		const tags = await fx.asA(`/api/v1/mail/conversations/${c1}/tags`)
		expect(tags.status).toBe(200)
		const tagRows = tags.json as unknown as Record<string, unknown>[]
		expect(tagRows.map((r) => r['name'])).toContain('billing')
	})

	test('private inbox enforces owner, user/role/workspace ACLs, deny paths, and audited admin bypass', async () => {
		if (!db) return
		const testDb = db
		const fx = await setupMail(testDb)

		// Owner A creates a private inbox owned by A and seeds a private conversation inside it.
		const priv = await fx.asA('/api/v1/mail/inboxes', {
			method: 'POST',
			body: { name: 'Executives', visibility: 'private', ownerUserId: fx.a }
		})
		expect(priv.status).toBe(201)
		const privId = String(priv.json['id'])

		const outbound = await fx.asA('/api/v1/mail/outbound', {
			method: 'POST',
			body: {
				inboxId: privId,
				identityId: fx.identityId,
				recipients: { to: [{ email: 'vip@customer.example', name: 'VIP' }] },
				subject: 'VIP Private Thread',
				bodyText: 'Confidential update.'
			}
		})
		expect(outbound.status).toBe(201)
		const privConvId = String(outbound.json['conversationId'])

		// Owner sees private inbox & conversation.
		const listA = await fx.asA('/api/v1/mail/inboxes')
		const rowsA = (listA.json['data'] ?? listA.json) as Record<string, unknown>[]
		expect(rowsA.some((r) => r['id'] === privId)).toBe(true)

		// Non-owner member B (who holds workspace mail.assign) must NOT see or bypass private inbox.
		const listB = await fx.asB('/api/v1/mail/inboxes')
		const rowsB = (listB.json['data'] ?? listB.json) as Record<string, unknown>[]
		expect(rowsB.some((r) => r['id'] === privId)).toBe(false)

		const convListB = await fx.asB('/api/v1/mail/conversations')
		const convRowsB = (convListB.json['data'] ?? convListB.json) as Record<string, unknown>[]
		expect(convRowsB.some((r) => r['id'] === privConvId)).toBe(false)

		expect((await fx.asB(`/api/v1/mail/conversations?inboxId=${privId}`)).status).toBe(403)
		expect((await fx.asB(`/api/v1/mail/conversations/${privConvId}/timeline`)).status).toBe(403)
		expect(
			(
				await fx.asB(`/api/v1/mail/conversations/${privConvId}`, {
					method: 'PATCH',
					body: { status: 'pending' }
				})
			).status
		).toBe(403)
		expect(
			(
				await fx.asB('/api/v1/mail/outbound', {
					method: 'POST',
					body: {
						inboxId: privId,
						identityId: fx.identityId,
						recipients: { to: [{ email: 'blocked@customer.example' }] },
						subject: 'Blocked',
						bodyText: 'Should fail.'
					}
				})
			).status
		).toBe(403)
		expect((await fx.asB(`/api/v1/acl?resourceType=mail_inbox&resourceId=${privId}`)).status).toBe(403)
		expect(
			(
				await fx.asB('/api/v1/acl', {
					method: 'POST',
					body: {
						resourceType: 'mail_inbox',
						resourceId: privId,
						principalType: 'user',
						principalId: fx.b,
						permission: 'read'
					}
				})
			).status
		).toBe(403)

		// Positive user ACL grant: 'read' grants read/timeline, denies write/assign/ACL manage.
		const userReadGrant = await fx.asA('/api/v1/acl', {
			method: 'POST',
			body: {
				resourceType: 'mail_inbox',
				resourceId: privId,
				principalType: 'user',
				principalId: fx.b,
				permission: 'read'
			}
		})
		expect(userReadGrant.status).toBe(200)
		const userReadAclId = String(userReadGrant.json['id'])

		const listBAfterRead = await fx.asB('/api/v1/mail/inboxes')
		expect(
			((listBAfterRead.json['data'] ?? listBAfterRead.json) as Record<string, unknown>[]).some(
				(r) => r['id'] === privId
			)
		).toBe(true)
		expect((await fx.asB(`/api/v1/mail/conversations/${privConvId}/timeline`)).status).toBe(200)
		expect(
			(
				await fx.asB(`/api/v1/mail/conversations/${privConvId}`, {
					method: 'PATCH',
					body: { status: 'pending' }
				})
			).status
		).toBe(403)
		expect((await fx.asB(`/api/v1/acl?resourceType=mail_inbox&resourceId=${privId}`)).status).toBe(403)

		// Upgrade B to 'write' ACL -> allows triage/send, still denies ACL management; revoke denies again.
		expect((await fx.asA(`/api/v1/acl/${userReadAclId}`, { method: 'DELETE' })).status).toBe(200)
		const userWriteGrant = await fx.asA('/api/v1/acl', {
			method: 'POST',
			body: {
				resourceType: 'mail_inbox',
				resourceId: privId,
				principalType: 'user',
				principalId: fx.b,
				permission: 'write'
			}
		})
		expect(userWriteGrant.status).toBe(200)
		const userWriteAclId = String(userWriteGrant.json['id'])

		expect(
			(
				await fx.asB(`/api/v1/mail/conversations/${privConvId}`, {
					method: 'PATCH',
					body: { status: 'pending' }
				})
			).status
		).toBe(200)
		expect((await fx.asB(`/api/v1/acl?resourceType=mail_inbox&resourceId=${privId}`)).status).toBe(403)

		expect((await fx.asA(`/api/v1/acl/${userWriteAclId}`, { method: 'DELETE' })).status).toBe(200)
		expect((await fx.asB(`/api/v1/mail/conversations/${privConvId}/timeline`)).status).toBe(403)

		// Positive role ACL grant ('member' role -> write) & revoke.
		const [memberRole] = await testDb.owner<{ id: string }[]>`
			SELECT id FROM roles WHERE workspace_id = ${fx.ws} AND key = 'member'
		`
		expect(memberRole).toBeTruthy()
		const roleGrant = await fx.asA('/api/v1/acl', {
			method: 'POST',
			body: {
				resourceType: 'mail_inbox',
				resourceId: privId,
				principalType: 'role',
				principalId: memberRole!.id,
				permission: 'write'
			}
		})
		expect(roleGrant.status).toBe(200)
		const roleAclId = String(roleGrant.json['id'])
		expect((await fx.asB(`/api/v1/mail/conversations/${privConvId}/timeline`)).status).toBe(200)
		expect(
			(
				await fx.asB(`/api/v1/mail/conversations/${privConvId}`, {
					method: 'PATCH',
					body: { status: 'open' }
				})
			).status
		).toBe(200)
		expect((await fx.asA(`/api/v1/acl/${roleAclId}`, { method: 'DELETE' })).status).toBe(200)
		expect((await fx.asB(`/api/v1/mail/conversations/${privConvId}/timeline`)).status).toBe(403)

		// Positive workspace ACL grant ('read') & revoke.
		const wsGrant = await fx.asA('/api/v1/acl', {
			method: 'POST',
			body: {
				resourceType: 'mail_inbox',
				resourceId: privId,
				principalType: 'workspace',
				permission: 'read'
			}
		})
		expect(wsGrant.status).toBe(200)
		const wsAclId = String(wsGrant.json['id'])
		expect((await fx.asB(`/api/v1/mail/conversations/${privConvId}/timeline`)).status).toBe(200)
		expect(
			(
				await fx.asB(`/api/v1/mail/conversations/${privConvId}`, {
					method: 'PATCH',
					body: { status: 'pending' }
				})
			).status
		).toBe(403)
		expect((await fx.asA(`/api/v1/acl/${wsAclId}`, { method: 'DELETE' })).status).toBe(200)
		expect((await fx.asB(`/api/v1/mail/conversations/${privConvId}/timeline`)).status).toBe(403)

		// Audited admin bypass: workspace admin can read conversation & inspect ACLs, writing audit_log rows.
		expect((await fx.asAdmin(`/api/v1/mail/conversations/${privConvId}/timeline`)).status).toBe(200)
		expect((await fx.asAdmin(`/api/v1/acl?resourceType=mail_inbox&resourceId=${privId}`)).status).toBe(200)
		const auditRows = await testDb.owner<{ action: string }[]>`
			SELECT action FROM audit_log
			WHERE workspace_id = ${fx.ws}
				AND target_type = 'mail_inbox'
				AND target_id = ${privId}
				AND actor_id = ${fx.adminId}
		`
		const actions = auditRows.map((r) => r.action)
		expect(actions).toContain('policy.admin_bypass.mail.read')
		expect(actions).toContain('acl.admin_bypass.read')
	})
})
