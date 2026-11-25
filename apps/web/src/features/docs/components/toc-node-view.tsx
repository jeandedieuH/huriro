import { TocBlockExtension } from '@huriro/editor'
import { t } from '@huriro/i18n'
import { type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { ListTree } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

interface TocHeadingEntry {
	readonly id: string
	readonly level: number
	readonly text: string
}

function collectEditorHeadings(props: NodeViewProps, maxLevel: number): TocHeadingEntry[] {
	const items: TocHeadingEntry[] = []
	props.editor.state.doc.descendants((node) => {
		if (node.type.name === 'heading' || node.type.name === 'toggleHeading') {
			const level = Number(node.attrs['level'] ?? 1)
			const blockId = String(node.attrs['blockId'] ?? '')
			const text =
				node.type.name === 'toggleHeading'
					? String(node.attrs['summary'] ?? '').trim()
					: node.textContent.trim()
			if (level >= 1 && level <= maxLevel && text.length > 0 && blockId.length > 0) {
				items.push({ id: blockId, level, text })
			}
		}
		return true
	})
	return items
}

function scrollToBlock(blockId: string) {
	if (typeof document === 'undefined') return
	const target = document.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`)
	if (target instanceof HTMLElement) {
		target.scrollIntoView({ behavior: 'smooth', block: 'center' })
		target.classList.add('huriro-block-flash')
		window.setTimeout(() => target.classList.remove('huriro-block-flash'), 1600)
	}
}

function TocNodeView(props: NodeViewProps) {
	const maxLevel = Number(props.node.attrs['maxLevel']) === 2 ? 2 : 3
	const [headings, setHeadings] = useState<TocHeadingEntry[]>(() => collectEditorHeadings(props, maxLevel))

	useEffect(() => {
		const refresh = () => {
			setHeadings(collectEditorHeadings(props, maxLevel))
		}
		refresh()
		props.editor.on('update', refresh)
		return () => {
			props.editor.off('update', refresh)
		}
	}, [maxLevel, props])

	return (
		<NodeViewWrapper
			data-toc="true"
			contentEditable={false}
			className="group my-3 rounded-xl border border-border/70 bg-(--surface-2)/70 p-3.5 text-sm"
		>
			<div className="mb-2 flex items-center justify-between gap-2">
				<div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					<ListTree className="size-3.5" aria-hidden />
					<span>{t('docs.slash.toc')}</span>
				</div>
				{props.editor.isEditable ? (
					<Button
						type="button"
						size="sm"
						tone="ghost"
						className="h-6 px-2 text-xs"
						onClick={() => props.updateAttributes({ maxLevel: maxLevel === 2 ? 3 : 2 })}
					>
						{maxLevel === 2 ? 'H1–H2' : 'H1–H3'}
					</Button>
				) : null}
			</div>

			{headings.length === 0 ? (
				<p className="text-xs text-muted-foreground">{t('docs.toc.empty')}</p>
			) : (
				<nav aria-label={t('docs.slash.toc')}>
					<ul className="space-y-1">
						{headings.map((h) => (
							<li key={h.id} style={{ paddingLeft: `${Math.max(0, h.level - 1) * 12}px` }}>
								<button
									type="button"
									onClick={() => scrollToBlock(h.id)}
									className="text-left text-xs text-foreground underline-offset-2 hover:text-primary hover:underline"
								>
									{h.text}
								</button>
							</li>
						))}
					</ul>
				</nav>
			)}
		</NodeViewWrapper>
	)
}

export const TocBlockNodeViewExtension = TocBlockExtension.extend({
	addNodeView() {
		return ReactNodeViewRenderer(TocNodeView)
	}
})
