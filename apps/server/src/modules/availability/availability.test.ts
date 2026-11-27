import { describe, expect, test } from 'bun:test'
import type { Queryable } from '@huriro/db'
import type { ActorContext } from '@huriro/domain'
import { HttpError } from '../../api/error'
import { getProfileRow, getWindowRow, listWindows, upsertProfileRow } from './repo'
import {
	createAvailabilityWindow,
	deleteAvailabilityWindow,
	updateAvailabilityWindow,
	updateMyAvailability
} from './service'

const WS_ID = '0190a0b1-0000-7000-8000-000000000001'
const USER_A = '0190a0b1-0000-7000-8000-000000000002'
const USER_B = '0190a0b1-0000-7000-8000-000000000003'
const WINDOW_ID = '0190a0b1-0000-7000-8000-000000000099'

const ACTOR_A: ActorContext = {
	principalId: USER_A,
	userId: USER_A,
	workspaceId: WS_ID,
	kind: 'user',
	membership: 'active',
	roleKey: 'member',
	roleRank: 30,
	permissions: new Set() as ActorContext['permissions']
}

const ACTOR_B: ActorContext = {
	...ACTOR_A,
	principalId: USER_B,
	userId: USER_B
}

interface RecordedQuery {
	readonly sql: string
	readonly values: readonly unknown[]
}

function createMockQueryable(handler: (sql: string, values: readonly unknown[]) => unknown[]) {
	const queries: RecordedQuery[] = []
	const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
		const sql = strings.join('?')
		// Sub-fragments constructed via `tx\`...\`` are passed to an outer template.
		const unwrappedValues = values.map((value) =>
			value && typeof value === 'object' && '__fragment' in value
				? (value as { __fragment: string }).__fragment
				: value
		)
		queries.push({ sql, values: unwrappedValues })
		return Promise.resolve(handler(sql, unwrappedValues))
	}) as unknown as Queryable & { json(value: unknown): unknown }
	;(tx as unknown as { json(value: unknown): unknown }).json = (value: unknown) => ({ __json: value })
	return { tx, queries }
}

describe('availability repo SQL safety & optimistic concurrency', () => {
	test('getProfileRow, listWindows, and getWindowRow never bind column lists as SQL parameters and join users', async () => {
		const { tx, queries } = createMockQueryable((sql) => {
			if (sql.includes('FROM user_workspace_profiles p')) {
				return [
					{
						userId: USER_A,
						displayName: 'Hagen Owner',
						avatarUrl: 'https://example.test/avatar.png',
						statusEmoji: '💻',
						statusText: 'Shipping',
						statusExpiresAt: null,
						dndUntil: null,
						workingHours: {},
						lastSeenAt: '2026-11-27T10:00:00.000Z',
						manualState: 'auto',
						manualStateExpiresAt: null,
						timezone: 'Europe/Berlin',
						suppressNotificationsOffHours: false,
						allowUrgentOverride: true,
						version: 1,
						updatedAt: '2026-11-27T10:00:00.000Z'
					}
				]
			}
			return [
				{
					id: WINDOW_ID,
					userId: USER_A,
					kind: 'ooo',
					title: 'Vacation',
					message: '',
					startsAt: '2027-01-01T00:00:00.000Z',
					endsAt: '2027-01-05T00:00:00.000Z',
					delegateUserId: null,
					autoDeclineRouting: true,
					suppressNotifications: true,
					version: 1,
					createdAt: '2026-11-27T10:00:00.000Z',
					updatedAt: '2026-11-27T10:00:00.000Z'
				}
			]
		})

		const profile = await getProfileRow(tx, WS_ID, USER_A)
		const windows = await listWindows(tx, WS_ID, [USER_A], { all: true })
		const single = await getWindowRow(tx, WS_ID, WINDOW_ID)

		expect(profile?.displayName).toBe('Hagen Owner')
		expect(profile?.avatarUrl).toBe('https://example.test/avatar.png')
		expect(windows).toHaveLength(1)
		expect(single?.id).toBe(WINDOW_ID)

		expect(queries[0]?.sql).toContain('LEFT JOIN users u ON u.id = p.user_id')
		for (const q of queries) {
			for (const value of q.values) {
				if (typeof value === 'string') {
					expect(value).not.toContain('AS "userId"')
					expect(value).not.toContain('starts_at::text')
				}
			}
		}
	})

	test('upsertProfileRow enforces expectedVersion === 0 on first write and preserves user timezone', async () => {
		let stored: Record<string, unknown> | null = null
		const { tx, queries } = createMockQueryable((sql, values) => {
			if (sql.includes('FROM user_workspace_profiles p')) {
				return stored ? [stored] : []
			}
			if (sql.includes('INSERT INTO user_workspace_profiles')) {
				stored = {
					userId: USER_A,
					displayName: 'Hagen Owner',
					avatarUrl: null,
					statusEmoji: values[2] ?? null,
					statusText: values[3] ?? '',
					statusExpiresAt: values[4] ?? null,
					dndUntil: values[5] ?? null,
					workingHours: (values[6] as { __json?: unknown })?.__json ?? {},
					lastSeenAt: '2026-11-27T10:00:00.000Z',
					manualState: values[7] ?? 'auto',
					manualStateExpiresAt: values[8] ?? null,
					timezone: (values[9] as string | null) ?? 'Europe/Berlin',
					suppressNotificationsOffHours: Boolean(values[10]),
					allowUrgentOverride: Boolean(values[11]),
					version: stored ? Number(stored['version']) + 1 : 1,
					updatedAt: '2026-11-27T10:00:00.000Z'
				}
				return []
			}
			return []
		})

		await expect(
			upsertProfileRow(tx, WS_ID, USER_A, { expectedVersion: 1, statusText: 'Bad' })
		).rejects.toMatchObject({ code: 'stale_version' })

		const created = await upsertProfileRow(tx, WS_ID, USER_A, {
			expectedVersion: 0,
			statusText: 'First save'
		})
		expect(created.version).toBe(1)
		expect(created.timezone).toBe('Europe/Berlin')

		const insertSql = queries.find((q) => q.sql.includes('INSERT INTO user_workspace_profiles'))?.sql ?? ''
		expect(insertSql).toContain('COALESCE(?, (SELECT timezone FROM users WHERE id = ?)')

		await expect(
			upsertProfileRow(tx, WS_ID, USER_A, { expectedVersion: 0, statusText: 'Stale' })
		).rejects.toMatchObject({ code: 'stale_version' })
	})
})

