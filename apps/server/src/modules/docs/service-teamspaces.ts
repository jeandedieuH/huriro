/**
 * Teamspaces domain service (§4.4).
 */
import type {
	AddTeamspaceMemberBody,
	CreateTeamspaceBody,
	TeamspaceDefaultAclEntryDto,
	TeamspaceDto,
	TeamspaceMemberDto,
	TeamspaceRole,
	UpdateTeamspaceBody
} from '@huriro/contracts'
import type { Queryable } from '@huriro/db'
import {
	type ActorContext,
	aclSatisfies,
	generateKeyBetween,
	needsRebalance,
	rebalanceKeys
} from '@huriro/domain'
import { appendChange } from '../../api/changelog'
import { HttpError } from '../../api/error'
import { grantAcl, listAclEntriesForResource, resolveResourceAcl } from '../tenancy'
import { DOCS_EVENTS } from './events'
import { slugifyDocTitle, throwStaleVersion } from './page-access'
import { authorizeTeamspace, isAdminTeamspaceBypass } from './policy'
import { auditDocsAction, emitDocsEvent } from './repo'
import {
	deleteTeamspaceMemberRow,
	getLastTeamspacePosition,
	getTeamspaceById,
	getTeamspaceMemberRole,
	insertTeamspaceRow,
	listTeamspaceMemberRows,
	listVisibleTeamspacesRows,
	teamspaceSlugExists,
	updateTeamspaceRow,
	upsertTeamspaceMemberRow
} from './repo-m9'

function validateDefaultAclEntries(entries: readonly TeamspaceDefaultAclEntryDto[]): void {
	for (const entry of entries) {
		if (entry.principalType === 'workspace' && entry.principalId !== null) {
			throw new HttpError(422, 'validation_failed', 'workspace default ACL entry must have null principalId')
		}
		if (entry.principalType !== 'workspace' && !entry.principalId) {
			throw new HttpError(422, 'validation_failed', 'user/role default ACL entry requires principalId')
		}
	}
}

async function ensureUniqueTeamspaceSlug(
	tx: Queryable,
	workspaceId: string,
	requestedSlug: string | undefined,
	name: string,
	excludeId?: string
): Promise<string> {
	if (requestedSlug !== undefined) {
		const conflict = await teamspaceSlugExists(tx, workspaceId, requestedSlug, excludeId)
		if (conflict) {
			throw new HttpError(409, 'conflict', `Teamspace slug "${requestedSlug}" is already in use`)
		}
		return requestedSlug
	}
	const base = slugifyDocTitle(name)
	if (!(await teamspaceSlugExists(tx, workspaceId, base, excludeId))) {
		return base
	}
	for (let i = 2; i <= 20; i++) {
		const candidate = `${base.slice(0, 96)}-${i}`
		if (!(await teamspaceSlugExists(tx, workspaceId, candidate, excludeId))) {
			return candidate
		}
	}
	return `${base.slice(0, 88)}-${crypto.randomUUID().slice(0, 8)}`
}

export async function listVisibleTeamspaces(
	tx: Queryable,
	actor: ActorContext,
	includeArchived = false
): Promise<TeamspaceDto[]> {
	if (actor.membership !== 'active') return []
	return listVisibleTeamspacesRows(tx, {
		workspaceId: actor.workspaceId,
		userId: actor.userId,
		bypassAcl: isAdminTeamspaceBypass(actor),
		includeArchived
	})
}

export async function requireTeamspaceReadAccess(
	tx: Queryable,
	actor: ActorContext,
	teamspaceId: string
): Promise<{ readonly teamspace: TeamspaceDto; readonly memberRole: TeamspaceRole | null }> {
	const teamspace = await getTeamspaceById(tx, actor.workspaceId, teamspaceId)
	if (!teamspace || teamspace.archivedAt !== null) {
		throw new HttpError(404, 'not_found', 'Teamspace not found')
	}
	const [acl, memberRole] = await Promise.all([
		resolveResourceAcl(tx, {
			workspaceId: actor.workspaceId,
			resourceType: 'teamspace',
			resourceId: teamspace.id,
			userId: actor.userId
		}),
		getTeamspaceMemberRole(tx, actor.workspaceId, teamspace.id, actor.userId)
	])
	await authorizeTeamspace(tx, actor, 'doc.read', teamspace, acl, memberRole)
	return { teamspace, memberRole }
}

