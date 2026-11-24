#!/usr/bin/env bun
/**
 * Web shell bundle budget gate (§21.4, M6).
 *
 * Verifies:
 *   1. The initial client entry bundle(s) stay <= 204,800 bytes (200 KB) gzipped.
 *   2. Collaborative editor packages (@tiptap / ProseMirror / Hocuspocus) are
 *      split out of `__root__` scripts & preloads into lazy route chunks.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const ROOT = join(import.meta.dir, '..')
const PUBLIC_ASSETS_DIR = join(ROOT, 'apps/web/.output/public/assets')
const SERVER_OUT_DIR = join(ROOT, 'apps/web/.output/server')
const MAX_ENTRY_GZIP_BYTES = 204_800

if (!existsSync(PUBLIC_ASSETS_DIR)) {
	console.error(`bundle check: missing ${PUBLIC_ASSETS_DIR} (run apps/web build first)`)
	process.exit(1)
}

interface ChunkMetric {
	readonly file: string
	readonly rawBytes: number
	readonly gzipBytes: number
	readonly hasEditorRuntime: boolean
}

const chunks = new Map<string, ChunkMetric>()
for (const name of readdirSync(PUBLIC_ASSETS_DIR)) {
	if (!name.endsWith('.js')) continue
	const bytes = readFileSync(join(PUBLIC_ASSETS_DIR, name))
	const text = bytes.toString('utf8')
	const gz = gzipSync(bytes, { level: 9 })
	chunks.set(name, {
		file: name,
		rawBytes: bytes.byteLength,
		gzipBytes: gz.byteLength,
		hasEditorRuntime: /ProseMirror|@tiptap|tiptap|HocuspocusProvider/i.test(text)
	})
}

const entryFiles = new Set<string>()
const rootPreloadFiles = new Set<string>()

if (existsSync(SERVER_OUT_DIR)) {
	const manifestFile = readdirSync(SERVER_OUT_DIR).find(
		(f) => f.startsWith('_tanstack-start-manifest') && f.endsWith('.mjs')
	)
	if (manifestFile) {
		const modUrl = new URL(`file://${join(SERVER_OUT_DIR, manifestFile).replace(/\\/g, '/')}`)
		const mod = (await import(modUrl.href)) as {
			tsrStartManifest?: () => {
				routes?: Record<
					string,
					{
						preloads?: string[]
						scripts?: Array<{ attrs?: { src?: string } }>
					}
				>
			}
		}
		// Inspect the built file text as fallback if tsrStartManifest is not directly exported.
		const rawManifest = readFileSync(join(SERVER_OUT_DIR, manifestFile), 'utf8')
		const rootStart = rawManifest.indexOf('__root__:')
		const rootEnd = rootStart >= 0 ? rawManifest.indexOf('"/":', rootStart) : -1
		if (rootStart >= 0) {
			const rootSlice = rawManifest.slice(rootStart, rootEnd > rootStart ? rootEnd : rootStart + 4000)
			const preloadSection = rootSlice.slice(
				rootSlice.indexOf('preloads:'),
				rootSlice.indexOf('scripts:') > 0 ? rootSlice.indexOf('scripts:') : rootSlice.length
			)
			for (const match of preloadSection.matchAll(/\/assets\/([A-Za-z0-9_.-]+\.js)/g)) {
				if (match[1]) rootPreloadFiles.add(match[1])
			}
			const scriptSection = rootSlice.slice(rootSlice.indexOf('scripts:'))
			for (const match of scriptSection.matchAll(/\/assets\/([A-Za-z0-9_.-]+\.js)/g)) {
				if (match[1]) entryFiles.add(match[1])
			}
		}
		void mod
	}
}

if (entryFiles.size === 0) {
	for (const name of chunks.keys()) {
		if (name.startsWith('index-') && name.endsWith('.js')) entryFiles.add(name)
	}
}

if (entryFiles.size === 0) {
	console.error('bundle check: could not locate initial web entry script chunk in .output/public/assets')
	process.exit(1)
}

console.log('bundle check: top web client chunks (gzip / raw)')
const sorted = [...chunks.values()].sort((a, b) => b.gzipBytes - a.gzipBytes)
for (const c of sorted.slice(0, 12)) {
	const tag = entryFiles.has(c.file) ? ' [ENTRY]' : rootPreloadFiles.has(c.file) ? ' [ROOT_PRELOAD]' : ''
	console.log(
		`  ${c.file.padEnd(42)} ${String(c.gzipBytes).padStart(7)} B gz  (${c.rawBytes} B raw)${c.hasEditorRuntime ? ' [editor]' : ''}${tag}`
	)
}

let failed = false
for (const entry of entryFiles) {
	const metric = chunks.get(entry)
	if (!metric) {
		console.error(`bundle check: missing entry chunk ${entry}`)
		failed = true
		continue
	}
	if (metric.gzipBytes > MAX_ENTRY_GZIP_BYTES) {
		console.error(
			`bundle check: entry chunk ${entry} is ${metric.gzipBytes} B gz > ${MAX_ENTRY_GZIP_BYTES} B limit`
		)
		failed = true
	} else {
		console.log(`  ok: entry chunk ${entry} = ${metric.gzipBytes} B gz <= ${MAX_ENTRY_GZIP_BYTES} B limit`)
	}
	if (metric.hasEditorRuntime) {
		console.error(`bundle check: entry chunk ${entry} eagerly bundles editor runtime`)
		failed = true
	}
}

for (const preload of rootPreloadFiles) {
	const metric = chunks.get(preload)
	if (metric?.hasEditorRuntime) {
		console.error(`bundle check: __root__ preload ${preload} eagerly loads editor runtime`)
		failed = true
	}
}

const lazyEditorChunks = sorted.filter(
	(c) => c.hasEditorRuntime && !entryFiles.has(c.file) && !rootPreloadFiles.has(c.file)
)
if (lazyEditorChunks.length === 0) {
	console.error('bundle check: expected lazy-loaded editor chunk in client output')
	failed = true
} else {
	console.log(
		`  ok: editor runtime split into ${lazyEditorChunks.length} lazy chunk(s) (${lazyEditorChunks.map((c) => c.file).join(', ')})`
	)
}

if (failed) process.exit(1)
console.log('bundle check: passed')
