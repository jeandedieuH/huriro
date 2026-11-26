import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AppShell } from '@/components/app-shell/app-shell'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthGate } from '@/features/auth/components/auth-gate'
import { OnboardingForm } from '@/features/auth/components/onboarding-form'
import { AuthFlowProvider } from '@/features/auth/context'
import { ChatWorkspace } from '@/features/chat/components/chat-workspace'
import { DocsSidebarNav } from '@/features/docs/components/docs-sidebar-nav'
import { DocsWorkspace } from '@/features/docs/components/docs-workspace'
import { HomeView } from '@/features/home/components/home-view'
import { ShortcutsDialog } from '@/features/keyboard/shortcuts-dialog'
import { MailSettingsPanel } from '@/features/mail/components/mail-settings-panel'
import { InboxView } from '@/features/notifications/components/inbox-view'
import { AgentsSettingsPanel } from '@/features/settings/components/agents-panel'
import { AiSettingsPanel } from '@/features/settings/components/ai-settings-panel'
import { ApprovalsSettingsPanel } from '@/features/settings/components/approvals-panel'
import { BillingSettingsPanel } from '@/features/settings/components/billing-panel'
import { GithubSettingsPanel } from '@/features/settings/components/github-settings-panel'
import { GovernanceSettingsPanel } from '@/features/settings/components/governance-panel'
import { NotificationsSettingsPanel } from '@/features/settings/components/notifications-settings-panel'
import { WebhooksSettingsPanel } from '@/features/settings/components/webhooks-settings-panel'
import { SyncStatusBanner } from '@/features/sync/components/sync-status-banner'
import { TasksWorkspace } from '@/features/tasks/components/tasks-workspace'
import { createPreviewWorkspace } from '@/lib/preview-workspace'
import { expectNoViolations } from '@/lib/test-setup'
import { WorkspaceProvider } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'

activateI18n('en')

