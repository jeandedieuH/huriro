import { MermaidBlockExtension, type MermaidViewMode } from '@huriro/editor'
import { t } from '@huriro/i18n'
import { type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

function MermaidNodeView(props: NodeViewProps) {
	const code = String(props.node.attrs['code'] ?? '')
	const alt = String(props.node.attrs['alt'] ?? 'Architecture diagram')
	const viewModeAttr = props.node.attrs['viewMode']
	const viewMode: MermaidViewMode =
		viewModeAttr === 'code' || viewModeAttr === 'diagram' ? viewModeAttr : 'split'

	const [svgHtml, setSvgHtml] = useState('')
	const [renderError, setRenderError] = useState<string | null>(null)

	useEffect(() => {
		let cancelled = false
		async function render() {
			const mod = await import('./mermaid-renderer')
			const res = await mod.renderMermaidSvg(code)
			if (cancelled) return
			if (res.ok) {
				setRenderError(null)
				setSvgHtml(res.svg)
			} else {
				setRenderError(res.error)
				setSvgHtml('')
			}
		}
		void render()
		return () => {
			cancelled = true
		}
	}, [code])

	const modes: readonly { readonly id: MermaidViewMode; readonly label: string }[] = [
		{ id: 'diagram', label: t('docs.mermaid.preview') },
		{ id: 'split', label: t('docs.mermaid.split') },
		{ id: 'code', label: t('docs.mermaid.code') }
	]

	function exportSvg() {
		if (!svgHtml) return
		const blob = new Blob([svgHtml], { type: 'image/svg+xml;charset=utf-8' })
		const href = URL.createObjectURL(blob)
		const anchor = document.createElement('a')
		anchor.href = href
		anchor.download = `${alt || 'mermaid-diagram'}.svg`
		anchor.click()
		URL.revokeObjectURL(href)
	}

	return (
		<NodeViewWrapper
			data-mermaid-block="true"
			contentEditable={false}
			className="my-4 rounded-xl border border-border/80 bg-card/80 p-3.5"
		>
			<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
				<fieldset className="m-0 flex items-center gap-1 border-0 p-0" aria-label="Mermaid view mode">
					{modes.map((m) => (
						<Button
							key={m.id}
							type="button"
							size="sm"
							tone={viewMode === m.id ? 'secondary' : 'ghost'}
							className="h-6 px-2 text-xs"
							disabled={!props.editor.isEditable}
							onClick={() => props.updateAttributes({ viewMode: m.id })}
						>
							{m.label}
						</Button>
					))}
				</fieldset>
				<Button
					type="button"
					size="sm"
					tone="outline"
					className="h-6 px-2 text-xs"
					disabled={!svgHtml}
					onClick={exportSvg}
				>
					{t('docs.mermaid.export-svg')}
				</Button>
				{props.editor.isEditable ? (
					<Input
						aria-label={t('docs.mermaid.alt-placeholder')}
						value={alt}
						onChange={(ev) => props.updateAttributes({ alt: ev.target.value })}
						placeholder={t('docs.mermaid.alt-placeholder')}
						className="h-7 max-w-xs text-xs"
					/>
				) : null}
			</div>

			<div className={viewMode === 'split' ? 'grid gap-3 md:grid-cols-2' : 'space-y-3'}>
				{viewMode !== 'diagram' ? (
					<Textarea
						aria-label={t('docs.slash.mermaid')}
						value={code}
						readOnly={!props.editor.isEditable}
						onChange={(ev) => props.updateAttributes({ code: ev.target.value })}
						rows={6}
						className="min-h-36 font-mono text-xs"
					/>
				) : null}

				{viewMode !== 'code' ? (
					<figure
						aria-label={alt}
						className="flex min-h-36 items-center justify-center overflow-x-auto rounded-md border border-border/70 bg-background p-2"
					>
						{renderError ? (
							<p role="alert" className="text-xs text-destructive">
								{renderError}
							</p>
						) : (
							<div
								ref={(el) => {
									if (el && el.innerHTML !== svgHtml) el.innerHTML = svgHtml
								}}
								className="max-w-full"
							/>
						)}
					</figure>
				) : null}
			</div>
		</NodeViewWrapper>
	)
}

export const MermaidBlockNodeViewExtension = MermaidBlockExtension.extend({
	addNodeView() {
		return ReactNodeViewRenderer(MermaidNodeView)
	}
})
