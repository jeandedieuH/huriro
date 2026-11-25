import type {
	DocCommentDto,
	DocHeadingDto,
	DocPageDetailDto,
	DocSuggestionDto,
	DocVersionDto,
	ProposeDocSuggestionBody,
	SetDocVerificationBody,
	UpdateDocPageBody
} from '@huriro/contracts'
import type { EncodedAnchor } from '@huriro/editor'
import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import { FilePlus2, FileText, Star, X } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { navigateToDestination, navigateToDoc } from '@/lib/navigation'
import type { TaskApiBridge, WorkspaceMemberSummary } from '@/lib/sync-bootstrap'
import { type DocSidePanel, useUiStore } from '@/stores/ui-store'
import { CommentThreadPanel } from './comment-thread-panel'
import { CreateDocDialog } from './create-doc-dialog'
import { DocImportDialog } from './doc-import-dialog'
import { DocShareDialog } from './doc-share-dialog'
import { SuggestionReviewPanel } from './suggestion-review-panel'
import { TocRail } from './toc-rail'
import { VersionTimelinePanel } from './version-timeline-panel'

// Lazy-load TipTap/Hocuspocus editor shell & heavy dialogs to keep initial web shell <= 200 KB gzip (§21.4).
const EditorShell = lazy(() => import('./editor-shell').then((m) => ({ default: m.EditorShell })))
const TeamspaceManagerDialog = lazy(() =>
	import('./teamspace-manager-dialog').then((m) => ({ default: m.TeamspaceManagerDialog }))
)
const DocPublishDialog = lazy(() =>
	import('./doc-publish-dialog').then((m) => ({ default: m.DocPublishDialog }))
)
const KnowledgeGraphView = lazy(() =>
	import('./knowledge-graph-view').then((m) => ({ default: m.KnowledgeGraphView }))
)

export interface DocsWorkspaceProps {
	readonly api: TaskApiBridge
	readonly currentUserId: string
	readonly isPreview: boolean
	readonly activeSlug: string | null
	readonly onSelectSlug?: (slug: string) => void
}

