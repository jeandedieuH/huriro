/**
 * Lazy-loaded KaTeX LaTeX renderer (§4.2, Gate G9).
 * Dynamically imported by math NodeViews so `katex` (~280 KB) and its CSS
 * stay out of the initial web shell bundle budget (<= 200 KB gzip).
 */
import katex from 'katex'
import 'katex/dist/katex.min.css'

export interface KatexRenderResult {
	readonly html: string
	readonly error: string | null
}

export function renderLatexToHtml(latex: string, displayMode: boolean): KatexRenderResult {
	const source = latex.trim()
	if (!source) {
		return { html: '', error: null }
	}
	try {
		const html = katex.renderToString(source, {
			displayMode,
			throwOnError: false,
			strict: false,
			trust: false,
			output: 'html'
		})
		return { html, error: null }
	} catch (err) {
		return {
			html: '',
			error: err instanceof Error ? err.message : 'Failed to render LaTeX expression'
		}
	}
}
