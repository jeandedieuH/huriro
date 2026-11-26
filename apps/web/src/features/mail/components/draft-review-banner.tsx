import type { CompleteDraftReviewBody, MailDraftDto, RequestDraftReviewBody } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { CheckCircle2, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { WorkspaceMemberSummary } from '@/lib/api-bridge'

export interface DraftReviewBannerProps {
	readonly draft: MailDraftDto | null
	readonly members: readonly WorkspaceMemberSummary[]
	readonly currentUserId: string
	readonly onRequestReview: (draftId: string, body: RequestDraftReviewBody) => Promise<void>
	readonly onCompleteReview: (draftId: string, body: CompleteDraftReviewBody) => Promise<void>
}

/**
 * Teammate review gate banner for a mail draft. Allows requesting a reviewer and
 * approving or requesting changes before the draft can be sent.
 */
export function DraftReviewBanner({
	draft,
	members,
	currentUserId,
	onRequestReview,
	onCompleteReview
}: DraftReviewBannerProps) {
	const candidateMembers = members.filter((m) => m.userId !== currentUserId)
	const defaultReviewer = candidateMembers[0]?.userId ?? members[0]?.userId ?? currentUserId
	const [reviewerId, setReviewerId] = useState(defaultReviewer)
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		if (!reviewerId && defaultReviewer) setReviewerId(defaultReviewer)
	}, [defaultReviewer, reviewerId])

	if (!draft || draft.status !== 'draft') return null

	const handleRequest = async () => {
		if (!reviewerId || busy) return
		setBusy(true)
		try {
			await onRequestReview(draft.id, { reviewerId })
		} finally {
			setBusy(false)
		}
	}

	const handleDecision = async (decision: 'approved' | 'changes_requested') => {
		if (busy) return
		setBusy(true)
		try {
			await onCompleteReview(draft.id, { decision })
		} finally {
			setBusy(false)
		}
	}

	return (
		<div
			className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs"
			data-testid="draft-review-banner"
		>
			<div className="flex items-center gap-2">
				{draft.reviewStatus === 'requested' ? (
					<>
						<ShieldAlert className="size-3.5 text-(--warning)" aria-hidden />
						<Badge tone="warning">{t('mail.review.pending')}</Badge>
						<span className="text-muted-foreground">{t('mail.review.blocked-send')}</span>
					</>
				) : draft.reviewStatus === 'approved' ? (
					<>
						<CheckCircle2 className="size-3.5 text-(--success)" aria-hidden />
						<Badge tone="success">{t('mail.review.approved')}</Badge>
					</>
				) : draft.reviewStatus === 'changes_requested' ? (
					<>
						<ShieldAlert className="size-3.5 text-destructive" aria-hidden />
						<Badge tone="danger">{t('mail.review.changes-requested')}</Badge>
					</>
				) : null}
			</div>

			<div className="flex flex-wrap items-center gap-1.5">
				{draft.reviewStatus === 'requested' ? (
					<>
						<Button
							size="sm"
							tone="outline"
							type="button"
							disabled={busy}
							onClick={() => void handleDecision('changes_requested')}
						>
							{t('mail.review.request-changes')}
						</Button>
						<Button size="sm" type="button" disabled={busy} onClick={() => void handleDecision('approved')}>
							{t('mail.review.approve')}
						</Button>
					</>
				) : (
					<>
						{members.length > 0 ? (
							<select
								aria-label={t('mail.review.select-reviewer')}
								value={reviewerId}
								onChange={(e) => setReviewerId(e.target.value)}
								className="h-8 rounded-md border border-border bg-background px-2 text-xs"
							>
								{(candidateMembers.length > 0 ? candidateMembers : members).map((m) => (
									<option key={m.userId} value={m.userId}>
										{m.displayName}
									</option>
								))}
							</select>
						) : null}
						<Button
							size="sm"
							tone="outline"
							type="button"
							disabled={busy || !reviewerId}
							onClick={() => void handleRequest()}
						>
							{t('mail.review.request')}
						</Button>
					</>
				)}
			</div>
		</div>
	)
}
