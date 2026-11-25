/**
 * Docs Wiki Verification, Backlinks, SSRF-safe Bookmark Unfurling & Button
 * Automation domain service (§4.2, §4.3).
 */
import type {
	BookmarkMetadataDto,
	DocButtonTriggerBody,
	DocVerificationDto,
	SetDocVerificationBody
} from '@huriro/contracts'
import { isUuid, type Queryable, type Sql, withSystem, withWorkspace } from '@huriro/db'
import type { ActorContext } from '@huriro/domain'
import {
	appendProseMirrorNodesToYDoc,
	createEmptyYDocState,
	type DocMention,
	type DocReferencedLink,
	extractDocumentContent,
	isSafeUrl,
	markdownToProseMirrorJson,
	type ProseMirrorNodeJson
} from '@huriro/editor'
import * as Y from 'yjs'
import { appendChange, appendChanges } from '../../api/changelog'
import { type SafeEgressOptions, SsrfBlockedError, safeEgressFetch } from '../../api/egress'
import { deleteEntityLink, insertEntityLink, listEntityLinksBySource } from '../../api/entity-links'
import { HttpError } from '../../api/error'
import { log } from '../../api/observability'
import type { RealtimePubSub } from '../../realtime/pubsub'
import { DOCS_EVENTS } from './events'
import { assertPageUnlocked, assertWithinMaxDocSize, requireDocPageAccess } from './page-access'
import { auditDocsAction, emitDocsEvent, getDocPageById, getDocStateRow, saveUnfencedDocState } from './repo'
import {
	deleteDocVerificationRow,
	getDocVerificationRow,
	listDocVerificationRows,
	markDocVerificationNotified,
	markDocVerificationStale,
	upsertDocVerificationRow
} from './repo-m9'

const DEFAULT_VERIFICATION_TTL_DAYS = 90

// ---------- Wiki Verification & Freshness ----------

export async function getDocVerification(
	tx: Queryable,
	actor: ActorContext,
	pageId: string
): Promise<DocVerificationDto | null> {
	const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.read')
	return getDocVerificationRow(tx, actor.workspaceId, page.id)
}

export async function listDocVerificationsMap(
	tx: Queryable,
	workspaceId: string
): Promise<Map<string, DocVerificationDto>> {
	const rows = await listDocVerificationRows(tx, workspaceId)
	return new Map(rows.map((r) => [r.pageId, r]))
}

export async function setDocVerification(
	tx: Queryable,
	actor: ActorContext,
	pageId: string,
	input: SetDocVerificationBody
): Promise<{ readonly data: DocVerificationDto; readonly cursor: number }> {
	const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.verify')
	const status = input.status ?? 'verified'
	const nowIso = new Date().toISOString()

	let expiresAt: string | null = null
	if (input.expiresAt !== undefined) {
		expiresAt = input.expiresAt
	} else if (input.ttlDays !== undefined && input.ttlDays !== null) {
		expiresAt = new Date(Date.now() + input.ttlDays * 86_400_000).toISOString()
	} else if (status === 'verified') {
		expiresAt = new Date(Date.now() + DEFAULT_VERIFICATION_TTL_DAYS * 86_400_000).toISOString()
	}

	const row = await upsertDocVerificationRow(tx, {
		workspaceId: actor.workspaceId,
		pageId: page.id,
		status,
		verifiedBy: status === 'verified' ? actor.userId : null,
		verifiedAt: status === 'verified' ? nowIso : null,
		expiresAt,
		note: input.note ?? ''
	})

	await emitDocsEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'doc_verification',
		aggregateId: row.id,
		eventType: DOCS_EVENTS.VerificationUpdated,
		payload: {
			pageId: page.id,
			status: row.status,
			expiresAt: row.expiresAt,
			verifiedBy: row.verifiedBy,
			actorId: actor.principalId
		}
	})

	await auditDocsAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'doc.verification.updated',
		targetType: 'doc_page',
		targetId: page.id,
		metadata: { status: row.status, expiresAt: row.expiresAt }
	})

	const updatedPage = await getDocPageById(tx, actor.workspaceId, page.id, actor.userId)
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'doc_page',
		entityId: page.id,
		action: 'upsert',
		scope: [`doc_page:${page.id}`, `visibility:${page.visibility}`],
		payload: (updatedPage ?? page) as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})

	return { data: row, cursor }
}

