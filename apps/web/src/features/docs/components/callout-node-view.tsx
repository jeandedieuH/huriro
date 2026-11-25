import { CalloutExtension, type CalloutTone } from '@huriro/editor'
import { t } from '@huriro/i18n'
import { NodeViewContent, type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, Lightbulb } from 'lucide-react'
import { type ComponentType, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface CalloutToneMeta {
	readonly id: CalloutTone
	readonly icon: ComponentType<{ readonly className?: string }>
	readonly label: () => string
	readonly iconColor: string
}

const CALLOUT_TONE_META: readonly CalloutToneMeta[] = [
	{
		id: 'info',
		icon: Info,
		label: () => t('docs.callout.tone.info'),
		iconColor: 'text-(--info)'
	},
	{
		id: 'warning',
		icon: AlertTriangle,
		label: () => t('docs.callout.tone.warning'),
		iconColor: 'text-(--warning)'
	},
	{
		id: 'success',
		icon: CheckCircle2,
		label: () => t('docs.callout.tone.success'),
		iconColor: 'text-(--success)'
	},
	{
		id: 'danger',
		icon: AlertOctagon,
		label: () => t('docs.callout.tone.danger'),
		iconColor: 'text-destructive'
	},
	{
		id: 'neutral',
		icon: Lightbulb,
		label: () => t('docs.callout.tone.neutral'),
		iconColor: 'text-muted-foreground'
	}
]

function resolveTone(raw: unknown): CalloutTone {
	if (raw === 'warning' || raw === 'success' || raw === 'danger' || raw === 'neutral') return raw
	return 'info'
}

function CalloutNodeView(props: NodeViewProps) {
	const [open, setOpen] = useState(false)
	const tone = resolveTone(props.node.attrs['tone'])
	const meta = CALLOUT_TONE_META.find((entry) => entry.id === tone) ?? CALLOUT_TONE_META[0]
	const Icon = meta?.icon ?? Info

	return (
		<NodeViewWrapper
			data-callout="true"
			data-callout-tone={tone}
			className="my-3 flex items-start gap-3 rounded-xl px-4 py-3"
		>
			<div contentEditable={false} className="mt-0.5 shrink-0 select-none">
				{props.editor.isEditable ? (
					<Popover open={open} onOpenChange={setOpen}>
						<PopoverTrigger asChild>
							<button
								type="button"
								aria-label={t('docs.callout.tone-label')}
								className={cn(
									'flex size-6 items-center justify-center rounded-md transition-colors hover:bg-background/60',
									meta?.iconColor
								)}
							>
								<Icon className="size-4" aria-hidden />
							</button>
						</PopoverTrigger>
						<PopoverContent
							align="start"
							className="w-40 space-y-0.5 rounded-xl border-border/90 bg-popover/98 p-1.5 shadow-(--shadow-3) backdrop-blur-md"
						>
							{CALLOUT_TONE_META.map((entry) => {
								const EntryIcon = entry.icon
								const active = entry.id === tone
								return (
									<button
										key={entry.id}
										type="button"
										onClick={() => {
											props.updateAttributes({ tone: entry.id })
											setOpen(false)
										}}
										className={cn(
											'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
											active ? 'bg-accent font-medium text-accent-foreground' : 'hover:bg-accent/70'
										)}
									>
										<EntryIcon className={cn('size-3.5 shrink-0', entry.iconColor)} aria-hidden />
										<span>{entry.label()}</span>
									</button>
								)
							})}
						</PopoverContent>
					</Popover>
				) : (
					<span className={cn('flex size-6 items-center justify-center', meta?.iconColor)} aria-hidden>
						<Icon className="size-4" />
					</span>
				)}
			</div>
			<NodeViewContent className="min-w-0 flex-1 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0" />
		</NodeViewWrapper>
	)
}

export const CalloutNodeViewExtension = CalloutExtension.extend({
	addNodeView() {
		return ReactNodeViewRenderer(CalloutNodeView)
	}
})
