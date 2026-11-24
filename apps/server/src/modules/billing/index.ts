import type { Sql } from '@huriro/db'
import { Elysia } from 'elysia'
import type { Auth } from '../identity'
import { workspaceDerive } from '../tenancy'
import { CreateBillingPortalBody, CreateCheckoutBody } from './schema'
import {
	type BillingModuleConfig,
	captureDailyBillingUsageOnce,
	createBillingCheckout,
	createBillingPortal,
	getWorkspaceBillingSummary,
	ingestIremboPayWebhook,
	ingestPolarWebhook
} from './service'

export { UsdToRwfConverter } from './fx'
export {
	createIremboPayBillingProvider,
	createPolarBillingProvider,
	type IremboPayBillingProvider,
	type PolarBillingProvider
} from './provider'
export { type BillingModuleConfig, captureDailyBillingUsageOnce }

export function billingWebhookPublicModule(sql: Sql, cfg: BillingModuleConfig) {
	return new Elysia({ name: 'huriro.billingWebhook' })
		.post('/billing/webhooks/polar', { parse: 'text' }, async ({ body, request, set }) => {
			const rawBody = typeof body === 'string' ? body : await request.text()
			const res = await ingestPolarWebhook(sql, { rawBody, headers: request.headers, cfg })
			set.status = 200
			return res
		})
		.post('/billing/webhooks/irembopay', { parse: 'text' }, async ({ body, request, set }) => {
			const rawBody = typeof body === 'string' ? body : await request.text()
			const signatureHeader = request.headers.get('irembopay-signature')
			const res = await ingestIremboPayWebhook(sql, { rawBody, signatureHeader, cfg })
			set.status = 200
			return res
		})
}

export function billingModule(sql: Sql, auth: Auth | null, cfg: BillingModuleConfig) {
	return new Elysia({ name: 'huriro.billing' })
		.derive(workspaceDerive(sql, auth))
		.get('/billing/subscription', ({ inWorkspace }) =>
			inWorkspace((tx, actor) => getWorkspaceBillingSummary(tx, actor, cfg))
		)
		.post('/billing/checkout', { body: CreateCheckoutBody }, async ({ body, request, inWorkspace, set }) => {
			const actor = await inWorkspace(async (_tx, resolved) => resolved)
			const res = await createBillingCheckout(sql, actor, body, cfg, {
				idempotencyKey: request.headers.get('idempotency-key'),
				clientName: request.headers.get('x-huriro-client'),
				platform: request.headers.get('x-huriro-platform')
			})
			set.status = res.status
			return res.body
		})
		.post('/billing/portal', { body: CreateBillingPortalBody }, async ({ body, request, inWorkspace }) => {
			const actor = await inWorkspace(async (_tx, resolved) => resolved)
			return createBillingPortal(sql, actor, body, cfg, {
				clientName: request.headers.get('x-huriro-client'),
				platform: request.headers.get('x-huriro-platform')
			})
		})
}