export async function clearDocVerification(
	tx: Queryable,
	actor: ActorContext,
	pageId: string
): Promise<{ readonly cleared: boolean; readonly cursor: number }> {
	const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.verify')
	const deleted = await deleteDocVerificationRow(tx, actor.workspaceId, page.id)

	if (deleted) {
		await emitDocsEvent(tx, {
			workspaceId: actor.workspaceId,
			aggregate: 'doc_verification',
			aggregateId: page.id,
			eventType: DOCS_EVENTS.VerificationUpdated,
			payload: {
				pageId: page.id,
				status: 'unverified',
				expiresAt: null,
				verifiedBy: null,
				actorId: actor.principalId
			}
		})
		await auditDocsAction(tx, {
			workspaceId: actor.workspaceId,
			actorType: actor.kind === 'agent' ? 'agent' : 'user',
			actorId: actor.principalId,
			action: 'doc.verification.cleared',
			targetType: 'doc_page',
			targetId: page.id
		})
	}

	const updatedPage = await getDocPageById(tx, actor.workspaceId, page.id, actor.userId)
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'doc_page',
		entityId: page.id,
		action: 'upsert',
		scope: [`doc_page:${page.id}`, `visibility:${page.visibility}`],
		payload: (updatedPage ?? page) as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})

	return { cleared: deleted, cursor }
}

export async function runDocVerificationExpiryCheckOnce(
	sql: Sql,
	pubsub?: RealtimePubSub
): Promise<{ readonly staleMarked: number; readonly warningsSent: number }> {
	const candidates = await withSystem(
		sql,
		(tx) =>
			tx<Array<{ readonly workspaceId: string; readonly pageId: string }>>`
			SELECT workspace_id AS "workspaceId", page_id AS "pageId"
			FROM list_expiring_doc_verifications()
		`
	)

	let staleMarked = 0
	let warningsSent = 0

	for (const item of candidates) {
		const res = await withWorkspace(sql, { workspaceId: item.workspaceId }, async (tx) => {
			const ver = await getDocVerificationRow(tx, item.workspaceId, item.pageId)
			const page = await getDocPageById(tx, item.workspaceId, item.pageId, item.workspaceId)
			if (!ver || !page || page.archivedAt !== null || ver.status !== 'verified' || !ver.expiresAt) {
				return { kind: 'noop' as const, cursor: null }
			}

			if (new Date(ver.expiresAt).getTime() <= Date.now()) {
				const staled = await markDocVerificationStale(tx, item.workspaceId, item.pageId)
				if (!staled) return { kind: 'noop' as const, cursor: null }
				await emitDocsEvent(tx, {
					workspaceId: item.workspaceId,
					aggregate: 'doc_verification',
					aggregateId: ver.id,
					eventType: DOCS_EVENTS.VerificationUpdated,
					payload: {
						pageId: page.id,
						status: 'stale',
						expiresAt: ver.expiresAt,
						verifiedBy: ver.verifiedBy,
						actorId: null
					}
				})
				const refreshed = await getDocPageById(tx, item.workspaceId, page.id, item.workspaceId)
				const cursor = await appendChange(tx, item.workspaceId, {
					entityType: 'doc_page',
					entityId: page.id,
					action: 'upsert',
					scope: [`doc_page:${page.id}`, `visibility:${page.visibility}`],
					payload: (refreshed ?? page) as unknown as Record<string, unknown>,
					actorId: null
				})
				return { kind: 'stale' as const, cursor }
			}

			if (ver.expiryNotifiedAt === null) {
				const marked = await markDocVerificationNotified(tx, item.workspaceId, item.pageId)
				if (marked) {
					await emitDocsEvent(tx, {
						workspaceId: item.workspaceId,
						aggregate: 'doc_verification',
						aggregateId: ver.id,
						eventType: DOCS_EVENTS.VerificationExpiring,
						payload: {
							pageId: page.id,
							pageTitle: page.title,
							pageSlug: page.slug,
							expiresAt: ver.expiresAt,
							verifiedBy: ver.verifiedBy,
							pageCreatedBy: page.createdBy
						}
					})
					return { kind: 'warned' as const, cursor: null }
				}
			}

			return { kind: 'noop' as const, cursor: null }
		}).catch((err) => {
			log.warn({ err, item }, 'doc verification expiry check failed for page')
			return { kind: 'noop' as const, cursor: null }
		})

		if (res.kind === 'stale') {
			staleMarked += 1
			if (res.cursor !== null && pubsub) {
				await pubsub.publishCursor(item.workspaceId, res.cursor)
			}
		} else if (res.kind === 'warned') {
			warningsSent += 1
		}
	}

	return { staleMarked, warningsSent }
}

