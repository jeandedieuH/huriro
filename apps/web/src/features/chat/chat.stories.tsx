import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { type BootstrappedWorkspace, createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { WorkspaceProvider } from '@/lib/workspace'
import { ChatSidebarNav } from './components/chat-sidebar-nav'
import { ChatWorkspace } from './components/chat-workspace'
import { type ChatNavView, useChatStore } from './store/chat-store'

activateI18n('en')

function PreviewChatStory({
	openThreadOnMount = false,
	openPinsOnMount = false,
	emptyPins = false,
	empty = false,
	initialView
}: {
	readonly openThreadOnMount?: boolean
	readonly openPinsOnMount?: boolean
	readonly emptyPins?: boolean
	readonly empty?: boolean
	readonly initialView?: ChatNavView
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
				await useChatStore.getState().loadChatV2Metadata(b.api)
				if (initialView) {
					useChatStore.getState().setActiveView(initialView)
				}
				const firstChan = useChatStore.getState().channels[0]
				if (openThreadOnMount && firstChan) {
					const msgs = useChatStore.getState().messagesByChannel[firstChan.id] ?? []
					if (msgs[0]) {
						await useChatStore.getState().openThread(b.api, msgs[0].id)
					}
				}
				if (openPinsOnMount) {
					if (emptyPins) {
						useChatStore.setState({ pinsByChannel: {} })
					} else if (firstChan) {
						const currentPins = useChatStore.getState().pinsByChannel[firstChan.id] ?? []
						if (currentPins.length === 0) {
							const firstMsg = useChatStore.getState().messagesByChannel[firstChan.id]?.[0]
							if (firstMsg) {
								await useChatStore.getState().pinMessage(b.api, firstChan.id, firstMsg.id)
							}
						}
					}
					useChatStore.getState().setPinsPanelOpen(true)
				}
			}
			setBoot(b)
		})
		return () => {
			cancelled = true
			active?.engine.dispose()
		}
	}, [empty, emptyPins, initialView, openPinsOnMount, openThreadOnMount])

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

export const PinsPanelOpen: Story = {
	args: {
		openThreadOnMount: false,
		openPinsOnMount: true,
		emptyPins: false,
		empty: false
	}
}

export const PinsPanelEmpty: Story = {
	args: {
		openThreadOnMount: false,
		openPinsOnMount: true,
		emptyPins: true,
		empty: false
	}
}

export const PollInChannel: Story = {
	args: {
		openThreadOnMount: false,
		empty: false,
		initialView: 'channel'
	}
}

export const SavedLaterView: Story = {
	args: {
		initialView: 'later'
	}
}

export const DraftsAndScheduledView: Story = {
	args: {
		initialView: 'drafts'
	}
}

export const UserGroupsView: Story = {
	args: {
		initialView: 'groups'
	}
}
