import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { IssueDetailPanel } from '@/features/tasks/components/task-detail-panel'
import { createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { expectNoViolations } from '@/lib/test-setup'
import { WorkspaceProvider } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'
import { GithubSettingsPanel } from './components/github-settings-panel'
import { NotificationsSettingsPanel } from './components/notifications-settings-panel'
import { WebhooksSettingsPanel } from './components/webhooks-settings-panel'

activateI18n('en')

describe('M4 Settings & GitHub sync UI', () => {
	beforeEach(() => {
		useUiStore.setState({ toasts: [] })
	})

	it('updates notification preferences cleanly with zero axe violations', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const { container } = render(
				<WorkspaceProvider boot={boot}>
					<NotificationsSettingsPanel />
				</WorkspaceProvider>
			)

			const tzInput = await screen.findByLabelText('Timezone')
			fireEvent.change(tzInput, { target: { value: 'America/New_York' } })
			fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }))

			await waitFor(() => {
				expect(
					useUiStore.getState().toasts.some((item) => item.title === 'Notification preferences saved')
				).toBe(true)
			})
			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('creates and rotates outbound webhook secrets showing plaintext once', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const { container } = render(
				<WorkspaceProvider boot={boot}>
					<WebhooksSettingsPanel />
				</WorkspaceProvider>
			)

			const nameInput = await screen.findByLabelText('Endpoint name')
			const urlInput = screen.getByLabelText('Payload URL (HTTPS)')
			fireEvent.change(nameInput, { target: { value: 'CI Notifier' } })
			fireEvent.change(urlInput, { target: { value: 'https://hooks.example.com/huriro' } })
			fireEvent.click(screen.getByRole('button', { name: 'Create webhook' }))

			await waitFor(() => {
				expect(screen.getByText('CI Notifier')).toBeInTheDocument()
				expect(screen.getByText('Copy signing secret now — it will not be shown again:')).toBeInTheDocument()
			})

			fireEvent.click(screen.getByRole('button', { name: 'Rotate secret' }))
			await waitFor(() => {
				expect(screen.getByText('Copy signing secret now — it will not be shown again:')).toBeInTheDocument()
			})

			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('connects GitHub repositories in GithubSettingsPanel with zero axe violations', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const { container } = render(
				<WorkspaceProvider boot={boot}>
					<SyncProvider engine={boot.engine}>
						<GithubSettingsPanel />
					</SyncProvider>
				</WorkspaceProvider>
			)

			expect(await screen.findByText('huriro-org/huriro')).toBeInTheDocument()

			fireEvent.change(screen.getByLabelText('Repository (owner/repo)'), {
				target: { value: 'acme/platform' }
			})
			fireEvent.change(screen.getByLabelText('GitHub organization / login'), { target: { value: 'acme' } })
			fireEvent.change(screen.getByLabelText('Webhook secret'), { target: { value: 'ghsec_super_secret_1' } })
			fireEvent.click(screen.getByRole('button', { name: 'Connect repository' }))

			await waitFor(() => {
				expect(screen.getByText('acme/platform')).toBeInTheDocument()
			})
			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('renders push_failed inline warning and manual retry on IssueDetailPanel', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const allIssues = boot.engine.collections.issues.toArray
			const eng2 = allIssues.find((i) => i.identifier === 'ENG-2')
			expect(eng2).toBeDefined()
			if (!eng2) return

			const members = await boot.api.listMembers()
			const { container } = render(
				<TooltipProvider>
					<IssueDetailPanel
						issue={eng2}
						allIssues={allIssues}
						statuses={boot.engine.collections.projectStatuses.toArray}
						labels={[]}
						members={members}
						api={boot.api}
						onUpdateIssue={async () => undefined}
						onCreateSubIssue={async () => undefined}
						onDeleteIssue={async () => undefined}
					/>
				</TooltipProvider>
			)

			expect(await screen.findByText('GitHub API rate limit reached (HTTP 429)')).toBeInTheDocument()
			expect(screen.getByText('GitHub sync push failed')).toBeInTheDocument()
			await expectNoViolations(container)

			fireEvent.click(screen.getByRole('button', { name: 'Retry sync' }))
			await waitFor(() => {
				expect(screen.getByText('Synced')).toBeInTheDocument()
			})
		} finally {
			boot.engine.dispose()
		}
	})
})