describe('Top 20 GA flows accessibility audit (vitest-axe)', () => {
	afterEach(() => {
		cleanup()
	})

	it('passes axe on auth, onboarding, app shell, home, and inbox flows', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const noopAuthFlow = {
				needsSetup: false,
				socialProviders: [] as const,
				onboardingUser: null,
				onAuthenticated: () => {},
				onUsePreview: () => {},
				onSignOut: async () => {},
				onNavigate: () => {}
			}

			// 1. Sign-in / AuthGate
			const r1 = render(
				<AuthFlowProvider value={noopAuthFlow}>
					<AuthGate needsSetup={false} onAuthenticated={() => {}} onUsePreview={() => {}} />
				</AuthFlowProvider>
			)
			await expectNoViolations(r1.container)
			r1.unmount()

			// 2. OnboardingForm
			const r2 = render(
				<AuthFlowProvider value={noopAuthFlow}>
					<OnboardingForm
						user={{ id: boot.currentUserId, email: 'hagen@huriro.local', name: 'Hagen' }}
						onComplete={() => {}}
						onSignOut={async () => {}}
					/>
				</AuthFlowProvider>
			)
			await expectNoViolations(r2.container)
			r2.unmount()

			// 3. AppShell
			const r3 = render(
				<TooltipProvider>
					<AppShell activeNav="home" workspaceName="Huriro Preview" userName="Hagen">
						<div className="p-4">Workspace content</div>
					</AppShell>
				</TooltipProvider>
			)
			await expectNoViolations(r3.container)
			r3.unmount()

			// 4. HomeView
			const r4 = render(
				<WorkspaceProvider boot={boot}>
					<SyncProvider engine={boot.engine}>
						<HomeView />
					</SyncProvider>
				</WorkspaceProvider>
			)
			await expectNoViolations(r4.container)
			r4.unmount()

			// 5. InboxView
			const r5 = render(
				<WorkspaceProvider boot={boot}>
					<SyncProvider engine={boot.engine}>
						<InboxView api={boot.api} />
					</SyncProvider>
				</WorkspaceProvider>
			)
			await expectNoViolations(r5.container)
			r5.unmount()
		} finally {
			boot.engine.dispose()
		}
	}, 25_000)

	it('passes axe on Tasks (list & board), Docs (sidebar & workspace), and Chat flows', async () => {
		const boot = await createPreviewWorkspace()
		try {
			// 6. TasksWorkspace (list)
			useUiStore.setState({ tasksLayout: 'list', selectedIssueId: null })
			const r6 = render(
				<TooltipProvider>
					<WorkspaceProvider boot={boot}>
						<SyncProvider engine={boot.engine}>
							<TasksWorkspace api={boot.api} currentUserId={boot.currentUserId} />
						</SyncProvider>
					</WorkspaceProvider>
				</TooltipProvider>
			)
			await expectNoViolations(r6.container)
			r6.unmount()

			// 7. TasksWorkspace (board)
			useUiStore.setState({ tasksLayout: 'board', selectedIssueId: null })
			const r7 = render(
				<TooltipProvider>
					<WorkspaceProvider boot={boot}>
						<SyncProvider engine={boot.engine}>
							<TasksWorkspace api={boot.api} currentUserId={boot.currentUserId} />
						</SyncProvider>
					</WorkspaceProvider>
				</TooltipProvider>
			)
			await expectNoViolations(r7.container)
			r7.unmount()

			// 8. DocsSidebarNav
			const r8 = render(
				<SyncProvider engine={boot.engine}>
					<DocsSidebarNav activeSlug={null} />
				</SyncProvider>
			)
			await expectNoViolations(r8.container)
			r8.unmount()

			// 9. DocsWorkspace (empty state)
			const r9 = render(
				<TooltipProvider>
					<SyncProvider engine={boot.engine}>
						<DocsWorkspace api={boot.api} currentUserId={boot.currentUserId} isPreview activeSlug={null} />
					</SyncProvider>
				</TooltipProvider>
			)
			await expectNoViolations(r9.container)
			r9.unmount()

			// 10. ChatWorkspace
			const r10 = render(
				<WorkspaceProvider boot={boot}>
					<SyncProvider engine={boot.engine}>
						<ChatWorkspace />
					</SyncProvider>
				</WorkspaceProvider>
			)
			await expectNoViolations(r10.container)
			r10.unmount()
		} finally {
			boot.engine.dispose()
		}
	}, 25_000)

	it('passes axe on Settings & Integrations panels', async () => {
		const boot = await createPreviewWorkspace()
		try {
			const panels = [
				{ name: 'mail', node: <MailSettingsPanel /> },
				{ name: 'notifications', node: <NotificationsSettingsPanel /> },
				{ name: 'webhooks', node: <WebhooksSettingsPanel /> },
				{ name: 'github', node: <GithubSettingsPanel /> },
				{ name: 'agents', node: <AgentsSettingsPanel /> },
				{ name: 'approvals', node: <ApprovalsSettingsPanel /> },
				{ name: 'ai', node: <AiSettingsPanel /> }
			]
			for (const entry of panels) {
				const rendered = render(
					<WorkspaceProvider boot={boot}>
						<SyncProvider engine={boot.engine}>{entry.node}</SyncProvider>
					</WorkspaceProvider>
				)
				await waitFor(() => {
					expect(rendered.container.firstElementChild).not.toBeNull()
				})
				await expectNoViolations(rendered.container)
				rendered.unmount()
			}
		} finally {
			boot.engine.dispose()
		}
	}, 25_000)

	it('passes axe on Cloud Billing (Polar + IremboPay MoMo), Governance, SyncBanner, and ShortcutsDialog', async () => {
		const cloudBoot = await createPreviewWorkspace(undefined, { mode: 'cloud' })
		try {
			// 18. BillingSettingsPanel (cloud mode: Polar $10 USD + IremboPay RWF MTN MoMo/Airtel)
			const r18 = render(
				<WorkspaceProvider boot={cloudBoot}>
					<BillingSettingsPanel />
				</WorkspaceProvider>
			)
			await screen.findByText(/USD \/ mo/i)
			await expectNoViolations(r18.container)
			r18.unmount()

			// 19. GovernanceSettingsPanel
			const r19 = render(
				<WorkspaceProvider boot={cloudBoot}>
					<GovernanceSettingsPanel />
				</WorkspaceProvider>
			)
			await screen.findByText(/Data governance/i)
			await expectNoViolations(r19.container)
			r19.unmount()

			// 20a. SyncStatusBanner (offline/degraded state so banner DOM is mounted) + 20b. ShortcutsDialog
			cloudBoot.engine.setOnline(false)
			const r20a = render(
				<SyncProvider engine={cloudBoot.engine}>
					<SyncStatusBanner />
				</SyncProvider>
			)
			expect(screen.getByText('Offline')).toBeInTheDocument()
			await expectNoViolations(r20a.container)
			r20a.unmount()
			cloudBoot.engine.setOnline(true)

			useUiStore.setState({ shortcutsDialogOpen: true })
			const r20b = render(<ShortcutsDialog />)
			await screen.findByText('Keyboard shortcuts')
			await expectNoViolations(r20b.baseElement)
			r20b.unmount()
		} finally {
			useUiStore.setState({ shortcutsDialogOpen: false })
			cloudBoot.engine.dispose()
		}
	}, 25_000)
})
