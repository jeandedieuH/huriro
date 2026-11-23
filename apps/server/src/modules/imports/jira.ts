/**
 * Jira importer (§17.13b):
 *   - RFC 4180 CSV parser supporting quoted fields, embedded commas, escaped `""`,
 *     CRLF/LF newlines, and Jira's repeated `Comment` / `Labels` columns
 *   - JSON payload normalization
 *   - Live Jira REST v3 fetch gated through SSRF-safe `safeEgressFetch`
 */
import type { JiraImportPayload } from '@huriro/contracts'
import { type DnsResolver, safeEgressFetch } from '../../api/egress'
import { HttpError } from '../../api/error'
import type { NormalizedImportDataset, NormalizedImportIssue } from './linear'

/** Pure RFC 4180 CSV parser returning rows of string cells. */
export function parseCsv(text: string): string[][] {
	const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
	const rows: string[][] = []
	let row: string[] = []
	let cell = ''
	let inQuotes = false
	let i = 0

	while (i < input.length) {
		const ch = input[i]!
		if (inQuotes) {
			if (ch === '"') {
				if (input[i + 1] === '"') {
					cell += '"'
					i += 2
					continue
				}
				inQuotes = false
				i++
				continue
			}
			cell += ch
			i++
			continue
		}

		if (ch === '"' && cell.length === 0) {
			inQuotes = true
			i++
			continue
		}
		if (ch === ',') {
			row.push(cell)
			cell = ''
			i++
			continue
		}
		if (ch === '\r' && input[i + 1] === '\n') {
			row.push(cell)
			rows.push(row)
			row = []
			cell = ''
			i += 2
			continue
		}
		if (ch === '\n' || ch === '\r') {
			row.push(cell)
			rows.push(row)
			row = []
			cell = ''
			i++
			continue
		}
		cell += ch
		i++
	}

	if (cell.length > 0 || row.length > 0) {
		row.push(cell)
		rows.push(row)
	}
	return rows.filter((r) => r.some((c) => c.trim().length > 0))
}

function mapJiraStatusCategory(status: string | undefined): NormalizedImportIssue['statusCategory'] {
	const s = (status ?? '').toLowerCase()
	if (s.includes('done') || s.includes('closed') || s.includes('resolved') || s.includes('complete')) {
		return 'completed'
	}
	if (s.includes('progress') || s.includes('review') || s.includes('qa') || s.includes('testing')) {
		return 'started'
	}
	if (s.includes('won') || s.includes('cancel') || s.includes('reject')) {
		return 'cancelled'
	}
	if (s.includes('backlog')) return 'backlog'
	return 'unstarted'
}

function mapJiraPriority(priority: string | undefined): number {
	const p = (priority ?? '').toLowerCase()
	if (p.includes('highest') || p.includes('blocker') || p.includes('critical')) return 4
	if (p.includes('high')) return 3
	if (p.includes('medium') || p.includes('normal')) return 2
	if (p.includes('low')) return 1
	return 0
}

function parseJiraCommentCell(raw: string): { readonly body: string; readonly authorEmail: string | null } {
	// Jira CSV comments often look like "01/Jan/25 10:00 AM;alice@acme.io;Body text"
	const parts = raw.split(';')
	if (parts.length >= 3 && (parts[1] ?? '').includes('@')) {
		return {
			authorEmail: (parts[1] ?? '').trim().toLowerCase() || null,
			body: parts.slice(2).join(';').trim()
		}
	}
	return { authorEmail: null, body: raw.trim() }
}

function csvToJiraIssues(csv: string): NonNullable<JiraImportPayload['issues']> {
	const rows = parseCsv(csv)
	if (rows.length < 2) return []
	const headers = rows[0]!.map((h) => h.trim().toLowerCase())

	const idxKey = headers.findIndex((h) => h === 'issue key' || h === 'key')
	const idxId = headers.findIndex((h) => h === 'issue id' || h === 'id')
	const idxSummary = headers.findIndex((h) => h === 'summary' || h === 'title')
	const idxDesc = headers.findIndex((h) => h === 'description')
	const idxStatus = headers.findIndex((h) => h === 'status')
	const idxPriority = headers.findIndex((h) => h === 'priority')
	const idxAssignee = headers.findIndex((h) => h === 'assignee' || h === 'assignee email')
	const labelIndices = headers
		.map((h, idx) => (h === 'labels' || h === 'label' ? idx : -1))
		.filter((idx) => idx >= 0)
	const commentIndices = headers
		.map((h, idx) => (h === 'comment' || h === 'comments' ? idx : -1))
		.filter((idx) => idx >= 0)

	if (idxSummary < 0) {
		throw new HttpError(422, 'validation_failed', 'Jira CSV is missing a Summary column')
	}

	const out: NonNullable<JiraImportPayload['issues']> = []
	for (let rIdx = 1; rIdx < rows.length; rIdx++) {
		const r = rows[rIdx]!
		const summary = (r[idxSummary] ?? '').trim()
		if (!summary) continue
		const key = (idxKey >= 0 ? (r[idxKey] ?? '') : '').trim() || `JIRA-${rIdx}`
		const id = (idxId >= 0 ? (r[idxId] ?? '') : '').trim() || key
		const description = idxDesc >= 0 ? (r[idxDesc] ?? '').trim() : ''
		const status = idxStatus >= 0 ? (r[idxStatus] ?? '').trim() : undefined
		const priority = idxPriority >= 0 ? (r[idxPriority] ?? '').trim() : undefined
		const assigneeRaw = idxAssignee >= 0 ? (r[idxAssignee] ?? '').trim() : ''

		const labels = labelIndices
			.flatMap((idx) => (r[idx] ?? '').split(/[\s,;]+/))
			.map((l) => l.trim())
			.filter(Boolean)

		const comments = commentIndices
			.map((idx, cNum) => {
				const raw = (r[idx] ?? '').trim()
				if (!raw) return null
				const parsed = parseJiraCommentCell(raw)
				return {
					id: `${id}:c:${cNum}`,
					body: parsed.body,
					...(parsed.authorEmail ? { authorEmail: parsed.authorEmail } : {})
				}
			})
			.filter((c): c is NonNullable<typeof c> => c !== null)

		out.push({
			id,
			key,
			summary,
			...(description ? { description } : {}),
			...(status ? { status } : {}),
			...(priority ? { priority } : {}),
			...(assigneeRaw.includes('@') ? { assigneeEmail: assigneeRaw } : {}),
			...(labels.length > 0 ? { labels } : {}),
			...(comments.length > 0 ? { comments } : {})
		})
	}
	return out
}

