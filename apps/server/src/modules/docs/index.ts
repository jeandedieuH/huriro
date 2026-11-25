/**
 * Docs controller & cross-module seam (§5.4, §7.2, §10).
 */
import type { Queryable, Sql } from '@huriro/db'
import { Elysia } from 'elysia'
import { withIdempotency } from '../../api/context'
import { HttpError } from '../../api/error'
import { markdownResponse, renderDocument, splitMdParam } from '../../api/markdown'
import type { RealtimePubSub } from '../../realtime/pubsub'
import type { Auth } from '../identity'
import { workspaceDerive } from '../tenancy'
import {
	CommentParam,
	CreateDocCommentBody,
	CreateDocPageBody,
	CreateDocVersionBody,
	DocAppendBody,
	DocImportMarkdownBody,
	ExportDocQuery,
	ListPagesQuery,
	MoveDocPageBody,
	PageGetParam,
	PageIdParam,
	PageSlugParam,
	ResolveDocCommentBody,
	RestoreDocVersionBody,
	SplitDocPageBody,
	UpdateDocCommentBody,
	UpdateDocPageBody,
	VersionDetailParam
} from './schema'
import {
	acquireCollabRoomAndState,
	appendToDocPage,
	type CollabDirectBridge,
	consumeAndAuthorizeCollabTicket,
	createDocComment,
	createDocPage,
	createNamedDocVersion,
	deleteDocComment,
	deleteDocPage,
	exportDocPageMarkdown,
	getDocPageBySlugDetail,
	getDocPageDetail,
	getDocPageForRedirect,
	getDocsSnapshotData,
	getDocVersionDetail,
	importDocPageMarkdown,
	issueCollabTicket,
	listAccessibleDocPageIds,
	listAccessibleDocPages,
	listDocVersions,
	moveDocPage,
	persistCollabDocumentState,
	prepareRestoreDocVersion,
	releaseCollabRoomLease,
	renewCollabRoomLease,
	requireDocPageAccess,
	resolveDocComment,
	runDocMaintenanceOnce,
	setDocFavorite,
	splitDocPage,
	updateDocComment,
	updateDocPage,
	verifyCollabTicketSignature,
	verifyLiveCollabSessionAccess
} from './service'

export { DOCS_EVENTS } from './events'
export type { CollabDirectBridge, CollabTicketClaims } from './service'
export {
	acquireCollabRoomAndState,
	appendToDocPage,
	consumeAndAuthorizeCollabTicket,
	createDocComment,
	createDocPage,
	createNamedDocVersion,
	deleteDocPage,
	exportDocPageMarkdown,
	getDocPageBySlugDetail,
	getDocPageDetail,
	getDocPageForRedirect,
	getDocsSnapshotData,
	listAccessibleDocPageIds,
	listAccessibleDocPages,
	listDocVersions,
	moveDocPage,
	persistCollabDocumentState,
	prepareRestoreDocVersion,
	releaseCollabRoomLease,
	renewCollabRoomLease,
	requireDocPageAccess,
	runDocMaintenanceOnce,
	updateDocPage,
	verifyCollabTicketSignature,
	verifyLiveCollabSessionAccess
}

async function resolveDocRedirectMapping(
	tx: Queryable,
	workspaceId: string,
	slugOrIdentifier: string
): Promise<{ localId: string; localType: string } | null> {
	const [row] = await tx<{ localId: string; localType: string }[]>`
		SELECT local_id AS "localId", local_type AS "localType"
		FROM import_mappings
		WHERE workspace_id = ${workspaceId}
			AND local_type = 'doc_page'
			AND upper(remote_identifier) = upper(${slugOrIdentifier})
		ORDER BY created_at DESC
		LIMIT 1
	`
	return row ?? null
}

