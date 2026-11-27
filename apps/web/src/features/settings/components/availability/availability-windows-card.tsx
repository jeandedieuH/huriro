import type {
	AvailabilityWindowDto,
	AvailabilityWindowKind,
	CreateAvailabilityWindowBody,
	UpdateAvailabilityWindowBody,
	UserAvailabilityDto
} from '@huriro/contracts'
import { type MessageId, t } from '@huriro/i18n'
import { CalendarOff, Pencil, Trash2 } from 'lucide-react'
import { type FormEvent, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { WorkspaceMemberSummary } from '@/lib/api-bridge'
import { useUiStore } from '@/stores/ui-store'
import {
	SettingsCard,
	SettingsCardBody,
	SettingsCardFooter,
	SettingsCardHeader,
	SettingsEmptyState,
	SettingsNotice
} from '../settings-primitives'

export interface AvailabilityWindowsCardProps {
	readonly profile: UserAvailabilityDto
	readonly windows: readonly AvailabilityWindowDto[]
	readonly members: readonly WorkspaceMemberSummary[]
	readonly onCreateWindow: (body: CreateAvailabilityWindowBody) => Promise<AvailabilityWindowDto>
	readonly onUpdateWindow: (id: string, body: UpdateAvailabilityWindowBody) => Promise<AvailabilityWindowDto>
	readonly onDeleteWindow: (id: string) => Promise<void>
}

const NO_DELEGATE = '__none__'

const KIND_LABEL_ID: Record<AvailabilityWindowKind, MessageId> = {
	ooo: 'availability.windows.kind.ooo',
	focus: 'availability.windows.kind.focus',
	dnd: 'availability.windows.kind.dnd'
}

const KIND_BADGE_TONE: Record<AvailabilityWindowKind, 'warning' | 'info' | 'secondary'> = {
	ooo: 'warning',
	focus: 'info',
	dnd: 'secondary'
}

function padTwo(value: number): string {
	return String(value).padStart(2, '0')
}

function toDatetimeLocalValue(iso: string): string {
	const date = new Date(iso)
	if (Number.isNaN(date.getTime())) return ''
	return `${date.getFullYear()}-${padTwo(date.getMonth() + 1)}-${padTwo(date.getDate())}T${padTwo(date.getHours())}:${padTwo(date.getMinutes())}`
}

function defaultRangeLocal(): { readonly startsAt: string; readonly endsAt: string } {
	const start = new Date()
	start.setDate(start.getDate() + 1)
	start.setHours(9, 0, 0, 0)
	const end = new Date(start)
	end.setHours(17, 0, 0, 0)
	return {
		startsAt: toDatetimeLocalValue(start.toISOString()),
		endsAt: toDatetimeLocalValue(end.toISOString())
	}
}

function formatRange(startsAt: string, endsAt: string): string {
	const fmt = new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	})
	return `${fmt.format(new Date(startsAt))} – ${fmt.format(new Date(endsAt))}`
}

function windowTemporalStatus(window: AvailabilityWindowDto): {
	readonly labelId: MessageId
	readonly tone: 'success' | 'info' | 'outline'
} {
	const now = Date.now()
	const start = Date.parse(window.startsAt)
	const end = Date.parse(window.endsAt)
	if (end <= now) return { labelId: 'availability.windows.status.ended', tone: 'outline' }
	if (start <= now) return { labelId: 'availability.windows.status.active', tone: 'success' }
	return { labelId: 'availability.windows.status.upcoming', tone: 'info' }
}

