import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import type { EffectiveAvailabilityState } from '@huriro/contracts'
import { darkTheme, lightTheme } from '@huriro/design-tokens/rn-theme'
import { availabilityColor, resolveAvailabilityColor } from '../stores/availability-store'

const MOBILE_ROOT = resolve(import.meta.dir, '../..')

function lastVarInRule(css: string, selectorPrefix: string, varName: string): string | null {
	let pos = 0
	let found: string | null = null
	const pattern = new RegExp(`--${varName}:\\s*([^;]+);`, 'g')
	while (true) {
		const start = css.indexOf(selectorPrefix, pos)
		if (start === -1) break
		const openBrace = css.indexOf('{', start)
		if (openBrace === -1) break
		let depth = 0
		let end = -1
		for (let i = openBrace; i < css.length; i += 1) {
			if (css[i] === '{') depth += 1
			else if (css[i] === '}') {
				depth -= 1
				if (depth === 0) {
					end = i
					break
				}
			}
		}
		if (end === -1) break
		const block = css.slice(openBrace + 1, end)
		for (const m of block.matchAll(pattern)) {
			if (m[1]) found = m[1].trim()
		}
		pos = end + 1
	}
	return found
}

describe('Mobile Uniwind & HeroUI Native theme', () => {
	test('global.css imports @huriro/design-tokens/uniwind instead of web tailwind preset', () => {
		const globalCss = readFileSync(resolve(MOBILE_ROOT, 'global.css'), 'utf8')
		expect(globalCss).toContain('@import "@huriro/design-tokens/uniwind";')
		expect(globalCss).not.toContain('@huriro/design-tokens/tailwind')
	})

	test('Tailwind v4 compiles Huriro light + dark overrides onto Uniwind theme selectors', async () => {
		const req = createRequire(import.meta.url)
		const uniwindPkg = req.resolve('uniwind/package.json')
		const uniwindReq = createRequire(uniwindPkg)
		const { compile } = uniwindReq('@tailwindcss/node') as {
			compile: (
				css: string,
				opts: { base: string; onDependency: () => void }
			) => Promise<{
				sources: Array<{ negated: boolean; pattern: string; base: string }>
				build: (candidates: string[]) => string
			}>
		}
		const { Scanner } = uniwindReq('@tailwindcss/oxide') as {
			Scanner: new (opts: {
				sources: Array<{ negated: boolean; pattern: string; base: string }>
			}) => {
				scan: () => string[]
			}
		}

		const cssPath = resolve(MOBILE_ROOT, 'global.css')
		const globalCss = readFileSync(cssPath, 'utf8')
		const compiler = await compile(globalCss, {
			base: dirname(cssPath),
			onDependency: () => {}
		})
		const scanner = new Scanner({
			sources: [...compiler.sources, { negated: false, pattern: '**/*', base: dirname(cssPath) }]
		})
		const compiled = compiler.build(scanner.scan())

		expect(compiled).toContain(':root:where(.light, .light *)')
		expect(compiled).toContain(':root:where(.dark, .dark *)')
		expect(compiled).not.toContain(':root:is(.dark')

		expect(lastVarInRule(compiled, ':root:where(.light, .light *)', 'accent')).toBe(
			'oklch(0.575 0.215 12.21)'
		)
		expect(lastVarInRule(compiled, ':root:where(.dark, .dark *)', 'accent')).toBe('oklch(0.575 0.215 12.21)')
		expect(lastVarInRule(compiled, ':root:where(.light, .light *)', 'muted')).toBe('oklch(0.45 0.01 265)')
		expect(lastVarInRule(compiled, ':root:where(.dark, .dark *)', 'background')).toBe(
			'oklch(0.165 0.004 265)'
		)

		expect(compiled).toContain('--color-muted-foreground')
		expect(compiled).toContain('--color-destructive')
		expect(compiled).toContain('--color-info')
		expect(compiled).toContain('--color-primary')
	})

	test('availability colors derive hex tokens from @huriro/design-tokens/rn-theme', () => {
		const states: readonly EffectiveAvailabilityState[] = [
			'available',
			'busy',
			'dnd',
			'away',
			'off_hours',
			'ooo',
			'offline'
		]
		for (const state of states) {
			expect(availabilityColor(state)).toMatch(/^#[0-9a-f]{6}$/)
		}
		expect(availabilityColor('available')).toBe(lightTheme.colors['success'] ?? '')
		expect(availabilityColor('dnd')).toBe(lightTheme.colors['destructive'] ?? '')
		expect(availabilityColor('ooo')).toBe(lightTheme.colors['info'] ?? '')

		const customPalette = {
			success: darkTheme.colors['success'] ?? '#4cb86a',
			warning: darkTheme.colors['warning'] ?? '#e6ac3d',
			danger: darkTheme.colors['destructive'] ?? '#f14e46',
			info: darkTheme.colors['info'] ?? '#4baeed',
			muted: darkTheme.colors['muted-foreground'] ?? '#a3a5a8'
		}
		expect(resolveAvailabilityColor('available', customPalette)).toBe(customPalette.success)
		expect(resolveAvailabilityColor('busy', customPalette)).toBe(customPalette.warning)
		expect(resolveAvailabilityColor('dnd', customPalette)).toBe(customPalette.danger)
		expect(resolveAvailabilityColor('off_hours', customPalette)).toBe(customPalette.info)
		expect(resolveAvailabilityColor('offline', customPalette)).toBe(customPalette.muted)
	})
})
