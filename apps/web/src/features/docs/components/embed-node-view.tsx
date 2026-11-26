import { EmbedExtension, type EmbedKind, isSafeUrl } from '@huriro/editor'
import { t } from '@huriro/i18n'
import { type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { ExternalLink, File as FileIcon, Pencil, Upload } from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { TaskApiBridge } from '@/lib/sync-bootstrap'
import { useUiStore } from '@/stores/ui-store'

interface EmbedExtensionOptions {
	readonly api?: TaskApiBridge | undefined
}

const EMBED_KINDS: readonly EmbedKind[] = ['file', 'image', 'video', 'audio', 'pdf', 'figma', 'loom', 'link']

function fileUrl(fileId: string): string {
	return `/api/v1/files/${encodeURIComponent(fileId)}/download`
}

function kindFromContentType(contentType: string): EmbedKind {
	if (contentType.startsWith('video/')) return 'video'
	if (contentType.startsWith('audio/')) return 'audio'
	if (contentType === 'application/pdf') return 'pdf'
	if (contentType.startsWith('image/')) return 'image'
	return 'file'
}

function kindFromUrl(url: string): EmbedKind {
	const clean = url.split('?')[0]?.toLowerCase() ?? ''
	if (/\.(mp4|webm|mov|m4v)$/.test(clean)) return 'video'
	if (/\.(mp3|wav|ogg|m4a|flac)$/.test(clean)) return 'audio'
	if (/\.pdf$/.test(clean)) return 'pdf'
	if (/\.(png|jpe?g|gif|webp|avif|svg)$/.test(clean)) return 'image'
	if (clean.includes('figma.com/')) return 'figma'
	if (clean.includes('loom.com/')) return 'loom'
	return 'link'
}

function embedSource(url: string, fileId: string | null): string {
	if (fileId) return fileUrl(fileId)
	return isSafeUrl(url) ? url : ''
}

/** Rich media embed renderer. The underlying shared node remains a small atom;
 * this app-level NodeView supplies the interactive players while keeping all
 * URLs behind the shared safe-url allowlist. */
function EmbedNodeView(props: NodeViewProps) {
	const { api } = props.extension.options as EmbedExtensionOptions
	const pushToast = useUiStore((s) => s.pushToast)
	const url = String(props.node.attrs['url'] ?? '')
	const fileId = typeof props.node.attrs['fileId'] === 'string' ? props.node.attrs['fileId'] : null
	const title = String(props.node.attrs['title'] ?? '')
	const kind = String(props.node.attrs['kind'] ?? 'link') as EmbedKind
	const src = embedSource(url, fileId)
	const [editing, setEditing] = useState(!src)
	const [draftUrl, setDraftUrl] = useState(url)
	const [draftKind, setDraftKind] = useState<EmbedKind>(kind)
	const [uploading, setUploading] = useState(false)
	const inputRef = useRef<HTMLInputElement | null>(null)

	function saveUrl(ev?: FormEvent) {
		ev?.preventDefault()
		const clean = draftUrl.trim()
		if (!isSafeUrl(clean)) return
		const nextKind = draftKind === 'link' ? kindFromUrl(clean) : draftKind
		props.updateAttributes({ url: clean, fileId: null, kind: nextKind, title: title || clean })
		setEditing(false)
	}

	function upload(file: File) {
		if (!api) return
		setUploading(true)
		void api
			.uploadFile(file)
			.then((uploaded) => {
				props.updateAttributes({
					url: '',
					fileId: uploaded.id,
					kind: kindFromContentType(uploaded.contentType),
					title: uploaded.filename
				})
				setEditing(false)
			})
			.catch((err) => {
				pushToast({
					tone: 'danger',
					title: err instanceof Error ? err.message : t('docs.embed.upload-error')
				})
			})
			.finally(() => setUploading(false))
	}

	const label = title || url || t('docs.embed.untitled')
	let player: React.ReactNode
	if (kind === 'video') {
		player = (
			<video controls preload="metadata" src={src} className="max-h-[32rem] w-full rounded-lg bg-black">
				<track kind="captions" src="data:text/vtt,WEBVTT" label={t('docs.embed.captions')} />
			</video>
		)
	} else if (kind === 'audio') {
		player = (
			<audio controls preload="metadata" src={src} className="w-full">
				<track kind="captions" src="data:text/vtt,WEBVTT" label={t('docs.embed.captions')} />
			</audio>
		)
	} else if (kind === 'pdf') {
		player = (
			<object
				data={src}
				type="application/pdf"
				className="h-[36rem] w-full rounded-lg border border-border/70 bg-muted/30"
			>
				<a href={src} target="_blank" rel="noopener noreferrer" className="text-primary underline">
					{label}
				</a>
			</object>
		)
	} else if (kind === 'image') {
		player = (
			<img src={src} alt={label} loading="lazy" className="max-h-[32rem] w-full rounded-lg object-contain" />
		)
	} else if (kind === 'figma' || kind === 'loom') {
		player = (
			<iframe
				src={src}
				title={label}
				loading="lazy"
				allowFullScreen
				sandbox="allow-scripts allow-same-origin allow-presentation"
				className="aspect-video w-full rounded-lg border border-border/70 bg-card"
			/>
		)
	} else {
		player = (
			<a
				href={src}
				target="_blank"
				rel="noopener noreferrer"
				className="flex items-center gap-3 rounded-lg border border-border/80 bg-card p-3 no-underline hover:bg-muted/40"
			>
				<FileIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
				<span className="min-w-0 flex-1">
					<span className="block truncate font-medium text-sm">{label}</span>
					<span className="block truncate text-muted-foreground text-xs">
						{fileId ? t('docs.embed.workspace-file') : url}
					</span>
				</span>
				<ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden />
			</a>
		)
	}

	return (
		<NodeViewWrapper data-embed="true" contentEditable={false} className="group my-3">
			{editing || !src ? (
				<form
					onSubmit={saveUrl}
					className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3"
				>
					<Input
						aria-label={t('docs.embed.url')}
						value={draftUrl}
						onChange={(event) => setDraftUrl(event.target.value)}
						readOnly={!props.editor.isEditable}
						className="h-8 min-w-56 flex-1 text-xs"
					/>
					<Select value={draftKind} onValueChange={(value) => setDraftKind(value as EmbedKind)}>
						<SelectTrigger aria-label={t('docs.embed.kind')} className="h-8 w-32 text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{EMBED_KINDS.map((item) => (
								<SelectItem key={item} value={item}>
									{t(`docs.embed.kind.${item}`)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{props.editor.isEditable ? (
						<>
							<Button type="submit" size="sm" disabled={!isSafeUrl(draftUrl.trim())}>
								{t('docs.embed.insert')}
							</Button>
							<input
								ref={inputRef}
								type="file"
								className="hidden"
								onChange={(event) => {
									const file = event.target.files?.[0]
									event.target.value = ''
									if (file) upload(file)
								}}
							/>
							<Button
								type="button"
								size="sm"
								tone="outline"
								disabled={!api || uploading}
								onClick={() => inputRef.current?.click()}
							>
								<Upload className="size-3.5" aria-hidden />
								{uploading ? t('docs.embed.uploading') : t('docs.embed.upload')}
							</Button>
						</>
					) : null}
				</form>
			) : (
				<div className="relative">
					{player}
					{props.editor.isEditable ? (
						<Button
							type="button"
							size="icon"
							tone="secondary"
							aria-label={t('docs.embed.edit')}
							className="absolute top-2 right-2 size-7 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
							onClick={() => {
								setDraftUrl(url)
								setDraftKind(kind)
								setEditing(true)
							}}
						>
							<Pencil className="size-3.5" aria-hidden />
						</Button>
					) : null}
				</div>
			)}
		</NodeViewWrapper>
	)
}

export function createEmbedNodeViewExtension(api: TaskApiBridge) {
	return EmbedExtension.extend<EmbedExtensionOptions>({
		addOptions() {
			return { ...this.parent?.(), api }
		},
		addNodeView() {
			return ReactNodeViewRenderer(EmbedNodeView)
		}
	})
}
