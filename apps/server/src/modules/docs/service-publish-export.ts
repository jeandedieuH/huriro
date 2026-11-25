/**
 * Docs Publish to Web & Rich Exports domain service (§4.5, Gate G9).
 */
import type {
	DocExportFormat,
	DocExportHtmlResponse,
	DocExportMarkdownResponse,
	DocPublicShareDto,
	PublicDocChildDto,
	PublicDocResponse,
	UpsertDocPublicShareBody
} from '@huriro/contracts'
import { type Queryable, type Sql, withSystem, withWorkspace } from '@huriro/db'
import type { ActorContext } from '@huriro/domain'
import {
	createEmptyYDocState,
	extractDocumentContent,
	proseMirrorJsonToSafeHtml,
	renderStandaloneHtmlDocument,
	ydocToMarkdown,
	ydocToProseMirrorJson
} from '@huriro/editor'
import { strToU8, zipSync } from 'fflate'
import * as Y from 'yjs'
import { appendChange } from '../../api/changelog'
import { HttpError } from '../../api/error'
import { DOCS_EVENTS } from './events'
import { requireDocPageAccess, slugifyDocTitle } from './page-access'
import { auditDocsAction, emitDocsEvent, getDocPageById, getDocStateRow } from './repo'
import {
	getDocPublicShareByPageId,
	listDocDescendantsWithState,
	publicShareSlugExists,
	revokeDocPublicShareRow,
	upsertDocPublicShareRow
} from './repo-m9'

export async function getDocPublicShare(
	tx: Queryable,
	actor: ActorContext,
	pageId: string
): Promise<DocPublicShareDto | null> {
	const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.read')
	return getDocPublicShareByPageId(tx, actor.workspaceId, page.id)
}

async function ensureUniquePublicSlug(
	tx: Queryable,
	workspaceId: string,
	requested: string | undefined,
	fallbackTitle: string,
	pageId: string
): Promise<string> {
	if (requested) {
		const taken = await publicShareSlugExists(tx, workspaceId, requested, pageId)
		if (taken) {
			throw new HttpError(409, 'conflict', `Public slug "${requested}" is already in use`)
		}
		return requested
	}
	const base = slugifyDocTitle(fallbackTitle)
	if (!(await publicShareSlugExists(tx, workspaceId, base, pageId))) {
		return base
	}
	for (let i = 2; i <= 20; i++) {
		const candidate = `${base.slice(0, 96)}-${i}`
		if (!(await publicShareSlugExists(tx, workspaceId, candidate, pageId))) {
			return candidate
		}
	}
	return `${base.slice(0, 90)}-${pageId.slice(0, 8)}`
}

export async function upsertDocPublicShare(
	tx: Queryable,
	actor: ActorContext,
	pageId: string,
	input: UpsertDocPublicShareBody
): Promise<{ readonly data: DocPublicShareDto; readonly cursor: number }> {
	const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.publish')
	const existing = await getDocPublicShareByPageId(tx, actor.workspaceId, page.id)
	const publicSlug = await ensureUniquePublicSlug(
		tx,
		actor.workspaceId,
		input.publicSlug ?? existing?.publicSlug,
		page.slug || page.title,
		page.id
	)

	let passwordHash: string | null | undefined
	let keepExistingPassword = false
	if (input.password === undefined) {
		keepExistingPassword = true
	} else if (input.password === null) {
		passwordHash = null
	} else {
		passwordHash = await Bun.password.hash(input.password, { algorithm: 'argon2id' })
	}

	const share = await upsertDocPublicShareRow(tx, {
		workspaceId: actor.workspaceId,
		pageId: page.id,
		publicSlug,
		includeChildren: input.includeChildren ?? existing?.includeChildren ?? false,
		allowSearchIndexing: input.allowSearchIndexing ?? existing?.allowSearchIndexing ?? false,
		passwordHash,
		keepExistingPassword,
		expiresAt: input.expiresAt === undefined ? (existing?.expiresAt ?? null) : input.expiresAt,
		createdBy: actor.userId
	})

	await emitDocsEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'doc_public_share',
		aggregateId: share.id,
		eventType: DOCS_EVENTS.PublicShareUpdated,
		payload: {
			pageId: page.id,
			shareId: share.id,
			publicSlug: share.publicSlug,
			allowSearchIndexing: share.allowSearchIndexing,
			hasPassword: share.hasPassword,
			actorId: actor.principalId
		}
	})

	await auditDocsAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'doc.public_share.updated',
		targetType: 'doc_page',
		targetId: page.id,
		metadata: {
			publicSlug: share.publicSlug,
			allowSearchIndexing: share.allowSearchIndexing,
			hasPassword: share.hasPassword
		}
	})

	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'doc_page',
		entityId: page.id,
		action: 'upsert',
		scope: [`doc_page:${page.id}`, `visibility:${page.visibility}`],
		payload: page as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})

	return { data: share, cursor }
}

