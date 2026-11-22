/**
 * Cursor pagination contract (§16.1): `?limit=&cursor=` in,
 * `{ data, nextCursor, hasMore }` out. Cursors are opaque strings —
 * clients must treat them as write-only.
 */
import { type Static, Type } from 'typebox'

export const PaginationQuery = Type.Object({
	limit: Type.Optional(
		Type.Integer({ minimum: 1, maximum: 200, default: 50, description: 'Page size, 1–200' })
	),
	cursor: Type.Optional(Type.String({ description: 'Opaque cursor from a previous page' }))
})
export type PaginationQuery = Static<typeof PaginationQuery>

export function Page<T extends ReturnType<typeof Type.Any>>(item: T) {
	return Type.Object({
		data: Type.Array(item),
		nextCursor: Type.Union([Type.String(), Type.Null()]),
		hasMore: Type.Boolean()
	})
}

/** Encode a keyset cursor. Keep the payload tiny and non-sensitive. */
export function encodeCursor(value: unknown): string {
	return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

export function decodeCursor<T>(cursor: string | undefined): T | undefined {
	if (!cursor) return undefined
	try {
		return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T
	} catch {
		return undefined
	}
}
