import type { IssueDto } from '@huriro/contracts'
import {
	appendFilterNode,
	createPredicate,
	type FilterExpr,
	filterExprEquals,
	validateFilter
} from '@huriro/domain'
import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useKeyboardShortcuts } from '@/features/keyboard/use-keyboard-shortcuts'
import {
	createPreviewWorkspace,
	PREVIEW_PROJECT_ENG_ID,
	PREVIEW_PROJECT_SEC_ID,
	PREVIEW_USER_ID,
	PREVIEW_WORKSPACE_ID
} from '@/lib/sync-bootstrap'
import { expectNoViolations } from '@/lib/test-setup'
import { WorkspaceProvider } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'
import { EntityPeek } from './components/entity-links'
import { TasksSidebarNav } from './components/tasks-sidebar-nav'
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
function renderWithProviders(boot: Awaited<ReturnType<typeof createPreviewWorkspace>>, node: ReactNode) {
	return render(
		<TooltipProvider>
			<WorkspaceProvider boot={boot}>
				<SyncProvider engine={boot.engine}>{node}</SyncProvider>
			</WorkspaceProvider>
		</TooltipProvider>
	)
}

/** Full IssueDto-shaped row for replica injection — the seed rows predate the triage fields. */
function makeIssue(
	overrides: Partial<IssueDto> & Pick<IssueDto, 'id' | 'identifier' | 'projectId'>
): IssueDto {
	return {
		workspaceId: PREVIEW_WORKSPACE_ID,
		projectKey: 'ENG',
		number: 90,
		parentId: null,
		cycleId: null,
		milestoneId: null,
		title: `${overrides.identifier} injected row`,
		description: null,
		descriptionText: '',
		statusId: '0190a0b1-0000-7000-8000-000000000102',
		priority: 0,
		assigneeType: null,
		assigneeId: null,
		creatorId: PREVIEW_USER_ID,
		position: 'x',
		startDate: null,
		dueDate: null,
		estimate: null,
		triageStatus: 'none',
		triageSnoozedUntil: null,
		triageDeclinedReason: null,
		sourceKind: 'manual',
		closedAt: null,
		labelIds: [],
		createdAt: '2026-11-22T12:00:00Z',
		updatedAt: '2026-11-22T12:00:00Z',
		deletedAt: null,
		version: 1,
		...overrides
	} as IssueDto
}

describe('M7 board multi-select', () => {
	beforeEach(resetStore)

	it('checkbox toggles a board card into the multi-selection and the bulk bar appears', async () => {
		useUiStore.setState({ tasksLayout: 'board' })
		const boot = await createPreviewWorkspace()
		try {
			renderWithProviders(boot, <TasksWorkspace api={boot.api} currentUserId={boot.currentUserId} />)
			await waitFor(() => {
				expect(screen.getByText('ENG-1')).toBeInTheDocument()
			})
			const eng1 = boot.engine.collections.issues.toArray.find((i) => i.identifier === 'ENG-1')
			expect(eng1).toBeDefined()
			if (!eng1) return

			const checkbox = screen.getByRole('checkbox', { name: /Select ENG-1/ })
			act(() => {
				fireEvent.click(checkbox)
			})
			expect(useUiStore.getState().selectedIssueIds).toEqual([eng1.id])
			// The BulkActionBar needs no board-specific wiring — it reads the same store.
			await waitFor(() => {
				expect(screen.getByRole('toolbar')).toBeInTheDocument()
			})

			act(() => {
				fireEvent.click(checkbox)
			})
			expect(useUiStore.getState().selectedIssueIds).toEqual([])
		} finally {
			boot.engine.dispose()
		}
	})

	it('shift-click range-selects across the flattened board order, endpoints included', async () => {
		useUiStore.setState({ tasksLayout: 'board' })
		const boot = await createPreviewWorkspace()
		try {
			renderWithProviders(boot, <TasksWorkspace api={boot.api} currentUserId={boot.currentUserId} />)
			await waitFor(() => {
				expect(screen.getByText('ENG-1')).toBeInTheDocument()
			})
			const ids = new Map(boot.engine.collections.issues.toArray.map((i) => [i.identifier, i.id]))
			// Flat-board DOM order is column-major: ENG-2 (Todo), ENG-1 (In Progress), ENG-3 (Done).
			const first = screen.getByRole('checkbox', { name: /Select ENG-2/ })
			const last = screen.getByRole('checkbox', { name: /Select ENG-3/ })
			act(() => {
				fireEvent.click(first)
			})
			act(() => {
				fireEvent.click(last, { shiftKey: true })
			})
			// The whole range ENG-2 → ENG-3 in flattened order, endpoint INCLUDED —
			// pins the preventDefault guard that stops Radix's toggle from undoing
			// the range endpoint.
			expect(useUiStore.getState().selectedIssueIds).toEqual([
				ids.get('ENG-2'),
				ids.get('ENG-1'),
				ids.get('ENG-3')
			])
		} finally {
			boot.engine.dispose()
		}
	})

	it('Escape clears a board multi-selection (global shortcut reaches the board)', async () => {
		useUiStore.setState({ tasksLayout: 'board' })
		const boot = await createPreviewWorkspace()
		try {
			renderWithProviders(boot, <TasksWorkspace api={boot.api} currentUserId={boot.currentUserId} />)
			await waitFor(() => {
				expect(screen.getByText('ENG-1')).toBeInTheDocument()
			})
			act(() => {
				fireEvent.click(screen.getByRole('checkbox', { name: /Select ENG-2/ }))
			})
			expect(useUiStore.getState().selectedIssueIds.length).toBe(1)
			act(() => {
				fireEvent.keyDown(window, { key: 'Escape' })
			})
			expect(useUiStore.getState().selectedIssueIds).toEqual([])
		} finally {
			boot.engine.dispose()
		}
	})
})

