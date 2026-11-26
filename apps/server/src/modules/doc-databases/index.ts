/** Structured databases controller (M10, §4.1, ADR-0026). */
import type { Sql } from '@huriro/db'
import { Elysia } from 'elysia'
import { withIdempotency } from '../../api/context'
import type { RealtimePubSub } from '../../realtime/pubsub'
import type { Auth } from '../identity'
import { workspaceDerive } from '../tenancy'
import {
	CreateDocDatabaseBody,
	CreateDocDatabasePropertyBody,
	CreateDocDatabaseRowBody,
	CreateDocDatabaseViewBody,
	DatabaseIdParam,
	DatabasePropertyParam,
	DatabaseRowParam,
	DatabaseViewParam,
	ExportDocDatabaseRowsQuery,
	ImportDocDatabaseRowsBody,
	QueryDocDatabaseRowsBody,
	UpdateDocDatabaseBody,
	UpdateDocDatabasePropertyBody,
	UpdateDocDatabaseRowBody,
	UpdateDocDatabaseViewBody
} from './schema'
import {
	createDocDatabase,
	createDocDatabaseProperty,
	createDocDatabaseRow,
	createDocDatabaseView,
	ensureDocDatabaseRowPage,
	exportDocDatabaseRows,
	getDocDatabaseDetail,
	importDocDatabaseRows,
	listDocDatabases,
	queryDocDatabaseRows,
	updateDocDatabase,
	updateDocDatabaseProperty,
	updateDocDatabaseRow,
	updateDocDatabaseView
} from './service'

export {
	createDocDatabase,
	createDocDatabaseProperty,
	createDocDatabaseRow,
	createDocDatabaseView,
	getDocDatabaseDetail,
	listDocDatabases,
	queryDocDatabaseRows,
	updateDocDatabase,
	updateDocDatabaseProperty,
	updateDocDatabaseRow,
	updateDocDatabaseView
} from './service'

