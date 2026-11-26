import type { DocPageDto, DocVisibility } from '@huriro/contracts'
import { generateKeyBetween } from '@huriro/domain'
import { t } from '@huriro/i18n'
import { generateUuidV7, useSyncEngine } from '@huriro/sync-client'
import { navigateToDestination } from '@/lib/navigation'
import { useOptionalWorkspace } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'
import { buildUniqueSlug, canDropPage, type DocsDropZone, isSelfOrDescendant } from './docs-sidebar-tree'

export interface CreatePageInput {
	readonly parentId: string | null
	/** `undefined` = inherit from parent; `null` = workspace root; id = teamspace root. */
	readonly teamspaceId?: string | null | undefined
}

export interface DocsSidebarActions {
	/** API-backed actions (favorite, duplicate, share, publish, export) are hidden without a booted workspace. */
	readonly hasApi: boolean
	readonly createPage: (input: CreatePageInput) => Promise<void>
	readonly renamePage: (page: DocPageDto, title: string) => Promise<void>
	readonly setPageIcon: (page: DocPageDto, icon: string | null) => Promise<void>
	readonly toggleFavorite: (page: DocPageDto) => Promise<void>
	readonly duplicatePage: (page: DocPageDto) => Promise<void>
	readonly copyPageLink: (page: DocPageDto) => Promise<void>
	readonly openInNewTab: (page: DocPageDto) => void
	readonly openShare: (page: DocPageDto) => void
	readonly openPublish: (page: DocPageDto) => void
	readonly exportMarkdown: (page: DocPageDto) => Promise<void>
	readonly toggleLock: (page: DocPageDto) => Promise<void>
	readonly archivePage: (page: DocPageDto) => Promise<void>
	readonly movePage: (page: DocPageDto, parentId: string | null, teamspaceId?: string | null) => Promise<void>
	readonly dropPage: (drag: DocPageDto, target: DocPageDto, zone: DocsDropZone) => Promise<void>
}

export interface UseDocsSidebarActionsOptions {
	readonly activePages: readonly DocPageDto[]
	readonly childrenByParent: ReadonlyMap<string | null, readonly DocPageDto[]>
	readonly activeSlug: string | null
	readonly selectSlug: (slug: string) => void
	/** Re-opens a collapsed branch so freshly created/moved children are visible. */
	readonly expandNode: (pageId: string) => void
}

/**
 * Every mutation the docs sidebar can perform on a page, behind one error boundary.
 * Writes go through the optimistic sync engine (offline-first); only favorites,
 * sharing/publishing dialogs, and markdown export use the HTTP bridge.
 */
