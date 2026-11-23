/**
 * Rate-limit-aware GitHub REST v3 client gated through `safeEgressFetch` (§12.6, §16.6).
 * Injectable via `GithubApiClient` in unit/integration tests.
 */
import { type DnsResolver, safeEgressFetch } from '../../api/egress'

export interface GithubApiClient {
	updateIssue(args: {
		readonly repoFullName: string
		readonly issueNumber: number
		readonly title?: string | undefined
		readonly body?: string | undefined
		readonly state?: 'open' | 'closed' | undefined
		readonly accessToken?: string | null | undefined
	}): Promise<{ readonly number: number; readonly htmlUrl: string }>
	createComment(args: {
		readonly repoFullName: string
		readonly issueNumber: number
		readonly body: string
		readonly accessToken?: string | null | undefined
	}): Promise<{ readonly id: number; readonly htmlUrl: string }>
}

export class GithubSyncError extends Error {
	readonly statusCode: number
	readonly retryable: boolean

	constructor(message: string, statusCode: number, retryable: boolean) {
		super(message)
		this.name = 'GithubSyncError'
		this.statusCode = statusCode
		this.retryable = retryable
	}
}

function buildGithubHeaders(accessToken?: string | null): Record<string, string> {
	return {
		accept: 'application/vnd.github+json',
		'content-type': 'application/json',
		'x-github-api-version': '2022-11-28',
		...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
	}
}

function checkRateLimitAndStatus(status: number, headers: Headers): void {
	if (status >= 200 && status < 300) return
	const remaining = headers.get('x-ratelimit-remaining')
	const retryAfter = headers.get('retry-after')
	if (status === 429 || (status === 403 && remaining === '0') || retryAfter) {
		throw new GithubSyncError(
			`GitHub API rate limit reached (HTTP ${status}${retryAfter ? `, retry after ${retryAfter}s` : ''})`,
			status,
			true
		)
	}
	throw new GithubSyncError(`GitHub API error (HTTP ${status})`, status, status >= 500)
}

export function createDefaultGithubClient(opts?: {
	readonly fetchImpl?: typeof fetch | undefined
	readonly resolver?: DnsResolver | undefined
}): GithubApiClient {
	return {
		async updateIssue(args) {
			const url = `https://api.github.com/repos/${args.repoFullName}/issues/${args.issueNumber}`
			const payload: Record<string, unknown> = {}
			if (args.title !== undefined) payload['title'] = args.title
			if (args.body !== undefined) payload['body'] = args.body
			if (args.state !== undefined) payload['state'] = args.state

			const res = await safeEgressFetch(url, {
				method: 'PATCH',
				headers: buildGithubHeaders(args.accessToken),
				body: JSON.stringify(payload),
				timeoutMs: 10_000,
				maxBytes: 256_000,
				...(opts?.fetchImpl ? { fetcher: opts.fetchImpl } : {}),
				...(opts?.resolver ? { resolver: opts.resolver } : {})
			})
			checkRateLimitAndStatus(res.status, res.headers)
			const data = JSON.parse(new TextDecoder().decode(res.bodyBytes)) as {
				readonly number?: number
				readonly html_url?: string
			}
			return {
				number: data.number ?? args.issueNumber,
				htmlUrl: data.html_url ?? `https://github.com/${args.repoFullName}/issues/${args.issueNumber}`
			}
		},

		async createComment(args) {
			const url = `https://api.github.com/repos/${args.repoFullName}/issues/${args.issueNumber}/comments`
			const res = await safeEgressFetch(url, {
				method: 'POST',
				headers: buildGithubHeaders(args.accessToken),
				body: JSON.stringify({ body: args.body }),
				timeoutMs: 10_000,
				maxBytes: 256_000,
				...(opts?.fetchImpl ? { fetcher: opts.fetchImpl } : {}),
				...(opts?.resolver ? { resolver: opts.resolver } : {})
			})
			checkRateLimitAndStatus(res.status, res.headers)
			const data = JSON.parse(new TextDecoder().decode(res.bodyBytes)) as {
				readonly id?: number
				readonly html_url?: string
			}
			return {
				id: data.id ?? 0,
				htmlUrl: data.html_url ?? `https://github.com/${args.repoFullName}/issues/${args.issueNumber}`
			}
		}
	}
}
