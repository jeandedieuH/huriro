import type { IssueDto } from '@huriro/contracts'
import { type MessageId, t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import { Check, Clock, GitMerge, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@/components/ui/dialog'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'

/**
 * Triage inbox (§3.1): pending/snoozed inbound requests for triage-enabled
 * projects, oldest first. Queue data comes from `GET /projects/:id/triage`
 * (server-computed ordering + snooze visibility) rather than the replica —
 * triage state is deliberately *not* part of the synced working set.
 *
 * Keyboard: j/k move, A accept, H snooze(1d), D decline, M merge — scoped to
 * this view and guarded against editable targets.
 */
export function TriageInbox({ projectId }: { readonly projectId: string }) {
	const { api } = useWorkspace()
	const engine = useSyncEngine()
	const issues = useCollectionItems(engine.collections.issues)
	const pushToast = useUiStore((s) => s.pushToast)
	const selectIssue = useUiStore((s) => s.selectIssue)
	const [queue, setQueue] = useState<readonly IssueDto[]>([])
	const [snoozed, setSnoozed] = useState<readonly IssueDto[]>([])
	const [loading, setLoading] = useState(true)
	const [focusIdx, setFocusIdx] = useState(0)
	const [declineTarget, setDeclineTarget] = useState<IssueDto | null>(null)
	const [mergeTarget, setMergeTarget] = useState<IssueDto | null>(null)
	const listRef = useRef<HTMLDivElement>(null)

	const refresh = useCallback(async () => {
		try {
			const [pending, snz] = await Promise.all([
				api.listTriageQueue(projectId, 'pending'),
				api.listTriageQueue(projectId, 'snoozed')
			])
			setQueue(pending)
			setSnoozed(snz)
		} catch {
			// Offline / preview — the queue degrades to empty rather than erroring.
		} finally {
			setLoading(false)
		}
	}, [api, projectId])

	// Refresh whenever replica triage rows change (e.g. a new task sent to
	// triage from the dialog or updated elsewhere) so the inbox stays live.
	const replicaTriageKey = useMemo(
		() =>
			issues
				.filter(
					(i) =>
						i.projectId === projectId &&
						i.deletedAt === null &&
						(i.triageStatus === 'pending' || i.triageStatus === 'snoozed')
				)
				.map((i) => `${i.id}:${i.version}:${i.triageStatus}:${i.triageSnoozedUntil ?? ''}`)
				.sort()
				.join('|'),
		[issues, projectId]
	)

	const prevProjectIdRef = useRef<string | null>(null)

	useEffect(() => {
		if (prevProjectIdRef.current !== projectId) {
			prevProjectIdRef.current = projectId
			setLoading(true)
		}
		void replicaTriageKey
		void refresh()
	}, [projectId, refresh, replicaTriageKey])

	const act = useCallback(
		async (
			issue: IssueDto,
			body: Parameters<typeof api.triageIssue>[1],
			toastId: MessageId,
			toastTarget?: string
		) => {
			try {
				await api.triageIssue(issue.id, body)
				pushToast({
					title: t(toastId, {
						identifier: issue.identifier,
						...(toastTarget ? { target: toastTarget } : {})
					})
				})
				void refresh()
				void engine.syncNow()
			} catch {
				pushToast({ title: t('tasks.triage.failed'), tone: 'danger' })
			}
		},
		[api, engine, pushToast, refresh]
	)

	const accept = useCallback(
		(issue: IssueDto) =>
			void act(issue, { action: 'accept', version: issue.version }, 'tasks.triage.accepted'),
		[act]
	)
	const snooze = useCallback(
		(issue: IssueDto, hours: number) =>
			void act(
				issue,
				{
					action: 'snooze',
					until: new Date(Date.now() + hours * 3_600_000).toISOString(),
					version: issue.version
				},
				'tasks.triage.snoozed'
			),
		[act]
	)

	// View-scoped keyboard map — mounted only while the triage preset is active.
	useEffect(() => {
		const handler = (ev: KeyboardEvent) => {
			const target = ev.target as HTMLElement | null
			if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable))
				return
			if (!useUiStore.getState().shortcutsEnabled) return
			if (ev.metaKey || ev.ctrlKey || ev.altKey) return
			const current = queue[focusIdx]
			switch (ev.key) {
				case 'j':
					setFocusIdx((i) => Math.min(i + 1, queue.length - 1))
					ev.preventDefault()
					break
				case 'k':
					setFocusIdx((i) => Math.max(i - 1, 0))
					ev.preventDefault()
					break
				case 'a':
					if (current) accept(current)
					break
				case 'h':
					if (current) snooze(current, 24)
					break
				case 'd':
					if (current) setDeclineTarget(current)
					break
				case 'm':
					if (current) setMergeTarget(current)
					break
				case 'Enter':
					if (current) selectIssue(current.id, true)
					break
			}
		}
		window.addEventListener('keydown', handler)
		return () => window.removeEventListener('keydown', handler)
	}, [accept, focusIdx, queue, selectIssue, snooze])

	const sortedQueue = useMemo(() => queue, [queue])

	if (!loading && sortedQueue.length === 0 && snoozed.length === 0) {
		return (
			<EmptyState className="m-6" title={t('tasks.triage.empty.title')} hint={t('tasks.triage.empty.hint')} />
		)
	}

	return (
		<div ref={listRef} className="mx-auto max-w-3xl space-y-6 p-4">
			<section aria-label={t('tasks.triage.pending-section')} className="space-y-2">
				<h2 className="text-sm font-semibold">
					{t('tasks.triage.pending-section')} ({sortedQueue.length})
				</h2>
				<ul className="divide-y divide-border rounded-lg border border-border">
					{sortedQueue.map((issue, idx) => (
						<TriageRow
							key={issue.id}
							issue={issue}
							focused={idx === focusIdx}
							onFocus={() => setFocusIdx(idx)}
							onAccept={() => accept(issue)}
							onSnooze={(hours) => snooze(issue, hours)}
							onDecline={() => setDeclineTarget(issue)}
							onMerge={() => setMergeTarget(issue)}
							onOpen={() => selectIssue(issue.id, true)}
						/>
					))}
				</ul>
			</section>

			{snoozed.length > 0 ? (
				<section aria-label={t('tasks.triage.snoozed-section')} className="space-y-2">
					<h2 className="text-sm font-semibold text-muted-foreground">
						{t('tasks.triage.snoozed-section')} ({snoozed.length})
					</h2>
					<ul className="divide-y divide-border rounded-lg border border-border opacity-75">
						{snoozed.map((issue) => (
							<li key={issue.id} className="flex items-center gap-3 px-4 py-2">
								<Clock className="size-3.5 text-muted-foreground" aria-hidden />
								<button
									type="button"
									className="min-w-0 flex-1 truncate text-left text-sm"
									onClick={() => selectIssue(issue.id, true)}
								>
									{issue.identifier} — {issue.title}
								</button>
								<span className="text-xs text-muted-foreground">
									{issue.triageSnoozedUntil
										? t('tasks.triage.snooze.until', {
												date: new Date(issue.triageSnoozedUntil).toLocaleDateString()
											})
										: ''}
								</span>
							</li>
						))}
					</ul>
				</section>
			) : null}

			<DeclineDialog
				issue={declineTarget}
				onClose={() => setDeclineTarget(null)}
				onConfirm={(reason) => {
					if (declineTarget) {
						void act(
							declineTarget,
							{ action: 'decline', reason, version: declineTarget.version },
							'tasks.triage.declined'
						)
					}
					setDeclineTarget(null)
				}}
			/>
			<MergeDialog
				issue={mergeTarget}
				onClose={() => setMergeTarget(null)}
				onConfirm={(targetId, targetIdentifier) => {
					if (mergeTarget) {
						void act(
							mergeTarget,
							{ action: 'merge', duplicateOfIssueId: targetId, version: mergeTarget.version },
							'tasks.triage.merged',
							targetIdentifier
						)
					}
					setMergeTarget(null)
				}}
			/>
		</div>
	)
}

