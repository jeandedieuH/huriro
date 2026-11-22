import { defineConfig } from '@playwright/test'

/**
 * Visual regression (§17.10): deterministic screenshots of the showcase route.
 * Not part of `bun run verify` — browsers are too heavy for the lint/test gate.
 *
 *   bunx playwright install chromium   # one-time
 *   bun run test:visual                 # compare against snapshots
 *   bun run test:visual -- --update-snapshots   # refresh after intentional change
 */
export default defineConfig({
	testDir: './visual',
	retries: process.env['CI'] ? 1 : 0,
	use: { baseURL: 'http://localhost:4173' },
	webServer: {
		// TanStack Start builds a Nitro node server in .output — serve that directly.
		command: 'bun run build && bun .output/server/index.mjs',
		env: { PORT: '4173', NITRO_PORT: '4173' },
		port: 4173,
		reuseExistingServer: !process.env['CI'],
		timeout: 120_000
	},
	projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
	expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } }
})
