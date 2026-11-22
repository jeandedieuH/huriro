import type { Sql } from '@huriro/db'
import { Elysia } from 'elysia'
import type { RealtimePubSub } from '../../realtime/pubsub'
import type { Auth } from '../identity'
import { workspaceDerive } from '../tenancy'
import { ImportDryRunBody, ImportExecuteBody, ImportIdParam, RedirectIdentifierParam } from './schema'
import { dryRunImport, executeImport, getImportJob, listImportJobs, resolveImportRedirect } from './service'

export function importsModule(sql: Sql, auth: Auth | null, pubsub?: RealtimePubSub) {
	return new Elysia({ name: 'huriro.imports' })
		.derive(workspaceDerive(sql, auth))
		.post('/imports/dry-run', { body: ImportDryRunBody }, ({ body, inWorkspace }) =>
			inWorkspace((tx, actor) => dryRunImport(tx, actor, body))
		)
		.post('/imports/execute', { body: ImportExecuteBody }, async ({ body, workspaceCtx, inWorkspace }) => {
			const result = await inWorkspace((tx, actor) => executeImport(tx, actor, body))
			if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
			return result.job
		})
		.get('/imports', ({ inWorkspace }) =>
			inWorkspace(async (tx, actor) => ({ data: await listImportJobs(tx, actor) }))
		)
		.get('/imports/:id', { params: ImportIdParam }, ({ params, inWorkspace }) =>
			inWorkspace((tx, actor) => getImportJob(tx, actor, params.id))
		)
		.get('/imports/redirect/:identifier', { params: RedirectIdentifierParam }, ({ params, inWorkspace }) =>
			inWorkspace((tx, actor) => resolveImportRedirect(tx, actor, params.identifier))
		)
}
