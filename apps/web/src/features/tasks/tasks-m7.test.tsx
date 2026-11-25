import {
	appendFilterNode,
	createPredicate,
	type FilterExpr,
	filterExprEquals,
	validateFilter
} from '@huriro/domain'
import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useKeyboardShortcuts } from '@/features/keyboard/use-keyboard-shortcuts'
import { createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { expectNoViolations } from '@/lib/test-setup'
import { WorkspaceProvider } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'
import { TasksWorkspace } from './components/tasks-workspace'

activateI18n('en')

function resetStore() {
	useUiStore.setState({
		destination: 'tasks',
		sidebarLevel: 'feature',
		sidebarCollapsed: false,
		activeProjectId: null,
		tasksPreset: 'all',
		tasksLayout: 'list',
		density: 'comfortable',
		shortcutsEnabled: true,
		selectedIssueId: null,
		focusedIssueId: null,
		selectedIssueIds: [],
		detailPanelOpen: false,
		filters: {
			query: '',
			statusId: 'all',
			priority: 'all',
			assigneeId: 'all',
			activeViewId: null
		},
		filterExpr: null,
		tasksDisplay: {
			groupBy: 'none',
			subGroupBy: 'none',
			sortBy: 'manual',
			sortDirection: 'asc',
			showSubIssues: true
		},
		commandPaletteOpen: false,
		shortcutsDialogOpen: false,
		createIssueOpen: false,
		createProjectOpen: false,
		conflictDialogOpen: false,
		importDialogOpen: false,
		toasts: []
	})
}

describe('M7 selection model', () => {
	beforeEach(resetStore)

	it('toggleMultiSelectIssue adds then removes the same id', () => {
		const s = useUiStore.getState()
		s.toggleMultiSelectIssue('a')
		expect(useUiStore.getState().selectedIssueIds).toEqual(['a'])
		useUiStore.getState().toggleMultiSelectIssue('b')
		expect(useUiStore.getState().selectedIssueIds).toEqual(['a', 'b'])
		useUiStore.getState().toggleMultiSelectIssue('a')
		expect(useUiStore.getState().selectedIssueIds).toEqual(['b'])
	})

	it('rangeSelectIssue selects forward and backward ranges from the anchor', () => {
		const ordered = ['a', 'b', 'c', 'd', 'e']
		useUiStore.setState({ focusedIssueId: 'b' })
		useUiStore.getState().rangeSelectIssue('d', ordered)
		expect(useUiStore.getState().selectedIssueIds).toEqual(['b', 'c', 'd'])

		// Backward range over the same ordering — anchors on the new focus.
		useUiStore.getState().clearMultiSelect()
		useUiStore.setState({ focusedIssueId: 'd' })
		useUiStore.getState().rangeSelectIssue('b', ordered)
		expect(useUiStore.getState().selectedIssueIds).toEqual(['b', 'c', 'd'])
	})

	it('rangeSelectIssue without an anchor selects only the target and focuses it', () => {
		useUiStore.setState({ focusedIssueId: null, selectedIssueIds: [] })
		useUiStore.getState().rangeSelectIssue('c', ['a', 'b', 'c'])
		expect(useUiStore.getState().selectedIssueIds).toEqual(['c'])
		expect(useUiStore.getState().focusedIssueId).toBe('c')
	})

	it('rangeSelectIssue ignores targets outside the visible order', () => {
		useUiStore.setState({ focusedIssueId: 'a' })
		useUiStore.getState().rangeSelectIssue('zzz', ['a', 'b'])
		expect(useUiStore.getState().selectedIssueIds).toEqual([])
	})

	it('selectAllIssues + clearMultiSelect round out the bulk lifecycle', () => {
		useUiStore.getState().selectAllIssues(['x', 'y', 'z'])
		expect(useUiStore.getState().selectedIssueIds).toHaveLength(3)
		useUiStore.getState().clearMultiSelect()
		expect(useUiStore.getState().selectedIssueIds).toEqual([])
	})
})

function ShortcutHarness({ orderedIssueIds }: { readonly orderedIssueIds: readonly string[] }) {
	useKeyboardShortcuts({ orderedIssueIds })
	return <input aria-label="text field" />
}

describe('M7 keyboard shortcuts', () => {
	beforeEach(resetStore)

	it('Mod+A selects every issue in the current view order', () => {
		render(<ShortcutHarness orderedIssueIds={['i1', 'i2', 'i3']} />)
		fireEvent.keyDown(window, { key: 'a', ctrlKey: true })
		expect(useUiStore.getState().selectedIssueIds).toEqual(['i1', 'i2', 'i3'])
	})

	it('Mod+A never hijacks text selection inside editable elements', () => {
		render(<ShortcutHarness orderedIssueIds={['i1', 'i2']} />)
		const input = screen.getByLabelText('text field')
		fireEvent.keyDown(input, { key: 'a', ctrlKey: true })
		expect(useUiStore.getState().selectedIssueIds).toEqual([])
	})

	it('Escape clears the multi-selection', () => {
		useUiStore.getState().selectAllIssues(['i1', 'i2'])
		render(<ShortcutHarness orderedIssueIds={['i1', 'i2']} />)
		fireEvent.keyDown(window, { key: 'Escape' })
		expect(useUiStore.getState().selectedIssueIds).toEqual([])
	})
})

describe('M7 filter expr round-trip', () => {
	it('builder output validates, serializes to JSON, and parses back equal', () => {
		// The AST is the wire format (§3.4): what the builder produces must
		// survive JSON serialization unchanged — saved views and the sync
		// outbox both carry it as plain JSON.
		let expr = { kind: 'and', args: [] } as unknown as FilterExpr
		expr = appendFilterNode(expr, [], createPredicate('priority')) as FilterExpr
		expr = appendFilterNode(expr, [], createPredicate('status_category')) as FilterExpr
		expect(validateFilter(expr).ok).toBe(true)

		const revived = JSON.parse(JSON.stringify(expr)) as FilterExpr
		expect(filterExprEquals(expr, revived)).toBe(true)
		expect(validateFilter(revived).ok).toBe(true)
	})

	it('createSavedView persists filterExpr and displayOptions losslessly', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const expr = {
				kind: 'and',
				args: [
					{ kind: 'pred', field: 'priority', op: 'gte', value: 2 },
					{ kind: 'pred', field: 'due_date', op: 'lt', value: { relative: '+7d' } }
				]
			}
			const displayOptions = {
				groupBy: 'priority',
				subGroupBy: 'assignee_id',
				sortBy: 'due_date',
				sortDirection: 'desc' as const,
				showSubIssues: false
			}
			const created = await boot.engine.createSavedView({
				name: 'Round Trip',
				projectId: null,
				layout: 'board',
				filters: {},
				filterExpr: expr as never,
				displayOptions,
				isShared: false
			})

			const row = boot.engine.collections.savedViews.get(created.id)
			expect(row).toBeDefined()
			// JSON round-trip is the honesty check: the replica and the wire both
			// carry plain JSON, so object identity in memory proves nothing.
			expect(JSON.parse(JSON.stringify(row?.filterExpr))).toEqual(expr)
			expect(row?.displayOptions).toMatchObject(displayOptions)
		} finally {
			boot.engine.dispose()
		}
	})
})

