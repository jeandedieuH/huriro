import { Lexer, type Token, type Tokens } from 'marked'
import * as Y from 'yjs'
import type { CalloutTone } from './extensions'
import { isSafeUrl, sanitizeHtml } from './sanitize'
import { prosemirrorJsonToYDoc, ydocToProseMirrorJson } from './yjs-utils'

export interface ProseMirrorMarkJson {
	readonly type: string
	readonly attrs?: Record<string, unknown> | undefined
}

export interface ProseMirrorNodeJson {
	readonly type: string
	readonly text?: string | undefined
	readonly attrs?: Record<string, unknown> | undefined
	readonly marks?: readonly ProseMirrorMarkJson[] | undefined
	readonly content?: readonly ProseMirrorNodeJson[] | undefined
}

export interface DocVersionDiffHunk {
	readonly kind: 'equal' | 'add' | 'remove'
	readonly text: string
}

function hash32Hex(input: string, init: number): string {
	let h = init >>> 0
	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i)
		h = Math.imul(h, 16777619) >>> 0
	}
	return h.toString(16).padStart(8, '0')
}

function deterministicBlockId(seed: string, idx: number): string {
	const input = `${seed}:${idx}`
	const hex =
		hash32Hex(input, 0x811c9dc5) +
		hash32Hex(`${input}:1`, 0x9e3779b9) +
		hash32Hex(`${input}:2`, 0x85ebca6b) +
		hash32Hex(`${input}:3`, 0xc2b2ae35)
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function withMarks(nodes: ProseMirrorNodeJson[], mark: ProseMirrorMarkJson): ProseMirrorNodeJson[] {
	return nodes.map((n) => {
		if (n.type !== 'text') return n
		return {
			...n,
			marks: [...(n.marks ?? []), mark]
		}
	})
}

const MENTION_PATTERN = /@\[([^\]]+)\]\((person|issue|doc):([^)]+)\)/g
const INLINE_MATH_PATTERN = /(?<!\$)\$([^$\n]+)\$(?!\$)/g

function parseTextWithMentions(rawText: string): ProseMirrorNodeJson[] {
	const out: ProseMirrorNodeJson[] = []
	let lastIndex = 0
	MENTION_PATTERN.lastIndex = 0
	let match = MENTION_PATTERN.exec(rawText)
	while (match !== null) {
		if (match.index > lastIndex) {
			out.push(...parseInlineMathRuns(rawText.slice(lastIndex, match.index)))
		}
		const label = match[1] ?? ''
		const entityType = match[2] ?? 'person'
		const entityId = match[3] ?? ''
		out.push({
			type: 'entityMention',
			attrs: { entityType, entityId, label }
		})
		lastIndex = match.index + match[0].length
		match = MENTION_PATTERN.exec(rawText)
	}
	if (lastIndex < rawText.length) {
		out.push(...parseInlineMathRuns(rawText.slice(lastIndex)))
	}
	return out.filter((n) => n.type !== 'text' || (n.text && n.text.length > 0))
}

function parseInlineMathRuns(rawText: string): ProseMirrorNodeJson[] {
	const out: ProseMirrorNodeJson[] = []
	let lastIndex = 0
	INLINE_MATH_PATTERN.lastIndex = 0
	let match = INLINE_MATH_PATTERN.exec(rawText)
	while (match !== null) {
		if (match.index > lastIndex) {
			out.push({ type: 'text', text: rawText.slice(lastIndex, match.index) })
		}
		const latex = match[1]?.trim() ?? ''
		if (latex) {
			out.push({ type: 'mathInline', attrs: { latex } })
		} else {
			out.push({ type: 'text', text: match[0] })
		}
		lastIndex = match.index + match[0].length
		match = INLINE_MATH_PATTERN.exec(rawText)
	}
	if (lastIndex < rawText.length) {
		out.push({ type: 'text', text: rawText.slice(lastIndex) })
	}
	return out
}

