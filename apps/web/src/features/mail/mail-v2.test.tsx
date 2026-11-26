import { activateI18n, t } from '@huriro/i18n'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPreviewWorkspace } from '@/lib/preview-workspace'
import { expectNoViolations } from '@/lib/test-setup'
import { WorkspaceProvider } from '@/lib/workspace'
import { MailSettingsPanel } from './components/mail-settings-panel'
import { MailWorkspace } from './components/mail-workspace'
import { useMailStore } from './store/mail-store'

async function selectConversationBySubject(subject: string) {
	const btn = await screen.findByRole('button', { name: new RegExp(subject) })
	fireEvent.click(btn)
	await screen.findByRole('heading', { name: subject })
}

async function renderMailWorkspace() {
	const boot = await createPreviewWorkspace()
	const rendered = render(
		<WorkspaceProvider boot={boot}>
			<MailWorkspace />
		</WorkspaceProvider>
	)
	await selectConversationBySubject('Cannot export my workspace data')
	return { boot, ...rendered }
}

describe('Mail v2 full workflow & UI parity', () => {
	beforeEach(() => {
		activateI18n('en')
		useMailStore.getState().reset()
	})

	it('supports Send Later scheduling + cancel and Follow-up reminder badges', async () => {
		await renderMailWorkspace()

		const replyBox = screen.getByPlaceholderText('Write a reply…')
		fireEvent.change(replyBox, { target: { value: 'Sending this in three hours.' } })

		fireEvent.click(screen.getByRole('button', { name: 'Send later' }))
		fireEvent.click(await screen.findByRole('button', { name: 'Later today (+3h)' }))

		const banner = await screen.findByTestId('scheduled-send-banner')
		expect(banner.textContent).toContain('Scheduled for')
		fireEvent.click(within(banner).getByRole('button', { name: 'Cancel scheduled send' }))
		await waitFor(() => {
			expect(screen.queryByTestId('scheduled-send-banner')).toBeNull()
		})

		fireEvent.click(screen.getByRole('button', { name: 'Follow up' }))
		fireEvent.click(await screen.findByRole('button', { name: 'In 2 days' }))
		await screen.findByText(/Follow up ·/)
	})

	it('supports outbound Compose Cc/Bcc, contact autocomplete, and file attachments', async () => {
		await renderMailWorkspace()

		fireEvent.click(screen.getByRole('button', { name: 'New message' }))
		const dialog = await screen.findByRole('dialog')

		fireEvent.click(within(dialog).getByRole('button', { name: 'Cc / Bcc' }))
		expect(within(dialog).getByLabelText('Cc')).toBeTruthy()
		expect(within(dialog).getByLabelText('Bcc')).toBeTruthy()

		const toInput = within(dialog).getByLabelText('To')
		fireEvent.focus(toInput)
		fireEvent.change(toInput, { target: { value: 'acme' } })
		const suggestion = await within(dialog).findByRole('option', {
			name: /customer@acme\.example/
		})
		fireEvent.mouseDown(suggestion)
		expect(within(dialog).getByText('Acme Customer <customer@acme.example>')).toBeTruthy()

		const fileInput = within(dialog).getByLabelText('Attach file') as HTMLInputElement
		const file = new File(['hello attachment'], 'report.txt', { type: 'text/plain' })
		fireEvent.change(fileInput, { target: { files: [file] } })
		await within(dialog).findByText('report.txt')

		fireEvent.change(within(dialog).getByLabelText('Subject'), {
			target: { value: 'Q1 Onboarding Pack' }
		})
		fireEvent.change(within(dialog).getByLabelText('Message'), {
			target: { value: 'Attached is the onboarding report.' }
		})
		fireEvent.click(within(dialog).getByRole('button', { name: 'Create draft' }))

		await screen.findByRole('heading', { name: 'Q1 Onboarding Pack' })
	})

	it('supports inline ;shortcut snippet autocomplete and lazy collaborative draft editing', async () => {
		await renderMailWorkspace()

		const replyBox = screen.getByPlaceholderText('Write a reply…') as HTMLTextAreaElement
		fireEvent.change(replyBox, { target: { value: 'Checking ;exp' } })

		const listbox = await screen.findByRole('listbox', { name: 'Snippets & templates' })
		const option = within(listbox).getByRole('option', { name: /Export fix confirmation/ })
		fireEvent.click(option)

		await waitFor(() => {
			expect((screen.getByPlaceholderText('Write a reply…') as HTMLTextAreaElement).value).toContain(
				'we shipped a fix for workspace exports'
			)
		})

		fireEvent.click(screen.getByRole('button', { name: 'Enable collaborative draft' }))
		const collab = await screen.findByTestId('mail-draft-collab-editor')
		expect(within(collab).getByText('Collab preview')).toBeTruthy()
		expect(within(collab).getByText('Collab ready')).toBeTruthy()
	})

	it('filters conversations by tag strip and handles mail keyboard shortcuts safely', async () => {
		await renderMailWorkspace()

		fireEvent.click(screen.getByRole('button', { name: 'Filter by tag vip' }))
		await waitFor(() => {
			expect(screen.queryByRole('button', { name: /Cannot export my workspace data/ })).toBeNull()
			expect(screen.getByRole('button', { name: /Annual seat renewal question/ })).toBeTruthy()
		})

		fireEvent.click(screen.getByRole('button', { name: 'All tags' }))
		await selectConversationBySubject('Cannot export my workspace data')

		// Typing in an input must ignore single-key shortcuts even when bubbling to window.
		const searchInput = screen.getByLabelText('Search conversations…')
		fireEvent.keyDown(searchInput, { key: 'c', bubbles: true })
		expect(screen.queryByRole('dialog')).toBeNull()

		// Pressing c on window opens New outbound email dialog.
		fireEvent.keyDown(window, { key: 'c' })
		const composeDialog = await screen.findByRole('dialog')
		expect(within(composeDialog).getByText('New outbound email')).toBeTruthy()
		fireEvent.click(within(composeDialog).getByRole('button', { name: t('chat.pins.close') }))
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

		// Pressing n switches composer to internal note.
		fireEvent.keyDown(window, { key: 'n' })
		await screen.findByRole('button', { name: 'Save note' })

		// Pressing f opens Forward conversation dialog.
		fireEvent.keyDown(window, { key: 'f' })
		const forwardDialog = await screen.findByRole('dialog')
		expect(within(forwardDialog).getByText('Forward conversation')).toBeTruthy()
		fireEvent.click(within(forwardDialog).getByRole('button', { name: 'Clear' }))
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

		// Pressing e closes the active conversation.
		fireEvent.keyDown(window, { key: 'e' })
		await screen.findByRole('button', { name: 'Reopen' })
	})

	it('navigates contact history, edits organization inline, and uses guarded AI Copilot with zero axe violations', async () => {
		const { container } = await renderMailWorkspace()

		fireEvent.click(screen.getByRole('button', { name: 'Contact info' }))
		const sidebar = await screen.findByTestId('contact-context-sidebar')
		expect(within(sidebar).getByText('Acme Corp')).toBeTruthy()
		expect(within(sidebar).getByText('Previous conversations')).toBeTruthy()
		expect(within(sidebar).getByText('Annual seat renewal question')).toBeTruthy()
		expect(within(sidebar).getByText('Linked Huriro work')).toBeTruthy()

		fireEvent.click(within(sidebar).getByRole('button', { name: 'Edit organization' }))
		fireEvent.change(within(sidebar).getByLabelText('Organization name'), {
			target: { value: 'Acme Global' }
		})
		fireEvent.click(within(sidebar).getByRole('button', { name: 'Save organization' }))
		await within(sidebar).findByText('Acme Global')

		fireEvent.click(screen.getByRole('button', { name: 'AI assist' }))
		const aiPanel = await screen.findByTestId('mail-ai-copilot-panel')
		expect(
			within(aiPanel).getByText('AI drafts require human review and never send email automatically.')
		).toBeTruthy()

		fireEvent.click(within(aiPanel).getByRole('button', { name: 'Summarize thread' }))
		await within(aiPanel).findByText(/Next step: confirm resolution/)

		fireEvent.click(within(aiPanel).getByRole('button', { name: 'Suggest reply' }))
		const insertBtn = await within(aiPanel).findByRole('button', { name: 'Insert into draft' })
		fireEvent.click(insertBtn)
		await waitFor(() => {
			expect((screen.getByPlaceholderText('Write a reply…') as HTMLTextAreaElement).value).toContain(
				'Thanks for following up'
			)
		})
		// Guardrail: inserting an AI draft never triggers an immediate or undoable send.
		expect(screen.queryByRole('button', { name: 'Undo send' })).toBeNull()

		fireEvent.click(within(aiPanel).getByRole('button', { name: 'Suggest tags' }))
		const applyTagBtn = await within(aiPanel).findByRole('button', { name: 'Apply vip' })
		fireEvent.click(applyTagBtn)

		await expectNoViolations(container)

		fireEvent.click(within(sidebar).getByRole('button', { name: /Annual seat renewal question/ }))
		await screen.findByRole('heading', { name: 'Annual seat renewal question' })
	})

	it('manages jmap provider, split-inbox tabs, and SLA/snippet/macro edit & delete in MailSettingsPanel', async () => {
		const boot = await createPreviewWorkspace()
		const { container } = render(
			<WorkspaceProvider boot={boot}>
				<MailSettingsPanel />
			</WorkspaceProvider>
		)

		await screen.findByText('First reply in 1h')
		await screen.findByText(/Export fix confirmation/)

		// Verify jmap provider is offered in the provider dropdown.
		const providerTrigger = screen.getByLabelText('Provider')
		fireEvent.keyDown(providerTrigger, { key: 'ArrowDown' })
		await screen.findByRole('option', { name: 'jmap' })
		fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

		// Create & remove a split-inbox tab.
		fireEvent.change(screen.getByLabelText('Tab name (e.g. VIP, Bugs)'), {
			target: { value: 'VIP Queue' }
		})
		fireEvent.click(screen.getByRole('button', { name: 'Add split tab' }))
		const removeTabBtn = await screen.findByRole('button', { name: 'Remove tab: VIP Queue' })
		fireEvent.click(removeTabBtn)
		await waitFor(() => {
			expect(screen.queryByRole('button', { name: 'Remove tab: VIP Queue' })).toBeNull()
		})

		// Edit then delete an SLA policy.
		fireEvent.click(screen.getByRole('button', { name: 'Edit: First reply in 1h' }))
		fireEvent.change(screen.getByLabelText('SLA policies & analytics'), {
			target: { value: 'VIP 30m SLA' }
		})
		fireEvent.click(screen.getByRole('button', { name: 'Update SLA policy' }))
		const delSlaBtn = await screen.findByRole('button', { name: 'Delete: VIP 30m SLA' })
		fireEvent.click(delSlaBtn)
		await waitFor(() => {
			expect(screen.queryByRole('button', { name: 'Delete: VIP 30m SLA' })).toBeNull()
		})

		// Edit then delete a snippet.
		fireEvent.click(screen.getByRole('button', { name: 'Edit: Export fix confirmation' }))
		fireEvent.change(screen.getByLabelText('Snippet name'), {
			target: { value: 'Export fixed v2' }
		})
		fireEvent.click(screen.getByRole('button', { name: 'Update snippet' }))
		const delTplBtn = await screen.findByRole('button', { name: 'Delete: Export fixed v2' })
		fireEvent.click(delTplBtn)
		await waitFor(() => {
			expect(screen.queryByRole('button', { name: 'Delete: Export fixed v2' })).toBeNull()
		})

		// Edit then delete a macro.
		fireEvent.click(screen.getByRole('button', { name: 'Edit: Resolve & tag billing' }))
		fireEvent.change(screen.getByLabelText('Macro name'), {
			target: { value: 'Close billing quick' }
		})
		fireEvent.click(screen.getByRole('button', { name: 'Update macro' }))
		const delMacroBtn = await screen.findByRole('button', { name: 'Delete: Close billing quick' })
		fireEvent.click(delMacroBtn)
		await waitFor(() => {
			expect(screen.queryByRole('button', { name: 'Delete: Close billing quick' })).toBeNull()
		})

		await expectNoViolations(container)
	})
})