function TriageRow({
	issue,
	focused,
	onFocus,
	onAccept,
	onSnooze,
	onDecline,
	onMerge,
	onOpen
}: {
	readonly issue: IssueDto
	readonly focused: boolean
	readonly onFocus: () => void
	readonly onAccept: () => void
	readonly onSnooze: (hours: number) => void
	readonly onDecline: () => void
	readonly onMerge: () => void
	readonly onOpen: () => void
}) {
	return (
		<li
			data-issue-id={issue.id}
			className={cn(
				'flex items-center gap-2 px-4 py-2.5',
				focused ? 'bg-accent/40 ring-1 ring-inset ring-ring' : 'hover:bg-accent/20'
			)}
			onMouseEnter={onFocus}
		>
			<button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
				<span className="w-20 shrink-0 font-mono text-xs text-muted-foreground tnum">{issue.identifier}</span>
				<span className="min-w-0 flex-1 truncate text-sm font-medium">{issue.title}</span>
				<span className="rounded bg-accent px-1.5 py-0.5 text-xs text-muted-foreground">
					{t(`tasks.source.${issue.sourceKind ?? 'manual'}` as never)}
				</span>
			</button>
			<Button
				size="sm"
				tone="ghost"
				onClick={onAccept}
				aria-label={`${t('tasks.triage.accept')} ${issue.identifier}`}
			>
				<Check className="size-3.5 text-success" aria-hidden /> {t('tasks.triage.accept')}
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button size="sm" tone="ghost" aria-label={`${t('tasks.triage.snooze')} ${issue.identifier}`}>
						<Clock className="size-3.5" aria-hidden /> {t('tasks.triage.snooze')}
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuItem onSelect={() => onSnooze(1)}>{t('tasks.triage.snooze.1h')}</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => onSnooze(24)}>{t('tasks.triage.snooze.1d')}</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => onSnooze(24 * 7)}>{t('tasks.triage.snooze.1w')}</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<Button
				size="sm"
				tone="ghost"
				onClick={onMerge}
				aria-label={`${t('tasks.triage.merge')} ${issue.identifier}`}
			>
				<GitMerge className="size-3.5" aria-hidden /> {t('tasks.triage.merge')}
			</Button>
			<Button
				size="sm"
				tone="ghost"
				onClick={onDecline}
				aria-label={`${t('tasks.triage.decline')} ${issue.identifier}`}
			>
				<X className="size-3.5 text-danger" aria-hidden /> {t('tasks.triage.decline')}
			</Button>
		</li>
	)
}

