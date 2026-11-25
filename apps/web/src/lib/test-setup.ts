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
// jsdom implements no geometry on Range, but ProseMirror's scrollToSelection
// reads getClientRects/getBoundingClientRect when editor commands scroll.
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
	Range.prototype.getClientRects = () => [] as unknown as DOMRectList
	Range.prototype.getBoundingClientRect = () =>
		({ x: 0, y: 0, top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 }) as DOMRect
}

/** vitest-axe's matcher d.ts is type-only; assert violations directly instead. */
export async function expectNoViolations(container: Element) {
	const results = await axe(container)
	expect(results.violations).toEqual([])
	return results
}
