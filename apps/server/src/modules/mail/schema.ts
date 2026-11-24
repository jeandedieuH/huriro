/** Mail route schemas — params live here; bodies come from @huriro/contracts. */
import { Type } from 'typebox'

export const MailIdParam = Type.Object({ id: Type.String({ format: 'uuid' }) })
export const MailDraftParam = Type.Object({ draftId: Type.String({ format: 'uuid' }) })
export const MailLinkTaskParam = Type.Object({
	id: Type.String({ format: 'uuid' }),
	taskId: Type.String({ format: 'uuid' })
})
export const MailLinkDocParam = Type.Object({
	id: Type.String({ format: 'uuid' }),
	pageId: Type.String({ format: 'uuid' })
})
export const InboundTokenParam = Type.Object({ token: Type.String({ minLength: 10, maxLength: 200 }) })
export const MailIdentitiesQuery = Type.Object({
	accountId: Type.Optional(Type.String({ format: 'uuid' }))
})
export const MailSyncBody = Type.Object({ force: Type.Optional(Type.Boolean()) })
export const WebhookSyncBody = Type.Object({ accountId: Type.Optional(Type.String({ format: 'uuid' })) })
