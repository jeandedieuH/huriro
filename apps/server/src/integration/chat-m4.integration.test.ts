/**
 * Real PostgreSQL 18 + FORCE RLS integration suite for Milestone M4 (Gate G4):
 *  1. Public/private channels, ACL grant/revoke, audited admin bypass, DM participant-only 403 (NO admin bypass)
 *  2. 500-message concurrent burst -> monotonic channel_seq 1..500, zero change_log rows, unread math + mark-read
 *  3. Thread triggers (reply_count / last_reply_at), reactions, edit/delete rev deltas, clientId dedupe
 *  4. Two-phase attachment quarantine: PNG metadata strip + CSP: sandbox download, EICAR 403, pending 409
 *  5. SSRF-safe OpenGraph unfurl + 169.254.169.254 block
 *  6. ACL-filtered rich links (issue:, doc:) without unauthorized title leakage
 *  7. Chat search indexing (#channel, type:message) + strict DM search isolation
 *  8. Notifications: fan-out, 5m collapsing, channel mute, quiet-hours email digest, Web Push 410 auto-revoke
 *  9. Slack & Jira importers: dry-run, execute, idempotent re-run, redirect mappings
 * 10. Outbound webhooks: one-time encrypted secret, HMAC signing, SSRF rejection, backoff retry + replay
 * 11. GitHub App two-way sync: raw HMAC webhook (401/202), echo-loop prevention, push_failed + manual retry
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { createHmac, generateKeyPairSync, randomUUID } from 'node:crypto'
import { withWorkspace } from '@huriro/db'
import type { TestDb } from '@huriro/test-utils'
import { verifyWebhookSignature } from '../api/crypto'
import type { DnsResolver } from '../api/egress'
import { type BlobStorage, MemoryBlobStorage } from '../modules/files'
import {
	type GithubApiClient,
	GithubSyncError,
	processPendingGithubWebhooksOnce
} from '../modules/integrations'
import { type EmailMessage, runEmailDigestOnce, sendWebPushToUser } from '../modules/notifications'
import { processDueWebhookDeliveriesOnce } from '../modules/webhooks'
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

function makeExampleResolver(): DnsResolver {
	return async (hostname) => {
		if (hostname === '127.0.0.1' || hostname === '169.254.169.254' || hostname === '10.0.0.5') {
			return [{ address: hostname, family: 4 }]
		}
		if (hostname === '::1') return [{ address: '::1', family: 6 }]
		if (hostname === 'localhost') return [{ address: '127.0.0.1', family: 4 }]
		return [{ address: '93.184.216.34', family: 4 }]
	}
}

function buildPngChunk(type: string, data: Uint8Array): Uint8Array {
	const buf = new Uint8Array(12 + data.byteLength)
	const view = new DataView(buf.buffer)
	view.setUint32(0, data.byteLength, false)
	for (let i = 0; i < 4; i++) buf[4 + i] = type.charCodeAt(i)
	buf.set(data, 8)
	// Dummy CRC (scanner inspects chunk lengths & types without failing on test CRC)
	view.setUint32(8 + data.byteLength, 0xdeadbeef, false)
	return buf
}

function buildTestPngWithTextChunk(commentText: string): Uint8Array {
	const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
	const ihdrData = new Uint8Array(13)
	ihdrData[3] = 1 // width = 1
	ihdrData[7] = 1 // height = 1
	ihdrData[8] = 8 // bit depth
	ihdrData[9] = 2 // RGB
	const ihdr = buildPngChunk('IHDR', ihdrData)
	const textChunk = buildPngChunk('tEXt', new TextEncoder().encode(`Comment\0${commentText}`))
	const idat = buildPngChunk(
		'IDAT',
		new Uint8Array([0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01])
	)
	const iend = buildPngChunk('IEND', new Uint8Array(0))

	const total = sig.byteLength + ihdr.byteLength + textChunk.byteLength + idat.byteLength + iend.byteLength
	const combined = new Uint8Array(total)
	let off = 0
	for (const part of [sig, ihdr, textChunk, idat, iend]) {
		combined.set(part, off)
		off += part.byteLength
	}
	return combined
}

function generateTestVapidKeys() {
	const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
	const jwk = publicKey.export({ format: 'jwk' })
	const x = Buffer.from(jwk.x ?? '', 'base64url')
	const y = Buffer.from(jwk.y ?? '', 'base64url')
	const uncompressed = Buffer.concat([Buffer.from([0x04]), x, y]).toString('base64url')
	return {
		publicKey: uncompressed,
		privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
		subject: 'mailto:alerts@huriro.local'
	}
}

describe('M4 chat, quarantine files, notifications, importers, webhooks & GitHub sync (PostgreSQL 18)', () => {
	const sharedBlobStorage: BlobStorage = new MemoryBlobStorage()
	test('1. public/private channel ACLs, admin bypass audit, and strict participant-only DM 403', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)

		const pubRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/chat/channels',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { kind: 'public', name: 'general-chat', topic: 'Open chat' }
		})
		expect(pubRes.status).toBe(201)
		const pubId = String(pubRes.json['id'])

		const privRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/chat/channels',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { kind: 'private', name: 'sec-incident', topic: 'Restricted' }
		})
		expect(privRes.status).toBe(201)
		const privId = String(privRes.json['id'])

		// Member B can read public channel, denied on private channel
		const bPub = await apiRequest(app, {
			path: `/api/v1/chat/channels/${pubId}`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId
		})
		expect(bPub.status).toBe(200)

		const bPrivDenied = await apiRequest(app, {
			path: `/api/v1/chat/channels/${privId}`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId
		})
		expect(bPrivDenied.status).toBe(403)

		// Grant read ACL -> Member B reads (200), still cannot post (403)
		const grantRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/acl',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: {
				resourceType: 'channel',
				resourceId: privId,
				principalType: 'user',
				principalId: fixture.memberBId,
				permission: 'read'
			}
		})
		expect(grantRes.status).toBe(200)
		const aclId = String(grantRes.json['id'])

		const bPrivRead = await apiRequest(app, {
			path: `/api/v1/chat/channels/${privId}/messages`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId
		})
		expect(bPrivRead.status).toBe(200)

		const bPrivPostDenied = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${privId}/messages`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId,
			body: { bodyText: 'Should not post with read ACL' }
		})
		expect(bPrivPostDenied.status).toBe(403)

		// Revoke ACL -> denied again
		const revokeRes = await apiRequest(app, {
			method: 'DELETE',
			path: `/api/v1/acl/${aclId}`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		expect(revokeRes.status).toBe(200)

		const bPrivAfterRevoke = await apiRequest(app, {
			path: `/api/v1/chat/channels/${privId}`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId
		})
		expect(bPrivAfterRevoke.status).toBe(403)

		// Admin audited bypass on private channel writes audit_log
		const adminPriv = await apiRequest(app, {
			path: `/api/v1/chat/channels/${privId}`,
			workspaceId: fixture.workspaceId,
			userId: fixture.adminId
		})
		expect(adminPriv.status).toBe(200)

		const audits = await withWorkspace(
			db.app,
			{ workspaceId: fixture.workspaceId },
			(tx) =>
				tx<{ action: string; targetId: string }[]>`
				SELECT action, target_id::text AS "targetId"
				FROM audit_log
				WHERE workspace_id = ${fixture.workspaceId}
					AND actor_id = ${fixture.adminId}
					AND target_id = ${privId}
			`
		)
		expect(audits.some((a) => a.action === 'policy.admin_bypass.channel.read')).toBe(true)

		// DM between memberA and memberB: owner & admin receive strict 403 (NO admin bypass)
		const dmRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/chat/dms',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { memberIds: [fixture.memberBId] }
		})
		expect(dmRes.status).toBe(201)
		const dmId = String(dmRes.json['id'])

		await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${dmId}/messages`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { bodyText: 'Strict participant-only DM note' }
		})

		for (const nonParticipant of [fixture.ownerId, fixture.adminId, fixture.outsiderId]) {
			const detail = await apiRequest(app, {
				path: `/api/v1/chat/channels/${dmId}`,
				workspaceId: fixture.workspaceId,
				userId: nonParticipant
			})
			expect(detail.status).toBe(403)

			const msgs = await apiRequest(app, {
				path: `/api/v1/chat/channels/${dmId}/messages`,
				workspaceId: fixture.workspaceId,
				userId: nonParticipant
			})
			expect(msgs.status).toBe(403)

			const changes = await apiRequest(app, {
				path: `/api/v1/chat/channels/${dmId}/changes?since=0`,
				workspaceId: fixture.workspaceId,
				userId: nonParticipant
			})
			expect(changes.status).toBe(403)
		}

		// Owner's channel listing must NOT expose DMs they aren't a member of
		const ownerList = await apiRequest(app, {
			path: '/api/v1/chat/channels',
			workspaceId: fixture.workspaceId,
			userId: fixture.ownerId
		})
		const listedIds = ((ownerList.json['data'] ?? []) as { id: string }[]).map((c) => c.id)
		expect(listedIds).not.toContain(dmId)
	})

	test('2. 500-message concurrent burst allocates contiguous 1..500 seqs with ZERO change_log rows & exact unreads', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)

		const chanRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/chat/channels',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { kind: 'public', name: 'burst-feed', topic: 'Partitioned sync test' }
		})
		expect(chanRes.status).toBe(201)
		const channelId = String(chanRes.json['id'])

		await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${channelId}/members`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { principalId: fixture.memberBId }
		})

		const [beforeChangeRow] = await withWorkspace(
			db.app,
			{ workspaceId: fixture.workspaceId },
			(tx) =>
				tx<
					{ count: number }[]
				>`SELECT count(*)::int AS count FROM change_log WHERE workspace_id = ${fixture.workspaceId}`
		)
		const beforeChangeCount = beforeChangeRow?.count ?? 0

		const seqs: number[] = []
		const TOTAL = 500
		const BATCH = 25
		for (let start = 0; start < TOTAL; start += BATCH) {
			const batch = Array.from({ length: BATCH }, (_, j) => {
				const idx = start + j
				return apiRequest(app, {
					method: 'POST',
					path: `/api/v1/chat/channels/${channelId}/messages`,
					workspaceId: fixture.workspaceId,
					userId: fixture.memberAId,
					body: {
						clientId: `burst-${idx}`,
						bodyText: `Burst msg #${idx}`
					}
				})
			})
			const results = await Promise.all(batch)
			for (const res of results) {
				expect(res.status).toBe(201)
				seqs.push(Number(res.json['channelSeq']))
			}
		}

		// Strictly monotonic 1..500 with zero duplicates or gaps
		expect(seqs.length).toBe(500)
		const sorted = [...seqs].sort((a, b) => a - b)
		expect(new Set(sorted).size).toBe(500)
		expect(sorted[0]).toBe(1)
		expect(sorted[499]).toBe(500)

		// Zero rows written to workspace change_log during the 500-message burst
		const [afterChangeRow] = await withWorkspace(
			db.app,
			{ workspaceId: fixture.workspaceId },
			(tx) =>
				tx<
					{ count: number }[]
				>`SELECT count(*)::int AS count FROM change_log WHERE workspace_id = ${fixture.workspaceId}`
		)
		expect(afterChangeRow?.count ?? -1).toBe(beforeChangeCount)

		// Member B sees exact 500 unread, then mark-read clears to 0
		const bBefore = await apiRequest(app, {
			path: `/api/v1/chat/channels/${channelId}`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId
		})
		expect(bBefore.status).toBe(200)
		expect(bBefore.json['unreadCount']).toBe(500)
		expect(bBefore.json['hasUnread']).toBe(true)

		const markRes = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${channelId}/read`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId,
			body: { seq: 500 }
		})
		expect(markRes.status).toBe(200)
		expect(markRes.json['unreadCount']).toBe(0)

		const bAfter = await apiRequest(app, {
			path: `/api/v1/chat/channels/${channelId}`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId
		})
		expect(bAfter.json['unreadCount']).toBe(0)
		expect(bAfter.json['hasUnread']).toBe(false)
	}, 45_000)

	test('3. thread triggers, reactions, edits/deletes, incremental /changes?since=, and clientId dedupe', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)

		const chanRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/chat/channels',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { kind: 'public', name: 'threads-room', topic: 'Threads' }
		})
		const channelId = String(chanRes.json['id'])

		const root1 = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${channelId}/messages`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { clientId: 'dedupe-root-key', bodyText: 'Initial root discussion' }
		})
		expect(root1.status).toBe(201)
		const rootId = String(root1.json['id'])
		const initialRev = Number(root1.json['rev'])

		// Duplicate clientId returns 200 with identical message ID
		const rootDup = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${channelId}/messages`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { clientId: 'dedupe-root-key', bodyText: 'Initial root discussion' }
		})
		expect(rootDup.status).toBe(200)
		expect(rootDup.json['id']).toBe(rootId)

		// Thread replies maintain threadSeq & parent replyCount/lastReplyAt trigger
		const r1 = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${channelId}/messages`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId,
			body: { bodyText: 'First reply', threadParentId: rootId }
		})
		expect(r1.status).toBe(201)
		expect(r1.json['threadSeq']).toBe(1)

		const r2 = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${channelId}/messages`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId,
			body: { bodyText: 'Second reply', threadParentId: rootId }
		})
		expect(r2.status).toBe(201)
		expect(r2.json['threadSeq']).toBe(2)
		const r2Id = String(r2.json['id'])

		// Reactions & edit/delete
		const addReact = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/messages/${rootId}/reactions`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId,
			body: { emoji: '🚀' }
		})
		expect(addReact.status).toBe(200)
		expect((addReact.json['reactions'] as { emoji: string }[])[0]?.emoji).toBe('🚀')

		const delReact = await apiRequest(app, {
			method: 'DELETE',
			path: `/api/v1/chat/messages/${rootId}/reactions/${encodeURIComponent('🚀')}`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId
		})
		expect(delReact.status).toBe(200)
		expect((delReact.json['reactions'] as unknown[]).length).toBe(0)

		const editRoot = await apiRequest(app, {
			method: 'PATCH',
			path: `/api/v1/chat/messages/${rootId}`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { bodyText: 'Edited root discussion', version: Number(root1.json['version']) }
		})
		expect(editRoot.status).toBe(200)
		expect(editRoot.json['bodyText']).toBe('Edited root discussion')

		const delReply2 = await apiRequest(app, {
			method: 'DELETE',
			path: `/api/v1/chat/messages/${r2Id}`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId
		})
		expect(delReply2.status).toBe(200)

		// Thread view reflects trigger stats (1 non-deleted reply left)
		const threadRes = await apiRequest(app, {
			path: `/api/v1/chat/messages/${rootId}/thread`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		expect(threadRes.status).toBe(200)
		const parentDto = threadRes.json['parent'] as Record<string, unknown>
		expect(parentDto['replyCount']).toBe(1)
		expect(parentDto['lastReplyAt']).not.toBeNull()

		// Incremental delta feed since initialRev returns updated root + tombstoned r2
		const deltaRes = await apiRequest(app, {
			path: `/api/v1/chat/channels/${channelId}/changes?since=${initialRev}&limit=100`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId
		})
		expect(deltaRes.status).toBe(200)
		const deltaMsgs = deltaRes.json['changes'] as Record<string, unknown>[]
		expect(deltaMsgs.some((m) => m['id'] === rootId && m['bodyText'] === 'Edited root discussion')).toBe(true)
		expect(deltaMsgs.some((m) => m['id'] === r2Id && m['deletedAt'] !== null)).toBe(true)
		expect(Number(deltaRes.json['nextRev'])).toBeGreaterThan(initialRev)
	})

	test('4. two-phase quarantine: PNG metadata stripped + CSP: sandbox, EICAR -> 403, unfinalized -> 409', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db, { blobStorage: sharedBlobStorage })

		// (a) Unfinalized file -> 409 file_pending_scan
		const pendingInit = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/files/uploads',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { filename: 'draft.txt', contentType: 'text/plain', byteSize: 11 }
		})
		expect(pendingInit.status).toBe(201)
		const pendingId = String((pendingInit.json['file'] as Record<string, unknown>)['id'])

		const putPending = await app.handle(
			new Request(`http://localhost/api/v1/files/uploads/${pendingId}/content`, {
				method: 'PUT',
				headers: {
					'content-type': 'application/octet-stream',
					'x-workspace-id': fixture.workspaceId,
					'x-test-user-id': fixture.memberAId,
					'x-huriro-client': 'huriro-test'
				},
				body: Buffer.from('hello draft')
			})
		)
		expect(putPending.status).toBe(200)

		const pendingDownload = await apiRequest(app, {
			path: `/api/v1/files/${pendingId}/download`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		expect(pendingDownload.status).toBe(409)

		// (b) EICAR malware payload -> finalize marks infected, download returns 403
		const eicarBytes = Buffer.from(
			`${'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-'}ANTIVIRUS-TEST-FILE!$H+H*`
		)
		const eicarInit = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/files/uploads',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { filename: 'eicar.txt', contentType: 'text/plain', byteSize: eicarBytes.byteLength }
		})
		const eicarId = String((eicarInit.json['file'] as Record<string, unknown>)['id'])

		await app.handle(
			new Request(`http://localhost/api/v1/files/uploads/${eicarId}/content`, {
				method: 'PUT',
				headers: {
					'content-type': 'application/octet-stream',
					'x-workspace-id': fixture.workspaceId,
					'x-test-user-id': fixture.memberAId,
					'x-huriro-client': 'huriro-test'
				},
				body: eicarBytes
			})
		)
		const eicarFin = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/files/${eicarId}/finalize`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		expect(eicarFin.status).toBe(200)
		expect(eicarFin.json['scanStatus']).toBe('infected')

		const eicarDownload = await apiRequest(app, {
			path: `/api/v1/files/${eicarId}/download`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		expect(eicarDownload.status).toBe(403)

		// (c) Valid PNG with tEXt metadata chunk -> stripped & promoted, downloadable with CSP: sandbox + nosniff
		const pngWithMeta = buildTestPngWithTextChunk('SecretGPSLocation=40.7128,-74.0060')
		const pngInit = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/files/uploads',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { filename: 'photo.png', contentType: 'image/png', byteSize: pngWithMeta.byteLength }
		})
		const pngId = String((pngInit.json['file'] as Record<string, unknown>)['id'])

		await app.handle(
			new Request(`http://localhost/api/v1/files/uploads/${pngId}/content`, {
				method: 'PUT',
				headers: {
					'content-type': 'application/octet-stream',
					'x-workspace-id': fixture.workspaceId,
					'x-test-user-id': fixture.memberAId,
					'x-huriro-client': 'huriro-test'
				},
				body: Buffer.from(pngWithMeta)
			})
		)
		const pngFin = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/files/${pngId}/finalize`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		expect(pngFin.status).toBe(200)
		expect(pngFin.json['reencoded']).toBe(true)
		expect(pngFin.json['contentType']).toBe('image/png')

		const dlRes = await app.handle(
			new Request(`http://localhost/api/v1/files/${pngId}/download`, {
				headers: {
					'x-workspace-id': fixture.workspaceId,
					'x-test-user-id': fixture.memberBId,
					'x-huriro-client': 'huriro-test'
				}
			})
		)
		expect(dlRes.status).toBe(200)
		expect(dlRes.headers.get('content-security-policy')).toBe('sandbox')
		expect(dlRes.headers.get('x-content-type-options')).toBe('nosniff')
		const downloadedText = Buffer.from(await dlRes.arrayBuffer()).toString('latin1')
		expect(downloadedText.includes('SecretGPSLocation')).toBe(false)
	})

	test('5. SSRF-safe OpenGraph unfurl populates public previews and blocks 169.254.169.254', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const fetchedUrls: string[] = []
		const mockFetch = (async (input: string | URL | Request) => {
			const u = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
			fetchedUrls.push(u)
			return new Response(
				'<html><head><title>Huriro Guide</title><meta property="og:title" content="Huriro Architecture Guide"><meta property="og:description" content="SSRF verified"></head></html>',
				{ status: 200, headers: { 'content-type': 'text/html' } }
			)
		}) as unknown as typeof fetch

		const { app, pubsub, blobStorage, rootSecret } = createIntegrationServer(db, {
			blobStorage: sharedBlobStorage,
			egressFetch: mockFetch,
			egressResolver: makeExampleResolver()
		})

		const chanRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/chat/channels',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { kind: 'public', name: 'links-room', topic: 'Previews' }
		})
		const channelId = String(chanRes.json['id'])

		await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${channelId}/messages`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: {
				bodyText: 'Read https://docs.example.com/arch and check http://169.254.169.254/latest/meta-data'
			}
		})

		await drainOutboxOnce(db.app, pubsub, {
			blobStorage,
			rootSecret,
			egressFetch: mockFetch,
			egressResolver: makeExampleResolver(),
			onlyWorkspaceId: fixture.workspaceId
		})

		// Metadata IP was NEVER fetched
		expect(fetchedUrls.some((u) => u.includes('169.254.169.254'))).toBe(false)
		expect(fetchedUrls.some((u) => u.includes('docs.example.com/arch'))).toBe(true)

		const msgsRes = await apiRequest(app, {
			path: `/api/v1/chat/channels/${channelId}/messages`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId
		})
		const msg = ((msgsRes.json['data'] ?? []) as Record<string, unknown>[])[0]!
		const previews = (msg['linkPreviews'] ?? []) as { url: string; status: string; title: string }[]
		const okPreview = previews.find((p) => p.url.includes('docs.example.com'))
		const blockedPreview = previews.find((p) => p.url.includes('169.254.169.254'))
		expect(okPreview?.status).toBe('ok')
		expect(okPreview?.title).toBe('Huriro Architecture Guide')
		expect(blockedPreview?.status).toBe('blocked')
	}, 20_000)

	test('6. ACL-filtered rich links (issue:, doc:) omit private metadata for unauthorized viewers', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)

		const privProj = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/projects',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { key: 'VAULT', name: 'Private Vault', visibility: 'private' }
		})
		const privIssue = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/issues',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			headers: { 'idempotency-key': randomUUID() },
			body: { projectId: String(privProj.json['id']), title: 'Secret Private Bug' }
		})
		const issueKey = String(privIssue.json['identifier'])

		const privDoc = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/docs',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			headers: { 'idempotency-key': randomUUID() },
			body: { title: 'Confidential Runbook', visibility: 'private', markdown: '# Confidential' }
		})
		expect(privDoc.status).toBe(201)
		const docSlug = String(privDoc.json['slug'])

		const chanRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/chat/channels',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { kind: 'public', name: 'rich-link-room', topic: 'ACL check' }
		})
		const channelId = String(chanRes.json['id'])

		await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${channelId}/messages`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { bodyText: `See issue:${issueKey} and doc:${docSlug}` }
		})

		const viewerA = await apiRequest(app, {
			path: `/api/v1/chat/channels/${channelId}/messages`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		const msgForA = ((viewerA.json['data'] ?? []) as Record<string, unknown>[])[0]!
		expect((msgForA['richLinks'] as unknown[]).length).toBe(2)

		const viewerB = await apiRequest(app, {
			path: `/api/v1/chat/channels/${channelId}/messages`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId
		})
		const msgForB = ((viewerB.json['data'] ?? []) as Record<string, unknown>[])[0]!
		expect((msgForB['richLinks'] as unknown[]).length).toBe(0)
	})

	test('7. chat search indexing (#channel & type:message) and strict DM search isolation', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app, pubsub, blobStorage, rootSecret } = createIntegrationServer(db, {
			blobStorage: sharedBlobStorage
		})

		const pubChan = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/chat/channels',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { kind: 'public', name: 'ops-search', topic: 'Public' }
		})
		const privChan = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/chat/channels',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { kind: 'private', name: 'priv-search', topic: 'Private' }
		})
		const dmChan = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/chat/dms',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { memberIds: [fixture.memberBId] }
		})
		expect(dmChan.status).toBe(201)

		const pubMsgRes = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${pubChan.json['id']}/messages`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { bodyText: 'Kafka public partition drill' }
		})
		expect(pubMsgRes.status).toBe(201)
		const privMsgRes = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${privChan.json['id']}/messages`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { bodyText: 'Kafka private key rotation' }
		})
		expect(privMsgRes.status).toBe(201)
		const dmMsgRes = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${dmChan.json['id']}/messages`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { bodyText: 'Kafka secret compensation DM' }
		})
		expect(dmMsgRes.status).toBe(201)
		const dmMsgId = String(dmMsgRes.json['id'])
		const privMsgId = String(privMsgRes.json['id'])

		await drainOutboxOnce(db.app, pubsub, { blobStorage, rootSecret, onlyWorkspaceId: fixture.workspaceId })

		// Member A finds #ops-search + type:message
		const aChannelSearch = await apiRequest(app, {
			path: `/api/v1/search?q=${encodeURIComponent('type:message #ops-search Kafka')}`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		expect(aChannelSearch.status).toBe(200)
		const aChannelHits = (aChannelSearch.json['hits'] ?? []) as { entityId: string; title: string }[]
		expect(aChannelHits.some((h) => h.title.includes('ops-search'))).toBe(true)

		// Member B sees public + DM, NEVER private channel
		const bSearch = await apiRequest(app, {
			path: `/api/v1/search?q=${encodeURIComponent('type:message Kafka')}`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId
		})
		const bHits = (bSearch.json['hits'] ?? []) as {
			entityId: string
			channelId?: string | null
			title: string
			snippet: string
		}[]
		// Assert on entityId: ts_headline snippets can truncate trailing words.
		expect(bHits.some((h) => h.snippet.includes('public partition'))).toBe(true)
		expect(bHits.some((h) => h.entityId === dmMsgId)).toBe(true)
		expect(bHits.some((h) => h.entityId === privMsgId)).toBe(false)

		// Workspace owner (NOT in DM) MUST NEVER see DM hit via search
		const ownerSearch = await apiRequest(app, {
			path: `/api/v1/search?q=${encodeURIComponent('Kafka')}`,
			workspaceId: fixture.workspaceId,
			userId: fixture.ownerId
		})
		const ownerHits = (ownerSearch.json['hits'] ?? []) as { entityId: string; snippet: string }[]
		expect(ownerHits.some((h) => h.entityId === dmMsgId)).toBe(false)
	})

	test('8. notifications collapsing, channel mute, quiet-hours email digest & Web Push 410 revocation', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const resolver = makeExampleResolver()
		const vapid = generateTestVapidKeys()
		const { app, pubsub, blobStorage, rootSecret } = createIntegrationServer(db, {
			blobStorage: sharedBlobStorage,
			vapid,
			egressResolver: resolver
		})

		// Member B sets daily email digest + quiet hours 22:00..07:00 UTC + webPushEnabled
		const prefRes = await apiRequest(app, {
			method: 'PATCH',
			path: '/api/v1/notifications/preferences',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId,
			body: {
				chatLevel: 'all',
				emailDigestFrequency: 'daily',
				quietHoursStart: '22:00',
				quietHoursEnd: '07:00',
				timezone: 'UTC',
				webPushEnabled: true
			}
		})
		expect(prefRes.status).toBe(200)

		const chanRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/chat/channels',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { kind: 'public', name: 'alerts', topic: 'Alerting' }
		})
		const channelId = String(chanRes.json['id'])
		await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${channelId}/members`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { principalId: fixture.memberBId }
		})

		// Two consecutive mentions collapse within 5m
		const bHandle = fixture.memberBEmail.split('@')[0]!
		await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${channelId}/messages`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { bodyText: `First alert @${bHandle}` }
		})
		await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${channelId}/messages`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { bodyText: `Second alert @${bHandle}` }
		})
		await drainOutboxOnce(db.app, pubsub, {
			blobStorage,
			rootSecret,
			vapid,
			egressResolver: resolver,
			onlyWorkspaceId: fixture.workspaceId
		})

		const notifRes = await apiRequest(app, {
			path: '/api/v1/notifications?unreadOnly=true',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId
		})
		expect(notifRes.status).toBe(200)
		const notifs = (notifRes.json['data'] ?? []) as {
			id: string
			kind: string
			metadata: Record<string, unknown>
		}[]
		const collapsed = notifs.find((n) => n.kind === 'chat.mentioned')
		expect(collapsed).toBeDefined()
		expect(collapsed?.metadata['collapsedCount']).toBe(2)

		// Quiet-hours check: 23:30 UTC skipped; 10:00 UTC sent
		const sentEmails: EmailMessage[] = []
		const mockTransport = {
			async send(msg: EmailMessage) {
				sentEmails.push(msg)
			}
		}
		const quietRun = await runEmailDigestOnce(db.app, {
			nowUtcIso: '2026-11-23T23:30:00Z',
			transport: mockTransport
		})
		expect(quietRun.skippedQuietHours).toBeGreaterThanOrEqual(1)
		expect(quietRun.sent).toBe(0)

		const activeRun = await runEmailDigestOnce(db.app, {
			nowUtcIso: '2026-11-23T10:00:00Z',
			transport: mockTransport
		})
		expect(activeRun.sent).toBeGreaterThanOrEqual(1)
		expect(sentEmails.some((e) => e.to === fixture.memberBEmail)).toBe(true)

		// Muting channel suppresses subsequent non-mention replies/messages
		await apiRequest(app, {
			method: 'PATCH',
			path: `/api/v1/chat/channels/${channelId}/mute`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId,
			body: { muted: true }
		})
		await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/notifications/${collapsed!.id}/read`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId
		})
		await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/chat/channels/${channelId}/messages`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { bodyText: 'Non-mention noise after mute' }
		})
		await drainOutboxOnce(db.app, pubsub, { blobStorage, rootSecret, onlyWorkspaceId: fixture.workspaceId })

		const afterMute = await apiRequest(app, {
			path: '/api/v1/notifications?unreadOnly=true',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId
		})
		expect((afterMute.json['data'] as unknown[]).length).toBe(0)

		// Web Push subscription auto-revokes on 410 Gone
		const subRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/notifications/push/subscriptions',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId,
			body: {
				endpoint: 'https://fcm.push.example.org/wp/send/abc123',
				keys: {
					p256dh: 'test-p256dh-key-material-000001',
					auth: 'test-auth-secret-000001'
				},
				userAgent: 'TestAgent/1.0'
			}
		})
		expect(subRes.status).toBe(201)

		const pushOutcome = await withWorkspace(db.app, { workspaceId: fixture.workspaceId }, (tx) =>
			sendWebPushToUser(tx, fixture.workspaceId, fixture.memberBId, collapsed as never, {
				vapid,
				resolver,
				fetchImpl: (async () => new Response('Gone', { status: 410 })) as unknown as typeof fetch
			})
		)
		expect(pushOutcome.revoked).toBe(1)

		const listSubsAfter = await apiRequest(app, {
			path: '/api/v1/notifications/push/subscriptions',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId
		})
		expect((listSubsAfter.json as unknown as unknown[]).length).toBe(0)
	})

	test('9. Slack & Jira importers: dry-run, execute, idempotent re-run, and redirect mappings', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const { app } = createIntegrationServer(db)

		const slackPayload = {
			users: [{ id: 'U1', name: 'ada', email: fixture.memberAEmail }],
			channels: [{ id: 'C99', name: 'imported-ops', topic: 'Migrated from Slack' }],
			messagesByChannel: {
				C99: [
					{ ts: '1700000001.000100', user: 'U1', text: 'Parent Slack post' },
					{ ts: '1700000002.000200', threadTs: '1700000001.000100', user: 'U1', text: 'Slack reply' }
				]
			}
		}

		// Non-admin member cannot run imports
		const memberForbidden = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/imports/dry-run',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { source: 'slack', slack: slackPayload }
		})
		expect(memberForbidden.status).toBe(403)

		const slackDry = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/imports/dry-run',
			workspaceId: fixture.workspaceId,
			userId: fixture.adminId,
			body: { source: 'slack', slack: slackPayload }
		})
		expect(slackDry.status).toBe(200)
		expect((slackDry.json['counts'] as Record<string, unknown>)['channels']).toBe(1)
		expect((slackDry.json['counts'] as Record<string, unknown>)['threads']).toBe(1)

		const slackExec1 = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/imports/execute',
			workspaceId: fixture.workspaceId,
			userId: fixture.adminId,
			body: { source: 'slack', slack: slackPayload }
		})
		expect(slackExec1.status).toBe(200)
		expect((slackExec1.json['report'] as Record<string, unknown>)['importedChannels']).toBe(1)

		const slackExec2 = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/imports/execute',
			workspaceId: fixture.workspaceId,
			userId: fixture.adminId,
			body: { source: 'slack', slack: slackPayload }
		})
		expect(slackExec2.status).toBe(200)
		expect(Number((slackExec2.json['report'] as Record<string, unknown>)['skippedMessages'])).toBe(2)

		// Jira CSV import & redirect resolution
		const jiraCsv = [
			'Issue key,Summary,Description,Priority,Status',
			'JOPS-42,"Rotate KMS keys, quarterly","Verify rotation script",High,Todo'
		].join('\n')

		const jiraDry = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/imports/dry-run',
			workspaceId: fixture.workspaceId,
			userId: fixture.adminId,
			body: { source: 'jira', jira: { projectKey: 'OPS', projectName: 'Operations', csv: jiraCsv } }
		})
		expect(jiraDry.status).toBe(200)
		expect((jiraDry.json['counts'] as Record<string, unknown>)['issues']).toBe(1)

		const jiraExec = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/imports/execute',
			workspaceId: fixture.workspaceId,
			userId: fixture.adminId,
			body: { source: 'jira', jira: { projectKey: 'OPS', projectName: 'Operations', csv: jiraCsv } }
		})
		expect(jiraExec.status).toBe(200)
		expect((jiraExec.json['report'] as Record<string, unknown>)['importedIssues']).toBe(1)

		const redirectRes = await apiRequest(app, {
			path: '/api/v1/imports/redirect/JOPS-42',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId
		})
		expect(redirectRes.status).toBe(200)
		expect(redirectRes.json['localType']).toBe('issue')

		const byKeyRes = await apiRequest(app, {
			path: '/api/v1/issues/by-key/JOPS-42',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberBId
		})
		expect(byKeyRes.status).toBe(200)
		expect(byKeyRes.json['redirectedFrom']).toBe('JOPS-42')
	})

	test('10. outbound webhooks: one-time encrypted secret, HMAC signing, SSRF rejection, retry + manual replay', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		const resolver = makeExampleResolver()
		const { app, pubsub, blobStorage, rootSecret } = createIntegrationServer(db, {
			blobStorage: sharedBlobStorage,
			egressResolver: resolver
		})

		// SSRF target rejected with 422
		const ssrfRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/webhooks',
			workspaceId: fixture.workspaceId,
			userId: fixture.ownerId,
			body: { name: 'Bad Internal Hook', url: 'http://127.0.0.1/hook', events: ['tasks.issue.created.v1'] }
		})
		expect(ssrfRes.status).toBe(422)

		// Valid hook returns signingSecret once
		const createRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/webhooks',
			workspaceId: fixture.workspaceId,
			userId: fixture.ownerId,
			body: { name: 'CI Hook', url: 'https://hooks.example.com/ingest', events: ['tasks.issue.created.v1'] }
		})
		expect(createRes.status).toBe(201)
		const signingSecret = String(createRes.json['signingSecret'])
		const epId = String((createRes.json['endpoint'] as Record<string, unknown>)['id'])
		expect(signingSecret.startsWith('whsec_')).toBe(true)

		// GET list NEVER exposes plaintext signingSecret
		const listRes = await apiRequest(app, {
			path: '/api/v1/webhooks',
			workspaceId: fixture.workspaceId,
			userId: fixture.ownerId
		})
		expect(JSON.stringify(listRes.json)).not.toContain(signingSecret)

		// Create project + issue to trigger `tasks.issue.created.v1`
		const projRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/projects',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { key: 'HOOK', name: 'Webhook Proj', visibility: 'workspace' }
		})
		await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/issues',
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			headers: { 'idempotency-key': randomUUID() },
			body: { projectId: String(projRes.json['id']), title: 'Trigger hook delivery' }
		})
		await drainOutboxOnce(db.app, pubsub, { blobStorage, rootSecret, onlyWorkspaceId: fixture.workspaceId })

		// First attempt returns 500 -> transitions to `retrying` & validates HMAC signature
		let capturedSig = ''
		let capturedBody = ''
		const failFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
			capturedSig = new Headers(init?.headers).get('x-huriro-signature') ?? ''
			capturedBody = typeof init?.body === 'string' ? init.body : ''
			return new Response('Upstream error', { status: 500 })
		}) as unknown as typeof fetch

		const attempt1 = await processDueWebhookDeliveriesOnce(db.app, {
			rootSecret,
			resolver,
			fetchImpl: failFetch
		})
		expect(attempt1.retrying).toBe(1)
		expect(verifyWebhookSignature(signingSecret, capturedSig, capturedBody)).toBe(true)

		const delsRes = await apiRequest(app, {
			path: `/api/v1/webhooks/${epId}/deliveries`,
			workspaceId: fixture.workspaceId,
			userId: fixture.ownerId
		})
		const delivery = ((delsRes.json['data'] ?? []) as Record<string, unknown>[])[0]!
		expect(delivery['status']).toBe('retrying')

		// Replay via API (with 200 OK mock server on test app instance)
		const { app: replayApp } = createIntegrationServer(db, {
			rootSecret,
			egressResolver: resolver,
			egressFetch: (async () => new Response('ok', { status: 200 })) as unknown as typeof fetch
		})
		const replayRes = await apiRequest(replayApp, {
			method: 'POST',
			path: `/api/v1/webhooks/deliveries/${delivery['id']}/replay`,
			workspaceId: fixture.workspaceId,
			userId: fixture.ownerId
		})
		expect(replayRes.status).toBe(200)
		expect(replayRes.json['status']).toBe('delivered')
	})

	test('11. GitHub App two-way sync: raw HMAC 401/202, echo-loop prevention, push_failed & manual retry', async () => {
		if (!db) return
		const fixture = await seedM1Fixture(db.owner)
		let updateCalls = 0
		let shouldFailRateLimit = false

		const mockGithub: GithubApiClient = {
			async updateIssue(args) {
				updateCalls++
				if (shouldFailRateLimit) {
					throw new GithubSyncError('GitHub API rate limit reached (HTTP 429)', 429, true)
				}
				return {
					number: args.issueNumber,
					htmlUrl: `https://github.com/${args.repoFullName}/issues/${args.issueNumber}`
				}
			},
			async createComment(args) {
				return {
					id: 1,
					htmlUrl: `https://github.com/${args.repoFullName}/issues/${args.issueNumber}#issuecomment-1`
				}
			}
		}

		const { app, pubsub, blobStorage, rootSecret } = createIntegrationServer(db, {
			blobStorage: sharedBlobStorage,
			githubClient: mockGithub
		})

		const projRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/projects',
			workspaceId: fixture.workspaceId,
			userId: fixture.ownerId,
			body: { key: 'GH', name: 'GitHub Synced', visibility: 'workspace' }
		})
		const projectId = String(projRes.json['id'])

		const ghWebhookSecret = 'github-app-webhook-secret-987654'
		const instRes = await apiRequest(app, {
			method: 'POST',
			path: '/api/v1/integrations/github/installations',
			workspaceId: fixture.workspaceId,
			userId: fixture.ownerId,
			body: {
				installationId: 77001,
				accountLogin: 'acme',
				repoFullName: 'acme/huriro',
				projectId,
				webhookSecret: ghWebhookSecret,
				accessToken: 'ghs_test_token_123456',
				syncEnabled: true
			}
		})
		expect(instRes.status).toBe(201)

		const webhookPayload = JSON.stringify({
			action: 'opened',
			installation: { id: 77001 },
			repository: { full_name: 'acme/huriro' },
			issue: {
				id: 55001,
				number: 18,
				title: 'Enable mTLS on worker pool',
				body: 'Roll out certificates across nodes',
				state: 'open',
				html_url: 'https://github.com/acme/huriro/issues/18'
			},
			sender: { login: 'octocat' }
		})

		// Bad signature rejected with 401
		const badSigRes = await app.handle(
			new Request('http://localhost/api/v1/integrations/github/webhook', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-github-event': 'issues',
					'x-github-delivery': randomUUID(),
					'x-hub-signature-256': 'sha256=' + '0'.repeat(64)
				},
				body: webhookPayload
			})
		)
		expect(badSigRes.status).toBe(401)

		// Valid raw-body signature returns 202
		const validSig = `sha256=${createHmac('sha256', ghWebhookSecret).update(webhookPayload, 'utf8').digest('hex')}`
		const okRes = await app.handle(
			new Request('http://localhost/api/v1/integrations/github/webhook', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-github-event': 'issues',
					'x-github-delivery': randomUUID(),
					'x-hub-signature-256': validSig
				},
				body: webhookPayload
			})
		)
		expect(okRes.status).toBe(202)

		// Inbound worker imports issue + runs outbox without echoing back to GitHub
		const inboundRes = await processPendingGithubWebhooksOnce(db.app, { rootSecret, pubsub })
		expect(inboundRes.processed).toBe(1)

		await drainOutboxOnce(db.app, pubsub, {
			blobStorage,
			rootSecret,
			githubClient: mockGithub,
			onlyWorkspaceId: fixture.workspaceId
		})
		expect(updateCalls).toBe(0)

		const issuesRes = await apiRequest(app, {
			path: `/api/v1/issues?projectId=${projectId}`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		const syncedIssue = ((issuesRes.json['data'] ?? []) as Record<string, unknown>[])[0]!
		const issueId = String(syncedIssue['id'])

		// Huriro edit pushes out once
		const patchOk = await apiRequest(app, {
			method: 'PATCH',
			path: `/api/v1/issues/${issueId}`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { title: 'Enable mTLS across worker pool v2', version: Number(syncedIssue['version']) }
		})
		expect(patchOk.status).toBe(200)
		await drainOutboxOnce(db.app, pubsub, {
			blobStorage,
			rootSecret,
			githubClient: mockGithub,
			onlyWorkspaceId: fixture.workspaceId
		})
		expect(updateCalls).toBe(1)

		// Rate-limited push surfaces `push_failed`, manual retry succeeds once recovered
		shouldFailRateLimit = true
		const patchFail = await apiRequest(app, {
			method: 'PATCH',
			path: `/api/v1/issues/${issueId}`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId,
			body: { title: 'Enable mTLS v3', version: Number(patchOk.json['version']) }
		})
		expect(patchFail.status).toBe(200)
		await drainOutboxOnce(db.app, pubsub, {
			blobStorage,
			rootSecret,
			githubClient: mockGithub,
			onlyWorkspaceId: fixture.workspaceId
		})

		const linksAfterFail = await apiRequest(app, {
			path: `/api/v1/issues/${issueId}/github-links`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		const link = ((linksAfterFail.json['data'] ?? []) as Record<string, unknown>[])[0]!
		expect(link['syncState']).toBe('push_failed')
		expect(String(link['lastSyncError'])).toContain('429')

		shouldFailRateLimit = false
		const retryRes = await apiRequest(app, {
			method: 'POST',
			path: `/api/v1/integrations/github/links/${link['id']}/retry`,
			workspaceId: fixture.workspaceId,
			userId: fixture.memberAId
		})
		expect(retryRes.status).toBe(200)
		expect(retryRes.json['syncState']).toBe('synced')
	})
})