describe('M7 list shift-click parity', () => {
	beforeEach(resetStore)

	it('shift-click in the list keeps the range endpoint selected', async () => {
		const boot = await createPreviewWorkspace()
		try {
			renderWithProviders(boot, <TasksWorkspace api={boot.api} currentUserId={boot.currentUserId} />)
			await waitFor(() => {
				expect(screen.getByText('ENG-1')).toBeInTheDocument()
			})
			// List rows sort by position: ENG-1 (F), ENG-3 (F), SEC-1 (F), ENG-2 (V) —
			// ties stable in seed order. Shift range ENG-1 → SEC-1 spans three rows.
			act(() => {
				fireEvent.click(screen.getByRole('checkbox', { name: /Select ENG-1/ }))
			})
			act(() => {
				fireEvent.click(screen.getByRole('checkbox', { name: /Select SEC-1/ }), { shiftKey: true })
			})
			const selected = useUiStore.getState().selectedIssueIds
			const identifiers = selected.map(
				(id) => boot.engine.collections.issues.toArray.find((i) => i.id === id)?.identifier
			)
			expect(identifiers).toEqual(['ENG-1', 'ENG-3', 'SEC-1'])
		} finally {
			boot.engine.dispose()
		}
	})
})

describe('M7 triage nav gating + badge', () => {
	beforeEach(resetStore)

	it('hides the Triage entry when no project has triage enabled', async () => {
		const boot = await createPreviewWorkspace()
		try {
			renderWithProviders(boot, <TasksSidebarNav />)
			await waitFor(() => {
				expect(screen.getByRole('button', { name: /my tasks/i })).toBeInTheDocument()
			})
			// The preview seed ships zero triage-enabled projects — the entry must
			// not render at all (an always-empty inbox is noise, not a hint).
			expect(screen.queryByRole('button', { name: /^triage$/i })).not.toBeInTheDocument()
		} finally {
			boot.engine.dispose()
		}
	})

	it('shows the Triage entry with a pending-count badge once a project enables triage', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const eng = boot.engine.collections.projects.get(PREVIEW_PROJECT_ENG_ID)
			expect(eng).toBeDefined()
			if (!eng) return
			act(() => {
				boot.engine.collections.projectsManaged.upsertMany([{ ...eng, triageEnabled: true }])
				boot.engine.collections.issuesManaged.upsertMany([
					// Two pending rows in the triage-enabled project → counted.
					makeIssue({
						id: '0190a0b1-0000-7000-8000-000000000901',
						identifier: 'ENG-90',
						projectId: PREVIEW_PROJECT_ENG_ID,
						triageStatus: 'pending'
					}),
					makeIssue({
						id: '0190a0b1-0000-7000-8000-000000000902',
						identifier: 'ENG-91',
						projectId: PREVIEW_PROJECT_ENG_ID,
						triageStatus: 'pending'
					}),
					// Snoozed in the same project → NOT counted (badge is pending-only).
					makeIssue({
						id: '0190a0b1-0000-7000-8000-000000000903',
						identifier: 'ENG-92',
						projectId: PREVIEW_PROJECT_ENG_ID,
						triageStatus: 'snoozed'
					}),
					// Pending but in a non-triage project → NOT counted.
					makeIssue({
						id: '0190a0b1-0000-7000-8000-000000000904',
						identifier: 'SEC-90',
						projectId: PREVIEW_PROJECT_SEC_ID,
						projectKey: 'SEC',
						triageStatus: 'pending'
					}),
					// Pending but soft-deleted → NOT counted.
					makeIssue({
						id: '0190a0b1-0000-7000-8000-000000000905',
						identifier: 'ENG-93',
						projectId: PREVIEW_PROJECT_ENG_ID,
						triageStatus: 'pending',
						deletedAt: '2026-11-22T12:00:00Z'
					})
				])
			})

			renderWithProviders(boot, <TasksSidebarNav />)
			const triageButton = await screen.findByRole('button', { name: /triage/i })
			expect(triageButton).toBeInTheDocument()
			await waitFor(() => {
				expect(triageButton.textContent).toContain('2')
			})
		} finally {
			boot.engine.dispose()
		}
	})
})

