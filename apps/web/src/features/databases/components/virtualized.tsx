import { type RefObject, useEffect, useMemo, useState } from 'react'

export interface VirtualWindow {
	readonly start: number
	readonly end: number
	readonly paddingTop: number
	readonly paddingBottom: number
}

/**
 * Small local row windowing hook. Keeping this dependency-free matters for the
 * 200 KB shell budget; all heavy database UI is already lazy-loaded.
 */
export function useVirtualWindow(
	count: number,
	rowHeight: number,
	containerRef: RefObject<HTMLElement | null>,
	overscan = 8
): VirtualWindow {
	const [scrollTop, setScrollTop] = useState(0)
	const [viewportHeight, setViewportHeight] = useState(480)

	useEffect(() => {
		const el = containerRef.current
		if (!el) return
		const update = () => {
			setScrollTop(el.scrollTop)
			setViewportHeight(el.clientHeight || 480)
		}
		update()
		el.addEventListener('scroll', update, { passive: true })
		const observer = new ResizeObserver(update)
		observer.observe(el)
		return () => {
			el.removeEventListener('scroll', update)
			observer.disconnect()
		}
	}, [containerRef])

	return useMemo(() => {
		const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
		const visible = Math.ceil(viewportHeight / rowHeight) + overscan * 2
		const end = Math.min(count, start + visible)
		return {
			start,
			end,
			paddingTop: start * rowHeight,
			paddingBottom: Math.max(0, (count - end) * rowHeight)
		}
	}, [count, overscan, rowHeight, scrollTop, viewportHeight])
}
