import type { MailSlaAnalyticsDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'

export interface MailSlaAnalyticsCardProps {
	readonly analytics: MailSlaAnalyticsDto
}

/**
 * Compact visual SLA metrics + semantic compliance bar displayed inside Mail Settings.
 */
export function MailSlaAnalyticsCard({ analytics }: MailSlaAnalyticsCardProps) {
	const total = Math.max(analytics.conversationCount, 0)
	const repliedRate = total > 0 ? Math.round((analytics.repliedCount / total) * 100) : 100
	const complianceRate =
		total > 0 ? Math.max(0, Math.round(((total - analytics.breachedCount) / total) * 100)) : 100

	return (
		<div className="space-y-3 rounded-md border border-border bg-surface-2/40 p-3 text-xs">
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<div>
					<p className="text-[11px] text-muted-foreground">{t('mail.sla.compliance-rate')}</p>
					<p className="text-base font-semibold text-foreground tnum">{complianceRate}%</p>
				</div>
				<div>
					<p className="text-[11px] text-muted-foreground">{t('mail.sla.reply-rate')}</p>
					<p className="text-base font-semibold text-foreground tnum">{repliedRate}%</p>
				</div>
				<div>
					<p className="text-[11px] text-muted-foreground">{t('mail.sla.avg-first-reply')}</p>
					<p className="text-base font-semibold text-foreground tnum">
						{analytics.avgFirstReplyMinutes !== null
							? t('mail.sla.minutes', { minutes: Math.round(analytics.avgFirstReplyMinutes) })
							: '—'}
					</p>
				</div>
				<div>
					<p className="text-[11px] text-muted-foreground">{t('mail.sla.avg-resolution')}</p>
					<p className="text-base font-semibold text-foreground tnum">
						{analytics.avgResolutionMinutes !== null
							? t('mail.sla.minutes', { minutes: Math.round(analytics.avgResolutionMinutes) })
							: '—'}
					</p>
				</div>
			</div>

			<div className="space-y-1">
				<div className="flex items-center justify-between text-[11px] text-muted-foreground">
					<span>{t('mail.sla.compliance-rate')}</span>
					<span>
						{t('mail.sla.breaches')}: {analytics.breachedCount} / {total}
					</span>
				</div>
				<div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
					<div className="h-full bg-success transition-all" style={{ width: `${complianceRate}%` }} />
					{analytics.breachedCount > 0 ? (
						<div
							className="h-full bg-destructive transition-all"
							style={{ width: `${Math.max(100 - complianceRate, 4)}%` }}
						/>
					) : null}
				</div>
			</div>
		</div>
	)
}