export async function revokeDocPublicShare(
	tx: Queryable,
	actor: ActorContext,
	pageId: string
): Promise<{ readonly revoked: boolean; readonly cursor: number }> {
	const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.publish')
	const share = await revokeDocPublicShareRow(tx, actor.workspaceId, page.id)
	if (!share) {
		throw new HttpError(404, 'not_found', 'Active public share link not found')
	}

	await emitDocsEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'doc_public_share',
		aggregateId: share.id,
		eventType: DOCS_EVENTS.PublicShareRevoked,
		payload: { pageId: page.id, shareId: share.id, publicSlug: share.publicSlug, actorId: actor.principalId }
	})

	await auditDocsAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'doc.public_share.revoked',
		targetType: 'doc_page',
		targetId: page.id,
		metadata: { publicSlug: share.publicSlug }
	})

	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'doc_page',
		entityId: page.id,
		action: 'upsert',
		scope: [`doc_page:${page.id}`, `visibility:${page.visibility}`],
		payload: page as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})

	return { revoked: true, cursor }
}

interface PublicShareLookupRow {
	readonly shareId: string
	readonly workspaceId: string
	readonly workspaceSlug: string
	readonly workspaceName: string
	readonly pageId: string
	readonly publicSlug: string
	readonly includeChildren: boolean
	readonly allowSearchIndexing: boolean
	readonly passwordHash: string | null
	readonly expiresAt: string | null
}

function renderYDocToPublicArtifacts(stateBytes: Uint8Array | Buffer | null) {
	const ydoc = new Y.Doc()
	Y.applyUpdate(ydoc, stateBytes ? new Uint8Array(stateBytes) : createEmptyYDocState().state)
	const pmJson = ydocToProseMirrorJson(ydoc)
	const html = proseMirrorJsonToSafeHtml(pmJson, { includeSuggestions: false })
	const markdown = ydocToMarkdown(ydoc)
	const extracted = extractDocumentContent(ydoc)
	return { html, markdown, headings: extracted.headings }
}

export async function resolvePublicDoc(
	sql: Sql,
	workspaceSlug: string,
	publicSlug: string,
	password?: string
): Promise<PublicDocResponse> {
	const lookup = await withSystem(sql, async (tx) => {
		const [row] = await tx<PublicShareLookupRow[]>`
			SELECT
				share_id AS "shareId",
				workspace_id AS "workspaceId",
				workspace_slug::text AS "workspaceSlug",
				workspace_name AS "workspaceName",
				page_id AS "pageId",
				public_slug AS "publicSlug",
				include_children AS "includeChildren",
				allow_search_indexing AS "allowSearchIndexing",
				password_hash AS "passwordHash",
				expires_at::text AS "expiresAt"
			FROM resolve_public_doc_share(${workspaceSlug}, ${publicSlug})
		`
		return row ?? null
	})

	if (!lookup) {
		throw new HttpError(404, 'not_found', 'Public document not found')
	}

	if (lookup.passwordHash) {
		if (!password) {
			return {
				workspaceSlug: lookup.workspaceSlug,
				workspaceName: lookup.workspaceName,
				publicSlug: lookup.publicSlug,
				pageId: lookup.pageId,
				title: 'Protected document',
				icon: null,
				coverGradient: null,
				fontStyle: 'sans',
				fullWidth: false,
				smallText: false,
				allowSearchIndexing: lookup.allowSearchIndexing,
				passwordRequired: true,
				html: '',
				markdown: '',
				headings: [],
				children: [],
				updatedAt: new Date(0).toISOString()
			}
		}
		const ok = await Bun.password.verify(password, lookup.passwordHash)
		if (!ok) {
			throw new HttpError(403, 'invalid_public_doc_password', 'Incorrect password for public document')
		}
	}

	return withWorkspace(sql, { workspaceId: lookup.workspaceId }, async (tx) => {
		const page = await getDocPageById(tx, lookup.workspaceId, lookup.pageId, lookup.workspaceId)
		if (!page || page.archivedAt !== null) {
			throw new HttpError(404, 'not_found', 'Public document not found')
		}
		const stateRow = await getDocStateRow(tx, lookup.workspaceId, page.id)
		const rendered = renderYDocToPublicArtifacts(stateRow?.state ?? null)

		const children: PublicDocChildDto[] = []
		if (lookup.includeChildren) {
			const descendants = await listDocDescendantsWithState(tx, lookup.workspaceId, page.path)
			for (const child of descendants) {
				const childRendered = renderYDocToPublicArtifacts(child.state)
				children.push({
					id: child.id,
					title: child.title,
					slug: child.slug,
					icon: child.icon,
					html: childRendered.html,
					markdown: childRendered.markdown,
					headings: childRendered.headings
				})
			}
		}

		return {
			workspaceSlug: lookup.workspaceSlug,
			workspaceName: lookup.workspaceName,
			publicSlug: lookup.publicSlug,
			pageId: page.id,
			title: page.title,
			icon: page.icon,
			coverGradient: page.coverGradient ?? null,
			fontStyle: page.fontStyle ?? 'sans',
			fullWidth: page.fullWidth ?? false,
			smallText: page.smallText ?? false,
			allowSearchIndexing: lookup.allowSearchIndexing,
			passwordRequired: false,
			html: rendered.html,
			markdown: rendered.markdown,
			headings: rendered.headings,
			children,
			updatedAt: page.updatedAt
		}
	})
}

