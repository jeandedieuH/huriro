import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { expectNoViolations } from '@/lib/test-setup'
import { WorkspaceProvider } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'
import { AppearanceSettingsPanel } from './components/appearance-settings-panel'
import { GeneralSettingsPanel } from './components/general-settings-panel'
import { ImportsSettingsPanel } from './components/imports-settings-panel'
import { MembersSettingsPanel } from './components/members-settings-panel'
import { NotificationsSettingsPanel } from './components/notifications-settings-panel'
import { SettingsSidebarNav } from './components/settings-sidebar-nav'
import { SettingsWorkspace } from './components/settings-workspace'

activateI18n('en')

describe('Settings Workspace redesign', () => {
	beforeEach(() => {
		document.documentElement.classList.remove('dark')
		useUiStore.setState({
			destination: 'settings',
			settingsSection: 'general',
			theme: 'light',
			density: 'comfortable',
			shortcutsEnabled: true,
			importDialogOpen: false,
			importDialogSource: 'linear'
		})
	})

	afterEach(() => {
		cleanup()
		document.documentElement.classList.remove('dark')
	})

	it('renders only the active section instead of stacking all panels and passes axe', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const { container } = render(
				<WorkspaceProvider boot={boot}>
					<SyncProvider engine={boot.engine}>
						<SettingsWorkspace />
					</SyncProvider>
				</WorkspaceProvider>
			)

			expect(screen.getByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument()
			expect(screen.getByText('Workspace profile')).toBeInTheDocument()
			expect(screen.queryByText('Outbound webhooks')).not.toBeInTheDocument()
			expect(screen.queryByText('Notification preferences')).not.toBeInTheDocument()

			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('filters sidebar sections, activates matching section on Enter, clears on Escape, and marks aria-current', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const { container } = render(
				<TooltipProvider>
					<WorkspaceProvider boot={boot}>
						<SyncProvider engine={boot.engine}>
							<SettingsSidebarNav />
						</SyncProvider>
					</WorkspaceProvider>
				</TooltipProvider>
			)

			expect(screen.getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'page')
			expect(screen.getByRole('button', { name: 'Members & roles' })).toBeEnabled()

			const filterInput = screen.getByLabelText('Filter settings sections') as HTMLInputElement
			fireEvent.change(filterInput, { target: { value: 'webhook' } })

			expect(screen.getByRole('button', { name: 'Webhooks' })).toBeInTheDocument()
			expect(screen.queryByRole('button', { name: 'General' })).not.toBeInTheDocument()

			fireEvent.keyDown(filterInput, { key: 'Enter' })
			expect(useUiStore.getState().settingsSection).toBe('webhooks')

			fireEvent.keyDown(filterInput, { key: 'Escape' })
			expect(filterInput.value).toBe('')
			expect(screen.getByRole('button', { name: 'General' })).toBeInTheDocument()

			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('displays workspace members, filters by search, and renders the role capabilities matrix cleanly', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const { container } = render(
				<WorkspaceProvider boot={boot}>
					<MembersSettingsPanel />
				</WorkspaceProvider>
			)

			expect(await screen.findByText('Hagen (Owner)')).toBeInTheDocument()
			expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
			expect(screen.getByRole('heading', { level: 2, name: 'Role capabilities' })).toBeInTheDocument()

			const searchInput = screen.getByLabelText('Filter by name, email, or role…')
			fireEvent.change(searchInput, { target: { value: 'ada' } })

			expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
			expect(screen.queryByText('Hagen (Owner)')).not.toBeInTheDocument()

			fireEvent.change(searchInput, { target: { value: 'nonexistent-member' } })
			expect(screen.getByText('No members match your filter.')).toBeInTheDocument()

			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('switches theme, interface density, and single-key shortcut preference with zero axe violations', async () => {
		const { container } = render(<AppearanceSettingsPanel />)

		fireEvent.click(screen.getByRole('button', { name: /Dark/i }))
		expect(useUiStore.getState().theme).toBe('dark')
		expect(document.documentElement.classList.contains('dark')).toBe(true)

		fireEvent.click(screen.getByRole('button', { name: /Compact/i }))
		expect(useUiStore.getState().density).toBe('compact')

		fireEvent.click(screen.getByRole('checkbox', { name: 'Enable single-key shortcuts' }))
		expect(useUiStore.getState().shortcutsEnabled).toBe(false)

		await expectNoViolations(container)
	})

	it('opens the import dialog preselected to the clicked source in ImportsSettingsPanel', async () => {
		const { container } = render(<ImportsSettingsPanel />)

		fireEvent.click(screen.getByRole('button', { name: /Import from Slack JSON export/i }))
		expect(useUiStore.getState().importDialogOpen).toBe(true)
		expect(useUiStore.getState().importDialogSource).toBe('slack')

		await expectNoViolations(container)
	})

	it('shows GeneralSettingsPanel metrics and dismisses billing status banner in SettingsWorkspace', async () => {
		const boot = await createPreviewWorkspace(undefined, { mode: 'cloud' })
		let dismissed = false
		try {
			useUiStore.setState({ settingsSection: 'billing' })
			const { container } = render(
				<WorkspaceProvider boot={boot}>
					<SyncProvider engine={boot.engine}>
						<SettingsWorkspace
							billingStatus="success"
							onDismissBillingStatus={() => {
								dismissed = true
							}}
						/>
					</SyncProvider>
				</WorkspaceProvider>
			)

			expect(screen.getByText('Payment received')).toBeInTheDocument()
			fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
			expect(dismissed).toBe(true)

			await waitFor(() => {
				expect(screen.getByRole('heading', { level: 2, name: 'Billing & subscription' })).toBeInTheDocument()
			})
			await expectNoViolations(container)

			const generalRender = render(
				<WorkspaceProvider boot={boot}>
					<SyncProvider engine={boot.engine}>
						<GeneralSettingsPanel />
					</SyncProvider>
				</WorkspaceProvider>
			)
			expect(generalRender.getByText('Open issues')).toBeInTheDocument()
			await expectNoViolations(generalRender.container)
			generalRender.unmount()
		} finally {
			boot.engine.dispose()
		}
	})

	it('renders email delivery status, toggles instant email alerts, and sends a test email with zero axe violations', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const { container } = render(
				<WorkspaceProvider boot={boot}>
					<NotificationsSettingsPanel />
				</WorkspaceProvider>
			)

			expect(await screen.findByText('Outbound email delivery')).toBeInTheDocument()
			expect(screen.getByText('Configured')).toBeInTheDocument()

			const instantCheckbox = screen.getByRole('checkbox', {
				name: /Send instant email alerts for @mentions/i
			})
			expect(instantCheckbox).toBeChecked()
			fireEvent.click(instantCheckbox)
			fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }))

			await waitFor(async () => {
				const prefs = await boot.api.getNotificationPreferences()
				expect(prefs.emailInstantEnabled).toBe(false)
			})

			const recipientInput = screen.getByLabelText('Test recipient (optional)')
			fireEvent.change(recipientInput, { target: { value: 'alerts@example.com' } })
			fireEvent.click(screen.getByRole('button', { name: 'Send test email' }))

			expect(await screen.findByText('Test email sent to alerts@example.com via resend.')).toBeInTheDocument()
			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('submits workspace member invitation and shows delivery status in MembersSettingsPanel', async () => {
		const boot = await createPreviewWorkspace(undefined, { mode: 'cloud' })
		try {
			const { container } = render(
				<WorkspaceProvider boot={boot}>
					<MembersSettingsPanel />
				</WorkspaceProvider>
			)

			expect(await screen.findByText('Invite teammate')).toBeInTheDocument()
			const emailInput = screen.getByLabelText('Work email')
			fireEvent.change(emailInput, { target: { value: 'teammate@example.com' } })
			fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }))

			expect(
				await screen.findByText('Invitation email sent to teammate@example.com via emailit.')
			).toBeInTheDocument()
			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})
})
