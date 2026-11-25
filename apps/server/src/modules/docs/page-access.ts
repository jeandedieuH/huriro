/**
 * Shared Docs page authorization, slug validation, and size guard helpers.
 * Extracted into a leaf module so sub-services never introduce circular imports
 * with `service.ts`.
 */
import type { DocPageDto } from '@huriro/contracts'
import { isAcceptableClientId, type Queryable } from '@huriro/db'
import type { ActorContext as DomainActor } from '@huriro/domain'
import { DOCUMENT_SIZE_MAX_BYTES, DOCUMENT_SIZE_WARN_BYTES } from '@huriro/editor'
import { HttpError } from '../../api/error'
import { log } from '../../api/observability'
import { resolveResourceAcl } from '../tenancy'
import { authorizeDocPage, canActorDocPage, isAdminDocBypass } from './policy'
import { docSlugExists, getDocPageById } from './repo'
import { getTeamspaceById, getTeamspaceMemberRole } from './repo-m9'

export function assertValidClientId(id: string | undefined, label: string): void {
	if (id !== undefined && !isAcceptableClientId(id)) {
		throw new HttpError(
			422,
			'validation_failed',
			`Invalid client-supplied ${label}: must be UUIDv7 within ±24h window`
		)
	}
}

export function throwStaleVersion(
	entityLabel: string,
	currentVersion: number,
	yourVersion: number,
	currentEntity: Record<string, unknown>,
	changedFields?: string[]
): never {
	throw new HttpError(409, 'stale_version', `${entityLabel} changed since you loaded it`, undefined, {
		currentVersion,
		yourVersion,
		currentEntity,
		...(changedFields ? { changedFields } : {})
	})
}

export function slugifyDocTitle(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 100)
		.replace(/-+$/g, '')
	return slug.length > 0 ? slug : 'untitled'
}

export async function ensureUniqueDocSlug(
	tx: Queryable,
	workspaceId: string,
	requestedSlug: string | undefined,
	title: string,
	pageId: string
): Promise<string> {
	if (requestedSlug !== undefined) {
		const conflict = await docSlugExists(tx, workspaceId, requestedSlug, pageId)
		if (conflict) {
			throw new HttpError(409, 'conflict', `Document slug "${requestedSlug}" is already in use`)
		}
		return requestedSlug
	}
	const base = slugifyDocTitle(title)
	if (!(await docSlugExists(tx, workspaceId, base, pageId))) {
		return base
	}
	for (let i = 2; i <= 20; i++) {
		const candidate = `${base.slice(0, 96)}-${i}`
		if (!(await docSlugExists(tx, workspaceId, candidate, pageId))) {
			return candidate
		}
	}
	return `${base.slice(0, 90)}-${pageId.slice(0, 8)}`
}

export function assertWithinMaxDocSize(bytes: Uint8Array): void {
	if (bytes.byteLength > DOCUMENT_SIZE_MAX_BYTES) {
		throw new HttpError(413, 'doc_too_large', `Document size (${bytes.byteLength} bytes) exceeds 10 MB limit`)
	}
	if (bytes.byteLength > DOCUMENT_SIZE_WARN_BYTES) {
		log.warn({ byteSize: bytes.byteLength }, 'document exceeds 2 MB soft size threshold')
	}
}

export async function assertPrivateTeamspaceMembershipIfApplicable(
	tx: Queryable,
	actor: DomainActor,
	page: DocPageDto,
	explicitPageAcl: string | null
): Promise<void> {
	if (!page.teamspaceId) return
	if (isAdminDocBypass(actor)) return
	if (explicitPageAcl !== null) return

	const teamspace = await getTeamspaceById(tx, actor.workspaceId, page.teamspaceId)
	if (!teamspace || teamspace.visibility !== 'private') return

	const [memberRole, tsAcl] = await Promise.all([
		getTeamspaceMemberRole(tx, actor.workspaceId, teamspace.id, actor.userId),
		resolveResourceAcl(tx, {
			workspaceId: actor.workspaceId,
			resourceType: 'teamspace',
			resourceId: teamspace.id,
			userId: actor.userId
		})
	])
	if (memberRole === null && tsAcl === null) {
		throw new HttpError(403, 'resource_private', 'Private teamspace document access denied')
	}
}

export async function authorizeWorkspaceDocAction(
	tx: Queryable,
	actor: DomainActor,
	action: 'doc.read' | 'doc.write'
): Promise<void> {
	await authorizeDocPage(tx, actor, action, { id: actor.workspaceId, visibility: 'workspace' }, null)
}

export async function requireDocPageAccess(
	tx: Queryable,
	actor: DomainActor,
	pageId: string,
	action: 'doc.read' | 'doc.comment' | 'doc.write' | 'doc.share' | 'doc.verify' | 'doc.publish'
): Promise<{
	readonly page: DocPageDto
	readonly canWrite: boolean
	readonly canShare: boolean
	readonly canVerify: boolean
	readonly canPublish: boolean
}> {
	const page = await getDocPageById(tx, actor.workspaceId, pageId, actor.userId)
	if (!page || page.archivedAt !== null) {
		throw new HttpError(404, 'not_found', 'Document page not found')
	}
	const acl = await resolveResourceAcl(tx, {
		workspaceId: actor.workspaceId,
		resourceType: 'doc_page',
		resourceId: page.id,
		userId: actor.userId
	})
	await assertPrivateTeamspaceMembershipIfApplicable(tx, actor, page, acl)
	await authorizeDocPage(tx, actor, action, page, acl)

	const canWriteAcl = canActorDocPage(actor, 'doc.write', page, acl)
	return {
		page,
		canWrite: canWriteAcl && !(page.isLocked ?? false),
		canShare: canActorDocPage(actor, 'doc.share', page, acl),
		canVerify: canActorDocPage(actor, 'doc.verify', page, acl),
		canPublish: canActorDocPage(actor, 'doc.publish', page, acl)
	}
}

export function assertPageUnlocked(page: DocPageDto): void {
	if (page.isLocked) {
		throw new HttpError(409, 'doc_locked', 'Document is locked and cannot be edited')
	}
}