/** Card 3: list, schedule, edit, and delete OOO, focus, and DND windows with backup delegates. */
export function AvailabilityWindowsCard({
	profile,
	windows,
	members,
	onCreateWindow,
	onUpdateWindow,
	onDeleteWindow
}: AvailabilityWindowsCardProps) {
	const pushToast = useUiStore((s) => s.pushToast)
	const initialRange = useMemo(() => defaultRangeLocal(), [])
	const [editingId, setEditingId] = useState<string | null>(null)
	const [kind, setKind] = useState<AvailabilityWindowKind>('ooo')
	const [title, setTitle] = useState('')
	const [message, setMessage] = useState('')
	const [startsAt, setStartsAt] = useState(initialRange.startsAt)
	const [endsAt, setEndsAt] = useState(initialRange.endsAt)
	const [delegateUserId, setDelegateUserId] = useState(NO_DELEGATE)
	const [autoDeclineRouting, setAutoDeclineRouting] = useState(true)
	const [suppressNotifications, setSuppressNotifications] = useState(true)
	const [saving, setSaving] = useState(false)
	const [deletingId, setDeletingId] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	const memberById = useMemo(() => {
		const map = new Map<string, WorkspaceMemberSummary>()
		for (const member of members) map.set(member.userId, member)
		return map
	}, [members])

	const eligibleDelegates = useMemo(
		() => members.filter((member) => member.userId !== profile.userId && member.role !== 'guest'),
		[members, profile.userId]
	)

	const sortedWindows = useMemo(
		() => [...windows].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
		[windows]
	)

	function resetForm() {
		const range = defaultRangeLocal()
		setEditingId(null)
		setKind('ooo')
		setTitle('')
		setMessage('')
		setStartsAt(range.startsAt)
		setEndsAt(range.endsAt)
		setDelegateUserId(NO_DELEGATE)
		setAutoDeclineRouting(true)
		setSuppressNotifications(true)
		setError(null)
	}

	function startEdit(window: AvailabilityWindowDto) {
		setEditingId(window.id)
		setKind(window.kind)
		setTitle(window.title)
		setMessage(window.message)
		setStartsAt(toDatetimeLocalValue(window.startsAt))
		setEndsAt(toDatetimeLocalValue(window.endsAt))
		setDelegateUserId(window.delegateUserId ?? NO_DELEGATE)
		setAutoDeclineRouting(window.autoDeclineRouting)
		setSuppressNotifications(window.suppressNotifications)
		setError(null)
	}

	async function handleSubmit(event: FormEvent) {
		event.preventDefault()
		if (saving) return
		const startDate = new Date(startsAt)
		const endDate = new Date(endsAt)
		if (
			Number.isNaN(startDate.getTime()) ||
			Number.isNaN(endDate.getTime()) ||
			endDate.getTime() <= startDate.getTime()
		) {
			setError(t('availability.windows.invalid-range'))
			return
		}
		setSaving(true)
		setError(null)
		try {
			const payloadBase = {
				kind,
				title: title.trim() || t(KIND_LABEL_ID[kind]),
				message: message.trim(),
				startsAt: startDate.toISOString(),
				endsAt: endDate.toISOString(),
				delegateUserId: delegateUserId === NO_DELEGATE ? null : delegateUserId,
				autoDeclineRouting,
				suppressNotifications
			}
			if (editingId) {
				await onUpdateWindow(editingId, payloadBase)
				pushToast({ tone: 'success', title: t('availability.windows.updated') })
			} else {
				await onCreateWindow(payloadBase)
				pushToast({ tone: 'success', title: t('availability.windows.created') })
			}
			resetForm()
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not save scheduled window')
		} finally {
			setSaving(false)
		}
	}

	async function handleDelete(id: string) {
		if (deletingId) return
		setDeletingId(id)
		setError(null)
		try {
			await onDeleteWindow(id)
			if (editingId === id) resetForm()
			pushToast({ tone: 'success', title: t('availability.windows.deleted') })
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not delete availability window')
		} finally {
			setDeletingId(null)
		}
	}

	return (
		<SettingsCard labelledBy="availability-windows-heading">
			<SettingsCardHeader
				headingId="availability-windows-heading"
				icon={<CalendarOff className="size-4" aria-hidden />}
				title={t('availability.windows.title')}
				description={t('availability.windows.desc')}
				badge={
					<Badge tone="secondary">
						{t('availability.windows.count', { count: String(sortedWindows.length) })}
					</Badge>
				}
			/>
			<SettingsCardBody>
				{error ? (
					<div className="py-3">
						<SettingsNotice tone="danger">{error}</SettingsNotice>
					</div>
				) : null}

				<div className="py-4">
					{sortedWindows.length === 0 ? (
						<SettingsEmptyState
							icon={<CalendarOff className="size-5" aria-hidden />}
							message={t('availability.windows.empty')}
						/>
					) : (
						<ul className="space-y-2.5">
							{sortedWindows.map((window) => {
								const status = windowTemporalStatus(window)
								const delegate = window.delegateUserId ? memberById.get(window.delegateUserId) : null
								return (
									<li
										key={window.id}
										className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3.5 py-3"
									>
										<div className="min-w-0 flex-1 space-y-1">
											<div className="flex flex-wrap items-center gap-1.5">
												<Badge tone={KIND_BADGE_TONE[window.kind]}>{t(KIND_LABEL_ID[window.kind])}</Badge>
												<Badge tone={status.tone}>{t(status.labelId)}</Badge>
												<span className="truncate text-sm font-medium text-foreground">
													{window.title || t(KIND_LABEL_ID[window.kind])}
												</span>
											</div>
											<p className="text-xs text-muted-foreground tabular-nums">
												{formatRange(window.startsAt, window.endsAt)}
											</p>
											{window.message ? (
												<p className="text-xs text-muted-foreground">{window.message}</p>
											) : null}
											<div className="flex flex-wrap items-center gap-1.5 pt-0.5">
												{window.delegateUserId ? (
													<Badge tone="outline">
														{t('availability.hover.backup')}: {delegate?.displayName ?? window.delegateUserId}
													</Badge>
												) : null}
												{window.autoDeclineRouting ? (
													<Badge tone="outline">{t('availability.windows.auto-decline')}</Badge>
												) : null}
												{window.suppressNotifications ? (
													<Badge tone="outline">{t('availability.windows.suppress')}</Badge>
												) : null}
											</div>
										</div>
										<div className="flex shrink-0 items-center gap-1">
											<Button
												type="button"
												tone="ghost"
												size="sm"
												className="h-8 gap-1 px-2 text-xs"
												aria-label={`${t('availability.windows.edit')} ${window.title || window.id}`}
												onClick={() => startEdit(window)}
											>
												<Pencil className="size-3.5" aria-hidden />
												{t('availability.windows.edit')}
											</Button>
											<Button
												type="button"
												tone="ghost"
												size="sm"
												className="h-8 gap-1 px-2 text-xs text-destructive hover:text-destructive"
												loading={deletingId === window.id}
												aria-label={`${t('availability.windows.delete')} ${window.title || window.id}`}
												onClick={() => void handleDelete(window.id)}
											>
												<Trash2 className="size-3.5" aria-hidden />
												{t('availability.windows.delete')}
											</Button>
										</div>
									</li>
								)
							})}
						</ul>
					)}
				</div>

				<form onSubmit={handleSubmit} className="space-y-3.5 py-4">
					<h3 className="text-sm font-medium text-foreground">
						{editingId ? t('availability.windows.edit') : t('availability.windows.add')}
					</h3>

					<div className="grid gap-3 sm:grid-cols-2">
						<div className="space-y-1.5">
							<label htmlFor="avail-window-kind" className="text-xs font-medium text-muted-foreground">
								{t('availability.windows.kind')}
							</label>
							<Select value={kind} onValueChange={(value) => setKind(value as AvailabilityWindowKind)}>
								<SelectTrigger id="avail-window-kind" aria-label={t('availability.windows.kind')}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="ooo">{t('availability.windows.kind.ooo')}</SelectItem>
									<SelectItem value="focus">{t('availability.windows.kind.focus')}</SelectItem>
									<SelectItem value="dnd">{t('availability.windows.kind.dnd')}</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-1.5">
							<label htmlFor="avail-window-title" className="text-xs font-medium text-muted-foreground">
								{t('availability.windows.title-label')}
							</label>
							<Input
								id="avail-window-title"
								value={title}
								maxLength={120}
								placeholder={t('availability.windows.title-placeholder')}
								onChange={(e) => setTitle(e.target.value)}
							/>
						</div>

						<div className="space-y-1.5">
							<label htmlFor="avail-window-starts" className="text-xs font-medium text-muted-foreground">
								{t('availability.windows.starts')}
							</label>
							<Input
								id="avail-window-starts"
								type="datetime-local"
								value={startsAt}
								required
								onChange={(e) => setStartsAt(e.target.value)}
							/>
						</div>

						<div className="space-y-1.5">
							<label htmlFor="avail-window-ends" className="text-xs font-medium text-muted-foreground">
								{t('availability.windows.ends')}
							</label>
							<Input
								id="avail-window-ends"
								type="datetime-local"
								value={endsAt}
								required
								onChange={(e) => setEndsAt(e.target.value)}
							/>
						</div>
					</div>

					<div className="space-y-1.5">
						<label htmlFor="avail-window-delegate" className="text-xs font-medium text-muted-foreground">
							{t('availability.windows.delegate')}
						</label>
						<Select value={delegateUserId} onValueChange={setDelegateUserId}>
							<SelectTrigger id="avail-window-delegate" aria-label={t('availability.windows.delegate')}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={NO_DELEGATE}>{t('availability.windows.no-delegate')}</SelectItem>
								{delegateUserId !== NO_DELEGATE &&
								!eligibleDelegates.some((m) => m.userId === delegateUserId) ? (
									<SelectItem value={delegateUserId}>
										{memberById.get(delegateUserId)?.displayName ?? delegateUserId}
									</SelectItem>
								) : null}
								{eligibleDelegates.map((member) => (
									<SelectItem key={member.userId} value={member.userId}>
										{member.displayName} · {member.role}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-1.5">
						<label htmlFor="avail-window-message" className="text-xs font-medium text-muted-foreground">
							{t('availability.windows.message-label')}
						</label>
						<Textarea
							id="avail-window-message"
							rows={2}
							value={message}
							maxLength={400}
							placeholder={t('availability.windows.message-placeholder')}
							onChange={(e) => setMessage(e.target.value)}
						/>
					</div>

					<div className="flex flex-wrap gap-5 pt-1">
						<div className="flex items-center gap-2">
							<Checkbox
								id="avail-window-auto-decline"
								checked={autoDeclineRouting}
								onCheckedChange={(checked) => setAutoDeclineRouting(checked === true)}
							/>
							<label htmlFor="avail-window-auto-decline" className="text-sm text-foreground">
								{t('availability.windows.auto-decline')}
							</label>
						</div>
						<div className="flex items-center gap-2">
							<Checkbox
								id="avail-window-suppress"
								checked={suppressNotifications}
								onCheckedChange={(checked) => setSuppressNotifications(checked === true)}
							/>
							<label htmlFor="avail-window-suppress" className="text-sm text-foreground">
								{t('availability.windows.suppress')}
							</label>
						</div>
					</div>

					<SettingsCardFooter className="border-t-0 px-0 pt-2 pb-0">
						<div />
						<div className="flex items-center gap-2">
							{editingId ? (
								<Button type="button" tone="ghost" size="sm" onClick={resetForm}>
									{t('availability.windows.cancel')}
								</Button>
							) : null}
							<Button type="submit" size="sm" loading={saving}>
								{t(editingId ? 'availability.windows.update' : 'availability.windows.add')}
							</Button>
						</div>
					</SettingsCardFooter>
				</form>
			</SettingsCardBody>
		</SettingsCard>
	)
}