function triggerBlobDownload(blob: Blob, filename: string) {
	if (typeof URL.createObjectURL !== 'function' || typeof document === 'undefined') return
	const url = URL.createObjectURL(blob)
	const anchor = document.createElement('a')
	anchor.href = url
	anchor.download = filename
	anchor.click()
	URL.revokeObjectURL(url)
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
	const teamspaceManagerOpen = useUiStore((s) => s.teamspaceManagerOpen)
	const docPublishOpen = useUiStore((s) => s.docPublishOpen)
	const docsGraphOpen = useUiStore((s) => s.docsGraphOpen)
	const pushToast = useUiStore((s) => s.pushToast)

	const [members, setMembers] = useState<WorkspaceMemberSummary[]>([])
	const [detail, setDetail] = useState<DocPageDetailDto | null>(null)
	const [headings, setHeadings] = useState<DocHeadingDto[]>([])
	const [comments, setComments] = useState<DocCommentDto[]>([])
	const [suggestions, setSuggestions] = useState<DocSuggestionDto[]>([])
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

	const selectSlug = useCallback(
		(slug: string) => {
			if (onSelectSlug) onSelectSlug(slug)
			else navigateToDoc(slug)
		},
		[onSelectSlug]
	)

	const loadSeqRef = useRef(0)
	const createdSlugToIdRef = useRef<Map<string, string>>(new Map())
	const seenLoadedPageIdRef = useRef<string | null>(null)
	const loadPageDetail = useCallback(
		async (slug: string) => {
			const seq = ++loadSeqRef.current
			setLoadingDetail(true)
			setLoadError(null)
			try {
				let targetSlug = slug
				// Wait for an optimistic create outbox flush before querying /by-slug so newly created pages don't 404.
				const pendingIds = engine.getPendingMutationIds()
				const pendingMatch = engine.collections.docPages.toArray.find(
					(p) => p.slug === slug && p.archivedAt === null && pendingIds.has(p.id)
				)
				const mappedCreatedId = createdSlugToIdRef.current.get(slug)
				if (pendingMatch && !isPreview && engine.getStatus().online) {
					await engine.flushOutbox({ force: true })
					if (seq !== loadSeqRef.current) return
				}
				const resolvedId = mappedCreatedId ?? pendingMatch?.id
				if (resolvedId) {
					const updated = engine.collections.docPages.get(resolvedId)
					if (updated && updated.archivedAt === null && updated.slug !== slug) {
						createdSlugToIdRef.current.delete(slug)
						targetSlug = updated.slug
						selectSlug(updated.slug)
					}
				}

				let loaded: DocPageDetailDto
				try {
					loaded = await api.getDocBySlug(targetSlug)
				} catch (err) {
					const status = (err as { status?: number } | null)?.status
					const localMatch = engine.collections.docPages.toArray.find(
						(p) => p.slug === targetSlug && p.archivedAt === null
					)
					const isPendingCreate = localMatch ? engine.getPendingMutationIds().has(localMatch.id) : false
					if (status === 404 && !isPreview && engine.getStatus().online && localMatch && !isPendingCreate) {
						const synced = await engine.resyncSnapshot()
						if (seq !== loadSeqRef.current) return
						if (!synced) throw err
						const refreshedById = engine.collections.docPages.get(localMatch.id)
						if (refreshedById && refreshedById.archivedAt === null) {
							if (refreshedById.slug !== targetSlug) {
								selectSlug(refreshedById.slug)
							}
							loaded = await api.getDocBySlug(refreshedById.slug)
						} else {
							navigateToDestination('docs')
							throw err
						}
					} else {
						throw err
					}
				}

				if (seq !== loadSeqRef.current) return
				createdSlugToIdRef.current.delete(slug)
				createdSlugToIdRef.current.delete(targetSlug)
				setDetail(loaded)
				setHeadings(loaded.headings)
				setComments(loaded.comments)
				setSuggestions(loaded.suggestions ?? [])
				const [verList, sugList] = await Promise.all([
					api.listDocVersions(loaded.page.id).catch(() => []),
					loaded.suggestions
						? Promise.resolve(loaded.suggestions)
						: api.listDocSuggestions(loaded.page.id).catch(() => [])
				])
				if (seq !== loadSeqRef.current) return
				setVersions(verList)
				setSuggestions(sugList)
			} catch (err) {
				if (seq !== loadSeqRef.current) return
				setDetail(null)
				setLoadError(err instanceof Error ? err.message : 'Failed to load document')
			} finally {
				if (seq === loadSeqRef.current) {
					setLoadingDetail(false)
				}
			}
		},
		[api, engine, isPreview, selectSlug]
	)

	useEffect(() => {
		if (!detail) {
			seenLoadedPageIdRef.current = null
			return
		}
		const stillPresent = docPages.some((p) => p.id === detail.page.id && p.archivedAt === null)
		if (stillPresent) {
			seenLoadedPageIdRef.current = detail.page.id
			return
		}
		if (seenLoadedPageIdRef.current === detail.page.id) {
			seenLoadedPageIdRef.current = null
			setDetail(null)
			navigateToDestination('docs')
		} else {
			seenLoadedPageIdRef.current = null
		}
	}, [detail, docPages])

	useEffect(() => {
		if (!activeSlug) {
			loadSeqRef.current += 1
			setDetail(null)
			setHeadings([])
			setComments([])
			setSuggestions([])
			setVersions([])
			setLoadError(null)
			return
		}
		void loadPageDetail(activeSlug)
	}, [activeSlug, loadPageDetail])

	async function handleExportMarkdown() {
		if (!detail) return
		const res = await api.exportDocMarkdown(detail.page.id)
		triggerBlobDownload(new Blob([res.markdown], { type: 'text/markdown' }), `${res.slug}.md`)
		pushToast({ tone: 'success', title: `${res.slug}.md` })
	}

	async function handleExportHtml(print: boolean) {
		if (!detail) return
		const res = await api.exportDocHtml(detail.page.id, print)
		if (print && typeof window !== 'undefined' && typeof window.open === 'function') {
			const win = window.open('', '_blank', 'noopener,noreferrer')
			if (win) {
				win.document.write(res.html)
				win.document.close()
				return
			}
		}
		triggerBlobDownload(new Blob([res.html], { type: 'text/html' }), `${res.slug}.html`)
		pushToast({ tone: 'success', title: `${res.slug}.html` })
	}

	async function handleExportZip() {
		if (!detail) return
		const blob = await api.exportDocZip(detail.page.id, true)
		triggerBlobDownload(blob, `${detail.page.slug}.zip`)
		pushToast({ tone: 'success', title: `${detail.page.slug}.zip` })
	}

	async function handleUpdatePageMeta(patch: Omit<UpdateDocPageBody, 'version'>) {
		if (!detail) return
		await engine.updateDocPage(detail.page.id, patch)
		const refreshed = engine.collections.docPages.get(detail.page.id)
		if (refreshed) {
			setDetail((prev) => (prev ? { ...prev, page: refreshed } : prev))
		}
	}

	async function handleVerifyPage(body: SetDocVerificationBody) {
		if (!detail) return
		const verification = await api.setDocVerification(detail.page.id, body)
		setDetail((prev) =>
			prev
				? {
						...prev,
						verification,
						page: {
							...prev.page,
							verificationStatus: verification.status,
							verificationExpiresAt: verification.expiresAt
						}
					}
				: prev
		)
	}

	async function handleClearVerification() {
		if (!detail) return
		await api.clearDocVerification(detail.page.id)
		setDetail((prev) =>
			prev
				? {
						...prev,
						verification: null,
						page: { ...prev.page, verificationStatus: 'unverified', verificationExpiresAt: null }
					}
				: prev
		)
	}

	async function handleProposeSuggestion(body: ProposeDocSuggestionBody) {
		if (!detail) return
		const created = await api.proposeDocSuggestion(detail.page.id, body)
		setSuggestions((prev) => [created, ...prev.filter((s) => s.groupId !== created.groupId)])
		const refreshed = await api.getDocDetail(detail.page.id).catch(() => null)
		if (refreshed) setDetail(refreshed)
	}

	async function handleDecideSuggestion(groupId: string, decision: 'accept' | 'reject') {
		if (!detail) return
		const updated = await api.decideDocSuggestion(detail.page.id, groupId, decision)
		setSuggestions((prev) => prev.map((s) => (s.groupId === groupId ? updated : s)))
		const refreshed = await api.getDocDetail(detail.page.id).catch(() => null)
		if (refreshed) setDetail(refreshed)
	}

	async function handleDecideAllSuggestions(decision: 'accept' | 'reject') {
		if (!detail) return
		await api.decideAllDocSuggestions(detail.page.id, decision)
		const [refreshed, latestSuggestions] = await Promise.all([
			api.getDocDetail(detail.page.id).catch(() => null),
			api.listDocSuggestions(detail.page.id).catch(() => suggestions)
		])
		if (refreshed) setDetail(refreshed)
		setSuggestions(latestSuggestions)
	}

	const openSuggestionCount = useMemo(
		() => suggestions.filter((s) => s.status === 'open').length,
		[suggestions]
	)
	const openCommentCount = useMemo(
		() => comments.filter((c) => c.parentId === null && c.deletedAt === null && c.resolvedAt === null).length,
		[comments]
	)
	const recentPages = useMemo(
		() =>
			docPages
				.filter((p) => p.archivedAt === null && !p.isTemplate)
				.sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || b.updatedAt.localeCompare(a.updatedAt))
				.slice(0, 6),
		[docPages]
	)

	return (
		<div className="flex h-full min-h-0 flex-1 overflow-hidden bg-background">
			<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
				{!activeSlug ? (
					<div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10">
						<EmptyState
							className="max-w-lg"
							title={t('docs.empty.title')}
							hint={t('docs.empty.hint')}
							action={
								<Button type="button" size="sm" onClick={() => setCreateDocOpen(true)}>
									<FilePlus2 className="size-4" aria-hidden />
									<span>{t('docs.sidebar.new-page')}</span>
								</Button>
							}
						/>
						{recentPages.length > 0 ? (
							<section aria-label={t('docs.empty.recent')} className="mt-8 w-full max-w-2xl space-y-2.5">
								<h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
									{t('docs.empty.recent')}
								</h2>
								<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
									{recentPages.map((page) => (
										<button
											key={page.id}
											type="button"
											onClick={() => selectSlug(page.slug)}
											className="flex items-start gap-2.5 rounded-xl border border-border/70 bg-card/60 p-3 text-left transition-colors hover:border-border hover:bg-accent/50"
										>
											<span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background text-base">
												{page.icon ?? <FileText className="size-4 text-muted-foreground" aria-hidden />}
											</span>
											<span className="min-w-0 flex-1">
												<span className="flex items-center gap-1 text-xs font-medium text-foreground">
													<span className="truncate">{page.title}</span>
													{page.isFavorite ? (
														<Star className="size-3 shrink-0 fill-(--warning) text-(--warning)" aria-hidden />
													) : null}
												</span>
												<time className="mt-0.5 block text-[11px] text-muted-foreground">
													{page.updatedAt.slice(0, 10)}
												</time>
											</span>
										</button>
									))}
								</div>
							</section>
						) : null}
					</div>
				) : loadingDetail ? (
					<div className="flex flex-1 flex-col overflow-hidden">
						<div className="flex h-11 items-center justify-between border-b border-border/60 px-4">
							<Skeleton className="h-4 w-44" />
							<Skeleton className="h-6 w-36" />
						</div>
						<div className="mx-auto w-full max-w-3xl space-y-4 px-12 pt-12 sm:px-16">
							<Skeleton className="h-10 w-72" />
							<div className="space-y-2.5 pt-4">
								<Skeleton className="h-4 w-full" />
								<Skeleton className="h-4 w-11/12" />
								<Skeleton className="h-4 w-4/5" />
								<Skeleton className="h-24 w-full rounded-xl" />
							</div>
						</div>
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
								onClick={() =>
									activeSlug &&
									void engine.flushOutbox({ force: true }).then(() => loadPageDetail(activeSlug))
								}
							>
								{t('error.retry')}
							</Button>
						}
					/>
				) : detail ? (
					<Suspense fallback={<Skeleton className="m-8 h-64 w-full" />}>
						<EditorShell
							key={detail.page.id}
							detail={{
								...detail,
								page: activePageSummary ?? detail.page
							}}
							api={api}
							isPreview={isPreview}
							userDisplayName={currentMemberName}
							currentUserId={currentUserId}
							pages={docPages}
							openCommentCount={openCommentCount}
							openSuggestionCount={openSuggestionCount}
							onSelectSlug={selectSlug}
							onUpdateTitle={async (title) => {
								await engine.updateDocPage(detail.page.id, { title })
							}}
							onToggleFavorite={async (favorite) => {
								const updated = await api.setDocFavorite(detail.page.id, favorite)
								engine.collections.docPagesManaged.upsertMany([updated])
								setDetail((prev) => (prev ? { ...prev, page: updated } : prev))
							}}
							onExportMarkdown={handleExportMarkdown}
							onExportHtml={handleExportHtml}
							onExportZip={handleExportZip}
							onUpdatePageMeta={handleUpdatePageMeta}
							onVerifyPage={handleVerifyPage}
							onClearVerification={handleClearVerification}
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
					</Suspense>
				) : null}
			</div>

			{detail && activePanel ? (
				<aside
					aria-label={t('docs.panel.comments')}
					className="flex w-84 shrink-0 flex-col border-l border-border/70 bg-card/50 backdrop-blur-sm"
				>
					<Tabs
						value={activePanel}
						onValueChange={(v) => setActivePanel(v as Exclude<DocSidePanel, null>)}
						className="flex min-h-0 flex-1 flex-col"
					>
						<div className="flex items-center gap-1.5 border-b border-border/70 px-2.5 py-2">
							<TabsList className="grid h-8 flex-1 grid-cols-4">
								<TabsTrigger value="comments" className="px-1.5 text-xs">
									{t('docs.panel.comments')}
								</TabsTrigger>
								<TabsTrigger value="suggestions" className="gap-1 px-1.5 text-xs">
									<span>{t('docs.panel.suggestions')}</span>
									{openSuggestionCount > 0 ? <Badge tone="info">{openSuggestionCount}</Badge> : null}
								</TabsTrigger>
								<TabsTrigger value="versions" className="px-1.5 text-xs">
									{t('docs.panel.versions')}
								</TabsTrigger>
								<TabsTrigger value="toc" className="px-1.5 text-xs">
									{t('docs.panel.toc')}
								</TabsTrigger>
							</TabsList>
							<Button
								type="button"
								size="icon"
								tone="ghost"
								aria-label={t('docs.panel.close')}
								onClick={() => setActivePanel(null)}
								className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
							>
								<X className="size-3.5" aria-hidden />
							</Button>
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
							value="suggestions"
							className="mt-0 min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
						>
							{activePanel === 'suggestions' ? (
								<SuggestionReviewPanel
									suggestions={suggestions}
									canWrite={detail.canWrite && !detail.page.isLocked}
									canComment={!detail.page.isLocked}
									onPropose={handleProposeSuggestion}
									onDecide={handleDecideSuggestion}
									onDecideAll={handleDecideAllSuggestions}
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
									canWrite={detail.canWrite && !detail.page.isLocked}
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
				onCreated={(page) => {
					createdSlugToIdRef.current.set(page.slug, page.id)
					selectSlug(page.slug)
				}}
			/>
			<DocShareDialog api={api} page={activePageSummary ?? detail?.page ?? null} members={members} />
			<DocImportDialog api={api} onImported={() => void engine.syncNow()} />

			<Suspense fallback={null}>
				{teamspaceManagerOpen ? <TeamspaceManagerDialog api={api} members={members} /> : null}
				{docPublishOpen ? (
					<DocPublishDialog api={api} page={activePageSummary ?? detail?.page ?? null} />
				) : null}
				{docsGraphOpen ? <KnowledgeGraphView api={api} onSelectSlug={selectSlug} /> : null}
			</Suspense>
		</div>
	)
}
