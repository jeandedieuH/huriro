import type { DocPageDto, IssueDto, NotificationDto, ProjectStatusDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import { Bell, FileText } from 'lucide-react'
import { useMemo } from 'react'
import { StatusIcon } from '@/features/tasks/components/priority-status-badge'
import { navigateToDoc } from '@/lib/navigation'
import { useWorkspace } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'

function getGreetingKey(hour: number) {
	if (hour < 12) return 'home.greeting.morning' as const
	if (hour < 17) return 'home.greeting.afternoon' as const
	return 'home.greeting.evening' as const
}

function getFirstName(displayName: string): string {
	const cleaned = displayName.replace(/\s*\(.*?\)\s*/g, '').trim()
	return cleaned.split(/\s+/)[0] || displayName
}

function formatRelativeShort(iso: string, nowMs: number): string {
	const ts = Date.parse(iso)
	if (Number.isNaN(ts)) return ''
	const diffMins = Math.max(0, Math.floor((nowMs - ts) / 60_000))
	if (diffMins < 60) return `${Math.max(1, diffMins)}m`
	const diffHours = Math.floor(diffMins / 60)
	if (diffHours < 24) return `${diffHours}h`
	const diffDays = Math.floor(diffHours / 24)
	return `${diffDays}d`
}

function formatDueLabel(dueIso: string | null, nowMs: number): string {
	if (!dueIso) return ''
	const dueDate = new Date(dueIso)
	if (Number.isNaN(dueDate.getTime())) return ''
	const todayStart = new Date(nowMs)
	todayStart.setHours(0, 0, 0, 0)
	const dueStart = new Date(dueDate)
	dueStart.setHours(0, 0, 0, 0)
	const dayDiff = Math.round((dueStart.getTime() - todayStart.getTime()) / 86_400_000)
	if (dayDiff === 0) return t('home.due.today')
	if (dayDiff === 1) return t('home.due.tomorrow')
	return new Intl.DateTimeFormat(undefined, {
		weekday: 'short',
		month: 'short',
		day: 'numeric'
	}).format(dueDate)
}

export function HomeView() {
	const { userDisplayName } = useWorkspace()
	const engine = useSyncEngine()

	const issues = useCollectionItems(engine.collections.issues)
	const statuses = useCollectionItems(engine.collections.projectStatuses)
	const notifications = useCollectionItems(engine.collections.notifications)
	const docPages = useCollectionItems(engine.collections.docPages)

	const setDestination = useUiStore((s) => s.setDestination)
	const setTasksPreset = useUiStore((s) => s.setTasksPreset)
	const selectIssue = useUiStore((s) => s.selectIssue)

	const nowMs = Date.now()
	const greetingKey = getGreetingKey(new Date(nowMs).getHours())
	const firstName = getFirstName(userDisplayName)

	const statusesById = useMemo(
		() => new Map<string, ProjectStatusDto>(statuses.map((s) => [s.id, s])),
		[statuses]
	)

	const { dueIssues, dueCount } = useMemo(() => {
		const openIssues = issues.filter((i) => i.deletedAt === null && i.closedAt === null)
		const weekEnd = nowMs + 7 * 86_400_000
		const withDueInWindow = openIssues
			.filter((i) => {
				if (!i.dueDate) return false
				const ms = Date.parse(i.dueDate)
				return !Number.isNaN(ms) && ms <= weekEnd
			})
			.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))

		if (withDueInWindow.length > 0) {
			return { dueIssues: withDueInWindow.slice(0, 6), dueCount: withDueInWindow.length }
		}
		return { dueIssues: openIssues.slice(0, 6), dueCount: openIssues.length }
	}, [issues, nowMs])

	const unreadNotifications = useMemo<readonly NotificationDto[]>(() => {
		return notifications
			.filter((n) => n.archivedAt === null && n.readAt === null)
			.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
	}, [notifications])

	const recentDocs = useMemo<readonly DocPageDto[]>(() => {
		return docPages
			.filter((p) => p.archivedAt === null && !p.isTemplate)
			.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
			.slice(0, 7)
	}, [docPages])

	function handleOpenIssue(issue: IssueDto) {
		setDestination('tasks')
		selectIssue(issue.id, true)
	}

	function handleOpenNotification(n: NotificationDto) {
		void engine.markNotificationRead(n.id)
		if (n.entityType === 'issue') {
			setDestination('tasks')
			selectIssue(n.entityId, true)
			return
		}
		if (n.entityType === 'doc_page') {
			const slug =
				typeof n.metadata['slug'] === 'string'
					? n.metadata['slug']
					: engine.collections.docPages.get(n.entityId)?.slug
			if (slug) {
				navigateToDoc(slug)
				return
			}
			setDestination('docs')
			return
		}
		setDestination('inbox')
	}

	return (
		<div className="mx-auto w-full max-w-5xl px-6 py-8 md:px-10 md:py-12">
			<header className="mb-8 space-y-1">
				<h1 className="text-2xl font-semibold tracking-tight text-foreground">
					{t(greetingKey, { name: firstName })}
				</h1>
				<p className="text-sm text-muted-foreground tnum">
					{t('home.summary', { tasks: dueCount, unread: unreadNotifications.length })}
				</p>
			</header>

			<div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
				{/* Due this week */}
				<section
					aria-label={t('home.due-this-week')}
					className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-(--shadow-1)"
				>
					<div className="flex items-center justify-between border-b border-border px-4 py-3">
						<h2 className="text-sm font-semibold text-card-foreground">{t('home.due-this-week')}</h2>
						<button
							type="button"
							onClick={() => {
								setTasksPreset('this-week')
								setDestination('tasks')
							}}
							className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
						>
							{t('home.view-all')}
						</button>
					</div>

					{dueIssues.length === 0 ? (
						<p className="px-4 py-6 text-sm text-muted-foreground">{t('home.empty.tasks')}</p>
					) : (
						<ul className="divide-y divide-border/70">
							{dueIssues.map((issue) => {
								const status = statusesById.get(issue.statusId)
								const dueLabel = formatDueLabel(issue.dueDate, nowMs)
								return (
									<li key={issue.id}>
										<button
											type="button"
											onClick={() => handleOpenIssue(issue)}
											className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-accent/50"
										>
											<StatusIcon category={status?.category ?? 'unstarted'} />
											<span className="shrink-0 font-mono text-xs text-muted-foreground tnum">
												{issue.identifier}
											</span>
											<span className="min-w-0 flex-1 truncate text-sm text-foreground">{issue.title}</span>
											{dueLabel ? (
												<span className="shrink-0 text-xs text-muted-foreground tnum">{dueLabel}</span>
											) : null}
										</button>
									</li>
								)
							})}
						</ul>
					)}
				</section>

				{/* Unread in Inbox */}
				<section
					aria-label={t('home.unread-inbox')}
					className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-(--shadow-1)"
				>
					<div className="flex items-center justify-between border-b border-border px-4 py-3">
						<h2 className="text-sm font-semibold text-card-foreground">{t('home.unread-inbox')}</h2>
						<button
							type="button"
							onClick={() => setDestination('inbox')}
							className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
						>
							{t('home.view-all')}
						</button>
					</div>

					{unreadNotifications.length === 0 ? (
						<p className="px-4 py-6 text-sm text-muted-foreground">{t('home.empty.inbox')}</p>
					) : (
						<ul className="divide-y divide-border/70">
							{unreadNotifications.slice(0, 6).map((n) => (
								<li key={n.id}>
									<button
										type="button"
										onClick={() => handleOpenNotification(n)}
										className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-accent/50"
									>
										<Bell className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
										<span className="min-w-0 flex-1 truncate text-sm text-foreground">{n.title}</span>
										<span className="shrink-0 text-xs text-muted-foreground tnum">
											{formatRelativeShort(n.createdAt, nowMs)}
										</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</section>

				{/* Recently updated docs */}
				<section
					aria-label={t('home.recent-docs')}
					className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-(--shadow-1)"
				>
					<div className="flex items-center justify-between border-b border-border px-4 py-3">
						<h2 className="text-sm font-semibold text-card-foreground">{t('home.recent-docs')}</h2>
						<button
							type="button"
							onClick={() => setDestination('docs')}
							className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
						>
							{t('home.view-all')}
						</button>
					</div>

					{recentDocs.length === 0 ? (
						<p className="px-4 py-6 text-sm text-muted-foreground">{t('home.empty.docs')}</p>
					) : (
						<ul className="divide-y divide-border/70">
							{recentDocs.map((doc) => (
								<li key={doc.id}>
									<button
										type="button"
										onClick={() => navigateToDoc(doc.slug)}
										className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-accent/50"
									>
										<span className="flex size-4 shrink-0 items-center justify-center text-sm" aria-hidden>
											{doc.icon ?? <FileText className="size-3.5 text-muted-foreground" />}
										</span>
										<span className="min-w-0 flex-1 truncate text-sm text-foreground">{doc.title}</span>
										<span className="shrink-0 text-xs text-muted-foreground tnum">
											{formatRelativeShort(doc.updatedAt, nowMs)}
										</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</section>
			</div>
		</div>
	)
}
