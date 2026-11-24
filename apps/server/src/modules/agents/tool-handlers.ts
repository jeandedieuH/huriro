/**
 * Tool handlers — the ONLY binding between registry specs and module services.
 * Bound by tool name at boot; every call runs with the agent's ActorContext
 * inside a tenant tx (§13.1a: handlers call services, never repos).
 */
import type { ToolSpec } from '@huriro/agent-tools'
import { TOOLS } from '@huriro/agent-tools'
import type {
	ApprovalsStatusInput,
	ChatReadThreadInput,
	DocsAppendInput,
	DocsCreateInput,
	DocsGetInput,
	DocsSearchInput,
	SearchUnifiedInput,
	TasksBulkUpdateInput,
	TasksCommentInput,
	TasksCreateInput,
	TasksGetInput,
	TasksMyQueueInput,
	TasksReportStatusInput,
	TasksSearchInput,
	TasksUpdateInput
} from '@huriro/contracts'
import { decodeCursor, encodeCursor } from '@huriro/contracts'
import type { Queryable } from '@huriro/db'
import { HttpError } from '../../api/error'
import { listThread } from '../chat'
import {
	appendToDocPage,
	createDocPage,
	exportDocPageMarkdown,
	getDocPageBySlugDetail,
	getDocPageDetail
} from '../docs'
import { searchWorkspace } from '../search'
import {
	createIssue,
	createIssueComment,
	getIssueByIdentifier,
	getIssueDetail,
	listAccessibleProjects,
	listIssues,
	listProjectStatuses,
	updateIssue
} from '../tasks'
import { listWorkspaceMembers } from '../tenancy'
import {
	renderChatThread,
	renderDocument,
	renderIssue,
	renderIssueList,
	renderSearchHits,
	untrustedBlock
} from './markdown'
import type { ResolvedAgent } from './principal'
import { getApproval } from './repo'

export interface ToolCallResult {
	readonly data: unknown
	readonly markdown: string
	readonly nextCursor?: string | null
	/** For undoable writes — the agent_undo_log id. */
	readonly undo?: {
		readonly entityType: string
		readonly entityId: string
		readonly before?: unknown
	}
}

export type ToolHandler = (
	tx: Queryable,
	resolved: ResolvedAgent,
	input: unknown,
	deps: ToolDeps
) => Promise<ToolCallResult>

