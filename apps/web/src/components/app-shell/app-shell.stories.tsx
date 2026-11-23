import { activateI18n } from '@huriro/i18n'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { FolderKanban, Layers, ListChecks, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { EmptyState } from '@/components/ui/empty-state'
import type { AppDestination, SidebarLevel } from '@/stores/ui-store'
import { AppShell } from './app-shell'
import { SidebarNavItem, SidebarProjectDot, SidebarSection } from './sidebar/sidebar-primitives'

activateI18n('en')

function SampleTasksFeatureSidebar({ collapsed = false }: { readonly collapsed?: boolean }) {
	return (
		<nav aria-label="Tasks" className="space-y-0.5">
			<SidebarNavItem
				icon={<ListChecks className="size-4" />}
				label="All tasks"
				active
				collapsed={collapsed}
			/>
			<SidebarNavItem icon={<Layers className="size-4" />} label="Views" collapsed={collapsed} />
			<SidebarSection title="Projects" collapsed={collapsed}>
				<SidebarNavItem
					icon={<FolderKanban className="size-4" />}
					label="All projects"
					active
					collapsed={collapsed}
				/>
				<SidebarNavItem icon={<SidebarProjectDot index={0} />} label="Engineering" collapsed={collapsed} />
				<SidebarNavItem icon={<SidebarProjectDot index={1} />} label="Security" collapsed={collapsed} />
			</SidebarSection>
		</nav>
	)
}

function InteractiveShellStory() {
	const [activeNav, setActiveNav] = useState<AppDestination>('home')
	const [sidebarLevel, setSidebarLevel] = useState<SidebarLevel>('root')
	const [collapsed, setCollapsed] = useState(false)

	return (
		<div className="dark">
			<AppShell
				workspaceName="Orbit Development"
				userName="Maya Chen"
				activeNav={activeNav}
				sidebarLevel={sidebarLevel}
				sidebarCollapsed={collapsed}
				inboxUnreadCount={3}
				chatUnreadCount={2}
				featureTitle={activeNav === 'tasks' ? 'Tasks' : undefined}
				featureSidebar={
					activeNav === 'tasks' ? <SampleTasksFeatureSidebar collapsed={collapsed} /> : undefined
				}
				featureFooterUtility={
					activeNav === 'tasks' ? (
						<SidebarNavItem icon={<Trash2 className="size-4" />} label="Trash" collapsed={collapsed} />
					) : undefined
				}
				onSelectNav={(dest) => {
					setActiveNav(dest)
					setSidebarLevel(dest === 'home' ? 'root' : 'feature')
				}}
				onBackToRoot={() => setSidebarLevel('root')}
				onToggleSidebarCollapsed={() => setCollapsed((prev) => !prev)}
				onOpenShortcuts={() => {}}
			>
				<EmptyState className="m-6" title={`Active view: ${activeNav}`} />
			</AppShell>
		</div>
	)
}

const meta: Meta<typeof AppShell> = {
	title: 'Shell/AppShell',
	component: AppShell,
	parameters: { layout: 'fullscreen' },
	args: {
		workspaceName: 'Orbit Development',
		userName: 'Maya Chen',
		activeNav: 'home',
		sidebarLevel: 'root',
		inboxUnreadCount: 3,
		chatUnreadCount: 2,
		onOpenShortcuts: () => {},
		children: <EmptyState className="m-6" />
	}
}
export default meta
type Story = StoryObj<typeof AppShell>

export const RootLight: Story = {}

export const RootDark: Story = {
	args: { theme: 'dark' },
	decorators: [
		(Story) => (
			<div className="dark">
				<Story />
			</div>
		)
	]
}

export const TasksDrillDownDark: Story = {
	args: {
		theme: 'dark',
		activeNav: 'tasks',
		sidebarLevel: 'feature',
		featureTitle: 'Tasks',
		featureSidebar: <SampleTasksFeatureSidebar />,
		featureFooterUtility: <SidebarNavItem icon={<Trash2 className="size-4" />} label="Trash" />
	},
	decorators: [
		(Story) => (
			<div className="dark">
				<Story />
			</div>
		)
	]
}

export const CollapsedRailDark: Story = {
	args: {
		theme: 'dark',
		activeNav: 'home',
		sidebarLevel: 'root',
		sidebarCollapsed: true
	},
	decorators: [
		(Story) => (
			<div className="dark">
				<Story />
			</div>
		)
	]
}

export const InteractiveNavigation: Story = {
	render: () => <InteractiveShellStory />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await userEvent.click(canvas.getByRole('button', { name: /Tasks/i }))
		await expect(canvas.getByText('All projects')).toBeInTheDocument()

		await userEvent.click(canvas.getByRole('button', { name: 'Back to main menu' }))
		await expect(canvas.getByRole('button', { name: /Home/i })).toBeInTheDocument()

		const collapseBtn = canvas.getByRole('button', { name: 'Collapse sidebar' })
		await userEvent.click(collapseBtn)
		await expect(canvas.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute(
			'aria-expanded',
			'false'
		)
	}
}
