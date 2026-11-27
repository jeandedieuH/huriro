#!/usr/bin/env bun
/**
 * Token compiler (§17.4): DTCG JSON in tokens/ →
 *   dist/css/tokens.css      shadcn contract vars (:root + .dark) + extensions
 *   dist/tailwind/theme.css  @theme block for Tailwind v4 + @custom-variant dark
 *   dist/uniwind/theme.css   Uniwind / HeroUI Native @variant light + dark overrides
 *   dist/rn/theme.ts         Uniwind/React Native theme object (hex colors)
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

/** Required resolved semantic token lookup for theme emission. */
function tok(map: ReadonlyMap<string, string>, key: string): string {
	const value = map.get(key)
	if (!value) throw new Error(`missing resolved token: ${key}`)
	return value
}

/**
 * Convert CSS Color 4 `oklch(L C H)` strings to React Native-safe `#rrggbb` hex.
 * Non-oklch inputs pass through unchanged.
 */
function oklchToHex(value: string): string {
	const match = value.trim().match(/^oklch\(\s*([0-9.]+%?)\s+([0-9.]+)\s+([0-9.]+)\s*\)$/)
	if (!match) return value
	const [, rawL, rawC, rawH] = match
	if (!rawL || !rawC || !rawH) return value
	const lVal = rawL.endsWith('%') ? Number.parseFloat(rawL) / 100 : Number.parseFloat(rawL)
	const cVal = Number.parseFloat(rawC)
	const hRad = (Number.parseFloat(rawH) * Math.PI) / 180

	const a = cVal * Math.cos(hRad)
	const b = cVal * Math.sin(hRad)

	const l_ = lVal + 0.3963377774 * a + 0.2158037573 * b
	const m_ = lVal - 0.1055613458 * a - 0.0638541728 * b
	const s_ = lVal - 0.0894841775 * a - 1.291485548 * b

	const l = l_ * l_ * l_
	const m = m_ * m_ * m_
	const s = s_ * s_ * s_

	const rLin = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
	const gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
	const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s

	const toByte = (u: number): string => {
		const clamped = Math.min(1, Math.max(0, u))
		const gamma = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055
		return Math.round(gamma * 255)
			.toString(16)
			.padStart(2, '0')
	}

	return `#${toByte(rLin)}${toByte(gLin)}${toByte(bLin)}`
}

