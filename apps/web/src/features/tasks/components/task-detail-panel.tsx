import type {
	IssueCommentDto,
	IssueDto,
	IssueGithubLinkDto,
	IssueRelationDto,
	LabelDto,
	ProjectStatusDto,
	RelationKind
} from '@huriro/contracts'
import { t } from '@huriro/i18n'
import {
	AlertTriangle,
	ExternalLink,
	GitBranch,
	Link2,
	MessageSquare,
	Plus,
	RefreshCw,
	Trash2,
	X
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import type { TaskApiBridge, WorkspaceMemberSummary } from '@/lib/sync-bootstrap'
import { useUiStore } from '@/stores/ui-store'
import { EntityLinksSection } from './entity-links'

export interface IssueDetailPanelProps {
	readonly issue: IssueDto
	readonly allIssues: readonly IssueDto[]
	readonly statuses: readonly ProjectStatusDto[]
	readonly labels: readonly LabelDto[]
	readonly members: readonly WorkspaceMemberSummary[]
	readonly api: TaskApiBridge
	readonly onUpdateIssue: (
		issueId: string,
		patch: {
			title?: string
			descriptionText?: string
			statusId?: string
			priority?: number
			assigneeId?: string | null
			assigneeType?: 'user' | 'agent' | null
			labelIds?: string[]
		}
	) => Promise<void>
	readonly onCreateSubIssue: (parentId: string, title: string) => Promise<void>
	readonly onDeleteIssue: (issueId: string) => Promise<void>
}

export function IssueDetailPanel({
	issue,
	allIssues,
	statuses,
	labels,
	members,
	api,
	onUpdateIssue,
	onCreateSubIssue,
	onDeleteIssue
}: IssueDetailPanelProps) {
	const setDetailPanelOpen = useUiStore((s) => s.setDetailPanelOpen)
	const selectIssue = useUiStore((s) => s.selectIssue)

	const [titleDraft, setTitleDraft] = useState(issue.title)
	const [descDraft, setDescDraft] = useState(issue.descriptionText)
	const [subTitle, setSubTitle] = useState('')
	const [commentBody, setCommentBody] = useState('')
	const [comments, setComments] = useState<IssueCommentDto[]>([])
	const [relations, setRelations] = useState<IssueRelationDto[]>([])
	const [githubLinks, setGithubLinks] = useState<IssueGithubLinkDto[]>([])
	const [retryingLinkId, setRetryingLinkId] = useState<string | null>(null)
	const [relTargetId, setRelTargetId] = useState('')
	const [relKind, setRelKind] = useState<RelationKind>('relates_to')

	useEffect(() => {
		setTitleDraft(issue.title)
		setDescDraft(issue.descriptionText)
	}, [issue.title, issue.descriptionText])

	useEffect(() => {
		let cancelled = false
		void Promise.all([
			api.listComments(issue.id),
			api.listRelations(issue.id),
			api.listIssueGithubLinks(issue.id).catch(() => [] as IssueGithubLinkDto[])
		])
			.then(([c, r, g]) => {
				if (cancelled) return
				setComments(c)
				setRelations(r)
				setGithubLinks(g)
			})
			.catch(() => {
				// Keep empty in offline/degraded mode
			})
		return () => {
			cancelled = true
		}
	}, [api, issue.id])

	async function handleRetryGithubPush(linkId: string) {
		setRetryingLinkId(linkId)
		try {
			const updated = await api.retryIssueGithubPush(linkId)
			setGithubLinks((prev) => prev.map((l) => (l.id === linkId ? updated : l)))
		} finally {
			setRetryingLinkId(null)
		}
	}

	const projectStatuses = statuses.filter((s) => s.projectId === issue.projectId)
	const subIssues = allIssues.filter((i) => i.parentId === issue.id)
	const relateCandidates = allIssues.filter((i) => i.id !== issue.id)

	return (
		<aside
			aria-label={t('tasks.detail.title')}
			className="flex h-full w-96 shrink-0 flex-col border-l border-border bg-card text-card-foreground"
		>
			<header className="flex items-center justify-between border-b border-border px-4 py-2.5">
				<span className="font-mono text-xs font-semibold text-muted-foreground tnum">{issue.identifier}</span>
				<div className="flex items-center gap-1">
					<Button
						size="icon"
						tone="ghost"
						aria-label={t('tasks.detail.delete')}
						onClick={() => void onDeleteIssue(issue.id)}
					>
						<Trash2 className="size-4 text-destructive" aria-hidden />
					</Button>
					<Button
						size="icon"
						tone="ghost"
						aria-label={t('common.close')}
						onClick={() => setDetailPanelOpen(false)}
					>
						<X className="size-4" aria-hidden />
					</Button>
				</div>
			</header>

			<div className="flex-1 space-y-5 overflow-y-auto p-4">
				{/* Title */}
				<div>
					<label htmlFor="detail-issue-title" className="sr-only">
						{t('tasks.create.title-label')}
					</label>
					<Input
						id="detail-issue-title"
						value={titleDraft}
						onChange={(ev) => setTitleDraft(ev.target.value)}
						onBlur={() => {
							const trimmed = titleDraft.trim()
							if (trimmed && trimmed !== issue.title) {
								void onUpdateIssue(issue.id, { title: trimmed })
							}
						}}
						className="border-transparent px-1 text-base font-semibold hover:border-input focus-visible:border-input"
					/>
				</div>

				{/* Core properties */}
				<div className="grid grid-cols-2 gap-3 text-xs">
					<div className="space-y-1">
						<span className="font-medium text-muted-foreground">{t('tasks.detail.status')}</span>
						<Select
							value={issue.statusId}
							onValueChange={(value) => void onUpdateIssue(issue.id, { statusId: value })}
						>
							<SelectTrigger aria-label={t('tasks.detail.status')} className="h-8 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{projectStatuses.map((s) => (
									<SelectItem key={s.id} value={s.id}>
										{s.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-1">
						<span className="font-medium text-muted-foreground">{t('tasks.detail.priority')}</span>
						<Select
							value={String(issue.priority)}
							onValueChange={(value) => void onUpdateIssue(issue.id, { priority: Number(value) })}
						>
							<SelectTrigger aria-label={t('tasks.detail.priority')} className="h-8 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="0">{t('tasks.priority.0')}</SelectItem>
								<SelectItem value="1">{t('tasks.priority.1')}</SelectItem>
								<SelectItem value="2">{t('tasks.priority.2')}</SelectItem>
								<SelectItem value="3">{t('tasks.priority.3')}</SelectItem>
								<SelectItem value="4">{t('tasks.priority.4')}</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="col-span-2 space-y-1">
						<span className="font-medium text-muted-foreground">{t('tasks.detail.assignee')}</span>
						<Select
							value={issue.assigneeId ?? 'unassigned'}
							onValueChange={(value) =>
								void onUpdateIssue(
									issue.id,
									value === 'unassigned'
										? { assigneeId: null, assigneeType: null }
										: { assigneeId: value, assigneeType: 'user' }
								)
							}
						>
							<SelectTrigger aria-label={t('tasks.detail.assignee')} className="h-8 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="unassigned">{t('tasks.detail.unassigned')}</SelectItem>
								{members.map((m) => (
									<SelectItem key={m.userId} value={m.userId}>
										{m.displayName}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>

				{/* Labels */}
				{labels.length > 0 ? (
					<div className="space-y-1.5">
						<p className="text-xs font-medium text-muted-foreground">{t('tasks.detail.labels')}</p>
						<div className="flex flex-wrap gap-1.5">
							{labels.map((label) => {
								const active = issue.labelIds.includes(label.id)
								return (
									<button
										key={label.id}
										type="button"
										onClick={() => {
											const next = active
												? issue.labelIds.filter((id) => id !== label.id)
												: [...issue.labelIds, label.id]
											void onUpdateIssue(issue.id, { labelIds: next })
										}}
									>
										<Badge tone={active ? 'info' : 'outline'}>{label.name}</Badge>
									</button>
								)
							})}
						</div>
					</div>
				) : null}

				{/* Description */}
				<div className="space-y-1.5">
					<label htmlFor="detail-issue-desc" className="text-xs font-medium text-muted-foreground">
						{t('tasks.detail.description')}
					</label>
					<Textarea
						id="detail-issue-desc"
						value={descDraft}
						onChange={(ev) => setDescDraft(ev.target.value)}
						onBlur={() => {
							if (descDraft !== issue.descriptionText) {
								void onUpdateIssue(issue.id, { descriptionText: descDraft })
							}
						}}
						rows={4}
					/>
				</div>

				<Separator />

				{/* Subtasks */}
				<div className="space-y-2">
					<h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						{t('tasks.detail.sub-issues')} ({subIssues.length})
					</h3>
					{subIssues.map((sub) => (
						<button
							key={sub.id}
							type="button"
							onClick={() => selectIssue(sub.id, true)}
							className="flex w-full items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-left text-xs hover:bg-accent"
						>
							<span className="font-mono text-muted-foreground tnum">{sub.identifier}</span>
							<span className="truncate font-medium">{sub.title}</span>
						</button>
					))}
					<form
						onSubmit={(ev) => {
							ev.preventDefault()
							const trimmed = subTitle.trim()
							if (!trimmed) return
							void onCreateSubIssue(issue.id, trimmed).then(() => setSubTitle(''))
						}}
						className="flex gap-1.5"
					>
						<Input
							value={subTitle}
							onChange={(ev) => setSubTitle(ev.target.value)}
							placeholder={t('tasks.detail.sub-issue-placeholder')}
							className="h-8 text-xs"
						/>
						<Button
							size="icon"
							tone="outline"
							type="submit"
							className="size-8"
							aria-label={t('tasks.detail.add-sub-issue')}
						>
							<Plus className="size-3.5" aria-hidden />
						</Button>
					</form>
				</div>

				<Separator />

				{/* Relations */}
				<div className="space-y-2">
					<h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						<Link2 className="size-3.5" aria-hidden />
						<span>{t('tasks.detail.relations')}</span>
					</h3>
					{relations.map((rel) => {
						const otherId = rel.sourceIssueId === issue.id ? rel.targetIssueId : rel.sourceIssueId
						const other = allIssues.find((i) => i.id === otherId)
						return (
							<div
								key={rel.id}
								className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5 text-xs"
							>
								<span className="text-muted-foreground">{rel.kind}</span>
								<button
									type="button"
									onClick={() => other && selectIssue(other.id, true)}
									className="font-mono font-medium hover:underline tnum"
								>
									{other?.identifier ?? otherId.slice(0, 8)}
								</button>
							</div>
						)
					})}
					{relateCandidates.length > 0 ? (
						<form
							onSubmit={(ev) => {
								ev.preventDefault()
								if (!relTargetId) return
								void api.createRelation(issue.id, relTargetId, relKind).then((created) => {
									setRelations((prev) => [...prev, created])
									setRelTargetId('')
								})
							}}
							className="flex gap-1.5"
						>
							<Select value={relKind} onValueChange={(v) => setRelKind(v as RelationKind)}>
								<SelectTrigger aria-label={t('tasks.detail.relations')} className="h-8 w-28 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="blocks">{t('tasks.detail.relation-blocks')}</SelectItem>
									<SelectItem value="relates_to">{t('tasks.detail.relation-relates-to')}</SelectItem>
									<SelectItem value="duplicates">{t('tasks.detail.relation-duplicate-of')}</SelectItem>
								</SelectContent>
							</Select>
							<Select value={relTargetId} onValueChange={setRelTargetId}>
								<SelectTrigger aria-label={t('tasks.detail.add-relation')} className="h-8 flex-1 text-xs">
									<SelectValue placeholder={t('tasks.detail.add-relation')} />
								</SelectTrigger>
								<SelectContent>
									{relateCandidates.map((cand) => (
										<SelectItem key={cand.id} value={cand.id}>
											{cand.identifier} · {cand.title}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Button
								size="icon"
								tone="outline"
								type="submit"
								className="size-8"
								disabled={!relTargetId}
								aria-label={t('tasks.detail.add-relation')}
							>
								<Plus className="size-3.5" aria-hidden />
							</Button>
						</form>
					) : null}
				</div>

				<Separator />

				{/* GitHub Two-Way Sync Links */}
				{githubLinks.length > 0 ? (
					<>
						<div className="space-y-2">
							<h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								<GitBranch className="size-3.5" aria-hidden />
								<span>{t('tasks.github.title')}</span>
							</h3>
							{githubLinks.map((link) => (
								<div
									key={link.id}
									className="space-y-1.5 rounded-md border border-border bg-muted/30 p-2.5 text-xs"
								>
									<div className="flex items-center justify-between gap-2">
										<a
											href={link.githubUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="inline-flex items-center gap-1 font-mono font-medium hover:underline"
										>
											<span>
												{link.repoFullName}#{link.githubIssueNumber}
											</span>
											<ExternalLink className="size-3" aria-hidden />
										</a>
										<Badge tone={link.syncState === 'push_failed' ? 'danger' : 'secondary'}>
											{link.syncState === 'push_failed'
												? t('tasks.github.push-failed')
												: t('tasks.github.synced')}
										</Badge>
									</div>
									{link.syncState === 'push_failed' ? (
										<div
											role="alert"
											className="flex items-center justify-between gap-2 rounded bg-destructive/10 px-2 py-1.5 text-destructive"
										>
											<span className="flex min-w-0 items-center gap-1">
												<AlertTriangle className="size-3.5 shrink-0" aria-hidden />
												<span className="truncate">
													{link.lastSyncError ?? t('tasks.github.push-failed')}
												</span>
											</span>
											<Button
												size="sm"
												tone="outline"
												type="button"
												loading={retryingLinkId === link.id}
												onClick={() => void handleRetryGithubPush(link.id)}
											>
												<RefreshCw className="size-3" aria-hidden />
												<span>{t('tasks.github.retry')}</span>
											</Button>
										</div>
									) : null}
								</div>
							))}
						</div>
						<Separator />
					</>
				) : null}

				<EntityLinksSection issueId={issue.id} />

				<Separator />

				{/* Comments */}
				<div className="space-y-2">
					<h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						<MessageSquare className="size-3.5" aria-hidden />
						<span>
							{t('tasks.detail.comments')} ({comments.length})
						</span>
					</h3>
					{comments.length === 0 ? (
						<p className="text-xs text-muted-foreground">{t('tasks.detail.no-comments')}</p>
					) : (
						comments.map((c) => (
							<div key={c.id} className="rounded-md border border-border bg-muted/40 p-2.5 text-xs">
								<p className="text-foreground">{c.bodyText}</p>
							</div>
						))
					)}
					<form
						onSubmit={(ev) => {
							ev.preventDefault()
							const trimmed = commentBody.trim()
							if (!trimmed) return
							void api.createComment(issue.id, trimmed).then((created) => {
								setComments((prev) => [...prev, created])
								setCommentBody('')
							})
						}}
						className="space-y-2"
					>
						<Textarea
							value={commentBody}
							onChange={(ev) => setCommentBody(ev.target.value)}
							placeholder={t('tasks.detail.comment-placeholder')}
							rows={2}
						/>
						<div className="flex justify-end">
							<Button size="sm" type="submit" disabled={!commentBody.trim()}>
								{t('tasks.detail.add-comment')}
							</Button>
						</div>
					</form>
				</div>
			</div>
		</aside>
	)
}
