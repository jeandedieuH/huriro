/**
 * Tasks controller & cross-module seam (§5.4, §7.2).
 *
 * An Elysia instance is the controller: `.use(workspaceRequest(...))` resolves
 * session + workspace + tenant tx + actor once per request; handlers stay thin
 * and pass plain values to service.ts.
 */
import type { Queryable, Sql } from '@huriro/db'
import { Elysia } from 'elysia'
import { withIdempotency } from '../../api/context'
import { HttpError } from '../../api/error'
import { markdownResponse, renderIssue, splitMdParam } from '../../api/markdown'
import type { RealtimePubSub } from '../../realtime/pubsub'
import type { Auth } from '../identity'
import { workspaceDerive } from '../tenancy'
import {
	BulkIssuesBody,
	BulkRestoreBody,
	CommentPatchParam,
	CreateCycleBody,
	CreateInitiativeBody,
	CreateIssueBody,
	CreateIssueCommentBody,
	CreateIssueRelationBody,
	CreateLabelBody,
	CreateProjectBody,
	CreateProjectMilestoneBody,
	CreateProjectUpdateBody,
	CreateSavedViewBody,
	CreateStatusBody,
	CycleIdParam,
	IdParam,
	InitiativeIdParam,
	IssueGetParam,
	IssueIdParam,
	IssueKeyParam,
	ListCyclesQuery,
	ListIssuesQuery,
	MilestoneParam,
	MoveIssueBody,
	ProjectIdParam,
	QueryIssuesBody,
	RelationDeleteParam,
	SetIssueLabelsBody,
	TriageActionBody,
	TriageQueueQuery,
	UpdateCycleBody,
	UpdateInitiativeBody,
	UpdateIssueBody,
	UpdateIssueCommentBody,
	UpdateLabelBody,
	UpdateProjectBody,
	UpdateProjectMilestoneBody,
	UpdateSavedViewBody,
	UpdateStatusBody
} from './schema'
import {
	createCycle,
	createIssue,
	createIssueComment,
	createIssueRelation,
	createLabel,
	createProject,
	createProjectStatus,
	createSavedView,
	deleteIssue,
	deleteIssueComment,
	deleteIssueRelation,
	deleteSavedView,
	ensureLabelForImport,
	ensureProjectForImport,
	getIssueByIdentifier,
	getIssueByIdForRedirect,
	getIssueDetail,
	getIssueHistoryPage,
	getTasksSnapshotData,
	listAccessibleProjectIds,
	listAccessibleProjects,
	listCycleSnapshots,
	listCycles,
	listIssues,
	listProjectStatuses,
	listSavedViews,
	listWorkspaceLabels,
	moveIssue,
	requireIssueAccess,
	setIssueLabels,
	updateCycle,
	updateIssue,
	updateIssueComment,
	updateLabel,
	updateProject,
	updateProjectStatus,
	updateSavedView
} from './service'
import { bulkRestoreIssues, bulkUpdateIssues } from './service-bulk'
import { createInitiative, deleteInitiative, listInitiatives, updateInitiative } from './service-initiatives'
import {
	createProjectMilestone,
	deleteProjectMilestone,
	listProjectMilestones,
	updateProjectMilestone
} from './service-milestones'
import { createProjectUpdate, listProjectUpdates } from './service-project-updates'
import { queryIssues } from './service-query'
import { getTriageSuggestions, listTriageQueue, runTriageWakeOnce, triageIssue } from './service-triage'

