import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { type BootstrappedWorkspace, createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { expectNoViolations } from '@/lib/test-setup'
import { TaskTimelineView } from './task-timeline-view'

activateI18n('en')

let boot: BootstrappedWorkspace | null = null

afterEach(() => {
	boot?.engine.dispose()
	boot = null
})

describe('TaskTimelineView', () => {
	it('renders dependency connectors and resizes the start edge with bracket shortcuts', async () => {
		boot = await createPreviewWorkspace()
		const engine = boot.engine
		const issues = engine.collections.issues.toArray
		const firstIssue = issues.find((issue) => issue.identifier === 'ENG-1')
		expect(firstIssue?.startDate).toBe('2026-11-20')

		const { container } = render(
			<SyncProvider engine={engine}>
				<TaskTimelineView
					issues={issues}
					projects={engine.collections.projects.toArray}
					initiatives={engine.collections.initiatives.toArray}
					milestones={engine.collections.projectMilestones.toArray}
					relations={engine.collections.issueRelations.toArray}
					statusesById={
						new Map(engine.collections.projectStatuses.toArray.map((status) => [status.id, status]))
					}
					canManageInitiatives
					canWriteProjects
					initialAnchorDate="2026-11-22"
					onPatchIssue={(id, patch) => engine.updateIssue(id, patch)}
				/>
			</SyncProvider>
		)

		expect(screen.getByText('Offline-first launch')).toBeInTheDocument()
		expect(container.querySelector('svg path[marker-end]')).not.toBeNull()

		fireEvent.keyDown(screen.getByTitle('2026-11-20 — 2026-11-23'), {
			key: '[',
			code: 'BracketLeft'
		})
		if (!firstIssue) throw new Error('missing ENG-1 preview issue')
		await waitFor(() => expect(engine.collections.issues.get(firstIssue.id)?.startDate).toBe('2026-11-19'))
		await expectNoViolations(container)
	})
})
