/** M11 mail parity integration: proactive compose, review-before-send,
 * tags, templates/snippets, macros and split-inbox administration against
 * real PostgreSQL/RLS. Collaborative Yjs transport is covered separately by
 * the realtime collab tests; this file pins the REST state machine.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import type { TestDb } from '@huriro/test-utils'
import { apiRequest, createIntegrationServer, getTestDb, seedM1Fixture } from './test-harness'

let db: TestDb | null = null

beforeAll(async () => {
	db = await getTestDb()
})

describe('M11 mail parity (PostgreSQL 18)', () => {
	test('proactive draft review gates send; tags/templates/macros/inbox settings work', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db, { mail: { publicBaseUrl: 'http://localhost' } })
		const asA = (path: string, init?: { method?: string; body?: unknown }) =>
			apiRequest(app, { path, workspaceId: fixture.workspaceId, userId: fixture.memberAId, ...init })
		const asB = (path: string, init?: { method?: string; body?: unknown }) =>
			apiRequest(app, { path, workspaceId: fixture.workspaceId, userId: fixture.memberBId, ...init })

		const acct = await asA('/api/v1/mail/accounts', {
			method: 'POST',
			body: { provider: 'inbound_parse', address: 'support@test.huriro.dev', displayName: 'Support' }
		})
		expect(acct.status).toBe(201)
		const accountId = String(acct.json['id'])
		const identity = await asA('/api/v1/mail/identities', {
			method: 'POST',
			body: { accountId, address: 'support@test.huriro.dev', displayName: 'Support', isDefault: true }
		})
		expect(identity.status).toBe(201)
		const inbox = await asA('/api/v1/mail/inboxes', { method: 'POST', body: { name: 'Support' } })
		expect(inbox.status).toBe(201)
		const inboxId = String(inbox.json['id'])

		// Proactive compose creates both the conversation shell and first outbound draft.
		const outbound = await asA('/api/v1/mail/outbound', {
			method: 'POST',
			body: {
				inboxId,
				identityId: identity.json['id'],
				subject: 'Welcome to Huriro',
				recipients: { to: [{ email: 'jane@customer.example', name: 'Jane' }] },
				bodyText: 'Hi Jane, welcome!',
				collabEnabled: true
			}
		})
		if (outbound.status !== 201) console.error('outbound failure', outbound.json)
		expect(outbound.status).toBe(201)
		const conversationId = String(outbound.json['conversationId'])
		const draft = outbound.json['draft'] as Record<string, unknown>
		const draftId = String(draft['id'])
		expect(draft['collabEnabled']).toBe(true)

		// Review-before-send is a hard state transition, not just UI affordance.
		const review = await asA(`/api/v1/mail/drafts/${draftId}/review`, {
			method: 'POST',
			body: { reviewerId: fixture.memberBId, note: 'Please check tone' }
		})
		expect(review.status).toBe(200)
		expect(review.json['reviewStatus']).toBe('requested')
		const blocked = await asA(`/api/v1/mail/drafts/${draftId}/send`, { method: 'POST', body: {} })
		expect(blocked.status).toBe(409)
		expect(blocked.json['code']).toBe('mail_review_required')
		const completed = await asB(`/api/v1/mail/drafts/${draftId}/review/complete`, {
			method: 'POST',
			body: { decision: 'approved' }
		})
		expect(completed.status).toBe(200)
		expect(completed.json['reviewStatus']).toBe('approved')
		const send = await asA(`/api/v1/mail/drafts/${draftId}/send`, {
			method: 'POST',
			body: { undoSeconds: 30 }
		})
		expect(send.status).toBe(200)

		// Tags attach to the shared conversation and are visible through the REST seam.
		const tag = await asA('/api/v1/mail/tags', {
			method: 'POST',
			body: { inboxId, name: 'vip', color: 'gold' }
		})
		expect(tag.status).toBe(201)
		const tagId = String(tag.json['id'])
		const putTags = await asA(`/api/v1/mail/conversations/${conversationId}/tags`, {
			method: 'PUT',
			body: { tagIds: [tagId] }
		})
		expect(putTags.status).toBe(200)
		const conversationTags = await asB(`/api/v1/mail/conversations/${conversationId}/tags`)
		expect(conversationTags.status).toBe(200)
		expect((conversationTags.json as unknown as Record<string, unknown>[]).map((r) => r['name'])).toContain(
			'vip'
		)

		// Templates render merge variables server-side; macros atomically mutate the target.
		const template = await asA('/api/v1/mail/templates', {
			method: 'POST',
			body: { inboxId, name: 'Welcome', shortcut: ';welcome', bodyText: 'Hello {{first_name}}' }
		})
		expect(template.status).toBe(201)
		const rendered = await asA(`/api/v1/mail/templates/${template.json['id']}/render`, {
			method: 'POST',
			body: { variables: { first_name: 'Jane' } }
		})
		expect(rendered.status).toBe(200)
		expect(rendered.json['bodyText']).toBe('Hello Jane')
		const macro = await asA('/api/v1/mail/macros', {
			method: 'POST',
			body: {
				inboxId,
				name: 'Escalate',
				steps: [
					{ action: 'set_status', value: 'pending' },
					{ action: 'add_tag', value: tagId }
				]
			}
		})
		expect(macro.status).toBe(201)
		const applied = await asA(`/api/v1/mail/macros/${macro.json['id']}/apply`, {
			method: 'POST',
			body: { conversationIds: [conversationId] }
		})
		expect(applied.status).toBe(200)
		expect(applied.json['appliedCount']).toBe(1)

		// Split-inbox metadata is optimistic-concurrency protected.
		const settings = await asA(`/api/v1/mail/inboxes/${inboxId}/settings`, {
			method: 'PATCH',
			body: { settings: { splitSections: [{ key: 'mine', title: 'Mine' }] }, expectedVersion: 1 }
		})
		expect(settings.status).toBe(200)
		expect((settings.json['settings'] as Record<string, unknown>)['splitSections']).toBeTruthy()

		// Tag filter narrows conversation listing by tagId.
		const taggedList = await asA(`/api/v1/mail/conversations?tagId=${tagId}`)
		expect(taggedList.status).toBe(200)
		const taggedRows = (taggedList.json['data'] ?? []) as Record<string, unknown>[]
		expect(taggedRows.map((row) => String(row['id']))).toContain(conversationId)
		const emptyTagList = await asA('/api/v1/mail/conversations?tagId=00000000-0000-4000-8000-000000000001')
		expect(emptyTagList.status).toBe(200)
		expect((emptyTagList.json['data'] as unknown[]).length).toBe(0)

		// Future scheduledSendAt sets sending state with future timestamp, and undo restores draft state.
		const draft2 = await asA(`/api/v1/mail/conversations/${conversationId}/drafts`, {
			method: 'POST',
			body: {
				identityId: identity.json['id'],
				recipients: { to: [{ email: 'jane@customer.example', name: 'Jane' }] },
				bodyText: 'Follow up later'
			}
		})
		expect(draft2.status).toBe(201)
		const draft2Id = String(draft2.json['id'])
		const futureIso = new Date(Date.now() + 3_600_000).toISOString()
		const scheduledSend = await asA(`/api/v1/mail/drafts/${draft2Id}/send`, {
			method: 'POST',
			body: { scheduledSendAt: futureIso }
		})
		expect(scheduledSend.status).toBe(200)
		expect(scheduledSend.json['status']).toBe('sending')
		expect(typeof scheduledSend.json['scheduledSendAt']).toBe('string')
		const undone = await asA(`/api/v1/mail/drafts/${draft2Id}/undo`, { method: 'POST', body: {} })
		expect(undone.status).toBe(200)
		expect(undone.json['status']).toBe('draft')
		expect(undone.json['scheduledSendAt']).toBeNull()

		// DELETE routes remove SLA policies, macros, templates, and tags cleanly.
		const sla = await asA('/api/v1/mail/sla-policies', {
			method: 'POST',
			body: { inboxId, name: 'Tier 1 SLA', firstReplyMinutes: 30, resolutionMinutes: 240, active: true }
		})
		expect(sla.status).toBe(201)
		const slaId = String(sla.json['id'])

		const delSla = await asA(`/api/v1/mail/sla-policies/${slaId}`, { method: 'DELETE' })
		expect(delSla.status).toBe(200)
		expect(delSla.json['deleted']).toBe(true)
		const slasAfter = await asA(`/api/v1/mail/sla-policies?inboxId=${inboxId}`)
		expect(
			((slasAfter.json['data'] ?? slasAfter.json) as Record<string, unknown>[]).map((r) => String(r['id']))
		).not.toContain(slaId)

		const macroId = String(macro.json['id'])
		const delMacro = await asA(`/api/v1/mail/macros/${macroId}`, { method: 'DELETE' })
		expect(delMacro.status).toBe(200)
		expect(delMacro.json['deleted']).toBe(true)
		const macrosAfter = await asA(`/api/v1/mail/macros?inboxId=${inboxId}`)
		expect(
			((macrosAfter.json['data'] ?? macrosAfter.json) as Record<string, unknown>[]).map((r) =>
				String(r['id'])
			)
		).not.toContain(macroId)

		const tplId = String(template.json['id'])
		const delTpl = await asA(`/api/v1/mail/templates/${tplId}`, { method: 'DELETE' })
		expect(delTpl.status).toBe(200)
		expect(delTpl.json['deleted']).toBe(true)
		const tplsAfter = await asA(`/api/v1/mail/templates?inboxId=${inboxId}`)
		expect(
			((tplsAfter.json['data'] ?? tplsAfter.json) as Record<string, unknown>[]).map((r) => String(r['id']))
		).not.toContain(tplId)

		const delTag = await asA(`/api/v1/mail/tags/${tagId}`, { method: 'DELETE' })
		expect(delTag.status).toBe(200)
		expect(delTag.json['deleted']).toBe(true)
		const tagsAfter = await asA(`/api/v1/mail/tags?inboxId=${inboxId}`)
		expect(
			((tagsAfter.json['data'] ?? tagsAfter.json) as Record<string, unknown>[]).map((r) => String(r['id']))
		).not.toContain(tagId)
	})
})
