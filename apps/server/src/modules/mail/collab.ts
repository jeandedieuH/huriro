/**
 * Mail draft collaboration room support (M11, ADR-0032). Drafts reuse the
 * single Hocuspocus runtime but persist state/vector and the single-home lease
 * directly on `mail_drafts`; room names are `mail_draft:<workspace>:<draft>`.
 */
import type { CollabTicketResponse } from '@huriro/contracts'
import { type Queryable, uuid7 } from '@huriro/db'
import type { ActorContext } from '@huriro/domain'
import { extractDocumentContent, ydocToProseMirrorJson } from '@huriro/editor'
import * as Y from 'yjs'
import { HttpError } from '../../api/error'
import {
	type CollabTicketClaims,
	deriveCollabTicketKey,
	hashCollabTicket,
	signCollabTicket,
	TICKET_TTL_MS
} from '../docs'
import type { MailDraftRow } from './repo'

export function mailDraftDocumentName(workspaceId: string, draftId: string): string {
	return `mail_draft:${workspaceId}:${draftId}`
}

export async function issueMailDraftCollabTicket(args: {
	readonly tx: Queryable
	readonly actor: ActorContext
	readonly draft: MailDraftRow
	readonly canWrite: boolean
	readonly ticketSecret: string
	readonly collabPath?: string
}): Promise<CollabTicketResponse> {
	if (!args.draft.collabEnabled) {
		throw new HttpError(409, 'conflict', 'Collaboration is not enabled for this draft')
	}
	const permission: 'read' | 'write' = args.canWrite ? 'write' : 'read'
	const jti = uuid7()
	const expiresAt = new Date(Date.now() + TICKET_TTL_MS)
	const ticket = signCollabTicket(deriveCollabTicketKey(args.ticketSecret), {
		jti,
		ws: args.actor.workspaceId,
		page: args.draft.id,
		kind: 'mail_draft',
		uid: args.actor.principalId,
		perm: permission,
		exp: expiresAt.getTime()
	})
	await args.tx`
		INSERT INTO collab_tickets (
			id, workspace_id, room_kind, page_id, synced_block_id, mail_draft_id,
			user_id, permission, token_hash, expires_at
		) VALUES (
			${jti}, ${args.actor.workspaceId}, 'mail_draft', NULL, NULL, ${args.draft.id},
			${args.actor.userId}, ${permission}, ${hashCollabTicket(ticket)}, ${expiresAt.toISOString()}::timestamptz
		)
	`
	return {
		ticket,
		documentName: mailDraftDocumentName(args.actor.workspaceId, args.draft.id),
		permission,
		expiresAt: expiresAt.toISOString(),
		collabUrl: args.collabPath ?? '/collab'
	}
}

export async function consumeAndAuthorizeMailDraftTicket(
	tx: Queryable,
	claims: CollabTicketClaims,
	rawToken: string,
	accessCheck: (draftId: string) => Promise<boolean>
): Promise<{ readonly permission: 'read' | 'write'; readonly readOnly: boolean }> {
	const [consumed] = await tx<{ permission: 'read' | 'write' }[]>`
		UPDATE collab_tickets
		SET consumed_at = now()
		WHERE workspace_id = ${claims.ws}
			AND id = ${claims.jti}
			AND room_kind = 'mail_draft'
			AND mail_draft_id = ${claims.page}
			AND user_id = ${claims.uid}
			AND token_hash = ${hashCollabTicket(rawToken)}
			AND consumed_at IS NULL
			AND expires_at > now()
		RETURNING permission
	`
	if (!consumed) {
		throw new HttpError(401, 'collab_ticket_invalid', 'Collaboration ticket is invalid, expired, or reused')
	}
	const allowed = await accessCheck(claims.page)
	if (!allowed) throw new HttpError(403, 'resource_private', 'Mail draft access denied')
	const permission = consumed.permission === 'write' ? 'write' : 'read'
	return { permission, readOnly: permission !== 'write' }
}

export async function acquireMailDraftRoomAndState(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly draftId: string
		readonly nodeId: string
		readonly ttlMs: number
	}
): Promise<
	| { readonly acquired: true; readonly epoch: number; readonly state: Uint8Array }
	| { readonly acquired: false; readonly ownerNodeId: string; readonly epoch: number }