describe('M7 triage workspace empty state', () => {
	beforeEach(resetStore)

	it('renders a guidance empty state when the preset is active without a triage project', async () => {
		useUiStore.setState({ tasksPreset: 'triage' })
		const boot = await createPreviewWorkspace()
		try {
			renderWithProviders(boot, <TasksWorkspace api={boot.api} currentUserId={boot.currentUserId} />)
			// Defense-in-depth behind the nav gating: never a blank pane.
			await waitFor(() => {
				expect(screen.getByText('No project has triage enabled')).toBeInTheDocument()
			})
		} finally {
			boot.engine.dispose()
		}
	})

	it('renders the triage inbox instead when a triage-enabled project exists', async () => {
		useUiStore.setState({ tasksPreset: 'triage' })
		const boot = await createPreviewWorkspace()
		try {
			const eng = boot.engine.collections.projects.get(PREVIEW_PROJECT_ENG_ID)
			if (!eng) throw new Error('seed project missing')
			act(() => {
				boot.engine.collections.projectsManaged.upsertMany([{ ...eng, triageEnabled: true }])
			})
			renderWithProviders(boot, <TasksWorkspace api={boot.api} currentUserId={boot.currentUserId} />)
			// Preview degrades the server-computed queue to empty — the inbox's own
			// empty state proves the inbox (not the no-project fallback) rendered.
			await waitFor(
				() => {
					expect(screen.getByText('Triage queue is empty')).toBeInTheDocument()
				},
				{ timeout: 4000 }
			)
			expect(screen.queryByText('No project has triage enabled')).not.toBeInTheDocument()
		} finally {
			boot.engine.dispose()
		}
	})
})

describe('M7 entity peek focus parity', () => {
	beforeEach(resetStore)

	it('opens the peek card on keyboard focus, not just hover', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const eng1 = boot.engine.collections.issues.toArray.find((i) => i.identifier === 'ENG-1')
			if (!eng1) throw new Error('seed issue missing')
			renderWithProviders(
				boot,
				<EntityPeek type="issue" id={eng1.id}>
					<button type="button">reference</button>
				</EntityPeek>
			)
			const trigger = screen.getByRole('button', { name: 'reference' })
			act(() => {
				trigger.focus()
			})
			// 250ms hover-intent debounce applies to focus too; the peek content is
			// portaled to body. The preview bridge resolves issue peeks from the replica.
			await waitFor(
				() => {
					expect(screen.getByText(eng1.title)).toBeInTheDocument()
				},
				{ timeout: 4000 }
			)
		} finally {
			boot.engine.dispose()
		}
	})
})

