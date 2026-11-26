import type { ChatChannelDto, UserGroupDto, WorkspaceEmojiDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { cn } from '@/lib/utils'

export type AutocompleteTriggerKind = 'slash' | 'mention' | 'channel' | 'emoji'

export interface AutocompleteTrigger {
	readonly kind: AutocompleteTriggerKind
	readonly query: string
	readonly startIndex: number
}

export interface AutocompleteSuggestion {
	readonly id: string
	readonly kind: AutocompleteTriggerKind
	readonly label: string
	readonly description?: string | undefined
	readonly insertText: string
	readonly previewGlyph?: string | undefined
	readonly imageUrl?: string | undefined
}

export interface AutocompleteMemberEntry {
	readonly principalId: string
	readonly displayName?: string | undefined
	readonly email?: string | undefined
}

const SLASH_COMMANDS = [
	{ cmd: 'poll', descKey: 'chat.poll.title' },
	{ cmd: 'remind', descKey: 'chat.saved.add-reminder' },
	{ cmd: 'status', descKey: 'chat.status.set' },
	{ cmd: 'topic', descKey: 'chat.create-channel.topic' },
	{ cmd: 'issue', descKey: 'chat.message.create-issue' },
	{ cmd: 'mute', descKey: 'chat.header.mute' }
] as const

export const QUICK_UNICODE_EMOJIS: ReadonlyArray<{ readonly shortcode: string; readonly glyph: string }> = [
	{ shortcode: '+1', glyph: '👍' },
	{ shortcode: 'tada', glyph: '🎉' },
	{ shortcode: 'heart', glyph: '❤️' },
	{ shortcode: 'fire', glyph: '🔥' },
	{ shortcode: 'eyes', glyph: '👀' },
	{ shortcode: 'rocket', glyph: '🚀' },
	{ shortcode: 'white_check_mark', glyph: '✅' },
	{ shortcode: 'bulb', glyph: '💡' },
	{ shortcode: 'smile', glyph: '😄' },
	{ shortcode: 'clap', glyph: '👏' }
]

/** Detect `/`, `@`, `#`, or `:` autocomplete triggers immediately preceding the caret. */
export function detectAutocompleteTrigger(text: string, caretPosition: number): AutocompleteTrigger | null {
	const beforeCaret = text.slice(0, caretPosition)

	// Only trigger slash commands when `/` begins the message or a new line.
	const slashMatch = /(?:^|\n)\/([a-z0-9_-]*)$/i.exec(beforeCaret)
	if (slashMatch) {
		const query = slashMatch[1] ?? ''
		return {
			kind: 'slash',
			query,
			startIndex: beforeCaret.length - query.length - 1
		}
	}

	const tokenMatch = /(?:^|\s)([@#:])([a-zA-Z0-9_+.-]*)$/.exec(beforeCaret)
	if (!tokenMatch) return null

	const sigil = tokenMatch[1]
	const query = tokenMatch[2] ?? ''
	const startIndex = beforeCaret.length - query.length - 1
	const kindMap: Record<string, AutocompleteTriggerKind> = {
		'@': 'mention',
		'#': 'channel',
		':': 'emoji'
	}
	const kind = sigil ? kindMap[sigil] : undefined
	if (!kind) return null

	return { kind, query, startIndex }
}

/** Build filtered autocomplete items for the active trigger. */
export function buildAutocompleteSuggestions({
	trigger,
	channels,
	members,
	userGroups,
	workspaceEmojis
}: {
	readonly trigger: AutocompleteTrigger | null
	readonly channels: readonly ChatChannelDto[]
	readonly members: readonly AutocompleteMemberEntry[]
	readonly userGroups: readonly UserGroupDto[]
	readonly workspaceEmojis: readonly WorkspaceEmojiDto[]
}): AutocompleteSuggestion[] {
	if (!trigger) return []
	const q = trigger.query.toLowerCase()

	const builders: Record<AutocompleteTriggerKind, () => AutocompleteSuggestion[]> = {
		slash: () =>
			SLASH_COMMANDS.map((item) => ({
				cmd: item.cmd,
				description: t(item.descKey)
			}))
				.filter((item) => item.cmd.includes(q) || item.description.toLowerCase().includes(q))
				.map((item) => ({
					id: `slash:${item.cmd}`,
					kind: 'slash',
					label: `/${item.cmd}`,
					description: item.description,
					insertText: item.cmd === 'poll' || item.cmd === 'mute' ? `/${item.cmd}` : `/${item.cmd} `
				})),
		mention: () => {
			const specials: AutocompleteSuggestion[] = [
				{
					id: 'mention:channel',
					kind: 'mention',
					label: '@channel',
					insertText: '@channel '
				},
				{
					id: 'mention:here',
					kind: 'mention',
					label: '@here',
					insertText: '@here '
				}
			]
			const groupItems: AutocompleteSuggestion[] = userGroups.map((g) => ({
				id: `group:${g.id}`,
				kind: 'mention',
				label: `@${g.handle}`,
				description: g.name,
				insertText: `@${g.handle} `
			}))
			const memberItems: AutocompleteSuggestion[] = members.map((m) => {
				const rawHandle = (m.displayName ?? m.email?.split('@')[0] ?? m.principalId.slice(0, 8))
					.trim()
					.replace(/\s+/g, '')
				return {
					id: `member:${m.principalId}`,
					kind: 'mention',
					label: `@${rawHandle}`,
					...(m.displayName ? { description: m.displayName } : {}),
					insertText: `@${rawHandle} `
				}
			})
			return [...specials, ...groupItems, ...memberItems].filter(
				(item) =>
					item.label.toLowerCase().includes(q) ||
					Boolean(item.description && item.description.toLowerCase().includes(q))
			)
		},
		channel: () =>
			channels
				.filter((c) => c.kind !== 'dm' && c.name)
				.filter((c) => (c.name ?? '').toLowerCase().includes(q))
				.map((c) => ({
					id: `channel:${c.id}`,
					kind: 'channel',
					label: `#${c.name}`,
					...(c.topic ? { description: c.topic } : {}),
					insertText: `#${c.name} `
				})),
		emoji: () => {
			const custom: AutocompleteSuggestion[] = workspaceEmojis.map((e) => ({
				id: `emoji:custom:${e.id}`,
				kind: 'emoji',
				label: `:${e.shortcode}:`,
				insertText: `:${e.shortcode}: `,
				imageUrl: `/api/v1/files/${encodeURIComponent(e.fileId)}/download`
			}))
			const standard: AutocompleteSuggestion[] = QUICK_UNICODE_EMOJIS.map((e) => ({
				id: `emoji:std:${e.shortcode}`,
				kind: 'emoji',
				label: `:${e.shortcode}:`,
				insertText: `${e.glyph} `,
				previewGlyph: e.glyph
			}))
			return [...custom, ...standard].filter((item) => item.label.toLowerCase().includes(q))
		}
	}

	return builders[trigger.kind]().slice(0, 8)
}

export interface ComposerAutocompleteProps {
	readonly suggestions: readonly AutocompleteSuggestion[]
	readonly activeIndex: number
	readonly onSelect: (suggestion: AutocompleteSuggestion) => void
	readonly onHoverIndex: (index: number) => void
}

/** Floating accessible listbox anchored above the message composer. */
export function ComposerAutocomplete({
	suggestions,
	activeIndex,
	onSelect,
	onHoverIndex
}: ComposerAutocompleteProps) {
	if (suggestions.length === 0) return null

	return (
		<div
			role="listbox"
			aria-label={t('chat.composer.emoji')}
			className="absolute bottom-full left-0 z-(--z-popover) mb-1.5 max-h-60 w-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-(--shadow-2)"
		>
			{suggestions.map((item, idx) => {
				const selected = idx === activeIndex
				return (
					<button
						key={item.id}
						type="button"
						role="option"
						aria-selected={selected}
						onMouseEnter={() => onHoverIndex(idx)}
						onMouseDown={(ev) => {
							// Keep focus inside textarea when picking with pointer.
							ev.preventDefault()
							onSelect(item)
						}}
						className={cn(
							'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors',
							selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
						)}
					>
						<span className="flex min-w-0 items-center gap-2 font-medium">
							{item.imageUrl ? (
								<img
									src={item.imageUrl}
									alt={item.label}
									className="size-4 shrink-0 rounded-xs object-contain"
								/>
							) : item.previewGlyph ? (
								<span aria-hidden className="text-sm leading-none">
									{item.previewGlyph}
								</span>
							) : null}
							<span className="truncate">{item.label}</span>
						</span>
						{item.description ? (
							<span className="max-w-32 truncate text-[11px] text-muted-foreground">{item.description}</span>
						) : null}
					</button>
				)
			})}
		</div>
	)
}
