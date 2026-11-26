import type { DocSyncedBlockDto } from '@huriro/contracts'
import { createHuriroExtensions, SyncedBlockExtension } from '@huriro/editor'
import { t } from '@huriro/i18n'
import {
	EditorContent,
	type NodeViewProps,
	NodeViewWrapper,
	ReactNodeViewRenderer,
	useEditor
} from '@tiptap/react'
import { RefreshCw, Unlink } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { TaskApiBridge } from '@/lib/sync-bootstrap'
import { useHocuspocusProvider } from '@/lib/use-hocuspocus-provider'
import { useUiStore } from '@/stores/ui-store'

export interface SyncedBlockNodeViewOptions {
	readonly api?: TaskApiBridge | undefined
	readonly workspaceId?: string | undefined
	readonly pageId?: string | undefined
	readonly isPreview?: boolean | undefined
	readonly userDisplayName?: string | undefined
}

function decodeBase64(b64: string): Uint8Array {
	if (!b64) return new Uint8Array()
	const bin = atob(b64)
	const out = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
	return out
}

function SyncedBlockSubEditor({
	syncedBlockId,
	title,
	fallbackText,
	api,
	workspaceId,
	isPreview,
	userDisplayName,
	editable,
	onUnsync
}: {
	readonly syncedBlockId: string
	readonly title: string
	readonly fallbackText: string
	readonly api: TaskApiBridge | undefined
	readonly workspaceId: string
	readonly isPreview: boolean
	readonly userDisplayName: string
	readonly editable: boolean
	readonly onUnsync: (nodes: Record<string, unknown>[]) => void
}) {
	const [seededState, setSeededState] = useState<string | null>(null)
	const ydoc = useMemo(() => new Y.Doc({ guid: `sb:${syncedBlockId}` }), [syncedBlockId])

	useEffect(() => {
		let cancelled = false
		if (!api) return
		void api
			.getSyncedBlock(syncedBlockId)
			.then((block) => {
				if (cancelled) return
				const raw = decodeBase64(block.stateBase64)
				if (raw.byteLength > 0) Y.applyUpdate(ydoc, raw, 'huriro:synced-seed')
				setSeededState(block.stateBase64)
			})
			.catch(() => {
				if (!cancelled) setSeededState('')
			})
		return () => {
			cancelled = true
		}
	}, [api, syncedBlockId, ydoc])

	const provider = useHocuspocusProvider({
		enabled: !isPreview && Boolean(api),
		documentName: `synced_block:${workspaceId}:${syncedBlockId}`,
		document: ydoc,
		getToken: async () => {
			if (!api) throw new Error('Synced block API unavailable')
			const issued = await api.issueSyncedBlockCollabTicket(syncedBlockId)
			return issued.ticket
		}
	})

	const subExtensions = useMemo(
		() =>
			createHuriroExtensions({
				collaborative: true,
				ydoc,
				field: 'default',
				provider: provider ?? undefined,
				user: provider ? { name: userDisplayName, color: 'var(--primary)' } : undefined,
				placeholder: t('docs.synced.empty')
			}).filter((ext) => ext.name !== 'syncedBlock'),
		[provider, userDisplayName, ydoc]
	)

	const subEditor = useEditor(
		{
			immediatelyRender: false,
			editable,
			extensions: subExtensions
		},
		[subExtensions, editable, seededState]
	)

	return (
		<div className="my-3.5 rounded-xl border border-(--info)/45 bg-(--info)/5 p-3.5">
			<div className="mb-2 flex items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<Badge tone="info" className="gap-1">
						<RefreshCw className="size-3" aria-hidden />
						<span>{title || t('docs.synced.badge')}</span>
					</Badge>
				</div>
				{editable ? (
					<Button
						type="button"
						size="sm"
						tone="ghost"
						className="h-6 gap-1 px-2 text-xs"
						onClick={() => {
							const content = (subEditor?.getJSON().content ?? []) as Record<string, unknown>[]
							if (content.length > 0) {
								onUnsync(content)
							} else {
								onUnsync([
									{
										type: 'paragraph',
										content: [{ type: 'text', text: fallbackText || t('docs.synced.empty') }]
									}
								])
							}
						}}
					>
						<Unlink className="size-3" aria-hidden />
						<span>{t('docs.synced.unsync')}</span>
					</Button>
				) : null}
			</div>
			<div className="huriro-editor text-sm text-foreground">
				<EditorContent editor={subEditor} />
			</div>
		</div>
	)
}

