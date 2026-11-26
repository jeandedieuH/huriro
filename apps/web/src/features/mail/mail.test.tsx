import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { expectNoViolations } from '@/lib/test-setup'
import { WorkspaceProvider } from '@/lib/workspace'
import { MailSettingsPanel } from './components/mail-settings-panel'
import { MailWorkspace } from './components/mail-workspace'
import { useMailStore } from './store/mail-store'

activateI18n('en')

async function renderMailWorkspace() {
	const boot = await createPreviewWorkspace()
	const rendered = render(
		<TooltipProvider>
			<WorkspaceProvider boot={boot}>
				<SyncProvider engine={boot.engine}>
					<div className="h-screen">
						<MailWorkspace />
					</div>
				</SyncProvider>
			</WorkspaceProvider>
		</TooltipProvider>
	)
	return { boot, ...rendered }
}

async function renderMailSettings() {
	const boot = await createPreviewWorkspace()
	const rendered = render(
		<TooltipProvider>
			<WorkspaceProvider boot={boot}>
				<SyncProvider engine={boot.engine}>
					<MailSettingsPanel />
				</SyncProvider>
			</WorkspaceProvider>
		</TooltipProvider>
	)
	return { boot, ...rendered }
}

describe('MailWorkspace & Mail v2 parity', () => {
	beforeEach(() => {
		useMailStore.getState().reset()
	})

	it('supports tags, snippets, draft review gate, undo-send, contact context, compose, forward, split, and bulk triage with zero axe violations', async () => {
		const { boot, container } = await renderMailWorkspace()
		try {
			await waitFor(() => {
				expect(screen.getByText('Cannot export my workspace data')).toBeInTheDocument()
			})

			// Open seeded conversation.
			fireEvent.click(screen.getByText('Cannot export my workspace data'))
			await waitFor(() => {
				expect(screen.getByText(/when I click Export in settings nothing happens/)).toBeInTheDocument()
			})

			await expectNoViolations(container)

			// Add and apply a new tag on the open conversation.
			fireEvent.click(screen.getByRole('button', { name: 'Add tag' }))
			const tagInput = await screen.findByPlaceholderText('Tag name…')
			fireEvent.change(tagInput, { target: { value: 'urgent-billing' } })
			fireEvent.click(screen.getByRole('button', { name: 'Create tag' }))
			const tagsBar = screen.getByTestId('conversation-tags-bar')
			await waitFor(() => {
				expect(within(tagsBar).getByText('urgent-billing')).toBeInTheDocument()
			})

			// Insert rendered snippet into reply composer.
			fireEvent.click(screen.getByRole('button', { name: 'Insert snippet' }))
			const exportSnippet = await screen.findByRole('button', { name: /Export fix confirmation/ })
			fireEvent.click(exportSnippet)
			const replyBox = screen.getByPlaceholderText('Write a reply…') as HTMLTextAreaElement
			await waitFor(() => {
				expect(replyBox.value).toContain('we shipped a fix for workspace exports')
			})

			// Save draft -> request peer review -> send is gated -> approve -> send -> undo.
			fireEvent.click(screen.getByRole('button', { name: 'Save' }))
			const banner = await screen.findByTestId('draft-review-banner')
			fireEvent.click(within(banner).getByRole('button', { name: 'Request review' }))
			await waitFor(() => {
				expect(within(banner).getByText('Pending review')).toBeInTheDocument()
			})
			expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()

			fireEvent.click(within(banner).getByRole('button', { name: 'Approve draft' }))
			await waitFor(() => {
				expect(within(banner).getByText('Review approved')).toBeInTheDocument()
			})
			expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled()

			fireEvent.click(screen.getByRole('button', { name: 'Send' }))
			const undoBtn = await screen.findByRole('button', { name: 'Undo send' })
			fireEvent.click(undoBtn)
			await waitFor(() => {
				expect(screen.queryByRole('button', { name: 'Undo send' })).not.toBeInTheDocument()
			})

			// Contact context sidebar displays organization & saves notes.
			fireEvent.click(screen.getByRole('button', { name: 'Contact info' }))
			const sidebar = await screen.findByTestId('contact-context-sidebar')
			expect(within(sidebar).getByText('Acme Corp')).toBeInTheDocument()
			const notesBox = within(sidebar).getByLabelText('Notes') as HTMLTextAreaElement
			fireEvent.change(notesBox, { target: { value: 'VIP renewal due next month.' } })
			fireEvent.click(within(sidebar).getByRole('button', { name: 'Save contact' }))

			// Forward dialog creates a forwarded conversation draft.
			fireEvent.click(screen.getByRole('button', { name: 'Forward' }))
			const forwardDialog = await screen.findByRole('dialog')
			fireEvent.change(within(forwardDialog).getByLabelText('To'), {
				target: { value: 'vendor@partner.example' }
			})
			fireEvent.change(within(forwardDialog).getByLabelText('Message'), {
				target: { value: 'Please review the attached export failure.' }
			})
			fireEvent.click(within(forwardDialog).getByRole('button', { name: 'Create forward draft' }))
			await waitFor(() => {
				expect(screen.getAllByText(/Fwd: Cannot export my workspace data/).length).toBeGreaterThanOrEqual(1)
			})

			// Bulk triage selects conversations and marks them closed.
			const checkboxes = screen.getAllByRole('checkbox', { name: /Select conversation:/ })
			const firstCb = checkboxes[0]
			if (!firstCb) throw new Error('expected at least one conversation selection checkbox')
			fireEvent.click(firstCb)
			const bulkBar = await screen.findByTestId('bulk-triage-bar')
			expect(within(bulkBar).getByText('1 selected')).toBeInTheDocument()
			fireEvent.click(within(bulkBar).getByRole('button', { name: 'Close conversation' }))
			await waitFor(() => {
				expect(screen.queryByTestId('bulk-triage-bar')).not.toBeInTheDocument()
			})

			// Proactive compose dialog creates an outbound conversation.
			fireEvent.click(screen.getByRole('button', { name: 'New message' }))
			const composeDialog = await screen.findByRole('dialog')
			fireEvent.change(within(composeDialog).getByLabelText('To'), {
				target: { value: 'founder@newco.example' }
			})
			fireEvent.change(within(composeDialog).getByLabelText('Subject'), {
				target: { value: 'Proactive onboarding check-in' }
			})
			fireEvent.change(within(composeDialog).getByLabelText('Message'), {
				target: { value: 'Wanted to check how your migration is going.' }
			})
			fireEvent.click(within(composeDialog).getByRole('button', { name: 'Create draft' }))
			await waitFor(() => {
				expect(screen.getAllByText('Proactive onboarding check-in').length).toBeGreaterThanOrEqual(1)
			})
		} finally {
			boot.engine.dispose()
		}
		// Broad end-to-end workflow: full-suite parallelism can push it past 15s.
	}, 30_000)

	it('renders MailSettingsPanel v2 controls (private inbox, routing, SLA, snippets, macros) cleanly with zero axe violations', async () => {
		const { boot, container } = await renderMailSettings()
		try {
			await waitFor(() => {
				expect(screen.getByText('Round-robin routing')).toBeInTheDocument()
			})

			// Create a private inbox.
			fireEvent.change(screen.getByPlaceholderText('Inboxes'), { target: { value: 'Leadership' } })
			fireEvent.change(screen.getByLabelText('Visibility'), { target: { value: 'private' } })
			fireEvent.click(screen.getByRole('button', { name: 'Add inbox' }))
			await waitFor(() => {
				expect(screen.getAllByText('Leadership').length).toBeGreaterThanOrEqual(1)
			})

			// Save routing config.
			fireEvent.click(screen.getByRole('button', { name: 'Save routing' }))
			await waitFor(() => {
				expect(within(screen.getByRole('status')).getByText('Save routing')).toBeInTheDocument()
			})

			// Create SLA policy.
			fireEvent.change(screen.getByPlaceholderText('SLA policies & analytics'), {
				target: { value: 'Enterprise 15m' }
			})
			fireEvent.click(screen.getByRole('button', { name: 'Add SLA policy' }))
			await waitFor(() => {
				expect(screen.getAllByText('Enterprise 15m').length).toBeGreaterThanOrEqual(1)
			})

			// Create snippet & macro.
			fireEvent.change(screen.getByPlaceholderText('Snippet name'), {
				target: { value: 'Quick thanks' }
			})
			fireEvent.change(screen.getByPlaceholderText('Snippet body'), {
				target: { value: 'Thank you for writing in!' }
			})
			fireEvent.click(screen.getByRole('button', { name: 'Create snippet' }))
			await waitFor(() => {
				expect(screen.getAllByText(/Quick thanks/).length).toBeGreaterThanOrEqual(1)
			})

			fireEvent.change(screen.getByPlaceholderText('Macro name'), {
				target: { value: 'Auto close' }
			})
			fireEvent.click(screen.getByRole('button', { name: 'Create macro' }))
			await waitFor(() => {
				expect(screen.getAllByText('Auto close').length).toBeGreaterThanOrEqual(1)
			})

			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
		// This is a deliberately broad end-to-end workflow; 15s is flaky when the
		// full web suite runs all files in parallel on a busy developer machine.
	}, 30_000)
})
