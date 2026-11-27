import type { ManualAvailabilityState, UpdateMyAvailabilityBody } from '@huriro/contracts'
import { type MessageId, t } from '@huriro/i18n'
import { Check, ChevronUp, RefreshCw, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { navigateToSettingsSection } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { useOptionalWorkspace } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'
import { AVAILABILITY_STATE_LABEL_ID, availabilityStateTone } from '../availability-state'
import { useWorkspaceAvailability } from '../hooks/use-availability'
import { AvailabilityDot } from './availability-dot'

const MANUAL_STATES: readonly ManualAvailabilityState[] = ['auto', 'available', 'busy', 'dnd', 'away', 'ooo']

const MANUAL_LABEL: Record<ManualAvailabilityState, MessageId> = {
	auto: 'availability.manual.auto',
	available: 'availability.manual.available',
	busy: 'availability.manual.busy',
	dnd: 'availability.manual.dnd',
	away: 'availability.manual.away',
	ooo: 'availability.manual.ooo'
}

const QUICK_PRESETS: readonly { readonly emoji: string; readonly labelId: MessageId }[] = [
	{ emoji: '📅', labelId: 'availability.preset.meeting' },
	{ emoji: '🎯', labelId: 'availability.preset.focus' },
	{ emoji: '🚗', labelId: 'availability.preset.commuting' },
	{ emoji: '🌴', labelId: 'availability.preset.vacation' }
]

function tomorrowNineAmIso(): string {
	const next = new Date()
	next.setDate(next.getDate() + 1)
	next.setHours(9, 0, 0, 0)
	return next.toISOString()
}

function AvailabilitySwitcherInner({ collapsed }: { readonly collapsed: boolean }) {
	const { myAvailability, hydrating, hydrationError, refreshMyAvailability, updateMyAvailability } =
		useWorkspaceAvailability()
	const pushToast = useUiStore((s) => s.pushToast)
	const [draft, setDraft] = useState('')
	const [open, setOpen] = useState(false)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const row = myAvailability
	const effectiveState = row?.effectiveState ?? 'offline'
	const tone = availabilityStateTone(effectiveState)
	const activeOoo = row?.windows.find(
		(window) =>
			window.kind === 'ooo' &&
			Date.parse(window.startsAt) <= Date.now() &&
			Date.parse(window.endsAt) > Date.now()
	)
	const dndActive = Boolean(row?.dndUntil && Date.parse(row.dndUntil) > Date.now())

	async function commit(patch: UpdateMyAvailabilityBody, onSuccess?: () => void) {
		if (busy) return
		setBusy(true)
		setError(null)
		try {
			await updateMyAvailability({
				...patch,
				...(row ? { expectedVersion: row.version } : {})
			})
			onSuccess?.()
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Could not update availability'
			setError(message)
			pushToast({ tone: 'danger', title: message })
		} finally {
			setBusy(false)
		}
	}

	function openSettings() {
		setOpen(false)
		useUiStore.getState().setDestination('settings')
		useUiStore.getState().setSettingsSection('availability')
		navigateToSettingsSection('availability')
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					tone="ghost"
					size={collapsed ? 'icon' : 'sm'}
					className={cn('w-full justify-start gap-2 text-sidebar-foreground', collapsed && 'mx-auto w-auto')}
					aria-label={t('availability.sidebar')}
				>
					<AvailabilityDot state={effectiveState} size="md" />
					{!collapsed ? (
						<>
							<span className="min-w-0 flex-1 truncate text-start">
								{row?.statusEmoji ? `${row.statusEmoji} ` : ''}
								{row?.statusText || t(AVAILABILITY_STATE_LABEL_ID[effectiveState])}
							</span>
							<ChevronUp className="size-3.5 shrink-0 opacity-60" aria-hidden />
						</>
					) : null}
				</Button>
			</PopoverTrigger>
			<PopoverContent side={collapsed ? 'right' : 'top'} align="start" className="w-80">
				<div className="flex items-center justify-between gap-2">
					<p className="font-semibold text-sm">{t('availability.title')}</p>
					<span
						className={cn(
							'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs',
							tone.badge
						)}
					>
						<AvailabilityDot state={effectiveState} size="sm" className="ring-0" />
						{t(AVAILABILITY_STATE_LABEL_ID[effectiveState])}
					</span>
				</div>

				{!row ? (
					<div className="mt-3 space-y-2 text-xs text-muted-foreground">
						<p>
							{hydrationError ??
								(hydrating ? 'Loading availability…' : t('availability.settings.load-error'))}
						</p>
						<Button
							type="button"
							size="sm"
							tone="outline"
							className="h-7 gap-1.5 text-xs"
							disabled={hydrating}
							onClick={() => void refreshMyAvailability()}
						>
							<RefreshCw className="size-3" aria-hidden />
							{t('error.retry')}
						</Button>
					</div>
				) : (
					<>
						{activeOoo ? (
							<p className="mt-2 rounded-md bg-info/10 px-2 py-1.5 text-info text-xs">
								{activeOoo.title || t('availability.state.ooo')} ·{' '}
								{new Date(activeOoo.endsAt).toLocaleDateString()}
							</p>
						) : null}

						<div className="mt-3 grid grid-cols-2 gap-1.5">
							{MANUAL_STATES.map((state) => (
								<Button
									key={state}
									type="button"
									size="sm"
									tone={row.manualState === state ? 'secondary' : 'ghost'}
									className="justify-start gap-2"
									disabled={busy}
									onClick={() => void commit({ manualState: state })}
								>
									{row.manualState === state ? (
										<Check className="size-3.5 text-primary" aria-hidden />
									) : (
										<span className="size-3.5" aria-hidden />
									)}
									{t(MANUAL_LABEL[state])}
								</Button>
							))}
						</div>

						<form
							className="mt-3 flex gap-1.5"
							onSubmit={(event) => {
								event.preventDefault()
								const trimmed = draft.trim()
								void commit({ statusText: trimmed, statusEmoji: trimmed ? '💬' : null }, () => setDraft(''))
							}}
						>
							<Input
								value={draft}
								onChange={(event) => setDraft(event.target.value)}
								placeholder={t('availability.status.placeholder')}
								maxLength={200}
								className="h-8 text-xs"
							/>
							<Button type="submit" size="sm" className="h-8" disabled={busy}>
								{t('common.save')}
							</Button>
						</form>

						<div className="mt-2 flex flex-wrap gap-1">
							{QUICK_PRESETS.map((preset) => {
								const label = t(preset.labelId)
								return (
									<button
										key={preset.labelId}
										type="button"
										disabled={busy}
										onClick={() => void commit({ statusEmoji: preset.emoji, statusText: label })}
										className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2/60 px-2 py-0.5 text-[11px] text-foreground transition-colors hover:bg-accent"
									>
										<span aria-hidden>{preset.emoji}</span>
										<span>{label}</span>
									</button>
								)
							})}
						</div>

						<div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-border/70 pt-2.5">
							{dndActive ? (
								<Button
									type="button"
									size="sm"
									tone="outline"
									className="h-7 text-xs"
									disabled={busy}
									onClick={() => void commit({ dndUntil: null })}
								>
									{t('availability.dnd.off')}
								</Button>
							) : (
								<>
									<Button
										type="button"
										size="sm"
										tone="outline"
										className="h-7 text-xs"
										disabled={busy}
										onClick={() => void commit({ dndUntil: new Date(Date.now() + 1_800_000).toISOString() })}
									>
										{t('availability.dnd.30m')}
									</Button>
									<Button
										type="button"
										size="sm"
										tone="outline"
										className="h-7 text-xs"
										disabled={busy}
										onClick={() => void commit({ dndUntil: new Date(Date.now() + 3_600_000).toISOString() })}
									>
										{t('availability.dnd.1h')}
									</Button>
									<Button
										type="button"
										size="sm"
										tone="outline"
										className="h-7 text-xs"
										disabled={busy}
										onClick={() => void commit({ dndUntil: tomorrowNineAmIso() })}
									>
										{t('availability.dnd.today')}
									</Button>
								</>
							)}
							{row.statusText || dndActive || row.manualState !== 'auto' ? (
								<Button
									type="button"
									size="sm"
									tone="outline"
									className="h-7 text-xs"
									disabled={busy}
									onClick={() =>
										void commit({
											statusText: '',
											statusEmoji: null,
											statusExpiresAt: null,
											dndUntil: null,
											manualState: 'auto',
											manualStateExpiresAt: null
										})
									}
								>
									{t('availability.status.clear')}
								</Button>
							) : null}
							<Button
								type="button"
								size="sm"
								tone="ghost"
								className="h-7 gap-1.5 text-xs"
								onClick={openSettings}
							>
								<Settings2 className="size-3.5" aria-hidden />
								{t('nav.settings')}
							</Button>
						</div>

						{error ? <p className="mt-2 text-destructive text-xs">{error}</p> : null}
					</>
				)}
			</PopoverContent>
		</Popover>
	)
}

/** Renders only inside a booted workspace (sidebar stories render without one). */
export function AvailabilitySwitcher({ collapsed = false }: { readonly collapsed?: boolean }) {
	const workspace = useOptionalWorkspace()
	if (!workspace) return null
	return <AvailabilitySwitcherInner collapsed={collapsed} />
}
