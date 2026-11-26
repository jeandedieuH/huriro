// Hand-written alias map: ergonomic commands → registry tool + input build.
// Generated commands stay generic (`tool <name> --input …`); these are the
// curated core-loop shortcuts on top (§13.1a).
export interface Alias {
	readonly usage: string
	readonly tool: string
	readonly build: (pos: string[], flags: Record<string, string | boolean>) => Record<string, unknown>
	readonly mdSupported?: boolean
}

const id = (pos: string[], flags: Record<string, string | boolean>) =>
	String(flags['id'] ?? flags['issue'] ?? pos[0] ?? '')

export const ALIASES: Record<string, Alias> = {
	queue: {
		usage: 'huriro queue [--json|--md]',
		tool: 'tasks.my_queue',
		build: () => ({})
	},
	'issue view': {
		usage: 'huriro issue view <identifier|id> [--md|--json]',
		tool: 'tasks.get',
		build: (pos, f) => ({ issue: id(pos, f) }),
		mdSupported: true
	},
	'issue list': {
		usage: 'huriro issue list [--query q] [--status-id s] [--assignee u] [--project p] [--limit n]',
		tool: 'tasks.search',
		build: (_p, f) =>
			stripUndef({
				query: f['query'],
				statusId: f['status-id'] ?? f['status'],
				assigneeId: f['assignee'],
				projectId: f['project'],
				limit: num(f['limit'])
			})
	},
	'issue search': {
		usage: 'huriro issue search <query>',
		tool: 'tasks.search',
		build: (pos, f) => ({ query: String(f['query'] ?? pos[0] ?? ''), limit: num(f['limit']) })
	},
	'issue create': {
		usage: 'huriro issue create --title T [--body B] [--project p] [--priority n]',
		tool: 'tasks.create',
		build: (_p, f) =>
			stripUndef({
				title: f['title'],
				description: f['body'],
				projectId: f['project'],
				priority: num(f['priority'])
			})
	},
	'issue update': {
		usage: 'huriro issue update <id> [--status-id s] [--title t] [--body b] [--priority n]',
		tool: 'tasks.update',
		build: (pos, f) =>
			stripUndef({
				issue: id(pos, f),
				statusId: f['status-id'] ?? f['status'],
				title: f['title'],
				description: f['body'],
				priority: num(f['priority'])
			})
	},
	'issue comment': {
		usage: 'huriro issue comment <id> -m "text"',
		tool: 'tasks.comment',
		build: (pos, f) => ({ issue: id(pos, f), body: f['m'] ?? f['message'] ?? '' })
	},
	'issue status': {
		usage: 'huriro issue status <id> --state working|needs_input|done|failed -m "..." [--link URL]',
		tool: 'tasks.report_status',
		build: (pos, f) =>
			stripUndef({
				issue: id(pos, f),
				state: f['state'],
				message: f['m'] ?? f['message'],
				links: f['link'] ? [String(f['link'])] : undefined
			})
	},
	'doc get': {
		usage: 'huriro doc get <id|slug> [--md|--json]',
		tool: 'docs.get',
		build: (pos, f) => ({ page: String(f['doc'] ?? pos[0] ?? '') }),
		mdSupported: true
	},
	'doc search': {
		usage: 'huriro doc search <query>',
		tool: 'docs.search',
		build: (pos, f) => ({ query: String(f['query'] ?? pos[0] ?? ''), limit: num(f['limit']) })
	},
	'doc create': {
		usage: 'huriro doc create --title T [--content C]',
		tool: 'docs.create',
		build: (_p, f) => stripUndef({ title: f['title'], markdown: f['content'] })
	},
	'doc append': {
		usage: 'huriro doc append <id> --content C',
		tool: 'docs.append',
		build: (pos, f) => ({ page: String(f['doc'] ?? pos[0] ?? ''), markdown: f['content'] ?? '' })
	},
	search: {
		usage: 'huriro search <query>',
		tool: 'search.unified',
		build: (pos, f) => ({ query: String(f['query'] ?? pos[0] ?? ''), limit: num(f['limit']) })
	},
	'workspace describe': {
		usage: 'huriro workspace describe',
		tool: 'workspace.describe',
		build: () => ({})
	},
	'approvals status': {
		usage: 'huriro approvals status <approvalId>',
		tool: 'approvals.status',
		build: (pos) => ({ approvalId: pos[0] ?? '' })
	},
	availability: {
		usage: 'huriro availability [--state s] [--user id] [--json|--md]',
		tool: 'availability.list',
		build: (_p, f) =>
			stripUndef({
				state: f['state'],
				userIds: f['user'] ? [String(f['user'])] : undefined
			})
	},
	'availability get': {
		usage: 'huriro availability get <userId>',
		tool: 'availability.get',
		build: (pos) => ({ userId: pos[0] ?? '' })
	},
	'status set': {
		usage:
			'huriro status set [-m text] [--emoji e] [--state auto|available|busy|dnd|away|ooo] [--dnd-until ISO] [--expires ISO]',
		tool: 'availability.set_my_status',
		build: (_p, f) =>
			stripUndef({
				statusText: f['m'] ?? f['message'],
				statusEmoji: f['emoji'],
				manualState: f['state'],
				dndUntil: f['dnd-until'],
				statusExpiresAt: f['expires']
			})
	}
}

function num(v: string | boolean | undefined): number | undefined {
	return typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined
}

function stripUndef(o: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
}