// ---------- Backlinks Reconciliation via Entity Links (ADR-0033) ----------

export async function reconcileDocBacklinks(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly pageId: string
		readonly referencedLinks: readonly DocReferencedLink[]
		readonly mentions: readonly DocMention[]
		readonly actorId: string | null
	}
): Promise<void> {
	const desired = new Map<string, { readonly targetType: 'doc_page' | 'issue'; readonly targetId: string }>()

	const docIdsToVerify = new Set<string>()
	const docSlugsToLookup = new Set<string>()
	const issueIdsToVerify = new Set<string>()

	for (const link of args.referencedLinks) {
		if (link.targetType === 'doc') {
			if (link.by === 'id' && isUuid(link.targetRef) && link.targetRef !== args.pageId) {
				docIdsToVerify.add(link.targetRef)
			} else if (link.by === 'slug' && link.targetRef.length > 0) {
				docSlugsToLookup.add(link.targetRef)
			}
		} else if (link.targetType === 'issue' && link.by === 'id' && isUuid(link.targetRef)) {
			issueIdsToVerify.add(link.targetRef)
		}
	}

	for (const mention of args.mentions) {
		if (mention.entityType === 'doc' && isUuid(mention.entityId) && mention.entityId !== args.pageId) {
			docIdsToVerify.add(mention.entityId)
		} else if (mention.entityType === 'issue' && isUuid(mention.entityId)) {
			issueIdsToVerify.add(mention.entityId)
		}
	}

	if (docIdsToVerify.size > 0) {
		const rows = await tx<{ id: string }[]>`
			SELECT id FROM doc_pages
			WHERE workspace_id = ${args.workspaceId}
				AND archived_at IS NULL
				AND id = ANY(${[...docIdsToVerify]}::uuid[])
		`
		for (const r of rows) {
			if (r.id !== args.pageId) {
				desired.set(`doc_page:${r.id}`, { targetType: 'doc_page', targetId: r.id })
			}
		}
	}

	if (docSlugsToLookup.size > 0) {
		const rows = await tx<{ id: string }[]>`
			SELECT id FROM doc_pages
			WHERE workspace_id = ${args.workspaceId}
				AND archived_at IS NULL
				AND slug = ANY(${[...docSlugsToLookup]})
		`
		for (const r of rows) {
			if (r.id !== args.pageId) {
				desired.set(`doc_page:${r.id}`, { targetType: 'doc_page', targetId: r.id })
			}
		}
	}

	if (issueIdsToVerify.size > 0) {
		const rows = await tx<{ id: string }[]>`
			SELECT id FROM issues
			WHERE workspace_id = ${args.workspaceId}
				AND deleted_at IS NULL
				AND id = ANY(${[...issueIdsToVerify]}::uuid[])
		`
		for (const r of rows) {
			desired.set(`issue:${r.id}`, { targetType: 'issue', targetId: r.id })
		}
	}

	const existing = await listEntityLinksBySource(tx, {
		workspaceId: args.workspaceId,
		sourceType: 'doc_page',
		sourceId: args.pageId,
		relationKind: 'references'
	})

	const existingKeys = new Set<string>()
	for (const link of existing) {
		const key = `${link.targetType}:${link.targetId}`
		if (!desired.has(key)) {
			await deleteEntityLink(tx, {
				workspaceId: args.workspaceId,
				linkId: link.id,
				actorId: args.actorId
			})
		} else {
			existingKeys.add(key)
		}
	}

	for (const [key, target] of desired.entries()) {
		if (!existingKeys.has(key)) {
			await insertEntityLink(tx, {
				workspaceId: args.workspaceId,
				sourceType: 'doc_page',
				sourceId: args.pageId,
				targetType: target.targetType,
				targetId: target.targetId,
				relationKind: 'references',
				createdBy: args.actorId,
				actorId: args.actorId
			})
		}
	}
}

