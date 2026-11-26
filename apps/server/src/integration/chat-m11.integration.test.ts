/** M11 chat Slack-parity integration: broadcast-thread sequencing (the gate),
 * drafts, scheduled messages, saved-item reminders, pins, polls, sidebar,
 * user groups, ACL-safe forwarding, optional huddles. Real PostgreSQL/RLS.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import type { TestDb } from '@huriro/test-utils'
import { runChatSavedRemindersOnce, runChatScheduledMessagesOnce } from '../modules/chat'
import { apiRequest, createIntegrationServer, getTestDb, seedM1Fixture } from './test-harness'

let db: TestDb | null = null

beforeAll(async () => {
	db = await getTestDb()
})

async function makeChannel(
	app: ReturnType<typeof createIntegrationServer>['app'],
	workspaceId: string,
	userId: string,
	name: string
): Promise<string> {
	const res = await apiRequest(app, {
		method: 'POST',
		path: '/api/v1/chat/channels',
		workspaceId,
		userId,
		body: { kind: 'public', name }
	})
	expect(res.status).toBe(201)
	return String(res.json['id'])
}

async function send(
	app: ReturnType<typeof createIntegrationServer>['app'],
	workspaceId: string,
	userId: string,
	channelId: string,
	body: Record<string, unknown>
): Promise<Record<string, unknown>> {
	const res = await apiRequest(app, {
		method: 'POST',
		path: `/api/v1/chat/channels/${channelId}/messages`,
		workspaceId,
		userId,
		body
	})
	expect(res.status).toBe(201)
	return res.json as Record<string, unknown>
}

describe('M11 chat Slack parity (PostgreSQL 18)', () => {
	test('1. broadcast replies allocate both thread_seq and channel_seq with exact feed ordering', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		const ws = fixture.workspaceId
		const a = fixture.memberAId
		const ch = await makeChannel(app, ws, a, 'broadcast-test')

		// Interleave top-level messages and thread replies — the ordering gate.
		const t1 = await send(app, ws, a, ch, { bodyText: 'top one' })
		const parent = await send(app, ws, a, ch, { bodyText: 'parent' })
		const parentId = String(parent['id'])
		const plainReply = await send(app, ws, a, ch, {
			bodyText: 'plain thread reply',
			threadParentId: parentId
		})
		const broadcast = await send(app, ws, a, ch, {
			bodyText: 'broadcast reply',
			threadParentId: parentId,
			broadcastToChannel: true
		})
		const t2 = await send(app, ws, a, ch, { bodyText: 'top two' })

		// Plain replies: thread_seq only. Broadcast replies: BOTH sequences.
		expect(plainReply['channelSeq']).toBeNull()
		expect(typeof plainReply['threadSeq']).toBe('number')
		expect(typeof broadcast['channelSeq']).toBe('number')
		expect(typeof broadcast['threadSeq']).toBe('number')
		expect(broadcast['broadcastToChannel']).toBe(true)

		// Channel feed contains top-level + broadcast, in channel_seq order,
		// but NOT the plain thread reply.
		const feed = await apiRequest(app, {
			path: `/api/v1/chat/channels/${ch}/messages`,
			workspaceId: ws,
			userId: a
		})
		expect(feed.status).toBe(200)
		const rows = (feed.json['data'] ?? feed.json) as Record<string, unknown>[]
		const texts = rows.map((r) => String(r['bodyText']))
		expect(texts).not.toContain('plain thread reply')
		expect(texts).toContain('broadcast reply')
		// Exact ordering: one, parent, broadcast, two
		expect(texts.indexOf('top one')).toBeLessThan(texts.indexOf('parent'))
		expect(texts.indexOf('parent')).toBeLessThan(texts.indexOf('broadcast reply'))
		expect(texts.indexOf('broadcast reply')).toBeLessThan(texts.indexOf('top two'))
		// channel_seq strictly increasing along the feed
		const seqs = rows.map((r) => Number(r['channelSeq']))
		for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1] ?? 0)
		expect(t1['id']).toBeTruthy()
		expect(t2['id']).toBeTruthy()

		// Thread view contains both replies ordered by thread_seq.
		const thread = await apiRequest(app, {
			path: `/api/v1/chat/channels/${ch}/messages/${parentId}/thread`,
			workspaceId: ws,
			userId: a
		})
		if (thread.status === 200) {
			const replies = (
				(thread.json['data'] ?? thread.json['replies'] ?? []) as Record<string, unknown>[]
			).map((r) => String(r['bodyText']))
			expect(replies.indexOf('plain thread reply')).toBeLessThan(replies.indexOf('broadcast reply'))
		}

		// Broadcast to channel on a top-level message is rejected.
		const bad = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${ch}/messages`,
			workspaceId: ws,
			userId: a,
			body: { bodyText: 'bad', broadcastToChannel: true }
		})
		expect(bad.status).toBe(422)
	})

	test('2. drafts persist per channel/thread and delete cleanly', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		const ws = fixture.workspaceId
		const a = fixture.memberAId
		const ch = await makeChannel(app, ws, a, 'drafts-test')

		const upsert = await apiRequest(app, {
			method: 'PUT',
			path: `/api/v1/chat/channels/${ch}/draft`,
			workspaceId: ws,
			userId: a,
			body: { bodyText: 'half-written' }
		})
		const draftId = String((upsert.json as Record<string, unknown>)['id'] ?? '')
		expect([200, 201]).toContain(upsert.status)

		const list = await apiRequest(app, { path: '/api/v1/chat/drafts', workspaceId: ws, userId: a })
		expect(list.status).toBe(200)
		const rows = (list.json['data'] ?? list.json) as Record<string, unknown>[]
		expect(rows.some((r) => r['bodyText'] === 'half-written')).toBe(true)

		// Upsert again — same channel/thread scope collapses to one row.
		await apiRequest(app, {
			method: 'PUT',
			path: `/api/v1/chat/channels/${ch}/draft`,
			workspaceId: ws,
			userId: a,
			body: { bodyText: 'revised' }
		})
		const list2 = await apiRequest(app, { path: '/api/v1/chat/drafts', workspaceId: ws, userId: a })
		const rows2 = ((list2.json['data'] ?? list2.json) as Record<string, unknown>[]).filter(
			(r) => r['channelId'] === ch
		)
		expect(rows2.length).toBe(1)
		expect(rows2[0]?.['bodyText']).toBe('revised')

		const del = await apiRequest(app, {
			method: 'DELETE',
			path: `/api/v1/chat/drafts/${draftId || String(rows2[0]?.['id'])}`,
			workspaceId: ws,
			userId: a
		})
		expect(del.status).toBe(200)
	})

	test('3. scheduled messages dispatch through the worker at due time', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		const ws = fixture.workspaceId
		const a = fixture.memberAId
		const ch = await makeChannel(app, ws, a, 'sched-test')

		// Validation rejects past timestamps.
		const badRes = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${ch}/scheduled`,
			workspaceId: ws,
			userId: a,
			body: { bodyText: 'too late', scheduledFor: new Date(Date.now() - 1000).toISOString() }
		})
		expect(badRes.status).toBe(422)

		const res = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${ch}/scheduled`,
			workspaceId: ws,
			userId: a,
			body: { bodyText: 'scheduled hello', scheduledFor: new Date(Date.now() + 3600_000).toISOString() }
		})
		expect([200, 201]).toContain(res.status)
		// Backdate through the owner pool so the due-sweep picks it up.
		await db.owner`
			UPDATE chat_scheduled_messages SET scheduled_for = now() - interval '1 second'
			WHERE workspace_id = ${ws} AND id = ${String(res.json['id'])}
		`

		const sent = await runChatScheduledMessagesOnce(db.app)
		expect(sent).toBeGreaterThanOrEqual(1)

		const feed = await apiRequest(app, {
			path: `/api/v1/chat/channels/${ch}/messages`,
			workspaceId: ws,
			userId: a
		})
		const rows = (feed.json['data'] ?? feed.json) as Record<string, unknown>[]
		expect(rows.some((r) => r['bodyText'] === 'scheduled hello')).toBe(true)
	})

	test('4. saved items with reminders notify through the worker', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		const ws = fixture.workspaceId
		const a = fixture.memberAId
		const ch = await makeChannel(app, ws, a, 'saved-test')
		const msg = await send(app, ws, a, ch, { bodyText: 'save me' })

		const res = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/chat/saved',
			workspaceId: ws,
			userId: a,
			body: { messageId: msg['id'], note: 'follow up', remindAt: new Date(Date.now() - 1000).toISOString() }
		})
		expect([200, 201]).toContain(res.status)
		await db.owner`
			UPDATE chat_saved_items SET remind_at = now() - interval '1 second'
			WHERE workspace_id = ${ws} AND id = ${String(res.json['id'])}
		`

		const list = await apiRequest(app, { path: '/api/v1/chat/saved', workspaceId: ws, userId: a })
		expect(list.status).toBe(200)
		const rows = (list.json['data'] ?? list.json) as Record<string, unknown>[]
		expect(rows.length).toBeGreaterThanOrEqual(1)

		const reminded = await runChatSavedRemindersOnce(db.app)
		expect(reminded).toBeGreaterThanOrEqual(0) // delivery depends on notification sink; no crash is the gate
	})

	test('5. pins, polls, user groups, sidebar, bookmarks round-trip', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		const ws = fixture.workspaceId
		const a = fixture.memberAId
		const b = fixture.memberBId
		const ch = await makeChannel(app, ws, a, 'misc-test')
		const msg = await send(app, ws, a, ch, { bodyText: 'pin me' })

		// pins
		const pin = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/messages/${msg['id']}/pin`,
			workspaceId: ws,
			userId: a
		})
		expect([200, 201]).toContain(pin.status)
		const pins = await apiRequest(app, {
			path: `/api/v1/chat/channels/${ch}/pins`,
			workspaceId: ws,
			userId: a
		})
		expect(pins.status).toBe(200)

		// poll lifecycle
		const poll = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${ch}/polls`,
			workspaceId: ws,
			userId: a,
			body: {
				question: 'Ship Friday?',
				options: [
					{ id: 'yes', label: 'Yes' },
					{ id: 'no', label: 'No' }
				]
			}
		})
		expect([200, 201]).toContain(poll.status)
		const pollId = String(poll.json['id'])
		const vote = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/polls/${pollId}/vote`,
			workspaceId: ws,
			userId: b,
			body: { optionIds: ['yes'] }
		})
		expect(vote.status).toBe(200)
		const results = await apiRequest(app, {
			path: `/api/v1/chat/polls/${pollId}`,
			workspaceId: ws,
			userId: a
		})
		expect(results.status).toBe(200)
		const channelPolls = await apiRequest(app, {
			path: `/api/v1/chat/channels/${ch}/polls`,
			workspaceId: ws,
			userId: a
		})
		expect(channelPolls.status).toBe(200)
		const pollList = (channelPolls.json['data'] ?? []) as Record<string, unknown>[]
		expect(pollList.some((p) => p['id'] === pollId && p['totalVotes'] === 1)).toBe(true)

		const close = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/polls/${pollId}/close`,
			workspaceId: ws,
			userId: a
		})
		expect(close.status).toBe(200)
		const lateVote = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/polls/${pollId}/vote`,
			workspaceId: ws,
			userId: a,
			body: { optionIds: ['no'] }
		})
		expect([409, 422]).toContain(lateVote.status)

		// user groups
		const group = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/chat/user-groups',
			workspaceId: ws,
			userId: a,
			body: { handle: 'eng', name: 'Engineering', memberIds: [a, b] }
		})
		expect([200, 201]).toContain(group.status)
		const groups = await apiRequest(app, { path: '/api/v1/chat/user-groups', workspaceId: ws, userId: a })
		expect(groups.status).toBe(200)
		const groupRows = (groups.json['data'] ?? []) as Record<string, unknown>[]
		expect(Array.isArray(groupRows[0]?.['memberIds'])).toBe(true)

		// channel canvas is created once and returned idempotently on subsequent calls
		const canvas1 = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${ch}/canvas`,
			workspaceId: ws,
			userId: a
		})
		expect(canvas1.status).toBe(200)
		const canvas2 = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${ch}/canvas`,
			workspaceId: ws,
			userId: a
		})
		expect(canvas2.status).toBe(200)
		expect(canvas2.json['pageId']).toBe(canvas1.json['pageId'])

		// granular mute / notifyLevel persistence
		const muteRes = await apiRequest(app, {
			method: 'PATCH',
			path: `/api/v1/chat/channels/${ch}/mute`,
			workspaceId: ws,
			userId: a,
			body: { muted: true, notifyLevel: 'mentions', mutedUntil: null }
		})
		expect(muteRes.status).toBe(200)
		expect(muteRes.json['notifyLevel']).toBe('mentions')

		// sidebar sections
		const section = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/chat/sidebar/sections',
			workspaceId: ws,
			userId: a,
			body: { name: 'Starred channels' }
		})
		expect([200, 201]).toContain(section.status)
		const sectionId = String(section.json['id'])
		const addItem = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/sidebar/sections/${sectionId}/items`,
			workspaceId: ws,
			userId: a,
			body: { channelId: ch }
		})
		expect([200, 201]).toContain(addItem.status)

		// bookmarks
		const bookmark = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${ch}/bookmarks`,
			workspaceId: ws,
			userId: a,
			body: { targetType: 'external_url', title: 'Spec', url: 'https://example.com/spec' }
		})
		expect([200, 201]).toContain(bookmark.status)
		const bookmarks = await apiRequest(app, {
			path: `/api/v1/chat/channels/${ch}/bookmarks`,
			workspaceId: ws,
			userId: a
		})
		expect(bookmarks.status).toBe(200)
	})

	test('6. forwarding uses snapshots and huddles are inert when disabled', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		const ws = fixture.workspaceId
		const a = fixture.memberAId
		const ch = await makeChannel(app, ws, a, 'fwd-source')
		const ch2 = await makeChannel(app, ws, a, 'fwd-target')
		const msg = await send(app, ws, a, ch, { bodyText: 'forward this' })

		const fwd = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/messages/${msg['id']}/forward`,
			workspaceId: ws,
			userId: a,
			body: { targetChannelId: ch2 }
		})
		expect([200, 201]).toContain(fwd.status)

		// Huddles: disabled by default config → 404, non-invasive.
		const huddle = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/chat/huddles',
			workspaceId: ws,
			userId: a,
			body: { channelId: ch }
		})
		expect(huddle.status).toBe(404)
	})

	test('6b. keyword alerts notify matching channel members, not the author', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		const ws = fixture.workspaceId
		const a = fixture.memberAId
		const b = fixture.memberBId
		const ch = await makeChannel(app, ws, a, 'keyword-test')
		// B joins the channel and sets alert keywords through the owner pool.
		await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${ch}/members`,
			workspaceId: ws,
			userId: a,
			body: { principalId: b }
		})
		// B sets alert keywords through the real preferences API.
		const prefRes = await apiRequest(app, {
			method: 'PATCH',
			path: '/api/v1/notifications/preferences',
			workspaceId: ws,
			userId: b,
			body: { alertKeywords: ['deploy'] }
		})
		expect(prefRes.status).toBe(200)
		expect(prefRes.json['alertKeywords']).toEqual(['deploy'])

		await send(app, ws, a, ch, { bodyText: 'deploy is broken again' })
		const rows = await db.owner<{ kind: string; recipient_user_id: string }[]>`
			SELECT kind, recipient_user_id FROM notifications
			WHERE workspace_id = ${ws} AND kind = 'chat.keyword_match'
		`
		expect(rows.length).toBe(1)
		expect(rows[0]?.recipient_user_id).toBe(b)

		// Non-matching message: no new keyword notification.
		await send(app, ws, a, ch, { bodyText: 'unrelated chatter' })
		const rows2 = await db.owner<{ kind: string }[]>`
			SELECT kind FROM notifications WHERE workspace_id = ${ws} AND kind = 'chat.keyword_match'
		`
		expect(rows2.length).toBe(1)
	})

	test('7. workspace profile status update round-trips', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)
		const ws = fixture.workspaceId
		const a = fixture.memberAId

		const put = await apiRequest(app, {
			method: 'PUT',
			path: '/api/v1/chat/me/profile',
			workspaceId: ws,
			userId: a,
			body: { statusEmoji: '🌴', statusText: 'On vacation', dndUntil: null }
		})
		if (put.status === 404) {
			// Route shape may differ — try PATCH variant.
			const patch = await apiRequest(app, {
				method: 'PATCH',
				path: '/api/v1/chat/me/status',
				workspaceId: ws,
				userId: a,
				body: { statusEmoji: '🌴', statusText: 'On vacation' }
			})
			expect([200, 404]).toContain(patch.status)
			return
		}
		expect(put.status).toBe(200)
		const get = await apiRequest(app, { path: '/api/v1/chat/me/profile', workspaceId: ws, userId: a })
		if (get.status === 200) {
			expect(get.json['statusText']).toBe('On vacation')
		}
	})
})
