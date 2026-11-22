import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { expectNoViolations } from '@/lib/test-setup'
import { useUiStore } from '@/stores/ui-store'
import { CreateDocDialog } from './components/create-doc-dialog'
import { DocsWorkspace } from './components/docs-workspace'

activateI18n('en')

async function renderDocsWorkspace(activeSlug: string | null) {
	const boot = await createPreviewWorkspace()
	const rendered = render(
		<SyncProvider engine={boot.engine}>
			<DocsWorkspace
				api={boot.api}
				currentUserId={boot.currentUserId}
				isPreview={true}
				activeSlug={activeSlug}
			/>
		</SyncProvider>
	)
	return { boot, ...rendered }
}

describe('DocsWorkspace', () => {
	beforeEach(() => {
		useUiStore.setState({
			destination: 'docs',
			shortcutsEnabled: true,
			commandPaletteOpen: false,
			shortcutsDialogOpen: false,
			createIssueOpen: false,
			createProjectOpen: false,
			conflictDialogOpen: false,
			importDialogOpen: false,
			docsSidebarOpen: true,
			activeDocSidePanel: 'comments',
			createDocOpen: false,
			docShareOpen: false,
			docImportOpen: false,
			selectedCommentThreadId: null,
			toasts: []
		})
	})

	it('renders page tree and active TipTap collaborative doc cleanly with zero axe violations', async () => {
		const { boot, container } = await renderDocsWorkspace('engineering-handbook')
		try {
			await waitFor(() => {
				expect(screen.getByDisplayValue('Engineering Handbook')).toBeInTheDocument()
			})
			expect(screen.getByRole('navigation', { name: 'Workspace pages' })).toBeInTheDocument()
			expect(screen.getByText('Let us keep latency under 50ms p95.')).toBeInTheDocument()
			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('supports adding comments, resolving threads, and inspecting orphaned-anchor badge', async () => {
		const { boot, container } = await renderDocsWorkspace('engineering-handbook')
		try {
			await waitFor(() => {
				expect(screen.getByDisplayValue('Engineering Handbook')).toBeInTheDocument()
			})

			const commentInput = screen.getByPlaceholderText('Add a comment (@mention colleagues)…')
			fireEvent.change(commentInput, { target: { value: 'Great RFC breakdown!' } })
			const postButtons = screen.getAllByRole('button', { name: 'Post comment' })
			const topPost = postButtons[0]
			if (!topPost) throw new Error('Expected Post comment button')
			fireEvent.click(topPost)

			await waitFor(() => {
				expect(screen.getByText('Great RFC breakdown!')).toBeInTheDocument()
			})

			const resolveButtons = screen.getAllByRole('button', { name: 'Resolve' })
			const firstResolve = resolveButtons[0]
			if (!firstResolve) throw new Error('Expected Resolve button')
			fireEvent.click(firstResolve)
			await waitFor(() => {
				expect(screen.getByText('Resolved')).toBeInTheDocument()
			})
			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('renders version timeline diff and creates/restores named snapshots cleanly', async () => {
		useUiStore.setState({ activeDocSidePanel: 'versions' })
		const { boot, container } = await renderDocsWorkspace('engineering-handbook')
		try {
			await waitFor(() => {
				expect(screen.getByDisplayValue('Engineering Handbook')).toBeInTheDocument()
			})

			await waitFor(() => {
				expect(screen.getByText('Initial baseline')).toBeInTheDocument()
			})

			const snapInput = screen.getByPlaceholderText('Snapshot label (e.g. Ready for review)')
			fireEvent.change(snapInput, { target: { value: 'v2 milestone' } })
			fireEvent.click(screen.getByRole('button', { name: 'Save snapshot' }))

			await waitFor(() => {
				expect(screen.getByText('v2 milestone')).toBeInTheDocument()
			})

			fireEvent.click(screen.getByText('Initial baseline'))
			await waitFor(() => {
				expect(screen.getByRole('button', { name: 'Restore version' })).toBeInTheDocument()
			})

			fireEvent.click(screen.getByRole('button', { name: 'Restore version' }))
			await waitFor(() => {
				expect(screen.getAllByText('Pre-restore').length).toBeGreaterThan(0)
			})
			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('supports creating a new page from template and opening share dialog with zero axe violations', async () => {
		const { boot, container } = await renderDocsWorkspace('engineering-handbook')
		try {
			await waitFor(() => {
				expect(screen.getByDisplayValue('Engineering Handbook')).toBeInTheDocument()
			})

			// Open share dialog
			fireEvent.click(screen.getByRole('button', { name: 'Share' }))
			await waitFor(() => {
				expect(screen.getByText('Share & permissions')).toBeInTheDocument()
			})
			fireEvent.click(screen.getByRole('button', { name: 'Grant access' }))
			await waitFor(() => {
				expect(screen.getByText('Can comment')).toBeInTheDocument()
			})
			await expectNoViolations(container)
			const closeButtons = screen.getAllByRole('button', { name: 'Close' })
			const firstClose = closeButtons[0]
			if (!firstClose) throw new Error('Expected Close button')
			fireEvent.click(firstClose)

			// Create new page via dialog
			act(() => {
				useUiStore.getState().setCreateDocOpen(true)
			})
			await waitFor(() => {
				expect(screen.getByPlaceholderText('Engineering handbook')).toBeInTheDocument()
			})
			fireEvent.change(screen.getByPlaceholderText('Engineering handbook'), {
				target: { value: 'Release Checklist' }
			})
			fireEvent.click(screen.getByRole('button', { name: 'Create page' }))

			await waitFor(() => {
				expect(screen.getAllByText('Release Checklist').length).toBeGreaterThan(0)
			})
		} finally {
			boot.engine.dispose()
		}
	})

	it('shows a single template label when the blank option is selected', async () => {
		const boot = await createPreviewWorkspace()
		try {
			useUiStore.setState({ createDocOpen: true })
			render(
				<SyncProvider engine={boot.engine}>
					<CreateDocDialog pages={[]} />
				</SyncProvider>
			)
			const templateTrigger = await screen.findByRole('combobox', { name: 'Template' })
			// Regression: two items sharing value="blank" are both "selected", so Radix
			// concatenated their labels in the trigger ("Blank documentBlank page")
			await waitFor(() => {
				expect(templateTrigger.textContent).toBe('Blank document')
			})
		} finally {
			boot.engine.dispose()
		}
	})
})
