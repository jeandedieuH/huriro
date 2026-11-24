import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { AppShell } from '@/components/app-shell/app-shell'
import { type BootstrappedWorkspace, createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { WorkspaceProvider } from '@/lib/workspace'
import { type SettingsSection, useUiStore } from '@/stores/ui-store'
import { SettingsSidebarNav } from './components/settings-sidebar-nav'
import { SettingsWorkspace } from './components/settings-workspace'

activateI18n('en')

function PreviewSettingsStory({
	initialSection = 'general',
	mode = 'cloud',
	theme = 'light'
}: {
	readonly initialSection?: SettingsSection
	readonly mode?: 'selfhost' | 'cloud'
	readonly theme?: 'light' | 'dark'
}) {
	const [boot, setBoot] = useState<BootstrappedWorkspace | null>(null)
	const [collapsed, setCollapsed] = useState(false)

	useEffect(() => {
		let cancelled = false
		let active: BootstrappedWorkspace | null = null
		useUiStore.setState({
			destination: 'settings',
			sidebarLevel: 'feature',
			settingsSection: initialSection,
			theme
		})
		void createPreviewWorkspace(undefined, { mode }).then((b) => {
			if (cancelled) {
				b.engine.dispose()
				return
			}
			active = b
			setBoot(b)
		})
		return () => {
			cancelled = true
			active?.engine.dispose()
		}
	}, [initialSection, mode, theme])

	if (!boot) return null

	return (
		<div className={theme === 'dark' ? 'dark' : undefined}>
			<WorkspaceProvider boot={boot}>
				<SyncProvider engine={boot.engine}>
					<AppShell
						workspaceName={boot.workspaceName}
						userName={boot.userDisplayName}
						isPreview={boot.isPreview}
						activeNav="settings"
						sidebarLevel="feature"
						sidebarCollapsed={collapsed}
						theme={theme}
						featureTitle="Settings"
						featureSidebar={<SettingsSidebarNav collapsed={collapsed} />}
						onToggleSidebarCollapsed={() => setCollapsed((prev) => !prev)}
					>
						<div className="min-h-0 flex-1 overflow-y-auto">
							<SettingsWorkspace />
						</div>
					</AppShell>
				</SyncProvider>
			</WorkspaceProvider>
		</div>
	)
}

const meta: Meta<typeof PreviewSettingsStory> = {
	title: 'Features/Settings/SettingsWorkspace',
	component: PreviewSettingsStory,
	parameters: { layout: 'fullscreen' }
}

export default meta

type Story = StoryObj<typeof meta>

export const GeneralLight: Story = {
	args: {
		initialSection: 'general',
		mode: 'cloud',
		theme: 'light'
	}
}

export const BillingDark: Story = {
	args: {
		initialSection: 'billing',
		mode: 'cloud',
		theme: 'dark'
	}
}

export const InteractiveNavigation: Story = {
	args: {
		initialSection: 'general',
		mode: 'cloud',
		theme: 'light'
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await waitFor(() => {
			expect(canvas.getByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument()
		})

		const filterInput = canvas.getByLabelText('Filter settings sections')
		await userEvent.type(filterInput, 'members')
		await userEvent.click(canvas.getByRole('button', { name: 'Members & roles' }))

		await waitFor(() => {
			expect(canvas.getByRole('heading', { level: 1, name: 'Members & roles' })).toBeInTheDocument()
		})
	}
}