export interface ToolDeps {
	readonly hasCollabBridge: boolean
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Drop `undefined`-valued keys — service seams declare exactOptional params
 * (`foo?: string` does NOT accept explicit undefined), so tool inputs are
 * normalized before crossing the seam.
 */
function omitUndefined<T extends Record<string, unknown>>(
	obj: T
): { [K in keyof T]: Exclude<T[K], undefined> } {
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v
	return out as { [K in keyof T]: Exclude<T[K], undefined> }
}

/** UUID or ENG-142 → IssueDto. */
async function resolveIssue(tx: Queryable, resolved: ResolvedAgent, ref: string) {
	if (UUID_RE.test(ref)) {
		const detail = await getIssueDetail(tx, resolved.actor, ref)
		return detail.issue
	}
	return getIssueByIdentifier(tx, resolved.actor, ref)
}

function issueSummary(i: {
	id: string
	identifier: string
	title: string
	statusName?: string | null
	projectId: string
	assigneeId: string | null
}) {
	return {
		id: i.id,
		identifier: i.identifier,
		title: i.title,
		statusName: i.statusName ?? null,
		projectId: i.projectId,
		assigneeId: i.assigneeId,
		url: `/issues/${i.identifier}`
	}
}

const HANDLERS: Record<string, ToolHandler> = {
	'workspace.describe': async (tx, resolved) => {
		const projects = await listAccessibleProjects(tx, resolved.actor)
		const canReadMembers = resolved.effectiveScopes.includes('members.read')
		const members = canReadMembers ? await listWorkspaceMembers(tx, resolved.actor.workspaceId) : undefined
		const data = {
			workspaceId: resolved.actor.workspaceId,
			agent: {
				principalId: resolved.principal.id,
				name: resolved.principal.name,
				kind: resolved.principal.kind,
				scopeCeiling: resolved.principal.scopeCeiling,
				effectiveScopes: resolved.effectiveScopes
			},
			projects: projects.map((p) => ({ id: p.id, name: p.name, key: p.key ?? null })),
			...(members
				? {
						members: members.map((m) => ({
							userId: m.userId,
							displayName: m.displayName ?? null,
							role: m.roleKey ?? null
						}))
					}
				: {})
		}
		const md =
			`# Workspace\n\nAgent: **${resolved.principal.name}** (${resolved.principal.kind})\n` +
			`Scopes: ${resolved.effectiveScopes.join(', ') || '(none)'}\n\n` +
			`## Projects\n\n${projects.map((p) => `- ${p.name}${p.key ? ` (${p.key})` : ''}`).join('\n') || '_none_'}\n`
		return { data, markdown: md }
	},

	'tasks.search': async (tx, resolved, raw) => {
		const input = raw as TasksSearchInput
		const res = await listIssues(
			tx,
			resolved.actor,
			omitUndefined({
				q: input.query,
				projectId: input.projectId,
				assigneeId: input.assigneeId,
				statusId: input.statusId,
				limit: input.limit,
				cursor: input.cursor
			})
		)
		const data = {
			data: res.data.map(issueSummary),
			nextCursor: res.nextCursor,
			hasMore: res.hasMore
		}
		return { data, markdown: renderIssueList(res.data), nextCursor: res.nextCursor }
	},

	'tasks.get': async (tx, resolved, raw) => {
		const input = raw as TasksGetInput
		const issue = await resolveIssue(tx, resolved, input.issue)
		const detail = await getIssueDetail(tx, resolved.actor, issue.id)
		const data = {
			issue: { ...issueSummary(issue), description: issue.descriptionText ?? null },
			comments: detail.comments
		}
		return { data, markdown: renderIssue(issue) }
	},

	'tasks.my_queue': async (tx, resolved, raw) => {
		const input = raw as TasksMyQueueInput
		const res = await listIssues(
			tx,
			resolved.actor,
			omitUndefined({
				assigneeId: resolved.principal.id,
				projectId: input.projectId,
				limit: input.limit,
				cursor: input.cursor
			})
		)
		// Exclude done issues — statuses in completed/cancelled categories.
		const doneStatusIds = new Set<string>()
		for (const p of await listAccessibleProjects(tx, resolved.actor)) {
			for (const s of await listProjectStatuses(tx, resolved.actor, p.id)) {
				if (s.category === 'completed' || s.category === 'cancelled') doneStatusIds.add(s.id)
			}
		}
		const items = res.data.filter((i) => !doneStatusIds.has(i.statusId))
		const data = { data: items.map(issueSummary), nextCursor: res.nextCursor, hasMore: res.hasMore }
		return { data, markdown: renderIssueList(items), nextCursor: res.nextCursor }
	},

	'tasks.create': async (tx, resolved, raw) => {
		const input = raw as TasksCreateInput
		const { data: issue } = await createIssue(
			tx,
			resolved.actor,
			omitUndefined({
				projectId: input.projectId,
				title: input.title,
				descriptionText: input.description,
				statusId: input.statusId,
				priority: input.priority,
				assigneeId: input.assigneeId,
				assigneeType: input.assigneeType ?? null,
				labelIds: input.labelIds,
				parentId: input.parentId ?? null
			})
		)
		return {
			data: { issue: issueSummary(issue) },
			markdown: renderIssue(issue),
			undo: { entityType: 'issue', entityId: issue.id }
		}
	},

	'tasks.update': async (tx, resolved, raw) => {
		const input = raw as TasksUpdateInput
		const before = await resolveIssue(tx, resolved, input.issue)
		const patch = omitUndefined({
			title: input.title,
			descriptionText: input.description,
			statusId: input.statusId,
			priority: input.priority,
			assigneeId: input.assigneeId,
			assigneeType: input.assigneeType ?? undefined,
			version: before.version
		})
		const { data: issue } = await updateIssue(tx, resolved.actor, before.id, patch)
		return {
			data: { issue: issueSummary(issue) },
			markdown: renderIssue(issue),
			undo: {
				entityType: 'issue',
				entityId: issue.id,
				before: {
					title: before.title,
					descriptionText: before.descriptionText,
					statusId: before.statusId,
					priority: before.priority,
					assigneeId: before.assigneeId,
					assigneeType: before.assigneeType,
					version: before.version
				}
			}
		}
	},

	'tasks.comment': async (tx, resolved, raw) => {
		const input = raw as TasksCommentInput
		const issue = await resolveIssue(tx, resolved, input.issue)
		const { data: comment } = await createIssueComment(tx, resolved.actor, issue.id, {
			bodyText: input.body
		})
		return {
			data: { commentId: comment.id },
			markdown: `Comment posted on ${issue.identifier ?? issue.id}.\n\n${untrustedBlock(input.body)}\n`,
			undo: { entityType: 'issue_comment', entityId: comment.id, before: { issueId: issue.id } }
		}
	},

	'tasks.report_status': async (tx, resolved, raw, _deps) => {
		const input = raw as TasksReportStatusInput
		const issue = await resolveIssue(tx, resolved, input.issue)
		// Report rows land in the issue timeline; done/failed also close the issue.
		const { insertStatusReport } = await import('./repo')
		const reportId = await insertStatusReport(tx, {
			workspaceId: resolved.actor.workspaceId,
			issueId: issue.id,
			agentId: resolved.principal.id,
			state: input.state,
			message: input.message,
			links: input.links ?? []
		})
		if (input.state === 'done' || input.state === 'failed') {
			// Close out the issue so it drains from the agent's queue: done → the
			// project's first completed-category status, failed → cancelled.
			const want = input.state === 'done' ? 'completed' : 'cancelled'
			const statuses = await listProjectStatuses(tx, resolved.actor, issue.projectId)
			const target =
				statuses.find((s) => s.category === want) ?? statuses.find((s) => s.category === 'completed')
			if (target && target.id !== issue.statusId) {
				await updateIssue(tx, resolved.actor, issue.id, { statusId: target.id, version: issue.version })
			}
		}
		return {
			data: { reportId },
			markdown: `Status **${input.state}** reported on ${issue.identifier ?? issue.id}.\n\n${untrustedBlock(input.message)}\n`
		}
	},

	'tasks.bulk_update': async (tx, resolved, raw) => {
		const input = raw as TasksBulkUpdateInput
		const updated: string[] = []
		for (const ref of input.issues) {
			const issue = await resolveIssue(tx, resolved, ref)
			const { data } = await updateIssue(
				tx,
				resolved.actor,
				issue.id,
				omitUndefined({
					statusId: input.statusId,
					priority: input.priority,
					assigneeId: input.assigneeId,
					assigneeType: input.assigneeType ?? undefined,
					version: issue.version
				})
			)
			updated.push(data.id)
		}
		return {
			data: { updated: updated.length, issueIds: updated },
			markdown: `Updated ${updated.length} issue(s).\n`
		}
	},

	'docs.search': async (tx, resolved, raw) => {
		const input = raw as DocsSearchInput
		// doc search reuses the workspace search seam filtered to doc hits
		const res = await searchWorkspace(tx, resolved.actor, input.query, input.limit ?? 50)
		const hits = res.hits.filter((h) => h.entityType === 'doc_page')
		const mapped = hits.map((h) => ({
			type: h.entityType,
			id: h.entityId,
			title: h.title,
			snippet: h.snippet,
			url: h.deepLink
		}))
		const data = { data: mapped, nextCursor: null, hasMore: false }
		return { data, markdown: renderSearchHits(mapped, input.query) }
	},

	'docs.get': async (tx, resolved, raw) => {
		const input = raw as DocsGetInput
		const detail = UUID_RE.test(input.page)
			? await getDocPageDetail(tx, resolved.actor, input.page)
			: await getDocPageBySlugDetail(tx, resolved.actor, input.page)
		const markdownOut = await exportDocPageMarkdown(tx, resolved.actor, detail.page.id)
		return {
			data: { pageId: detail.page.id, title: detail.page.title, slug: detail.page.slug },
			markdown: renderDocument({
				id: detail.page.id,
				title: detail.page.title,
				slug: detail.page.slug,
				markdown: markdownOut.markdown
			})
		}
	},

	'docs.append': async (tx, resolved, raw, deps) => {
		const input = raw as DocsAppendInput
		const detail = UUID_RE.test(input.page)
			? await getDocPageDetail(tx, resolved.actor, input.page)
			: await getDocPageBySlugDetail(tx, resolved.actor, input.page)
		// Pre-write checkpoint so undo = restore this named version if no later edits.
		const { createNamedDocVersion } = await import('../docs')
		const checkpoint = await createNamedDocVersion(
			tx,
			resolved.actor,
			detail.page.id,
			'agent undo checkpoint'
		)
		await appendToDocPage(
			tx,
			resolved.actor,
			detail.page.id,
			{ markdown: input.markdown, origin: `agent:${resolved.principal.name}` },
			deps.hasCollabBridge
		)
		return {
			data: { pageId: detail.page.id, title: detail.page.title, slug: detail.page.slug },
			markdown: `Appended to **${detail.page.title}**.\n`,
			undo: { entityType: 'doc_page', entityId: detail.page.id, before: { versionId: checkpoint.data.id } }
		}
	},

	'docs.create': async (tx, resolved, raw) => {
		const input = raw as DocsCreateInput
		const { data: page } = await createDocPage(
			tx,
			resolved.actor,
			omitUndefined({
				title: input.title,
				parentId: input.parentId ?? null,
				markdown: input.markdown
			})
		)
		return {
			data: { pageId: page.id, title: page.title, slug: page.slug },
			markdown: `Created **${page.title}** (${page.slug}).\n`,
			undo: { entityType: 'doc_page', entityId: page.id }
		}
	},

	'chat.read_thread': async (tx, resolved, raw) => {
		const input = raw as ChatReadThreadInput
		const { parent, replies } = await listThread(tx, resolved.actor, input.parentMessageId)
		const data = { parent, replies }
		return { data, markdown: renderChatThread(parent, replies) }
	},

	'search.unified': async (tx, resolved, raw) => {
		const input = raw as SearchUnifiedInput
		const res = await searchWorkspace(tx, resolved.actor, input.query, input.limit ?? 20)
		const mapped = res.hits.map((h) => ({
			type: h.entityType,
			id: h.entityId,
			title: h.title,
			snippet: h.snippet,
			url: h.deepLink
		}))
		const data = { data: mapped, nextCursor: null, hasMore: false }
		return { data, markdown: renderSearchHits(mapped, input.query) }
	},

	'approvals.status': async (tx, resolved, raw) => {
		const input = raw as ApprovalsStatusInput
		const approval = await getApproval(tx, resolved.actor.workspaceId, input.approvalId)
		if (!approval || approval.agentId !== resolved.principal.id) {
			throw new HttpError(404, 'not_found', 'Approval not found')
		}
		const data = {
			approvalId: approval.id,
			status: approval.status,
			expiresAt: approval.expiresAt.toISOString()
		}
		return { data, markdown: `Approval ${approval.id}: **${approval.status}**\n` }
	}
}

/** Boot-time 1:1 assertion — every registry tool has exactly one handler. */
export function assertRegistryCoverage(): void {
	const missing = [...TOOLS.keys()].filter((n) => !HANDLERS[n])
	const extra = Object.keys(HANDLERS).filter((n) => !TOOLS.has(n))
	if (missing.length > 0 || extra.length > 0) {
		throw new Error(
			`agent-tools registry/handler mismatch — missing handlers: [${missing.join(', ')}]; ` +
				`handlers without specs: [${extra.join(', ')}]`
		)
	}
}

export function getToolHandler(tool: ToolSpec): ToolHandler {
	const h = HANDLERS[tool.name]
	if (!h) throw new HttpError(404, 'tool_unknown', `No handler bound for tool ${tool.name}`)
	return h
}

// decodeCursor re-export keeps pagination deps in one place for handlers.
export { decodeCursor, encodeCursor }
