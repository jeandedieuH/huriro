import type { ReactElement } from 'react'
import { render, toPlainText } from 'react-email'
import { emailRenderDurationSeconds } from '../api/observability'

export interface RenderedEmail {
	readonly html: string
	readonly text: string
}

/**
 * Render a React Email JSX element into email-client-compatible HTML and
 * a clean plain-text fallback in a single render pass.
 */
export async function renderEmail(element: ReactElement, templateName = 'custom'): Promise<RenderedEmail> {
	const started = performance.now()
	try {
		const html = await render(element)
		const text = toPlainText(html).trim()
		return {
			html,
			text:
				text.length > 0
					? text
					: html
							.replace(/<[^>]+>/g, ' ')
							.replace(/\s+/g, ' ')
							.trim()
		}
	} finally {
		emailRenderDurationSeconds.labels(templateName).observe((performance.now() - started) / 1000)
	}
}