export { runCycleMaintenanceOnce } from './cycle-maintenance'
export { TASKS_EVENTS } from './events'
export {
	bulkRestoreIssues,
	bulkUpdateIssues,
	createInitiative,
	createIssue,
	createIssueComment,
	createProject,
	createProjectMilestone,
	createProjectUpdate,
	createSavedView,
	deleteInitiative,
	deleteIssue,
	deleteIssueComment,
	deleteProjectMilestone,
	ensureLabelForImport,
	ensureProjectForImport,
	getIssueByIdentifier,
	getIssueByIdForRedirect,
	getIssueDetail,
	getIssueHistoryPage,
	getTasksSnapshotData,
	getTriageSuggestions,
	listAccessibleProjectIds,
	listAccessibleProjects,
	listCycleSnapshots,
	listIssues,
	listProjectStatuses,
	listTriageQueue,
	moveIssue,
	queryIssues,
	requireIssueAccess,
	runTriageWakeOnce,
	triageIssue,
	updateInitiative,
	updateIssue,
	updateIssueComment,
	updateProject,
	updateProjectMilestone,
	updateSavedView
}

async function resolveRedirectFromImportMapping(
	tx: Queryable,
	workspaceId: string,
	identifier: string
): Promise<{ localId: string; localType: string } | null> {
	const [row] = await tx<{ localId: string; localType: string }[]>`
		SELECT local_id AS "localId", local_type AS "localType"
		FROM import_mappings
		WHERE workspace_id = ${workspaceId}
			AND upper(remote_identifier) = upper(${identifier})
		ORDER BY created_at DESC
		LIMIT 1
	`
	return row ?? null
}

