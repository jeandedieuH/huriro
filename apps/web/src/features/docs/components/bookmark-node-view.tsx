import { BookmarkCardExtension, isSafeUrl } from '@huriro/editor'
import { t } from '@huriro/i18n'
import { type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { ExternalLink, Globe, Pencil } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { TaskApiBridge } from '@/lib/sync-bootstrap'
import { useUiStore } from '@/stores/ui-store'

interface BookmarkExtensionOptions {
	readonly api?: TaskApiBridge
}

function BookmarkNodeView(props: NodeViewProps) {
	const api = (props.extension.options as BookmarkExtensionOptions).api
	const pushToast = useUiStore((s) => s.pushToast)

	const currentUrl = String(props.node.attrs['url'] ?? '')
	const title = String(props.node.attrs['title'] ?? '')
	const description = String(props.node.attrs['description'] ?? '')
	const siteName = String(props.node.attrs['siteName'] ?? '')
	const faviconUrl = String(props.node.attrs['faviconUrl'] ?? '')
	const imageUrl = String(props.node.attrs['imageUrl'] ?? '')

	const [draftUrl, setDraftUrl] = useState(currentUrl)
	const [editing, setEditing] = useState(!currentUrl)
	const [loading, setLoading] = useState(false)

	async function handleFetch(ev: FormEvent) {
		ev.preventDefault()
		const target = draftUrl.trim()
		if (!target || !isSafeUrl(target) || loading) return
		setLoading(true)
		try {
			if (api) {
				const meta = await api.unfurlBookmark(target)
				props.updateAttributes({
					url: isSafeUrl(meta.url) ? meta.url : target,
					title: meta.title || target,
					description: meta.description,
					siteName: meta.siteName,
					faviconUrl: meta.faviconUrl && isSafeUrl(meta.faviconUrl) ? meta.faviconUrl : '',
					imageUrl: meta.imageUrl && isSafeUrl(meta.imageUrl) ? meta.imageUrl : ''
				})
			} else {
				props.updateAttributes({ url: target, title: target })
			}
			setEditing(false)
		} catch (err) {
			pushToast({
				tone: 'danger',
				title: err instanceof Error ? err.message : 'Failed to embed bookmark'
			})
		} finally {
			setLoading(false)
		}
	}

	const hasValidHref = Boolean(currentUrl && isSafeUrl(currentUrl))

	return (
		<NodeViewWrapper data-bookmark="true" contentEditable={false} className="my-3">
			{editing || !hasValidHref ? (
				<form
					onSubmit={(ev) => void handleFetch(ev)}
					className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3"
				>
					<Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />
					<Input
						aria-label={t('docs.bookmark.placeholder')}
						value={draftUrl}
						onChange={(ev) => setDraftUrl(ev.target.value)}
						placeholder={t('docs.bookmark.placeholder')}
						readOnly={!props.editor.isEditable}
						className="h-8 flex-1 text-xs"
					/>
					{props.editor.isEditable ? (
						<Button type="submit" size="sm" disabled={loading || !isSafeUrl(draftUrl.trim())}>
							{loading ? t('docs.bookmark.loading') : t('docs.bookmark.fetch')}
						</Button>
					) : null}
				</form>
			) : (
				<div className="group flex items-stretch justify-between gap-3 overflow-hidden rounded-xl border border-border/80 bg-card transition-colors hover:border-border hover:bg-muted/30">
					<a
						href={currentUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="flex min-w-0 flex-1 flex-col justify-between gap-1.5 p-3 no-underline"
					>
						<div className="space-y-1">
							<p className="truncate text-sm font-medium text-foreground">{title || currentUrl}</p>
							{description ? (
								<p className="line-clamp-2 text-xs text-muted-foreground">{description}</p>
							) : null}
						</div>
						<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
							{faviconUrl && isSafeUrl(faviconUrl) ? (
								<img src={faviconUrl} alt="" className="size-3.5 rounded-sm" />
							) : (
								<ExternalLink className="size-3 shrink-0" aria-hidden />
							)}
							<span className="truncate">{siteName || currentUrl}</span>
						</div>
					</a>
					{imageUrl && isSafeUrl(imageUrl) ? (
						<img src={imageUrl} alt="" className="hidden h-24 w-36 shrink-0 object-cover sm:block" />
					) : null}
					{props.editor.isEditable ? (
						<div className="flex items-start p-2">
							<Button
								type="button"
								size="icon"
								tone="ghost"
								className="size-7 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
								aria-label={t('docs.link.edit')}
								onClick={() => {
									setDraftUrl(currentUrl)
									setEditing(true)
								}}
							>
								<Pencil className="size-3.5" aria-hidden />
							</Button>
						</div>
					) : null}
				</div>
			)}
		</NodeViewWrapper>
	)
}

export function createBookmarkNodeViewExtension(api: TaskApiBridge) {
	return BookmarkCardExtension.extend<BookmarkExtensionOptions>({
		addOptions() {
			return {
				...this.parent?.(),
				api
			}
		},
		addNodeView() {
			return ReactNodeViewRenderer(BookmarkNodeView)
		}
	})
}
