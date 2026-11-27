import { buildAvailabilityWarning } from '@huriro/domain'
import { t } from '@huriro/i18n'
import { UserRoundCheck, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useUserAvailability, useWorkspaceAvailability } from '../hooks/use-availability'

function formatBannerTimestamp(iso: unknown): string {
	if (typeof iso !== 'string' || !iso) return ''
	const parsed = Date.parse(iso)
	if (!Number.isFinite(parsed)) return iso
	return new Date(parsed).toLocaleString(undefined, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	})
}

export interface AvailabilityWarningBannerProps {
	readonly userId: string | null | undefined
	readonly displayName?: string | undefined
	readonly onAssignDelegate?: ((delegateUserId: string) => void | Promise<void>) | undefined
	readonly className?: string | undefined
}

/**
 * Non-blocking OOO/DND/off-hours hint shared by task assignment, mail
 * assignment, and chat DM composers. Rendering never blocks the action.
 */
export function AvailabilityWarningBanner({
	userId,
	displayName,
	onAssignDelegate,
	className
}: AvailabilityWarningBannerProps) {
	const availability = useUserAvailability(userId)
	const { byUser } = useWorkspaceAvailability()
	const [dismissedUserId, setDismissedUserId] = useState<string | null>(null)
	const dismissed = Boolean(userId && dismissedUserId === userId)

	if (!availability || dismissed) return null
	const warning = buildAvailabilityWarning(
		{
			state: availability.effectiveState,
			statusText: availability.statusText,
			nextAvailableAt: availability.nextAvailableAt,
			delegateUserId: availability.delegateUserId,
			activeWindow:
				availability.windows.find(
					(window) => Date.parse(window.startsAt) <= Date.now() && Date.parse(window.endsAt) > Date.now()
				) ?? null
		},
		displayName ?? availability.displayName ?? 'This teammate'
	)
	if (!warning) return null
	const delegate = warning.delegateUserId ? byUser.get(warning.delegateUserId) : null
	const tone =
		warning.severity === 'warning'
			? 'border-warning/40 bg-warning/10 text-warning'
			: 'border-info/40 bg-info/10 text-info'

	return (
		<div
			role="status"
			className={cn('flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs', tone, className)}
		>
			<span className="min-w-0 flex-1">
				{t(warning.i18nKey, {
					name: String(warning.params['name'] ?? ''),
					until: formatBannerTimestamp(warning.params['until']),
					next: formatBannerTimestamp(warning.params['next'])
				})}
			</span>
			{delegate && onAssignDelegate ? (
				<Button
					type="button"
					size="sm"
					tone="outline"
					className="h-7 gap-1.5 text-xs"
					onClick={() => void onAssignDelegate(delegate.userId)}
				>
					<UserRoundCheck className="size-3.5" aria-hidden />
					{t('availability.warning.assign-backup')} — {delegate.displayName ?? delegate.userId}
				</Button>
			) : null}
			<button
				type="button"
				aria-label={t('shell.sidebar.filter-clear')}
				className="rounded p-0.5 opacity-70 hover:opacity-100"
				onClick={() => setDismissedUserId(userId ?? null)}
			>
				<X className="size-3.5" aria-hidden />
			</button>
		</div>
	)
}
