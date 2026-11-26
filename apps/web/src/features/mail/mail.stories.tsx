import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { type BootstrappedWorkspace, createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { WorkspaceProvider } from '@/lib/workspace'
import { MailSettingsPanel } from './components/mail-settings-panel'
import { MailWorkspace } from './components/mail-workspace'
import { useMailStore } from './store/mail-store'

activateI18n('en')

type MailStoryMode = 'default' | 'compose' | 'bulk' | 'contact' | 'review' | 'ai' | 'settings'

function PreviewMailStory({ mode = 'default' }: { readonly mode?: MailStoryMode }) {
	const [boot, setBoot] = useState<BootstrappedWorkspace | null>(null)

	useEffect(() => {
		let cancelled = false
		let active: BootstrappedWorkspace | null = null
		useMailStore.getState().reset()
		void createPreviewWorkspace().then(async (b) => {
			if (cancelled) {
				b.engine.dispose()
				return
			}
			active = b
			await useMailStore.getState().loadInboxes(b.api)
			await useMailStore.getState().loadConversations(b.api)
			await useMailStore.getState().loadMailV2Metadata(b.api)
			const firstConv = useMailStore.getState().conversations[0]
			if (firstConv && mode !== 'settings') {
				await useMailStore.getState().selectConversation(b.api, firstConv.id)
				if (mode === 'compose') {
					useMailStore.getState().setComposeOpen(true)
				} else if (mode === 'bulk') {
					useMailStore.getState().toggleSelectConversation(firstConv.id)
				} else if (mode === 'contact') {
					useMailStore.getState().setContactSidebarOpen(true)
				} else if (mode === 'ai') {
					await useMailStore.getState().assistWithAi(b.api, firstConv.id, 'suggest_reply')
				} else if (mode === 'review') {
					const identities = await b.api.listMailIdentities()
					const identity = identities[0]
					if (identity && firstConv.customerEmail) {
						const draft = await useMailStore.getState().saveReplyDraft(b.api, firstConv.id, {
							identityId: identity.id,
							bodyText: 'Draft awaiting peer approval before sending to customer.',
							recipients: { to: [{ email: firstConv.customerEmail }] }
						})
						await useMailStore.getState().requestDraftReview(b.api, draft.id, { reviewerId: b.currentUserId })
					}
				}
			}
			setBoot(b)
		})
		return () => {
			cancelled = true
			active?.engine.dispose()
		}
	}, [mode])

	if (!boot) return null
	return (
		<div className="h-160 border border-border bg-background text-foreground">
			<TooltipProvider>
				<WorkspaceProvider boot={boot}>
					<SyncProvider engine={boot.engine}>
						{mode === 'settings' ? (
							<div className="h-full overflow-y-auto p-6">
								<MailSettingsPanel />
							</div>
						) : (
							<MailWorkspace />
						)}
					</SyncProvider>
				</WorkspaceProvider>
			</TooltipProvider>
		</div>
	)
}

const meta: Meta<typeof PreviewMailStory> = {
	title: 'Features/Mail/MailWorkspace',
	component: PreviewMailStory
}

export default meta

type Story = StoryObj<typeof meta>

export const SharedInboxDefault: Story = {
	args: { mode: 'default' }
}

export const ComposeDialogOpen: Story = {
	args: { mode: 'compose' }
}

export const BulkTriageSelected: Story = {
	args: { mode: 'bulk' }
}

export const ContactContextOpen: Story = {
	args: { mode: 'contact' }
}

export const ReviewGatePending: Story = {
	args: { mode: 'review' }
}

export const AiCopilotAssist: Story = {
	args: { mode: 'ai' }
}

export const SettingsV2: Story = {
	args: { mode: 'settings' }
}
