import type { AiMailAssistMode, AiMailAssistResponse, MailTagDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { FileText, ShieldAlert, Sparkles, Tag, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export interface MailAiCopilotPanelProps {
	readonly result: AiMailAssistResponse | null
	readonly loading: boolean
	readonly error: string | null
	readonly availableTags: readonly MailTagDto[]
	readonly onRunMode: (mode: AiMailAssistMode) => Promise<void>
	readonly onInsertDraft: (text: string) => void
	readonly onApplyTag: (tagId: string) => Promise<void>
	readonly onOpenCitation: (entityType: 'doc_page' | 'issue', entityId: string, slug?: string | null) => void
	readonly onClear: () => void
	readonly onClose: () => void
}

/**
 * Guarded Mail AI assistant panel: human-in-the-loop thread summarization,
 * draft-only reply suggestions (never auto-sends), and workspace-tag hints.
 */
export function MailAiCopilotPanel({
	result,
	loading,
	error,
	availableTags,
	onRunMode,
	onInsertDraft,
	onApplyTag,
	onOpenCitation,
	onClear,
	onClose
}: MailAiCopilotPanelProps) {
	const matchingTags =
		result?.suggestedTags
			.map((name) => availableTags.find((tag) => tag.name.toLowerCase() === name.toLowerCase()))
			.filter((tag): tag is MailTagDto => tag !== undefined) ?? []

	return (
		<div
			className="border-b border-border bg-accent/25 px-4 py-3 text-xs"
			data-testid="mail-ai-copilot-panel"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<Sparkles className="size-3.5 text-primary" aria-hidden />
					<span className="font-semibold text-foreground">{t('mail.ai.title')}</span>
					<span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
						<ShieldAlert className="size-3" aria-hidden />
						{t('mail.ai.review-notice')}
					</span>
				</div>
				<div className="flex flex-wrap items-center gap-1.5">
					<Button
						size="sm"
						tone="outline"
						type="button"
						disabled={loading}
						onClick={() => void onRunMode('summarize')}
					>
						{t('mail.ai.summarize')}
					</Button>
					<Button
						size="sm"
						tone="outline"
						type="button"
						disabled={loading}
						onClick={() => void onRunMode('suggest_reply')}
					>
						{t('mail.ai.suggest-reply')}
					</Button>
					<Button
						size="sm"
						tone="outline"
						type="button"
						disabled={loading}
						onClick={() => void onRunMode('suggest_tags')}
					>
						{t('mail.ai.suggest-tags')}
					</Button>
					{result ? (
						<Button size="sm" tone="ghost" type="button" onClick={onClear}>
							{t('mail.ai.clear')}
						</Button>
					) : null}
					<Button size="icon" tone="ghost" type="button" aria-label={t('chat.pins.close')} onClick={onClose}>
						<X className="size-3.5" aria-hidden />
					</Button>
				</div>
			</div>

			{loading ? <p className="mt-2 text-muted-foreground">{t('mail.ai.loading')}</p> : null}

			{error ? (
				<p role="alert" className="mt-2 text-destructive">
					{t('mail.ai.unavailable')} ({error})
				</p>
			) : null}

			{result ? (
				<div className="mt-2.5 space-y-2 rounded-md border border-border bg-card p-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<Badge tone="outline" className="font-mono text-[10px]">
							{result.model}
						</Badge>
						{result.mode === 'suggest_reply' ? (
							<Button size="sm" type="button" onClick={() => onInsertDraft(result.text)}>
								{t('mail.ai.insert-draft')}
							</Button>
						) : null}
					</div>
					<p className="whitespace-pre-wrap text-sm leading-relaxed text-card-foreground">{result.text}</p>

					{matchingTags.length > 0 ? (
						<div className="flex flex-wrap items-center gap-1.5 pt-1">
							{matchingTags.map((tag) => (
								<Button
									key={tag.id}
									size="sm"
									tone="outline"
									type="button"
									onClick={() => void onApplyTag(tag.id)}
								>
									<Tag className="size-3" aria-hidden />
									<span>{t('mail.ai.apply-tag', { name: tag.name })}</span>
								</Button>
							))}
						</div>
					) : null}

					{result.citations.length > 0 ? (
						<div className="flex flex-wrap items-center gap-1.5 border-t border-border/70 pt-2">
							<span className="text-[11px] font-medium text-muted-foreground">{t('mail.ai.citations')}:</span>
							{result.citations.map((cite) => (
								<button
									key={`${cite.entityType}-${cite.entityId}`}
									type="button"
									onClick={() => onOpenCitation(cite.entityType, cite.entityId, cite.slug)}
									className="inline-flex items-center gap-1 rounded-sm border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground hover:bg-accent"
								>
									<FileText className="size-3 text-muted-foreground" aria-hidden />
									<span>{cite.label}</span>
								</button>
							))}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	)
}
