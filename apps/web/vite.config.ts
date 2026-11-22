import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite-plus/test/config'

// Vite+ toolchain (vite-plus-core = rolldown-vite 8): `vp dev`/`vp build`/`vp test`.
// `resolve.tsconfigPaths` picks up the `@/*` alias from tsconfig paths.
export default defineConfig({
	resolve: { tsconfigPaths: true },
	server: {
		// Web dev port is 3000; api serves on :3001, realtime on :3005.
		port: 3000,
		proxy: {
			'/api': {
				target: 'http://127.0.0.1:3001',
				changeOrigin: true
			},
			'/ws': {
				target: 'ws://127.0.0.1:3005',
				ws: true
			}
		}
	},
	// react's vite plugin must come after start's vite plugin
	plugins: [tailwindcss(), tanstackStart({ srcDirectory: 'src' }), viteReact(), nitro()],
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: './src/lib/test-setup.ts',
		// visual/** is Playwright, not vitest — runs via `bun run test:visual`
		exclude: ['visual/**', 'node_modules/**']
	}
})