// ---------- SSRF-Safe Bookmark Unfurling ----------

function decodeHtmlEntities(raw: string): string {
	return raw
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.trim()
}

function extractMetaContent(html: string, keys: readonly string[]): string {
	for (const key of keys) {
		const reA = new RegExp(
			`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["'][^>]*>`,
			'i'
		)
		const mA = reA.exec(html)
		if (mA?.[1]) return decodeHtmlEntities(mA[1])

		const reB = new RegExp(
			`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["'][^>]*>`,
			'i'
		)
		const mB = reB.exec(html)
		if (mB?.[1]) return decodeHtmlEntities(mB[1])
	}
	return ''
}

function extractTitleTag(html: string): string {
	const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
	return match?.[1] ? decodeHtmlEntities(match[1].replace(/\s+/g, ' ')) : ''
}

function extractFaviconHref(html: string): string {
	const re = /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']*)["'][^>]*>/i
	const m = re.exec(html)
	if (m?.[1]) return decodeHtmlEntities(m[1])
	const reRev = /<link[^>]+href=["']([^"']*)["'][^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/i
	const mRev = reRev.exec(html)
	return mRev?.[1] ? decodeHtmlEntities(mRev[1]) : ''
}

function resolveSafePublicMediaUrl(rawHref: string, baseUrl: string): string | null {
	if (!rawHref) return null
	try {
		const resolved = new URL(rawHref, baseUrl)
		if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null
		if (!isSafeUrl(resolved.toString())) return null
		const host = resolved.hostname.toLowerCase()
		if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return null
		return resolved.toString()
	} catch {
		return null
	}
}

export async function unfurlBookmarkUrl(
	rawUrl: string,
	egressOpts?: SafeEgressOptions
): Promise<BookmarkMetadataDto> {
	let response: Awaited<ReturnType<typeof safeEgressFetch>>
	try {
		response = await safeEgressFetch(rawUrl, {
			method: 'GET',
			maxBytes: 128 * 1024,
			timeoutMs: 4_000,
			headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' },
			...egressOpts
		})
	} catch (err) {
		if (err instanceof SsrfBlockedError) {
			throw new HttpError(400, 'ssrf_blocked', err.message)
		}
		throw new HttpError(502, 'egress_failed', 'Failed to fetch bookmark metadata')
	}

	const finalUrl = response.finalUrl
	const parsedFinal = new URL(finalUrl)
	const html = new TextDecoder().decode(response.bodyBytes)

	const title =
		extractMetaContent(html, ['og:title', 'twitter:title']) || extractTitleTag(html) || parsedFinal.hostname
	const description = extractMetaContent(html, ['og:description', 'description', 'twitter:description']) || ''
	const siteName = extractMetaContent(html, ['og:site_name']) || parsedFinal.hostname
	const rawImage = extractMetaContent(html, ['og:image', 'twitter:image'])
	const rawFavicon = extractFaviconHref(html) || `${parsedFinal.origin}/favicon.ico`

	return {
		url: finalUrl,
		title: title.slice(0, 240),
		description: description.slice(0, 500),
		siteName: siteName.slice(0, 120),
		faviconUrl: resolveSafePublicMediaUrl(rawFavicon, finalUrl),
		imageUrl: resolveSafePublicMediaUrl(rawImage, finalUrl)
	}
}

