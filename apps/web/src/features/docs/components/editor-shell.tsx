import type {
	DocHeadingDto,
	DocPageDetailDto,
	DocPageDto,
	SetDocVerificationBody,
	UpdateDocPageBody
} from '@huriro/contracts'
import {
	createHuriroExtensions,
	DOCUMENT_SIZE_WARN_BYTES,
	type EncodedAnchor,
	encodeProseMirrorAnchor,
	extractDocumentContent
} from '@huriro/editor'
import { t } from '@huriro/i18n'
import { EditorContent, useEditor } from '@tiptap/react'
import { AlertTriangle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'
import type { TaskApiBridge } from '@/lib/sync-bootstrap'
import { useHocuspocusProvider } from '@/lib/use-hocuspocus-provider'
import { cn } from '@/lib/utils'
import { type DocSidePanel, useUiStore } from '@/stores/ui-store'
import { BacklinksSection } from './backlinks-section'
import { BlockGutterMenu } from './block-gutter-menu'
import { createBookmarkNodeViewExtension } from './bookmark-node-view'
import { createButtonNodeViewExtension } from './button-node-view'
import { CalloutNodeViewExtension } from './callout-node-view'
import { CodeBlockNodeViewExtension } from './code-block-node-view'
import { EditorTopBar } from './editor-top-bar'
import { createEmbedNodeViewExtension } from './embed-node-view'
import { FloatingToolbar } from './floating-toolbar'
import { LinkPreviewCard } from './link-preview-card'
import { createLinkedViewNodeViewExtension } from './linked-view-node-view'
import { MathBlockNodeViewExtension, MathInlineNodeViewExtension } from './math-node-view'
import { MermaidBlockNodeViewExtension } from './mermaid-node-view'
import { OutlineFloatingRail } from './outline-floating-rail'
import { PageHeaderControls } from './page-header-controls'
import { createSlashCommandExtension } from './slash-command-menu'
import { createSyncedBlockNodeViewExtension } from './synced-block-node-view'
import { TableToolbar } from './table-toolbar'
import { TocBlockNodeViewExtension } from './toc-node-view'

export interface EditorShellProps {
	readonly detail: DocPageDetailDto
	readonly api: TaskApiBridge
	readonly isPreview: boolean
	readonly userDisplayName: string
	readonly currentUserId?: string | undefined
	readonly pages?: readonly DocPageDto[] | undefined
	readonly openCommentCount?: number | undefined
	readonly openSuggestionCount?: number | undefined
	readonly onSelectSlug?: ((slug: string) => void) | undefined
	readonly onUpdateTitle: (title: string) => Promise<void>
	readonly onToggleFavorite: (favorite: boolean) => Promise<void>
	readonly onExportMarkdown: () => Promise<void>
	readonly onExportHtml?: ((print: boolean) => Promise<void>) | undefined
	readonly onExportZip?: (() => Promise<void>) | undefined
	readonly onUpdatePageMeta?: ((patch: Omit<UpdateDocPageBody, 'version'>) => Promise<void>) | undefined
	readonly onVerifyPage?: ((body: SetDocVerificationBody) => Promise<void>) | undefined
	readonly onClearVerification?: (() => Promise<void>) | undefined
	readonly onSplitPage: (title: string) => Promise<void>
	readonly onStartAnchoredComment: (anchor: EncodedAnchor | null, selectedText: string) => void
	readonly onHeadingsChange: (headings: DocHeadingDto[]) => void
}

function base64ToUint8Array(b64: string): Uint8Array {
	if (!b64) return new Uint8Array()
	const binary = atob(b64)
	const out = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) {
		out[i] = binary.charCodeAt(i)
	}
	return out
}

