/**
 * Collab ticket signing & direct Hocuspocus bridge contracts shared across
 * docs services without introducing circular imports.
 */
import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import type { ProseMirrorNodeJson } from '@huriro/editor'
import type * as Y from 'yjs'

export const TICKET_TTL_MS = 60 * 1000
const HKDF_SALT = Buffer.from('huriro-collab-ticket-salt', 'utf8')
const HKDF_INFO = Buffer.from('huriro-collab-ticket-v1', 'utf8')

export interface CollabDirectBridge {
	readonly replaceDocument?: (
		workspaceId: string,
		pageId: string,
		snapshotState: Uint8Array,
		origin: string,
		actorId?: string | null
	) => Promise<boolean>
	readonly appendNodes?: (
		workspaceId: string,
		pageId: string,
		nodes: readonly ProseMirrorNodeJson[],
		origin: string,
		actorId?: string | null
	) => Promise<boolean>
	readonly applyYDocTransform?: (
		workspaceId: string,
		pageId: string,
		origin: string,
		actorId: string | null | undefined,
		transform: (liveDoc: Y.Doc) => void
	) => Promise<boolean>
	readonly applySyncedBlockTransform?: (
		workspaceId: string,
		syncedBlockId: string,
		origin: string,
		actorId: string | null | undefined,
		transform: (liveDoc: Y.Doc) => void
	) => Promise<boolean>
	readonly isRoomLoaded?: (workspaceId: string, pageId: string) => boolean
}

export interface CollabTicketClaims {
	readonly jti: string
	readonly ws: string
	readonly page: string
	readonly kind?: 'doc_page' | 'synced_block' | undefined
	readonly uid: string
	readonly perm: 'read' | 'write'
	readonly exp: number
}

export function deriveCollabTicketKey(rawSecret: string): Buffer {
	return Buffer.from(hkdfSync('sha256', Buffer.from(rawSecret, 'utf8'), HKDF_SALT, HKDF_INFO, 32))
}

export function hashCollabTicket(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function signCollabTicket(key: Buffer, claims: CollabTicketClaims): string {
	const payloadB64 = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
	const sigB64 = createHmac('sha256', key).update(payloadB64, 'utf8').digest('base64url')
	return `${payloadB64}.${sigB64}`
}

export function verifyCollabTicketSignature(rawSecret: string, token: string): CollabTicketClaims | null {
	const dot = token.indexOf('.')
	if (dot <= 0 || dot === token.length - 1) return null
	const payloadB64 = token.slice(0, dot)
	const sigB64 = token.slice(dot + 1)
	const key = deriveCollabTicketKey(rawSecret)
	const expectedSig = createHmac('sha256', key).update(payloadB64, 'utf8').digest()
	let providedSig: Buffer
	try {
		providedSig = Buffer.from(sigB64, 'base64url')
	} catch {
		return null
	}
	if (expectedSig.length !== providedSig.length || !timingSafeEqual(expectedSig, providedSig)) {
		return null
	}
	try {
		const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as CollabTicketClaims
		if (
			typeof parsed.jti !== 'string' ||
			typeof parsed.ws !== 'string' ||
			typeof parsed.page !== 'string' ||
			typeof parsed.uid !== 'string' ||
			(parsed.perm !== 'read' && parsed.perm !== 'write') ||
			typeof parsed.exp !== 'number'
		) {
			return null
		}
		if (parsed.exp <= Date.now()) return null
		return parsed
	} catch {
		return null
	}
}
