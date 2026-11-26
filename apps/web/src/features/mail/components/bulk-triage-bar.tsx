import type { MailBulkTriageBody, MailTagDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { CheckCheck, UserCheck, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { WorkspaceMemberSummary } from '@/lib/api-bridge'

export interface BulkTriageBarProps {
	readonly selectedCount: number
	readonly tags: readonly MailTagDto[]
	readonly members: readonly WorkspaceMemberSummary[]
	readonly currentUserId: string
	readonly onBulkTriage: (body: Omit<MailBulkTriageBody, 'conversationIds'>) => Promise<void>
	readonly onClear: () => void
}

/**
 * Floating/sticky toolbar rendered when one or more conversations are checked in
 * the conversation list for atomic status, assignee, or tag triage.
 */
export function BulkTriageBar({
	selectedCount,
	tags,
	members,
	currentUserId,
	onBulkTriage,
	onClear
}: BulkTriageBarProps) {
	const [busy, setBusy] = useState(false)
	const [selectedTagId, setSelectedTagId] = useState('')
	const [selectedMemberId, setSelectedMemberId] = useState('')

	if (selectedCount === 0) return null

	const runBulk = async (body: Omit<MailBulkTriageBody, 'conversationIds'>) => {
		if (busy) return
		setBusy(true)
		try {
			await onBulkTriage(body)
		} finally {
			setBusy(false)
		}
	}

	return (
		<div
			className="flex flex-wrap items-center gap-1.5 border-b border-border bg-accent/40 px-3 py-2 text-xs"
			data-testid="bulk-triage-bar"
		>
			<span className="font-medium text-foreground">{t('mail.bulk.selected', { count: selectedCount })}</span>
			<Button
				size="sm"
				tone="outline"
				type="button"
				disabled={busy}
				onClick={() => void runBulk({ status: 'closed' })}
			>
				<CheckCheck className="size-3.5" aria-hidden />
				<span>{t('mail.action.close')}</span>
			</Button>
			<Button
				size="sm"
				tone="outline"
				type="button"
				disabled={busy}
				onClick={() => void runBulk({ status: 'pending' })}
			>
				<span>{t('mail.conv.status.pending')}</span>
			</Button>
			<Button
				size="sm"
				tone="outline"
				type="button"
				disabled={busy}
				onClick={() => void runBulk({ assigneeId: currentUserId })}
			>
				<UserCheck className="size-3.5" aria-hidden />
				<span>{t('mail.action.assign-to-me')}</span>
			</Button>
			{members.length > 0 ? (
				<select
					aria-label={t('mail.bulk.assign')}
					value={selectedMemberId}
					disabled={busy}
					onChange={(e) => {
						const val = e.target.value
						setSelectedMemberId('')
						if (val) void runBulk({ assigneeId: val })
					}}
					className="h-8 rounded-md border border-border bg-background px-2 text-xs"
				>
					<option value="">{t('mail.bulk.assign')}</option>
					{members.map((m) => (
						<option key={m.userId} value={m.userId}>
							{m.displayName}
						</option>
					))}
				</select>
			) : null}
			{tags.length > 0 ? (
				<select
					aria-label={t('mail.bulk.tag')}
					value={selectedTagId}
					disabled={busy}
					onChange={(e) => {
						const val = e.target.value
						setSelectedTagId('')
						if (val) void runBulk({ addTagIds: [val] })
					}}
					className="h-8 rounded-md border border-border bg-background px-2 text-xs"
				>
					<option value="">{t('mail.bulk.tag')}</option>
					{tags.map((tag) => (
						<option key={tag.id} value={tag.id}>
							{tag.name}
						</option>
					))}
				</select>
			) : null}
			<Button size="sm" tone="ghost" type="button" onClick={onClear} className="ml-auto">
				<X className="size-3.5" aria-hidden />
				<span>{t('mail.bulk.clear')}</span>
			</Button>
		</div>
	)
}
