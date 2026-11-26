import { activateI18n, t } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { expectNoViolations } from '@/lib/test-setup'
import { WorkspaceProvider } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'
import { ChatSidebarHeaderAction, ChatSidebarNav } from './components/chat-sidebar-nav'
import { useChatStore } from './store/chat-store'

activateI18n('en')

describe('ChatSidebarNav redesign', () => {
	beforeEach(() => {
		useChatStore.getState().reset()
		useUiStore.setState({ toasts: [] })
	})

	it('renders standalone without outer TooltipProvider or WorkspaceProvider with zero axe violations', async () => {
		const boot = await createPreviewWorkspace()
		const { container } = render(
			<SyncProvider engine={boot.engine}>
				<ChatSidebarNav />
			</SyncProvider>
		)
		try {
			expect(screen.getByRole('navigation', { name: t('nav.chat') })).toBeInTheDocument()
			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('renders collapsed rail mode cleanly with zero axe violations', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const { container } = render(
				<TooltipProvider>
					<WorkspaceProvider boot={boot}>
						<SyncProvider engine={boot.engine}>
							<ChatSidebarNav collapsed />
						</SyncProvider>
					</WorkspaceProvider>
				</TooltipProvider>
			)

			await screen.findByRole('button', { name: /engineering/i })
			expect(screen.getByRole('button', { name: t('chat.sidebar.threads') })).toBeInTheDocument()
			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('filters channels & DMs, shows empty match message, and clears with Escape', async () => {
		const boot = await createPreviewWorkspace()
		try {
			render(
				<TooltipProvider>
					<WorkspaceProvider boot={boot}>
						<SyncProvider engine={boot.engine}>
							<ChatSidebarNav />
						</SyncProvider>
					</WorkspaceProvider>
				</TooltipProvider>
			)

			await screen.findByRole('button', { name: /^engineering/ })
			const filter = screen.getByRole('textbox', { name: t('chat.sidebar.filter-label') })
			fireEvent.change(filter, { target: { value: 'engineering' } })
			expect(screen.getByRole('button', { name: /^engineering/ })).toBeInTheDocument()
			expect(screen.queryByRole('button', { name: t('chat.sidebar.threads') })).not.toBeInTheDocument()

			fireEvent.change(filter, { target: { value: 'zzzz-no-match' } })
			expect(screen.getByText('No matches for “zzzz-no-match”.')).toBeInTheDocument()

			fireEvent.keyDown(filter, { key: 'Escape' })
			await waitFor(() =>
				expect(screen.getByRole('button', { name: t('chat.sidebar.threads') })).toBeInTheDocument()
			)
		} finally {
			boot.engine.dispose()
		}
	})

	it('supports channel actions: mark read, mute/unmute, move/remove section, members, and copy link', async () => {
		const boot = await createPreviewWorkspace()
		const writeText = vi.fn().mockResolvedValue(undefined)
		const prevClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
		Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

		try {
			render(
				<TooltipProvider>
					<WorkspaceProvider boot={boot}>
						<SyncProvider engine={boot.engine}>
							<ChatSidebarHeaderAction />
							<ChatSidebarNav />
						</SyncProvider>
					</WorkspaceProvider>
				</TooltipProvider>
			)

			await screen.findByRole('button', { name: /^engineering/ })
			const engChannel = useChatStore.getState().channels.find((c) => c.name === 'engineering')
			if (!engChannel) throw new Error('Expected engineering channel')

			const openEngMenu = () => {
				const btn = screen.getByRole('button', { name: /^engineering/ })
				const trigger = btn.parentElement?.querySelector<HTMLButtonElement>(
					`button[aria-label="${t('chat.sidebar.channel-actions')}"]`
				)
				if (!trigger) throw new Error('Expected engineering actions trigger')
				fireEvent.keyDown(trigger, { key: 'Enter' })
			}

			// Mark as read (engineering starts with unreadCount > 0 in preview)
			openEngMenu()
			const markReadItem = screen.queryByRole('menuitem', { name: t('chat.sidebar.mark-read') })
			if (markReadItem) {
				fireEvent.click(markReadItem)
				await waitFor(() => {
					const updated = useChatStore.getState().channels.find((c) => c.id === engChannel.id)
					expect(updated?.unreadCount).toBe(0)
				})
			}

			// Mute and unmute
			openEngMenu()
			fireEvent.click(await screen.findByRole('menuitem', { name: t('chat.sidebar.mute') }))
			await waitFor(() => {
				expect(useChatStore.getState().channels.find((c) => c.id === engChannel.id)?.muted).toBe(true)
			})
			openEngMenu()
			fireEvent.click(await screen.findByRole('menuitem', { name: t('chat.sidebar.unmute') }))
			await waitFor(() => {
				expect(useChatStore.getState().channels.find((c) => c.id === engChannel.id)?.muted).toBe(false)
			})

			// Create a custom section and move engineering into it, then remove it
			await useChatStore.getState().createSidebarSection(boot.api, { name: 'Pinned Channels' })
			await screen.findByRole('heading', { name: 'Pinned Channels' })

			openEngMenu()
			fireEvent.click(await screen.findByRole('menuitem', { name: 'Pinned Channels' }))
			await waitFor(() => {
				const sec = useChatStore.getState().sidebarSections.find((s) => s.name === 'Pinned Channels')
				expect(sec?.items?.some((item) => item.channelId === engChannel.id)).toBe(true)
			})

			const movedEngButton = await screen.findByRole('button', { name: /^engineering/ })
			const movedTrigger = movedEngButton.parentElement?.querySelector<HTMLButtonElement>(
				`button[aria-label="${t('chat.sidebar.channel-actions')}"]`
			)
			if (!movedTrigger) throw new Error('Expected moved engineering menu trigger')
			fireEvent.keyDown(movedTrigger, { key: 'Enter' })
			fireEvent.click(await screen.findByRole('menuitem', { name: t('chat.sidebar.section-remove-channel') }))
			await waitFor(() => {
				const sec = useChatStore.getState().sidebarSections.find((s) => s.name === 'Pinned Channels')
				expect(sec?.items?.some((item) => item.channelId === engChannel.id)).toBe(false)
			})

			// Copy link and open members
			openEngMenu()
			fireEvent.click(await screen.findByRole('menuitem', { name: t('chat.sidebar.copy-link') }))
			await waitFor(() => {
				expect(writeText).toHaveBeenCalledWith(
					`${window.location.origin}/chat?channel=${encodeURIComponent(engChannel.id)}`
				)
			})

			openEngMenu()
			fireEvent.click(await screen.findByRole('menuitem', { name: t('chat.sidebar.members') }))
			expect(useChatStore.getState().membersDialogOpen).toBe(true)

			// Quick compose header menu
			fireEvent.keyDown(screen.getByRole('button', { name: t('chat.sidebar.quick-compose') }), {
				key: 'Enter'
			})
			fireEvent.click(await screen.findByRole('menuitem', { name: t('chat.sidebar.new-channel') }))
			expect(useChatStore.getState().createChannelOpen).toBe(true)
		} finally {
			if (prevClipboard) Object.defineProperty(navigator, 'clipboard', prevClipboard)
			else Reflect.deleteProperty(navigator, 'clipboard')
			boot.engine.dispose()
		}
	})
})
