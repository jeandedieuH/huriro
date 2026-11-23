import { activateI18n } from '@huriro/i18n'
import { fireEvent, render, screen } from '@testing-library/react'
import { FolderKanban, ListChecks } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoViolations } from '@/lib/test-setup'
import { AppShell } from './app-shell'
import { SidebarNavItem } from './sidebar/sidebar-primitives'

activateI18n('en')

class ResizeObserverStub {
	observe() {}
	unobserve() {}
	disconnect() {}
}

describe('AppShell & Sidebar', () => {
	beforeEach(() => {
		vi.stubGlobal('ResizeObserver', ResizeObserverStub)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('renders root navigation items with unread badge and disabled Mail, and passes axe', async () => {
		const onSelectNav = vi.fn()
		const { container } = render(
			<AppShell
				workspaceName="Orbit Development"
				userName="Maya Chen"
				activeNav="home"
				sidebarLevel="root"
				inboxUnreadCount={3}
				chatUnreadCount={2}
				onSelectNav={onSelectNav}
				onOpenShortcuts={vi.fn()}
				onOpenCommandPalette={vi.fn()}
			>
				<div>Content</div>
			</AppShell>
		)

		expect(screen.getByRole('button', { name: /^Home$/i })).toHaveAttribute('aria-current', 'page')
		expect(screen.getByRole('button', { name: /^Tasks$/i })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /^Docs$/i })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /^Chat/i })).toHaveTextContent('2')
		expect(screen.getByRole('button', { name: /Mail/i })).toBeDisabled()
		expect(screen.getByRole('button', { name: /^Inbox/i })).toHaveTextContent('3')
		expect(screen.getByRole('button', { name: /^Settings$/i })).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: /^Tasks$/i }))
		expect(onSelectNav).toHaveBeenCalledWith('tasks')

		await expectNoViolations(container)
	})

	it('supports feature drill-down header, back button, search trigger, collapse rail, and passes axe', async () => {
		const onBackToRoot = vi.fn()
		const onToggleCollapse = vi.fn()
		const onOpenPalette = vi.fn()

		const featureSidebar = (
			<nav aria-label="Tasks">
				<SidebarNavItem icon={<ListChecks className="size-4" />} label="All tasks" active />
				<SidebarNavItem icon={<FolderKanban className="size-4" />} label="All projects" active />
			</nav>
		)

		const { container, rerender } = render(
			<AppShell
				workspaceName="Orbit Development"
				userName="Maya Chen"
				activeNav="tasks"
				sidebarLevel="feature"
				sidebarCollapsed={false}
				featureTitle="Tasks"
				featureSidebar={featureSidebar}
				onBackToRoot={onBackToRoot}
				onToggleSidebarCollapsed={onToggleCollapse}
				onOpenCommandPalette={onOpenPalette}
			>
				<div>Tasks Board</div>
			</AppShell>
		)

		expect(screen.getByText('All tasks')).toBeInTheDocument()
		expect(screen.getByText('All projects')).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: 'Back to main menu' }))
		expect(onBackToRoot).toHaveBeenCalledTimes(1)

		const searchButtons = screen.getAllByRole('button', { name: 'Command palette' })
		fireEvent.click(searchButtons[0] as HTMLElement)
		expect(onOpenPalette).toHaveBeenCalledTimes(1)

		const collapseBtn = screen.getByRole('button', { name: 'Collapse sidebar' })
		expect(collapseBtn).toHaveAttribute('aria-expanded', 'true')
		fireEvent.click(collapseBtn)
		expect(onToggleCollapse).toHaveBeenCalledTimes(1)

		await expectNoViolations(container)

		rerender(
			<AppShell
				workspaceName="Orbit Development"
				userName="Maya Chen"
				activeNav="tasks"
				sidebarLevel="feature"
				sidebarCollapsed={true}
				featureTitle="Tasks"
				featureSidebar={featureSidebar}
				onBackToRoot={onBackToRoot}
				onToggleSidebarCollapsed={onToggleCollapse}
				onOpenCommandPalette={onOpenPalette}
			>
				<div>Tasks Board</div>
			</AppShell>
		)

		expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false')
		await expectNoViolations(container)
	})
})
