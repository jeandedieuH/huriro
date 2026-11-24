import type { LinearImportPayload } from '@huriro/contracts'
import axios from 'axios'
import { HttpError } from '../../api/error'

export interface NormalizedImportIssue {
	readonly remoteId: string
	readonly remoteIdentifier: string
	readonly remoteUrl: string | null
	readonly title: string
	readonly descriptionText: string
	readonly statusCategory: 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled'
	readonly statusName: string | null
	readonly priority: number
	readonly assigneeEmail: string | null
	readonly labels: readonly string[]
	readonly comments: readonly {
		readonly remoteId: string
		readonly bodyText: string
		readonly authorEmail: string | null
	}[]
}

export interface NormalizedImportDataset {
	readonly source: 'linear' | 'github' | 'jira'
	readonly projectKey: string
	readonly projectName: string
	readonly issues: readonly NormalizedImportIssue[]
	readonly unmappedFields: readonly string[]
}

function mapLinearStateCategory(
	stateType: string | undefined,
	stateName: string | undefined
): NormalizedImportIssue['statusCategory'] {
	const t = (stateType ?? stateName ?? '').toLowerCase()
	if (t.includes('backlog') || t === 'triage') return 'backlog'
	if (t.includes('started') || t.includes('progress') || t.includes('review')) return 'started'
	if (t.includes('completed') || t.includes('done')) return 'completed'
	if (t.includes('cancel')) return 'cancelled'
	return 'unstarted'
}

export function normalizeLinearPayload(payload: LinearImportPayload): NormalizedImportDataset {
	const unmapped = new Set<string>()
	const issues: NormalizedImportIssue[] = payload.issues.map((item) => {
		if (item.url) unmapped.add('issue.url -> import_mappings.remote_url')
		return {
			remoteId: item.id,
			remoteIdentifier: item.identifier,
			remoteUrl: item.url ?? null,
			title: item.title,
			descriptionText: item.description ?? '',
			statusCategory: mapLinearStateCategory(item.stateType, item.stateName),
			statusName: item.stateName ?? null,
			priority: item.priority ?? 0,
			assigneeEmail: item.assigneeEmail?.toLowerCase() ?? null,
			labels: item.labels ?? [],
			comments: (item.comments ?? []).map((c) => ({
				remoteId: c.id,
				bodyText: c.body,
				authorEmail: c.authorEmail?.toLowerCase() ?? null
			}))
		}
	})

	return {
		source: 'linear',
		projectKey: payload.projectKey,
		projectName: payload.projectName,
		issues,
		unmappedFields: [...unmapped]
	}
}

export async function fetchLinearTeamPayload(
	apiToken: string,
	teamKey: string
): Promise<LinearImportPayload> {
	const cleanKey = teamKey.trim().toUpperCase()
	if (!/^[A-Z][A-Z0-9]{1,9}$/.test(cleanKey)) {
		throw new HttpError(422, 'validation_failed', `Invalid Linear team key "${teamKey}"`)
	}
	const query = `
		query ImportTeamIssues($key: String!) {
			teams(filter: { key: { eq: $key } }, first: 1) {
				nodes {
					name
					key
					issues(first: 100) {
						nodes {
							id
							identifier
							title
							description
							priority
							url
							state { name type }
							assignee { email }
							labels { nodes { name } }
							comments { nodes { id body user { email } } }
						}
					}
				}
			}
		}
	`
	const res = await axios.post(
		'https://api.linear.app/graphql',
		{ query, variables: { key: cleanKey } },
		{
			headers: { authorization: apiToken },
			validateStatus: () => true
		}
	)
	if (res.status >= 300) {
		throw new HttpError(502, 'internal', `Linear API responded with ${res.status}`)
	}
	const json = res.data as {
		data?: {
			teams?: {
				nodes?: {
					name: string
					key: string
					issues: {
						nodes: {
							id: string
							identifier: string
							title: string
							description?: string | null
							priority?: number | null
							url?: string | null
							state?: { name?: string; type?: string } | null
							assignee?: { email?: string | null } | null
							labels?: { nodes?: { name: string }[] } | null
							comments?: { nodes?: { id: string; body: string; user?: { email?: string | null } | null }[] }
						}[]
					}
				}[]
			}
		}
	}
	const team = json.data?.teams?.nodes?.[0]
	if (!team) {
		throw new HttpError(404, 'not_found', `Linear team "${cleanKey}" not found`)
	}

	return {
		projectKey: team.key,
		projectName: team.name,
		issues: team.issues.nodes.map((i) => ({
			id: i.id,
			identifier: i.identifier,
			title: i.title,
			description: i.description ?? '',
			priority: Math.min(4, Math.max(0, i.priority ?? 0)),
			...(i.url ? { url: i.url } : {}),
			...(i.state?.name ? { stateName: i.state.name } : {}),
			...(i.state?.type ? { stateType: i.state.type } : {}),
			...(i.assignee?.email ? { assigneeEmail: i.assignee.email } : {}),
			labels: i.labels?.nodes?.map((l) => l.name) ?? [],
			comments: (i.comments?.nodes ?? []).map((c) => ({
				id: c.id,
				body: c.body,
				...(c.user?.email ? { authorEmail: c.user.email } : {})
			}))
		}))
	}
}
