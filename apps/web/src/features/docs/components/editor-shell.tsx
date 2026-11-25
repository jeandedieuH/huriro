import { HocuspocusProvider } from '@hocuspocus/provider'
import type { DocHeadingDto, DocPageDetailDto } from '@huriro/contracts'
import {
	createHuriroExtensions,
	DOCUMENT_SIZE_WARN_BYTES,
	type EncodedAnchor,
	encodeProseMirrorAnchor,
	extractDocumentContent
} from '@huriro/editor'
import { t } from '@huriro/i18n'
import { EditorContent, useEditor } from '@tiptap/react'
import {
	AlertTriangle,
	Download,
	History,
	ListTree,
	MessageSquare,
	Scissors,
	Share2,
	Star
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { TaskApiBridge } from '@/lib/sync-bootstrap'
import { type DocSidePanel, useUiStore } from '@/stores/ui-store'
import { FloatingToolbar } from './floating-toolbar'
import { LinkPreviewCard } from './link-preview-card'
import { createSlashCommandExtension } from './slash-command-menu'

export interface EditorShellProps {
	readonly detail: DocPageDetailDto
	readonly api: TaskApiBridge
	readonly isPreview: boolean
	readonly userDisplayName: string
	readonly onUpdateTitle: (title: string) => Promise<void>
	readonly onToggleFavorite: (favorite: boolean) => Promise<void>
	readonly onExportMarkdown: () => Promise<void>
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

export function EditorShell({
	detail,
	api,
	isPreview,
	userDisplayName,
	onUpdateTitle,
	onToggleFavorite,
	onExportMarkdown,
	onSplitPage,
	onStartAnchoredComment,
	onHeadingsChange
}: EditorShellProps) {
	const activePanel = useUiStore((s) => s.activeDocSidePanel)
	const setActivePanel = useUiStore((s) => s.setActiveDocSidePanel)
	const setShareOpen = useUiStore((s) => s.setDocShareOpen)

	const [titleDraft, setTitleDraft] = useState(detail.page.title)
	const [connStatus, setConnStatus] = useState<string>(isPreview ? 'offline' : 'connecting')
	const [byteSize, setByteSize] = useState(detail.byteSize)

	useEffect(() => {
		setTitleDraft(detail.page.title)
	}, [detail.page.title])

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
	const provider = useMemo(() => {
		if (isPreview || typeof window === 'undefined' || typeof WebSocket === 'undefined') {
			return null
		}
		const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
		const url = `${proto}//${window.location.host}/collab`
		return new HocuspocusProvider({
			url,
			name: `${detail.page.workspaceId}:${detail.page.id}`,
			document: ydoc,
			token: async () => {
				const issued = await api.issueCollabTicket(detail.page.id)
				return issued.ticket
			},
			onStatus: ({ status }) => {
				setConnStatus(status)
			}
		})
	}, [api, detail.page.id, detail.page.workspaceId, isPreview, ydoc])

	useEffect(() => {
		if (!provider) return
		return () => {
			provider.destroy()
		}
	}, [provider])

	useEffect(() => {
		const handleUpdate = () => {
			setByteSize(Y.encodeStateAsUpdate(ydoc).byteLength)
			const extracted = extractDocumentContent(ydoc)
			onHeadingsChange(extracted.headings)
		}
		ydoc.on('update', handleUpdate)
		return () => {
			ydoc.off('update', handleUpdate)
		}
	}, [onHeadingsChange, ydoc])

	const extensions = useMemo(
		() => [
			...createHuriroExtensions({
				collaborative: true,
				ydoc,
				field: 'default',
				provider: provider ?? undefined,
				user: provider ? { name: userDisplayName, color: 'var(--primary)' } : undefined,
				placeholder: t('docs.editor.placeholder'),
				toggleLabels: { arrow: t('docs.editor.toggle-arrow'), summary: t('docs.editor.toggle-summary') }
			}),
			// "/" block picker lives in the app layer — the shared schema stays headless.
			createSlashCommandExtension()
		],
		[provider, userDisplayName, ydoc]
	)

	const editor = useEditor(
		{
			immediatelyRender: false,
			editable: detail.canWrite,
			editorProps: {
				attributes: {
					'aria-label': detail.page.title || t('docs.sidebar.title')
				}
			},
			extensions
		},
		[extensions, detail.canWrite, detail.page.title]
	)

	function togglePanel(panel: Exclude<DocSidePanel, null>) {
		setActivePanel(activePanel === panel ? null : panel)
	}

	function handleStartComment() {
		if (!editor) {
			onStartAnchoredComment(null, '')
			return
		}
		const { from, to } = editor.state.selection
		const selected = editor.state.doc.textBetween(from, to, ' ')
		const encoded = from < to ? encodeProseMirrorAnchor(editor.state, ydoc, from, to) : null
		onStartAnchoredComment(encoded, selected)
	}

	const statusBadge = !detail.canWrite
		? { tone: 'secondary' as const, label: t('docs.editor.read-only') }
		: isPreview
			? { tone: 'outline' as const, label: t('docs.editor.offline') }
			: connStatus === 'connected'
				? { tone: 'success' as const, label: t('docs.editor.synced') }
				: { tone: 'info' as const, label: t('docs.editor.connecting') }

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<Input
						aria-label={t('docs.create.title-label')}
						value={titleDraft}
						readOnly={!detail.canWrite}
						onChange={(ev) => setTitleDraft(ev.target.value)}
						onBlur={() => {
							const clean = titleDraft.trim()
							if (clean && clean !== detail.page.title && detail.canWrite) {
								void onUpdateTitle(clean)
							}
						}}
						placeholder={t('docs.editor.title-placeholder')}
						className="h-8 max-w-md border-transparent bg-transparent px-1 text-base font-semibold focus-visible:border-border"
					/>
					<Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>
				</div>

				<div className="flex flex-wrap items-center gap-1">
					<Button
						type="button"
						size="icon"
						tone="ghost"
						aria-label={detail.page.isFavorite ? t('docs.editor.unfavorite') : t('docs.editor.favorite')}
						onClick={() => void onToggleFavorite(!detail.page.isFavorite)}
					>
						<Star
							className={detail.page.isFavorite ? 'size-4 fill-(--warning) text-(--warning)' : 'size-4'}
							aria-hidden
						/>
					</Button>
					{detail.canShare ? (
						<Button
							type="button"
							size="sm"
							tone="outline"
							onClick={() => setShareOpen(true)}
							className="h-7 gap-1 px-2 text-xs"
						>
							<Share2 className="size-3.5" aria-hidden />
							<span>{t('docs.editor.share')}</span>
						</Button>
					) : null}
					<Button
						type="button"
						size="icon"
						tone="ghost"
						aria-label={t('docs.editor.export-md')}
						onClick={() => void onExportMarkdown()}
					>
						<Download className="size-4" aria-hidden />
					</Button>
					{detail.canWrite ? (
						<Button
							type="button"
							size="icon"
							tone="ghost"
							aria-label={t('docs.editor.split-page')}
							onClick={() => {
								const sel = editor
									? editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n')
									: ''
								const splitTitle = sel.trim().slice(0, 80) || `${detail.page.title} (Split)`
								void onSplitPage(splitTitle)
							}}
						>
							<Scissors className="size-4" aria-hidden />
						</Button>
					) : null}
					<Button
						type="button"
						size="icon"
						tone={activePanel === 'comments' ? 'secondary' : 'ghost'}
						aria-label={t('docs.panel.comments')}
						onClick={() => togglePanel('comments')}
					>
						<MessageSquare className="size-4" aria-hidden />
					</Button>
					<Button
						type="button"
						size="icon"
						tone={activePanel === 'versions' ? 'secondary' : 'ghost'}
						aria-label={t('docs.panel.versions')}
						onClick={() => togglePanel('versions')}
					>
						<History className="size-4" aria-hidden />
					</Button>
					<Button
						type="button"
						size="icon"
						tone={activePanel === 'toc' ? 'secondary' : 'ghost'}
						aria-label={t('docs.panel.toc')}
						onClick={() => togglePanel('toc')}
					>
						<ListTree className="size-4" aria-hidden />
					</Button>
				</div>
			</header>

			{byteSize > DOCUMENT_SIZE_WARN_BYTES ? (
				<div
					role="status"
					className="flex items-center gap-2 border-b border-(--warning)/40 bg-(--warning)/10 px-4 py-2 text-xs text-(--warning)"
				>
					<AlertTriangle className="size-4 shrink-0" aria-hidden />
					<span>{t('docs.editor.size-warn')}</span>
				</div>
			) : null}

			<div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-4 py-1.5">
				<FloatingToolbar
					editor={editor}
					canWrite={detail.canWrite}
					canComment={true}
					onAddComment={handleStartComment}
				/>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
				<div className="huriro-editor mx-auto max-w-3xl text-sm text-foreground">
					<EditorContent editor={editor} />
				</div>
			</div>

			<LinkPreviewCard editor={editor} />
		</div>
	)
}
