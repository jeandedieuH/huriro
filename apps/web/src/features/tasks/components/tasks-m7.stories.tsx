import type { CycleDto } from '@huriro/contracts'
import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { TooltipProvider } from '@/components/ui/tooltip'
import { type BootstrappedWorkspace, createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { WorkspaceProvider } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'
import { BulkActionBar } from './bulk-action-bar'
import { ClosedHistorySection } from './closed-history-section'
import { CycleStrip } from './cycle-strip'
import { DisplayMenu } from './display-menu'
import { EntityLinksSection } from './entity-links'
import { FilterBuilderButton } from './filter-builder'
import { TriageInbox } from './triage-inbox'

activateI18n('en')

const PREVIEW_CYCLE: CycleDto = {
	id: '0190a0b1-0000-7000-8000-000000000c01',
	workspaceId: '0190a0b1-0000-7000-8000-000000000001',
	projectId: '0190a0b1-0000-7000-8000-000000000201',
	name: 'Cycle 7',
	description: '',
	status: 'active',
	startsAt: '2026-11-16',
	endsAt: '2026-11-29',
	createdAt: '2026-11-16T09:00:00Z',
	updatedAt: '2026-11-16T09:00:00Z',
	version: 1
}

/** Reset every store slice the M7 widgets read so stories stay independent. */
function resetM7Store() {
	useUiStore.setState({
		filterExpr: null,
		selectedIssueIds: [],
		tasksDisplay: {
			groupBy: 'none',
			subGroupBy: 'none',
			sortBy: 'manual',
			sortDirection: 'asc',
			showSubIssues: true
		},
		toasts: []
	})
}

/**
 * Shared harness: boots the in-memory preview workspace once per story and
 * renders children inside the same provider stack the app shell uses
 * (WorkspaceProvider + SyncProvider + TooltipProvider). The M7 composites
 * read the replica/api through context, so matching production wiring is
 * the point of the exercise. `bare` skips the engine boot for store-only
 * widgets (filter builder, display menu) — faster and isolation-tested.
 */
function PreviewHarness({
	selectedIssueIds = [],
	onBoot,
	children
}: {
	readonly selectedIssueIds?: readonly string[]
	readonly onBoot?: (boot: BootstrappedWorkspace) => void
	readonly children: (boot: BootstrappedWorkspace) => React.ReactNode
}) {
	const [boot, setBoot] = useState<BootstrappedWorkspace | null>(null)

	// biome-ignore lint/correctness/useExhaustiveDependencies: boot once per story mount — re-booting would churn the engine
	useEffect(() => {
		let cancelled = false
		let active: BootstrappedWorkspace | null = null
		resetM7Store()
		void createPreviewWorkspace().then((b) => {
			if (cancelled) {
				b.engine.dispose()
				return
			}
			active = b
			if (selectedIssueIds.length > 0) {
				useUiStore.getState().selectAllIssues(selectedIssueIds)
			}
			onBoot?.(b)
			setBoot(b)
		})
		return () => {
			cancelled = true
			active?.engine.dispose()
		}
	}, [])

	if (!boot) return null
	return (
		<div className="min-h-24 border border-border bg-background p-3 text-foreground">
			<TooltipProvider>
				<WorkspaceProvider boot={boot}>
					<SyncProvider engine={boot.engine}>{children(boot)}</SyncProvider>
				</WorkspaceProvider>
			</TooltipProvider>
		</div>
	)
}

/**
 * M7 composite widgets (§3.4/§8.1): one story file, one meta — each story
 * renders a different widget through `render`, which is valid CSF and keeps
 * the harness boilerplate in one place.
 */
const meta: Meta = {
	title: 'Features/Tasks/M7'
}
export default meta
type Story = StoryObj<typeof meta>

// ─── Filter builder ─────────────────────────────────────────────────────────

export const FilterBuilderDefault: Story = {
	render: () => (
		<div className="flex gap-2 p-2">
			<FilterBuilderButton />
		</div>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		// Open the builder, add a predicate row and apply — the compound expr
		// must land in the ui-store (the workspace evaluates it locally).
		useUiStore.getState().setFilterExpr(null)
		await userEvent.click(canvas.getByRole('button', { name: /filter/i }))
		const body = within(canvasElement.ownerDocument.body)
		const addRule = await body.findByRole('button', { name: /add rule/i })
		await userEvent.click(addRule)
		const apply = await body.findByRole('button', { name: /apply/i })
		await userEvent.click(apply)
		await expect(useUiStore.getState().filterExpr).not.toBeNull()
		useUiStore.getState().setFilterExpr(null)
	}
}

export const FilterBuilderWithActiveExpr: Story = {
	render: () => {
		useUiStore.getState().setFilterExpr({
			kind: 'and',
			args: [{ kind: 'pred', field: 'priority', op: 'gte', value: 2 }]
		})
		return (
			<div className="flex gap-2 p-2">
				<FilterBuilderButton />
			</div>
		)
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		// An active expr shows the row-count badge on the trigger.
		await expect(canvas.getByText('1')).toBeInTheDocument()
		useUiStore.getState().setFilterExpr(null)
	}
}

// ─── Display menu ───────────────────────────────────────────────────────────

export const DisplayMenuDefault: Story = {
	render: () => (
		<div className="flex gap-2 p-2">
			<DisplayMenu />
		</div>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		useUiStore.getState().setTasksDisplay({ groupBy: 'none' })
		await userEvent.click(canvas.getByRole('button'))
		const body = within(canvasElement.ownerDocument.body)
		// Pick "priority" grouping — the store patch must reflect the choice.
		const groupSelect = await body.findByLabelText(/group/i)
		await userEvent.selectOptions(groupSelect, 'priority')
		await expect(useUiStore.getState().tasksDisplay.groupBy).toBe('priority')
		useUiStore.getState().setTasksDisplay({ groupBy: 'none' })
	}
}

// ─── Cycle strip ────────────────────────────────────────────────────────────

export const CycleStripActive: Story = {
	render: () => (
		<PreviewHarness>
			{(boot) => (
				<CycleStrip cycle={PREVIEW_CYCLE} cycleIssues={boot.engine.collections.issues.toArray.slice(0, 4)} />
			)}
		</PreviewHarness>
	)
}

export const CycleStripBurnupPopover: Story = {
	render: () => (
		<PreviewHarness>
			{(boot) => (
				<CycleStrip cycle={PREVIEW_CYCLE} cycleIssues={boot.engine.collections.issues.toArray.slice(0, 4)} />
			)}
		</PreviewHarness>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		// The chart chunk is lazy — clicking must surface the popover content,
		// which in the preview workspace degrades to the empty-snapshots note.
		const trigger = await canvas.findByRole('button', { name: /burnup/i })
		await userEvent.click(trigger)
		const body = within(canvasElement.ownerDocument.body)
		await expect(await body.findByText(/snapshot/i, undefined, { timeout: 8000 })).toBeInTheDocument()
	}
}

// ─── Bulk action bar ────────────────────────────────────────────────────────

function BulkBarSurface({ boot }: { readonly boot: BootstrappedWorkspace }) {
	return (
		<BulkActionBar
			statuses={boot.engine.collections.projectStatuses.toArray}
			labels={boot.engine.collections.labels.toArray}
			cycles={[]}
		/>
	)
}

export const BulkBarHiddenWithoutSelection: Story = {
	render: () => <PreviewHarness>{(boot) => <BulkBarSurface boot={boot} />}</PreviewHarness>,
	play: async ({ canvasElement }) => {
		// Nothing selected → the bar must not render at all.
		await expect(canvasElement.querySelector('[role="toolbar"]')).toBeNull()
	}
}

export const BulkBarWithSelection: Story = {
	render: () => (
		<PreviewHarness
			onBoot={(boot) => {
				// Select the first two seed issues once the replica is up.
				const first = boot.engine.collections.issues.toArray.slice(0, 2).map((i) => i.id)
				useUiStore.getState().selectAllIssues(first)
			}}
		>
			{(boot) => <BulkBarSurface boot={boot} />}
		</PreviewHarness>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		// The bar announces the selection count and exposes bulk actions.
		const toolbar = await canvas.findByRole('toolbar', undefined, { timeout: 6000 })
		await expect(toolbar.textContent).toContain('2')
	}
}

// ─── Entity links ───────────────────────────────────────────────────────────

export const EntityLinksEmpty: Story = {
	render: () => (
		<PreviewHarness>
			{(boot) => {
				const first = boot.engine.collections.issues.toArray[0]
				return first ? <EntityLinksSection issueId={first.id} /> : null
			}}
		</PreviewHarness>
	)
}

// ─── Triage inbox ───────────────────────────────────────────────────────────

export const TriageEmptyQueue: Story = {
	render: () => (
		<PreviewHarness>
			{(boot) => {
				const project = boot.engine.collections.projects.toArray[0]
				return project ? <TriageInbox projectId={project.id} /> : null
			}}
		</PreviewHarness>
	),
	play: async ({ canvasElement }) => {
		// Preview mode degrades server-computed queues to empty — the inbox must
		// reach its empty state rather than spin forever.
		const canvas = within(canvasElement)
		await expect(await canvas.findByText(/triage/i, undefined, { timeout: 8000 })).toBeInTheDocument()
	}
}

// ─── Closed history section ─────────────────────────────────────────────────

function ClosedHistorySurface() {
	return (
		<PreviewHarness>
			{(boot) => {
				const project = boot.engine.collections.projects.toArray[0]
				if (!project) return null
				return (
					<ClosedHistorySection
						projectId={project.id}
						issues={boot.engine.collections.issues.toArray}
						statusesById={new Map(boot.engine.collections.projectStatuses.toArray.map((s) => [s.id, s]))}
						membersById={new Map()}
						pendingEntityIds={new Set()}
					/>
				)
			}}
		</PreviewHarness>
	)
}

export const ClosedHistoryCollapsed: Story = {
	render: () => <ClosedHistorySurface />
}

export const ClosedHistoryExpanded: Story = {
	render: () => <ClosedHistorySurface />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		// Expanding subscribes the tier-2 scope; the preview replica holds no
		// historical rows, so the empty note is the correct terminal state.
		await userEvent.click(await canvas.findByRole('button', { name: /closed history/i }))
		await expect(
			await canvas.findByText(/older closed|no older/i, undefined, { timeout: 8000 })
		).toBeInTheDocument()
	}
}
