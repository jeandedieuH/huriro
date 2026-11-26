/**
 * Lazy-loaded upstream Mermaid renderer (§4.2). This module is only reached
 * through dynamic import from the editor NodeView, keeping the large parser and
 * layout dependencies out of the initial application shell.
 */

export type MermaidRenderResult =
	| { readonly ok: true; readonly svg: string }
	| { readonly ok: false; readonly error: string }

let renderSequence = 0
let initialized = false

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message
	return String(error)
}

/** Render Mermaid source to SVG with upstream grammar support. Strict security
 * mode keeps diagram labels interactive-safe and sanitizes generated markup. */
export async function renderMermaidSvg(rawCode: string): Promise<MermaidRenderResult> {
	const code = rawCode.trim()
	if (!code) return { ok: false, error: 'Mermaid source is empty' }
	try {
		const { default: mermaid } = await import('mermaid')
		if (!initialized) {
			mermaid.initialize({
				startOnLoad: false,
				securityLevel: 'strict',
				theme: 'neutral',
				flowchart: { htmlLabels: false },
				sequence: { useMaxWidth: true }
			})
			initialized = true
		}
		renderSequence += 1
		const id = `huriro-mermaid-${renderSequence}`
		const rendered = await mermaid.render(id, code)
		return { ok: true, svg: rendered.svg }
	} catch (error) {
		return { ok: false, error: errorMessage(error) }
	}
}
