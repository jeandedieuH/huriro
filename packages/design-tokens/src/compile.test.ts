import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

	test('tailwind theme uses @theme inline var mapping', () => {
		const tw = readFileSync(join(DIST, 'tailwind/theme.css'), 'utf8')
		expect(tw).toContain('@custom-variant dark')
		expect(tw).toContain('--color-primary: var(--primary);')
	})

	test('rn theme exports light + dark', () => {
		const ts = readFileSync(join(DIST, 'rn/theme.ts'), 'utf8')
		expect(ts).toContain('export const lightTheme')
		expect(ts).toContain('export const darkTheme')
	})

	test('aliases resolve — no unresolved {ref} remains', () => {
		const css = readFileSync(join(DIST, 'css/tokens.css'), 'utf8')
		expect(css).not.toContain('{color.')
	})
})
