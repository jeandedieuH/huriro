#!/usr/bin/env bun
/**
 * Token compiler (§17.4): DTCG JSON in tokens/ →
 *   dist/css/tokens.css      shadcn contract vars (:root + .dark) + extensions
 *   dist/tailwind/theme.css  @theme block for Tailwind v4 + @custom-variant dark
 *   dist/rn/theme.ts         Uniwind/React Native theme object
 *   dist/docs/tokens.html    living token reference
 *
 * The DTCG files are the single source of truth; dist/ is checked in and
 * `gen:check` fails on drift — same contract as .env.example.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const TOKENS = join(ROOT, 'tokens')
const DIST = join(ROOT, 'dist')
const CHECK = process.argv.includes('--check')

type Leaf = { $type: string; $value: string }
type Tree = Record<string, unknown>

function isLeaf(v: unknown): v is Leaf {
	return typeof v === 'object' && v !== null && '$value' in v
}

function loadJson(file: string): Tree {
	return JSON.parse(readFileSync(join(TOKENS, file), 'utf8')) as Tree
}

/** Flatten a DTCG tree into dotted paths. */
function flatten(tree: Tree, prefix: string[] = [], out: Map<string, Leaf> = new Map()) {
	for (const [k, v] of Object.entries(tree)) {
		if (isLeaf(v)) out.set([...prefix, k].join('.'), v)
		else flatten(v as Tree, [...prefix, k], out)
	}
	return out
}

const color = flatten(loadJson('color.json'))
const semantic = flatten(loadJson('semantic.json'))
const core = flatten(loadJson('core.json'))
const all = new Map([...color, ...semantic, ...core])

/** Resolve `{a.b.c}` aliases one level (semantic tokens only reference primitives). */
function resolve(value: string): string {
	return value.replace(/\{([^}]+)\}/g, (_, path: string) => {
		const ref = all.get(path)
		if (!ref) throw new Error(`unresolved token alias: ${path}`)
		return /\{/.test(ref.$value) ? resolve(ref.$value) : ref.$value
	})
}

const px = (v: string) => Number.parseFloat(v)
const ms = (v: string) => Number.parseInt(v, 10)

/** Required token lookup — a missing path is a build-time bug, not a runtime branch. */
function req(path: string): string {
	const leaf = all.get(path)
	if (!leaf) throw new Error(`missing token: ${path}`)
	return leaf.$value
}

const themed = (theme: 'light' | 'dark') =>
	[...semantic]
		.filter(([k]) => k.startsWith(`${theme}.`))
		.map(([k, v]) => [k.slice(theme.length + 1), resolve(v.$value)] as const)

// ---------- css/tokens.css ----------
const lightVars = themed('light')
const darkVars = themed('dark')
const css = [
	'/* GENERATED from packages/design-tokens/tokens/*.json — run `bun run gen` to rebuild. */',
	':root {',
	...lightVars.map(([k, v]) => `\t--${k}: ${v};`),
	// non-color tokens share across themes
	...[...core].map(([k, v]) => `\t--${k.replaceAll('.', '-')}: ${v.$value};`),
	'}',
	'',
	"/* Dark mode rides shadcn's .dark class — never a data-theme attribute (§17.4). */",
	'.dark {',
	...darkVars.map(([k, v]) => `\t--${k}: ${v};`),
	'\t--elevation-1: 0 1px 2px rgb(0 0 0 / 0.4), 0 1px 1px rgb(0 0 0 / 0.3);',
	'\t--elevation-2: 0 2px 6px rgb(0 0 0 / 0.5), 0 1px 2px rgb(0 0 0 / 0.4);',
	'\t--elevation-3: 0 8px 24px rgb(0 0 0 / 0.6), 0 2px 6px rgb(0 0 0 / 0.5);',
	'}',
	''
].join('\n')