export async function resolvePublicWorkspaceLlmsTxt(
	sql: Sql,
	workspaceSlug: string,
	baseUrl: string
): Promise<string | null> {
	const rows = await withSystem(
		sql,
		(tx) =>
			tx<
				Array<{
					readonly workspaceId: string
					readonly workspaceName: string
					readonly publicSlug: string
					readonly title: string
					readonly updatedAt: string
				}>
			>`
			SELECT
				workspace_id AS "workspaceId",
				workspace_name AS "workspaceName",
				public_slug AS "publicSlug",
				title,
				updated_at::text AS "updatedAt"
			FROM list_public_workspace_shares(${workspaceSlug})
		`
	)
	if (rows.length === 0) return null
	const cleanBase = baseUrl.replace(/\/+$/g, '')
	const workspaceName = rows[0]?.workspaceName ?? workspaceSlug
	const lines = [
		`# ${workspaceName} — Public Documentation`,
		'',
		'> Indexable public pages exposed in AI-friendly Markdown.',
		'',
		...rows.map(
			(r) =>
				`- [${r.title}](${cleanBase}/api/v1/public/docs/${workspaceSlug}/${r.publicSlug}.md) — updated ${r.updatedAt}`
		)
	]
	return `${lines.join('\n')}\n`
}

export type RichDocExportResult =
	| { readonly kind: 'markdown'; readonly data: DocExportMarkdownResponse }
	| { readonly kind: 'html'; readonly data: DocExportHtmlResponse }
	| { readonly kind: 'zip'; readonly filename: string; readonly bytes: Uint8Array }

export async function exportDocRich(
	tx: Queryable,
	actor: ActorContext,
	pageId: string,
	format: DocExportFormat,
	includeChildren = false
): Promise<RichDocExportResult> {
	const { page } = await requireDocPageAccess(tx, actor, pageId, 'doc.read')
	const stateRow = await getDocStateRow(tx, actor.workspaceId, page.id)
	const rendered = renderYDocToPublicArtifacts(stateRow?.state ?? null)

	if (format === 'markdown') {
		return {
			kind: 'markdown',
			data: { pageId: page.id, slug: page.slug, title: page.title, markdown: rendered.markdown }
		}
	}

	const buildStandaloneHtml = (title: string, htmlBody: string, autoPrint: boolean) =>
		renderStandaloneHtmlDocument({
			title,
			html: htmlBody,
			fontStyle: page.fontStyle ?? 'sans',
			fullWidth: page.fullWidth ?? false,
			smallText: page.smallText ?? false,
			allowSearchIndexing: false,
			printAuto: autoPrint
		})

	if (format === 'html' || format === 'pdf-html') {
		return {
			kind: 'html',
			data: {
				pageId: page.id,
				slug: page.slug,
				title: page.title,
				html: buildStandaloneHtml(page.title, rendered.html, format === 'pdf-html')
			}
		}
	}

	// format === 'zip'
	const files: Record<string, Uint8Array> = {}
	files[`${page.slug}.md`] = strToU8(rendered.markdown)
	files[`${page.slug}.html`] = strToU8(buildStandaloneHtml(page.title, rendered.html, false))

	if (includeChildren) {
		const descendants = await listDocDescendantsWithState(tx, actor.workspaceId, page.path)
		for (const child of descendants) {
			const childRendered = renderYDocToPublicArtifacts(child.state)
			files[`${page.slug}/${child.slug}.md`] = strToU8(childRendered.markdown)
			files[`${page.slug}/${child.slug}.html`] = strToU8(
				buildStandaloneHtml(child.title, childRendered.html, false)
			)
		}
	}

	const zipBytes = zipSync(files, { level: 6 })
	return {
		kind: 'zip',
		filename: `${page.slug}.zip`,
		bytes: zipBytes
	}
}
