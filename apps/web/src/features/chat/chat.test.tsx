import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { expectNoViolations } from '@/lib/test-setup'
import { WorkspaceProvider } from '@/lib/workspace'
import { ChatSidebarNav } from './components/chat-sidebar-nav'
import { ChatWorkspace } from './components/chat-workspace'
import { useChatStore } from './store/chat-store'

activateI18n('en')

async function renderChatWorkspace() {
	const boot = await createPreviewWorkspace()
	const rendered = render(
		<TooltipProvider>
			<WorkspaceProvider boot={boot}>
				<SyncProvider engine={boot.engine}>
					<div className="flex h-full">
						<ChatSidebarNav />
						<ChatWorkspace />
					</div>
				</SyncProvider>
			</WorkspaceProvider>
		</TooltipProvider>
	)
	return { boot, ...rendered }
}

describe('ChatWorkspace', () => {
	beforeEach(() => {
		useChatStore.getState().reset()
	})

	it('renders channels cleanly, switches channels, and sends messages with zero axe violations', async () => {
		const { boot, container } = await renderChatWorkspace()
		try {
			await waitFor(() => {
				expect(screen.getByText(/Welcome to Huriro M4!/)).toBeInTheDocument()
			})
			await expectNoViolations(container)

			// Switch to #engineering (initially 2 unread)
			const nav = screen.getByRole('navigation', { name: 'Chat' })
			fireEvent.click(within(nav).getByRole('button', { name: /^engineering/ }))
			await waitFor(() => {
				expect(
					screen.getByText('Partitioned channel sync feeds verified at 500 msgs/burst.')
				).toBeInTheDocument()
			})

			// Send a new message in #engineering
			const composer = screen.getByPlaceholderText(/Message #engineering/)
			fireEvent.change(composer, { target: { value: 'Shipped Gate G4 tests for issue:ENG-1' } })
			fireEvent.click(screen.getByRole('button', { name: 'Send' }))

			await waitFor(() => {
				expect(screen.getByText('Shipped Gate G4 tests for issue:ENG-1')).toBeInTheDocument()
			})
		} finally {
			boot.engine.dispose()
		}
	})

	it('opens threads, creates a new channel, and opens a direct message', async () => {
		const { boot, container } = await renderChatWorkspace()
		try {
			await waitFor(() => {
				expect(screen.getByText(/Welcome to Huriro M4!/)).toBeInTheDocument()
			})

			// Open thread panel from the first message
			const replyBtns = screen.getAllByRole('button', { name: 'Reply in thread' })
			const firstReplyBtn = replyBtns[0]
			if (!firstReplyBtn) throw new Error('expected at least one reply button')
			fireEvent.click(firstReplyBtn)
			const threadAside = await screen.findByLabelText('Thread')
			expect(threadAside).toBeInTheDocument()
			await expectNoViolations(container)

			const threadInput = screen.getByPlaceholderText('Reply in thread…')
			fireEvent.change(threadInput, { target: { value: 'Tracking in thread now.' } })
			const sendBtns = screen.getAllByRole('button', { name: 'Send' })
			const threadSendBtn = sendBtns.at(-1)
			if (!threadSendBtn) throw new Error('expected a thread send button')
			fireEvent.click(threadSendBtn)
			await waitFor(() => {
				expect(screen.getByText('Tracking in thread now.')).toBeInTheDocument()
			})

			// Create a channel
			fireEvent.click(screen.getByRole('button', { name: 'New channel' }))
			const chanNameInput = await screen.findByLabelText('Channel name')
			fireEvent.change(chanNameInput, { target: { value: 'release-ops' } })
			fireEvent.click(screen.getByRole('button', { name: 'Create channel' }))
			await waitFor(() => {
				expect(screen.getByRole('heading', { name: 'release-ops' })).toBeInTheDocument()
			})

			// Open a direct message with Ada Lovelace
			fireEvent.click(screen.getByRole('button', { name: 'New direct message' }))
			const adaCheckbox = await screen.findByRole('checkbox', { name: /Ada Lovelace/ })
			fireEvent.click(adaCheckbox)
			fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }))
			await waitFor(() => {
				expect(screen.getByRole('heading', { name: /Ada Lovelace/ })).toBeInTheDocument()
			})
		} finally {
			boot.engine.dispose()
		}
	})
})
