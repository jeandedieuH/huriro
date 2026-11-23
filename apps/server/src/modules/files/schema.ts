import { Type } from 'typebox'

export { InitUploadBody } from '@huriro/contracts'

export const FileIdParam = Type.Object({
	id: Type.String({ format: 'uuid' })
})
