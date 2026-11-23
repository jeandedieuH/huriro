import '@testing-library/jest-dom/vitest'
import { expect } from 'vitest'
import { axe } from 'vitest-axe'

// jsdom lacks ResizeObserver and pointer-capture APIs required by Radix Select/Checkbox.
if (typeof globalThis.ResizeObserver === 'undefined') {
	globalThis.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
}
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.hasPointerCapture) {
	HTMLElement.prototype.hasPointerCapture = () => false
}
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
	Element.prototype.scrollIntoView = () => undefined
}

/** vitest-axe's matcher d.ts is type-only; assert violations directly instead. */
export async function expectNoViolations(container: Element) {
	const results = await axe(container)
	expect(results.violations).toEqual([])
	return results
}
