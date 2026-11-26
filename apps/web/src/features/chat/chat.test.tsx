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

async function selectTab(name: string) {
	const tab = await screen.findByRole('tab', { name })
	fireEvent.mouseDown(tab, { button: 0 })
	fireEvent.click(tab)
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

	it('pins a message, opens pins panel, jumps to message, unpins, and passes axe check', async () => {
		const { boot, container } = await renderChatWorkspace()
		try {
			await waitFor(() => {
				expect(screen.getByText(/Welcome to Huriro M4!/)).toBeInTheDocument()
			})

			const firstMsg =
				useChatStore.getState().messagesByChannel[useChatStore.getState().activeChannelId!]?.[0]
			if (!firstMsg) throw new Error('expected at least one message in default channel')

			const pinBtns = screen.getAllByRole('button', { name: 'Pin to channel' })
			const firstPinBtn = pinBtns[0]
			if (!firstPinBtn) throw new Error('expected a pin button on the first message')
			fireEvent.click(firstPinBtn)

			fireEvent.click(screen.getByRole('button', { name: 'Pinned messages' }))
			const pinsPanel = await screen.findByLabelText('Pinned messages', { selector: 'aside' })
			expect(pinsPanel).toBeInTheDocument()
			await waitFor(() => {
				expect(within(pinsPanel).getByText(firstMsg.bodyText)).toBeInTheDocument()
			})

			await expectNoViolations(container)

			// Jump to message from the pins panel and verify highlight class applies.
			fireEvent.click(within(pinsPanel).getByText(firstMsg.bodyText))
			await waitFor(() => {
				const highlighted = container.querySelector(`#msg-${firstMsg.id}`)
				expect(highlighted?.className).toContain('bg-accent/50')
			})

			// Unpin via the button inside the pins panel.
			const unpinBtn = within(pinsPanel).getByRole('button', { name: 'Unpin from channel' })
			fireEvent.click(unpinBtn)
			await waitFor(() => {
				expect(within(pinsPanel).queryByText(firstMsg.bodyText)).not.toBeInTheDocument()
			})
		} finally {
			boot.engine.dispose()
		}
	})

	it('updates status/DND, manages custom sidebar sections, and adds/removes channel bookmarks', async () => {
		const { boot, container } = await renderChatWorkspace()
		try {
			await waitFor(() => {
				expect(screen.getByText(/Welcome to Huriro M4!/)).toBeInTheDocument()
			})

			// Update status text
			fireEvent.click(screen.getByRole('button', { name: 'Set a status' }))
			const statusInput = await screen.findByLabelText('What is your status?')
			fireEvent.change(statusInput, { target: { value: 'In deep focus' } })
			fireEvent.submit(statusInput.closest('form')!)
			await waitFor(() => {
				expect(screen.getByText('In deep focus')).toBeInTheDocument()
				expect(screen.queryByLabelText('What is your status?')).not.toBeInTheDocument()
			})

			// Enable 1h DND
			fireEvent.click(screen.getByRole('button', { name: 'Set a status' }))
			fireEvent.click(await screen.findByRole('button', { name: '1h DND' }))
			await waitFor(() => {
				expect(screen.getByText('DND')).toBeInTheDocument()
				expect(screen.queryByLabelText('What is your status?')).not.toBeInTheDocument()
			})

			// Create custom sidebar section
			fireEvent.click(screen.getByRole('button', { name: 'New section' }))
			const secInput = await screen.findByLabelText('Section name')
			fireEvent.change(secInput, { target: { value: 'Priority' } })
			fireEvent.submit(secInput.closest('form')!)
			await waitFor(() => {
				expect(screen.getByRole('heading', { name: 'Priority' })).toBeInTheDocument()
				expect(screen.queryByLabelText('Section name')).not.toBeInTheDocument()
			})

			// Add and remove channel bookmark
			fireEvent.click(screen.getByRole('button', { name: 'Add bookmark' }))
			const bmTitle = await screen.findByPlaceholderText('Title')
			const bmUrl = await screen.findByPlaceholderText('https://... or /docs/...')
			fireEvent.change(bmTitle, { target: { value: 'Release checklist' } })
			fireEvent.change(bmUrl, { target: { value: '/docs/handbook' } })
			const bmForm = bmTitle.closest('form')!
			fireEvent.submit(bmForm)
			await waitFor(() => {
				expect(screen.getByRole('button', { name: 'Release checklist' })).toBeInTheDocument()
			})

			const checklistPill = screen.getByRole('button', { name: 'Release checklist' }).parentElement!
			fireEvent.click(within(checklistPill).getByRole('button', { name: 'Remove bookmark' }))
			await waitFor(() => {
				expect(screen.queryByRole('button', { name: 'Release checklist' })).not.toBeInTheDocument()
			})

			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('uses formatting, autocomplete, interactive polls, and broadcast thread replies', async () => {
		const { boot, container } = await renderChatWorkspace()
		try {
			// Wait for PollCard (after channel polls finish loading asynchronously)
			const optBtn = await screen.findByRole('button', { name: /Keyboard shortcuts/ })
			expect(screen.getByText('Which Sprint M11 polish item next?')).toBeInTheDocument()

			// Cast a vote on the seeded poll
			fireEvent.click(optBtn)
			await waitFor(() => {
				expect(optBtn).toHaveAttribute('aria-pressed', 'true')
			})

			// Create a new poll via the poll dialog
			fireEvent.click(screen.getByRole('button', { name: 'Create poll' }))
			const dialog = await screen.findByRole('dialog')
			fireEvent.change(within(dialog).getByLabelText('Question'), {
				target: { value: 'Deploy window?' }
			})
			fireEvent.change(within(dialog).getByLabelText('Option 1'), { target: { value: 'Morning' } })
			fireEvent.change(within(dialog).getByLabelText('Option 2'), { target: { value: 'Evening' } })
			fireEvent.click(within(dialog).getByRole('button', { name: 'Create poll' }))
			await waitFor(() => {
				expect(screen.getByText('Deploy window?')).toBeInTheDocument()
			})

			// Formatting toolbar & slash autocomplete
			const composer = screen.getByPlaceholderText(/Message #general/) as HTMLTextAreaElement
			fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
			expect(composer.value).toContain('**')
			fireEvent.change(composer, { target: { value: '/po', selectionStart: 3 } })
			fireEvent.keyUp(composer)
			await waitFor(() => {
				expect(screen.getByRole('listbox')).toBeInTheDocument()
				expect(
					within(screen.getByRole('listbox')).getByRole('option', { name: /\/poll/ })
				).toBeInTheDocument()
			})

			// Broadcast a thread reply back to the channel
			fireEvent.click(screen.getAllByRole('button', { name: 'Reply in thread' })[0]!)
			const broadcastCb = await screen.findByRole('checkbox', { name: 'Also send to channel' })
			fireEvent.click(broadcastCb)
			const threadInput = screen.getByPlaceholderText('Reply in thread…')
			fireEvent.change(threadInput, { target: { value: 'Broadcasting thread update!' } })
			const sendBtns = screen.getAllByRole('button', { name: 'Send' })
			fireEvent.click(sendBtns.at(-1)!)
			await waitFor(() => {
				expect(screen.getAllByText('Broadcasting thread update!').length).toBeGreaterThanOrEqual(1)
				expect(screen.getAllByText('Also sent to channel').length).toBeGreaterThanOrEqual(1)
			})

			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('quotes, forwards, manages huddles, and passes axe checks across Later, Drafts, and Groups views', async () => {
		const { boot, container } = await renderChatWorkspace()
		try {
			await waitFor(() => {
				expect(screen.getByText(/Welcome to Huriro M4!/)).toBeInTheDocument()
			})

			// Quote the first message
			fireEvent.click(screen.getAllByRole('button', { name: 'Quote message' })[0]!)
			expect(screen.getByText(/Quoting/)).toBeInTheDocument()
			const composer = screen.getByPlaceholderText(/Message #general/)
			fireEvent.change(composer, { target: { value: 'Following up on this' } })
			fireEvent.click(screen.getByRole('button', { name: 'Send' }))
			await waitFor(() => {
				expect(screen.getByText('Following up on this')).toBeInTheDocument()
			})

			// Forward a message
			fireEvent.click(screen.getAllByRole('button', { name: 'Forward message' })[0]!)
			const forwardDialog = await screen.findByRole('dialog')
			fireEvent.change(within(forwardDialog).getByLabelText('Add an optional note'), {
				target: { value: 'FYI team' }
			})
			fireEvent.click(within(forwardDialog).getByRole('button', { name: 'Forward' }))
			await waitFor(() => {
				expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
			})

			// Start & end huddle
			fireEvent.click(screen.getByRole('button', { name: 'Start huddle' }))
			await waitFor(() => {
				expect(screen.getByRole('button', { name: 'End huddle' })).toBeInTheDocument()
			})
			fireEvent.click(screen.getByRole('button', { name: 'End huddle' }))
			await waitFor(() => {
				expect(screen.getByRole('button', { name: 'Start huddle' })).toBeInTheDocument()
			})

			// Schedule a message and cancel it from Drafts & sent
			fireEvent.change(screen.getByPlaceholderText(/Message #general/), {
				target: { value: 'Standup reminder tomorrow' }
			})
			fireEvent.click(screen.getByRole('button', { name: 'Schedule send' }))
			fireEvent.click(await screen.findByRole('button', { name: 'In 1 hour' }))
			await waitFor(() => {
				expect(screen.queryByRole('button', { name: 'In 1 hour' })).not.toBeInTheDocument()
			})

			const nav = screen.getByRole('navigation', { name: 'Chat' })
			fireEvent.click(within(nav).getByRole('button', { name: /Drafts & sent/ }))
			await selectTab('Scheduled')
			await waitFor(() => {
				expect(screen.getByText('Standup reminder tomorrow')).toBeInTheDocument()
			})
			await expectNoViolations(container)
			fireEvent.click(screen.getAllByRole('button', { name: 'Cancel scheduled message' })[0]!)
			await waitFor(() => {
				expect(screen.getAllByText('cancelled').length).toBeGreaterThanOrEqual(1)
			})

			// Navigate to Later view and add a reminder
			fireEvent.click(within(nav).getByRole('button', { name: /Later/ }))
			const reminderInput = await screen.findByLabelText('Add a personal reminder…')
			fireEvent.change(reminderInput, { target: { value: 'Review security audit' } })
			fireEvent.click(screen.getByRole('button', { name: 'Add reminder' }))
			await waitFor(() => {
				expect(screen.getByText('Review security audit')).toBeInTheDocument()
			})
			await expectNoViolations(container)

			// Navigate to Groups & emoji view and create a user group
			fireEvent.click(within(nav).getByRole('button', { name: /Groups & emoji/ }))
			fireEvent.change(await screen.findByLabelText('Handle'), { target: { value: 'qa' } })
			fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'QA Team' } })
			fireEvent.click(screen.getByRole('button', { name: 'Create group' }))
			await waitFor(() => {
				expect(screen.getByText('@qa')).toBeInTheDocument()
				expect(screen.getByText('QA Team')).toBeInTheDocument()
			})
			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('catches up missed active-channel messages and refreshes unread counts on handleResume', async () => {
		const boot = await createPreviewWorkspace()
		try {
			await useChatStore.getState().loadChannels(boot.api)
			const activeId = useChatStore.getState().activeChannelId
			expect(activeId).toBeTruthy()
			if (!activeId) return

			const beforeRev = useChatStore.getState().channels.find((c) => c.id === activeId)?.lastRev ?? 0
			const callOrder: string[] = []
			let seenSinceRev = -1
			const missedMsg = {
				id: '0190a0b1-0000-7000-8000-000000009999',
				workspaceId: boot.engine.workspaceId,
				channelId: activeId,
				channelSeq: 99,
				threadSeq: null,
				rev: beforeRev + 1,
				authorType: 'user' as const,
				authorId: '0190a0b1-0000-7000-8000-000000000099',
				threadParentId: null,
				broadcastToChannel: false,
				replyToMessageId: null,
				messageKind: 'text' as const,
				metadata: null,
				replyCount: 0,
				lastReplyAt: null,
				clientId: null,
				body: {
					type: 'doc',
					content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Missed while asleep' }] }]
				},
				bodyText: 'Missed while asleep',
				reactions: [],
				attachments: [],
				linkPreviews: [],
				richLinks: [],
				editedAt: null,
				deletedAt: null,
				createdAt: '2026-11-26T18:00:00Z',
				updatedAt: '2026-11-26T18:00:00Z',
				version: 1
			}
			const existingChannels = useChatStore.getState().channels
			const wrappedApi = {
				...boot.api,
				async listChannelChanges(channelId: string, sinceRev: number) {
					callOrder.push('listChannelChanges')
					seenSinceRev = sinceRev
					if (channelId === activeId && sinceRev === beforeRev) {
						return {
							changes: [missedMsg],
							nextRev: beforeRev + 1,
							lastMsgSeq: 99,
							hasMore: false
						}
					}
					return { changes: [], nextRev: sinceRev, lastMsgSeq: 99, hasMore: false }
				},
				async listChannels() {
					callOrder.push('listChannels')
					return existingChannels.map((c) =>
						c.id === activeId
							? { ...c, lastRev: beforeRev + 1, lastMsgSeq: 99, unreadCount: 1, hasUnread: true }
							: c
					)
				},
				async markChannelRead(channelId: string, seq: number) {
					callOrder.push('markChannelRead')
					return { channelId, lastReadSeq: seq, unreadCount: 0 }
				}
			}

			await useChatStore.getState().handleResume(wrappedApi)

			expect(callOrder[0]).toBe('listChannelChanges')
			expect(callOrder[1]).toBe('listChannels')
			expect(callOrder[2]).toBe('markChannelRead')
			expect(seenSinceRev).toBe(beforeRev)
			expect(
				useChatStore.getState().messagesByChannel[activeId]?.some((m) => m.bodyText === 'Missed while asleep')
			).toBe(true)
			const updatedActive = useChatStore.getState().channels.find((c) => c.id === activeId)
			expect(updatedActive?.unreadCount).toBe(0)
			expect(updatedActive?.lastReadSeq).toBe(99)
		} finally {
			boot.engine.dispose()
		}
	})
})
