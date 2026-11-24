import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { activateI18n, t } from '@huriro/i18n'
import type { SqliteDatabaseLike } from '@huriro/sync-client'
import { HuriroMobileApiClient } from '../lib/api-client'
import { createMemorySecureKvStore, MobileAuthStore } from '../lib/auth-store'
import { parseHuriroDeepLink } from '../lib/deep-links'
import { resolvePushHintTarget } from '../lib/push'
import { bootstrapMobileRuntime, MOBILE_PREVIEW_PROJ_ID } from '../lib/workspace-bootstrap'

activateI18n('en')

function createInMemorySqliteAdapter(): SqliteDatabaseLike {
	const db = new Database(':memory:')
	return {
		async execAsync(source) {
			db.run(source)
		},
		async getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null> {
			const row = db.query(source).get(...(params as [string | number | bigint | boolean | null]))
			return (row as T | null) ?? null
		},
		async getAllAsync<T>(source: string, ...params: unknown[]): Promise<T[]> {
			return db.query(source).all(...(params as [string | number | bigint | boolean | null])) as T[]
		},
		async runAsync(source: string, ...params: unknown[]): Promise<unknown> {
			return db.query(source).run(...(params as [string | number | bigint | boolean | null]))
		}
	}
}

describe('Huriro mobile core (§18)', () => {
	test('parseHuriroDeepLink resolves custom scheme, universal links, and blocks unsafe URLs', () => {
		expect(parseHuriroDeepLink('huriro://issues/ENG-42')).toEqual({
			kind: 'issue',
			id: 'ENG-42',
			href: '/issue/ENG-42'
		})
		expect(parseHuriroDeepLink('https://app.huriro.dev/chat/ch_01abc')).toEqual({
			kind: 'chat',
			channelId: 'ch_01abc',
			href: '/chat/ch_01abc'
		})
		expect(parseHuriroDeepLink('/docs/engineering-handbook')).toEqual({
			kind: 'doc',
			slug: 'engineering-handbook',
			href: '/doc/engineering-handbook'
		})
		expect(parseHuriroDeepLink('huriro://mail/conv-9')).toEqual({
			kind: 'mail',
			conversationId: 'conv-9',
			href: '/mail/conv-9'
		})

		expect(parseHuriroDeepLink('javascript:alert(1)')).toBeNull()
		expect(parseHuriroDeepLink('file:///etc/passwd')).toBeNull()
		expect(parseHuriroDeepLink('huriro://issues/..')).toBeNull()
		expect(parseHuriroDeepLink('https://evil.test/unknown/123')).toBeNull()
	})

	test('resolvePushHintTarget maps hint-only push payloads without requiring body content', () => {
		expect(
			resolvePushHintTarget({
				notificationId: 'notif_1',
				deepLink: 'huriro://issues/ENG-9'
			})
		).toEqual({
			kind: 'issue',
			id: 'ENG-9',
			href: '/issue/ENG-9'
		})

		expect(
			resolvePushHintTarget({
				notificationId: 'notif_2',
				entityType: 'chat_channel',
				entityId: '0190a0b1-0000-7000-8000-000000000501'
			})
		).toEqual({
			kind: 'chat',
			channelId: '0190a0b1-0000-7000-8000-000000000501',
			href: '/chat/0190a0b1-0000-7000-8000-000000000501'
		})

		expect(resolvePushHintTarget({ deepLink: 'javascript:evil()' })).toBeNull()
	})

	test('MobileAuthStore persists and wipes session tokens cleanly', async () => {
		const store = new MobileAuthStore(createMemorySecureKvStore())
		expect(await store.loadSession()).toBeNull()
		await store.saveSession({
			serverUrl: 'https://huriro.example',
			token: 'tok_secret_123',
			workspaceId: '0190a0b1-0000-7000-8000-000000000001',
			userId: '0190a0b1-0000-7000-8000-000000000002',
			email: 'owner@huriro.rw',
			displayName: 'Owner'
		})
		const loaded = await store.loadSession()
		expect(loaded?.token).toBe('tok_secret_123')
		await store.clearSession()
		expect(await store.loadSession()).toBeNull()
	})

	test('bootstrapMobileRuntime persists offline SQLite issues across runtime restart', async () => {
		const dbAdapter = createInMemorySqliteAdapter()
		const rt1 = await bootstrapMobileRuntime({
			preview: true,
			sqliteDb: dbAdapter
		})
		expect(rt1.engine.getStatus().storageMode).toBe('sqlite')
		rt1.engine.setOnline(false)
		const created = await rt1.engine.createIssue({
			projectId: MOBILE_PREVIEW_PROJ_ID,
			title: 'Mobile offline SQLite issue'
		})
		expect(rt1.engine.getStatus().pendingCount).toBe(1)
		rt1.dispose()

		const rt2 = await bootstrapMobileRuntime({
			session: {
				serverUrl: 'http://localhost:3001',
				token: 'tok',
				workspaceId: rt1.engine.workspaceId,
				userId: rt1.engine.currentUserId,
				email: 'owner@huriro.rw',
				displayName: 'Owner'
			},
			sqliteDb: dbAdapter
		})
		// Offline before sync: previous SQLite replica + queued mutation rehydrate immediately.
		expect(rt2.engine.collections.issues.get(created.id)?.title).toBe('Mobile offline SQLite issue')
		expect(rt2.engine.getStatus().pendingCount).toBe(1)
		rt2.dispose()
	})

	test('HuriroMobileApiClient sends mobile headers and treats web-only billing notice safely', async () => {
		const seen: { url: string; headers: Headers; credentials: RequestCredentials | undefined }[] = []
		const api = new HuriroMobileApiClient({
			serverUrl: 'https://api.huriro.example',
			workspaceId: '0190a0b1-0000-7000-8000-000000000001',
			platform: 'android',
			getToken: () => 'mobile-bearer-token',
			fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
				seen.push({
					url: String(input),
					headers: new Headers(init?.headers),
					credentials: init?.credentials
				})
				return new Response(JSON.stringify({ code: 'billing_disabled', title: 'Disabled' }), {
					status: 404,
					headers: { 'content-type': 'application/json' }
				})
			}) as unknown as typeof fetch
		})

		const summary = await api.getBillingSummaryReadOnly()
		expect(summary).toBeNull()
		expect(seen[0]?.headers.get('x-huriro-client')).toBe('huriro-mobile')
		expect(seen[0]?.headers.get('x-huriro-platform')).toBe('android')
		expect(seen[0]?.headers.get('authorization')).toBe('Bearer mobile-bearer-token')
		expect(seen[0]?.credentials).toBe('omit')
		expect(t('settings.billing.web-only-mobile')).toContain('Huriro web app')
	})
})