// ---------- Button Block Execution ----------

export async function triggerDocButton(
	tx: Queryable,
	actor: ActorContext,
	pageId: string,
	input: DocButtonTriggerBody,
	hasCollabBridge: boolean
): Promise<{
	readonly triggered: true
	readonly nodesToAppend?: readonly ProseMirrorNodeJson[]
	readonly cursor: number
}> {
	const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.write')
	assertPageUnlocked(page)

	let nodesToAppend: ProseMirrorNodeJson[] | undefined
	if (input.actionKind === 'append_template') {
		const markdown =
			typeof input.payload?.['markdown'] === 'string' && input.payload['markdown'].trim().length > 0
				? input.payload['markdown']
				: `\n- Action executed: **${input.label}**`
		const pmJson = markdownToProseMirrorJson(markdown, `btn:${input.buttonId}:${Date.now()}`)
		nodesToAppend = Array.isArray(pmJson['content']) ? (pmJson['content'] as ProseMirrorNodeJson[]) : []

		if (!hasCollabBridge && nodesToAppend.length > 0) {
			const stateRow = await getDocStateRow(tx, actor.workspaceId, page.id)
			const ydoc = new Y.Doc()
			Y.applyUpdate(ydoc, stateRow ? new Uint8Array(stateRow.state) : createEmptyYDocState().state)
			appendProseMirrorNodesToYDoc(
				ydoc,
				nodesToAppend as unknown as Record<string, unknown>[],
				`button:${input.buttonId}`
			)
			const nextState = Y.encodeStateAsUpdate(ydoc)
			const nextVector = Y.encodeStateVector(ydoc)
			assertWithinMaxDocSize(nextState)
			const extracted = extractDocumentContent(ydoc)
			await saveUnfencedDocState(tx, {
				workspaceId: actor.workspaceId,
				pageId: page.id,
				state: nextState,
				stateVector: nextVector,
				byteSize: nextState.byteLength,
				plainText: extracted.plainText,
				headings: extracted.headings
			})
		}
	}

	await emitDocsEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'doc_page',
		aggregateId: page.id,
		eventType: DOCS_EVENTS.ButtonTriggered,
		payload: {
			pageId: page.id,
			buttonId: input.buttonId,
			label: input.label,
			actionKind: input.actionKind,
			automationRuleId: input.automationRuleId ?? null,
			payload: input.payload ?? {},
			actorId: actor.principalId
		}
	})

	await auditDocsAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'doc.button.triggered',
		targetType: 'doc_page',
		targetId: page.id,
		metadata: { buttonId: input.buttonId, actionKind: input.actionKind }
	})

	if (hasCollabBridge && nodesToAppend && nodesToAppend.length > 0) {
		const lastCursor = await appendChanges(tx, actor.workspaceId, [])
		return { triggered: true, nodesToAppend, cursor: lastCursor }
	}

	const updatedPage = await getDocPageById(tx, actor.workspaceId, page.id, actor.userId)
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'doc_page',
		entityId: page.id,
		action: 'upsert',
		scope: [`doc_page:${page.id}`, `visibility:${page.visibility}`],
		payload: (updatedPage ?? page) as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})
	return { triggered: true, cursor }
}
