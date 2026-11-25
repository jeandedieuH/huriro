import { describe, expect, test } from 'bun:test'
import type {
	InitiativeDto,
	IssueDto,
	IssueRelationDto,
	ProjectMilestoneDto,
	ProjectUpdateDto,
	SyncSnapshotResponse
} from '@huriro/contracts'
import { HuriroSyncCollections } from './index'

const WS_ID = '0190a0b1-9a9a-7000-8000-000000000001'
const USER_ID = '0190a0b1-9a9a-7000-8000-000000000002'
const PROJECT_ONE = '0190a0b1-9a9a-7000-8000-000000000003'
const PROJECT_TWO = '0190a0b1-9a9a-7000-8000-000000000004'
const INITIATIVE_ID = '0190a0b1-9a9a-7000-8000-000000000005'
const MILESTONE_ID = '0190a0b1-9a9a-7000-8000-000000000006'
const UPDATE_ID = '0190a0b1-9a9a-7000-8000-000000000007'
const RELATION_ID = '0190a0b1-9a9a-7000-8000-000000000008'
const ISSUE_ONE = '0190a0b1-9a9a-7000-8000-000000000009'
const ISSUE_TWO = '0190a0b1-9a9a-7000-8000-00000000000a'

function initiative(): InitiativeDto {
	return {
		id: INITIATIVE_ID,
		workspaceId: WS_ID,
		name: 'Reliability program',
		description: null,
		descriptionText: '',
		health: 'on_track',
		ownerId: USER_ID,
		targetDate: '2027-03-31',
		position: 'V',
		projectIds: [PROJECT_ONE, PROJECT_TWO],
		createdAt: '2026-11-22T00:00:00Z',
		updatedAt: '2026-11-22T00:00:00Z',
		version: 1
	}
}

function milestone(): ProjectMilestoneDto {
	return {
		id: MILESTONE_ID,
		workspaceId: WS_ID,
		projectId: PROJECT_ONE,
		name: 'Beta',
		description: '',
		targetDate: '2027-02-15',
		status: 'planned',
		position: 'V',
		createdAt: '2026-11-22T00:00:00Z',
		updatedAt: '2026-11-22T00:00:00Z',
		version: 1
	}
}

function projectUpdate(): ProjectUpdateDto {
	return {
		id: UPDATE_ID,
		workspaceId: WS_ID,
		projectId: PROJECT_ONE,
		health: 'at_risk',
		body: null,
		bodyText: '',
		completedIssues: 1,
		totalIssues: 3,
		scopeChange: 0,
		createdBy: USER_ID,
		createdAt: '2026-11-22T00:00:00Z',
		updatedAt: '2026-11-22T00:00:00Z',
		version: 1
	}
}

function relation(): IssueRelationDto {
	return {
		id: RELATION_ID,
		workspaceId: WS_ID,
		sourceIssueId: ISSUE_ONE,
		targetIssueId: ISSUE_TWO,
		kind: 'blocks',
		createdBy: USER_ID,
		createdAt: '2026-11-22T00:00:00Z'
	}
}

function issueInProjectOne(id: string): IssueDto {
	// Only identity/project/version fields matter to the revocation purge; cast a
	// compact fixture rather than duplicating the full issue factory boilerplate.
	return {
		id,
		workspaceId: WS_ID,
		projectId: PROJECT_ONE,
		version: 1,
		closedAt: null,
		deletedAt: null
	} as IssueDto
}

function snapshot(): SyncSnapshotResponse {
	return {
		cursor: 1,
		serverTime: '2026-11-22T00:00:00Z',
		projects: [],
		projectStatuses: [],
		labels: [],
		cycles: [],
		issues: [issueInProjectOne(ISSUE_ONE), issueInProjectOne(ISSUE_TWO)].map(
			(issue) => issue as unknown as Record<string, unknown>
		),
		issueRelations: [relation() as unknown as Record<string, unknown>],
		initiatives: [initiative() as unknown as Record<string, unknown>],
		projectMilestones: [milestone() as unknown as Record<string, unknown>],
		projectUpdates: [projectUpdate() as unknown as Record<string, unknown>],
		savedViews: [],
		notifications: [],
		docPages: []
	}
}

describe('HuriroSyncCollections M8 planning replication', () => {
	test('hydrates planning collections, applies changes, and strips revoked project edges', () => {
		const collections = new HuriroSyncCollections()
		collections.applyFullSnapshot(snapshot())

		expect(collections.initiatives.get(INITIATIVE_ID)?.projectIds).toEqual([PROJECT_ONE, PROJECT_TWO])
		expect(collections.projectMilestones.get(MILESTONE_ID)?.status).toBe('planned')
		expect(collections.projectUpdates.get(UPDATE_ID)?.completedIssues).toBe(1)
		expect(collections.issueRelations.get(RELATION_ID)?.kind).toBe('blocks')

		collections.applyChanges([
			{
				cursor: 2,
				entity: 'project_milestone',
				id: MILESTONE_ID,
				action: 'upsert',
				scope: [`project:${PROJECT_ONE}`],
				data: { ...milestone(), status: 'completed', version: 2 } as unknown as Record<string, unknown>,
				changedAt: '2026-11-22T00:01:00Z'
			}
		])
		expect(collections.projectMilestones.get(MILESTONE_ID)?.status).toBe('completed')

		// A project revoke must remove both project-owned rows and project references
		// embedded in workspace-level initiative rows.
		collections.purgeProjectScope(PROJECT_ONE)
		expect(collections.projectMilestones.get(MILESTONE_ID)).toBeUndefined()
		expect(collections.projectUpdates.get(UPDATE_ID)).toBeUndefined()
		expect(collections.issueRelations.get(RELATION_ID)).toBeUndefined()
		expect(collections.initiatives.get(INITIATIVE_ID)?.projectIds).toEqual([PROJECT_TWO])
	})
})
