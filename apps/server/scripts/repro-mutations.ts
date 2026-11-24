/**
 * TEMPORARY repro script: exercises the exact client -> /api/v1/mutations path
 * against the DEV database with the user's real workspace, printing the raw
 * response and any server-side error. Delete after debugging.
 */
import { randomUUID } from 'node:crypto'
import { createAppPool, migrationsDir } from '@huriro/db'
import { createApp } from '../src/api/app'
import { InProcessPubSub } from '../src/realtime/pubsub'

const DATABASE_URL = process.env.DATABASE_URL ?? ''
const WORKSPACE_ID = '01a20c5a-60cd-7e62-bfff-37e622f2a76f'
const USER_ID = '01a20c43-0e7a-77cf-bb5e-59596b90044d'

if (!DATABASE_URL) throw new Error('DATABASE_URL required')

const auth = {
	options: { baseURL: 'http://localhost' },
	handler: () => new Response('Not found', { status: 404 }),
	api: {
		async getSession({ headers }: { headers: Headers }) {
			const userId = headers.get('x-test-user-id')
			if (!userId) return null
			return { user: { id: userId, email: 'repro@local', name: 'repro' }, session: { id: 's', userId } }
		}
	}
} as never

const sql = createAppPool(DATABASE_URL)
const pubsub = new InProcessPubSub()
const app = createApp({
	sql,
	migrationsDir,
	mode: 'selfhost',
	auth,
	pubsub,
	rootSecret: 'huriro-integration-test-root-secret-32chars'
} as never)

function clientUuidV7(): string {
	// mimic generateUuidV7 from the sync client
	const bytes = new Uint8Array(16)
	crypto.getRandomValues(bytes)
	const ts = BigInt(Date.now()) & 0xffffffffffffn
	for (let i = 0; i < 6; i++) bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn)
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// Exact envelope shapes the sync engine enqueues (packages/sync-client/src/engine.ts)
const projectId = clientUuidV7()
const docPageId = clientUuidV7()
const nowIso = new Date().toISOString()
const batch = {
	mutations: [
		{
			mutationId: clientUuidV7(),
			workspaceId: WORKSPACE_ID,
			entity: 'project',
			entityId: projectId,
			op: 'create',
			patch: {
				key: 'REPRO',
				name: 'Repro Project',
				description: '',
				visibility: 'workspace',
				position: 'V'
			},
			queuedAt: nowIso
		},
		{
			mutationId: clientUuidV7(),
			workspaceId: WORKSPACE_ID,
			entity: 'doc_page',
			entityId: docPageId,
			op: 'create',
			patch: {
				parentId: null,
				title: 'Repro Doc',
				visibility: 'workspace',
				position: 'V',
				slug: 'repro-doc'
			},
			queuedAt: nowIso
		}
	]
}

console.log('POST /api/v1/mutations with exact client envelope...')
const started = Date.now()
try {
	const timeout = setTimeout(() => {
		console.error('!! request still hanging after 10s - server never resolves the batch')
		process.exit(2)
	}, 10_000)
	const res = await app.handle(
		new Request('http://localhost/api/v1/mutations', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-workspace-id': WORKSPACE_ID,
				'x-huriro-client': 'huriro-web',
				'x-test-user-id': USER_ID,
				'idempotency-key': randomUUID()
			},
			body: JSON.stringify(batch)
		})
	)
	clearTimeout(timeout)
	const text = await res.text()
	console.log(`status: ${res.status} in ${Date.now() - started}ms`)
	console.log('body:', text.slice(0, 3000))
} catch (err) {
	console.error('threw:', err)
} finally {
	await sql.end().catch(() => {})
	await pubsub.close().catch(() => {})
}
