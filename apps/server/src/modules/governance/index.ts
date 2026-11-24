import type { Sql } from '@huriro/db'
import { Elysia } from 'elysia'
import { HttpError } from '../../api/error'
import type { EmailPipeline } from '../../email'
import type { RealtimePubSub } from '../../realtime/pubsub'
import { type BlobStorage, MemoryBlobStorage } from '../files'
import { type Auth, requireSession } from '../identity'
import { workspaceDerive } from '../tenancy'
import { EraseAccountBody, ExportIdParam } from './schema'
import {
	createWorkspaceExport,
	downloadWorkspaceExport,
	eraseMyAccount,
	listWorkspaceExports
} from './service'

export function governanceModule(
	sql: Sql,
	auth: Auth | null,
	storage: BlobStorage = new MemoryBlobStorage(),
	pubsub?: RealtimePubSub,
	opts?: { readonly email?: EmailPipeline | undefined }
) {
	return (
		new Elysia({ name: 'huriro.governance' })
			// GDPR Art. 17 self-erasure works with a session even after leaving/before joining a workspace.
			.post('/governance/erase-me', { body: EraseAccountBody }, async ({ body, request }) => {
				if (!auth) {
					throw new HttpError(501, 'not_implemented', 'Auth not configured')
				}
				const session = await requireSession(auth, request)
				return eraseMyAccount(sql, session, body, pubsub, opts?.email)
			})
			.derive(workspaceDerive(sql, auth))
			.get('/governance/exports', ({ inWorkspace }) =>
				inWorkspace(async (tx, actor) => ({ data: await listWorkspaceExports(tx, actor) }))
			)
			.post('/governance/exports', async ({ inWorkspace, set }) => {
				const created = await inWorkspace((tx, actor) => createWorkspaceExport(tx, actor, storage))
				set.status = 201
				return created
			})
			.get('/governance/exports/:id/download', { params: ExportIdParam }, async ({ params, inWorkspace }) => {
				const { exportRow, bytes } = await inWorkspace((tx, actor) =>
					downloadWorkspaceExport(tx, actor, params.id, storage)
				)
				return new Response(bytes as unknown as BodyInit, {
					status: 200,
					headers: {
						'content-type': 'application/json; charset=utf-8',
						'content-length': String(bytes.byteLength),
						'content-disposition': `attachment; filename="huriro-export-${exportRow.id}.json"`,
						'content-security-policy': 'sandbox',
						'x-content-type-options': 'nosniff',
						'cache-control': 'no-store'
					}
				})
			})
	)
}