export function docsModule(
	sql: Sql,
	auth: Auth | null,
	pubsub?: RealtimePubSub,
	collabBridge?: CollabDirectBridge,
	ticketSecret = 'huriro-dev-collab'
) {
	return (
		new Elysia({ name: 'huriro.docs' })
			.derive(workspaceDerive(sql, auth))
			// ---- Page list, create & read ----
			.get('/docs', { query: ListPagesQuery }, ({ query, inWorkspace }) =>
				inWorkspace(async (tx, actor) => ({
					data: await listAccessibleDocPages(tx, actor, query)
				}))
			)
			.post(
				'/docs',
				{ body: CreateDocPageBody },
				async ({ body, headers, workspaceCtx, inWorkspace, set }) => {
					const res = await inWorkspace((tx, actor) =>
						withIdempotency(tx, {
							workspaceId: workspaceCtx.workspaceId,
							key: headers['idempotency-key'],
							endpoint: 'POST /api/v1/docs',
							requestBody: body,
							successStatus: 201,
							execute: () => createDocPage(tx, actor, body)
						})
					)
					set.status = res.status
					if (!res.replayed && pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, res.body.cursor)
					return res.body.data
				}
			)
			.post(
				'/docs/import/markdown',
				{ body: DocImportMarkdownBody },
				async ({ body, workspaceCtx, inWorkspace, set }) => {
					const result = await inWorkspace((tx, actor) => importDocPageMarkdown(tx, actor, body))
					set.status = 201
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			.get('/docs/by-slug/:slug', { params: PageSlugParam }, ({ params, workspaceCtx, inWorkspace }) =>
				inWorkspace(async (tx, actor) => {
					try {
						// `.md` representation (§13.1b) — see tasks by-key for why the
						// suffix is detected inside the param.
						const { id: ref, markdown } = splitMdParam(params.slug)
						if (markdown) {
							const page = /^[0-9a-f-]{36}$/i.test(ref)
								? await getDocPageDetail(tx, actor, ref)
								: await getDocPageBySlugDetail(tx, actor, ref)
							const md = await exportDocPageMarkdown(tx, actor, page.page.id)
							return markdownResponse(
								renderDocument({
									id: page.page.id,
									title: page.page.title,
									slug: page.page.slug,
									markdown: md.markdown
								})
							)
						}
						const detail = await getDocPageBySlugDetail(tx, actor, params.slug)
						return { ...detail, redirectedFrom: null as string | null }
					} catch (err) {
						if (err instanceof HttpError && err.status === 404) {
							const mapping = await resolveDocRedirectMapping(tx, workspaceCtx.workspaceId, params.slug)
							if (mapping?.localType === 'doc_page') {
								const detail = await getDocPageDetail(tx, actor, mapping.localId)
								return { ...detail, redirectedFrom: params.slug }
							}
						}
						throw err
					}
				})
			)
			// GET /docs/:id accepts `<uuid>.md` too — same pattern as issues.
			.get('/docs/:id', { params: PageGetParam }, ({ params, inWorkspace }) =>
				inWorkspace(async (tx, actor) => {
					const { id: ref, markdown } = splitMdParam(params.id)
					if (!markdown && !/^[0-9a-f-]{36}$/i.test(ref)) {
						throw new HttpError(422, 'validation_failed', 'id must be a uuid (optionally suffixed .md)')
					}
					const detail = /^[0-9a-f-]{36}$/i.test(ref)
						? await getDocPageDetail(tx, actor, ref)
						: await getDocPageBySlugDetail(tx, actor, ref)
					if (!markdown) return detail
					const md = await exportDocPageMarkdown(tx, actor, detail.page.id)
					return markdownResponse(
						renderDocument({
							id: detail.page.id,
							title: detail.page.title,
							slug: detail.page.slug,
							markdown: md.markdown
						})
					)
				})
			)
			.patch(
				'/docs/:id',
				{ params: PageIdParam, body: UpdateDocPageBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) => updateDocPage(tx, actor, params.id, body))
					if (pubsub) {
						await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
						// Trigger live session access re-check when visibility tightens or page is archived.
						if (body.visibility === 'private' || body.archived === true) {
							await pubsub.publishRevoke(workspaceCtx.workspaceId, '*', 'doc_visibility_changed')
						}
					}
					return result.data
				}
			)
			.post(
				'/docs/:id/move',
				{ params: PageIdParam, body: MoveDocPageBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) => moveDocPage(tx, actor, params.id, body))
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return { page: result.data, rebalanced: result.rebalanced }
				}
			)
			.delete('/docs/:id', { params: PageIdParam }, async ({ params, workspaceCtx, inWorkspace }) => {
				const result = await inWorkspace((tx, actor) => deleteDocPage(tx, actor, params.id))
				if (pubsub) {
					await pubsub.publishRevoke(workspaceCtx.workspaceId, '*', 'doc_deleted')
					await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
				}
				return { deleted: true, id: result.id, archivedIds: result.archivedIds }
			})
			.post('/docs/:id/favorite', { params: PageIdParam }, ({ params, inWorkspace }) =>
				inWorkspace((tx, actor) => setDocFavorite(tx, actor, params.id, true))
			)
			.delete('/docs/:id/favorite', { params: PageIdParam }, ({ params, inWorkspace }) =>
				inWorkspace((tx, actor) => setDocFavorite(tx, actor, params.id, false))
			)
			.post(
				'/docs/:id/split',
				{ params: PageIdParam, body: SplitDocPageBody },
				async ({ params, body, workspaceCtx, inWorkspace, set }) => {
					const result = await inWorkspace((tx, actor) => splitDocPage(tx, actor, params.id, body))
					set.status = 201
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			.post(
				'/docs/:id/append',
				{ params: PageIdParam, body: DocAppendBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const hasBridge = Boolean(collabBridge?.appendNodes)
					const prep = await inWorkspace((tx, actor) =>
						appendToDocPage(tx, actor, params.id, body, hasBridge)
					)
					let finalCursor = prep.cursor
					if (!prep.appliedInDb && collabBridge?.appendNodes) {
						await collabBridge.appendNodes(
							workspaceCtx.workspaceId,
							params.id,
							prep.nodes,
							body.origin ?? 'api:append',
							workspaceCtx.session.userId
						)
						const bounds = await inWorkspace(async (tx) => {
							const [seq] = await tx<{ lastCursor: string | number }[]>`
								SELECT last_cursor AS "lastCursor" FROM workspace_seq WHERE workspace_id = ${workspaceCtx.workspaceId}
							`
							return seq ? Number(seq.lastCursor) : prep.cursor
						})
						finalCursor = bounds
					}
					if (pubsub && finalCursor > 0) await pubsub.publishCursor(workspaceCtx.workspaceId, finalCursor)
					return inWorkspace((tx, actor) => getDocPageDetail(tx, actor, params.id))
				}
			)
			.get('/docs/:id/export', { params: PageIdParam, query: ExportDocQuery }, ({ params, inWorkspace }) =>
				inWorkspace((tx, actor) => exportDocPageMarkdown(tx, actor, params.id))
			)
			.post('/docs/:id/collab-ticket', { params: PageIdParam }, ({ params, inWorkspace }) =>
				inWorkspace((tx, actor) => issueCollabTicket(tx, actor, params.id, ticketSecret))
			)
			// ---- Versions ----
			.get('/docs/:id/versions', { params: PageIdParam }, ({ params, inWorkspace }) =>
				inWorkspace(async (tx, actor) => ({
					data: await listDocVersions(tx, actor, params.id)
				}))
			)
			.post(
				'/docs/:id/versions',
				{ params: PageIdParam, body: CreateDocVersionBody },
				async ({ params, body, inWorkspace, set }) => {
					const result = await inWorkspace((tx, actor) =>
						createNamedDocVersion(tx, actor, params.id, body.label)
					)
					set.status = 201
					return result.data
				}
			)
			.get('/docs/:id/versions/:versionId', { params: VersionDetailParam }, ({ params, inWorkspace }) =>
				inWorkspace((tx, actor) => getDocVersionDetail(tx, actor, params.id, params.versionId))
			)
			.post(
				'/docs/:id/versions/:versionId/restore',
				{ params: VersionDetailParam, body: RestoreDocVersionBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const roomLoaded = collabBridge?.isRoomLoaded?.(workspaceCtx.workspaceId, params.id) ?? false
					const prep = await inWorkspace((tx, actor) =>
						prepareRestoreDocVersion(tx, actor, params.id, params.versionId, roomLoaded, body.label)
					)
					if (!prep.appliedInDb && collabBridge?.replaceDocument) {
						await collabBridge.replaceDocument(
							workspaceCtx.workspaceId,
							params.id,
							prep.targetState,
							'huriro:restore',
							workspaceCtx.session.userId
						)
					}
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, prep.cursor)
					const detail = await inWorkspace((tx, actor) => getDocPageDetail(tx, actor, params.id))
					return { detail, checkpointVersion: prep.checkpointVersion }
				}
			)
			// ---- Anchored comments ----
			.post(
				'/docs/:id/comments',
				{ params: PageIdParam, body: CreateDocCommentBody },
				async ({ params, body, headers, workspaceCtx, inWorkspace, set }) => {
					const res = await inWorkspace((tx, actor) =>
						withIdempotency(tx, {
							workspaceId: workspaceCtx.workspaceId,
							key: headers['idempotency-key'],
							endpoint: `POST /api/v1/docs/${params.id}/comments`,
							requestBody: body,
							successStatus: 201,
							execute: () => createDocComment(tx, actor, params.id, body)
						})
					)
					set.status = res.status
					if (!res.replayed && pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, res.body.cursor)
					return res.body.data
				}
			)
			.patch(
				'/docs/:id/comments/:commentId',
				{ params: CommentParam, body: UpdateDocCommentBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) =>
						updateDocComment(tx, actor, params.id, params.commentId, body)
					)
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			.post(
				'/docs/:id/comments/:commentId/resolve',
				{ params: CommentParam, body: ResolveDocCommentBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) =>
						resolveDocComment(tx, actor, params.id, params.commentId, body)
					)
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			.delete(
				'/docs/:id/comments/:commentId',
				{ params: CommentParam },
				async ({ params, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) =>
						deleteDocComment(tx, actor, params.id, params.commentId)
					)
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return { deleted: true, id: result.id }
				}
			)
	)
}
