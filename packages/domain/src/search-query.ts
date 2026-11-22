/**
 * Pure search & command-palette query parser (§11.1, §17.7).
 * Recognizes:
 *   - leading `>` → actions mode
 *   - exact issue identifier (`ENG-142`)
 *   - typed operators: `in:<projectKey>`, `is:open|closed`, `@<person>`,
 *     `label:<name|"quoted">`, `priority:<0..4|none|urgent|high|medium|low>`,
 *     `type:<issue|project|comment|doc|doc_page>`
 */

export type SearchMode = 'all' | 'actions'

export interface ParsedSearchQuery {
	readonly raw: string
	readonly mode: SearchMode
	readonly freeText: string
	readonly issueIdentifier: { readonly projectKey: string; readonly number: number } | null
	readonly projectKey: string | null
	readonly state: 'open' | 'closed' | null
	readonly assigneeHandle: string | null
	readonly labels: readonly string[]
	readonly priority: number | null
	readonly entityType: 'issue' | 'project' | 'comment' | 'doc_page' | null
}

const PRIORITY_MAP: Record<string, number> = {
	none: 0,
	'0': 0,
	low: 1,
	'1': 1,
	medium: 2,
	'2': 2,
	high: 3,
	'3': 3,
	urgent: 4,
	'4': 4
}

const ISSUE_KEY_RE = /^([A-Z][A-Z0-9]{1,9})-(\d+)$/i
const TOKEN_RE = /(?:[^\s"]+|"[^"]*")+/g

function unquote(value: string): string {
	return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value
}

export function parseSearchQuery(rawInput: string): ParsedSearchQuery {
	const raw = rawInput.trim()
	if (raw.startsWith('>')) {
		return {
			raw: rawInput,
			mode: 'actions',
			freeText: raw.slice(1).trim(),
			issueIdentifier: null,
			projectKey: null,
			state: null,
			assigneeHandle: null,
			labels: [],
			priority: null,
			entityType: null
		}
	}

	const tokens = raw.match(TOKEN_RE) ?? []
	const freeTokens: string[] = []
	let issueIdentifier: { readonly projectKey: string; readonly number: number } | null = null
	let projectKey: string | null = null
	let state: 'open' | 'closed' | null = null
	let assigneeHandle: string | null = null
	const labels: string[] = []
	let priority: number | null = null
	let entityType: 'issue' | 'project' | 'comment' | 'doc_page' | null = null

	for (const token of tokens) {
		const lower = token.toLowerCase()
		if (lower.startsWith('in:') && token.length > 3) {
			projectKey = unquote(token.slice(3)).toUpperCase()
			continue
		}
		if (lower === 'is:open' || lower === 'is:closed') {
			state = lower === 'is:open' ? 'open' : 'closed'
			continue
		}
		if (token.startsWith('@') && token.length > 1) {
			assigneeHandle = unquote(token.slice(1))
			continue
		}
		if (lower.startsWith('label:') && token.length > 6) {
			const lbl = unquote(token.slice(6)).trim()
			if (lbl) labels.push(lbl)
			continue
		}
		if (lower.startsWith('priority:') && token.length > 9) {
			const p = PRIORITY_MAP[unquote(token.slice(9)).toLowerCase()]
			if (p !== undefined) {
				priority = p
				continue
			}
		}
		if (lower.startsWith('type:') && token.length > 5) {
			const t = unquote(token.slice(5)).toLowerCase()
			if (t === 'issue' || t === 'project' || t === 'comment') {
				entityType = t
				continue
			}
			if (t === 'doc' || t === 'doc_page') {
				entityType = 'doc_page'
				continue
			}
		}
		const keyMatch = ISSUE_KEY_RE.exec(token)
		if (keyMatch && !issueIdentifier) {
			const parsedNumber = Number.parseInt(keyMatch[2] ?? '', 10)
			if (Number.isSafeInteger(parsedNumber) && parsedNumber > 0) {
				issueIdentifier = {
					projectKey: (keyMatch[1] ?? '').toUpperCase(),
					number: parsedNumber
				}
			}
		}
		freeTokens.push(unquote(token))
	}

	return {
		raw: rawInput,
		mode: 'all',
		freeText: freeTokens.join(' '),
		issueIdentifier,
		projectKey,
		state,
		assigneeHandle,
		labels,
		priority,
		entityType
	}
}
