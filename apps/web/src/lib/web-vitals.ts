/**
 * Lightweight Core Web Vitals RUM collector (§20.1, §18) — zero dependencies
 * so the shell bundle stays well under the 200 KB gzip budget.
 */

export interface WebVitalSample {
	readonly name: 'LCP' | 'CLS' | 'INP' | 'TTFB'
	readonly value: number
	readonly rating: 'good' | 'needs-improvement' | 'poor'
	readonly path: string
}

function classify(name: WebVitalSample['name'], value: number): WebVitalSample['rating'] {
	switch (name) {
		case 'LCP':
			return value <= 2500 ? 'good' : value <= 4000 ? 'needs-improvement' : 'poor'
		case 'CLS':
			return value <= 0.1 ? 'good' : value <= 0.25 ? 'needs-improvement' : 'poor'
		case 'INP':
			return value <= 200 ? 'good' : value <= 500 ? 'needs-improvement' : 'poor'
		case 'TTFB':
			return value <= 800 ? 'good' : value <= 1800 ? 'needs-improvement' : 'poor'
	}
}

export function startWebVitalsRum(onMetric?: (sample: WebVitalSample) => void): () => void {
	if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') {
		return () => {}
	}
	const observers: PerformanceObserver[] = []
	const report = (name: WebVitalSample['name'], value: number) => {
		const sample: WebVitalSample = {
			name,
			value,
			rating: classify(name, value),
			path: window.location.pathname
		}
		onMetric?.(sample)
	}

	let clsScore = 0
	let maxInp = 0

	try {
		const lcpObs = new PerformanceObserver((list) => {
			const entries = list.getEntries()
			const last = entries[entries.length - 1]
			if (last) report('LCP', Math.round(last.startTime))
		})
		lcpObs.observe({ type: 'largest-contentful-paint', buffered: true })
		observers.push(lcpObs)
	} catch {
		// Unsupported entryType
	}

	try {
		const clsObs = new PerformanceObserver((list) => {
			for (const entry of list.getEntries() as unknown as {
				value?: number
				hadRecentInput?: boolean
			}[]) {
				if (!entry.hadRecentInput && typeof entry.value === 'number') {
					clsScore += entry.value
					report('CLS', Number(clsScore.toFixed(4)))
				}
			}
		})
		clsObs.observe({ type: 'layout-shift', buffered: true })
		observers.push(clsObs)
	} catch {
		// Unsupported entryType
	}

	try {
		const inpObs = new PerformanceObserver((list) => {
			for (const entry of list.getEntries() as unknown as { duration?: number }[]) {
				if (typeof entry.duration === 'number' && entry.duration > maxInp) {
					maxInp = entry.duration
					report('INP', Math.round(maxInp))
				}
			}
		})
		inpObs.observe({ type: 'event', buffered: true })
		observers.push(inpObs)
	} catch {
		// Unsupported entryType
	}

	return () => {
		for (const obs of observers) obs.disconnect()
	}
}
