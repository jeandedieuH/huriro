import { t } from '@huriro/i18n'
import { Clock } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export interface SchedulePopoverProps {
	readonly disabled?: boolean | undefined
	readonly onSchedule: (scheduledForIso: string) => Promise<void> | void
}

function toDatetimeLocalValue(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0')
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Popover offering preset and custom future send times for scheduled messages. */
export function SchedulePopover({ disabled, onSchedule }: SchedulePopoverProps) {
	const [open, setOpen] = useState(false)
	const [busy, setBusy] = useState(false)
	const [customValue, setCustomValue] = useState(() => toDatetimeLocalValue(new Date(Date.now() + 3_600_000)))

	async function submitIso(iso: string) {
		if (busy) return
		setBusy(true)
		try {
			await onSchedule(iso)
			setOpen(false)
		} finally {
			setBusy(false)
		}
	}

	function tomorrowMorningIso(): string {
		const dt = new Date()
		dt.setDate(dt.getDate() + 1)
		dt.setHours(9, 0, 0, 0)
		return dt.toISOString()
	}

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				if (next) setCustomValue(toDatetimeLocalValue(new Date(Date.now() + 3_600_000)))
				setOpen(next)
			}}
		>
			<PopoverTrigger asChild>
				<Button
					size="icon"
					tone="ghost"
					type="button"
					className="size-8"
					disabled={disabled || busy}
					aria-label={t('chat.composer.schedule')}
				>
					<Clock className="size-3.5" aria-hidden />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-64 space-y-2.5">
				<p className="text-xs font-semibold text-foreground">{t('chat.schedule.title')}</p>
				<div className="grid gap-1.5">
					<Button
						size="sm"
						tone="outline"
						type="button"
						disabled={busy}
						onClick={() => void submitIso(new Date(Date.now() + 3_600_000).toISOString())}
					>
						{t('chat.schedule.1h')}
					</Button>
					<Button
						size="sm"
						tone="outline"
						type="button"
						disabled={busy}
						onClick={() => void submitIso(tomorrowMorningIso())}
					>
						{t('chat.schedule.tomorrow')}
					</Button>
				</div>

				<form
					onSubmit={(ev) => {
						ev.preventDefault()
						const parsed = new Date(customValue)
						if (!Number.isNaN(parsed.getTime())) {
							void submitIso(parsed.toISOString())
						}
					}}
					className="space-y-2 border-t border-border pt-2"
				>
					<label htmlFor="chat-schedule-custom" className="block text-[11px] text-muted-foreground">
						{t('chat.schedule.custom')}
					</label>
					<input
						id="chat-schedule-custom"
						type="datetime-local"
						value={customValue}
						aria-label={t('chat.schedule.custom')}
						onChange={(ev) => setCustomValue(ev.target.value)}
						className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground shadow-(--shadow-1) focus-visible:border-ring"
					/>
					<Button size="sm" type="submit" className="w-full" loading={busy} disabled={!customValue}>
						{t('chat.schedule.confirm')}
					</Button>
				</form>
			</PopoverContent>
		</Popover>
	)
}
