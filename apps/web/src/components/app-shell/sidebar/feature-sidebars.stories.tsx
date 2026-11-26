import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { ChatSidebarNav } from '@/features/chat/components/chat-sidebar-nav'
import { useChatStore } from '@/features/chat/store/chat-store'
import { useMailStore } from '@/features/mail/store/mail-store'
import {
	InboxSidebarFooterUtility,
	InboxSidebarNav
} from '@/features/notifications/components/inbox-sidebar-nav'
import { SettingsSidebarNav } from '@/features/settings/components/settings-sidebar-nav'
import { TasksSidebarFooterUtility, TasksSidebarNav } from '@/features/tasks/components/tasks-sidebar-nav'
import { type BootstrappedWorkspace, createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { WorkspaceProvider } from '@/lib/workspace'

activateI18n('en')

type SidebarKind = 'tasks' | 'inbox' | 'chat' | 'settings'

function FeatureSidebarStory({
	kind,
	collapsed = false,
	dark = false
}: {
	readonly kind: SidebarKind
	readonly collapsed?: boolean
	readonly dark?: boolean
}) {
	const [boot, setBoot] = useState<BootstrappedWorkspace | null>(null)

	useEffect(() => {
		let cancelled = false
		let active: BootstrappedWorkspace | null = null
		useChatStore.getState().reset()
		useMailStore.getState().reset()

		void createPreviewWorkspace().then(async (b) => {
			if (cancelled) {
				b.engine.dispose()
				return
			}
			active = b
			if (kind === 'inbox') {
				await useMailStore.getState().loadInboxes(b.api)
			} else if (kind === 'chat') {
				await useChatStore.getState().loadChannels(b.api)
				await useChatStore.getState().loadChatV2Metadata(b.api)
			}
			setBoot(b)
		})
		return () => {
			cancelled = true
			active?.engine.dispose()
		}
	}, [kind])

	if (!boot) return null

	return (
		<div className={dark ? 'dark' : undefined}>
			<div className="flex h-160 border border-border bg-background text-foreground">
				<WorkspaceProvider boot={boot}>
					<SyncProvider engine={boot.engine}>
						<aside
							aria-label={`${kind} sidebar preview`}
							className={
								collapsed
									? 'flex w-16 shrink-0 flex-col justify-between overflow-y-auto border-r border-sidebar-border bg-sidebar px-2 py-3 text-sidebar-foreground'
									: 'flex w-60 shrink-0 flex-col justify-between overflow-y-auto border-r border-sidebar-border bg-sidebar px-3 py-3 text-sidebar-foreground'
							}
						>
							<div className="min-h-0 flex-1 overflow-y-auto">
								{kind === 'tasks' ? <TasksSidebarNav collapsed={collapsed} /> : null}
								{kind === 'inbox' ? <InboxSidebarNav collapsed={collapsed} /> : null}
								{kind === 'chat' ? <ChatSidebarNav collapsed={collapsed} /> : null}
								{kind === 'settings' ? <SettingsSidebarNav collapsed={collapsed} /> : null}
							</div>
							{kind === 'tasks' ? (
								<div className="pt-2">
									<TasksSidebarFooterUtility collapsed={collapsed} />
								</div>
							) : null}
							{kind === 'inbox' ? (
								<div className="pt-2">
									<InboxSidebarFooterUtility collapsed={collapsed} />
								</div>
							) : null}
						</aside>
					</SyncProvider>
				</WorkspaceProvider>
			</div>
		</div>
	)
}

const meta: Meta<typeof FeatureSidebarStory> = {
	title: 'AppShell/FeatureSidebars',
	component: FeatureSidebarStory
}

export default meta

type Story = StoryObj<typeof meta>

export const TasksSidebar: Story = {
	args: { kind: 'tasks' }
}

export const TasksSidebarDark: Story = {
	args: { kind: 'tasks', dark: true }
}

export const TasksSidebarCollapsed: Story = {
	args: { kind: 'tasks', collapsed: true }
}

export const InboxSidebar: Story = {
	args: { kind: 'inbox' }
}

export const ChatSidebar: Story = {
	args: { kind: 'chat' }
}

export const SettingsSidebar: Story = {
	args: { kind: 'settings' }
}

export const InteractiveTasksSidebar: Story = {
	args: { kind: 'tasks' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		const filter = await canvas.findByRole('textbox', { name: 'Filter projects and views' })
		await userEvent.type(filter, 'ENG')
		await expect(await canvas.findByRole('button', { name: /Engineering/i })).toBeInTheDocument()

		await userEvent.keyboard('{Escape}')
		const collapseBtn = await canvas.findByRole('button', { name: 'Collapse Projects' })
		await userEvent.click(collapseBtn)
		await expect(await canvas.findByRole('button', { name: 'Expand Projects' })).toBeInTheDocument()
		await userEvent.click(canvas.getByRole('button', { name: 'Expand Projects' }))

		const triggers = await canvas.findAllByRole('button', { name: 'Project actions' })
		const firstTrigger = triggers[0]
		if (!firstTrigger) throw new Error('Expected Project actions button')
		await userEvent.click(firstTrigger)
		const body = within(document.body)
		await expect(await body.findByRole('menuitem', { name: 'Project settings' })).toBeInTheDocument()
		await expect(await body.findByRole('menuitem', { name: 'Copy project key' })).toBeInTheDocument()
	}
}