export function docDatabasesModule(sql: Sql, auth: Auth | null, pubsub?: RealtimePubSub) {
	return new Elysia({ name: 'huriro.doc-databases' })
		.derive(workspaceDerive(sql, auth))
		.get('/docs/databases', ({ inWorkspace }) =>
			inWorkspace((tx, actor) => listDocDatabases(tx, actor).then((data) => ({ data })))
		)
		.post(
			'/docs/databases',
			{ body: CreateDocDatabaseBody },
			async ({ body, headers, workspaceCtx, inWorkspace, set }) => {
				const res = await inWorkspace((tx, actor) =>
					withIdempotency(tx, {
						workspaceId: workspaceCtx.workspaceId,
						key: headers['idempotency-key'],
						endpoint: 'POST /api/v1/docs/databases',
						requestBody: body,
						successStatus: 201,
						execute: () => createDocDatabase(tx, actor, body)
					})
				)
				set.status = res.status
				if (!res.replayed && res.body.cursor !== null && pubsub)
					await pubsub.publishCursor(workspaceCtx.workspaceId, res.body.cursor)
				return res.body.data
			}
		)
		.get('/docs/databases/:databaseId', { params: DatabaseIdParam }, ({ params, inWorkspace }) =>
			inWorkspace((tx, actor) => getDocDatabaseDetail(tx, actor, params.databaseId))
		)
		.patch(
			'/docs/databases/:databaseId',
			{ params: DatabaseIdParam, body: UpdateDocDatabaseBody },
			async ({ params, body, workspaceCtx, inWorkspace }) => {
				const res = await inWorkspace((tx, actor) => updateDocDatabase(tx, actor, params.databaseId, body))
				if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, res.cursor)
				return res.data
			}
		)
		.post(
			'/docs/databases/:databaseId/properties',
			{ params: DatabaseIdParam, body: CreateDocDatabasePropertyBody },
			async ({ params, body, workspaceCtx, inWorkspace, set }) => {
				const res = await inWorkspace((tx, actor) =>
					createDocDatabaseProperty(tx, actor, params.databaseId, body)
				)
				set.status = 201
				if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, res.cursor)
				return res.data
			}
		)
		.patch(
			'/docs/databases/:databaseId/properties/:propertyId',
			{ params: DatabasePropertyParam, body: UpdateDocDatabasePropertyBody },
			async ({ params, body, workspaceCtx, inWorkspace }) => {
				const res = await inWorkspace((tx, actor) =>
					updateDocDatabaseProperty(tx, actor, params.databaseId, params.propertyId, body)
				)
				if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, res.cursor)
				return res.data
			}
		)
		.post(
			'/docs/databases/:databaseId/views',
			{ params: DatabaseIdParam, body: CreateDocDatabaseViewBody },
			async ({ params, body, workspaceCtx, inWorkspace, set }) => {
				const res = await inWorkspace((tx, actor) =>
					createDocDatabaseView(tx, actor, params.databaseId, body)
				)
				set.status = 201
				if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, res.cursor)
				return res.data
			}
		)
		.patch(
			'/docs/databases/:databaseId/views/:viewId',
			{ params: DatabaseViewParam, body: UpdateDocDatabaseViewBody },
			async ({ params, body, workspaceCtx, inWorkspace }) => {
				const res = await inWorkspace((tx, actor) =>
					updateDocDatabaseView(tx, actor, params.databaseId, params.viewId, body)
				)
				if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, res.cursor)
				return res.data
			}
		)
		.post(
			'/docs/databases/:databaseId/rows',
			{ params: DatabaseIdParam, body: CreateDocDatabaseRowBody },
			async ({ params, body, workspaceCtx, inWorkspace, set }) => {
				const res = await inWorkspace((tx, actor) => createDocDatabaseRow(tx, actor, params.databaseId, body))
				set.status = 201
				if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, res.cursor)
				return res.data
			}
		)
		.patch(
			'/docs/databases/:databaseId/rows/:rowId',
			{ params: DatabaseRowParam, body: UpdateDocDatabaseRowBody },
			async ({ params, body, workspaceCtx, inWorkspace }) => {
				const res = await inWorkspace((tx, actor) =>
					updateDocDatabaseRow(tx, actor, params.databaseId, params.rowId, body)
				)
				if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, res.cursor)
				return res.data
			}
		)
		.post(
			'/docs/databases/:databaseId/rows/:rowId/page',
			{ params: DatabaseRowParam },
			async ({ params, workspaceCtx, inWorkspace }) => {
				const res = await inWorkspace((tx, actor) =>
					ensureDocDatabaseRowPage(tx, actor, params.databaseId, params.rowId)
				)
				if (pubsub && res.cursor) await pubsub.publishCursor(workspaceCtx.workspaceId, res.cursor)
				return res
			}
		)
		.post(
			'/docs/databases/:databaseId/rows/import',
			{ params: DatabaseIdParam, body: ImportDocDatabaseRowsBody },
			async ({ params, body, inWorkspace, set }) => {
				const res = await inWorkspace((tx, actor) =>
					importDocDatabaseRows(tx, actor, params.databaseId, body)
				)
				set.status = 201
				return res
			}
		)
		.get(
			'/docs/databases/:databaseId/rows/export',
			{ params: DatabaseIdParam, query: ExportDocDatabaseRowsQuery },
			async ({ params, query, inWorkspace, set }) => {
				const res = await inWorkspace((tx, actor) =>
					exportDocDatabaseRows(tx, actor, params.databaseId, query)
				)
				set.headers['content-type'] =
					res.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8'
				set.headers['content-disposition'] =
					`attachment; filename="database-${params.databaseId}.${res.format}"`
				return res.data
			}
		)
		.post(
			'/docs/databases/:databaseId/rows/query',
			{ params: DatabaseIdParam, body: QueryDocDatabaseRowsBody },
			({ params, body, inWorkspace }) =>
				inWorkspace((tx, actor) => queryDocDatabaseRows(tx, actor, params.databaseId, body))
		)
}
