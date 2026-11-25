/**
 * Docs controller & cross-module seam (§5.4, §7.2, §10, M9).
 */
import type { Queryable, Sql } from '@huriro/db'
import { Elysia } from 'elysia'
import { withIdempotency } from '../../api/context'
import type { SafeEgressOptions } from '../../api/egress'
import { HttpError } from '../../api/error'
import { renderDocument, splitMdParam } from '../../api/markdown'
import type { RealtimePubSub } from '../../realtime/pubsub'
import type { Auth } from '../identity'
import { workspaceDerive } from '../tenancy'
import { authorizeWorkspaceDocAction } from './page-access'
import {
	AddTeamspaceMemberBody,
	BookmarkUnfurlBody,
	CommentParam,
	CreateDocCommentBody,
	CreateDocPageBody,
	CreateDocVersionBody,
	CreateSyncedBlockBody,
	CreateTeamspaceBody,
	DecideAllSuggestionsBody,
	DecideDocSuggestionBody,
	DocAppendBody,
	DocButtonTriggerBody,
	DocImportMarkdownBody,
	ExportDocQuery,
	ListPagesQuery,
	MoveDocPageBody,
	OptionalVersionQuery,
	PageGetParam,
	PageIdParam,
	PageSlugParam,
	ProposeDocSuggestionBody,
	PublicDocParam,
	PublicDocUnlockBody,
	PublicWorkspaceParam,
	ResolveDocCommentBody,
	RestoreDocVersionBody,
	SetDocVerificationBody,
	SplitDocPageBody,
	SuggestionGroupParam,
	SyncedBlockIdParam,
	TeamspaceIdParam,
	TeamspaceMemberParam,
	UpdateDocCommentBody,
	UpdateDocPageBody,
	UpdateSyncedBlockBody,
	UpdateTeamspaceBody,
	UpsertDocPublicShareBody,
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
import {
	exportDocRich,
	getDocPublicShare,
	resolvePublicDoc,
	resolvePublicWorkspaceLlmsTxt,
	revokeDocPublicShare,
	upsertDocPublicShare
} from './service-publish-export'
import {
	decideAllDocSuggestions,
	decideDocSuggestion,
	listDocSuggestions,
	proposeDocSuggestion
} from './service-suggestions'
import {
	acquireSyncedBlockRoomAndState,
	archiveSyncedBlock,
	consumeAndAuthorizeSyncedBlockTicket,
	createSyncedBlock,
	getSyncedBlockDetail,
	issueSyncedBlockCollabTicket,
	listSyncedBlocks,
	persistSyncedBlockCollabState,
	releaseSyncedBlockRoomLease,
	renewSyncedBlockRoomLease,
	updateSyncedBlock,
	verifyLiveSyncedBlockAccess
} from './service-synced-blocks'
import {
	addTeamspaceMember,
	archiveTeamspace,
	createTeamspace,
	listTeamspaceMembers,
	listVisibleTeamspaces,
	removeTeamspaceMember,
	updateTeamspace
} from './service-teamspaces'
import {
	clearDocVerification,
	getDocVerification,
	listDocVerificationsMap,
	runDocVerificationExpiryCheckOnce,
	setDocVerification,
	triggerDocButton,
	unfurlBookmarkUrl
} from './service-wiki'

export { DOCS_EVENTS } from './events'
export type { CollabDirectBridge, CollabTicketClaims } from './service'
export {
	acquireCollabRoomAndState,
	acquireSyncedBlockRoomAndState,
	appendToDocPage,
	consumeAndAuthorizeCollabTicket,
	consumeAndAuthorizeSyncedBlockTicket,
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
	listDocVerificationsMap,
	listDocVersions,
	listVisibleTeamspaces,
	moveDocPage,
	persistCollabDocumentState,
	persistSyncedBlockCollabState,
	prepareRestoreDocVersion,
	releaseCollabRoomLease,
	releaseSyncedBlockRoomLease,
	renewCollabRoomLease,
	renewSyncedBlockRoomLease,
	requireDocPageAccess,
	runDocMaintenanceOnce,
	runDocVerificationExpiryCheckOnce,
	updateDocPage,
	verifyCollabTicketSignature,
	verifyLiveCollabSessionAccess,
	verifyLiveSyncedBlockAccess
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

function markdownWithRobotsResponse(markdown: string, allowSearchIndexing: boolean, privateCache: boolean) {
	return new Response(markdown, {
		status: 200,
		headers: {
			'content-type': 'text/markdown; charset=utf-8',
			'cache-control': privateCache ? 'private, no-store' : 'public, max-age=60',
			...(allowSearchIndexing ? {} : { 'x-robots-tag': 'noindex, nofollow' })
		}
	})
}

/** Unauthenticated public docs endpoints (§4.5 Publish to Web). */
export function docsPublicModule(sql: Sql) {
	return new Elysia({ name: 'huriro.docs.public' })
		.get(
			'/public/docs/:workspaceSlug/llms.txt',
			{ params: PublicWorkspaceParam },
			async ({ params, request }) => {
				const origin = new URL(request.url).origin
				const txt = await resolvePublicWorkspaceLlmsTxt(sql, params.workspaceSlug, origin)
				if (!txt) {
					throw new HttpError(404, 'not_found', 'No indexable public documents found for workspace')
				}
				return new Response(txt, {
					status: 200,
					headers: {
						'content-type': 'text/plain; charset=utf-8',
						'cache-control': 'public, max-age=60'
					}
				})
			}
		)
		.get(
			'/public/docs/:workspaceSlug/:publicSlug',
			{ params: PublicDocParam },
			async ({ params, headers, set }) => {
				const { id: cleanSlug, markdown } = splitMdParam(params.publicSlug)
				const headerPassword = headers['x-public-doc-password']
				const doc = await resolvePublicDoc(sql, params.workspaceSlug, cleanSlug, headerPassword)

				const isProtected = doc.passwordRequired || Boolean(headerPassword)
				if (!doc.allowSearchIndexing) {
					set.headers['x-robots-tag'] = 'noindex, nofollow'
				}
				set.headers['cache-control'] = isProtected ? 'private, no-store' : 'public, max-age=60'

				if (markdown) {
					if (doc.passwordRequired) {
						throw new HttpError(403, 'invalid_public_doc_password', 'Password required for public document')
					}
					return markdownWithRobotsResponse(doc.markdown, doc.allowSearchIndexing, isProtected)
				}
				return doc
			}
		)
		.post(
			'/public/docs/:workspaceSlug/:publicSlug/unlock',
			{ params: PublicDocParam, body: PublicDocUnlockBody },
			async ({ params, body, set }) => {
				const doc = await resolvePublicDoc(sql, params.workspaceSlug, params.publicSlug, body.password)
				if (!doc.allowSearchIndexing) {
					set.headers['x-robots-tag'] = 'noindex, nofollow'
				}
				set.headers['cache-control'] = 'private, no-store'
				return doc
			}
		)
}

export function docsModule(
	sql: Sql,
	auth: Auth | null,
	pubsub?: RealtimePubSub,
	collabBridge?: CollabDirectBridge,
	ticketSecret = 'huriro-dev-collab',
	egressOpts?: SafeEgressOptions
) {
	return (
		new Elysia({ name: 'huriro.docs' })
			.derive(workspaceDerive(sql, auth))
			// ---- Teamspaces (§4.4) ----
			.get('/teamspaces', ({ inWorkspace }) =>
				inWorkspace(async (tx, actor) => ({
					data: await listVisibleTeamspaces(tx, actor)
				}))
			)
			.post(
				'/teamspaces',
				{ body: CreateTeamspaceBody },
				async ({ body, headers, workspaceCtx, inWorkspace, set }) => {
					const res = await inWorkspace((tx, actor) =>
						withIdempotency(tx, {
							workspaceId: workspaceCtx.workspaceId,
							key: headers['idempotency-key'],
							endpoint: 'POST /api/v1/teamspaces',
							requestBody: body,
							successStatus: 201,
							execute: () => createTeamspace(tx, actor, body)
						})
					)
					set.status = res.status
					if (!res.replayed && pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, res.body.cursor)
					return res.body.data
				}
			)
			.patch(
				'/teamspaces/:id',
				{ params: TeamspaceIdParam, body: UpdateTeamspaceBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) => updateTeamspace(tx, actor, params.id, body))
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			.delete(
				'/teamspaces/:id',
				{ params: TeamspaceIdParam, query: OptionalVersionQuery },
				async ({ params, query, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) =>
						archiveTeamspace(tx, actor, params.id, query.version)
					)
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return { archived: true, data: result.data }
				}
			)
			.get('/teamspaces/:id/members', { params: TeamspaceIdParam }, ({ params, inWorkspace }) =>
				inWorkspace(async (tx, actor) => ({
					data: await listTeamspaceMembers(tx, actor, params.id)
				}))
			)
			.post(
				'/teamspaces/:id/members',
				{ params: TeamspaceIdParam, body: AddTeamspaceMemberBody },
				async ({ params, body, workspaceCtx, inWorkspace, set }) => {
					const result = await inWorkspace((tx, actor) => addTeamspaceMember(tx, actor, params.id, body))
					set.status = 201
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			.delete(
				'/teamspaces/:id/members/:userId',
				{ params: TeamspaceMemberParam },
				async ({ params, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) =>
						removeTeamspaceMember(tx, actor, params.id, params.userId)
					)
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return { removed: result.removed, userId: params.userId }
				}
			)
			// ---- Synced Blocks & Bookmark Unfurl (must precede /docs/:id) ----
			.get('/docs/synced-blocks', ({ inWorkspace }) =>
				inWorkspace(async (tx, actor) => ({
					data: await listSyncedBlocks(tx, actor)
				}))
			)
			.post('/docs/synced-blocks', { body: CreateSyncedBlockBody }, async ({ body, inWorkspace, set }) => {
				const block = await inWorkspace((tx, actor) => createSyncedBlock(tx, actor, body))
				set.status = 201
				return block
			})
			.get('/docs/synced-blocks/:id', { params: SyncedBlockIdParam }, ({ params, inWorkspace }) =>
				inWorkspace((tx, actor) => getSyncedBlockDetail(tx, actor, params.id))
			)
			.patch(
				'/docs/synced-blocks/:id',
				{ params: SyncedBlockIdParam, body: UpdateSyncedBlockBody },
				({ params, body, inWorkspace }) =>
					inWorkspace((tx, actor) => updateSyncedBlock(tx, actor, params.id, body))
			)
			.delete(
				'/docs/synced-blocks/:id',
				{ params: SyncedBlockIdParam, query: OptionalVersionQuery },
				async ({ params, query, inWorkspace }) => {
					const data = await inWorkspace((tx, actor) =>
						archiveSyncedBlock(tx, actor, params.id, query.version)
					)
					return { archived: true, data }
				}
			)
			.post(
				'/docs/synced-blocks/:id/collab-ticket',
				{ params: SyncedBlockIdParam },
				({ params, inWorkspace }) =>
					inWorkspace((tx, actor) => issueSyncedBlockCollabTicket(tx, actor, params.id, ticketSecret))
			)
			.post('/docs/bookmarks/unfurl', { body: BookmarkUnfurlBody }, async ({ body, inWorkspace }) => {
				await inWorkspace((tx, actor) => authorizeWorkspaceDocAction(tx, actor, 'doc.read'))
				return unfurlBookmarkUrl(body.url, egressOpts)
			})
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
							return markdownWithRobotsResponse(
								renderDocument({
									id: page.page.id,
									title: page.page.title,
									slug: page.page.slug,
									markdown: md.markdown
								}),
								true,
								true
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
					return markdownWithRobotsResponse(
						renderDocument({
							id: detail.page.id,
							title: detail.page.title,
							slug: detail.page.slug,
							markdown: md.markdown
						}),
						true,
						true
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
						// Trigger live session access re-check when visibility tightens, archived, or locked.
						if (body.visibility === 'private' || body.archived === true) {
							await pubsub.publishRevoke(workspaceCtx.workspaceId, '*', 'doc_visibility_changed')
						} else if (result.lockedTransition) {
							await pubsub.publishRevoke(workspaceCtx.workspaceId, '*', 'doc_locked')
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
			.get(
				'/docs/:id/export',
				{ params: PageIdParam, query: ExportDocQuery },
				async ({ params, query, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) =>
						exportDocRich(tx, actor, params.id, query.format ?? 'markdown', query.includeChildren ?? false)
					)
					if (result.kind === 'zip') {
						return new Response(Buffer.from(result.bytes), {
							status: 200,
							headers: {
								'content-type': 'application/zip',
								'content-disposition': `attachment; filename="${result.filename}"`
							}
						})
					}
					return result.data
				}
			)
			.post('/docs/:id/collab-ticket', { params: PageIdParam }, ({ params, inWorkspace }) =>
				inWorkspace((tx, actor) => issueCollabTicket(tx, actor, params.id, ticketSecret))
			)
			.post(
				'/docs/:id/button-trigger',
				{ params: PageIdParam, body: DocButtonTriggerBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const hasBridge = Boolean(collabBridge?.appendNodes)
					const res = await inWorkspace((tx, actor) =>
						triggerDocButton(tx, actor, params.id, body, hasBridge)
					)
					if (res.nodesToAppend && res.nodesToAppend.length > 0 && collabBridge?.appendNodes) {
						await collabBridge.appendNodes(
							workspaceCtx.workspaceId,
							params.id,
							res.nodesToAppend,
							`button:${body.buttonId}`,
							workspaceCtx.session.userId
						)
					}
					if (pubsub && res.cursor > 0) await pubsub.publishCursor(workspaceCtx.workspaceId, res.cursor)
					return { triggered: true }
				}
			)
			// ---- Suggestion Mode (§4.3, ADR-0027) ----
			.get('/docs/:id/suggestions', { params: PageIdParam }, ({ params, inWorkspace }) =>
				inWorkspace(async (tx, actor) => ({
					data: await listDocSuggestions(tx, actor, params.id)
				}))
			)
			.post(
				'/docs/:id/suggestions',
				{ params: PageIdParam, body: ProposeDocSuggestionBody },
				async ({ params, body, workspaceCtx, inWorkspace, set }) => {
					const result = await proposeDocSuggestion(
						inWorkspace,
						workspaceCtx.workspaceId,
						params.id,
						body,
						collabBridge
					)
					set.status = 201
					if (pubsub && result.cursor > 0) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			.post(
				'/docs/:id/suggestions/decide-all',
				{ params: PageIdParam, body: DecideAllSuggestionsBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const result = await decideAllDocSuggestions(
						inWorkspace,
						workspaceCtx.workspaceId,
						params.id,
						body.decision,
						collabBridge
					)
					if (pubsub && result.cursor > 0) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return { updatedCount: result.updatedCount }
				}
			)
			.post(
				'/docs/:id/suggestions/:groupId/decision',
				{ params: SuggestionGroupParam, body: DecideDocSuggestionBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const result = await decideDocSuggestion(
						inWorkspace,
						workspaceCtx.workspaceId,
						params.id,
						params.groupId,
						body.decision,
						collabBridge
					)
					if (pubsub && result.cursor > 0) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			// ---- Wiki Verification (§4.3) ----
			.get('/docs/:id/verification', { params: PageIdParam }, ({ params, inWorkspace }) =>
				inWorkspace(async (tx, actor) => ({
					verification: await getDocVerification(tx, actor, params.id)
				}))
			)
			.put(
				'/docs/:id/verification',
				{ params: PageIdParam, body: SetDocVerificationBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) => setDocVerification(tx, actor, params.id, body))
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			.delete(
				'/docs/:id/verification',
				{ params: PageIdParam },
				async ({ params, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) => clearDocVerification(tx, actor, params.id))
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return { cleared: result.cleared }
				}
			)
			// ---- Publish to Web (§4.5) ----
			.get('/docs/:id/public-share', { params: PageIdParam }, ({ params, inWorkspace }) =>
				inWorkspace(async (tx, actor) => ({
					share: await getDocPublicShare(tx, actor, params.id)
				}))
			)
			.put(
				'/docs/:id/public-share',
				{ params: PageIdParam, body: UpsertDocPublicShareBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) => upsertDocPublicShare(tx, actor, params.id, body))
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			.delete(
				'/docs/:id/public-share',
				{ params: PageIdParam },
				async ({ params, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) => revokeDocPublicShare(tx, actor, params.id))
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return { revoked: result.revoked }
				}
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
