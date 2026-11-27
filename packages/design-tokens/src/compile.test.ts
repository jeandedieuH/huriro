import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const DIST = join(import.meta.dir, '..', 'dist')

describe('token outputs', () => {
	test('css emits the shadcn contract + dark class', () => {
		const css = readFileSync(join(DIST, 'css/tokens.css'), 'utf8')
		for (const v of ['--primary:', '--background:', '--destructive:', '--sidebar-primary:', '--ring:']) {
			expect(css).toContain(v)
		}
		expect(css).toContain('.dark {')
		// brand color is --primary, never --accent (§17.4 naming trap)
		expect(css).toContain('--accent: oklch(0.96 0.003 265)')
	})

	test('vars referenced via `x-(--*)` syntax exist on :root', () => {
		// Components write `z-(--z-popover)` / `shadow-(--shadow-N)` — raw var()
		// pass-throughs that silently no-op when the var is missing from tokens.css
		const css = readFileSync(join(DIST, 'css/tokens.css'), 'utf8')
		for (const v of ['--z-popover:', '--z-modal:', '--shadow-1:', '--shadow-2:', '--shadow-3:']) {
			expect(css).toContain(v)
		}
	})

	test('tailwind theme uses @theme inline var mapping', () => {
		const tw = readFileSync(join(DIST, 'tailwind/theme.css'), 'utf8')
		expect(tw).toContain('@custom-variant dark')
		expect(tw).toContain('--color-primary: var(--primary);')
	})

	test('rn theme exports light + dark hex colors', async () => {
		const ts = readFileSync(join(DIST, 'rn/theme.ts'), 'utf8')
		expect(ts).toContain('export const lightTheme')
		expect(ts).toContain('export const darkTheme')
		const rnThemeUrl = pathToFileURL(join(DIST, 'rn/theme.ts')).href
		const mod = (await import(rnThemeUrl)) as {
			lightTheme: { colors: Record<string, string> }
			darkTheme: { colors: Record<string, string> }
		}
		expect(mod.lightTheme.colors['primary']).toMatch(/^#[0-9a-f]{6}$/)
		expect(mod.darkTheme.colors['background']).toMatch(/^#[0-9a-f]{6}$/)
		expect(mod.lightTheme.colors['primary']).not.toContain('oklch(')
	})

	test('uniwind theme overrides HeroUI Native light + dark variants without @custom-variant dark', () => {
		const uniwind = readFileSync(join(DIST, 'uniwind/theme.css'), 'utf8')
		expect(uniwind).toContain('@layer theme')
		expect(uniwind).toContain('@variant light')
		expect(uniwind).toContain('@variant dark')
		expect(uniwind).toContain('@theme inline static')
		expect(uniwind).not.toContain('@custom-variant dark')
		expect(uniwind).toContain('--accent: oklch(0.575 0.215 12.21);')
		expect(uniwind).toContain('--muted: oklch(0.45 0.01 265);')
		expect(uniwind).toContain('--danger: oklch(0.58 0.20 27);')
		expect(uniwind).toContain('--info: oklch(0.62 0.15 240);')
		expect(uniwind).not.toContain('{color.')
		expect(uniwind).not.toContain('{light.')
		expect(uniwind).not.toContain('{dark.')

		const lightBlock = uniwind.match(/@variant light \{([\s\S]*?)\n\t\t\}/)?.[1] ?? ''
		const darkBlock = uniwind.match(/@variant dark \{([\s\S]*?)\n\t\t\}/)?.[1] ?? ''
		const extractVars = (block: string) =>
			[...block.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1] ?? '').sort()
		const lightKeys = extractVars(lightBlock)
		const darkKeys = extractVars(darkBlock)
		expect(lightKeys.length).toBeGreaterThan(20)
		expect(lightKeys).toEqual(darkKeys)
	})

	test('aliases resolve — no unresolved {ref} remains', () => {
		const css = readFileSync(join(DIST, 'css/tokens.css'), 'utf8')
		expect(css).not.toContain('{color.')
	})
})
