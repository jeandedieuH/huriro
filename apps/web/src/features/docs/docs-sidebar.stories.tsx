import { activateI18n } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { type BootstrappedWorkspace, createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { WorkspaceProvider } from '@/lib/workspace'
import { DocsSidebarNav } from './components/docs-sidebar-nav'

activateI18n('en')

function PreviewDocsSidebarStory({
	slug = 'engineering-handbook',
	collapsed = false,
	empty = false,
	dark = false
}: {
	readonly slug?: string | null
	readonly collapsed?: boolean
	readonly empty?: boolean
	readonly dark?: boolean
}) {
	const [boot, setBoot] = useState<BootstrappedWorkspace | null>(null)
	const [activeSlug, setActiveSlug] = useState<string | null>(slug)

	useEffect(() => {
		setActiveSlug(slug)
	}, [slug])

	useEffect(() => {
		let cancelled = false
		let active: BootstrappedWorkspace | null = null
		void createPreviewWorkspace().then((b) => {
			if (cancelled) {
				b.engine.dispose()
				return
			}
			if (empty) {
				b.engine.collections.docPagesManaged.replaceAll([])
				b.engine.collections.teamspacesManaged.replaceAll([])
			}
			active = b
			setBoot(b)
		})
		return () => {
			cancelled = true
			active?.engine.dispose()
		}
	}, [empty])

	if (!boot) return null

	return (
		<div className={dark ? 'dark' : undefined}>
			<div className="flex h-160 border border-border bg-background text-foreground">
				<WorkspaceProvider boot={boot}>
					<SyncProvider engine={boot.engine}>
						<aside
							aria-label="Docs sidebar preview"
							className={
								collapsed
									? 'w-16 shrink-0 overflow-y-auto border-r border-sidebar-border bg-sidebar px-2 py-3 text-sidebar-foreground'
									: 'w-60 shrink-0 overflow-y-auto border-r border-sidebar-border bg-sidebar px-3 py-3 text-sidebar-foreground'
							}
						>
							<DocsSidebarNav activeSlug={activeSlug} collapsed={collapsed} onSelectSlug={setActiveSlug} />
						</aside>
					</SyncProvider>
				</WorkspaceProvider>
			</div>
		</div>
	)
}

const meta: Meta<typeof PreviewDocsSidebarStory> = {
	title: 'Features/Docs/DocsSidebarNav',
	component: PreviewDocsSidebarStory
}

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		slug: 'engineering-handbook'
	}
}

export const DarkTheme: Story = {
	args: {
		slug: 'engineering-handbook',
		dark: true
	}
}

export const CollapsedRail: Story = {
	args: {
		slug: 'engineering-handbook',
		collapsed: true
	}
}

export const EmptyWorkspace: Story = {
	args: {
		slug: null,
		empty: true
	}
}

export const InteractiveActions: Story = {
	args: {
		slug: 'engineering-handbook'
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		const filter = await canvas.findByRole('textbox', { name: 'Filter pages' })
		await userEvent.type(filter, 'runbook')
		await expect(await canvas.findByRole('region', { name: 'Results' })).toBeInTheDocument()

		await userEvent.keyboard('{Escape}')
		await expect(await canvas.findByRole('button', { name: 'Collapse all' })).toBeInTheDocument()

		await userEvent.click(canvas.getByRole('button', { name: 'Collapse all' }))
		await expect(await canvas.findByRole('button', { name: 'Expand all' })).toBeInTheDocument()
		await userEvent.click(canvas.getByRole('button', { name: 'Expand all' }))

		const triggers = await canvas.findAllByRole('button', { name: 'Engineering Handbook actions' })
		const target = triggers.at(-1)
		if (!target) throw new Error('Expected Engineering Handbook actions button')
		await userEvent.click(target)
		const body = within(document.body)
		await expect(await body.findByRole('menuitem', { name: /Rename/ })).toBeInTheDocument()
		await expect(await body.findByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument()
		await expect(await body.findByRole('menuitem', { name: 'Share & permissions' })).toBeInTheDocument()
		await expect(await body.findByRole('menuitem', { name: 'Publish' })).toBeInTheDocument()
		await expect(await body.findByRole('menuitem', { name: 'Export Markdown' })).toBeInTheDocument()
	}
}
