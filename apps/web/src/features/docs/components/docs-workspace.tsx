import type { DocCommentDto, DocHeadingDto, DocPageDetailDto, DocVersionDto } from '@huriro/contracts'
import type { EncodedAnchor } from '@huriro/editor'
import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import { FilePlus2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { navigateToDoc } from '@/lib/navigation'
import type { TaskApiBridge, WorkspaceMemberSummary } from '@/lib/sync-bootstrap'
import { type DocSidePanel, useUiStore } from '@/stores/ui-store'
import { CommentThreadPanel } from './comment-thread-panel'
import { CreateDocDialog } from './create-doc-dialog'
import { DocImportDialog } from './doc-import-dialog'
import { DocShareDialog } from './doc-share-dialog'
import { EditorShell } from './editor-shell'
import { TocRail } from './toc-rail'
import { VersionTimelinePanel } from './version-timeline-panel'

export interface DocsWorkspaceProps {
	readonly api: TaskApiBridge
	readonly currentUserId: string
	readonly isPreview: boolean
	readonly activeSlug: string | null
	readonly onSelectSlug?: (slug: string) => void
}

export function DocsWorkspace({
	api,
	currentUserId,
	isPreview,
	activeSlug,
	onSelectSlug
}: DocsWorkspaceProps) {
	const engine = useSyncEngine()
	const docPages = useCollectionItems(engine.collections.docPages)

	const activePanel = useUiStore((s) => s.activeDocSidePanel)
	const setActivePanel = useUiStore((s) => s.setActiveDocSidePanel)
	const setCreateDocOpen = useUiStore((s) => s.setCreateDocOpen)
	const pushToast = useUiStore((s) => s.pushToast)

	const [members, setMembers] = useState<WorkspaceMemberSummary[]>([])
	const [detail, setDetail] = useState<DocPageDetailDto | null>(null)
	const [headings, setHeadings] = useState<DocHeadingDto[]>([])
	const [comments, setComments] = useState<DocCommentDto[]>([])
	const [versions, setVersions] = useState<DocVersionDto[]>([])
	const [loadingDetail, setLoadingDetail] = useState(false)
	const [loadError, setLoadError] = useState<string | null>(null)
	const [draftAnchor, setDraftAnchor] = useState<EncodedAnchor | null>(null)
	const [draftQuote, setDraftQuote] = useState<string | null>(null)

	useEffect(() => {
		let cancelled = false
		void api
			.listMembers()
			.then((rows) => {
				if (!cancelled) setMembers(rows)
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [api])

	const membersById = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members])
	const currentMemberName = membersById.get(currentUserId)?.displayName ?? 'Member'

	const activePageSummary = useMemo(() => {
		if (!activeSlug) return null
		return docPages.find((p) => p.slug === activeSlug && p.archivedAt === null) ?? null
	}, [activeSlug, docPages])

	const loadPageDetail = useCallback(
		async (slug: string) => {
			setLoadingDetail(true)
			setLoadError(null)
			try {
				const loaded = await api.getDocBySlug(slug)
				setDetail(loaded)
				setHeadings(loaded.headings)
				setComments(loaded.comments)
				const verList = await api.listDocVersions(loaded.page.id).catch(() => [])
				setVersions(verList)
			} catch (err) {
				setDetail(null)
				setLoadError(err instanceof Error ? err.message : 'Failed to load document')
			} finally {
				setLoadingDetail(false)
			}
		},
		[api]
	)

	useEffect(() => {
		if (!activeSlug) {
			setDetail(null)
			setHeadings([])
			setComments([])
			setVersions([])
			setLoadError(null)
			return
		}
		void loadPageDetail(activeSlug)
	}, [activeSlug, loadPageDetail])

	const selectSlug = useCallback(
		(slug: string) => {
			if (onSelectSlug) onSelectSlug(slug)
			else navigateToDoc(slug)
		},
		[onSelectSlug]
	)

	async function handleExportMarkdown() {
		if (!detail) return
		const res = await api.exportDocMarkdown(detail.page.id)
		if (typeof Blob !== 'undefined' && typeof URL.createObjectURL === 'function') {
			const blob = new Blob([res.markdown], { type: 'text/markdown' })
			const url = URL.createObjectURL(blob)
			const anchor = document.createElement('a')
			anchor.href = url
			anchor.download = `${res.slug}.md`
			anchor.click()
			URL.revokeObjectURL(url)
		}
		pushToast({ tone: 'success', title: `${res.slug}.md` })
	}

	return (
		<div className="flex h-full min-h-0 flex-1 overflow-hidden">
			<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
				{!activeSlug ? (
					<EmptyState
						className="m-8"
						title={t('docs.empty.title')}
						hint={t('docs.empty.hint')}
						action={
							<Button type="button" size="sm" onClick={() => setCreateDocOpen(true)}>
								<FilePlus2 className="size-4" aria-hidden />
								<span>{t('docs.sidebar.new-page')}</span>
							</Button>
						}
					/>
				) : loadingDetail ? (
					<div className="space-y-3 p-8">
						<Skeleton className="h-8 w-64" />
						<Skeleton className="h-48 w-full" />
					</div>
				) : loadError ? (
					<ErrorState
						className="m-8"
						title={loadError}
						action={
							<Button
								type="button"
								size="sm"
								tone="outline"
								onClick={() => activeSlug && void loadPageDetail(activeSlug)}
							>
								{t('error.retry')}
							</Button>
						}
					/>
				) : detail ? (
					<EditorShell
						key={detail.page.id}
						detail={{
							...detail,
							page: activePageSummary ?? detail.page
						}}
						api={api}
						isPreview={isPreview}
						userDisplayName={currentMemberName}
						onUpdateTitle={async (title) => {
							await engine.updateDocPage(detail.page.id, { title })
						}}
						onToggleFavorite={async (favorite) => {
							const updated = await api.setDocFavorite(detail.page.id, favorite)
							engine.collections.docPagesManaged.upsertMany([updated])
							setDetail((prev) => (prev ? { ...prev, page: updated } : prev))
						}}
						onExportMarkdown={handleExportMarkdown}
						onSplitPage={async (title) => {
							const child = await api.splitDocPage(detail.page.id, title)
							engine.collections.docPagesManaged.upsertMany([child])
							selectSlug(child.slug)
						}}
						onStartAnchoredComment={(anchor, selectedText) => {
							setDraftAnchor(anchor)
							setDraftQuote(selectedText || null)
							setActivePanel('comments')
						}}
						onHeadingsChange={setHeadings}
					/>
				) : null}
			</div>

			{detail && activePanel ? (
				<aside
					aria-label={t('docs.panel.comments')}
					className="flex w-80 shrink-0 flex-col border-l border-border bg-card/40"
				>
					<Tabs
						value={activePanel}
						onValueChange={(v) => setActivePanel(v as Exclude<DocSidePanel, null>)}
						className="flex min-h-0 flex-1 flex-col"
					>
						<div className="border-b border-border px-3 py-2">
							<TabsList className="grid w-full grid-cols-3">
								<TabsTrigger value="comments">{t('docs.panel.comments')}</TabsTrigger>
								<TabsTrigger value="versions">{t('docs.panel.versions')}</TabsTrigger>
								<TabsTrigger value="toc">{t('docs.panel.toc')}</TabsTrigger>
							</TabsList>
						</div>

						<TabsContent
							forceMount
							value="comments"
							className="mt-0 min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
						>
							{activePanel === 'comments' ? (
								<CommentThreadPanel
									comments={comments}
									membersById={membersById}
									currentUserId={currentUserId}
									activeDraftQuote={draftQuote}
									onCreateComment={async (bodyText, parentId) => {
										const created = await api.createDocComment(detail.page.id, {
											bodyText,
											parentId: parentId ?? null,
											...(parentId
												? {}
												: draftAnchor
													? {
															anchorFrom: draftAnchor.anchorFrom,
															anchorTo: draftAnchor.anchorTo,
															anchorQuote: draftAnchor.anchorQuote,
															anchorBlockId: draftAnchor.anchorBlockId
														}
													: {})
										})
										setComments((prev) => [...prev, created])
										if (!parentId) {
											setDraftAnchor(null)
											setDraftQuote(null)
										}
									}}
									onResolveComment={async (commentId, resolved) => {
										const updated = await api.resolveDocComment(detail.page.id, commentId, resolved)
										setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
									}}
									onDeleteComment={async (commentId) => {
										await api.deleteDocComment(detail.page.id, commentId)
										setComments((prev) => prev.filter((c) => c.id !== commentId))
									}}
								/>
							) : null}
						</TabsContent>

						<TabsContent
							forceMount
							value="versions"
							className="mt-0 min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
						>
							{activePanel === 'versions' ? (
								<VersionTimelinePanel
									versions={versions}
									canWrite={detail.canWrite}
									onLoadDiff={(verId) => api.getDocVersionDetail(detail.page.id, verId)}
									onSaveSnapshot={async (label) => {
										const ver = await api.createDocVersion(detail.page.id, label)
										setVersions((prev) => [ver, ...prev])
									}}
									onRestore={async (verId) => {
										const res = await api.restoreDocVersion(detail.page.id, verId)
										setDetail(res.detail)
										setHeadings(res.detail.headings)
										setVersions((prev) => [res.checkpointVersion, ...prev])
										pushToast({ tone: 'success', title: t('docs.versions.restored-toast') })
									}}
								/>
							) : null}
						</TabsContent>

						<TabsContent
							forceMount
							value="toc"
							className="mt-0 min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
						>
							{activePanel === 'toc' ? <TocRail headings={headings} /> : null}
						</TabsContent>
					</Tabs>
				</aside>
			) : null}

			<CreateDocDialog
				pages={docPages}
				defaultParentId={detail?.page.id ?? null}
				onCreated={(page) => selectSlug(page.slug)}
			/>
			<DocShareDialog api={api} page={activePageSummary ?? detail?.page ?? null} members={members} />
			<DocImportDialog api={api} onImported={() => void engine.syncNow()} />
		</div>
	)
}