function inlineTokensToNodes(tokens: readonly Token[] | undefined): ProseMirrorNodeJson[] {
	if (!tokens || tokens.length === 0) return []
	const nodes: ProseMirrorNodeJson[] = []

	for (const tok of tokens) {
		switch (tok.type) {
			case 'text': {
				const t = tok as Tokens.Text
				if (t.tokens && t.tokens.length > 0) {
					nodes.push(...inlineTokensToNodes(t.tokens))
				} else if (t.text) {
					nodes.push(...parseTextWithMentions(t.text))
				}
				break
			}
			case 'escape': {
				const esc = tok as Tokens.Escape
				if (esc.text) nodes.push({ type: 'text', text: esc.text })
				break
			}
			case 'strong': {
				const s = tok as Tokens.Strong
				nodes.push(...withMarks(inlineTokensToNodes(s.tokens), { type: 'bold' }))
				break
			}
			case 'em': {
				const e = tok as Tokens.Em
				nodes.push(...withMarks(inlineTokensToNodes(e.tokens), { type: 'italic' }))
				break
			}
			case 'del': {
				const d = tok as Tokens.Del
				nodes.push(...withMarks(inlineTokensToNodes(d.tokens), { type: 'strike' }))
				break
			}
			case 'codespan': {
				const c = tok as Tokens.Codespan
				if (c.text) {
					nodes.push({ type: 'text', text: c.text, marks: [{ type: 'code' }] })
				}
				break
			}
			case 'br': {
				nodes.push({ type: 'hardBreak' })
				break
			}
			case 'link': {
				const l = tok as Tokens.Link
				const mentionMatch = /^(person|issue|doc):([A-Za-z0-9-]+)$/.exec(l.href)
				if (mentionMatch) {
					const entityType = mentionMatch[1] ?? 'person'
					const entityId = mentionMatch[2] ?? ''
					const prev = nodes[nodes.length - 1]
					const prefixChar = entityType === 'person' ? '@' : entityType === 'issue' ? '#' : null
					if (prefixChar && prev?.type === 'text' && prev.text?.endsWith(prefixChar)) {
						const trimmed = prev.text.slice(0, -1)
						if (trimmed.length > 0) {
							nodes[nodes.length - 1] = { ...prev, text: trimmed }
						} else {
							nodes.pop()
						}
					}
					nodes.push({
						type: 'entityMention',
						attrs: { entityType, entityId, label: l.text || entityId }
					})
					break
				}
				const children = inlineTokensToNodes(l.tokens)
				if (isSafeUrl(l.href)) {
					nodes.push(
						...withMarks(children.length > 0 ? children : [{ type: 'text', text: l.text || l.href }], {
							type: 'link',
							attrs: { href: l.href }
						})
					)
				} else {
					nodes.push(...(children.length > 0 ? children : [{ type: 'text', text: l.text || '' }]))
				}
				break
			}
			case 'image': {
				const img = tok as Tokens.Image
				if (isSafeUrl(img.href)) {
					nodes.push({
						type: 'image',
						attrs: { src: img.href, alt: img.text ?? '', title: img.title ?? null }
					})
				}
				break
			}
			case 'html': {
				// Strip raw HTML by default per §12.6; keep only sanitized inner plain text if harmless.
				const sanitized = sanitizeHtml((tok as Tokens.HTML).text ?? '')
					.replace(/<[^>]+>/g, '')
					.trim()
				if (sanitized) nodes.push({ type: 'text', text: sanitized })
				break
			}
			default: {
				if ('text' in tok && typeof tok.text === 'string' && tok.text.length > 0) {
					nodes.push(...parseTextWithMentions(tok.text))
				}
				break
			}
		}
	}

	return nodes
}

const CALLOUT_TAG_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i

function mapCalloutTone(tag: string): CalloutTone {
	const upper = tag.toUpperCase()
	if (upper === 'WARNING') return 'warning'
	if (upper === 'CAUTION') return 'danger'
	if (upper === 'TIP') return 'success'
	return 'info'
}