export function normalizeJiraPayload(payload: JiraImportPayload): NormalizedImportDataset {
	const rawIssues =
		payload.issues && payload.issues.length > 0
			? payload.issues
			: payload.csv
				? csvToJiraIssues(payload.csv)
				: []

	const unmapped = new Set<string>()
	const issues: NormalizedImportIssue[] = rawIssues.map((item) => {
		if (item.url) unmapped.add('issue.url -> import_mappings.remote_url')
		const remoteId = (item.id ?? item.key).trim()
		return {
			remoteId,
			remoteIdentifier: item.key.trim(),
			remoteUrl: item.url ?? null,
			title: item.summary.trim(),
			descriptionText: item.description ?? '',
			statusCategory: mapJiraStatusCategory(item.status),
			statusName: item.status ?? null,
			priority: mapJiraPriority(item.priority),
			assigneeEmail: item.assigneeEmail?.toLowerCase() ?? null,
			labels: item.labels ?? [],
			comments: (item.comments ?? []).map((c, idx) => ({
				remoteId: c.id ?? `${remoteId}:c:${idx}`,
				bodyText: c.body,
				authorEmail: c.authorEmail?.toLowerCase() ?? null
			}))
		}
	})

	return {
		source: 'jira',
		projectKey: payload.projectKey,
		projectName: payload.projectName,
		issues,
		unmappedFields: [...unmapped]
	}
}

export async function fetchJiraProjectPayload(args: {
	readonly jiraBaseUrl: string
	readonly jiraEmail: string
	readonly apiToken: string
	readonly jiraProjectKey: string
	readonly fetchImpl?: typeof fetch | undefined
	readonly resolver?: DnsResolver | undefined
}): Promise<JiraImportPayload> {
	const base = args.jiraBaseUrl.replace(/\/+$/, '')
	const url = `${base}/rest/api/3/search?jql=${encodeURIComponent(`project = "${args.jiraProjectKey}"`)}&maxResults=100`
	const basic = Buffer.from(`${args.jiraEmail}:${args.apiToken}`).toString('base64')
	const res = await safeEgressFetch(url, {
		method: 'GET',
		headers: {
			authorization: `Basic ${basic}`,
			accept: 'application/json'
		},
		timeoutMs: 10_000,
		maxBytes: 4 * 1024 * 1024,
		...(args.fetchImpl ? { fetcher: args.fetchImpl } : {}),
		...(args.resolver ? { resolver: args.resolver } : {})
	})
	if (res.status < 200 || res.status >= 300) {
		throw new HttpError(502, 'internal', `Jira API returned HTTP ${res.status}`)
	}

	const json = JSON.parse(new TextDecoder().decode(res.bodyBytes)) as {
		readonly issues?: readonly {
			readonly id?: string
			readonly key?: string
			readonly fields?: {
				readonly summary?: string
				readonly description?: unknown
				readonly status?: { readonly name?: string }
				readonly priority?: { readonly name?: string }
				readonly assignee?: { readonly emailAddress?: string }
				readonly labels?: readonly string[]
			}
		}[]
	}

	const keyUpper =
		args.jiraProjectKey
			.toUpperCase()
			.replace(/[^A-Z0-9]/g, '')
			.slice(0, 10) || 'JIRA'
	const projectKey = /^[A-Z][A-Z0-9]{1,9}$/.test(keyUpper) ? keyUpper : 'JIRA'

	return {
		projectKey,
		projectName: `Jira ${args.jiraProjectKey}`,
		issues: (json.issues ?? []).map((item) => ({
			id: item.id ?? item.key ?? crypto.randomUUID(),
			key: item.key ?? 'JIRA-1',
			summary: item.fields?.summary ?? 'Untitled Jira issue',
			description: typeof item.fields?.description === 'string' ? item.fields.description : '',
			...(item.fields?.status?.name !== undefined ? { status: item.fields.status.name } : {}),
			...(item.fields?.priority?.name !== undefined ? { priority: item.fields.priority.name } : {}),
			...(item.fields?.assignee?.emailAddress !== undefined
				? { assigneeEmail: item.fields.assignee.emailAddress }
				: {}),
			labels: item.fields?.labels ? [...item.fields.labels] : []
		}))
	}
}
