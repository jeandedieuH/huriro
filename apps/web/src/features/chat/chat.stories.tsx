import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { type BootstrappedWorkspace, createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { WorkspaceProvider } from '@/lib/workspace'
import { ChatSidebarNav } from './components/chat-sidebar-nav'
import { ChatWorkspace } from './components/chat-workspace'
import { useChatStore } from './store/chat-store'

activateI18n('en')

function PreviewChatStory({
	openThreadOnMount = false,
	empty = false
}: {
	readonly openThreadOnMount?: boolean
	readonly empty?: boolean
}) {
	const [boot, setBoot] = useState<BootstrappedWorkspace | null>(null)

	useEffect(() => {
		let cancelled = false
		let active: BootstrappedWorkspace | null = null
		useChatStore.getState().reset()
		void createPreviewWorkspace().then(async (b) => {
			if (cancelled) {
				b.engine.dispose()
				return
			}
			active = b
			if (!empty) {
				await useChatStore.getState().loadChannels(b.api)
				if (openThreadOnMount) {
					const firstChan = useChatStore.getState().channels[0]
					if (firstChan) {
						const msgs = useChatStore.getState().messagesByChannel[firstChan.id] ?? []
						if (msgs[0]) {
							await useChatStore.getState().openThread(b.api, msgs[0].id)
						}
					}
				}
			}
			setBoot(b)
		})
		return () => {
			cancelled = true
			active?.engine.dispose()
		}
	}, [empty, openThreadOnMount])

	if (!boot) return null
	return (
		<div className="flex h-160 border border-border bg-background text-foreground">
			<TooltipProvider>
				<WorkspaceProvider boot={boot}>
					<SyncProvider engine={boot.engine}>
						<div className="w-60 shrink-0 border-r border-border bg-sidebar p-3">
							<ChatSidebarNav />
						</div>
						<div className="min-w-0 flex-1">
							<ChatWorkspace />
						</div>
					</SyncProvider>
				</WorkspaceProvider>
			</TooltipProvider>
		</div>
	)
}

const meta: Meta<typeof PreviewChatStory> = {
	title: 'Features/Chat/ChatWorkspace',
	component: PreviewChatStory
}

export default meta

type Story = StoryObj<typeof meta>

export const ActiveChannel: Story = {
	args: {
		openThreadOnMount: false,
		empty: false
	}
}

export const ThreadOpen: Story = {
	args: {
		openThreadOnMount: true,
		empty: false
	}
}

export const EmptySelection: Story = {
	args: {
		openThreadOnMount: false,
		empty: true
	}
}
