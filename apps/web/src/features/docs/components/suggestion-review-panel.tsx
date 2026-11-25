import type { DocSuggestionDto, DocSuggestionKind, ProposeDocSuggestionBody } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Check, X } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export interface SuggestionReviewPanelProps {
	readonly suggestions: readonly DocSuggestionDto[]
	readonly canWrite: boolean
	readonly canComment: boolean
	readonly onDecide: (groupId: string, decision: 'accept' | 'reject') => Promise<void>
	readonly onDecideAll: (decision: 'accept' | 'reject') => Promise<void>
	readonly onPropose: (body: ProposeDocSuggestionBody) => Promise<void>
}

export function SuggestionReviewPanel({
	suggestions,
	canWrite,
	canComment,
	onDecide,
	onDecideAll,
	onPropose
}: SuggestionReviewPanelProps) {
	const [kind, setKind] = useState<DocSuggestionKind>('insert')
	const [targetText, setTargetText] = useState('')
	const [replacementText, setReplacementText] = useState('')
	const [busy, setBusy] = useState(false)

	const openSuggestions = suggestions.filter((s) => s.status === 'open')
	const resolvedSuggestions = suggestions.filter((s) => s.status !== 'open')

	async function handlePropose(ev: FormEvent) {
		ev.preventDefault()
		if (busy) return
		const cleanTarget = targetText.trim()
		const cleanReplacement = replacementText.trim()
		if (kind === 'insert' && !cleanReplacement) return
		if ((kind === 'delete' || kind === 'replace') && !cleanTarget) return
		setBusy(true)
		try {
			await onPropose({
				kind,
				...(cleanTarget ? { targetText: cleanTarget } : {}),
				...(cleanReplacement ? { replacementText: cleanReplacement } : {})
			})
			setTargetText('')
			setReplacementText('')
		} finally {
			setBusy(false)
		}
	}

	function statusLabel(status: DocSuggestionDto['status']) {
		if (status === 'accepted') return t('docs.suggestions.status.accepted')
		if (status === 'rejected') return t('docs.suggestions.status.rejected')
		return t('docs.suggestions.status.open')
	}

	return (
		<div className="space-y-4 p-3">
			{canWrite && openSuggestions.length > 0 ? (
				<div className="flex items-center justify-between gap-2 rounded-md border border-border bg-card p-2">
					<span className="text-xs font-medium">
						{t('docs.suggestions.open-count', { count: openSuggestions.length })}
					</span>
					<div className="flex items-center gap-1">
						<Button
							type="button"
							size="sm"
							tone="outline"
							className="h-6 px-2 text-xs"
							onClick={() => void onDecideAll('reject')}
						>
							{t('docs.suggestions.reject-all')}
						</Button>
						<Button
							type="button"
							size="sm"
							className="h-6 px-2 text-xs"
							onClick={() => void onDecideAll('accept')}
						>
							{t('docs.suggestions.accept-all')}
						</Button>
					</div>
				</div>
			) : null}

			{canComment ? (
				<form
					onSubmit={(ev) => void handlePropose(ev)}
					className="space-y-2 rounded-md border border-border p-2.5"
				>
					<div className="flex items-center justify-between gap-2">
						<span className="text-xs font-semibold">{t('docs.suggestions.propose-title')}</span>
						<Select value={kind} onValueChange={(v) => setKind(v as DocSuggestionKind)}>
							<SelectTrigger aria-label={t('docs.suggestions.propose-title')} className="h-7 w-24 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="insert">Insert</SelectItem>
								<SelectItem value="replace">Replace</SelectItem>
								<SelectItem value="delete">Delete</SelectItem>
							</SelectContent>
						</Select>
					</div>
					{kind !== 'insert' ? (
						<Input
							aria-label="Target text"
							value={targetText}
							onChange={(ev) => setTargetText(ev.target.value)}
							placeholder="Exact text to replace or remove…"
							className="h-7 text-xs"
						/>
					) : null}
					{kind !== 'delete' ? (
						<Textarea
							aria-label={t('docs.suggestions.propose-placeholder')}
							value={replacementText}
							onChange={(ev) => setReplacementText(ev.target.value)}
							placeholder={t('docs.suggestions.propose-placeholder')}
							rows={2}
							className="min-h-14 text-xs"
						/>
					) : null}
					<Button type="submit" size="sm" disabled={busy} className="h-7 w-full text-xs">
						{t('docs.suggestions.propose-submit')}
					</Button>
				</form>
			) : null}

			{suggestions.length === 0 ? (
				<p className="py-4 text-center text-xs text-muted-foreground">{t('docs.suggestions.empty')}</p>
			) : (
				<ul className="space-y-2">
					{[...openSuggestions, ...resolvedSuggestions].map((s) => (
						<li key={s.id} className="space-y-1.5 rounded-md border border-border bg-card p-2.5 text-xs">
							<div className="flex items-center justify-between gap-2">
								<Badge
									tone={s.status === 'accepted' ? 'success' : s.status === 'rejected' ? 'secondary' : 'info'}
								>
									{statusLabel(s.status)}
								</Badge>
								{canWrite && s.status === 'open' ? (
									<div className="flex items-center gap-1">
										<Button
											type="button"
											size="icon"
											tone="ghost"
											className="size-6"
											aria-label={t('docs.suggestions.accept')}
											onClick={() => void onDecide(s.groupId, 'accept')}
										>
											<Check className="size-3.5 text-(--success)" aria-hidden />
										</Button>
										<Button
											type="button"
											size="icon"
											tone="ghost"
											className="size-6"
											aria-label={t('docs.suggestions.reject')}
											onClick={() => void onDecide(s.groupId, 'reject')}
										>
											<X className="size-3.5 text-destructive" aria-hidden />
										</Button>
									</div>
								) : null}
							</div>
							{s.beforeText ? (
								<p className="rounded bg-destructive/10 px-1.5 py-1 text-destructive line-through">
									{s.beforeText}
								</p>
							) : null}
							{s.afterText ? (
								<p className="rounded bg-(--success)/10 px-1.5 py-1 text-(--success)">{s.afterText}</p>
							) : null}
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
