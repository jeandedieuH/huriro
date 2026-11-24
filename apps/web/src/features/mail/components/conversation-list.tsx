import type { MailConversationDto, MailConversationStatus } from '@huriro/contracts'
import { type MessageId, t } from '@huriro/i18n'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'

const SKELETON_KEYS = Array.from({ length: 8 }, (_, i) => `mail-skel-${i}`)

const STATUS_LABELS: Record<MailConversationStatus, MessageId> = {
	open: 'mail.conv.status.open',
	pending: 'mail.conv.status.pending',
	snoozed: 'mail.conv.status.snoozed',
	closed: 'mail.conv.status.closed',
	spam: 'mail.conv.status.spam'
}

export interface ConversationListProps {
	readonly conversations: readonly MailConversationDto[]
	readonly activeId: string | null
	readonly loading: boolean
	readonly hasMore: boolean
	readonly loadingMore: boolean
	readonly onSelect: (id: string) => void
	readonly onLoadMore: () => void
}

function relativeTime(iso: string): string {
	const diff = Date.now() - new Date(iso).getTime()
	const minutes = Math.floor(diff / 60_000)
	if (minutes < 1) return 'now'
	if (minutes < 60) return `${minutes}m`
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return `${hours}h`
	return `${Math.floor(hours / 24)}d`
}

export function ConversationList({
	conversations,
	activeId,
	loading,
	hasMore,
	loadingMore,
	onSelect,
	onLoadMore
}: ConversationListProps) {
	if (loading) {
		return (
			<div className="space-y-1 p-2" aria-busy>
				{SKELETON_KEYS.map((key) => (
					<Skeleton key={key} className="h-16 w-full" />
				))}
			</div>
		)
	}
	if (conversations.length === 0) {
		return <EmptyState title={t('mail.list.empty')} className="p-6" />
	}
	return (
		<div className="flex flex-col">
			<ul className="divide-y divide-border">
				{conversations.map((conv) => (
					<li key={conv.id}>
						<button
							type="button"
							className={`flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors ${
								activeId === conv.id ? 'bg-accent' : 'hover:bg-accent/50'
							}`}
							aria-current={activeId === conv.id ? 'true' : undefined}
							onClick={() => onSelect(conv.id)}
						>
							<div className="flex items-baseline justify-between gap-2">
								<span className="truncate text-sm font-medium">
									{conv.assigneeName ?? conv.customerEmail ?? t('mail.conv.unassigned')}
								</span>
								<time className="shrink-0 text-xs text-muted-foreground">
									{relativeTime(conv.lastMessageAt)}
								</time>
							</div>
							<span
								className={`truncate text-sm ${conv.status === 'open' ? 'font-medium' : 'text-muted-foreground'}`}
							>
								{conv.subject}
							</span>
							<div className="flex items-center gap-2">
								<span className="truncate text-xs text-muted-foreground">{conv.snippet}</span>
								{conv.status !== 'open' ? (
									<span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
										{t(STATUS_LABELS[conv.status])}
									</span>
								) : null}
							</div>
						</button>
					</li>
				))}
			</ul>
			{hasMore ? (
				<div className="p-2">
					<Button size="sm" tone="outline" className="w-full" disabled={loadingMore} onClick={onLoadMore}>
						{loadingMore ? t('mail.list.loading') : t('mail.list.load-more')}
					</Button>
				</div>
			) : null}
		</div>
	)
}