export async function requireTeamspaceWriteAccess(
	tx: Queryable,
	actor: ActorContext,
	teamspaceId: string
): Promise<{ readonly teamspace: TeamspaceDto; readonly memberRole: TeamspaceRole | null }> {
	const teamspace = await getTeamspaceById(tx, actor.workspaceId, teamspaceId)
	if (!teamspace || teamspace.archivedAt !== null) {
		throw new HttpError(404, 'not_found', 'Teamspace not found')
	}
	const [acl, memberRole] = await Promise.all([
		resolveResourceAcl(tx, {
			workspaceId: actor.workspaceId,
			resourceType: 'teamspace',
			resourceId: teamspace.id,
			userId: actor.userId
		}),
		getTeamspaceMemberRole(tx, actor.workspaceId, teamspace.id, actor.userId)
	])
	await authorizeTeamspace(tx, actor, 'doc.write', teamspace, acl, memberRole)

	if (
		(teamspace.visibility === 'closed' || teamspace.visibility === 'private') &&
		!isAdminTeamspaceBypass(actor)
	) {
		const isMemberEditor = memberRole === 'owner' || memberRole === 'member'
		const hasAclWrite = acl !== null && aclSatisfies(acl, 'write')
		if (!isMemberEditor && !hasAclWrite) {
			throw new HttpError(403, 'resource_private', `Teamspace "${teamspace.name}" requires editor membership`)
		}
	}
	return { teamspace, memberRole }
}

export async function createTeamspace(
	tx: Queryable,
	actor: ActorContext,
	input: CreateTeamspaceBody
): Promise<{ readonly data: TeamspaceDto; readonly cursor: number }> {
	await authorizeTeamspace(
		tx,
		actor,
		'teamspace.manage',
		{ id: actor.workspaceId, visibility: 'open' },
		null,
		null
	)

	const defaultAcl = input.defaultAcl ?? []
	validateDefaultAclEntries(defaultAcl)

	const slug = await ensureUniqueTeamspaceSlug(tx, actor.workspaceId, input.slug, input.name)
	const lastPos = await getLastTeamspacePosition(tx, actor.workspaceId)
	const position = generateKeyBetween(lastPos, null)
	const visibility = input.visibility ?? 'open'

	const teamspace = await insertTeamspaceRow(tx, {
		workspaceId: actor.workspaceId,
		name: input.name,
		slug,
		icon: input.icon ?? null,
		description: input.description ?? '',
		visibility,
		defaultAcl,
		position,
		createdBy: actor.userId
	})

	if (actor.kind === 'user') {
		await upsertTeamspaceMemberRow(tx, {
			workspaceId: actor.workspaceId,
			teamspaceId: teamspace.id,
			userId: actor.userId,
			role: 'owner'
		})
	}

	if (visibility === 'private' && actor.kind === 'user') {
		await grantAcl(tx, {
			workspaceId: actor.workspaceId,
			resourceType: 'teamspace',
			resourceId: teamspace.id,
			principalType: 'user',
			principalId: actor.userId,
			permission: 'manage',
			grantedBy: actor.userId
		})
	}

	await emitDocsEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'teamspace',
		aggregateId: teamspace.id,
		eventType: DOCS_EVENTS.TeamspaceCreated,
		payload: { teamspaceId: teamspace.id, slug: teamspace.slug, visibility, actorId: actor.principalId }
	})

	await auditDocsAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'teamspace.created',
		targetType: 'teamspace',
		targetId: teamspace.id,
		metadata: { slug: teamspace.slug, visibility }
	})

	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'teamspace',
		entityId: teamspace.id,
		action: 'upsert',
		scope: [`teamspace:${teamspace.id}`, `visibility:${visibility === 'private' ? 'private' : 'workspace'}`],
		payload: teamspace as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})

	if (needsRebalance([position])) {
		const all = await listVisibleTeamspacesRows(tx, {
			workspaceId: actor.workspaceId,
			userId: actor.userId,
			bypassAcl: true
		})
		const fresh = rebalanceKeys(all.length)
		for (let i = 0; i < all.length; i++) {
			const row = all[i]
			const pos = fresh[i]
			if (row && pos && row.position !== pos) {
				await tx`UPDATE teamspaces SET position = ${pos} WHERE workspace_id = ${actor.workspaceId} AND id = ${row.id}`
			}
		}
	}

	return { data: teamspace, cursor }
}

