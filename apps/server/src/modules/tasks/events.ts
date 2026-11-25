/**
 * Domain event names for the tasks module (§4.3 outbox).
 */
export const TASKS_EVENTS = {
	ProjectCreated: 'tasks.project.created.v1',
	ProjectUpdated: 'tasks.project.updated.v1',
	ProjectVisibilityChanged: 'tasks.project.visibility_changed.v1',
	StatusCreated: 'tasks.status.created.v1',
	StatusUpdated: 'tasks.status.updated.v1',
	LabelCreated: 'tasks.label.created.v1',
	LabelUpdated: 'tasks.label.updated.v1',
	CycleCreated: 'tasks.cycle.created.v1',
	CycleUpdated: 'tasks.cycle.updated.v1',
	CycleActivated: 'tasks.cycle.activated.v1',
	CycleCompleted: 'tasks.cycle.completed.v1',
	CycleRolledOver: 'tasks.cycle.rolled_over.v1',
	IssueCreated: 'tasks.issue.created.v1',
	IssueUpdated: 'tasks.issue.updated.v1',
	IssueAssigned: 'tasks.issue.assigned.v1',
	IssueStatusChanged: 'tasks.issue.status_changed.v1',
	IssueDeleted: 'tasks.issue.deleted.v1',
	IssueMoved: 'tasks.issue.moved.v1',
	IssueRelationCreated: 'tasks.issue_relation.created.v1',
	IssueRelationDeleted: 'tasks.issue_relation.deleted.v1',
	IssueCommentCreated: 'tasks.issue_comment.created.v1',
	IssueCommentUpdated: 'tasks.issue_comment.updated.v1',
	IssueTriageAccepted: 'tasks.issue.triage_accepted.v1',
	IssueTriageSnoozed: 'tasks.issue.triage_snoozed.v1',
	IssueTriageDeclined: 'tasks.issue.triage_declined.v1',
	IssueTriageMerged: 'tasks.issue.triage_merged.v1',
	IssueTriageWoken: 'tasks.issue.triage_woken.v1',
	SavedViewCreated: 'tasks.saved_view.created.v1',
	SavedViewUpdated: 'tasks.saved_view.updated.v1'
} as const
