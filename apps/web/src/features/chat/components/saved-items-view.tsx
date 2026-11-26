import type {
	ChatChannelDto,
	ChatSavedItemBody,
	ChatSavedItemDto,
	UpdateChatSavedItemBody
} from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Archive, ArrowUpRight, CheckCircle2, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export interface SavedItemsViewProps {
	readonly items: readonly ChatSavedItemDto[]
	readonly channels: readonly ChatChannelDto[]
	readonly onSaveItem: (body: ChatSavedItemBody) => Promise<void> | void
	readonly onUpdateItem: (id: string, body: UpdateChatSavedItemBody) => Promise<void> | void
	readonly onRemoveItem: (id: string) => Promise<void> | void
	readonly onJumpToMessage: (channelId: string, messageId: string) => Promise<void> | void
}

type SavedStatusFilter = 'saved' | 'in_progress' | 'completed' | 'archived'

/** Later / Saved messages & personal reminders view with status filtering. */
export function SavedItemsView({
	items,
	channels,
	onSaveItem,
	onUpdateItem,
	onRemoveItem,
	onJumpToMessage
}: SavedItemsViewProps) {
	const [statusFilter, setStatusFilter] = useState<SavedStatusFilter>('saved')
	const [reminderText, setReminderText] = useState('')
	const [busy, setBusy] = useState(false)

	const channelNameById = new Map(channels.map((c) => [c.id, c.name ? `#${c.name}` : 'DM']))
	const filtered = items.filter((item) => item.status === statusFilter)

	async function handleAddReminder(ev: React.FormEvent) {
		ev.preventDefault()
		const trimmed = reminderText.trim()
		if (!trimmed || busy) return
		setBusy(true)
		try {
			await onSaveItem({ customText: trimmed })
			setReminderText('')
			setStatusFilter('saved')
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="flex h-full flex-col overflow-y-auto p-6">
			<div className="mx-auto w-full max-w-3xl space-y-4">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h1 className="text-lg font-semibold text-foreground">{t('chat.saved.title')}</h1>
				</div>

				<form onSubmit={(ev) => void handleAddReminder(ev)} className="flex items-center gap-2">
					<Input
						value={reminderText}
						onChange={(ev) => setReminderText(ev.target.value)}
						placeholder={t('chat.saved.reminder-placeholder')}
						aria-label={t('chat.saved.reminder-placeholder')}
						maxLength={4000}
					/>
					<Button size="sm" type="submit" loading={busy} disabled={!reminderText.trim()}>
						<Plus className="size-3.5" aria-hidden />
						<span>{t('chat.saved.add-reminder')}</span>
					</Button>
				</form>

				<Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as SavedStatusFilter)}>
					<TabsList>
						<TabsTrigger value="saved">{t('chat.saved.status.saved')}</TabsTrigger>
						<TabsTrigger value="in_progress">{t('chat.saved.status.in_progress')}</TabsTrigger>
						<TabsTrigger value="completed">{t('chat.saved.status.completed')}</TabsTrigger>
						<TabsTrigger value="archived">{t('chat.saved.status.archived')}</TabsTrigger>
					</TabsList>

					<TabsContent value={statusFilter}>
						{filtered.length === 0 ? (
							<EmptyState title={t('chat.saved.empty')} />
						) : (
							<div className="space-y-2">
								{filtered.map((item) => {
									const channelLabel = item.channelId ? channelNameById.get(item.channelId) : undefined
									const displayBody = item.messageText || item.customText || item.note || ''

									return (
										<div
											key={item.id}
											className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-card p-3"
										>
											<div className="min-w-0 flex-1 space-y-1">
												<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
													{channelLabel ? <Badge tone="secondary">{channelLabel}</Badge> : null}
													{item.remindAt ? (
														<span className="tnum">{new Date(item.remindAt).toLocaleString()}</span>
													) : null}
												</div>
												<p className="text-sm text-foreground">{displayBody}</p>
												{item.note && item.note !== displayBody ? (
													<p className="text-xs text-muted-foreground">{item.note}</p>
												) : null}
											</div>

											<div className="flex shrink-0 items-center gap-1">
												{item.channelId && item.messageId ? (
													<Button
														size="sm"
														tone="outline"
														type="button"
														onClick={() => void onJumpToMessage(item.channelId!, item.messageId!)}
													>
														<ArrowUpRight className="size-3.5" aria-hidden />
														<span>{t('chat.saved.jump')}</span>
													</Button>
												) : null}
												{item.status !== 'completed' ? (
													<Button
														size="icon"
														tone="ghost"
														type="button"
														aria-label={t('chat.saved.complete')}
														onClick={() =>
															void onUpdateItem(item.id, { status: 'completed', version: item.version })
														}
													>
														<CheckCircle2 className="size-4 text-(--success)" aria-hidden />
													</Button>
												) : null}
												{item.status !== 'archived' ? (
													<Button
														size="icon"
														tone="ghost"
														type="button"
														aria-label={t('chat.saved.archive')}
														onClick={() =>
															void onUpdateItem(item.id, { status: 'archived', version: item.version })
														}
													>
														<Archive className="size-4 text-muted-foreground" aria-hidden />
													</Button>
												) : null}
												<Button
													size="icon"
													tone="ghost"
													type="button"
													aria-label={t('chat.saved.delete')}
													onClick={() => void onRemoveItem(item.id)}
												>
													<Trash2 className="size-4 text-destructive" aria-hidden />
												</Button>
											</div>
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
