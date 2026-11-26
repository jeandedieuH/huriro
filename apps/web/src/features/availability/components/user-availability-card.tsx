import type { UserAvailabilityDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Clock, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { AVAILABILITY_STATE_LABEL_ID, availabilityStateTone } from '../availability-state'
import { useWorkspaceAvailability } from '../hooks/use-availability'

export interface UserAvailabilityCardProps {
	readonly availability: UserAvailabilityDto
	readonly children: ReactNode
	readonly className?: string | undefined
}

function formatWindow(iso: string): string {
	const date = new Date(iso)
	return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

export function UserAvailabilityCard({ availability, children, className }: UserAvailabilityCardProps) {
	const { byUser } = useWorkspaceAvailability()
	const delegate = availability.delegateUserId ? byUser.get(availability.delegateUserId) : null
	const tone = availabilityStateTone(availability.effectiveState)
	const activeWindow = availability.windows.find(
		(window) => Date.parse(window.startsAt) <= Date.now() && Date.parse(window.endsAt) > Date.now()
	)

	return (
		<Popover>
			<PopoverTrigger asChild>{children}</PopoverTrigger>
			<PopoverContent align="start" className={cn('w-80', className)}>
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<p className="truncate font-semibold text-sm">
							{availability.displayName ?? availability.userId}
						</p>
						<p className="text-muted-foreground text-xs">
							{t('availability.hover.local-time')}{' '}
							<span className="tabular-nums">{availability.localTimeLabel ?? '—'}</span>
						</p>
					</div>
					<Badge className={tone.badge}>{t(AVAILABILITY_STATE_LABEL_ID[availability.effectiveState])}</Badge>
				</div>

				{availability.statusText ? (
					<p className="mt-3 rounded-lg bg-muted/60 px-2.5 py-2 text-sm">
						{availability.statusEmoji ? <span className="mr-1">{availability.statusEmoji}</span> : null}
						{availability.statusText}
					</p>
				) : null}

				{activeWindow ? (
					<div className="mt-3 rounded-lg border border-info/30 bg-info/5 px-2.5 py-2 text-xs">
						<p className="font-medium text-info">{activeWindow.title || t('availability.state.ooo')}</p>
						<p className="text-muted-foreground">
							{t('availability.hover.until')} {formatWindow(activeWindow.endsAt)}
						</p>
					</div>
				) : null}

				<dl className="mt-3 space-y-1.5 text-xs">
					<div className="flex items-center justify-between gap-2">
						<dt className="flex items-center gap-1.5 text-muted-foreground">
							<Clock className="size-3.5" aria-hidden />
							{t('availability.hover.working-hours')}
						</dt>
						<dd className="tabular-nums">
							{availability.withinWorkingHours
								? t('availability.state.available')
								: t('availability.state.off_hours')}
						</dd>
					</div>
					{delegate ? (
						<div className="flex items-center justify-between gap-2">
							<dt className="flex items-center gap-1.5 text-muted-foreground">
								<Users className="size-3.5" aria-hidden />
								{t('availability.hover.backup')}
							</dt>
							<dd className="truncate">{delegate.displayName ?? delegate.userId}</dd>
						</div>
					) : null}
				</dl>
			</PopoverContent>
		</Popover>
	)
}
