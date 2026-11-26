import type { MailTagBody, MailTagDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Plus, Tag } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export interface ConversationTagsBarProps {
	readonly tags: readonly MailTagDto[]
	readonly availableTags: readonly MailTagDto[]
	readonly inboxId?: string | null | undefined
	readonly openSignal?: number | undefined
	readonly onToggleTag: (tagId: string) => Promise<void>
	readonly onCreateTag: (body: MailTagBody) => Promise<MailTagDto>
}

/**
 * Displays applied conversation tags and provides an accessible popover for
 * toggling workspace/inbox tags or creating a new tag inline.
 */
export function ConversationTagsBar({
	tags,
	availableTags,
	inboxId,
	openSignal = 0,
	onToggleTag,
	onCreateTag
}: ConversationTagsBarProps) {
	const [open, setOpen] = useState(false)
	const [newName, setNewName] = useState('')
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		if (openSignal > 0) setOpen(true)
	}, [openSignal])

	const appliedIds = new Set(tags.map((item) => item.id))

	const handleCreate = async (ev: React.FormEvent) => {
		ev.preventDefault()
		const trimmed = newName.trim()
		if (!trimmed || busy) return
		setBusy(true)
		try {
			const created = await onCreateTag({
				inboxId: inboxId ?? null,
				name: trimmed
			})
			await onToggleTag(created.id)
			setNewName('')
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="flex flex-wrap items-center gap-1.5" data-testid="conversation-tags-bar">
			{tags.map((tag) => (
				<Badge key={tag.id} tone="secondary" className="gap-1 text-xs">
					<Tag className="size-3" aria-hidden />
					<span>{tag.name}</span>
				</Badge>
			))}
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button size="sm" tone="outline" type="button">
						<Plus className="size-3.5" aria-hidden />
						<span>{t('mail.tags.add')}</span>
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-64 p-3" align="start">
					<p className="mb-2 text-xs font-semibold text-foreground">{t('mail.tags.manage')}</p>
					{availableTags.length === 0 ? (
						<p className="mb-2 text-xs text-muted-foreground">{t('mail.tags.empty')}</p>
					) : (
						<ul className="mb-3 max-h-40 space-y-1.5 overflow-y-auto">
							{availableTags.map((tag) => {
								const checked = appliedIds.has(tag.id)
								return (
									<li key={tag.id} className="flex items-center gap-2">
										<Checkbox
											id={`conv-tag-${tag.id}`}
											checked={checked}
											onCheckedChange={() => {
												void onToggleTag(tag.id)
											}}
										/>
										<label
											htmlFor={`conv-tag-${tag.id}`}
											className="flex-1 cursor-pointer text-xs text-foreground"
										>
											{tag.name}
										</label>
									</li>
								)
							})}
						</ul>
					)}
					<form onSubmit={(ev) => void handleCreate(ev)} className="flex items-center gap-1.5">
						<Input
							aria-label={t('mail.tags.name-placeholder')}
							placeholder={t('mail.tags.name-placeholder')}
							value={newName}
							onChange={(e) => setNewName(e.target.value)}
							className="h-8 text-xs"
						/>
						<Button size="sm" type="submit" disabled={busy || newName.trim().length === 0}>
							{t('mail.tags.create')}
						</Button>
					</form>
				</PopoverContent>
			</Popover>
		</div>
	)
}
