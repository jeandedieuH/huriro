import { activateI18n, t } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useMailStore } from '@/features/mail/store/mail-store'
import { registerAppNavigator, registerMailNavigator } from '@/lib/navigation'
import { createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { expectNoViolations } from '@/lib/test-setup'
import { WorkspaceProvider } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'
import {
	InboxSidebarFooterUtility,
	InboxSidebarHeaderAction,
	InboxSidebarNav
} from './components/inbox-sidebar-nav'

activateI18n('en')

describe('InboxSidebarNav redesign', () => {
	beforeEach(() => {
		useUiStore.setState({
			destination: 'inbox',
			inboxFilter: 'unread',
			inboxPane: 'notifications',
			settingsSection: 'general',
			toasts: []
		})
		useMailStore.getState().reset()
	})

	afterEach(() => {
		registerAppNavigator(null)
		registerMailNavigator(null)
	})

	it('renders standalone without outer TooltipProvider or WorkspaceProvider with zero axe violations', async () => {
		const boot = await createPreviewWorkspace()
		const { container } = render(
			<SyncProvider engine={boot.engine}>
				<InboxSidebarNav />
			</SyncProvider>
		)
		try {
			expect(screen.getByRole('navigation', { name: t('inbox.title') })).toBeInTheDocument()
			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('marks all notifications read and navigates to notification settings', async () => {
		const boot = await createPreviewWorkspace()
		const markAllSpy = vi.spyOn(boot.api, 'markAllNotificationsRead')
		const appNav = vi.fn()
		registerAppNavigator(appNav)

		try {
			render(
				<TooltipProvider>
					<WorkspaceProvider boot={boot}>
						<SyncProvider engine={boot.engine}>
							<InboxSidebarNav />
						</SyncProvider>
					</WorkspaceProvider>
				</TooltipProvider>
			)

			const markAllBtn = screen.getByRole('button', { name: t('inbox.mark-all-read') })
			fireEvent.click(markAllBtn)

			await waitFor(() => {
				expect(markAllSpy).toHaveBeenCalledTimes(1)
				expect(
					useUiStore.getState().toasts.some((toast) => toast.title === t('inbox.sidebar.marked-all-read'))
				).toBe(true)
			})

			const moreTrigger = screen.getByRole('button', { name: t('shell.sidebar.more-actions') })
			fireEvent.keyDown(moreTrigger, { key: 'Enter' })
			fireEvent.click(await screen.findByRole('menuitem', { name: t('inbox.sidebar.notification-settings') }))

			expect(useUiStore.getState().settingsSection).toBe('notifications')
			expect(useUiStore.getState().destination).toBe('settings')
			expect(appNav).toHaveBeenCalledWith('settings')
		} finally {
			markAllSpy.mockRestore()
			boot.engine.dispose()
		}
	})

	it('supports shared inbox quick compose, mail view filters, header compose, and manage-inboxes navigation', async () => {
		const boot = await createPreviewWorkspace()
		const mailNav = vi.fn()
		registerMailNavigator(mailNav)

		try {
			render(
				<TooltipProvider>
					<WorkspaceProvider boot={boot}>
						<SyncProvider engine={boot.engine}>
							<InboxSidebarHeaderAction />
							<InboxSidebarNav />
						</SyncProvider>
					</WorkspaceProvider>
				</TooltipProvider>
			)

			await screen.findByRole('button', { name: /Support/i })

			const inboxMenus = screen.getAllByRole('button', { name: t('inbox.sidebar.inbox-actions') })
			const supportMenu = inboxMenus.at(-1)
			if (!supportMenu) throw new Error('Expected Support inbox menu trigger')
			fireEvent.keyDown(supportMenu, { key: 'Enter' })
			fireEvent.click(await screen.findByRole('menuitem', { name: t('mail.sidebar.snoozed') }))

			await waitFor(() => {
				expect(useUiStore.getState().inboxPane).toBe('mail')
				expect(useMailStore.getState().activeView).toBe('snoozed')
			})

			fireEvent.click(screen.getByRole('button', { name: t('inbox.sidebar.compose-header') }))
			expect(useMailStore.getState().composeOpen).toBe(true)
			expect(mailNav).toHaveBeenCalled()

			fireEvent.click(screen.getByRole('button', { name: t('inbox.sidebar.manage-inboxes') }))
			expect(useUiStore.getState().settingsSection).toBe('mail')
			expect(useUiStore.getState().destination).toBe('settings')
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
							<InboxSidebarNav collapsed />
							<InboxSidebarFooterUtility collapsed />
						</SyncProvider>
					</WorkspaceProvider>
				</TooltipProvider>
			)

			expect(screen.getByRole('button', { name: t('inbox.sidebar.unread') })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: t('inbox.sidebar.archived') })).toBeInTheDocument()
			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})
})
