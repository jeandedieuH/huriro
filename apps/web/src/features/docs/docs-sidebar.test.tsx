import { activateI18n, t } from '@huriro/i18n'
import { SyncProvider } from '@huriro/sync-client'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { createPreviewWorkspace } from '@/lib/sync-bootstrap'
import { expectNoViolations } from '@/lib/test-setup'
import { WorkspaceProvider } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'
import { DocsSidebarNav } from './components/docs-sidebar-nav'
import {
	buildChildrenIndex,
	buildUniqueSlug,
	canDropPage,
	collectExpandableIds,
	filterPagesByQuery,
	flattenTreeForSelect,
	resolveDropZone
} from './components/sidebar/docs-sidebar-tree'

activateI18n('en')

const HANDBOOK_TITLE = 'Engineering Handbook'
const RFC_TITLE = 'RFC-008: CRDT Collaboration Architecture'

async function renderSidebar(onSelectSlug = vi.fn(), options: { readonly collapsed?: boolean } = {}) {
	const boot = await createPreviewWorkspace()
	const rendered = render(
		<TooltipProvider>
			<WorkspaceProvider boot={boot}>
				<SyncProvider engine={boot.engine}>
					<DocsSidebarNav activeSlug={null} collapsed={options.collapsed} onSelectSlug={onSelectSlug} />
				</SyncProvider>
			</WorkspaceProvider>
		</TooltipProvider>
	)
	const handbook = boot.engine.collections.docPages.toArray.find((p) => p.title === HANDBOOK_TITLE)
	if (!handbook) throw new Error('Preview workspace is missing the Engineering Handbook page')
	return { boot, handbook, onSelectSlug, ...rendered }
}

/**
 * Opens a page's action menu the way keyboard users do (Radix triggers ignore bare click events in jsdom).
 * A favourited page also renders in the Favorites section, so target the last match — the tree row.
 */
function openActionsMenu(title: string) {
	const trigger = screen.getAllByRole('button', { name: `${title} actions` }).at(-1)
	if (!trigger) throw new Error(`No actions trigger for ${title}`)
	fireEvent.keyDown(trigger, { key: 'Enter' })
}

