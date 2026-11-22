/**
 * Mobile client environment (§7.5): Expo `EXPO_PUBLIC_*` vars, inlined into
 * the JS bundle. For the future `apps/mobile` app — same shape as `web` so the
 * API/WS override seam is identical across clients.
 */
import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const mobileSchemas = {
	EXPO_PUBLIC_API_URL: z.url().optional().describe('API origin override; unset = the build-time default'),
	EXPO_PUBLIC_WS_URL: z
		.url()
		.optional()
		.describe('Realtime endpoint override; unset = derived from the API origin')
}

export function createMobileEnv(
	runtimeEnv: Record<string, string | boolean | number | undefined> = process.env
) {
	return createEnv({
		clientPrefix: 'EXPO_PUBLIC_',
		client: mobileSchemas,
		runtimeEnv,
		emptyStringAsUndefined: true,
		skipValidation: !!runtimeEnv['SKIP_ENV_VALIDATION']
	})
}

export type MobileEnv = ReturnType<typeof createMobileEnv>