function blockTokensToNodes(
	tokens: readonly Token[],
	counter: { idx: number },
	seed: string
): ProseMirrorNodeJson[] {
	const out: ProseMirrorNodeJson[] = []

	for (const tok of tokens) {
		switch (tok.type) {
			case 'space':
				break
			case 'heading': {
				const h = tok as Tokens.Heading
				const blockId = deterministicBlockId(seed, counter.idx++)
				const inline = inlineTokensToNodes(h.tokens)
				out.push({
					type: 'heading',
					attrs: { level: Math.max(1, Math.min(6, h.depth)), blockId },
					...(inline.length > 0 ? { content: inline } : {})
				})
				break
			}
			case 'paragraph': {
				const p = tok as Tokens.Paragraph
				const trimmed = p.raw.trim()
				const mathBlockMatch = /^\$\$([\s\S]+?)\$\$$/.exec(trimmed)
				if (mathBlockMatch?.[1]) {
					out.push({
						type: 'mathBlock',
						attrs: {
							latex: mathBlockMatch[1].trim(),
							blockId: deterministicBlockId(seed, counter.idx++)
						}
					})
					break
				}
				const inline = inlineTokensToNodes(p.tokens)
				// Image-only paragraph stays as paragraph or image block; keeping paragraph is TipTap-safe.
				const blockId = deterministicBlockId(seed, counter.idx++)
				out.push({
					type: 'paragraph',
					attrs: { blockId },
					...(inline.length > 0 ? { content: inline } : {})
				})
				break
			}
			case 'code': {
				const c = tok as Tokens.Code
				const blockId = deterministicBlockId(seed, counter.idx++)
				if ((c.lang ?? '').trim().toLowerCase() === 'mermaid') {
					out.push({
						type: 'mermaidBlock',
						attrs: { code: c.text, alt: 'Diagram', viewMode: 'split', blockId }
					})
					break
				}
				out.push({
					type: 'codeBlock',
					attrs: { language: c.lang || null, blockId },
					...(c.text ? { content: [{ type: 'text', text: c.text }] } : {})
				})
				break
			}
			case 'blockquote': {
				const bq = tok as Tokens.Blockquote
				const first = bq.tokens[0]
				if (first?.type === 'paragraph') {
					const m = CALLOUT_TAG_RE.exec((first as Tokens.Paragraph).text)
					if (m) {
						const tone = mapCalloutTone(m[1] ?? 'NOTE')
						const strippedText = (first as Tokens.Paragraph).text.replace(CALLOUT_TAG_RE, '')
						const firstParaTokens = Lexer.lexInline(strippedText)
						const rest = blockTokensToNodes(bq.tokens.slice(1), counter, seed)
						const firstInline = inlineTokensToNodes(firstParaTokens)
						const calloutBlockId = deterministicBlockId(seed, counter.idx++)
						const innerBlocks: ProseMirrorNodeJson[] = [
							{
								type: 'paragraph',
								attrs: { blockId: deterministicBlockId(seed, counter.idx++) },
								...(firstInline.length > 0 ? { content: firstInline } : {})
							},
							...rest
						]
						out.push({
							type: 'callout',
							attrs: { tone, blockId: calloutBlockId },
							content: innerBlocks
						})
						break
					}
				}
				const inner = blockTokensToNodes(bq.tokens, counter, seed)
				out.push({
					type: 'blockquote',
					attrs: { blockId: deterministicBlockId(seed, counter.idx++) },
					content: inner.length > 0 ? inner : [{ type: 'paragraph' }]
				})
				break
			}
			case 'list': {
				const list = tok as Tokens.List
				const isTask = list.items.some((item) => item.task)
				if (isTask) {
					out.push({
						type: 'taskList',
						content: list.items.map((item) => {
							const itemContent = blockTokensToNodes(item.tokens, counter, seed)
							return {
								type: 'taskItem',
								attrs: { checked: Boolean(item.checked) },
								content: itemContent.length > 0 ? itemContent : [{ type: 'paragraph' }]
							}
						})
					})
				} else {
					out.push({
						type: list.ordered ? 'orderedList' : 'bulletList',
						content: list.items.map((item) => {
							const itemContent = blockTokensToNodes(item.tokens, counter, seed)
							return {
								type: 'listItem',
								content: itemContent.length > 0 ? itemContent : [{ type: 'paragraph' }]
							}
						})
					})
				}
				break
			}
			case 'text': {
				// Tight list items emit `text` tokens inside item.tokens.
				const t = tok as Tokens.Text
				const inline = inlineTokensToNodes(t.tokens ?? [t])
				out.push({
					type: 'paragraph',
					attrs: { blockId: deterministicBlockId(seed, counter.idx++) },
					...(inline.length > 0 ? { content: inline } : {})
				})
				break
			}
			case 'table': {
				const tbl = tok as Tokens.Table
				const headerRow: ProseMirrorNodeJson = {
					type: 'tableRow',
					content: tbl.header.map((cell) => {
						const inline = inlineTokensToNodes(cell.tokens)
						return {
							type: 'tableHeader',
							content: [{ type: 'paragraph', ...(inline.length > 0 ? { content: inline } : {}) }]
						}
					})
				}
				const bodyRows: ProseMirrorNodeJson[] = tbl.rows.map((row) => ({
					type: 'tableRow',
					content: row.map((cell) => {
						const inline = inlineTokensToNodes(cell.tokens)
						return {
							type: 'tableCell',
							content: [{ type: 'paragraph', ...(inline.length > 0 ? { content: inline } : {}) }]
						}
					})
				}))
				out.push({
					type: 'table',
					content: [headerRow, ...bodyRows]
				})
				break
			}
			case 'hr': {
				out.push({ type: 'horizontalRule' })
				break
			}
			case 'html': {
				// Strip unsafe HTML tags; preserve plain text if any non-script text remains.
				const cleaned = sanitizeHtml((tok as Tokens.HTML).text ?? '')
					.replace(/<[^>]+>/g, '')
					.trim()
				if (cleaned) {
					out.push({
						type: 'paragraph',
						attrs: { blockId: deterministicBlockId(seed, counter.idx++) },
						content: [{ type: 'text', text: cleaned }]
					})
				}
				break
			}
			default:
				break
		}
	}

	return out
}