function SyncedBlockNodeView(props: NodeViewProps) {
	const opts = props.extension.options as SyncedBlockNodeViewOptions
	const pushToast = useUiStore((s) => s.pushToast)
	const syncedBlockId = String(props.node.attrs['syncedBlockId'] ?? '')
	const title = String(props.node.attrs['title'] ?? t('docs.synced.badge'))
	const fallbackText = String(props.node.attrs['fallbackText'] ?? '')

	const [availableBlocks, setAvailableBlocks] = useState<DocSyncedBlockDto[]>([])
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		if (syncedBlockId || !opts.api) return
		let cancelled = false
		void opts.api
			.listSyncedBlocks()
			.then((rows) => {
				if (!cancelled) setAvailableBlocks(rows)
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [opts.api, syncedBlockId])

	async function handleCreateNew() {
		if (!opts.api || busy) return
		setBusy(true)
		try {
			const created = await opts.api.createSyncedBlock({
				title: t('docs.synced.badge'),
				sourcePageId: opts.pageId ?? null,
				markdown: `> ${t('docs.synced.empty')}`
			})
			props.updateAttributes({
				syncedBlockId: created.id,
				title: created.title,
				fallbackText: created.plainText
			})
		} catch (err) {
			pushToast({
				tone: 'danger',
				title: err instanceof Error ? err.message : 'Failed to create synced block'
			})
		} finally {
			setBusy(false)
		}
	}

	if (!syncedBlockId) {
		return (
			<NodeViewWrapper
				data-synced-block="true"
				contentEditable={false}
				className="my-3 space-y-2 rounded-lg border border-dashed border-border bg-card/50 p-3"
			>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<span className="text-xs font-medium text-foreground">{t('docs.synced.badge')}</span>
					{props.editor.isEditable ? (
						<Button type="button" size="sm" disabled={busy} onClick={() => void handleCreateNew()}>
							{t('docs.slash.synced-block')}
						</Button>
					) : null}
				</div>
				{availableBlocks.length > 0 && props.editor.isEditable ? (
					<div className="flex flex-wrap gap-1.5">
						{availableBlocks.map((b) => (
							<Button
								key={b.id}
								type="button"
								size="sm"
								tone="outline"
								className="h-7 text-xs"
								onClick={() =>
									props.updateAttributes({
										syncedBlockId: b.id,
										title: b.title,
										fallbackText: b.plainText
									})
								}
							>
								{b.title}
							</Button>
						))}
					</div>
				) : null}
			</NodeViewWrapper>
		)
	}

	return (
		<NodeViewWrapper data-synced-block="true" data-synced-block-id={syncedBlockId}>
			<SyncedBlockSubEditor
				syncedBlockId={syncedBlockId}
				title={title}
				fallbackText={fallbackText}
				api={opts.api}
				workspaceId={opts.workspaceId ?? 'default'}
				isPreview={opts.isPreview ?? false}
				userDisplayName={opts.userDisplayName ?? 'Member'}
				editable={props.editor.isEditable}
				onUnsync={(nodes) => {
					const pos = props.getPos()
					if (typeof pos === 'number') {
						props.editor
							.chain()
							.focus()
							.insertContentAt({ from: pos, to: pos + props.node.nodeSize }, nodes)
							.run()
					}
				}}
			/>
		</NodeViewWrapper>
	)
}

export function createSyncedBlockNodeViewExtension(opts: SyncedBlockNodeViewOptions) {
	return SyncedBlockExtension.extend<SyncedBlockNodeViewOptions>({
		addOptions() {
			return {
				...this.parent?.(),
				api: opts.api,
				workspaceId: opts.workspaceId,
				pageId: opts.pageId,
				isPreview: opts.isPreview,
				userDisplayName: opts.userDisplayName
			}
		},
		addNodeView() {
			return ReactNodeViewRenderer(SyncedBlockNodeView)
		}
	})
}
