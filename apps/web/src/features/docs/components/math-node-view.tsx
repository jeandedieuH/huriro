import { MathBlockExtension, MathInlineExtension } from '@huriro/editor'
import { t } from '@huriro/i18n'
import { type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { Pencil } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

function MathBlockNodeView(props: NodeViewProps) {
	const latex = String(props.node.attrs['latex'] ?? '')
	const [editing, setEditing] = useState(false)
	const [renderError, setRenderError] = useState<string | null>(null)
	const hostRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		let cancelled = false
		void import('./katex-renderer').then((mod) => {
			if (cancelled) return
			const res = mod.renderLatexToHtml(latex, true)
			setRenderError(res.error)
			if (hostRef.current) hostRef.current.innerHTML = res.html
		})
		return () => {
			cancelled = true
		}
	}, [latex])

	return (
		<NodeViewWrapper
			data-math="block"
			contentEditable={false}
			className="group my-3 rounded-xl border border-border/75 bg-(--surface-2)/60 p-3.5 transition-colors hover:border-border"
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0 flex-1 overflow-x-auto text-center">
					{renderError ? (
						<p role="alert" className="text-xs text-destructive">
							{renderError}
						</p>
					) : (
						<div ref={hostRef} className="py-1" />
					)}
				</div>
				{props.editor.isEditable ? (
					<Button
						type="button"
						size="icon"
						tone={editing ? 'secondary' : 'ghost'}
						className="size-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
						aria-label={t('docs.math.edit')}
						onClick={() => setEditing((v) => !v)}
					>
						<Pencil className="size-3.5" aria-hidden />
					</Button>
				) : null}
			</div>
			{editing && props.editor.isEditable ? (
				<Input
					aria-label={t('docs.math.edit')}
					value={latex}
					onChange={(ev) => props.updateAttributes({ latex: ev.target.value })}
					placeholder={t('docs.math.placeholder')}
					className="mt-2 h-8 font-mono text-xs"
				/>
			) : null}
		</NodeViewWrapper>
	)
}

function MathInlineNodeView(props: NodeViewProps) {
	const latex = String(props.node.attrs['latex'] ?? '')
	const [open, setOpen] = useState(false)
	const hostRef = useRef<HTMLSpanElement | null>(null)

	useEffect(() => {
		let cancelled = false
		void import('./katex-renderer').then((mod) => {
			if (cancelled) return
			const res = mod.renderLatexToHtml(latex, false)
			if (hostRef.current) {
				hostRef.current.innerHTML = res.html || latex
			}
		})
		return () => {
			cancelled = true
		}
	}, [latex])

	return (
		<NodeViewWrapper
			as="span"
			data-math="inline"
			contentEditable={false}
			className="inline-block align-baseline"
		>
			{props.editor.isEditable ? (
				<Popover open={open} onOpenChange={setOpen}>
					<PopoverTrigger asChild>
						<button
							type="button"
							aria-label={t('docs.math.edit')}
							className="mx-0.5 rounded bg-muted/60 px-1 py-0.5 hover:bg-muted"
						>
							<span ref={hostRef} />
						</button>
					</PopoverTrigger>
					<PopoverContent align="start" className="w-64 p-2">
						<Input
							aria-label={t('docs.math.edit')}
							value={latex}
							onChange={(ev) => props.updateAttributes({ latex: ev.target.value })}
							placeholder={t('docs.math.placeholder')}
							className="h-8 font-mono text-xs"
						/>
					</PopoverContent>
				</Popover>
			) : (
				<span ref={hostRef} className="mx-0.5" />
			)}
		</NodeViewWrapper>
	)
}

export const MathBlockNodeViewExtension = MathBlockExtension.extend({
	addNodeView() {
		return ReactNodeViewRenderer(MathBlockNodeView)
	}
})

export const MathInlineNodeViewExtension = MathInlineExtension.extend({
	addNodeView() {
		return ReactNodeViewRenderer(MathInlineNodeView)
	}
})
