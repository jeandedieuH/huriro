import type { ChatChannelDto, ChatDraftDto, ChatScheduledMessageDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { ArrowRight, Clock, Trash2, XCircle } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export interface DraftsScheduledViewProps {
	readonly drafts: readonly ChatDraftDto[]
	readonly scheduledMessages: readonly ChatScheduledMessageDto[]
	readonly channels: readonly ChatChannelDto[]
	readonly currentUserId: string
	readonly onResumeDraft: (channelId: string, threadParentId: string | null) => Promise<void> | void
	readonly onDiscardDraft: (draftId: string) => Promise<void> | void
	readonly onCancelScheduled: (id: string, version: number) => Promise<void> | void
}

function resolveChannelLabel(channel: ChatChannelDto | undefined, currentUserId: string): string {
	if (!channel) return 'channel'
	if (channel.kind === 'dm') {
		const others = (channel.members ?? []).filter((m) => m.principalId !== currentUserId)
		return others.map((m) => m.displayName ?? m.email ?? m.principalId.slice(0, 8)).join(', ') || 'DM'
	}
	return `#${channel.name ?? 'channel'}`
}

/** Combined Drafts & Scheduled messages management view. */
export function DraftsScheduledView({
	drafts,
	scheduledMessages,
	channels,
	currentUserId,
	onResumeDraft,
	onDiscardDraft,
	onCancelScheduled
}: DraftsScheduledViewProps) {
	const [tab, setTab] = useState<'drafts' | 'scheduled'>('drafts')
	const channelById = new Map(channels.map((c) => [c.id, c]))
	const activeDrafts = drafts.filter((d) => d.bodyText.trim().length > 0)

	return (
		<div className="flex h-full flex-col overflow-y-auto p-6">
			<div className="mx-auto w-full max-w-3xl space-y-4">
				<h1 className="text-lg font-semibold text-foreground">{t('chat.drafts.title')}</h1>

				<Tabs value={tab} onValueChange={(v) => setTab(v as 'drafts' | 'scheduled')}>
					<TabsList>
						<TabsTrigger value="drafts">{t('chat.drafts.tab-drafts')}</TabsTrigger>
						<TabsTrigger value="scheduled">{t('chat.drafts.tab-scheduled')}</TabsTrigger>
					</TabsList>

					<TabsContent value="drafts">
						{activeDrafts.length === 0 ? (
							<EmptyState title={t('chat.drafts.empty')} />
						) : (
							<div className="space-y-2">
								{activeDrafts.map((draft) => (
									<div
										key={draft.id}
										className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
									>
										<div className="min-w-0 flex-1 space-y-1">
											<Badge tone="secondary">
												{resolveChannelLabel(channelById.get(draft.channelId), currentUserId)}
											</Badge>
											<p className="truncate text-sm text-foreground">{draft.bodyText}</p>
										</div>
										<div className="flex shrink-0 items-center gap-1.5">
											<Button
												size="sm"
												tone="outline"
												type="button"
												onClick={() => void onResumeDraft(draft.channelId, draft.threadParentId)}
											>
												<ArrowRight className="size-3.5" aria-hidden />
												<span>{t('chat.drafts.resume')}</span>
											</Button>
											<Button
												size="icon"
												tone="ghost"
												type="button"
												aria-label={t('chat.drafts.discard')}
												onClick={() => void onDiscardDraft(draft.id)}
											>
												<Trash2 className="size-4 text-destructive" aria-hidden />
											</Button>
										</div>
									</div>
								))}
							</div>
						)}
					</TabsContent>

					<TabsContent value="scheduled">
						{scheduledMessages.length === 0 ? (
							<EmptyState title={t('chat.scheduled.empty')} />
						) : (
							<div className="space-y-2">
								{scheduledMessages.map((msg) => {
									const tone =
										msg.status === 'sent'
											? 'success'
											: msg.status === 'failed'
												? 'danger'
												: msg.status === 'cancelled'
													? 'secondary'
													: 'info'

									return (
										<div
											key={msg.id}
											className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
										>
											<div className="min-w-0 flex-1 space-y-1">
												<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
													<Badge tone="secondary">
														{resolveChannelLabel(channelById.get(msg.channelId), currentUserId)}
													</Badge>
													<Badge tone={tone}>{msg.status}</Badge>
													<span className="inline-flex items-center gap-1 tnum">
														<Clock className="size-3" aria-hidden />
														{new Date(msg.scheduledFor).toLocaleString()}
													</span>
												</div>
												<p className="truncate text-sm text-foreground">{msg.bodyText}</p>
											</div>

											{msg.status === 'scheduled' ? (
												<Button
													size="sm"
													tone="outline"
													type="button"
													onClick={() => void onCancelScheduled(msg.id, msg.version)}
												>
													<XCircle className="size-3.5 text-destructive" aria-hidden />
													<span>{t('chat.scheduled.cancel')}</span>
												</Button>
											) : null}
										</div>
									)
								})}
							</div>
						)}
					</TabsContent>
				</Tabs>
			</div>
		</div>
	)
}
