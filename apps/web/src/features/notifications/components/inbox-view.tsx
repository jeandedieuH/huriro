import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import { Archive, Bell, Check, CheckCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { TaskApiBridge } from '@/lib/sync-bootstrap'
import { useUiStore } from '@/stores/ui-store'

export interface InboxViewProps {
	readonly api: TaskApiBridge
}

export function InboxView({ api }: InboxViewProps) {
	const engine = useSyncEngine()
	const notifications = useCollectionItems(engine.collections.notifications)
	const setDestination = useUiStore((s) => s.setDestination)
	const selectIssue = useUiStore((s) => s.selectIssue)

	const [tab, setTab] = useState<'unread' | 'all'>('unread')

	const visible = useMemo(() => {
		return notifications
			.filter((n) => n.archivedAt === null && (tab === 'all' || n.readAt === null))
			.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
	}, [notifications, tab])

	const unreadCount = useMemo(
		() => notifications.filter((n) => n.archivedAt === null && n.readAt === null).length,
		[notifications]
	)

	return (
		<div className="mx-auto max-w-3xl space-y-4 p-6">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<h1 className="text-xl font-semibold tracking-tight">{t('inbox.title')}</h1>
					{unreadCount > 0 ? <Badge tone="info">{unreadCount}</Badge> : null}
				</div>

				<div className="flex items-center gap-2">
					<Tabs value={tab} onValueChange={(v) => setTab(v as 'unread' | 'all')}>
						<TabsList>
							<TabsTrigger value="unread">{t('inbox.for-me')}</TabsTrigger>
							<TabsTrigger value="all">{t('inbox.all')}</TabsTrigger>
						</TabsList>
					</Tabs>

					<Button
						size="sm"
						tone="outline"
						disabled={unreadCount === 0}
						onClick={() => void api.markAllNotificationsRead()}
					>
						<CheckCheck className="size-3.5" aria-hidden />
						<span>{t('inbox.mark-all-read')}</span>
					</Button>
				</div>
			</header>

			{visible.length === 0 ? (
				<EmptyState title={t('inbox.empty')} />
			) : (
				<ul
					aria-label={t('inbox.title')}
					className="divide-y divide-border rounded-lg border border-border bg-card"
				>
					{visible.map((n) => (
						<li key={n.id} className="flex items-start justify-between gap-3 p-4">
							<button
								type="button"
								onClick={() => {
									void engine.markNotificationRead(n.id)
									if (n.entityType === 'issue') {
										setDestination('tasks')
										selectIssue(n.entityId, true)
									}
								}}
								className="min-w-0 flex-1 text-left"
							>
								<div className="flex items-center gap-2">
									<Bell className="size-3.5 shrink-0 text-(--info)" aria-hidden />
									<span
										className={n.readAt === null ? 'text-sm font-semibold' : 'text-sm text-muted-foreground'}
									>
										{n.title}
									</span>
								</div>
								{n.body ? <p className="mt-1 pl-5 text-xs text-muted-foreground">{n.body}</p> : null}
							</button>

							<div className="flex shrink-0 items-center gap-1">
								{n.readAt === null ? (
									<Button
										size="icon"
										tone="ghost"
										aria-label={t('inbox.mark-read')}
										onClick={() => void engine.markNotificationRead(n.id)}
									>
										<Check className="size-3.5" aria-hidden />
									</Button>
								) : null}
								<Button
									size="icon"
									tone="ghost"
									aria-label={t('inbox.archive')}
									onClick={() => void api.archiveNotification(n.id)}
								>
									<Archive className="size-3.5" aria-hidden />
								</Button>
							</div>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