describe('M7/M8 task & project dialog wiring', () => {
	beforeEach(resetStore)

	it('creates a project with triage + cycles enabled, seeds preview statuses, and updates settings + cycles', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const { baseElement } = renderWithProviders(
				boot,
				<TasksWorkspace api={boot.api} currentUserId={boot.currentUserId} />
			)
			await screen.findByText('ENG-1')

			act(() => {
				useUiStore.getState().setCreateProjectOpen(true)
			})
			const createProjDialog = await screen.findByRole('dialog')
			const cp = within(createProjDialog)
			fireEvent.change(cp.getByLabelText('Project key'), { target: { value: 'OPS' } })
			fireEvent.change(cp.getByLabelText('Project name'), { target: { value: 'Operations' } })
			fireEvent.click(cp.getByLabelText('Enable cycles'))
			await expectNoViolations(baseElement)
			fireEvent.click(cp.getByRole('button', { name: 'Create project' }))

			await waitFor(() => {
				const ops = boot.engine.collections.projects.toArray.find((p) => p.key === 'OPS')
				expect(ops?.cycleEnabled).toBe(true)
				expect(ops?.triageEnabled).toBe(false)
			})
			const opsProject = boot.engine.collections.projects.toArray.find((p) => p.key === 'OPS')
			if (!opsProject) throw new Error('expected OPS project')
			expect(
				boot.engine.collections.projectStatuses.toArray.filter((s) => s.projectId === opsProject.id)
			).toHaveLength(5)
			expect(
				await screen.findByText('Cycles are enabled for this project, with no active cycle yet.')
			).toBeInTheDocument()

			// Open ProjectSettingsDialog to enable triage and create an active cycle -> CycleStrip renders.
			fireEvent.click(screen.getByRole('button', { name: 'Project settings' }))
			const settingsDialog = await screen.findByRole('dialog')
			const sp = within(settingsDialog)
			fireEvent.click(sp.getByLabelText('Enable triage inbox'))
			await expectNoViolations(baseElement)
			fireEvent.click(sp.getByRole('button', { name: 'Save settings' }))

			await waitFor(() => {
				expect(boot.engine.collections.projects.get(opsProject.id)?.triageEnabled).toBe(true)
			})

			fireEvent.click(screen.getByRole('button', { name: 'Project settings' }))
			const cycleDialog = await screen.findByRole('dialog')
			const cd = within(cycleDialog)
			fireEvent.change(cd.getByLabelText('Cycle name'), { target: { value: 'Sprint 42' } })
			fireEvent.click(cd.getByRole('button', { name: 'Start cycle' }))

			await waitFor(() => {
				expect(
					boot.engine.collections.cycles.toArray.some(
						(c) => c.projectId === opsProject.id && c.name === 'Sprint 42'
					)
				).toBe(true)
			})
			fireEvent.click(cd.getByRole('button', { name: 'Cancel' }))
			expect(await screen.findByText('Sprint 42')).toBeInTheDocument()
		} finally {
			boot.engine.dispose()
		}
	})

	it('creates a full task, inspects it in IssueDetailPanel, and routes triage tasks to TasksSidebarNav + TriageInbox', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const eng = boot.engine.collections.projects.toArray.find((p) => p.key === 'ENG')
			if (!eng) throw new Error('missing ENG project')
			act(() => {
				useUiStore.getState().setActiveProjectId(eng.id)
			})

			const { baseElement } = renderWithProviders(
				boot,
				<>
					<TasksSidebarNav />
					<TasksWorkspace api={boot.api} currentUserId={boot.currentUserId} />
				</>
			)
			await screen.findByText('ENG-1')

			act(() => {
				useUiStore.getState().setCreateIssueOpen(true)
			})
			const taskDialog = await screen.findByRole('dialog')
			const td = within(taskDialog)
			fireEvent.change(td.getByLabelText('Title'), { target: { value: 'Full M8 dialog task' } })
			fireEvent.change(td.getByLabelText('Estimate'), { target: { value: '8' } })

			const firstLabel = boot.engine.collections.labels.toArray[0]
			if (firstLabel) {
				fireEvent.click(td.getByRole('button', { name: firstLabel.name }))
			}
			await expectNoViolations(baseElement)
			fireEvent.click(td.getByRole('button', { name: 'Create task' }))

			let createdId = ''
			await waitFor(() => {
				const created = boot.engine.collections.issues.toArray.find((i) => i.title === 'Full M8 dialog task')
				expect(created).toBeDefined()
				expect(created?.estimate).toBe(8)
				if (firstLabel) expect(created?.labelIds).toContain(firstLabel.id)
				if (created) createdId = created.id
			})

			act(() => {
				useUiStore.getState().selectIssue(createdId, true)
			})
			await waitFor(() => {
				expect((screen.getByLabelText('Estimate') as HTMLInputElement).value).toBe('8')
			})

			await act(async () => {
				await boot.engine.updateProject(eng.id, { triageEnabled: true })
			})
			act(() => {
				useUiStore.getState().setCreateIssueOpen(true)
			})
			const triageDialog = await screen.findByRole('dialog')
			const ttd = within(triageDialog)
			fireEvent.change(ttd.getByLabelText('Title'), { target: { value: 'Inbound triage item' } })
			fireEvent.click(ttd.getByLabelText('Send to Triage'))
			fireEvent.click(ttd.getByRole('button', { name: 'Create task' }))

			await waitFor(() => {
				const triageIssue = boot.engine.collections.issues.toArray.find(
					(i) => i.title === 'Inbound triage item'
				)
				expect(triageIssue?.triageStatus).toBe('pending')
			})

			// Pending triage items stay hidden from the active issue list while updating the nav badge.
			expect(screen.queryByText('Inbound triage item')).toBeNull()
			const triageNavButton = await screen.findByRole('button', { name: /triage/i })
			expect(within(triageNavButton).getByText('1')).toBeInTheDocument()

			// Switching to TriageInbox renders the newly queued item live from the replica.
			act(() => {
				useUiStore.getState().setTasksPreset('triage')
			})
			expect(await screen.findByText('Inbound triage item')).toBeInTheDocument()
		} finally {
			boot.engine.dispose()
		}
	})
})