export async function updateTeamspace(
	tx: Queryable,
	actor: ActorContext,
	teamspaceId: string,
	input: UpdateTeamspaceBody
): Promise<{ readonly data: TeamspaceDto; readonly cursor: number }> {
	const existing = await getTeamspaceById(tx, actor.workspaceId, teamspaceId)
	if (!existing || existing.archivedAt !== null) {
		throw new HttpError(404, 'not_found', 'Teamspace not found')
	}
	const [acl, memberRole] = await Promise.all([
		resolveResourceAcl(tx, {
			workspaceId: actor.workspaceId,
			resourceType: 'teamspace',
			resourceId: existing.id,
			userId: actor.userId
		}),
		getTeamspaceMemberRole(tx, actor.workspaceId, existing.id, actor.userId)
	])
	await authorizeTeamspace(tx, actor, 'teamspace.manage', existing, acl, memberRole)

	if (existing.version !== input.version) {
		throwStaleVersion(
			'Teamspace',
			existing.version,
			input.version,
			existing as unknown as Record<string, unknown>
		)
	}

	const nextDefaultAcl = input.defaultAcl ?? existing.defaultAcl
	validateDefaultAclEntries(nextDefaultAcl)

	const nextSlug =
		input.slug !== undefined && input.slug !== existing.slug
			? await ensureUniqueTeamspaceSlug(
					tx,
					actor.workspaceId,
					input.slug,
					input.name ?? existing.name,
					existing.id
				)
			: existing.slug
	const nextVisibility = input.visibility ?? existing.visibility
	const nextArchivedAt =
		input.archived === true ? new Date().toISOString() : input.archived === false ? null : existing.archivedAt

	const updated = await updateTeamspaceRow(tx, {
		workspaceId: actor.workspaceId,
		teamspaceId: existing.id,
		expectedVersion: input.version,
		name: input.name ?? existing.name,
		slug: nextSlug,
		icon: input.icon === undefined ? existing.icon : input.icon,
		description: input.description ?? existing.description,
		visibility: nextVisibility,
		defaultAcl: nextDefaultAcl,
		archivedAt: nextArchivedAt
	})
	if (!updated) {
		const latest = await getTeamspaceById(tx, actor.workspaceId, teamspaceId)
		throwStaleVersion(
			'Teamspace',
			latest?.version ?? existing.version,
			input.version,
			(latest ?? existing) as unknown as Record<string, unknown>
		)
	}

	await emitDocsEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'teamspace',
		aggregateId: updated.id,
		eventType: DOCS_EVENTS.TeamspaceUpdated,
		payload: {
			teamspaceId: updated.id,
			slug: updated.slug,
			visibility: updated.visibility,
			actorId: actor.principalId
		}
	})

	await auditDocsAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'teamspace.updated',
		targetType: 'teamspace',
		targetId: updated.id,
		metadata: { slug: updated.slug, visibility: updated.visibility }
	})

	const isNewlyArchived = existing.archivedAt === null && updated.archivedAt !== null
	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'teamspace',
		entityId: updated.id,
		action: isNewlyArchived ? 'delete' : 'upsert',
		scope: [
			`teamspace:${updated.id}`,
			`visibility:${updated.visibility === 'private' ? 'private' : 'workspace'}`
		],
		payload: isNewlyArchived ? null : (updated as unknown as Record<string, unknown>),
		actorId: actor.principalId
	})

	return { data: updated, cursor }
}

export async function archiveTeamspace(
	tx: Queryable,
	actor: ActorContext,
	teamspaceId: string,
	version?: number
): Promise<{ readonly data: TeamspaceDto; readonly cursor: number }> {
	let expectedVersion = version
	if (expectedVersion === undefined) {
		const existing = await getTeamspaceById(tx, actor.workspaceId, teamspaceId)
		if (!existing || existing.archivedAt !== null) {
			throw new HttpError(404, 'not_found', 'Teamspace not found')
		}
		expectedVersion = existing.version
	}
	return updateTeamspace(tx, actor, teamspaceId, { archived: true, version: expectedVersion })
}

export async function listTeamspaceMembers(
	tx: Queryable,
	actor: ActorContext,
	teamspaceId: string
): Promise<TeamspaceMemberDto[]> {
	await requireTeamspaceReadAccess(tx, actor, teamspaceId)
	return listTeamspaceMemberRows(tx, actor.workspaceId, teamspaceId)
}