describe('M7 board swimlanes', () => {
	beforeEach(resetStore)

	it('renders priority lanes when subGroupBy is priority, with zero axe violations', async () => {
		useUiStore.setState({
			tasksLayout: 'board',
			tasksDisplay: {
				groupBy: 'none',
				subGroupBy: 'priority',
				sortBy: 'manual',
				sortDirection: 'asc',
				showSubIssues: true
			}
		})
		const boot = await createPreviewWorkspace()
		try {
			const { container } = render(
				<TooltipProvider>
					<WorkspaceProvider boot={boot}>
						<SyncProvider engine={boot.engine}>
							<TasksWorkspace api={boot.api} currentUserId={boot.currentUserId} />
						</SyncProvider>
					</WorkspaceProvider>
				</TooltipProvider>
			)
			// Lane sections are labelled regions — querying by role avoids the
			// ambiguity with same-named priority badges on the cards.
			await waitFor(() => {
				expect(screen.getByRole('region', { name: 'Urgent' })).toBeInTheDocument()
			})
			expect(screen.getByRole('region', { name: 'No priority' })).toBeInTheDocument()
			// Lane cells carry the composite lane×column label for drop targeting.
			expect(screen.getByRole('region', { name: 'Urgent — Todo' })).toBeInTheDocument()
			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('renders assignee lanes with a terminal unassigned lane', async () => {
		useUiStore.setState({
			tasksLayout: 'board',
			tasksDisplay: {
				groupBy: 'none',
				subGroupBy: 'assignee_id',
				sortBy: 'manual',
				sortDirection: 'asc',
				showSubIssues: true
			}
		})
		const boot = await createPreviewWorkspace()
		try {
			render(
				<TooltipProvider>
					<WorkspaceProvider boot={boot}>
						<SyncProvider engine={boot.engine}>
							<TasksWorkspace api={boot.api} currentUserId={boot.currentUserId} />
						</SyncProvider>
					</WorkspaceProvider>
				</TooltipProvider>
			)
			await waitFor(() => {
				expect(screen.getByRole('region', { name: 'Unassigned' })).toBeInTheDocument()
			})
		} finally {
			boot.engine.dispose()
		}
	})

	it('flat board renders no lanes when subGroupBy is none', async () => {
		useUiStore.setState({ tasksLayout: 'board' })
		const boot = await createPreviewWorkspace()
		try {
			render(
				<TooltipProvider>
					<WorkspaceProvider boot={boot}>
						<SyncProvider engine={boot.engine}>
							<TasksWorkspace api={boot.api} currentUserId={boot.currentUserId} />
						</SyncProvider>
					</WorkspaceProvider>
				</TooltipProvider>
			)
			await waitFor(() => {
				expect(screen.getByText('ENG-1')).toBeInTheDocument()
			})
			// Priority lane regions must be absent — only status column regions render.
			expect(screen.queryByRole('region', { name: 'No priority' })).not.toBeInTheDocument()
		} finally {
			boot.engine.dispose()
		}
	})
})

describe('M7 bulk selection integration', () => {
	beforeEach(resetStore)

	it('Mod+A in the workspace selects the visible issues and shows the bulk bar', async () => {
		const boot = await createPreviewWorkspace()
		try {
			render(
				<TooltipProvider>
					<WorkspaceProvider boot={boot}>
						<SyncProvider engine={boot.engine}>
							<TasksWorkspace api={boot.api} currentUserId={boot.currentUserId} />
						</SyncProvider>
					</WorkspaceProvider>
				</TooltipProvider>
			)
			await waitFor(() => {
				expect(screen.getByText('ENG-1')).toBeInTheDocument()
			})
			act(() => {
				fireEvent.keyDown(window, { key: 'a', ctrlKey: true })
			})
			const selected = useUiStore.getState().selectedIssueIds
			expect(selected.length).toBeGreaterThan(0)
			await waitFor(() => {
				expect(screen.getByRole('toolbar')).toBeInTheDocument()
			})
		} finally {
			boot.engine.dispose()
		}
	})
})