function DeclineDialog({
	issue,
	onClose,
	onConfirm
}: {
	readonly issue: IssueDto | null
	readonly onClose: () => void
	readonly onConfirm: (reason: string) => void
}) {
	const [reason, setReason] = useState('')
	useEffect(() => {
		if (issue) setReason('')
	}, [issue])
	return (
		<Dialog open={issue !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('tasks.triage.decline-title')}</DialogTitle>
					<DialogDescription>{issue ? `${issue.identifier} — ${issue.title}` : ''}</DialogDescription>
				</DialogHeader>
				<Input
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					placeholder={t('tasks.triage.decline-reason-placeholder')}
					aria-label={t('tasks.triage.decline-reason-placeholder')}
				/>
				<DialogFooter>
					<Button tone="outline" onClick={onClose}>
						{t('common.cancel')}
					</Button>
					<Button
						tone="destructive"
						disabled={reason.trim().length === 0}
						onClick={() => onConfirm(reason.trim())}
					>
						{t('tasks.triage.decline-confirm')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

function MergeDialog({
	issue,
	onClose,
	onConfirm
}: {
	readonly issue: IssueDto | null
	readonly onClose: () => void
	readonly onConfirm: (targetId: string, targetIdentifier: string) => void
}) {
	const { api } = useWorkspace()
	const [suggestions, setSuggestions] = useState<
		readonly { issueId: string; identifier: string; title: string; statusCategory: string; score: number }[]
	>([])
	useEffect(() => {
		if (!issue) return
		let cancelled = false
		void api
			.getTriageSuggestions(issue.id)
			.then((s) => {
				if (!cancelled) setSuggestions(s.duplicates)
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [api, issue])
	return (
		<Dialog open={issue !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('tasks.triage.merge-title')}</DialogTitle>
					<DialogDescription>{t('tasks.triage.merge-hint')}</DialogDescription>
				</DialogHeader>
				{suggestions.length === 0 ? (
					<p className="text-sm text-muted-foreground">{t('tasks.triage.no-suggestions')}</p>
				) : (
					<ul className="max-h-64 space-y-1 overflow-y-auto">
						{suggestions.map((s) => (
							<li key={s.issueId}>
								<button
									type="button"
									className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/50"
									onClick={() => onConfirm(s.issueId, s.identifier)}
								>
									<span className="w-20 shrink-0 font-mono text-xs text-muted-foreground tnum">
										{s.identifier}
									</span>
									<span className="min-w-0 flex-1 truncate">{s.title}</span>
									<span className="text-xs text-muted-foreground tnum">{Math.round(s.score * 100)}%</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</DialogContent>
		</Dialog>
	)
}
