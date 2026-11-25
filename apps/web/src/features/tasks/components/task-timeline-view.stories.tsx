import { activateI18n } from '@huriro/i18n'
import { SyncProvider, useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useMemo, useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { TooltipProvider } from '@/components/ui/tooltip'
import { type BootstrappedWorkspace, createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { WorkspaceProvider } from '@/lib/workspace'
import { TaskTimelineView } from './task-timeline-view'

activateI18n('en')

function TimelineCanvas() {
	const engine = useSyncEngine()
	const issues = useCollectionItems(engine.collections.issues)
	const projects = useCollectionItems(engine.collections.projects)
	const initiatives = useCollectionItems(engine.collections.initiatives)
	const milestones = useCollectionItems(engine.collections.projectMilestones)
	const relations = useCollectionItems(engine.collections.issueRelations)
	const statuses = useCollectionItems(engine.collections.projectStatuses)
	const statusesById = useMemo(() => new Map(statuses.map((status) => [status.id, status])), [statuses])
	return (
		<TaskTimelineView
			issues={issues}
			projects={projects}
			initiatives={initiatives}
			milestones={milestones}
			relations={relations}
			statusesById={statusesById}
			canManageInitiatives
			canWriteProjects
			initialAnchorDate="2026-11-22"
			onPatchIssue={(id, patch) => engine.updateIssue(id, patch)}
		/>
	)
}

function PreviewHarness() {
	const [boot, setBoot] = useState<BootstrappedWorkspace | null>(null)
	useEffect(() => {
		let active: BootstrappedWorkspace | null = null
		let cancelled = false
		void createPreviewWorkspace().then((created) => {
			if (cancelled) {
				created.engine.dispose()
				return
			}
			active = created
			setBoot(created)
		})
		return () => {
			cancelled = true
			active?.engine.dispose()
		}
	}, [])
	if (!boot) return null
	return (
		<div className="h-[520px] w-[980px] border border-border bg-background text-foreground">
			<TooltipProvider>
				<WorkspaceProvider boot={boot}>
					<SyncProvider engine={boot.engine}>
						<TimelineCanvas />
					</SyncProvider>
				</WorkspaceProvider>
			</TooltipProvider>
		</div>
	)
}

const meta: Meta = {
	title: 'Tasks/Timeline',
	render: () => <PreviewHarness />,
	parameters: { layout: 'centered' }
}
export default meta

type Story = StoryObj

export const PlanningTimeline: Story = {
	play: async () => {
		const body = within(document.body)
		await body.findByText('Offline-first launch')
		await body.findByText(/ENG-1/)
		await expect(document.body.querySelector('svg path[marker-end]')).not.toBeNull()
		await userEvent.click(await body.findByRole('button', { name: 'New initiative' }))
		await body.findByText('Create initiative')
		await userEvent.keyboard('{Escape}')
	}
}