export function markdownToProseMirrorJson(
	markdown: string,
	seed = 'md'
): { readonly type: 'doc'; readonly content: ProseMirrorNodeJson[] } {
	const tokens = Lexer.lex(markdown, { gfm: true, breaks: false })
	const counter = { idx: 0 }
	const content = blockTokensToNodes(tokens, counter, seed)
	return {
		type: 'doc',
		content:
			content.length > 0
				? content
				: [{ type: 'paragraph', attrs: { blockId: deterministicBlockId(seed, 0) } }]
	}
}

function serializeInline(nodes: readonly ProseMirrorNodeJson[] | undefined): string {
	if (!nodes || nodes.length === 0) return ''
	return nodes
		.map((node) => {
			if (node.type === 'hardBreak') return '  \n'
			if (node.type === 'mathInline') {
				return `$${String(node.attrs?.['latex'] ?? '')}$`
			}
			if (node.type === 'entityMention') {
				const label = String(node.attrs?.['label'] ?? '')
				const entityType = String(node.attrs?.['entityType'] ?? 'person')
				const entityId = String(node.attrs?.['entityId'] ?? '')
				return `@[${label}](${entityType}:${entityId})`
			}
			if (node.type === 'image') {
				const src = String(node.attrs?.['src'] ?? '')
				const alt = String(node.attrs?.['alt'] ?? '')
				return isSafeUrl(src) ? `![${alt}](${src})` : ''
			}
			if (node.type !== 'text') return ''
			const marks = node.marks ?? []
			if (marks.some((m) => m.type === 'suggestionDelete')) return ''
			let text = node.text ?? ''
			// Apply code innermost, then emphasis/strike, then link outermost.
			const code = marks.find((m) => m.type === 'code')
			if (code) text = `\`${text}\``
			if (marks.some((m) => m.type === 'bold')) text = `**${text}**`
			if (marks.some((m) => m.type === 'italic')) text = `*${text}*`
			if (marks.some((m) => m.type === 'strike')) text = `~~${text}~~`
			const link = marks.find((m) => m.type === 'link')
			if (link) {
				const href = String(link.attrs?.['href'] ?? '')
				if (isSafeUrl(href)) text = `[${text}](${href})`
			}
			return text
		})
		.join('')
}

function toneToGithubAlert(tone: string): string {
	switch (tone) {
		case 'warning':
			return 'WARNING'
		case 'danger':
			return 'CAUTION'
		case 'success':
			return 'TIP'
		default:
			return 'NOTE'
	}
}

