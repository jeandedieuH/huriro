import type { ManualAvailabilityState } from '@huriro/contracts'
import { type MessageId, t } from '@huriro/i18n'
import { Check, ChevronUp, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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

function AvailabilitySwitcherInner({ collapsed }: { readonly collapsed: boolean }) {
	const { myAvailability, updateMyAvailability } = useWorkspaceAvailability()
	const [draft, setDraft] = useState('')
	const [open, setOpen] = useState(false)
	if (!myAvailability) return null
	const row = myAvailability
	const tone = availabilityStateTone(row.effectiveState)
	const activeOoo = row.windows.find(
		(window) =>
			window.kind === 'ooo' &&
			Date.parse(window.startsAt) <= Date.now() &&
			Date.parse(window.endsAt) > Date.now()
	)

	async function setManual(manualState: ManualAvailabilityState) {
		await updateMyAvailability({ manualState, expectedVersion: row.version })
	}
	async function saveStatus() {
		await updateMyAvailability({
			statusText: draft.trim(),
			statusEmoji: draft.trim() ? '💬' : null,
			expectedVersion: row.version
		})
		setDraft('')
	}
	async function toggleDnd() {
		const active = row.dndUntil && Date.parse(row.dndUntil) > Date.now()
		await updateMyAvailability({
			dndUntil: active ? null : new Date(Date.now() + 3_600_000).toISOString(),
			expectedVersion: row.version
		})
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
					<AvailabilityDot state={row.effectiveState} size="md" />
					{!collapsed ? (
						<>
							<span className="min-w-0 flex-1 truncate text-start">
								{row.statusText || t(AVAILABILITY_STATE_LABEL_ID[row.effectiveState])}
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
						<AvailabilityDot state={row.effectiveState} size="sm" className="ring-0" />
						{t(AVAILABILITY_STATE_LABEL_ID[row.effectiveState])}
					</span>
				</div>

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
							onClick={() => void setManual(state)}
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

				<div className="mt-3 flex gap-1.5">
					<Input
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						placeholder={t('availability.status.placeholder')}
						maxLength={200}
						className="h-8 text-xs"
					/>
					<Button type="button" size="sm" className="h-8" onClick={() => void saveStatus()}>
						{t('common.save')}
					</Button>
				</div>

				<div className="mt-2 flex flex-wrap gap-1.5">
					<Button
						type="button"
						size="sm"
						tone="outline"
						className="h-7 text-xs"
						onClick={() => void toggleDnd()}
					>
						{row.dndUntil ? t('availability.dnd.off') : t('availability.dnd.1h')}
					</Button>
					<Button
						type="button"
						size="sm"
						tone="outline"
						className="h-7 text-xs"
						onClick={() =>
							void updateMyAvailability({
								statusText: '',
								statusEmoji: null,
								dndUntil: null,
								manualState: 'auto',
								expectedVersion: row.version
							})
						}
					>
						{t('availability.status.clear')}
					</Button>
					<Button
						type="button"
						size="sm"
						tone="ghost"
						className="h-7 gap-1.5 text-xs"
						onClick={() => {
							setOpen(false)
							useUiStore.getState().setDestination('settings')
							useUiStore.getState().setSettingsSection('availability')
						}}
					>
						<Settings2 className="size-3.5" aria-hidden />
						{t('nav.settings')}
					</Button>
				</div>
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
