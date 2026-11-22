import { Type } from 'typebox'

export { ImportDryRunBody, ImportExecuteBody } from '@huriro/contracts'

export const ImportIdParam = Type.Object({
	id: Type.String({ format: 'uuid' })
})

export const RedirectIdentifierParam = Type.Object({
	identifier: Type.String({ minLength: 1, maxLength: 120 })
})
