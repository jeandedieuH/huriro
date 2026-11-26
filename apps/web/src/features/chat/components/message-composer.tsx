import type {
	ChatChannelDto,
	ChatMessageDto,
	FileDto,
	UserGroupDto,
	WorkspaceEmojiDto
} from '@huriro/contracts'
import { t } from '@huriro/i18n'
import {
	BarChart3,
	Bold,
	Code,
	FileCode2,
	Italic,
	List,
	Paperclip,
	Quote,
	Send,
	Smile,
	Strikethrough,
	X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
	type AutocompleteMemberEntry,
	type AutocompleteSuggestion,
	buildAutocompleteSuggestions,
	ComposerAutocomplete,
	detectAutocompleteTrigger,
	QUICK_UNICODE_EMOJIS
} from './composer-autocomplete'
import { SchedulePopover } from './schedule-popover'

export interface MessageComposerProps {
	readonly placeholder: string
	readonly channelKey?: string | undefined
	readonly initialDraftText?: string | undefined
	readonly quotingMessage?: ChatMessageDto | null | undefined
	readonly onCancelQuote?: (() => void) | undefined
	readonly channels?: readonly ChatChannelDto[] | undefined
	readonly members?: readonly AutocompleteMemberEntry[] | undefined
	readonly userGroups?: readonly UserGroupDto[] | undefined
	readonly workspaceEmojis?: readonly WorkspaceEmojiDto[] | undefined
	readonly onSend: (bodyText: string, attachmentFileIds: string[]) => Promise<void>
	readonly onSchedule?:
		| ((scheduledForIso: string, bodyText: string, attachmentFileIds: string[]) => Promise<void>)
		| undefined
	readonly onDraftChange?: ((text: string) => Promise<void> | void) | undefined
	readonly onOpenPollDialog?: (() => void) | undefined
	readonly onUploadFile?: ((file: File) => Promise<FileDto>) | undefined
	readonly onTyping?: (() => void) | undefined
	readonly disabled?: boolean | undefined
}

