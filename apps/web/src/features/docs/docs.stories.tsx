import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { type BootstrappedWorkspace, createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { DocsSidebarNav } from './components/docs-sidebar-nav'
import { DocsWorkspace } from './components/docs-workspace'

activateI18n('en')

function PreviewDocsStory({ slug }: { readonly slug: string | null }) {
	const [boot, setBoot] = useState<BootstrappedWorkspace | null>(null)

	useEffect(() => {
		let cancelled = false
		let active: BootstrappedWorkspace | null = null
		void createPreviewWorkspace().then((b) => {
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
	}, [])

	if (!boot) return null
	return (
		<div className="flex h-160 border border-border bg-background text-foreground">
			<SyncProvider engine={boot.engine}>
				<div className="w-60 shrink-0 border-r border-border bg-sidebar p-3">
					<DocsSidebarNav activeSlug={slug} />
				</div>
				<DocsWorkspace api={boot.api} currentUserId={boot.currentUserId} isPreview={true} activeSlug={slug} />
			</SyncProvider>
		</div>
	)
}

const meta: Meta<typeof PreviewDocsStory> = {
	title: 'Features/Docs/DocsWorkspace',
	component: PreviewDocsStory
}

export default meta

type Story = StoryObj<typeof meta>

export const ActivePage: Story = {
	args: {
		slug: 'engineering-handbook'
	}
}

export const EmptyWorkspace: Story = {
	args: {
		slug: null
	}
}