// ---------- tailwind/theme.css ----------
const tw = [
	'/* GENERATED — Tailwind v4 theme mapping onto the shadcn contract vars.',
	' * Import order in consumers: `@import "tailwindcss"` first, then tokens.css,',
	' * then this file — tailwindcss must resolve from the app, not this package. */',
	'',
	'@custom-variant dark (&:is(.dark *));',
	'',
	'@theme inline {',
	...lightVars.map(([k]) => `\t--color-${k}: var(--${k});`),
	...[...core]
		.filter(([k]) => k.startsWith('font.size') || k.startsWith('font.family'))
		.map(([k, v]) => `\t--${k.replaceAll('.', '-')}: ${v.$value};`),
	...[...core]
		.filter(([k]) => k.startsWith('radius.'))
		.map(([k, v]) => `\t--radius-${k.slice(7)}: ${v.$value};`),
	...[...core]
		.filter(([k]) => k.startsWith('motion.'))
		.map(([k, v]) => `\t--${k.replaceAll('.', '-')}: ${v.$value};`),
	...[...core]
		.filter(([k]) => k.startsWith('elevation.'))
		.map(([k]) => `\t--shadow-${k.slice(10)}: var(--${k.replaceAll('.', '-')});`),
	'}',
	'',
	'@theme {',
	`\t--radius-sm: ${req('radius.sm')};`,
	`\t--radius-md: ${req('radius.md')};`,
	`\t--radius-lg: ${req('radius.lg')};`,
	`\t--radius-xl: ${req('radius.xl')};`,
	'}',
	''
].join('\n')

// ---------- rn/theme.ts ----------
const rnColorEntries = [...color].map(([k, v]) => [k.replaceAll('.', '_'), v.$value])
const rn = [
	'// GENERATED — Uniwind/RN theme from the same DTCG source as the web tokens.',
	'export interface HuriroTheme {',
	'\tcolors: Record<string, string>',
	'\tradius: Record<string, number>',
	'\tfontSize: Record<string, number>',
	'\tduration: Record<string, number>',
	'}',
	'',
	'const px = (v: string) => Number.parseFloat(v)',
	'const ms = (v: string) => Number.parseInt(v, 10)',
	'',
	'export const lightTheme: HuriroTheme = {',
	'\tcolors: {',
	...lightVars.map(([k, v]) => `\t\t'${k}': '${v}',`),
	...rnColorEntries.map(([k, v]) => `\t\t'${k}': '${v}',`),
	'\t},',
	`\tradius: { sm: ${px(req('radius.sm'))}, md: ${px(req('radius.md'))}, lg: ${px(req('radius.lg'))}, xl: ${px(req('radius.xl'))} },`,
	`\tfontSize: { xs: ${px(req('font.size.xs'))}, sm: ${px(req('font.size.sm'))}, base: ${px(req('font.size.base'))}, md: ${px(req('font.size.md'))}, lg: ${px(req('font.size.lg'))}, xl: ${px(req('font.size.xl'))}, '2xl': ${px(req('font.size.2xl'))} },`,
	`\tduration: { fast: ${ms(req('motion.duration.fast'))}, base: ${ms(req('motion.duration.base'))}, slow: ${ms(req('motion.duration.slow'))} }`,
	'}',
	'',
	'export const darkTheme: HuriroTheme = {',
	'\t...lightTheme,',
	'\tcolors: {',
	'\t\t...lightTheme.colors,',
	...darkVars.map(([k, v]) => `\t\t'${k}': '${v}',`),
	'\t}',
	'}',
	''
].join('\n')

// ---------- docs/tokens.html ----------
const swatch = (k: string, v: string) =>
	`<tr><td><code>--${k}</code></td><td><span style="display:inline-block;width:1.5rem;height:1rem;background:${v};border:1px solid #ccc;vertical-align:middle"></span> ${v}</td></tr>`
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Huriro tokens</title></head><body>
<h1>Design tokens (generated)</h1>
<h2>Light</h2><table>${lightVars.map(([k, v]) => swatch(k, v)).join('')}</table>
<h2>Dark</h2><table>${darkVars.map(([k, v]) => swatch(k, v)).join('')}</table>
<h2>Core</h2><table>${[...core].map(([k, v]) => `<tr><td><code>--${k.replaceAll('.', '-')}</code></td><td>${v.$value}</td></tr>`).join('')}</table>
</body></html>`

const outputs: Record<string, string> = {
	'css/tokens.css': css,
	'tailwind/theme.css': tw,
	'rn/theme.ts': rn,
	'docs/tokens.html': html
}

let drift = false
for (const [rel, content] of Object.entries(outputs)) {
	const path = join(DIST, rel)
	const existing = (() => {
		try {
			return readFileSync(path, 'utf8')
		} catch {
			return null
		}
	})()
	if (CHECK) {
		if (existing !== content) {
			console.error(`stale: dist/${rel} — run \`bun run gen\` in @huriro/design-tokens`)
			drift = true
		}
	} else {
		mkdirSync(join(path, '..'), { recursive: true })
		writeFileSync(path, content)
		console.log(`wrote dist/${rel}`)
	}
}
if (CHECK && drift) process.exit(1)
