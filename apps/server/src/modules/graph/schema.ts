import { Type } from 'typebox'

export { CreateEntityLinkBody, GraphLinksQuery, GraphPeekQuery } from '@huriro/contracts'

export const LinkIdParam = Type.Object({
	linkId: Type.String({ format: 'uuid' })
})
