import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MailWorkspace } from '@/features/mail/components/mail-workspace'
import { useMailStore } from '@/features/mail/store/mail-store'
import { destinationFromPathname, registerAppNavigator, registerMailNavigator } from '@/lib/navigation'
import { createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { expectNoViolations } from '@/lib/test-setup'
import { WorkspaceProvider } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'
import { InboxSidebarFooterUtility, InboxSidebarNav } from './components/inbox-sidebar-nav'

activateI18n('en')

describe('Unified Inbox & Shared Mail navigation', () => {
	beforeEach(() => {
		useUiStore.setState({
			destination: 'inbox',
			sidebarLevel: 'feature',
			inboxFilter: 'unread',
			inboxPane: 'notifications'
		})
		useMailStore.getState().reset()
	})

	afterEach(() => {
		registerAppNavigator(null)
		registerMailNavigator(null)
	})

	it('maps both /inbox and /mail routes to the inbox destination', () => {
		expect(destinationFromPathname('/inbox')).toBe('inbox')
		expect(destinationFromPathname('/mail')).toBe('inbox')
		expect(destinationFromPathname('/mail/conv-1')).toBe('inbox')
	})

	it('renders personal filters and live shared inboxes in InboxSidebarNav, switches panes cleanly, and passes axe', async () => {
		const boot = await createPreviewWorkspace()
		const appNavigator = vi.fn()
		const mailNavigator = vi.fn()
		registerAppNavigator(appNavigator)
		registerMailNavigator(mailNavigator)

		try {
			const { container } = render(
				<SyncProvider engine={boot.engine}>
					<WorkspaceProvider boot={boot}>
						<TooltipProvider>
							<InboxSidebarNav />
							<InboxSidebarFooterUtility />
						</TooltipProvider>
					</WorkspaceProvider>
				</SyncProvider>
			)

			expect(screen.getByRole('button', { name: /Unread/i })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: /All notifications/i })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: /Assigned to me/i })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: /Mentions/i })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: /Archived/i })).toBeInTheDocument()

			await waitFor(() => {
				expect(screen.getByRole('button', { name: /Support/i })).toBeInTheDocument()
			})
			expect(screen.getByRole('button', { name: /All mail/i })).toBeInTheDocument()
			expect(screen.queryByText('Coming soon')).not.toBeInTheDocument()
			expect(screen.queryByText('Shared inboxes')).not.toBeInTheDocument()

			fireEvent.click(screen.getByRole('button', { name: /Support/i }))
			expect(useUiStore.getState().inboxPane).toBe('mail')
			expect(mailNavigator).toHaveBeenCalledTimes(1)
			expect(useMailStore.getState().activeInboxId).toBeTruthy()

			fireEvent.click(screen.getByRole('button', { name: /Unread/i }))
			expect(useUiStore.getState().inboxPane).toBe('notifications')
			expect(useUiStore.getState().inboxFilter).toBe('unread')
			expect(appNavigator).toHaveBeenCalledWith('inbox')

			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('renders MailWorkspace without a duplicate sidebar and exposes view filters with zero axe violations', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const { container } = render(
				<SyncProvider engine={boot.engine}>
					<WorkspaceProvider boot={boot}>
						<MailWorkspace />
					</WorkspaceProvider>
				</SyncProvider>
			)

			await waitFor(() => {
				expect(screen.getByText('Cannot export my workspace data')).toBeInTheDocument()
			})

			expect(container.querySelector('aside')).toBeNull()

			expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: 'Unassigned' })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: 'Assigned to me' })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: 'Snoozed' })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: 'Closed' })).toBeInTheDocument()

			fireEvent.click(screen.getByRole('button', { name: 'Unassigned' }))
			await waitFor(() => {
				expect(useMailStore.getState().activeView).toBe('unassigned')
			})

			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})
})
