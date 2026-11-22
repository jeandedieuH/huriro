/**
 * Web client environment (§7.5): Vite `VITE_*` vars, statically inlined into
 * the bundle at build time. Every var is optional — unset means "same-origin",
 * which covers both the dev proxy (:3000 → :3001/:3005) and single-ingress deploys.
 */
import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const webSchemas = {
	VITE_API_URL: z
		.url()
		.optional()
		.describe('API origin override; unset = same-origin `/api` (dev proxy / ingress)'),
	VITE_WS_URL: z.url().optional().describe('Realtime endpoint override; unset = same-origin `/ws`')
}

/** Pass `import.meta.env` from the app — keeps this module runtime-agnostic. */
export function createWebEnv(runtimeEnv: Record<string, string | boolean | number | undefined>) {
	return createEnv({
		clientPrefix: 'VITE_',
		client: webSchemas,
		runtimeEnv,
		emptyStringAsUndefined: true,
		skipValidation: !!runtimeEnv['SKIP_ENV_VALIDATION']
	})
}

export type WebEnv = ReturnType<typeof createWebEnv>
