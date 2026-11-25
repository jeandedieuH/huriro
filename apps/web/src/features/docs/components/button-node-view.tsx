import {
	type ButtonBlockActionKind,
	ButtonBlockExtension,
	type ButtonBlockTone,
	markdownToProseMirrorJson
} from '@huriro/editor'
import { t } from '@huriro/i18n'
import { type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { Play, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { TaskApiBridge } from '@/lib/sync-bootstrap'
import { useUiStore } from '@/stores/ui-store'

interface ButtonBlockExtensionOptions {
	readonly api?: TaskApiBridge | undefined
	readonly pageId?: string | undefined
}

function mapToneToButtonTone(tone: ButtonBlockTone): 'default' | 'secondary' | 'outline' {
	if (tone === 'secondary') return 'secondary'
	if (tone === 'outline') return 'outline'
	return 'default'
}

function ButtonBlockNodeView(props: NodeViewProps) {
	const { api, pageId } = props.extension.options as ButtonBlockExtensionOptions
	const pushToast = useUiStore((s) => s.pushToast)

	const buttonId = String(props.node.attrs['buttonId'] ?? '') || 'doc-button'
	const label = String(props.node.attrs['label'] ?? t('docs.button.run'))
	const actionKind = (
		props.node.attrs['actionKind'] === 'run_automation' ? 'run_automation' : 'append_template'
	) as ButtonBlockActionKind
	const templateMarkdown = String(props.node.attrs['templateMarkdown'] ?? '')
	const automationRuleId =
		typeof props.node.attrs['automationRuleId'] === 'string' ? props.node.attrs['automationRuleId'] : null
	const toneAttr = props.node.attrs['tone']
	const tone: ButtonBlockTone = toneAttr === 'secondary' || toneAttr === 'outline' ? toneAttr : 'primary'

	const [busy, setBusy] = useState(false)
	const [configOpen, setConfigOpen] = useState(false)

	async function handleTrigger() {
		if (busy) return
		setBusy(true)
		try {
			if (actionKind === 'append_template' && props.editor.isEditable && templateMarkdown.trim()) {
				const parsed = markdownToProseMirrorJson(templateMarkdown)
				const content = parsed.content ?? []
				if (content.length > 0) {
					const endPos = props.editor.state.doc.content.size
					props.editor.chain().focus().insertContentAt(endPos, content).run()
				}
			}
			if (api && pageId) {
				await api.triggerDocButton(pageId, {
					buttonId,
					label,
					actionKind,
					automationRuleId,
					payload: { templateMarkdown }
				})
			}
			pushToast({ tone: 'success', title: label })
		} catch (err) {
			pushToast({
				tone: 'danger',
				title: err instanceof Error ? err.message : 'Action failed'
			})
		} finally {
			setBusy(false)
		}
	}

	return (
		<NodeViewWrapper
			data-button-block="true"
			contentEditable={false}
			className="my-2 flex items-center gap-2"
		>
			<Button
				type="button"
				size="sm"
				tone={mapToneToButtonTone(tone)}
				disabled={busy}
				onClick={() => void handleTrigger()}
			>
				<Play className="size-3.5" aria-hidden />
				<span>{label}</span>
			</Button>

			{props.editor.isEditable ? (
				<Popover open={configOpen} onOpenChange={setConfigOpen}>
					<PopoverTrigger asChild>
						<Button
							type="button"
							size="icon"
							tone="ghost"
							className="size-7"
							aria-label={t('docs.block.menu-label')}
						>
							<Settings2 className="size-3.5" aria-hidden />
						</Button>
					</PopoverTrigger>
					<PopoverContent align="start" className="w-72 space-y-2.5 p-3">
						<Input
							aria-label={t('docs.button.run')}
							value={label}
							onChange={(ev) => props.updateAttributes({ label: ev.target.value })}
							className="h-8 text-xs"
						/>
						<Select
							value={actionKind}
							onValueChange={(v) =>
								props.updateAttributes({
									actionKind: v === 'run_automation' ? 'run_automation' : 'append_template'
								})
							}
						>
							<SelectTrigger className="h-8 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="append_template">Append template block</SelectItem>
								<SelectItem value="run_automation">Trigger automation webhook</SelectItem>
							</SelectContent>
						</Select>
						{actionKind === 'append_template' ? (
							<Textarea
								value={templateMarkdown}
								onChange={(ev) => props.updateAttributes({ templateMarkdown: ev.target.value })}
								rows={3}
								className="min-h-16 font-mono text-xs"
							/>
						) : null}
					</PopoverContent>
				</Popover>
			) : null}
		</NodeViewWrapper>
	)
}

export function createButtonNodeViewExtension(opts: ButtonBlockExtensionOptions) {
	return ButtonBlockExtension.extend<ButtonBlockExtensionOptions>({
		addOptions() {
			return {
				...this.parent?.(),
				api: opts.api,
				pageId: opts.pageId
			}
		},
		addNodeView() {
			return ReactNodeViewRenderer(ButtonBlockNodeView)
		}
	})
}