function serializeBlocks(nodes: readonly ProseMirrorNodeJson[] | undefined, indent = ''): string {
	if (!nodes || nodes.length === 0) return ''
	const parts: string[] = []

	for (const node of nodes) {
		switch (node.type) {
			case 'heading': {
				const level = Number(node.attrs?.['level'] ?? 1)
				const hashes = '#'.repeat(Math.max(1, Math.min(6, level)))
				parts.push(`${hashes} ${serializeInline(node.content)}`)
				break
			}
			case 'paragraph': {
				parts.push(serializeInline(node.content))
				break
			}
			case 'codeBlock': {
				const lang = String(node.attrs?.['language'] ?? '')
				const code = (node.content ?? []).map((c) => c.text ?? '').join('')
				parts.push(`\`\`\`${lang}\n${code}\n\`\`\``)
				break
			}
			case 'blockquote': {
				const inner = serializeBlocks(node.content)
				parts.push(
					inner
						.split('\n')
						.map((line) => (line ? `> ${line}` : '>'))
						.join('\n')
				)
				break
			}
			case 'callout': {
				const tone = toneToGithubAlert(String(node.attrs?.['tone'] ?? 'info'))
				const inner = serializeBlocks(node.content)
				const lines = inner.split('\n')
				const firstLine = `> [!${tone}] ${lines[0] ?? ''}`.trimEnd()
				const rest = lines.slice(1).map((line) => (line ? `> ${line}` : '>'))
				parts.push([firstLine, ...rest].join('\n'))
				break
			}
			case 'toggle': {
				const summary = String(node.attrs?.['summary'] ?? 'Details')
				const inner = serializeBlocks(node.content)
				parts.push(`<details>\n<summary>${summary}</summary>\n\n${inner}\n\n</details>`)
				break
			}
			case 'toggleHeading': {
				const level = Number(node.attrs?.['level'] ?? 2)
				const hashes = '#'.repeat(Math.max(1, Math.min(3, level)))
				const summary = String(node.attrs?.['summary'] ?? 'Toggle heading')
				const inner = serializeBlocks(node.content)
				parts.push(`<details>\n<summary>${hashes} ${summary}</summary>\n\n${inner}\n\n</details>`)
				break
			}
			case 'columns': {
				const colTexts = (node.content ?? []).map((col) => serializeBlocks(col.content)).filter(Boolean)
				if (colTexts.length > 0) parts.push(colTexts.join('\n\n'))
				break
			}
			case 'column': {
				const inner = serializeBlocks(node.content)
				if (inner) parts.push(inner)
				break
			}
			case 'mermaidBlock': {
				const code = String(node.attrs?.['code'] ?? '')
				parts.push(`\`\`\`mermaid\n${code}\n\`\`\``)
				break
			}
			case 'mathBlock': {
				const latex = String(node.attrs?.['latex'] ?? '')
				parts.push(`$$\n${latex}\n$$`)
				break
			}
			case 'bookmarkCard': {
				const url = String(node.attrs?.['url'] ?? '')
				const title = String(node.attrs?.['title'] ?? '') || url
				if (isSafeUrl(url)) parts.push(`[${title}](${url})`)
				break
			}
			case 'tocBlock': {
				parts.push('[TOC]')
				break
			}
			case 'syncedBlock': {
				const fallback = String(node.attrs?.['fallbackText'] ?? node.attrs?.['title'] ?? 'Synced block')
				parts.push(`> ${fallback}`)
				break
			}
			case 'buttonBlock': {
				const label = String(node.attrs?.['label'] ?? 'Button')
				parts.push(`[Button: ${label}]`)
				break
			}
			case 'bulletList': {
				const items = (node.content ?? []).map((item) => {
					const inner = serializeBlocks(item.content, `${indent}  `)
					const [first, ...rest] = inner.split('\n')
					return [`${indent}- ${first ?? ''}`, ...rest.map((r) => (r ? `${indent}  ${r}` : ''))].join('\n')
				})
				parts.push(items.join('\n'))
				break
			}
			case 'orderedList': {
				const items = (node.content ?? []).map((item, idx) => {
					const inner = serializeBlocks(item.content, `${indent}   `)
					const [first, ...rest] = inner.split('\n')
					return [
						`${indent}${idx + 1}. ${first ?? ''}`,
						...rest.map((r) => (r ? `${indent}   ${r}` : ''))
					].join('\n')
				})
				parts.push(items.join('\n'))
				break
			}
			case 'taskList': {
				const items = (node.content ?? []).map((item) => {
					const checked = item.attrs?.['checked'] === true ? 'x' : ' '
					const inner = serializeBlocks(item.content, `${indent}  `)
					const [first, ...rest] = inner.split('\n')
					return [
						`${indent}- [${checked}] ${first ?? ''}`,
						...rest.map((r) => (r ? `${indent}  ${r}` : ''))
					].join('\n')
				})
				parts.push(items.join('\n'))
				break
			}
			case 'table': {
				const rows = node.content ?? []
				if (rows.length === 0) break
				const renderedRows = rows.map((row) => {
					const cells = (row.content ?? []).map((cell) =>
						serializeBlocks(cell.content).replace(/\n+/g, ' ').trim()
					)
					return `| ${cells.join(' | ')} |`
				})
				const headerCells = rows[0]?.content?.length ?? 0
				const sep = `| ${Array.from({ length: headerCells }, () => '---').join(' | ')} |`
				parts.push([renderedRows[0] ?? '', sep, ...renderedRows.slice(1)].join('\n'))
				break
			}
			case 'horizontalRule': {
				parts.push('---')
				break
			}
			case 'referenceBlock': {
				const idf = String(node.attrs?.['identifier'] ?? '')
				const title = String(node.attrs?.['title'] ?? '')
				parts.push(`> Reference: ${idf ? `${idf} — ` : ''}${title}`)
				break
			}
			case 'embed': {
				const url = String(node.attrs?.['url'] ?? '')
				const title = String(node.attrs?.['title'] ?? '') || url
				if (isSafeUrl(url)) parts.push(`[${title}](${url})`)
				break
			}
			default:
				break
		}
	}

	return parts.join('\n\n')
}

