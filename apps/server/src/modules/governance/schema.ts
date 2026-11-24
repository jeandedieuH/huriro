import { Type } from 'typebox'

export { EraseAccountBody } from '@huriro/contracts'

export const ExportIdParam = Type.Object({
	id: Type.String({ format: 'uuid' })
})
