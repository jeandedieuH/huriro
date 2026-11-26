import { t } from '@huriro/i18n'
import { type FormEvent, type ReactNode, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const CURATED_ICONS = [
	'📘',
	'📝',
	'✨',
	'🚀',
	'🧭',
	'⚙️',
	'📐',
	'🧪',
	'📊',
	'💡',
	'🎯',
	'🛡️',
	'🔐',
	'📌',
	'🗂️',
	'🏗️',
	'⚡',
	'🌿',
	'🔥',
	'💬',
	'📋',
	'🎨',
	'🧩',
	'📈',
	'🌍',
	'🤝',
	'🧠',
	'📚',
	'✅',
	'🎉',
	'🛠️',
	'🌟'
] as const

export interface PageIconPickerProps {
	readonly icon: string | null
	readonly disabled?: boolean | undefined
	readonly onSelect: (icon: string | null) => void
	readonly trigger: ReactNode
}

export interface PageIconPickerPanelProps {
	readonly icon: string | null
	readonly onSelect: (icon: string | null) => void
}

/**
 * Picker body (curated grid + custom emoji + remove). Exported separately so it can
 * live in a popover (page header) or a dialog (sidebar "Change icon" action).
 */
export function PageIconPickerPanel({ icon, onSelect }: PageIconPickerPanelProps) {
	const [customDraft, setCustomDraft] = useState('')

	function applyIcon(nextIcon: string | null) {
		onSelect(nextIcon)
		setCustomDraft('')
	}

	function handleCustomSubmit(ev: FormEvent) {
		ev.preventDefault()
		const cleaned = Array.from(customDraft.trim()).slice(0, 4).join('')
		if (!cleaned) return
		applyIcon(cleaned)
	}

	return (
		<>
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs font-medium text-muted-foreground">{t('docs.icon.picker-label')}</span>
				{icon ? (
					<Button
						type="button"
						size="sm"
						tone="ghost"
						className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
						onClick={() => applyIcon(null)}
					>
						{t('docs.icon.remove')}
					</Button>
				) : null}
			</div>

			<form onSubmit={handleCustomSubmit} className="flex items-center gap-1.5">
				<Input
					aria-label={t('docs.icon.custom-placeholder')}
					value={customDraft}
					onChange={(ev) => setCustomDraft(ev.target.value)}
					placeholder={t('docs.icon.custom-placeholder')}
					className="h-7 flex-1 text-xs"
				/>
				<Button type="submit" size="sm" tone="outline" className="h-7 px-2 text-xs">
					{t('common.save')}
				</Button>
			</form>

			<div className="grid grid-cols-8 gap-1">
				{CURATED_ICONS.map((emoji) => (
					<button
						key={emoji}
						type="button"
						aria-label={emoji}
						onClick={() => applyIcon(emoji)}
						className={cn(
							'flex size-7 items-center justify-center rounded-md text-base transition-colors hover:bg-accent',
							icon === emoji && 'bg-accent ring-1 ring-primary/50'
						)}
					>
						{emoji}
					</button>
				))}
			</div>
		</>
	)
}

export function PageIconPicker({ icon, disabled = false, onSelect, trigger }: PageIconPickerProps) {
	const [open, setOpen] = useState(false)

	if (disabled) return <>{trigger}</>

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-72 space-y-2.5 rounded-xl border-border/90 bg-popover/98 p-3 shadow-(--shadow-3) backdrop-blur-md"
			>
				<PageIconPickerPanel
					icon={icon}
					onSelect={(nextIcon) => {
						onSelect(nextIcon)
						setOpen(false)
					}}
				/>
			</PopoverContent>
		</Popover>
	)
}
