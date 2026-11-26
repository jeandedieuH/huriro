import type { MailConversationDto, MailConversationStatus, MailTagDto } from '@huriro/contracts'
import { type MessageId, t } from '@huriro/i18n'
import { BellRing } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
	readonly selectedIds?: readonly string[] | undefined
	readonly tagsById?: ReadonlyMap<string, MailTagDto> | undefined
	readonly bulkBar?: ReactNode | undefined
	readonly loading: boolean
	readonly hasMore: boolean
	readonly loadingMore: boolean
	readonly onSelect: (id: string) => void
	readonly onToggleSelect?: ((id: string) => void) | undefined
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
	selectedIds = [],
	tagsById,
	bulkBar,
	loading,
	hasMore,
	loadingMore,
	onSelect,
	onToggleSelect,
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
	const selectedSet = new Set(selectedIds)
	return (
		<div className="flex flex-col">
			{bulkBar}
			<ul className="divide-y divide-border">
				{conversations.map((conv) => {
					const isSelected = selectedSet.has(conv.id)
					const convTags = (conv.tagIds ?? [])
						.map((tagId) => tagsById?.get(tagId))
						.filter((tag): tag is MailTagDto => Boolean(tag))
						.slice(0, 2)
					return (
						<li
							key={conv.id}
							className={`flex items-start gap-2 px-2 py-2 transition-colors ${
								activeId === conv.id ? 'bg-accent' : 'hover:bg-accent/50'
							}`}
						>
							{onToggleSelect ? (
								<div className="pt-1">
									<Checkbox
										checked={isSelected}
										onCheckedChange={() => onToggleSelect(conv.id)}
										aria-label={`${t('mail.bulk.select-conversation')}: ${conv.subject}`}
									/>
								</div>
							) : null}
							<button
								type="button"
								className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
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
								<div className="flex flex-wrap items-center gap-1.5">
									<span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
										{conv.snippet}
									</span>
									{conv.status !== 'open' ? (
										<span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
											{t(STATUS_LABELS[conv.status])}
										</span>
									) : null}
									{conv.slaBreachedAt ? (
										<Badge tone="danger" className="px-1.5 py-0 text-[10px]">
											{t('mail.sla.breached')}
										</Badge>
									) : null}
									{conv.priority === 'urgent' || conv.priority === 'high' ? (
										<Badge
											tone={conv.priority === 'urgent' ? 'danger' : 'warning'}
											className="px-1.5 py-0 text-[10px]"
										>
											{conv.priority}
										</Badge>
									) : null}
									{conv.followUpAt ? (
										<Badge tone="info" className="gap-0.5 px-1.5 py-0 text-[10px]">
											<BellRing className="size-2.5" aria-hidden />
											{t('mail.follow-up')}
										</Badge>
									) : null}
									{convTags.map((tag) => (
										<Badge key={tag.id} tone="secondary" className="px-1.5 py-0 text-[10px]">
											{tag.name}
										</Badge>
									))}
								</div>
							</button>
						</li>
					)
				})}
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