export function proseMirrorJsonToMarkdown(doc: Record<string, unknown>): string {
	const content = Array.isArray(doc['content']) ? (doc['content'] as ProseMirrorNodeJson[]) : []
	return serializeBlocks(content)
}

export function markdownToYDocUpdate(markdown: string, seed = 'md'): Uint8Array {
	const json = markdownToProseMirrorJson(markdown, seed)
	const ydoc = prosemirrorJsonToYDoc(json)
	return Y.encodeStateAsUpdate(ydoc)
}

export function ydocToMarkdown(ydoc: Y.Doc): string {
	const json = ydocToProseMirrorJson(ydoc)
	return proseMirrorJsonToMarkdown(json)
}

/**
 * Line-level LCS diff between two plain-text document versions (§10.4).
 */
export function diffVersionText(oldText: string, newText: string): DocVersionDiffHunk[] {
	const a = oldText.length === 0 ? [] : oldText.split('\n')
	const b = newText.length === 0 ? [] : newText.split('\n')
	const n = a.length
	const m = b.length

	const dp: number[][] = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0))
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			const rowI = dp[i]
			const rowNext = dp[i + 1]
			if (!rowI || !rowNext) continue
			if (a[i] === b[j]) {
				rowI[j] = (rowNext[j + 1] ?? 0) + 1
			} else {
				rowI[j] = Math.max(rowNext[j] ?? 0, rowI[j + 1] ?? 0)
			}
		}
	}

	const hunks: DocVersionDiffHunk[] = []
	let i = 0
	let j = 0
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			hunks.push({ kind: 'equal', text: a[i] ?? '' })
			i++
			j++
		} else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
			hunks.push({ kind: 'remove', text: a[i] ?? '' })
			i++
		} else {
			hunks.push({ kind: 'add', text: b[j] ?? '' })
			j++
		}
	}
	while (i < n) {
		hunks.push({ kind: 'remove', text: a[i] ?? '' })
		i++
	}
	while (j < m) {
		hunks.push({ kind: 'add', text: b[j] ?? '' })
		j++
	}
	return hunks
}
