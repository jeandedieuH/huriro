import type { GithubImportPayload } from '@huriro/contracts'
import axios from 'axios'
import { HttpError } from '../../api/error'
import type { NormalizedImportDataset, NormalizedImportIssue } from './linear'

export function normalizeGithubPayload(payload: GithubImportPayload): NormalizedImportDataset {
	const unmapped = new Set<string>()
	const issues: NormalizedImportIssue[] = payload.issues.map((item) => {
		if (item.assigneeLogin && !item.assigneeEmail) {
			unmapped.add(`github assignee login @${item.assigneeLogin} (no email)`)
		}
		return {
			remoteId: String(item.id),
			remoteIdentifier: `${payload.repo}#${item.number}`,
			remoteUrl: item.htmlUrl ?? null,
			title: item.title,
			descriptionText: item.body ?? '',
			statusCategory: item.state === 'closed' ? 'completed' : 'unstarted',
			statusName: item.state === 'closed' ? 'Done' : 'Todo',
			priority: 0,
			assigneeEmail: item.assigneeEmail?.toLowerCase() ?? null,
			labels: item.labels ?? [],
			comments: (item.comments ?? []).map((c) => ({
				remoteId: String(c.id),
				bodyText: c.body,
				authorEmail: c.authorEmail?.toLowerCase() ?? null
			}))
		}
	})

	return {
		source: 'github',
		projectKey: payload.projectKey,
		projectName: payload.projectName,
		issues,
		unmappedFields: [...unmapped]
	}
}

function deriveProjectKeyFromRepo(repo: string): string {
	const name = repo.split('/').pop() ?? repo
	const clean = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
	const base = /^[A-Z]/.test(clean) ? clean : `GH${clean}`
	return base.slice(0, 8).padEnd(2, 'X')
}

export async function fetchGithubRepoPayload(apiToken: string, repo: string): Promise<GithubImportPayload> {
	const cleanRepo = repo.trim()
	if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(cleanRepo)) {
		throw new HttpError(422, 'validation_failed', `Invalid GitHub repo "${repo}" (expected owner/name)`)
	}
	const headers = {
		accept: 'application/vnd.github+json',
		authorization: `Bearer ${apiToken}`,
		'user-agent': 'huriro-importer'
	}
	const res = await axios.get(`https://api.github.com/repos/${cleanRepo}/issues?state=all&per_page=100`, {
		headers,
		validateStatus: () => true
	})
	if (res.status >= 300) {
		throw new HttpError(502, 'internal', `GitHub API responded with ${res.status}`)
	}
	const rawIssues = res.data as {
		id: number
		number: number
		title: string
		body: string | null
		state: 'open' | 'closed'
		html_url?: string
		pull_request?: unknown
		assignee?: { login?: string } | null
		labels?: { name?: string }[]
	}[]

	const filtered = rawIssues.filter((i) => !i.pull_request)
	return {
		repo: cleanRepo,
		projectKey: deriveProjectKeyFromRepo(cleanRepo),
		projectName: cleanRepo,
		issues: filtered.map((i) => ({
			id: i.id,
			number: i.number,
			title: i.title,
			body: i.body,
			state: i.state,
			...(i.html_url ? { htmlUrl: i.html_url } : {}),
			...(i.assignee?.login ? { assigneeLogin: i.assignee.login } : {}),
			labels: (i.labels ?? []).map((l) => l.name ?? '').filter(Boolean),
			comments: []
		}))
	}
}