function scrollAndFlashHashBlock() {
	if (typeof window === 'undefined' || !window.location.hash.startsWith('#block-')) return
	const blockId = window.location.hash.slice('#block-'.length)
	if (!blockId) return
	const el = document.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`)
	if (el instanceof HTMLElement) {
		el.scrollIntoView({ behavior: 'smooth', block: 'center' })
		el.classList.add('huriro-block-flash')
		window.setTimeout(() => el.classList.remove('huriro-block-flash'), 1600)
	}
}

export function EditorShell({
	detail,
	api,
	isPreview,
	userDisplayName,
	currentUserId,
	pages = [],
	openCommentCount = 0,
	openSuggestionCount = 0,
	onSelectSlug,
	onUpdateTitle,
	onToggleFavorite,
	onExportMarkdown,
	onExportHtml,
	onExportZip,
	onUpdatePageMeta,
	onVerifyPage,
	onClearVerification,
	onSplitPage,
	onStartAnchoredComment,
	onHeadingsChange
}: EditorShellProps) {
	const activePanel = useUiStore((s) => s.activeDocSidePanel)
	const setActivePanel = useUiStore((s) => s.setActiveDocSidePanel)
	const setShareOpen = useUiStore((s) => s.setDocShareOpen)
	const setPublishOpen = useUiStore((s) => s.setDocPublishOpen)

	const [titleDraft, setTitleDraft] = useState(detail.page.title)
	const [connStatus, setConnStatus] = useState<string>(isPreview ? 'offline' : 'connecting')
	const [byteSize, setByteSize] = useState(detail.byteSize)
	const [suggestingMode, setSuggestingMode] = useState(false)
	const [liveHeadings, setLiveHeadings] = useState<readonly DocHeadingDto[]>(detail.headings)
	const [wordCount, setWordCount] = useState(() => {
		const trimmed = detail.plainText.trim()
		return trimmed ? trimmed.split(/\s+/).length : 0
	})
	const canvasRef = useRef<HTMLDivElement>(null)
	const bottomSpacerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		setTitleDraft(detail.page.title)
	}, [detail.page.title])

	useEffect(() => {
		setLiveHeadings(detail.headings)
	}, [detail.headings])

	const ydoc = useMemo(() => {
		const doc = new Y.Doc({ guid: detail.page.id })
		const raw = base64ToUint8Array(detail.stateBase64)
		if (raw.byteLength > 0) {
			Y.applyUpdate(doc, raw, 'huriro:seed')
		}
		return doc
	}, [detail.page.id, detail.stateBase64])

	// Bind offline IndexedDB persistence when browser indexedDB is available.
	useEffect(() => {
		if (typeof indexedDB === 'undefined') return
		const persistence = new IndexeddbPersistence(`huriro-doc:${detail.page.id}`, ydoc)
		return () => {
			void persistence.destroy()
		}
	}, [detail.page.id, ydoc])

	// Bind live Hocuspocus /collab WebSocket synchronization outside preview mode.
	const provider = useHocuspocusProvider({
		enabled: !isPreview,
		documentName: `${detail.page.workspaceId}:${detail.page.id}`,
		document: ydoc,
		getToken: async () => {
			const issued = await api.issueCollabTicket(detail.page.id)
			return issued.ticket
		},
		onStatus: setConnStatus
	})

	useEffect(() => {
		const handleUpdate = () => {
			setByteSize(Y.encodeStateAsUpdate(ydoc).byteLength)
			const extracted = extractDocumentContent(ydoc)
			setLiveHeadings(extracted.headings)
			onHeadingsChange(extracted.headings)
		}
		ydoc.on('update', handleUpdate)
		return () => {
			ydoc.off('update', handleUpdate)
		}
	}, [onHeadingsChange, ydoc])

	const effectiveEditable = detail.canWrite && !detail.page.isLocked
	const authorId = currentUserId ?? detail.page.createdBy

	const extensions = useMemo(
		() => [
			...createHuriroExtensions({
				collaborative: true,
				ydoc,
				field: 'default',
				provider: provider ?? undefined,
				user: provider ? { name: userDisplayName, color: 'var(--primary)', userId: authorId } : undefined,
				suggestionAuthor: { authorType: 'user', authorId },
				placeholder: t('docs.editor.placeholder'),
				toggleLabels: { arrow: t('docs.editor.toggle-arrow'), summary: t('docs.editor.toggle-summary') },
				nodeViewOverrides: [
					CalloutNodeViewExtension,
					CodeBlockNodeViewExtension,
					MermaidBlockNodeViewExtension,
					MathBlockNodeViewExtension,
					MathInlineNodeViewExtension,
					TocBlockNodeViewExtension,
					createBookmarkNodeViewExtension(api),
					createEmbedNodeViewExtension(api),
					createButtonNodeViewExtension({ api, pageId: detail.page.id }),
					createLinkedViewNodeViewExtension({ pageId: detail.page.id }),
					createSyncedBlockNodeViewExtension({
						api,
						workspaceId: detail.page.workspaceId,
						pageId: detail.page.id,
						isPreview,
						userDisplayName
					})
				]
			}),
			// "/" block picker lives in the app layer — the shared schema stays headless.
			createSlashCommandExtension()
		],
		[api, authorId, detail.page.id, detail.page.workspaceId, isPreview, provider, userDisplayName, ydoc]
	)

	const editor = useEditor(
		{
			immediatelyRender: false,
			editable: effectiveEditable,
			editorProps: {
				attributes: {
					'aria-label': detail.page.title || t('docs.sidebar.title')
				}
			},
			extensions
		},
		[extensions, effectiveEditable, detail.page.title]
	)

	useEffect(() => {
		if (!editor || editor.isDestroyed) return
		const updateWordCount = () => {
			// TipTap may recreate the editor when collaborative extensions change;
			// passive effects from the previous commit can still reference the destroyed instance.
			if (editor.isDestroyed) return
			const text = editor.getText().trim()
			setWordCount(text ? text.split(/\s+/).length : 0)
		}
		updateWordCount()
		editor.on('update', updateWordCount)
		return () => {
			editor.off('update', updateWordCount)
		}
	}, [editor])

	useEffect(() => {
		if (!editor || editor.isDestroyed) return
		editor.commands.setSuggestionMode(suggestingMode && effectiveEditable, {
			authorType: 'user',
			authorId
		})
	}, [authorId, editor, effectiveEditable, suggestingMode])

	useEffect(() => {
		if (!editor) return
		scrollAndFlashHashBlock()
		if (typeof window === 'undefined') return
		window.addEventListener('hashchange', scrollAndFlashHashBlock)
		return () => {
			window.removeEventListener('hashchange', scrollAndFlashHashBlock)
		}
	}, [editor])

	useEffect(() => {
		const spacer = bottomSpacerRef.current
		if (!spacer || !editor || editor.isDestroyed || !effectiveEditable) return
		const handleSpacerClick = (ev: MouseEvent) => {
			if (ev.target === spacer && !editor.isDestroyed) editor.commands.focus('end')
		}
		spacer.addEventListener('click', handleSpacerClick)
		return () => spacer.removeEventListener('click', handleSpacerClick)
	}, [editor, effectiveEditable])

	function togglePanel(panel: Exclude<DocSidePanel, null>) {
		setActivePanel(activePanel === panel ? null : panel)
	}

	function handleStartComment() {
		if (!editor || editor.isDestroyed) {
			onStartAnchoredComment(null, '')
			return
		}
		const { from, to } = editor.state.selection
		const selected = editor.state.doc.textBetween(from, to, ' ')
		const encoded = from < to ? encodeProseMirrorAnchor(editor.state, ydoc, from, to) : null
		onStartAnchoredComment(encoded, selected)
	}

	function handleCommitTitle() {
		const clean = titleDraft.trim()
		if (clean && clean !== detail.page.title && effectiveEditable) {
			void onUpdateTitle(clean)
		}
	}

	function handleSplitPage() {
		const sel =
			editor && !editor.isDestroyed
				? editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n')
				: ''
		const splitTitle = sel.trim().slice(0, 80) || `${detail.page.title} (Split)`
		void onSplitPage(splitTitle)
	}

	const articleMaxWidth = detail.page.fullWidth ? 'max-w-5xl' : 'max-w-3xl'

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-background">
			<EditorTopBar
				page={detail.page}
				pages={pages}
				titleDraft={titleDraft}
				effectiveEditable={effectiveEditable}
				canShare={detail.canShare}
				canWrite={detail.canWrite}
				canPublish={detail.canPublish ?? detail.canShare}
				isPreview={isPreview}
				connStatus={connStatus}
				suggestingMode={suggestingMode}
				activePanel={activePanel}
				openCommentCount={openCommentCount}
				openSuggestionCount={openSuggestionCount}
				wordCount={wordCount}
				onSelectSlug={onSelectSlug}
				onToggleSuggesting={() => setSuggestingMode((prev) => !prev)}
				onToggleFavorite={() => void onToggleFavorite(!detail.page.isFavorite)}
				onOpenShare={() => setShareOpen(true)}
				onTogglePanel={togglePanel}
				onUpdateMeta={onUpdatePageMeta ?? (async () => {})}
				onSplitPage={handleSplitPage}
				onExportMarkdown={onExportMarkdown}
				onExportHtml={onExportHtml ?? (async () => {})}
				onExportZip={onExportZip ?? (async () => {})}
				onOpenPublish={() => setPublishOpen(true)}
			/>

			{byteSize > DOCUMENT_SIZE_WARN_BYTES ? (
				<div
					role="status"
					className="flex items-center gap-2 border-b border-(--warning)/40 bg-(--warning)/10 px-4 py-2 text-xs text-(--warning)"
				>
					<AlertTriangle className="size-4 shrink-0" aria-hidden />
					<span>{t('docs.editor.size-warn')}</span>
				</div>
			) : null}

			<div className="relative min-h-0 flex-1 overflow-y-auto">
				<PageHeaderControls
					page={detail.page}
					verification={detail.verification ?? null}
					canWrite={detail.canWrite}
					canShare={detail.canShare}
					canVerify={detail.canVerify ?? detail.canWrite}
					canPublish={detail.canPublish ?? detail.canShare}
					titleDraft={titleDraft}
					onTitleChange={setTitleDraft}
					onTitleCommit={handleCommitTitle}
					onTitleEnter={() => editor?.commands.focus('start')}
					onAddComment={handleStartComment}
					articleMaxWidth={articleMaxWidth}
					showStandaloneUtilities={false}
					onUpdateMeta={onUpdatePageMeta ?? (async () => {})}
					onVerify={onVerifyPage ?? (async () => {})}
					onClearVerification={onClearVerification ?? (async () => {})}
					onExportMarkdown={onExportMarkdown}
					onExportHtml={onExportHtml ?? (async () => {})}
					onExportZip={onExportZip ?? (async () => {})}
					onOpenPublish={() => setPublishOpen(true)}
				/>

				<div ref={canvasRef} className={cn('relative mx-auto px-12 pt-2 pb-44 sm:px-16', articleMaxWidth)}>
					<BlockGutterMenu
						editor={editor}
						canWrite={effectiveEditable}
						containerRef={canvasRef}
						ydoc={ydoc}
						onStartAnchoredComment={onStartAnchoredComment}
						pages={pages}
						currentPageId={detail.page.id}
						onMoveBlockToPage={async (targetPageId, nodes) => {
							await api.appendDocPage(targetPageId, { nodes: [...nodes], origin: 'block-menu:move' })
						}}
						onAskAi={async (blockId, instruction) => {
							const result = await api.assistDocBlockWithAi({ pageId: detail.page.id, blockId, instruction })
							return result.text
						}}
					/>
					<TableToolbar editor={editor} canWrite={effectiveEditable} containerRef={canvasRef} />

					<div
						data-font-style={detail.page.fontStyle ?? 'sans'}
						data-small-text={detail.page.smallText ? 'true' : undefined}
						className="huriro-editor text-foreground"
					>
						<EditorContent editor={editor} />
					</div>

					{/* Bottom canvas hit target lets writers click below the last block to continue writing. */}
					<div ref={bottomSpacerRef} className="min-h-24 cursor-text" />

					<BacklinksSection
						api={api}
						pageId={detail.page.id}
						pages={pages}
						onSelectSlug={(slug) => onSelectSlug?.(slug)}
					/>
				</div>

				<OutlineFloatingRail headings={liveHeadings} hidden={activePanel !== null} />
			</div>

			<FloatingToolbar
				editor={editor}
				canWrite={effectiveEditable}
				canComment={true}
				onAddComment={handleStartComment}
			/>
			<LinkPreviewCard editor={editor} />
		</div>
	)
}
