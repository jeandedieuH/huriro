import type { ProseMirrorNodeJson } from './markdown'
import { isSafeUrl, sanitizeHtml } from './sanitize'

export type HtmlDocFontStyle = 'sans' | 'serif' | 'mono'

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

function renderInlineHtml(
	nodes: readonly ProseMirrorNodeJson[] | undefined,
	includeSuggestions = false
): string {
	if (!nodes || nodes.length === 0) return ''
	return nodes
		.map((node) => {
			if (node.type === 'hardBreak') return '<br />'
			if (node.type === 'mathInline') {
				return `<code data-math="inline">${escapeHtml(String(node.attrs?.['latex'] ?? ''))}</code>`
			}
			if (node.type === 'entityMention') {
				const entityType = String(node.attrs?.['entityType'] ?? 'person')
				const entityId = String(node.attrs?.['entityId'] ?? '')
				const label = String(node.attrs?.['label'] ?? entityId)
				const prefix = entityType === 'person' ? '@' : entityType === 'issue' ? '#' : ''
				return `<span data-entity-mention="true" data-entity-type="${escapeHtml(entityType)}" data-entity-id="${escapeHtml(entityId)}">${escapeHtml(`${prefix}${label}`)}</span>`
			}
			if (node.type === 'image') {
				const src = String(node.attrs?.['src'] ?? '')
				if (!isSafeUrl(src)) return ''
				const alt = String(node.attrs?.['alt'] ?? '')
				return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />`
			}
			if (node.type !== 'text') return ''

			const marks = node.marks ?? []
			const hasDeleteSuggestion = marks.some((m) => m.type === 'suggestionDelete')
			if (!includeSuggestions && hasDeleteSuggestion) {
				return ''
			}

			let out = escapeHtml(node.text ?? '')
			for (const m of marks) {
				switch (m.type) {
					case 'code':
						out = `<code>${out}</code>`
						break
					case 'bold':
						out = `<strong>${out}</strong>`
						break
					case 'italic':
						out = `<em>${out}</em>`
						break
					case 'strike':
						out = `<s>${out}</s>`
						break
					case 'link': {
						const href = String(m.attrs?.['href'] ?? '')
						if (isSafeUrl(href)) {
							out = `<a href="${escapeHtml(href)}">${out}</a>`
						}
						break
					}
					case 'suggestionInsert':
						if (includeSuggestions) {
							out = `<ins data-suggestion-insert="true">${out}</ins>`
						}
						break
					case 'suggestionDelete':
						if (includeSuggestions) {
							out = `<del data-suggestion-delete="true">${out}</del>`
						}
						break
					default:
						break
				}
			}
			return out
		})
		.join('')
}

function toneAttrs(node: ProseMirrorNodeJson): string {
	const attrs: string[] = []
	const blockId = node.attrs?.['blockId']
	if (typeof blockId === 'string' && blockId.length > 0) {
		attrs.push(`id="block-${escapeHtml(blockId)}"`, `data-block-id="${escapeHtml(blockId)}"`)
	}
	const textTone = node.attrs?.['textTone']
	if (typeof textTone === 'string' && textTone !== 'default') {
		attrs.push(`data-text-tone="${escapeHtml(textTone)}"`)
	}
	const bgTone = node.attrs?.['bgTone']
	if (typeof bgTone === 'string' && bgTone !== 'default') {
		attrs.push(`data-bg-tone="${escapeHtml(bgTone)}"`)
	}
	return attrs.length > 0 ? ` ${attrs.join(' ')}` : ''
}

function renderBlocksHtml(
	nodes: readonly ProseMirrorNodeJson[] | undefined,
	includeSuggestions = false
): string {
	if (!nodes || nodes.length === 0) return ''
	const parts: string[] = []

	for (const node of nodes) {
		const extra = toneAttrs(node)
		switch (node.type) {
			case 'heading': {
				const level = Math.max(1, Math.min(6, Number(node.attrs?.['level'] ?? 1)))
				parts.push(`<h${level}${extra}>${renderInlineHtml(node.content, includeSuggestions)}</h${level}>`)
				break
			}
			case 'paragraph': {
				const inner = renderInlineHtml(node.content, includeSuggestions)
				parts.push(`<p${extra}>${inner || '<br />'}</p>`)
				break
			}
			case 'codeBlock': {
				const code = (node.content ?? []).map((c) => c.text ?? '').join('')
				parts.push(`<pre${extra}><code>${escapeHtml(code)}</code></pre>`)
				break
			}
			case 'blockquote': {
				parts.push(`<blockquote${extra}>${renderBlocksHtml(node.content, includeSuggestions)}</blockquote>`)
				break
			}
			case 'callout': {
				const tone = escapeHtml(String(node.attrs?.['tone'] ?? 'info'))
				parts.push(
					`<div data-callout-tone="${tone}"${extra}>${renderBlocksHtml(node.content, includeSuggestions)}</div>`
				)
				break
			}
			case 'toggle': {
				const summary = escapeHtml(String(node.attrs?.['summary'] ?? 'Details'))
				const openAttr = node.attrs?.['open'] === false ? '' : ' open'
				parts.push(
					`<details data-toggle="true"${openAttr}${extra}><summary>${summary}</summary>${renderBlocksHtml(node.content, includeSuggestions)}</details>`
				)
				break
			}
			case 'toggleHeading': {
				const summary = escapeHtml(String(node.attrs?.['summary'] ?? 'Toggle heading'))
				const level = Math.max(1, Math.min(3, Number(node.attrs?.['level'] ?? 2)))
				const openAttr = node.attrs?.['open'] === false ? '' : ' open'
				parts.push(
					`<details data-toggle-heading="true" data-level="${level}"${openAttr}${extra}><summary><strong>${summary}</strong></summary>${renderBlocksHtml(node.content, includeSuggestions)}</details>`
				)
				break
			}
			case 'columns': {
				parts.push(
					`<div data-columns="true"${extra}>${renderBlocksHtml(node.content, includeSuggestions)}</div>`
				)
				break
			}
			case 'column': {
				parts.push(`<div data-column="true">${renderBlocksHtml(node.content, includeSuggestions)}</div>`)
				break
			}
			case 'bulletList': {
				const items = (node.content ?? [])
					.map((li) => `<li>${renderBlocksHtml(li.content, includeSuggestions)}</li>`)
					.join('')
				parts.push(`<ul>${items}</ul>`)
				break
			}
			case 'orderedList': {
				const items = (node.content ?? [])
					.map((li) => `<li>${renderBlocksHtml(li.content, includeSuggestions)}</li>`)
					.join('')
				parts.push(`<ol>${items}</ol>`)
				break
			}
			case 'taskList': {
				const items = (node.content ?? [])
					.map((li) => {
						const mark = li.attrs?.['checked'] === true ? '[x] ' : '[ ] '
						return `<li>${mark}${renderBlocksHtml(li.content, includeSuggestions)}</li>`
					})
					.join('')
				parts.push(`<ul>${items}</ul>`)
				break
			}
			case 'table': {
				const rows = (node.content ?? [])
					.map((row) => {
						const cells = (row.content ?? [])
							.map((cell) => {
								const tag = cell.type === 'tableHeader' ? 'th' : 'td'
								const cellTone = cell.attrs?.['backgroundTone']
								const toneAttr =
									typeof cellTone === 'string' && cellTone !== 'default'
										? ` data-cell-tone="${escapeHtml(cellTone)}"`
										: ''
								return `<${tag}${toneAttr}>${renderBlocksHtml(cell.content, includeSuggestions)}</${tag}>`
							})
							.join('')
						return `<tr>${cells}</tr>`
					})
					.join('')
				parts.push(`<table><tbody>${rows}</tbody></table>`)
				break
			}
			case 'horizontalRule': {
				parts.push('<hr />')
				break
			}
			case 'mermaidBlock': {
				const alt = escapeHtml(String(node.attrs?.['alt'] ?? 'Diagram'))
				const code = escapeHtml(String(node.attrs?.['code'] ?? ''))
				parts.push(
					`<figure data-mermaid-block="true"><pre><code>${code}</code></pre><figcaption>${alt}</figcaption></figure>`
				)
				break
			}
			case 'mathBlock': {
				const latex = escapeHtml(String(node.attrs?.['latex'] ?? ''))
				parts.push(`<div data-math="block"><pre><code>${latex}</code></pre></div>`)
				break
			}
			case 'bookmarkCard': {
				const url = String(node.attrs?.['url'] ?? '')
				if (!isSafeUrl(url)) break
				const title = escapeHtml(String(node.attrs?.['title'] ?? '') || url)
				const desc = escapeHtml(String(node.attrs?.['description'] ?? ''))
				parts.push(
					`<div data-bookmark="true"><a href="${escapeHtml(url)}">${title}</a>${desc ? `<p>${desc}</p>` : ''}</div>`
				)
				break
			}
			case 'syncedBlock': {
				const fallback = escapeHtml(
					String(node.attrs?.['fallbackText'] ?? node.attrs?.['title'] ?? 'Synced block')
				)
				parts.push(`<div data-callout-tone="info"><p>${fallback}</p></div>`)
				break
			}
			case 'referenceBlock': {
				const idf = String(node.attrs?.['identifier'] ?? '')
				const title = String(node.attrs?.['title'] ?? '')
				parts.push(`<blockquote${extra}><p>${escapeHtml(idf ? `${idf} — ${title}` : title)}</p></blockquote>`)
				break
			}
			case 'embed': {
				const url = String(node.attrs?.['url'] ?? '')
				if (!isSafeUrl(url)) break
				const title = escapeHtml(String(node.attrs?.['title'] ?? '') || url)
				parts.push(`<p><a href="${escapeHtml(url)}">${title}</a></p>`)
				break
			}
			case 'buttonBlock': {
				const label = escapeHtml(String(node.attrs?.['label'] ?? 'Action'))
				parts.push(`<p><strong>[${label}]</strong></p>`)
				break
			}
			case 'tocBlock': {
				parts.push('<nav data-toc="true"><p>Table of contents</p></nav>')
				break
			}
			default:
				break
		}
	}

	return parts.join('\n')
}

export function proseMirrorJsonToSafeHtml(
	doc: Record<string, unknown>,
	opts?: { readonly includeSuggestions?: boolean | undefined }
): string {
	const content = Array.isArray(doc['content']) ? (doc['content'] as ProseMirrorNodeJson[]) : []
	const rawHtml = renderBlocksHtml(content, opts?.includeSuggestions ?? false)
	return sanitizeHtml(rawHtml)
}

export function renderStandaloneHtmlDocument(opts: {
	readonly title: string
	readonly subtitle?: string | undefined
	readonly html: string
	readonly fontStyle?: HtmlDocFontStyle | undefined
	readonly fullWidth?: boolean | undefined
	readonly smallText?: boolean | undefined
	readonly allowSearchIndexing?: boolean | undefined
	readonly printAuto?: boolean | undefined
}): string {
	const fontFamily =
		opts.fontStyle === 'serif'
			? 'Georgia, Cambria, "Times New Roman", serif'
			: opts.fontStyle === 'mono'
				? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
				: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
	const maxWidth = opts.fullWidth ? '1040px' : '760px'
	const fontSize = opts.smallText ? '14px' : '16px'
	const safeBody = sanitizeHtml(opts.html)
	const robotsMeta = opts.allowSearchIndexing
		? '<meta name="robots" content="index, follow" />'
		: '<meta name="robots" content="noindex, nofollow" />'

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${robotsMeta}
<title>${escapeHtml(opts.title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ${fontFamily}; font-size: ${fontSize}; line-height: 1.65; margin: 0; padding: 2.5rem 1.25rem; color: #18181b; background: #ffffff; }
  main { max-width: ${maxWidth}; margin: 0 auto; }
  h1, h2, h3 { line-height: 1.25; margin-top: 1.5em; }
  pre { background: #f4f4f5; padding: 0.85rem 1rem; border-radius: 6px; overflow-x: auto; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
  blockquote, [data-callout-tone] { border-left: 3px solid #71717a; padding: 0.5rem 0.9rem; margin: 0.75rem 0; background: #f4f4f5; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #d4d4d8; padding: 0.45rem 0.65rem; text-align: left; }
  th { background: #f4f4f5; }
  [data-columns="true"] { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin: 0.75rem 0; }
  [data-bookmark="true"] { border: 1px solid #d4d4d8; border-radius: 8px; padding: 0.75rem 1rem; margin: 0.75rem 0; }
  @media print { body { padding: 0; } main { max-width: 100%; } }
</style>
</head>
<body>
<main>
<header>
<h1>${escapeHtml(opts.title)}</h1>
${opts.subtitle ? `<p>${escapeHtml(opts.subtitle)}</p>` : ''}
</header>
<article>
${safeBody}
</article>
</main>
</body>
</html>`
}