describe('DocsSidebarNav redesign', () => {
	beforeEach(() => {
		useUiStore.setState({
			createDocOpen: false,
			docShareOpen: false,
			docPublishOpen: false,
			toasts: []
		})
	})

	it('renders the tree with zero axe violations', async () => {
		const { boot, container } = await renderSidebar()
		try {
			expect(await screen.findByRole('navigation', { name: 'Workspace pages' })).toBeInTheDocument()
			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('renders standalone without an outer TooltipProvider with zero axe violations', async () => {
		const boot = await createPreviewWorkspace()
		const { container } = render(
			<SyncProvider engine={boot.engine}>
				<DocsSidebarNav activeSlug={null} />
			</SyncProvider>
		)
		try {
			expect(await screen.findByRole('navigation', { name: 'Workspace pages' })).toBeInTheDocument()
			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('renders collapsed rail mode with root pages and explore actions with zero axe violations', async () => {
		const boot = await createPreviewWorkspace()
		const { container } = render(
			<WorkspaceProvider boot={boot}>
				<SyncProvider engine={boot.engine}>
					<DocsSidebarNav activeSlug="databases" collapsed />
				</SyncProvider>
			</WorkspaceProvider>
		)
		try {
			expect(screen.getByRole('button', { name: HANDBOOK_TITLE })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: t('databases.home.title') })).toHaveAttribute(
				'aria-current',
				'page'
			)
			expect(screen.getByRole('button', { name: 'Knowledge Graph' })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: 'Manage teamspaces' })).toBeInTheDocument()
			await expectNoViolations(container)
		} finally {
			boot.engine.dispose()
		}
	})

	it('filters pages by title, shows the parent trail and clears with Escape', async () => {
		const { boot } = await renderSidebar()
		try {
			const filter = await screen.findByRole('textbox', { name: 'Filter pages' })
			fireEvent.change(filter, { target: { value: 'runbook' } })

			const results = await screen.findByRole('region', { name: 'Results' })
			expect(within(results).getByRole('button', { name: 'Incident Response Runbook' })).toBeInTheDocument()

			fireEvent.keyDown(filter, { key: 'Escape' })
			await waitFor(() => expect(screen.queryByRole('region', { name: 'Results' })).not.toBeInTheDocument())
		} finally {
			boot.engine.dispose()
		}
	})

	it('shows an empty-result message for unmatched filters', async () => {
		const { boot } = await renderSidebar()
		try {
			const filter = await screen.findByRole('textbox', { name: 'Filter pages' })
			fireEvent.change(filter, { target: { value: 'zzzz-no-match' } })
			expect(await screen.findByText('No pages match “zzzz-no-match”.')).toBeInTheDocument()
		} finally {
			boot.engine.dispose()
		}
	})

	it('toggles all expandable branches via Collapse all and Expand all', async () => {
		const { boot } = await renderSidebar()
		try {
			expect(screen.getByRole('button', { name: RFC_TITLE })).toBeInTheDocument()

			fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
			await waitFor(() => {
				expect(screen.queryByRole('button', { name: RFC_TITLE })).not.toBeInTheDocument()
			})

			fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
			expect(await screen.findByRole('button', { name: RFC_TITLE })).toBeInTheDocument()
		} finally {
			boot.engine.dispose()
		}
	})

	it('collapses and expands sections via their header toggle', async () => {
		const { boot } = await renderSidebar()
		try {
			expect(screen.getByRole('button', { name: 'Incident Response Runbook' })).toBeInTheDocument()

			fireEvent.click(screen.getByRole('button', { name: 'Collapse Workspace Docs' }))
			expect(screen.queryByRole('button', { name: 'Incident Response Runbook' })).not.toBeInTheDocument()

			fireEvent.click(screen.getByRole('button', { name: 'Expand Workspace Docs' }))
			expect(screen.getByRole('button', { name: 'Incident Response Runbook' })).toBeInTheDocument()
		} finally {
			boot.engine.dispose()
		}
	})

	it('adds a subpage under a page and opens it', async () => {
		const { boot, handbook, onSelectSlug } = await renderSidebar()
		try {
			const [addButton] = screen.getAllByRole('button', { name: `Add subpage to ${HANDBOOK_TITLE}` })
			if (!addButton) throw new Error('Expected add-subpage button')
			fireEvent.click(addButton)

			await waitFor(() => {
				const child = boot.engine.collections.docPages.toArray.find(
					(p) => p.parentId === handbook.id && p.title === 'Untitled'
				)
				expect(child).toBeDefined()
				expect(onSelectSlug).toHaveBeenCalledWith(child?.slug)
			})
		} finally {
			boot.engine.dispose()
		}
	})

	it('renames a page inline from the actions menu', async () => {
		const { boot, handbook } = await renderSidebar()
		try {
			openActionsMenu(HANDBOOK_TITLE)
			fireEvent.click(await screen.findByRole('menuitem', { name: /Rename/ }))

			const input = await screen.findByRole('textbox', { name: 'Page title' })
			fireEvent.change(input, { target: { value: 'Engineering Playbook' } })
			fireEvent.keyDown(input, { key: 'Enter' })

			await waitFor(() => {
				expect(boot.engine.collections.docPages.get(handbook.id)?.title).toBe('Engineering Playbook')
			})
		} finally {
			boot.engine.dispose()
		}
	})

	it('cancels an inline rename with Escape', async () => {
		const { boot, handbook } = await renderSidebar()
		try {
			openActionsMenu(HANDBOOK_TITLE)
			fireEvent.click(await screen.findByRole('menuitem', { name: /Rename/ }))

			const input = await screen.findByRole('textbox', { name: 'Page title' })
			fireEvent.change(input, { target: { value: 'Should not stick' } })
			fireEvent.keyDown(input, { key: 'Escape' })

			await waitFor(() =>
				expect(screen.queryByRole('textbox', { name: 'Page title' })).not.toBeInTheDocument()
			)
			expect(boot.engine.collections.docPages.get(handbook.id)?.title).toBe(HANDBOOK_TITLE)
		} finally {
			boot.engine.dispose()
		}
	})

	it('toggles favorite and lock from the menu, and disables destructive actions while locked', async () => {
		const { boot, handbook } = await renderSidebar()
		try {
			// Preview seed data may already favourite the page — assert the toggle flips whichever state it starts in.
			const wasFavorite = handbook.isFavorite
			openActionsMenu(HANDBOOK_TITLE)
			fireEvent.click(
				await screen.findByRole('menuitem', {
					name: wasFavorite ? 'Remove from favorites' : 'Add to favorites'
				})
			)
			await waitFor(() =>
				expect(boot.engine.collections.docPages.get(handbook.id)?.isFavorite).toBe(!wasFavorite)
			)

			openActionsMenu(HANDBOOK_TITLE)
			fireEvent.click(await screen.findByRole('menuitem', { name: 'Lock page' }))
			await waitFor(() => expect(boot.engine.collections.docPages.get(handbook.id)?.isLocked).toBe(true))

			openActionsMenu(HANDBOOK_TITLE)
			expect(await screen.findByRole('menuitem', { name: 'Archive page' })).toHaveAttribute('data-disabled')
			expect(screen.getByRole('menuitem', { name: 'Unlock page' })).not.toHaveAttribute('data-disabled')
		} finally {
			boot.engine.dispose()
		}
	})

	it('duplicates a page next to its source', async () => {
		const { boot, handbook, onSelectSlug } = await renderSidebar()
		try {
			openActionsMenu(HANDBOOK_TITLE)
			fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }))

			await waitFor(() => {
				const copy = boot.engine.collections.docPages.toArray.find(
					(p) => p.title === `${HANDBOOK_TITLE} (copy)` && p.parentId === handbook.parentId
				)
				expect(copy).toBeDefined()
				expect(onSelectSlug).toHaveBeenCalledWith(copy?.slug)
			})
		} finally {
			boot.engine.dispose()
		}
	})

	it('opens share and publish dialogs for the target page from the menu', async () => {
		const { boot, handbook, onSelectSlug } = await renderSidebar()
		try {
			openActionsMenu(HANDBOOK_TITLE)
			fireEvent.click(await screen.findByRole('menuitem', { name: 'Share & permissions' }))
			expect(onSelectSlug).toHaveBeenCalledWith(handbook.slug)
			expect(useUiStore.getState().docShareOpen).toBe(true)

			openActionsMenu(HANDBOOK_TITLE)
			fireEvent.click(await screen.findByRole('menuitem', { name: 'Publish' }))
			expect(onSelectSlug).toHaveBeenCalledWith(handbook.slug)
			expect(useUiStore.getState().docPublishOpen).toBe(true)
		} finally {
			boot.engine.dispose()
		}
	})

	it('exports markdown and shows a confirmation toast', async () => {
		const { boot, handbook } = await renderSidebar()
		const exportSpy = vi.spyOn(boot.api, 'exportDocMarkdown')
		try {
			openActionsMenu(HANDBOOK_TITLE)
			fireEvent.click(await screen.findByRole('menuitem', { name: 'Export Markdown' }))

			await waitFor(() => {
				expect(exportSpy).toHaveBeenCalledWith(handbook.id)
				expect(
					useUiStore.getState().toasts.some((toast) => toast.title === `Exported ${handbook.slug}.md`)
				).toBe(true)
			})
		} finally {
			exportSpy.mockRestore()
			boot.engine.dispose()
		}
	})

	it('opens a page in a new tab and copies its link', async () => {
		const { boot, handbook } = await renderSidebar()
		const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
		const writeText = vi.fn().mockResolvedValue(undefined)
		const prevClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText }
		})

		try {
			openActionsMenu(HANDBOOK_TITLE)
			fireEvent.click(await screen.findByRole('menuitem', { name: 'Open in new tab' }))
			expect(openSpy).toHaveBeenCalledWith(`/docs/${handbook.slug}`, '_blank', 'noopener,noreferrer')

			openActionsMenu(HANDBOOK_TITLE)
			fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy link' }))
			await waitFor(() => {
				expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/docs/${handbook.slug}`)
				expect(useUiStore.getState().toasts.some((toast) => toast.title === 'Link copied')).toBe(true)
			})
		} finally {
			openSpy.mockRestore()
			if (prevClipboard) Object.defineProperty(navigator, 'clipboard', prevClipboard)
			else Reflect.deleteProperty(navigator, 'clipboard')
			boot.engine.dispose()
		}
	})
})

describe('docs sidebar tree helpers', () => {
	const base = {
		workspaceId: 'w',
		coverFileId: null,
		coverGradient: null,
		coverPositionY: 50,
		fontStyle: 'sans',
		fullWidth: false,
		smallText: false,
		isLocked: false,
		lockedBy: null,
		lockedAt: null,
		verificationStatus: null,
		verificationExpiresAt: null,
		visibility: 'workspace',
		isTemplate: false,
		isFavorite: false,
		createdBy: 'u',
		archivedAt: null,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		version: 1,
		byteSize: 0,
		icon: null,
		slug: 's',
		position: 'a0'
	} as const

	function page(
		id: string,
		parentId: string | null,
		path: string,
		title = id,
		teamspaceId: string | null = null,
		position = 'a0'
	) {
		return {
			...base,
			id,
			parentId,
			path,
			depth: path.split('/').length - 1,
			title,
			teamspaceId,
			position
		} as never as Parameters<typeof canDropPage>[0]
	}

	it('refuses drops onto self or descendants and no-op nesting', () => {
		const parent = page('p', null, 'p')
		const child = page('c', 'p', 'p/c')
		expect(canDropPage(parent, parent, 'inside')).toBe(false)
		expect(canDropPage(parent, child, 'before')).toBe(false)
		expect(canDropPage(child, parent, 'inside')).toBe(false)
	})

	it('keeps root-level reordering inside one teamspace', () => {
		const a = page('a', null, 'a', 'a', 'ts1')
		const b = page('b', null, 'b', 'b', 'ts2')
		const c = page('c', null, 'c', 'c', 'ts1')
		expect(canDropPage(a, b, 'after')).toBe(false)
		expect(canDropPage(a, c, 'after')).toBe(true)
		expect(canDropPage(a, b, 'inside')).toBe(true)
	})

	it('resolves drop zones from pointer offset', () => {
		expect(resolveDropZone(2, 32)).toBe('before')
		expect(resolveDropZone(16, 32)).toBe('inside')
		expect(resolveDropZone(30, 32)).toBe('after')
	})

	it('filters diacritic-insensitively with prefix matches first', () => {
		const pages = [
			page('1', null, '1', 'Deep Résumé'),
			page('2', null, '2', 'Resume tips'),
			page('3', null, '3', 'Other')
		]
		expect(filterPagesByQuery(pages, 'resume').map((p) => p.id)).toEqual(['2', '1'])
	})

	it('builds slugs that satisfy the contract pattern and never collide', () => {
		const pattern = /^[a-z0-9][a-z0-9-]{0,118}[a-z0-9]$|^[a-z0-9]$/
		const slugA = buildUniqueSlug('Untitled', '01890000-0000-7000-8000-000000aaaaaa')
		const slugB = buildUniqueSlug('Untitled', '01890000-0000-7000-8000-000000bbbbbb')
		expect(slugA).toMatch(pattern)
		expect(slugA).not.toBe(slugB)
		expect(buildUniqueSlug('✨✨', '01890000-0000-7000-8000-000000cccccc')).toMatch(pattern)
	})

	it('flattens pages depth-first while excluding target and its subtree', () => {
		const rootA = page('a', null, 'a', 'Alpha', null, 'a0')
		const childA1 = page('a1', 'a', 'a/a1', 'Alpha Child', null, 'a0')
		const grandA1 = page('a2', 'a1', 'a/a1/a2', 'Alpha Grandchild', null, 'a0')
		const rootB = page('b', null, 'b', 'Beta', null, 'a1')
		const childB1 = page('b1', 'b', 'b/b1', 'Beta Child', null, 'a0')

		const flattened = flattenTreeForSelect([rootB, grandA1, rootA, childB1, childA1], childA1)
		expect(flattened.map((item) => ({ id: item.page.id, depth: item.depth }))).toEqual([
			{ id: 'a', depth: 0 },
			{ id: 'b', depth: 0 },
			{ id: 'b1', depth: 1 }
		])
	})

	it('collects only non-null parent ids with children', () => {
		const rootA = page('a', null, 'a')
		const childA1 = page('a1', 'a', 'a/a1')
		const rootB = page('b', null, 'b')
		const index = buildChildrenIndex([rootA, childA1, rootB])
		expect(collectExpandableIds(index)).toEqual(['a'])
	})
})