> {
	const [row] = await tx<
		{
			leaseNodeId: string | null
			leaseEpoch: number
			draftState: Uint8Array | null
			collabEnabled: boolean
		}[]
	>`
		SELECT lease_node_id AS "leaseNodeId", lease_epoch::int AS "leaseEpoch",
			draft_state AS "draftState", collab_enabled AS "collabEnabled"
		FROM mail_drafts
		WHERE workspace_id = ${args.workspaceId} AND id = ${args.draftId} AND status = 'draft'
	`
	if (!row || !row.collabEnabled) throw new HttpError(404, 'not_found', 'Collaborative mail draft not found')
	const expiresAtMs = args.ttlMs
	const [lease] = await tx<{ nodeId: string; epoch: number }[]>`
		UPDATE mail_drafts
		SET lease_node_id = ${args.nodeId},
			lease_epoch = lease_epoch + 1,
			lease_expires_at = now() + (${expiresAtMs}::int * interval '1 millisecond')
		WHERE workspace_id = ${args.workspaceId}
			AND id = ${args.draftId}
			AND (
				lease_expires_at IS NULL
				OR lease_expires_at < now()
				OR lease_node_id = ${args.nodeId}
			)
		RETURNING lease_node_id AS "nodeId", lease_epoch::int AS epoch
	`
	if (!lease) {
		return { acquired: false, ownerNodeId: row.leaseNodeId ?? 'unknown', epoch: Number(row.leaseEpoch) }
	}
	return {
		acquired: true,
		epoch: Number(lease.epoch),
		state: row.draftState ? new Uint8Array(row.draftState) : new Uint8Array()
	}
}

export async function renewMailDraftRoomLease(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly draftId: string
		readonly nodeId: string
		readonly ttlMs: number
	}
): Promise<{ readonly acquired: boolean; readonly epoch: number; readonly ownerNodeId: string }> {
	const res = await acquireMailDraftRoomAndState(tx, args)
	return res.acquired
		? { acquired: true, epoch: res.epoch, ownerNodeId: args.nodeId }
		: { acquired: false, epoch: res.epoch, ownerNodeId: res.ownerNodeId }
}

export async function releaseMailDraftRoomLease(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly draftId: string
		readonly nodeId: string
		readonly epoch: number
	}
): Promise<void> {
	await tx`
		UPDATE mail_drafts
		SET lease_node_id = NULL, lease_expires_at = NULL
		WHERE workspace_id = ${args.workspaceId}
			AND id = ${args.draftId}
			AND lease_node_id = ${args.nodeId}
			AND lease_epoch = ${args.epoch}
	`
}

export async function persistMailDraftCollabState(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly draftId: string
		readonly nodeId: string
		readonly leaseEpoch: number
		readonly ydoc: Y.Doc
	}
): Promise<{ readonly fenced: boolean; readonly currentEpoch: number }> {
	const state = Y.encodeStateAsUpdate(args.ydoc)
	const stateVector = Y.encodeStateVector(args.ydoc)
	if (state.byteLength > 10 * 1024 * 1024) {
		throw new HttpError(413, 'validation_failed', 'Collaborative draft exceeds maximum size')
	}
	const extracted = extractDocumentContent(args.ydoc)
	const body = ydocToProseMirrorJson(args.ydoc)
	const [saved] = await tx<{ epoch: number }[]>`
		UPDATE mail_drafts
		SET draft_state = ${Buffer.from(state)}, draft_state_vector = ${Buffer.from(stateVector)},
			body = ${tx.json(body as never)}, body_text = ${extracted.plainText},
			version = version + 1
		WHERE workspace_id = ${args.workspaceId}
			AND id = ${args.draftId}
			AND lease_node_id = ${args.nodeId}
			AND lease_epoch = ${args.leaseEpoch}
		RETURNING lease_epoch::int AS epoch
	`
	if (!saved) {
		const [current] = await tx<{ epoch: number }[]>`
			SELECT lease_epoch::int AS epoch FROM mail_drafts
			WHERE workspace_id = ${args.workspaceId} AND id = ${args.draftId}
		`
		return { fenced: true, currentEpoch: Number(current?.epoch ?? args.leaseEpoch) }
	}
	return { fenced: false, currentEpoch: Number(saved.epoch) }
}
