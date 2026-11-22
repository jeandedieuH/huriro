import '@testing-library/jest-dom/vitest'
import { expect } from 'vitest'
import { axe } from 'vitest-axe'

/** vitest-axe's matcher d.ts is type-only; assert violations directly instead. */
export async function expectNoViolations(container: Element) {
	const results = await axe(container)
	expect(results.violations).toEqual([])
	return results
}
