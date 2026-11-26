import type { ChatPollDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { BarChart3, Check, Lock } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface PollCardProps {
	readonly poll: ChatPollDto
	readonly currentUserId: string
	readonly onVote: (pollId: string, optionIds: readonly string[]) => Promise<void> | void
	readonly onClosePoll: (pollId: string) => Promise<void> | void
}

/** Interactive channel poll card displaying live vote bars and close control. */
export function PollCard({ poll, currentUserId, onVote, onClosePoll }: PollCardProps) {
	const [busy, setBusy] = useState(false)

	const isClosed = poll.status === 'closed'
	const counts = poll.counts ?? {}
	const totalVotes = poll.totalVotes ?? Object.values(counts).reduce((sum, n) => sum + n, 0)
	const myVotes = new Set(poll.voters?.find((v) => v.userId === currentUserId)?.optionIds ?? [])
	const isCreator = poll.createdBy === currentUserId

	async function handleOptionClick(optionId: string) {
		if (isClosed || busy) return
		let nextOptionIds: string[]
		if (poll.multiChoice) {
			const next = new Set(myVotes)
			if (next.has(optionId)) {
				next.delete(optionId)
			} else {
				next.add(optionId)
			}
			// Schema requires at least one selected option; ignore deselecting the final active pick.
			if (next.size === 0) return
			nextOptionIds = [...next]
		} else {
			nextOptionIds = [optionId]
		}

		setBusy(true)
		try {
			await onVote(poll.id, nextOptionIds)
		} finally {
			setBusy(false)
		}
	}

	async function handleClose() {
		if (isClosed || busy) return
		setBusy(true)
		try {
			await onClosePoll(poll.id)
		} finally {
			setBusy(false)
		}
	}

	return (
		<section
			aria-label={poll.question}
			className="mt-2 max-w-md space-y-2.5 rounded-lg border border-border bg-card p-3 text-card-foreground"
		>
			<div className="flex items-start justify-between gap-2">
				<div className="flex items-center gap-1.5">
					<BarChart3 className="size-4 shrink-0 text-primary" aria-hidden />
					<p className="text-sm font-semibold text-foreground">{poll.question}</p>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					{poll.anonymous ? <Badge tone="secondary">{t('chat.poll.anonymous')}</Badge> : null}
					{poll.multiChoice ? <Badge tone="secondary">{t('chat.poll.multi')}</Badge> : null}
					{isClosed ? (
						<Badge tone="outline">
							<Lock className="size-3" aria-hidden />
							<span>{t('chat.poll.closed')}</span>
						</Badge>
					) : null}
				</div>
			</div>

			<div className="space-y-1.5">
				{poll.options.map((opt) => {
					const voteCount = counts[opt.id] ?? 0
					const pct = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0
					const votedByMe = myVotes.has(opt.id)

					return (
						<button
							key={opt.id}
							type="button"
							disabled={isClosed || busy}
							aria-pressed={votedByMe}
							onClick={() => void handleOptionClick(opt.id)}
							className={cn(
								'relative flex w-full items-center justify-between overflow-hidden rounded-md border px-3 py-2 text-left text-xs transition-colors',
								votedByMe
									? 'border-primary/60 bg-primary/5 font-medium text-foreground'
									: 'border-border bg-background hover:bg-accent/40',
								isClosed && 'cursor-default opacity-85'
							)}
						>
							<span
								aria-hidden
								style={{ width: `${pct}%` }}
								className="pointer-events-none absolute inset-y-0 left-0 bg-primary/15 transition-all"
							/>
							<span className="relative z-10 flex min-w-0 items-center gap-1.5">
								{votedByMe ? <Check className="size-3.5 shrink-0 text-primary" aria-hidden /> : null}
								<span className="truncate">{opt.label}</span>
							</span>
							<span className="relative z-10 ml-2 shrink-0 text-[11px] text-muted-foreground tnum">
								{t('chat.poll.votes', { count: voteCount })} ({pct}%)
							</span>
						</button>
					)
				})}
			</div>

			<div className="flex items-center justify-between pt-0.5 text-[11px] text-muted-foreground">
				<span className="tnum">{t('chat.poll.votes', { count: totalVotes })}</span>
				{!isClosed && isCreator ? (
					<Button size="sm" tone="outline" type="button" loading={busy} onClick={() => void handleClose()}>
						{t('chat.poll.close')}
					</Button>
				) : null}
			</div>
		</section>
	)
}
