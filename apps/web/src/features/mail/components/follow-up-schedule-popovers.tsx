import { t } from '@huriro/i18n'
import { BellRing, Clock } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

function formatLocalDatetimeInput(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0')
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function nextWeekdayMorning(targetDay: number): Date {
	const d = new Date()
	const diff = (targetDay + 7 - d.getDay()) % 7 || 7
	d.setDate(d.getDate() + diff)
	d.setHours(9, 0, 0, 0)
	return d
}

export interface SendLaterPopoverProps {
	readonly disabled?: boolean | undefined
	readonly onSchedule: (isoDateTime: string) => Promise<void>
}

/**
 * Send Later scheduler popover allowing preset or custom future delivery timestamps.
 */
export function SendLaterPopover({ disabled = false, onSchedule }: SendLaterPopoverProps) {
	const [open, setOpen] = useState(false)
	const [customValue, setCustomValue] = useState(() =>
		formatLocalDatetimeInput(new Date(Date.now() + 3 * 3_600_000))
	)
	const [busy, setBusy] = useState(false)

	const commit = async (target: Date) => {
		if (busy || Number.isNaN(target.getTime()) || target.getTime() <= Date.now()) return
		setBusy(true)
		try {
			await onSchedule(target.toISOString())
			setOpen(false)
		} finally {
			setBusy(false)
		}
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button size="sm" tone="outline" type="button" disabled={disabled}>
					<Clock className="size-3.5" aria-hidden />
					<span>{t('mail.send-later.button')}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-72 p-3" align="end">
				<p className="mb-2 text-xs font-semibold text-foreground">{t('mail.send-later.title')}</p>
				<div className="mb-3 flex flex-col gap-1">
					<button
						type="button"
						disabled={busy}
						onClick={() => void commit(new Date(Date.now() + 3 * 3_600_000))}
						className="rounded-sm px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent"
					>
						{t('mail.send-later.later-today')}
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => {
							const tomorrow = new Date()
							tomorrow.setDate(tomorrow.getDate() + 1)
							tomorrow.setHours(9, 0, 0, 0)
							void commit(tomorrow)
						}}
						className="rounded-sm px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent"
					>
						{t('mail.send-later.tomorrow-morning')}
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => void commit(nextWeekdayMorning(1))}
						className="rounded-sm px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent"
					>
						{t('mail.send-later.next-monday')}
					</button>
				</div>

				<form
					onSubmit={(ev) => {
						ev.preventDefault()
						void commit(new Date(customValue))
					}}
					className="space-y-2 border-t border-border pt-2"
				>
					<label htmlFor="mail-send-later-custom" className="block text-[11px] text-muted-foreground">
						{t('mail.send-later.custom')}
					</label>
					<Input
						id="mail-send-later-custom"
						type="datetime-local"
						value={customValue}
						onChange={(e) => setCustomValue(e.target.value)}
						className="h-8 text-xs"
					/>
					<Button size="sm" type="submit" disabled={busy || !customValue} className="w-full">
						{t('mail.send-later.schedule')}
					</Button>
				</form>
			</PopoverContent>
		</Popover>
	)
}

export interface FollowUpPopoverProps {
	readonly followUpAt: string | null
	readonly followUpCondition: 'if_no_reply' | 'always' | null
	readonly disabled?: boolean | undefined
	readonly onSetFollowUp: (
		followUpAt: string | null,
		condition: 'if_no_reply' | 'always' | null
	) => Promise<void>
}

/**
 * Conversation follow-up reminder popover ("Remind me if no reply" or always).
 */
export function FollowUpPopover({
	followUpAt,
	followUpCondition,
	disabled = false,
	onSetFollowUp
}: FollowUpPopoverProps) {
	const [open, setOpen] = useState(false)
	const [condition, setCondition] = useState<'if_no_reply' | 'always'>(followUpCondition ?? 'if_no_reply')
	const [customValue, setCustomValue] = useState(() =>
		formatLocalDatetimeInput(new Date(Date.now() + 2 * 86_400_000))
	)
	const [busy, setBusy] = useState(false)

	const commit = async (target: Date) => {
		if (busy || Number.isNaN(target.getTime())) return
		setBusy(true)
		try {
			await onSetFollowUp(target.toISOString(), condition)
			setOpen(false)
		} finally {
			setBusy(false)
		}
	}

	const clear = async () => {
		if (busy) return
		setBusy(true)
		try {
			await onSetFollowUp(null, null)
			setOpen(false)
		} finally {
			setBusy(false)
		}
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button size="sm" tone={followUpAt ? 'default' : 'outline'} type="button" disabled={disabled}>
					<BellRing className="size-3.5" aria-hidden />
					<span>{t('mail.followup.button')}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-72 p-3" align="end">
				<p className="mb-2 text-xs font-semibold text-foreground">{t('mail.followup.title')}</p>
				<div className="mb-2 space-y-1">
					<select
						aria-label={t('mail.followup.title')}
						value={condition}
						onChange={(e) => setCondition(e.target.value as 'if_no_reply' | 'always')}
						className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
					>
						<option value="if_no_reply">{t('mail.followup.condition-no-reply')}</option>
						<option value="always">{t('mail.followup.condition-always')}</option>
					</select>
				</div>
				<div className="mb-3 flex flex-col gap-1">
					<button
						type="button"
						disabled={busy}
						onClick={() => void commit(new Date(Date.now() + 2 * 86_400_000))}
						className="rounded-sm px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent"
					>
						{t('mail.followup.in-2-days')}
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => void commit(new Date(Date.now() + 5 * 86_400_000))}
						className="rounded-sm px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent"
					>
						{t('mail.followup.in-5-days')}
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => void commit(new Date(Date.now() + 7 * 86_400_000))}
						className="rounded-sm px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent"
					>
						{t('mail.followup.next-week')}
					</button>
				</div>
				<form
					onSubmit={(ev) => {
						ev.preventDefault()
						void commit(new Date(customValue))
					}}
					className="space-y-2 border-t border-border pt-2"
				>
					<label htmlFor="mail-followup-custom" className="block text-[11px] text-muted-foreground">
						{t('mail.followup.custom')}
					</label>
					<Input
						id="mail-followup-custom"
						type="datetime-local"
						value={customValue}
						onChange={(e) => setCustomValue(e.target.value)}
						className="h-8 text-xs"
					/>
					<div className="flex gap-1.5">
						<Button size="sm" type="submit" disabled={busy || !customValue} className="flex-1">
							{t('mail.followup.set')}
						</Button>
						{followUpAt ? (
							<Button size="sm" tone="outline" type="button" disabled={busy} onClick={() => void clear()}>
								{t('mail.followup.clear')}
							</Button>
						) : null}
					</div>
				</form>
			</PopoverContent>
		</Popover>
	)
}