export async function addTeamspaceMember(
	tx: Queryable,
	actor: ActorContext,
	teamspaceId: string,
	input: AddTeamspaceMemberBody
): Promise<{ readonly data: TeamspaceMemberDto; readonly cursor: number }> {
	const teamspace = await getTeamspaceById(tx, actor.workspaceId, teamspaceId)
	if (!teamspace || teamspace.archivedAt !== null) {
		throw new HttpError(404, 'not_found', 'Teamspace not found')
	}

	const [acl, actorRole] = await Promise.all([
		resolveResourceAcl(tx, {
			workspaceId: actor.workspaceId,
			resourceType: 'teamspace',
			resourceId: teamspace.id,
			userId: actor.userId
		}),
		getTeamspaceMemberRole(tx, actor.workspaceId, teamspace.id, actor.userId)
	])

	const role: TeamspaceRole = input.role ?? 'member'
	const isSelfJoinOpen = teamspace.visibility === 'open' && input.userId === actor.userId && role === 'member'
	if (!isSelfJoinOpen && actorRole !== 'owner') {
		await authorizeTeamspace(tx, actor, 'teamspace.manage', teamspace, acl, actorRole)
	}

	const member = await upsertTeamspaceMemberRow(tx, {
		workspaceId: actor.workspaceId,
		teamspaceId: teamspace.id,
		userId: input.userId,
		role
	})

	await emitDocsEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'teamspace',
		aggregateId: teamspace.id,
		eventType: DOCS_EVENTS.TeamspaceMemberUpdated,
		payload: {
			teamspaceId: teamspace.id,
			userId: input.userId,
			role,
			action: 'added',
			actorId: actor.principalId
		}
	})

	await auditDocsAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'teamspace.member.added',
		targetType: 'teamspace',
		targetId: teamspace.id,
		metadata: { userId: input.userId, role }
	})

	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'teamspace',
		entityId: teamspace.id,
		action: 'upsert',
		scope: [
			`teamspace:${teamspace.id}`,
			`visibility:${teamspace.visibility === 'private' ? 'private' : 'workspace'}`
		],
		payload: teamspace as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})

	return { data: member, cursor }
}

export async function removeTeamspaceMember(
	tx: Queryable,
	actor: ActorContext,
	teamspaceId: string,
	targetUserId: string
): Promise<{ readonly removed: boolean; readonly cursor: number }> {
	const teamspace = await getTeamspaceById(tx, actor.workspaceId, teamspaceId)
	if (!teamspace || teamspace.archivedAt !== null) {
		throw new HttpError(404, 'not_found', 'Teamspace not found')
	}

	const [acl, actorRole] = await Promise.all([
		resolveResourceAcl(tx, {
			workspaceId: actor.workspaceId,
			resourceType: 'teamspace',
			resourceId: teamspace.id,
			userId: actor.userId
		}),
		getTeamspaceMemberRole(tx, actor.workspaceId, teamspace.id, actor.userId)
	])

	const isSelfLeave = targetUserId === actor.userId && teamspace.visibility === 'open'
	if (!isSelfLeave && actorRole !== 'owner') {
		await authorizeTeamspace(tx, actor, 'teamspace.manage', teamspace, acl, actorRole)
	}

	const removed = await deleteTeamspaceMemberRow(tx, actor.workspaceId, teamspace.id, targetUserId)
	if (!removed) {
		throw new HttpError(404, 'not_found', 'Teamspace member not found')
	}

	await emitDocsEvent(tx, {
		workspaceId: actor.workspaceId,
		aggregate: 'teamspace',
		aggregateId: teamspace.id,
		eventType: DOCS_EVENTS.TeamspaceMemberUpdated,
		payload: {
			teamspaceId: teamspace.id,
			userId: targetUserId,
			action: 'removed',
			actorId: actor.principalId
		}
	})

	await auditDocsAction(tx, {
		workspaceId: actor.workspaceId,
		actorType: actor.kind === 'agent' ? 'agent' : 'user',
		actorId: actor.principalId,
		action: 'teamspace.member.removed',
		targetType: 'teamspace',
		targetId: teamspace.id,
		metadata: { userId: targetUserId }
	})

	const cursor = await appendChange(tx, actor.workspaceId, {
		entityType: 'teamspace',
		entityId: teamspace.id,
		action: 'upsert',
		scope: [
			`teamspace:${teamspace.id}`,
			`visibility:${teamspace.visibility === 'private' ? 'private' : 'workspace'}`
		],
		payload: teamspace as unknown as Record<string, unknown>,
		actorId: actor.principalId
	})

	return { removed, cursor }
}

export async function applyTeamspaceDefaultAcls(
	tx: Queryable,
	workspaceId: string,
	teamspaceId: string,
	pageId: string,
	grantedBy: string
): Promise<void> {
	const teamspace = await getTeamspaceById(tx, workspaceId, teamspaceId)
	if (!teamspace || teamspace.defaultAcl.length === 0) return

	const existing = await listAclEntriesForResource(tx, workspaceId, 'doc_page', pageId)
	for (const entry of teamspace.defaultAcl) {
		const dup = existing.some(
			(e) =>
				e.principalType === entry.principalType &&
				e.principalId === entry.principalId &&
				e.permission === entry.permission
		)
		if (dup) continue
		await grantAcl(tx, {
			workspaceId,
			resourceType: 'doc_page',
			resourceId: pageId,
			principalType: entry.principalType,
			principalId: entry.principalId,
			permission: entry.permission,
			grantedBy
		})
	}
}