describe('availability service CRUD lifecycle', () => {
	test('updateMyAvailability advances version 0 -> 1 -> 2 and preserves displayName & timezone', async () => {
		let profileVersion = 0
		let savedStatusText = ''
		let savedManual = 'auto'
		let savedTz = 'America/New_York'
		let cursorSeq = 10

		const { tx } = createMockQueryable((sql, values) => {
			if (sql.includes('FROM user_workspace_profiles p')) {
				if (profileVersion === 0) return []
				return [
					{
						userId: USER_A,
						displayName: 'Hagen Owner',
						avatarUrl: null,
						statusEmoji: null,
						statusText: savedStatusText,
						statusExpiresAt: null,
						dndUntil: null,
						workingHours: {},
						lastSeenAt: '2026-11-27T10:00:00.000Z',
						manualState: savedManual,
						manualStateExpiresAt: null,
						timezone: savedTz,
						suppressNotificationsOffHours: false,
						allowUrgentOverride: true,
						version: profileVersion,
						updatedAt: '2026-11-27T10:00:00.000Z'
					}
				]
			}
			if (sql.includes('FROM memberships m')) {
				return [
					{
						userId: USER_A,
						displayName: 'Hagen Owner',
						avatarUrl: null,
						statusEmoji: null,
						statusText: savedStatusText,
						statusExpiresAt: null,
						dndUntil: null,
						workingHours: {},
						lastSeenAt: null,
						manualState: 'auto',
						manualStateExpiresAt: null,
						timezone: savedTz,
						suppressNotificationsOffHours: false,
						allowUrgentOverride: true,
						version: profileVersion,
						updatedAt: null
					}
				]
			}
			if (sql.includes('INSERT INTO user_workspace_profiles')) {
				profileVersion += 1
				savedStatusText = String(values[3] ?? savedStatusText)
				savedManual = String(values[7] ?? savedManual)
				savedTz = String(values[9] ?? savedTz)
				return []
			}
			if (sql.includes('UPDATE workspace_seq')) {
				cursorSeq += 1
				return [{ lastCursor: cursorSeq }]
			}
			return []
		})

		const first = await updateMyAvailability(tx, ACTOR_A, {
			manualState: 'busy',
			statusText: 'Focusing',
			expectedVersion: 0
		})
		expect(first.data.version).toBe(1)
		expect(first.data.displayName).toBe('Hagen Owner')
		expect(first.data.timezone).toBe('America/New_York')
		expect(first.data.statusText).toBe('Focusing')

		const second = await updateMyAvailability(tx, ACTOR_A, {
			manualState: 'auto',
			statusText: 'Back',
			expectedVersion: 1
		})
		expect(second.data.version).toBe(2)
		expect(second.data.displayName).toBe('Hagen Owner')

		await expect(
			updateMyAvailability(tx, ACTOR_A, { statusText: 'Stale', expectedVersion: 1 })
		).rejects.toBeInstanceOf(HttpError)
	})

	test('window create, update, delete enforce ownership and advance change cursor', async () => {
		let storedWindow: Record<string, unknown> | null = null
		let cursorSeq = 20

		const { tx } = createMockQueryable((sql, values) => {
			if (sql.includes('SELECT EXISTS')) return [{ exists: false }]
			if (sql.includes('INSERT INTO user_availability_windows')) {
				storedWindow = {
					id: WINDOW_ID,
					userId: USER_A,
					kind: values[2],
					title: values[3],
					message: values[4],
					startsAt: values[5],
					endsAt: values[6],
					delegateUserId: values[7],
					autoDeclineRouting: values[8],
					suppressNotifications: values[9],
					version: 1,
					createdAt: '2026-11-27T10:00:00.000Z',
					updatedAt: '2026-11-27T10:00:00.000Z'
				}
				return [storedWindow]
			}
			if (
				sql.includes('FROM user_availability_windows') &&
				sql.includes('WHERE workspace_id = ? AND id = ?')
			) {
				return storedWindow ? [storedWindow] : []
			}
			if (sql.includes('UPDATE user_availability_windows SET')) {
				storedWindow = {
					...(storedWindow ?? {}),
					title: values[2] ? values[3] : storedWindow?.['title'],
					version: 2,
					updatedAt: '2026-11-27T10:05:00.000Z'
				}
				return [storedWindow]
			}
			if (sql.includes('DELETE FROM user_availability_windows')) {
				const deleted = storedWindow ? [{ id: String(storedWindow['id']) }] : []
				storedWindow = null
				return deleted
			}
			if (sql.includes('FROM user_availability_windows')) {
				return storedWindow ? [storedWindow] : []
			}
			if (sql.includes('FROM user_workspace_profiles p')) {
				return [
					{
						userId: USER_A,
						displayName: 'Hagen Owner',
						avatarUrl: null,
						statusEmoji: null,
						statusText: '',
						statusExpiresAt: null,
						dndUntil: null,
						workingHours: {},
						lastSeenAt: '2026-11-27T10:00:00.000Z',
						manualState: 'auto',
						manualStateExpiresAt: null,
						timezone: 'UTC',
						suppressNotificationsOffHours: false,
						allowUrgentOverride: true,
						version: 1,
						updatedAt: '2026-11-27T10:00:00.000Z'
					}
				]
			}
			if (sql.includes('UPDATE workspace_seq')) {
				cursorSeq += 1
				return [{ lastCursor: cursorSeq }]
			}
			return []
		})

		const created = await createAvailabilityWindow(tx, ACTOR_A, {
			kind: 'ooo',
			title: 'Break',
			startsAt: '2027-03-01T09:00:00.000Z',
			endsAt: '2027-03-05T17:00:00.000Z'
		})
		expect(created.data.id).toBe(WINDOW_ID)
		expect(created.cursor).toBe(21)

		await expect(updateAvailabilityWindow(tx, ACTOR_B, WINDOW_ID, { title: 'Hijack' })).rejects.toMatchObject(
			{ status: 403 }
		)

		const updated = await updateAvailabilityWindow(tx, ACTOR_A, WINDOW_ID, { title: 'Updated' })
		expect(updated.data.title).toBe('Updated')
		expect(updated.cursor).toBe(22)

		await expect(deleteAvailabilityWindow(tx, ACTOR_B, WINDOW_ID)).rejects.toMatchObject({ status: 403 })
		const deleted = await deleteAvailabilityWindow(tx, ACTOR_A, WINDOW_ID)
		expect(deleted.deleted).toBe(true)
		expect(deleted.cursor).toBe(23)
	})
})
