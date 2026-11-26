import { activateI18n, t } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { expectNoViolations } from '@/lib/test-setup'
import { WorkspaceProvider } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'
import { TasksSidebarFooterUtility, TasksSidebarNav } from './components/tasks-sidebar-nav'

activateI18n('en')

async function renderTasksSidebar(options: { readonly collapsed?: boolean } = {}) {
	const boot = await createPreviewWorkspace()
	const rendered = render(
		<TooltipProvider>
			<WorkspaceProvider boot={boot}>
				<SyncProvider engine={boot.engine}>
					<TasksSidebarNav collapsed={options.collapsed} />
					<TasksSidebarFooterUtility collapsed={options.collapsed} />
				</SyncProvider>
			</WorkspaceProvider>
		</TooltipProvider>
	)
	const project = boot.engine.collections.projects.toArray.find((p) => p.archivedAt === null)
	if (!project) throw new Error('Expected at least one seeded project')
	const view = boot.engine.collections.savedViews.toArray[0]
	if (!view) throw new Error('Expected at least one seeded saved view')
	return { boot, project, view, ...rendered }
}

describe('TasksSidebarNav redesign', () => {
	beforeEach(() => {
		useUiStore.setState({
			activeProjectId: null,
			tasksPreset: 'all',
			tasksLayout: 'list',
			createIssueOpen: false,
			createProjectOpen: false,
			projectSettingsOpen: false,
			filters: {
				query: '',
				statusId: 'all',
				priority: 'all',
				assigneeId: 'all',
				activeViewId: null
			},
			filterExpr: null,
			toasts: []
		})
	})

	it('renders standalone without outer TooltipProvider or WorkspaceProvider with zero axe violations', async () => {
		const boot = await createPreviewWorkspace()
		const { container } = render(
			<SyncProvider engine={boot.engine}>
				<TasksSidebarNav />
			</SyncProvider>
		)
		try {
			expect(screen.getByRole('navigation', { name: t('tasks.title') })).toBeInTheDocument()
			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('renders collapsed rail mode cleanly with zero axe violations', async () => {
		const { boot, container } = await renderTasksSidebar({ collapsed: true })
		try {
			expect(screen.getByRole('button', { name: t('tasks.all-issues') })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: t('tasks.sidebar.trash') })).toBeInTheDocument()
			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('filters projects by name/key and saved views, and clears with Escape', async () => {
		const { boot, project, view } = await renderTasksSidebar()
		try {
			const filter = screen.getByRole('textbox', { name: t('tasks.sidebar.filter-label') })
			fireEvent.change(filter, { target: { value: project.key } })
			expect(screen.getByRole('button', { name: new RegExp(`^${project.name}`) })).toBeInTheDocument()
			expect(screen.queryByRole('button', { name: view.name })).not.toBeInTheDocument()

			fireEvent.change(filter, { target: { value: 'zzzz-no-match' } })
			expect(screen.getByText('No matches for “zzzz-no-match”.')).toBeInTheDocument()

			fireEvent.keyDown(filter, { key: 'Escape' })
			await waitFor(() => expect(screen.getByRole('button', { name: view.name })).toBeInTheDocument())
		} finally {
			boot.engine.dispose()
		}
	})

	it('supports inline project rename from menu and F2 cancel with Escape', async () => {
		const { boot, project } = await renderTasksSidebar()
		try {
			const [actionsTrigger] = screen.getAllByRole('button', { name: t('tasks.sidebar.project-actions') })
			if (!actionsTrigger) throw new Error('Expected project actions trigger')
			fireEvent.keyDown(actionsTrigger, { key: 'Enter' })
			fireEvent.click(await screen.findByRole('menuitem', { name: /Rename project/ }))

			const input = await screen.findByRole('textbox', { name: t('tasks.sidebar.project-rename-label') })
			fireEvent.change(input, { target: { value: 'Platform Core' } })
			fireEvent.keyDown(input, { key: 'Enter' })

			await waitFor(() => {
				expect(boot.engine.collections.projects.get(project.id)?.name).toBe('Platform Core')
			})

			const rowBtn = screen.getByRole('button', { name: /^Platform Core/ })
			fireEvent.keyDown(rowBtn, { key: 'F2' })
			const cancelInput = await screen.findByRole('textbox', {
				name: t('tasks.sidebar.project-rename-label')
			})
			fireEvent.change(cancelInput, { target: { value: 'Discarded Name' } })
			fireEvent.keyDown(cancelInput, { key: 'Escape' })

			await waitFor(() =>
				expect(
					screen.queryByRole('textbox', { name: t('tasks.sidebar.project-rename-label') })
				).not.toBeInTheDocument()
			)
			expect(boot.engine.collections.projects.get(project.id)?.name).toBe('Platform Core')
		} finally {
			boot.engine.dispose()
		}
	})

	it('performs project menu actions: new task, settings, visibility, triage, copy key, and archive with undo', async () => {
		const { boot, project } = await renderTasksSidebar()
		const writeText = vi.fn().mockResolvedValue(undefined)
		const prevClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
		Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

		try {
			const openFirstProjectMenu = () => {
				const [trigger] = screen.getAllByRole('button', { name: t('tasks.sidebar.project-actions') })
				if (!trigger) throw new Error('Expected project actions trigger')
				fireEvent.keyDown(trigger, { key: 'Enter' })
			}

			openFirstProjectMenu()
			fireEvent.click(await screen.findByRole('menuitem', { name: t('tasks.new-issue') }))
			expect(useUiStore.getState().activeProjectId).toBe(project.id)
			expect(useUiStore.getState().createIssueOpen).toBe(true)

			openFirstProjectMenu()
			fireEvent.click(await screen.findByRole('menuitem', { name: t('tasks.sidebar.project-settings') }))
			expect(useUiStore.getState().projectSettingsOpen).toBe(true)

			const initialVisibility = project.visibility
			openFirstProjectMenu()
			fireEvent.click(
				await screen.findByRole('menuitem', {
					name:
						initialVisibility === 'private'
							? t('tasks.sidebar.project-make-workspace')
							: t('tasks.sidebar.project-make-private')
				})
			)
			await waitFor(() =>
				expect(boot.engine.collections.projects.get(project.id)?.visibility).toBe(
					initialVisibility === 'private' ? 'workspace' : 'private'
				)
			)

			openFirstProjectMenu()
			fireEvent.click(await screen.findByRole('menuitem', { name: t('tasks.sidebar.project-enable-triage') }))
			await waitFor(() => expect(boot.engine.collections.projects.get(project.id)?.triageEnabled).toBe(true))

			openFirstProjectMenu()
			fireEvent.click(await screen.findByRole('menuitem', { name: t('tasks.sidebar.project-copy-key') }))
			await waitFor(() => expect(writeText).toHaveBeenCalledWith(project.key))

			openFirstProjectMenu()
			fireEvent.click(await screen.findByRole('menuitem', { name: t('tasks.sidebar.project-archive') }))
			await waitFor(() => expect(boot.engine.collections.projects.get(project.id)?.archivedAt).not.toBeNull())

			const archiveToast = useUiStore.getState().toasts.at(-1)
			expect(archiveToast?.onAction).toBeDefined()
			archiveToast?.onAction?.()
			await waitFor(() => expect(boot.engine.collections.projects.get(project.id)?.archivedAt).toBeNull())
		} finally {
			if (prevClipboard) Object.defineProperty(navigator, 'clipboard', prevClipboard)
			else Reflect.deleteProperty(navigator, 'clipboard')
			boot.engine.dispose()
		}
	})

	it('supports saved view menu actions: open as board and duplicate view', async () => {
		const { boot, view } = await renderTasksSidebar()
		try {
			const [viewTrigger] = screen.getAllByRole('button', { name: t('tasks.sidebar.view-actions') })
			if (!viewTrigger) throw new Error('Expected view actions trigger')
			fireEvent.keyDown(viewTrigger, { key: 'Enter' })
			fireEvent.click(await screen.findByRole('menuitem', { name: t('tasks.sidebar.view-open-board') }))
			expect(useUiStore.getState().tasksLayout).toBe('board')
			expect(useUiStore.getState().filters.activeViewId).toBe(view.id)

			fireEvent.keyDown(viewTrigger, { key: 'Enter' })
			fireEvent.click(await screen.findByRole('menuitem', { name: t('tasks.sidebar.view-duplicate') }))
			await waitFor(() => {
				expect(boot.engine.collections.savedViews.toArray.some((v) => v.name === `${view.name} (copy)`)).toBe(
					true
				)
			})
		} finally {
			boot.engine.dispose()
		}
	})
})