export function tasksModule(sql: Sql, auth: Auth | null, pubsub?: RealtimePubSub) {
	return (
		new Elysia({ name: 'huriro.tasks' })
			.derive(workspaceDerive(sql, auth))
			// ---- Projects ----
			.get('/projects', ({ inWorkspace }) =>
				inWorkspace(async (tx, actor) => ({ data: await listAccessibleProjects(tx, actor) }))
			)
			.post(
				'/projects',
				{ body: CreateProjectBody },
				async ({ body, headers, workspaceCtx, inWorkspace, set }) => {
					const res = await inWorkspace((tx, actor) =>
						withIdempotency(tx, {
							workspaceId: workspaceCtx.workspaceId,
							key: headers['idempotency-key'],
							endpoint: 'POST /api/v1/projects',
							requestBody: body,
							successStatus: 201,
							execute: () => createProject(tx, actor, body)
						})
					)
					set.status = res.status
					if (!res.replayed && pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, res.body.cursor)
					return res.body.data
				}
			)
			.patch(
				'/projects/:id',
				{ params: IdParam, body: UpdateProjectBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) => updateProject(tx, actor, params.id, body))
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			.get(
				'/projects/:id/triage',
				{ params: IdParam, query: TriageQueueQuery },
				({ params, query, inWorkspace }) =>
					inWorkspace(async (tx, actor) => ({
						data: await listTriageQueue(tx, actor, params.id, query.state ?? 'pending')
					}))
			)
			// ---- M8 planning: initiatives, milestones & project updates ----
			.get('/initiatives', ({ inWorkspace }) =>
				inWorkspace(async (tx, actor) => ({ data: await listInitiatives(tx, actor) }))
			)
			.post(
				'/initiatives',
				{ body: CreateInitiativeBody },
				async ({ body, workspaceCtx, inWorkspace, set }) => {
					const result = await inWorkspace((tx, actor) => createInitiative(tx, actor, body))
					set.status = 201
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			.patch(
				'/initiatives/:initiativeId',
				{ params: InitiativeIdParam, body: UpdateInitiativeBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) =>
						updateInitiative(tx, actor, params.initiativeId, body)
					)
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			.delete(
				'/initiatives/:initiativeId',
				{ params: InitiativeIdParam },
				async ({ params, workspaceCtx, inWorkspace, set }) => {
					const result = await inWorkspace((tx, actor) => deleteInitiative(tx, actor, params.initiativeId))
					set.status = 204
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
				}
			)
			.get('/projects/:projectId/milestones', { params: ProjectIdParam }, ({ params, inWorkspace }) =>
				inWorkspace(async (tx, actor) => ({ data: await listProjectMilestones(tx, actor, params.projectId) }))
			)
			.post(
				'/projects/:projectId/milestones',
				{ params: ProjectIdParam, body: CreateProjectMilestoneBody },
				async ({ params, body, workspaceCtx, inWorkspace, set }) => {
					const result = await inWorkspace((tx, actor) =>
						createProjectMilestone(tx, actor, params.projectId, body)
					)
					set.status = 201
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			.patch(
				'/projects/:projectId/milestones/:milestoneId',
				{ params: MilestoneParam, body: UpdateProjectMilestoneBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) =>
						updateProjectMilestone(tx, actor, params.projectId, params.milestoneId, body)
					)
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			.delete(
				'/projects/:projectId/milestones/:milestoneId',
				{ params: MilestoneParam },
				async ({ params, workspaceCtx, inWorkspace, set }) => {
					const result = await inWorkspace((tx, actor) =>
						deleteProjectMilestone(tx, actor, params.projectId, params.milestoneId)
					)
					set.status = 204
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
				}
			)
			.get('/projects/:projectId/updates', { params: ProjectIdParam }, ({ params, inWorkspace }) =>
				inWorkspace(async (tx, actor) => ({ data: await listProjectUpdates(tx, actor, params.projectId) }))
			)
			.post(
				'/projects/:projectId/updates',
				{ params: ProjectIdParam, body: CreateProjectUpdateBody },
				async ({ params, body, workspaceCtx, inWorkspace, set }) => {
					const result = await inWorkspace((tx, actor) =>
						createProjectUpdate(tx, actor, params.projectId, body)
					)
					set.status = 201
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			// ---- Project statuses ----
			.get('/projects/:projectId/statuses', { params: ProjectIdParam }, ({ params, inWorkspace }) =>
				inWorkspace(async (tx, actor) => ({
					data: await listProjectStatuses(tx, actor, params.projectId)
				}))
			)
			.post(
				'/projects/:projectId/statuses',
				{ params: ProjectIdParam, body: CreateStatusBody },
				async ({ params, body, workspaceCtx, inWorkspace, set }) => {
					const result = await inWorkspace((tx, actor) =>
						createProjectStatus(tx, actor, params.projectId, body)
					)
					set.status = 201
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			.patch(
				'/statuses/:id',
				{ params: IdParam, body: UpdateStatusBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) => updateProjectStatus(tx, actor, params.id, body))
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			// ---- Labels ----
			.get('/labels', ({ inWorkspace }) =>
				inWorkspace(async (tx, actor) => ({ data: await listWorkspaceLabels(tx, actor) }))
			)
			.post('/labels', { body: CreateLabelBody }, async ({ body, workspaceCtx, inWorkspace, set }) => {
				const result = await inWorkspace((tx, actor) => createLabel(tx, actor, body))
				set.status = 201
				if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
				return result.data
			})
			.patch(
				'/labels/:id',
				{ params: IdParam, body: UpdateLabelBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) => updateLabel(tx, actor, params.id, body))
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			// ---- Cycles ----
			.get('/cycles', { query: ListCyclesQuery }, ({ query, inWorkspace }) =>
				inWorkspace(async (tx, actor) => ({
					data: await listCycles(tx, actor, query.projectId)
				}))
			)
			.post('/cycles', { body: CreateCycleBody }, async ({ body, workspaceCtx, inWorkspace, set }) => {
				const result = await inWorkspace((tx, actor) => createCycle(tx, actor, body))
				set.status = 201
				if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
				return result.data
			})
			.patch(
				'/cycles/:id',
				{ params: IdParam, body: UpdateCycleBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) => updateCycle(tx, actor, params.id, body))
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			// Daily burnup snapshot series for the cycle header charts (§3.3).
			.get('/cycles/:cycleId/snapshots', { params: CycleIdParam }, ({ params, inWorkspace }) =>
				inWorkspace(async (tx, actor) => ({
					data: await listCycleSnapshots(tx, actor, params.cycleId)
				}))
			)
			// ---- Issues ----
			.get('/issues', { query: ListIssuesQuery }, ({ query, inWorkspace }) =>
				inWorkspace((tx, actor) => listIssues(tx, actor, query))
			)
			.get('/issues/by-key/:identifier', { params: IssueKeyParam }, ({ params, workspaceCtx, inWorkspace }) =>
				inWorkspace(async (tx, actor) => {
					try {
						// `.md` representation (§13.1b): Elysia has no param
						// suffixes, so `ENG-1.md` arrives inside the identifier.
						const { id: ref, markdown } = splitMdParam(params.identifier)
						if (markdown) {
							const issue = /^[0-9a-f-]{36}$/i.test(ref)
								? (await getIssueDetail(tx, actor, ref)).issue
								: await getIssueByIdentifier(tx, actor, ref)
							return markdownResponse(renderIssue(issue))
						}
						const issue = await getIssueByIdentifier(tx, actor, params.identifier)
						return { issue, redirectedFrom: null }
					} catch (err) {
						if (err instanceof HttpError && err.status === 404) {
							const mapping = await resolveRedirectFromImportMapping(
								tx,
								workspaceCtx.workspaceId,
								params.identifier
							)
							if (mapping?.localType === 'issue') {
								const detail = await getIssueDetail(tx, actor, mapping.localId)
								return { issue: detail.issue, redirectedFrom: params.identifier }
							}
						}
						throw err
					}
				})
			)
			// GET /issues/:id accepts `<uuid>.md` too (§13.1b) — the looser param
			// schema lets the suffix through and the handler re-tightens to uuid.
			.get('/issues/:id', { params: IssueGetParam }, ({ params, inWorkspace }) =>
				inWorkspace(async (tx, actor) => {
					const { id: ref, markdown } = splitMdParam(params.id)
					if (!/^[0-9a-f-]{36}$/i.test(ref)) {
						throw new HttpError(422, 'validation_failed', 'id must be a uuid (optionally suffixed .md)')
					}
					const detail = await getIssueDetail(tx, actor, ref)
					if (markdown) return markdownResponse(renderIssue(detail.issue))
					return detail
				})
			)
			.post(
				'/issues',
				{ body: CreateIssueBody },
				async ({ body, headers, workspaceCtx, inWorkspace, set }) => {
					const res = await inWorkspace((tx, actor) =>
						withIdempotency(tx, {
							workspaceId: workspaceCtx.workspaceId,
							key: headers['idempotency-key'],
							endpoint: 'POST /api/v1/issues',
							requestBody: body,
							successStatus: 201,
							execute: () => createIssue(tx, actor, body)
						})
					)
					set.status = res.status
					if (!res.replayed && pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, res.body.cursor)
					return res.body.data
				}
			)
			.patch(
				'/issues/:id',
				{ params: IdParam, body: UpdateIssueBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) => updateIssue(tx, actor, params.id, body))
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			.post(
				'/issues/:id/move',
				{ params: IdParam, body: MoveIssueBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) => moveIssue(tx, actor, params.id, body))
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return { issue: result.data, rebalanced: result.rebalanced }
				}
			)
			.put(
				'/issues/:id/labels',
				{ params: IdParam, body: SetIssueLabelsBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) =>
						setIssueLabels(tx, actor, params.id, body.labelIds, body.version)
					)
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			.delete('/issues/:id', { params: IdParam }, async ({ params, headers, workspaceCtx, inWorkspace }) => {
				const versionHeader = headers['if-match']
				const expectedVersion = versionHeader
					? Number.parseInt(versionHeader.replace(/\D/g, ''), 10)
					: undefined
				const result = await inWorkspace((tx, actor) =>
					deleteIssue(tx, actor, params.id, Number.isFinite(expectedVersion) ? expectedVersion : undefined)
				)
				if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
				return { deleted: true, id: result.id }
			})
			.post('/issues/query', { body: QueryIssuesBody }, ({ body, inWorkspace }) =>
				inWorkspace((tx, actor) => queryIssues(tx, actor, body))
			)
			.post(
				'/issues/bulk',
				{ body: BulkIssuesBody },
				async ({ body, headers, workspaceCtx, inWorkspace }) => {
					const res = await inWorkspace((tx, actor) =>
						withIdempotency(tx, {
							workspaceId: workspaceCtx.workspaceId,
							key: headers['idempotency-key'],
							endpoint: 'POST /api/v1/issues/bulk',
							requestBody: body,
							execute: () => bulkUpdateIssues(tx, actor, body)
						})
					)
					if (!res.replayed && pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, res.body.cursor)
					return res.body
				}
			)
			.post(
				'/issues/bulk/restore',
				{ body: BulkRestoreBody },
				async ({ body, headers, workspaceCtx, inWorkspace }) => {
					const res = await inWorkspace((tx, actor) =>
						withIdempotency(tx, {
							workspaceId: workspaceCtx.workspaceId,
							key: headers['idempotency-key'],
							endpoint: 'POST /api/v1/issues/bulk/restore',
							requestBody: body,
							execute: () => bulkRestoreIssues(tx, actor, body)
						})
					)
					if (!res.replayed && pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, res.body.cursor)
					return res.body
				}
			)
			.post(
				'/issues/:id/triage',
				{ params: IdParam, body: TriageActionBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) => triageIssue(tx, actor, params.id, body))
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			.get('/issues/:id/triage-suggestions', { params: IdParam }, ({ params, inWorkspace }) =>
				inWorkspace((tx, actor) => getTriageSuggestions(tx, actor, params.id))
			)
			// ---- Relations & Comments ----
			.post(
				'/issues/:issueId/relations',
				{ params: IssueIdParam, body: CreateIssueRelationBody },
				async ({ params, body, workspaceCtx, inWorkspace, set }) => {
					const result = await inWorkspace((tx, actor) =>
						createIssueRelation(tx, actor, params.issueId, body)
					)
					set.status = 201
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			.delete(
				'/issues/:issueId/relations/:relationId',
				{ params: RelationDeleteParam },
				async ({ params, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) =>
						deleteIssueRelation(tx, actor, params.issueId, params.relationId)
					)
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return { deleted: true, id: params.relationId }
				}
			)
			.post(
				'/issues/:issueId/comments',
				{ params: IssueIdParam, body: CreateIssueCommentBody },
				async ({ params, body, headers, workspaceCtx, inWorkspace, set }) => {
					const res = await inWorkspace((tx, actor) =>
						withIdempotency(tx, {
							workspaceId: workspaceCtx.workspaceId,
							key: headers['idempotency-key'],
							endpoint: `POST /api/v1/issues/${params.issueId}/comments`,
							requestBody: body,
							successStatus: 201,
							execute: () => createIssueComment(tx, actor, params.issueId, body)
						})
					)
					set.status = res.status
					if (!res.replayed && pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, res.body.cursor)
					return res.body.data
				}
			)
			.patch(
				'/issues/:issueId/comments/:commentId',
				{ params: CommentPatchParam, body: UpdateIssueCommentBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) =>
						updateIssueComment(tx, actor, params.issueId, params.commentId, body)
					)
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			// ---- Saved views ----
			.get('/views', ({ inWorkspace }) =>
				inWorkspace(async (tx, actor) => ({ data: await listSavedViews(tx, actor) }))
			)
			.post('/views', { body: CreateSavedViewBody }, async ({ body, workspaceCtx, inWorkspace, set }) => {
				const result = await inWorkspace((tx, actor) => createSavedView(tx, actor, body))
				set.status = 201
				if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
				return result.data
			})
			.patch(
				'/views/:id',
				{ params: IdParam, body: UpdateSavedViewBody },
				async ({ params, body, workspaceCtx, inWorkspace }) => {
					const result = await inWorkspace((tx, actor) => updateSavedView(tx, actor, params.id, body))
					if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
					return result.data
				}
			)
			.delete('/views/:id', { params: IdParam }, async ({ params, workspaceCtx, inWorkspace }) => {
				const result = await inWorkspace((tx, actor) => deleteSavedView(tx, actor, params.id))
				if (pubsub) await pubsub.publishCursor(workspaceCtx.workspaceId, result.cursor)
				return { deleted: true, id: params.id }
			})
	)
}