export function useDocsSidebarActions({
	activePages,
	childrenByParent,
	activeSlug,
	selectSlug,
	expandNode
}: UseDocsSidebarActionsOptions): DocsSidebarActions {
	const engine = useSyncEngine()
	const workspace = useOptionalWorkspace()
	const pushToast = useUiStore((s) => s.pushToast)
	const api = workspace?.api ?? null

	/** Runs an action and turns any failure into a danger toast instead of an unhandled rejection. */
	async function guarded(action: () => Promise<void>) {
		try {
			await action()
		} catch (err) {
			pushToast({
				tone: 'danger',
				title: t('docs.sidebar.action-failed'),
				description: err instanceof Error ? err.message : undefined
			})
		}
	}

	return {
		hasApi: api !== null,

		createPage: ({ parentId, teamspaceId }) =>
			guarded(async () => {
				const id = generateUuidV7()
				const title = t('docs.sidebar.untitled')
				const created = await engine.createDocPage({
					id,
					title,
					slug: buildUniqueSlug(title, id),
					parentId,
					...(teamspaceId !== undefined ? { teamspaceId } : {})
				})
				if (parentId) expandNode(parentId)
				selectSlug(created.slug)
			}),

		renamePage: (page, title) =>
			guarded(async () => {
				const clean = title.trim().slice(0, 200)
				if (!clean || clean === page.title) return
				await engine.updateDocPage(page.id, { title: clean })
			}),

		setPageIcon: (page, icon) =>
			guarded(async () => {
				await engine.updateDocPage(page.id, { icon })
			}),

		toggleFavorite: (page) =>
			guarded(async () => {
				if (!api) return
				const updated = await api.setDocFavorite(page.id, !page.isFavorite)
				engine.collections.docPagesManaged.upsertMany([updated])
			}),

		duplicatePage: (page) =>
			guarded(async () => {
				if (!api) return
				const { markdown } = await api.exportDocMarkdown(page.id)
				const id = generateUuidV7()
				const title = t('docs.sidebar.duplicate-title', { title: page.title }).slice(0, 200)
				const visibility: DocVisibility = page.visibility

				// Compute the fractional slot right after the source upfront so duplication is one atomic mutation.
				const siblings = childrenByParent.get(page.parentId) ?? []
				const next = siblings[siblings.findIndex((p) => p.id === page.id) + 1]
				let position: string | undefined
				try {
					position = generateKeyBetween(page.position, next?.position ?? null)
				} catch {
					// Duplicate sibling keys or malformed positions fall back to appending at the tail.
					position = undefined
				}

				const created = await engine.createDocPage({
					id,
					title,
					slug: buildUniqueSlug(title, id),
					parentId: page.parentId,
					teamspaceId: page.teamspaceId ?? null,
					visibility,
					icon: page.icon,
					...(position ? { position } : {}),
					...(markdown ? { markdown } : {})
				})

				pushToast({ tone: 'success', title: t('docs.sidebar.duplicated-toast'), description: created.title })
				selectSlug(created.slug)
			}),

		copyPageLink: (page) =>
			guarded(async () => {
				if (typeof navigator === 'undefined' || !navigator.clipboard) {
					throw new Error('Clipboard is unavailable in this context')
				}
				await navigator.clipboard.writeText(`${window.location.origin}/docs/${page.slug}`)
				pushToast({ tone: 'success', title: t('docs.sidebar.link-copied') })
			}),

		openInNewTab: (page) => {
			if (typeof window === 'undefined') return
			window.open(`/docs/${encodeURIComponent(page.slug)}`, '_blank', 'noopener,noreferrer')
		},

		openShare: (page) => {
			selectSlug(page.slug)
			useUiStore.getState().setDocShareOpen(true)
		},

		openPublish: (page) => {
			selectSlug(page.slug)
			useUiStore.getState().setDocPublishOpen(true)
		},

		exportMarkdown: (page) =>
			guarded(async () => {
				if (!api) return
				const res = await api.exportDocMarkdown(page.id)
				const filename = `${res.slug}.md`
				if (typeof document !== 'undefined' && typeof URL.createObjectURL === 'function') {
					const blob = new Blob([res.markdown], { type: 'text/markdown' })
					const url = URL.createObjectURL(blob)
					const link = document.createElement('a')
					link.href = url
					link.download = filename
					document.body.append(link)
					link.click()
					link.remove()
					URL.revokeObjectURL(url)
				}
				pushToast({ tone: 'success', title: t('docs.sidebar.exported-toast', { filename }) })
			}),

		toggleLock: (page) =>
			guarded(async () => {
				await engine.updateDocPage(page.id, { isLocked: !page.isLocked })
			}),

		archivePage: (page) =>
			guarded(async () => {
				const isArchivingActive =
					activeSlug !== null && activePages.some((p) => p.slug === activeSlug && isSelfOrDescendant(page, p))
				await engine.deleteDocPage(page.id)
				if (isArchivingActive) navigateToDestination('docs')
			}),

		movePage: (page, parentId, teamspaceId) =>
			guarded(async () => {
				const nextTeamspace = teamspaceId === undefined ? undefined : (teamspaceId ?? null)
				const teamspaceChanged = nextTeamspace !== undefined && nextTeamspace !== (page.teamspaceId ?? null)
				if (parentId === page.parentId) {
					if (!teamspaceChanged) return
					await engine.updateDocPage(page.id, { teamspaceId: nextTeamspace })
				} else {
					await engine.moveDocPage(page.id, { parentId })
					if (parentId) expandNode(parentId)
				}
				pushToast({ tone: 'success', title: t('docs.sidebar.moved-here', { title: page.title }) })
			}),

		dropPage: (drag, target, zone) =>
			guarded(async () => {
				if (!canDropPage(drag, target, zone)) return

				if (zone === 'inside') {
					await engine.moveDocPage(drag.id, { parentId: target.id })
					expandNode(target.id)
					return
				}

				// Reorder among the target's siblings, ignoring the dragged page itself.
				const siblings = (childrenByParent.get(target.parentId) ?? []).filter((p) => p.id !== drag.id)
				const index = siblings.findIndex((p) => p.id === target.id)
				await engine.moveDocPage(drag.id, {
					parentId: target.parentId,
					afterPageId: zone === 'before' ? (siblings[index - 1]?.id ?? null) : target.id,
					beforePageId: zone === 'before' ? target.id : (siblings[index + 1]?.id ?? null)
				})
			})
	}
}