// ---------- css/tokens.css ----------
const lightVars = themed('light')
const darkVars = themed('dark')
const css = [
	'/* GENERATED from packages/design-tokens/tokens/*.json — run `bun run gen` to rebuild. */',
	':root {',
	...lightVars.map(([k, v]) => `\t--${k}: ${v};`),
	// non-color tokens share across themes
	...[...core].map(([k, v]) => `\t--${k.replaceAll('.', '-')}: ${v.$value};`),
	// `--shadow-*` aliases for `shadow-(--shadow-N)` usage — must live on :root because
	// @theme inline vars are never emitted; var() keeps the .dark elevation overrides
	...[...core]
		.filter(([k]) => k.startsWith('elevation.'))
		.map(([k]) => `\t--shadow-${k.slice(10)}: var(--elevation-${k.slice(10)});`),
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

// ---------- uniwind/theme.css ----------
const lightMap = new Map(lightVars)
const darkMap = new Map(darkVars)

function uniwindVariantEntries(
	theme: 'light' | 'dark',
	map: ReadonlyMap<string, string>
): readonly (readonly [string, string])[] {
	const isLight = theme === 'light'
	return [
		// HeroUI Native semantic overrides
		['background', tok(map, isLight ? 'surface-2' : 'background')],
		['foreground', tok(map, 'foreground')],
		['surface', tok(map, 'card')],
		['surface-foreground', tok(map, 'card-foreground')],
		['surface-secondary', tok(map, isLight ? 'secondary' : 'surface-2')],
		['surface-secondary-foreground', tok(map, 'foreground')],
		['surface-tertiary', tok(map, isLight ? 'border' : 'secondary')],
		['surface-tertiary-foreground', tok(map, 'foreground')],
		['overlay', tok(map, 'popover')],
		['overlay-foreground', tok(map, 'popover-foreground')],
		['muted', tok(map, 'muted-foreground')],
		['default', tok(map, 'secondary')],
		['default-foreground', tok(map, 'secondary-foreground')],
		['accent', tok(map, 'primary')],
		['accent-foreground', tok(map, 'primary-foreground')],
		['field-background', tok(map, 'surface-2')],
		['field-foreground', tok(map, 'foreground')],
		['field-placeholder', tok(map, 'ink-tertiary')],
		['field-border', tok(map, 'input')],
		['success', tok(map, 'success')],
		['success-foreground', tok(map, isLight ? 'primary-foreground' : 'background')],
		['warning', tok(map, 'warning')],
		['warning-foreground', tok(map, isLight ? 'foreground' : 'background')],
		['danger', tok(map, 'destructive')],
		['danger-foreground', tok(map, 'destructive-foreground')],
		['segment', tok(map, isLight ? 'card' : 'accent')],
		['segment-foreground', tok(map, 'foreground')],
		['border', tok(map, 'border')],
		['separator', tok(map, isLight ? 'border' : 'input')],
		['focus', tok(map, 'ring')],
		['link', tok(map, isLight ? 'primary' : 'ring')],
		// Huriro compatibility tokens (shared across light & dark)
		['primary', tok(map, 'primary')],
		['primary-foreground', tok(map, 'primary-foreground')],
		['secondary', tok(map, 'secondary')],
		['secondary-foreground', tok(map, 'secondary-foreground')],
		['muted-foreground', tok(map, 'muted-foreground')],
		['destructive', tok(map, 'destructive')],
		['destructive-foreground', tok(map, 'destructive-foreground')],
		['card', tok(map, 'card')],
		['card-foreground', tok(map, 'card-foreground')],
		['popover', tok(map, 'popover')],
		['popover-foreground', tok(map, 'popover-foreground')],
		['input', tok(map, 'input')],
		['ring', tok(map, 'ring')],
		['surface-2', tok(map, 'surface-2')],
		['ink-tertiary', tok(map, 'ink-tertiary')],
		['info', tok(map, 'info')],
		['info-foreground', tok(map, isLight ? 'primary-foreground' : 'background')],
		['sidebar', tok(map, 'sidebar')],
		['sidebar-foreground', tok(map, 'sidebar-foreground')],
		['sidebar-muted-foreground', tok(map, 'sidebar-muted-foreground')],
		['sidebar-icon-well', tok(map, 'sidebar-icon-well')],
		['sidebar-primary', tok(map, 'sidebar-primary')],
		['sidebar-primary-foreground', tok(map, 'sidebar-primary-foreground')],
		['sidebar-accent', tok(map, 'sidebar-accent')],
		['sidebar-accent-foreground', tok(map, 'sidebar-accent-foreground')],
		['sidebar-border', tok(map, 'sidebar-border')],
		['sidebar-ring', tok(map, 'sidebar-ring')],
		['chart-1', tok(map, 'chart-1')],
		['chart-2', tok(map, 'chart-2')],
		['chart-3', tok(map, 'chart-3')],
		['chart-4', tok(map, 'chart-4')],
		['chart-5', tok(map, 'chart-5')]
	]
}

const uniwindCompatKeys = [
	'primary',
	'primary-foreground',
	'secondary',
	'secondary-foreground',
	'muted-foreground',
	'destructive',
	'destructive-foreground',
	'card',
	'card-foreground',
	'popover',
	'popover-foreground',
	'input',
	'ring',
	'surface-2',
	'ink-tertiary',
	'info',
	'info-foreground',
	'sidebar',
	'sidebar-foreground',
	'sidebar-muted-foreground',
	'sidebar-icon-well',
	'sidebar-primary',
	'sidebar-primary-foreground',
	'sidebar-accent',
	'sidebar-accent-foreground',
	'sidebar-border',
	'sidebar-ring',
	'chart-1',
	'chart-2',
	'chart-3',
	'chart-4',
	'chart-5'
] as const

const uniwindCss = [
	'/* GENERATED — Uniwind / HeroUI Native theme overrides from packages/design-tokens/tokens/*.json.',
	' * Import after `uniwind` and `heroui-native/styles`. Uniwind owns light/dark custom variants. */',
	'',
	'@theme {',
	'\t--field-border-width: 1px;',
	'}',
	'',
	'@layer theme {',
	'\t:root {',
	'\t\t@variant light {',
	...uniwindVariantEntries('light', lightMap).map(([k, v]) => `\t\t\t--${k}: ${v};`),
	'\t\t}',
	'',
	'\t\t@variant dark {',
	...uniwindVariantEntries('dark', darkMap).map(([k, v]) => `\t\t\t--${k}: ${v};`),
	'\t\t}',
	'\t}',
	'}',
	'',
	'@theme inline static {',
	...uniwindCompatKeys.map((k) => `\t--color-${k}: var(--${k});`),
	'}',
	''
].join('\n')

// ---------- rn/theme.ts ----------
const rnColorEntries = [...color].map(([k, v]) => [k.replaceAll('.', '_'), v.$value] as const)
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
	...lightVars.map(([k, v]) => `\t\t'${k}': '${oklchToHex(v)}',`),
	...rnColorEntries.map(([k, v]) => `\t\t'${k}': '${oklchToHex(v)}',`),
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
	...darkVars.map(([k, v]) => `\t\t'${k}': '${oklchToHex(v)}',`),
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
	'uniwind/theme.css': uniwindCss,
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
