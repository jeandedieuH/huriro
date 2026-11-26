import type { ContactDto, MailAddress } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'

export interface RecipientInputProps {
	readonly id: string
	readonly label?: string | undefined
	readonly recipients: readonly MailAddress[]
	readonly draftText?: string | undefined
	readonly onDraftTextChange?: ((value: string) => void) | undefined
	readonly onChange: (next: MailAddress[]) => void
	readonly contacts: readonly ContactDto[]
	readonly placeholder?: string | undefined
	readonly required?: boolean | undefined
	readonly className?: string | undefined
}

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Merges already-committed recipient chips with any valid email remaining in
 * the raw text input so callers never drop typed addresses before submit.
 */
export function resolveRecipientList(committed: readonly MailAddress[], rawDraft: string): MailAddress[] {
	const seen = new Set(committed.map((r) => r.email.trim().toLowerCase()))
	const result: MailAddress[] = [...committed]
	for (const piece of rawDraft.split(/[,;\s]+/)) {
		const trimmed = piece.trim()
		if (SIMPLE_EMAIL_RE.test(trimmed)) {
			const lower = trimmed.toLowerCase()
			if (!seen.has(lower)) {
				seen.add(lower)
				result.push({ email: trimmed, name: null })
			}
		}
	}
	return result
}

/**
 * Chip-based To/Cc/Bcc email input with contact autocomplete from workspace contacts.
 */
export function RecipientInput({
	id,
	recipients,
	draftText,
	onDraftTextChange,
	onChange,
	contacts,
	placeholder,
	required = false,
	className
}: RecipientInputProps) {
	const [internalDraft, setInternalDraft] = useState('')
	const [focused, setFocused] = useState(false)

	const text = draftText !== undefined ? draftText : internalDraft
	const setText = (next: string) => {
		if (onDraftTextChange) onDraftTextChange(next)
		else setInternalDraft(next)
	}

	const committedEmails = useMemo(
		() => new Set(recipients.map((r) => r.email.trim().toLowerCase())),
		[recipients]
	)

	const suggestions = useMemo(() => {
		const q = text.trim().toLowerCase()
		if (!focused || q.length === 0) return []
		return contacts
			.filter(
				(c) =>
					!committedEmails.has(c.email.toLowerCase()) &&
					(c.email.toLowerCase().includes(q) || (c.displayName ?? '').toLowerCase().includes(q))
			)
			.slice(0, 6)
	}, [committedEmails, contacts, focused, text])

	const commitAddress = (addr: MailAddress) => {
		const normalized = addr.email.trim().toLowerCase()
		if (!normalized || committedEmails.has(normalized)) {
			setText('')
			return
		}
		onChange([...recipients, { email: addr.email.trim(), name: addr.name ?? null }])
		setText('')
	}

	const commitDraftIfValid = () => {
		const nextList = resolveRecipientList(recipients, text)
		if (nextList.length !== recipients.length) {
			onChange(nextList)
			setText('')
		}
	}

	const handleKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
		if ((ev.key === 'Enter' || ev.key === ',' || ev.key === ';') && text.trim()) {
			const nextList = resolveRecipientList(recipients, text)
			if (nextList.length > recipients.length) {
				ev.preventDefault()
				onChange(nextList)
				setText('')
			}
		} else if (ev.key === 'Backspace' && text.length === 0 && recipients.length > 0) {
			onChange(recipients.slice(0, -1))
		}
	}

	return (
		<div className={className ? `relative ${className}` : 'relative'}>
			<div className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-sm focus-within:ring-2 focus-within:ring-ring">
				{recipients.map((r) => (
					<Badge key={r.email} tone="secondary" className="gap-1 py-0.5 text-xs">
						<span>{r.name ? `${r.name} <${r.email}>` : r.email}</span>
						<button
							type="button"
							aria-label={t('mail.compose.remove-recipient', { email: r.email })}
							onClick={() => onChange(recipients.filter((item) => item.email !== r.email))}
							className="rounded-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						>
							<X className="size-3" aria-hidden />
						</button>
					</Badge>
				))}
				<input
					id={id}
					type="email"
					required={required && recipients.length === 0}
					placeholder={recipients.length === 0 ? placeholder : undefined}
					value={text}
					onFocus={() => setFocused(true)}
					onBlur={() => {
						commitDraftIfValid()
						window.setTimeout(() => setFocused(false), 120)
					}}
					onKeyDown={handleKeyDown}
					onChange={(e) => {
						const val = e.target.value
						if (val.includes(',')) {
							const merged = resolveRecipientList(recipients, val)
							if (merged.length > recipients.length) {
								onChange(merged)
								setText('')
								return
							}
						}
						setText(val)
					}}
					className="min-w-32 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
				/>
			</div>

			{suggestions.length > 0 ? (
				<div
					role="listbox"
					aria-label={t('mail.compose.add-recipient')}
					className="absolute left-0 right-0 z-30 mt-1 max-h-44 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
				>
					{suggestions.map((contact) => (
						<button
							key={contact.id}
							type="button"
							role="option"
							aria-selected={false}
							onMouseDown={(ev) => {
								ev.preventDefault()
								commitAddress({ email: contact.email, name: contact.displayName })
							}}
							className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-popover-foreground hover:bg-accent"
						>
							<span className="truncate font-medium">
								{contact.displayName ? `${contact.displayName} (${contact.email})` : contact.email}
							</span>
							{contact.vipTier !== 'standard' ? (
								<Badge tone="warning" className="text-[10px] uppercase">
									{contact.vipTier}
								</Badge>
							) : null}
						</button>
					))}
				</div>
			) : null}
		</div>
	)
}