export function MessageComposer({
	placeholder,
	channelKey,
	initialDraftText,
	quotingMessage,
	onCancelQuote,
	channels = [],
	members = [],
	userGroups = [],
	workspaceEmojis = [],
	onSend,
	onSchedule,
	onDraftChange,
	onOpenPollDialog,
	onUploadFile,
	onTyping,
	disabled
}: MessageComposerProps) {
	const [text, setText] = useState(initialDraftText ?? '')
	const [uploadedFiles, setUploadedFiles] = useState<FileDto[]>([])
	const [uploading, setUploading] = useState(false)
	const [sending, setSending] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [draftSavedHint, setDraftSavedHint] = useState(false)
	const [emojiOpen, setEmojiOpen] = useState(false)
	const [caretPos, setCaretPos] = useState(0)
	const [activeSuggestionIdx, setActiveSuggestionIdx] = useState(0)
	const [dismissedTriggerKey, setDismissedTriggerKey] = useState<string | null>(null)

	const textareaRef = useRef<HTMLTextAreaElement | null>(null)
	const fileInputRef = useRef<HTMLInputElement | null>(null)
	const lastTypingAt = useRef(0)
	const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const prevChannelKeyRef = useRef<string | undefined>(channelKey)
	const onDraftChangeRef = useRef(onDraftChange)
	onDraftChangeRef.current = onDraftChange

	// Sync textarea text when switching channels/threads or applying initial draft on mount.
	useEffect(() => {
		if (prevChannelKeyRef.current !== channelKey) {
			prevChannelKeyRef.current = channelKey
			setText(initialDraftText ?? '')
			setUploadedFiles([])
			setDraftSavedHint(false)
		}
	}, [channelKey, initialDraftText])

	// Hydrate late-arriving initial draft only when user has not started typing yet.
	useEffect(() => {
		if (initialDraftText && text.length === 0) {
			setText(initialDraftText)
		}
	}, [initialDraftText, text.length])

	useEffect(() => {
		return () => {
			if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
		}
	}, [])

	const trigger = useMemo(() => detectAutocompleteTrigger(text, caretPos), [text, caretPos])
	const triggerKey = trigger ? `${trigger.kind}:${trigger.startIndex}:${trigger.query}` : null
	const suggestions = useMemo(() => {
		if (!trigger || dismissedTriggerKey === triggerKey) return []
		return buildAutocompleteSuggestions({
			trigger,
			channels,
			members,
			userGroups,
			workspaceEmojis
		})
	}, [channels, dismissedTriggerKey, members, trigger, triggerKey, userGroups, workspaceEmojis])

	function scheduleDraftSave(nextText: string) {
		if (!onDraftChangeRef.current) return
		if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
		setDraftSavedHint(false)
		draftTimerRef.current = setTimeout(() => {
			void Promise.resolve(onDraftChangeRef.current?.(nextText)).then(() => {
				if (nextText.trim().length > 0) {
					setDraftSavedHint(true)
				}
			})
		}, 500)
	}

	function updateText(nextText: string, nextCaret?: number) {
		setText(nextText)
		setDismissedTriggerKey(null)
		setActiveSuggestionIdx(0)
		if (nextCaret !== undefined) {
			setCaretPos(nextCaret)
			requestAnimationFrame(() => {
				textareaRef.current?.setSelectionRange(nextCaret, nextCaret)
			})
		}
		scheduleDraftSave(nextText)
	}

	function applyWrapFormat(before: string, after = before) {
		const el = textareaRef.current
		const start = el?.selectionStart ?? text.length
		const end = el?.selectionEnd ?? text.length
		const selected = text.slice(start, end)
		const nextText = `${text.slice(0, start)}${before}${selected}${after}${text.slice(end)}`
		const nextCaret = selected
			? start + before.length + selected.length + after.length
			: start + before.length
		updateText(nextText, nextCaret)
		el?.focus()
	}

	function applyLinePrefix(prefix: string) {
		const el = textareaRef.current
		const start = el?.selectionStart ?? text.length
		const end = el?.selectionEnd ?? text.length
		const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1
		const selected = text.slice(lineStart, end)
		const prefixed = selected
			.split('\n')
			.map((line) => (line.startsWith(prefix) ? line : `${prefix}${line}`))
			.join('\n')
		const nextText = `${text.slice(0, lineStart)}${prefixed}${text.slice(end)}`
		updateText(nextText, lineStart + prefixed.length)
		el?.focus()
	}

	function handleSelectSuggestion(item: AutocompleteSuggestion) {
		if (!trigger) return
		const nextText = `${text.slice(0, trigger.startIndex)}${item.insertText}${text.slice(caretPos)}`
		const nextCaret = trigger.startIndex + item.insertText.length
		updateText(nextText, nextCaret)
		textareaRef.current?.focus()
	}

	async function submit() {
		const trimmed = text.trim()
		if (!trimmed && uploadedFiles.length === 0) return
		if (sending || disabled) return
		setSending(true)
		setError(null)
		if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
		try {
			await onSend(
				trimmed || uploadedFiles.map((f) => f.filename).join(', '),
				uploadedFiles.map((f) => f.id)
			)
			setText('')
			setUploadedFiles([])
			setDraftSavedHint(false)
			if (onDraftChangeRef.current) void onDraftChangeRef.current('')
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to send message')
		} finally {
			setSending(false)
		}
	}

	async function handleSchedule(scheduledForIso: string) {
		if (!onSchedule || sending || disabled) return
		const trimmed = text.trim()
		if (!trimmed && uploadedFiles.length === 0) return
		setSending(true)
		setError(null)
		if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
		try {
			await onSchedule(
				scheduledForIso,
				trimmed || uploadedFiles.map((f) => f.filename).join(', '),
				uploadedFiles.map((f) => f.id)
			)
			setText('')
			setUploadedFiles([])
			setDraftSavedHint(false)
			if (onDraftChangeRef.current) void onDraftChangeRef.current('')
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to schedule message')
		} finally {
			setSending(false)
		}
	}

	async function handleFileSelect(files: FileList | null) {
		if (!files || !onUploadFile || files.length === 0) return
		setUploading(true)
		setError(null)
		try {
			const uploaded: FileDto[] = []
			for (const file of Array.from(files)) {
				uploaded.push(await onUploadFile(file))
			}
			setUploadedFiles((prev) => [...prev, ...uploaded])
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Attachment upload failed')
		} finally {
			setUploading(false)
			if (fileInputRef.current) fileInputRef.current.value = ''
		}
	}

	const hasContent = Boolean(text.trim() || uploadedFiles.length > 0)

	return (
		<div className="relative space-y-2 rounded-lg border border-border bg-card p-2.5">
			<ComposerAutocomplete
				suggestions={suggestions}
				activeIndex={activeSuggestionIdx}
				onSelect={handleSelectSuggestion}
				onHoverIndex={setActiveSuggestionIdx}
			/>

			{quotingMessage ? (
				<div className="flex items-center justify-between gap-2 rounded-md border-l-2 border-primary bg-muted/60 px-2.5 py-1.5 text-xs">
					<div className="min-w-0 flex-1">
						<p className="font-medium text-foreground">
							{t('chat.composer.quoting', {
								name: quotingMessage.authorDisplayName ?? quotingMessage.authorId.slice(0, 8)
							})}
						</p>
						<p className="truncate text-muted-foreground">{quotingMessage.bodyText}</p>
					</div>
					{onCancelQuote ? (
						<Button
							size="icon"
							tone="ghost"
							type="button"
							className="size-6 shrink-0"
							aria-label={t('chat.composer.cancel-quote')}
							onClick={onCancelQuote}
						>
							<X className="size-3.5" aria-hidden />
						</Button>
					) : null}
				</div>
			) : null}

			<div className="flex flex-wrap items-center gap-0.5 border-b border-border/60 pb-1.5">
				<Button
					size="icon"
					tone="ghost"
					type="button"
					className="size-7"
					disabled={disabled}
					aria-label={t('chat.composer.bold')}
					onClick={() => applyWrapFormat('**')}
				>
					<Bold className="size-3.5" aria-hidden />
				</Button>
				<Button
					size="icon"
					tone="ghost"
					type="button"
					className="size-7"
					disabled={disabled}
					aria-label={t('chat.composer.italic')}
					onClick={() => applyWrapFormat('*')}
				>
					<Italic className="size-3.5" aria-hidden />
				</Button>
				<Button
					size="icon"
					tone="ghost"
					type="button"
					className="size-7"
					disabled={disabled}
					aria-label={t('chat.composer.strike')}
					onClick={() => applyWrapFormat('~~')}
				>
					<Strikethrough className="size-3.5" aria-hidden />
				</Button>
				<Button
					size="icon"
					tone="ghost"
					type="button"
					className="size-7"
					disabled={disabled}
					aria-label={t('chat.composer.code')}
					onClick={() => applyWrapFormat('`')}
				>
					<Code className="size-3.5" aria-hidden />
				</Button>
				<Button
					size="icon"
					tone="ghost"
					type="button"
					className="size-7"
					disabled={disabled}
					aria-label={t('chat.composer.code-block')}
					onClick={() => applyWrapFormat('\n```\n', '\n```')}
				>
					<FileCode2 className="size-3.5" aria-hidden />
				</Button>
				<Button
					size="icon"
					tone="ghost"
					type="button"
					className="size-7"
					disabled={disabled}
					aria-label={t('chat.composer.quote-block')}
					onClick={() => applyLinePrefix('> ')}
				>
					<Quote className="size-3.5" aria-hidden />
				</Button>
				<Button
					size="icon"
					tone="ghost"
					type="button"
					className="size-7"
					disabled={disabled}
					aria-label={t('chat.composer.bullet-list')}
					onClick={() => applyLinePrefix('- ')}
				>
					<List className="size-3.5" aria-hidden />
				</Button>
				{draftSavedHint ? (
					<span className="ml-auto text-[11px] text-muted-foreground">{t('chat.composer.draft-saved')}</span>
				) : null}
			</div>

			{uploadedFiles.length > 0 ? (
				<div className="flex flex-wrap gap-1.5">
					{uploadedFiles.map((f) => (
						<Badge key={f.id} tone="secondary" className="gap-1">
							<span>{f.filename}</span>
							<button
								type="button"
								aria-label={`Remove ${f.filename}`}
								onClick={() => setUploadedFiles((prev) => prev.filter((item) => item.id !== f.id))}
								className="rounded hover:text-destructive"
							>
								<X className="size-3" aria-hidden />
							</button>
						</Badge>
					))}
				</div>
			) : null}

			<textarea
				ref={textareaRef}
				value={text}
				disabled={disabled}
				onChange={(ev) => {
					setCaretPos(ev.target.selectionStart ?? ev.target.value.length)
					updateText(ev.target.value)
					const now = Date.now()
					if (onTyping && now - lastTypingAt.current > 3_000) {
						lastTypingAt.current = now
						onTyping()
					}
				}}
				onClick={(ev) => setCaretPos(ev.currentTarget.selectionStart ?? text.length)}
				onKeyUp={(ev) => setCaretPos(ev.currentTarget.selectionStart ?? text.length)}
				onPaste={(ev) => {
					if (!onUploadFile) return
					const files = ev.clipboardData.files
					if (files && files.length > 0) {
						void handleFileSelect(files)
					}
				}}
				onDragOver={(ev) => {
					if (onUploadFile) ev.preventDefault()
				}}
				onDrop={(ev) => {
					if (!onUploadFile || !ev.dataTransfer.files.length) return
					ev.preventDefault()
					void handleFileSelect(ev.dataTransfer.files)
				}}
				onKeyDown={(ev) => {
					if (suggestions.length > 0) {
						if (ev.key === 'ArrowDown') {
							ev.preventDefault()
							setActiveSuggestionIdx((idx) => (idx + 1) % suggestions.length)
							return
						}
						if (ev.key === 'ArrowUp') {
							ev.preventDefault()
							setActiveSuggestionIdx((idx) => (idx - 1 + suggestions.length) % suggestions.length)
							return
						}
						if (ev.key === 'Enter' || ev.key === 'Tab') {
							const picked = suggestions[activeSuggestionIdx]
							if (picked) {
								ev.preventDefault()
								handleSelectSuggestion(picked)
								return
							}
						}
						if (ev.key === 'Escape') {
							ev.preventDefault()
							setDismissedTriggerKey(triggerKey)
							return
						}
					}

					if ((ev.metaKey || ev.ctrlKey) && !ev.shiftKey) {
						if (ev.key.toLowerCase() === 'b') {
							ev.preventDefault()
							applyWrapFormat('**')
							return
						}
						if (ev.key.toLowerCase() === 'i') {
							ev.preventDefault()
							applyWrapFormat('*')
							return
						}
						if (ev.key.toLowerCase() === 'e') {
							ev.preventDefault()
							applyWrapFormat('`')
							return
						}
					}

					if (ev.key === 'Enter' && !ev.shiftKey) {
						ev.preventDefault()
						void submit()
					}
				}}
				placeholder={placeholder}
				aria-label={placeholder}
				rows={2}
				className={cn(
					'flex min-h-14 w-full resize-none rounded-md border-0 bg-transparent p-1 text-sm',
					'placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50'
				)}
			/>

			{error ? (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : null}

			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-1">
					{onUploadFile ? (
						<>
							<input
								ref={fileInputRef}
								type="file"
								multiple
								aria-label={t('chat.composer.attach')}
								className="hidden"
								onChange={(ev) => void handleFileSelect(ev.target.files)}
							/>
							<Button
								size="sm"
								tone="ghost"
								type="button"
								disabled={disabled || uploading}
								onClick={() => fileInputRef.current?.click()}
							>
								<Paperclip className="size-3.5" aria-hidden />
								<span>{uploading ? t('chat.composer.uploading') : t('chat.composer.attach')}</span>
							</Button>
						</>
					) : null}

					<Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
						<PopoverTrigger asChild>
							<Button
								size="icon"
								tone="ghost"
								type="button"
								className="size-8"
								disabled={disabled}
								aria-label={t('chat.composer.emoji')}
							>
								<Smile className="size-3.5" aria-hidden />
							</Button>
						</PopoverTrigger>
						<PopoverContent align="start" className="w-64 space-y-2 p-2">
							<div className="flex flex-wrap gap-1">
								{QUICK_UNICODE_EMOJIS.map((em) => (
									<button
										key={em.shortcode}
										type="button"
										aria-label={`:${em.shortcode}:`}
										onClick={() => {
											const pos = textareaRef.current?.selectionStart ?? text.length
											updateText(
												`${text.slice(0, pos)}${em.glyph} ${text.slice(pos)}`,
												pos + em.glyph.length + 1
											)
											setEmojiOpen(false)
										}}
										className="rounded p-1.5 text-sm hover:bg-accent"
									>
										{em.glyph}
									</button>
								))}
							</div>
							{workspaceEmojis.length > 0 ? (
								<div className="flex flex-wrap gap-1 border-t border-border pt-2">
									{workspaceEmojis.map((em) => (
										<button
											key={em.id}
											type="button"
											title={`:${em.shortcode}:`}
											onClick={() => {
												const token = `:${em.shortcode}: `
												const pos = textareaRef.current?.selectionStart ?? text.length
												updateText(`${text.slice(0, pos)}${token}${text.slice(pos)}`, pos + token.length)
												setEmojiOpen(false)
											}}
											className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs hover:bg-accent"
										>
											<img
												src={`/api/v1/files/${encodeURIComponent(em.fileId)}/download`}
												alt={`:${em.shortcode}:`}
												className="size-3.5 object-contain"
											/>
											<span>:{em.shortcode}:</span>
										</button>
									))}
								</div>
							) : null}
						</PopoverContent>
					</Popover>

					{onOpenPollDialog ? (
						<Button
							size="icon"
							tone="ghost"
							type="button"
							className="size-8"
							disabled={disabled}
							aria-label={t('chat.composer.poll')}
							onClick={onOpenPollDialog}
						>
							<BarChart3 className="size-3.5" aria-hidden />
						</Button>
					) : null}
				</div>

				<div className="flex items-center gap-1">
					{onSchedule ? (
						<SchedulePopover disabled={disabled || uploading || !hasContent} onSchedule={handleSchedule} />
					) : null}

					<Button
						size="sm"
						type="button"
						loading={sending}
						disabled={disabled || uploading || !hasContent}
						onClick={() => void submit()}
					>
						<Send className="size-3.5" aria-hidden />
						<span>{t('chat.composer.send')}</span>
					</Button>
				</div>
			</div>
		</div>
	)
}
