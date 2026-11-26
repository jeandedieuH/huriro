import type { MailDraftDto, MailTemplateDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Alert, Button, Chip, Surface } from 'heroui-native'
import { Send, ShieldCheck, StickyNote, Undo2 } from 'lucide-react-native'
import { useState } from 'react'
import { ScrollView, TextInput, View } from 'react-native'

/**
 * Native Mail v2 composer with Reply/Internal-Note mode, snippet insertion,
 * draft review approval gate, and undo-send grace countdown.
 */
export function MobileMailComposer({
	activeDraft,
	templates,
	currentUserId,
	onInsertTemplate,
	onSendReply,
	onSaveNote,
	onRequestReview,
	onApproveReview,
	onUndoSend
}: {
	readonly activeDraft: MailDraftDto | null
	readonly templates: readonly MailTemplateDto[]
	readonly currentUserId: string
	readonly onInsertTemplate: (template: MailTemplateDto) => Promise<string>
	readonly onSendReply: (bodyText: string, existingDraftId?: string) => Promise<void>
	readonly onSaveNote: (bodyText: string) => Promise<void>
	readonly onRequestReview: (bodyText: string, reviewerId: string, existingDraftId?: string) => Promise<void>
	readonly onApproveReview: (draftId: string) => Promise<void>
	readonly onUndoSend: (draftId: string) => Promise<void>
}) {
	const [mode, setMode] = useState<'reply' | 'note'>('reply')
	const [syncedDraftId, setSyncedDraftId] = useState<string | null>(activeDraft?.id ?? null)
	const [bodyText, setBodyText] = useState(activeDraft?.bodyText ?? '')
	const [busy, setBusy] = useState(false)

	// Re-seed draft text only when switching to a different draft id.
	const incomingDraftId = activeDraft?.id ?? null
	if (incomingDraftId !== syncedDraftId) {
		setSyncedDraftId(incomingDraftId)
		setBodyText(activeDraft?.bodyText ?? '')
	}

	const reviewBlocked = activeDraft?.reviewStatus === 'requested'
	const canUndo = activeDraft?.status === 'sending'

	async function runBusy(fn: () => Promise<void>) {
		if (busy) return
		setBusy(true)
		try {
			await fn()
		} finally {
			setBusy(false)
		}
	}

	async function handleSubmit() {
		const trimmed = bodyText.trim()
		if (!trimmed || (mode === 'reply' && reviewBlocked)) return
		await runBusy(async () => {
			if (mode === 'note') {
				await onSaveNote(trimmed)
			} else {
				await onSendReply(trimmed, activeDraft?.id)
			}
			setBodyText('')
		})
	}

	async function handleTemplatePress(tpl: MailTemplateDto) {
		await runBusy(async () => {
			const rendered = await onInsertTemplate(tpl)
			setBodyText((prev) => (prev ? `${prev}\n${rendered}` : rendered))
		})
	}

	return (
		<Surface variant="default" className="border-t border-default-soft-hover p-3 gap-2">
			{canUndo && activeDraft ? (
				<Alert status="warning">
					<Alert.Indicator />
					<Alert.Content>
						<View className="flex-row items-center justify-between gap-2">
							<Alert.Title>{t('mail.composer.undo')}</Alert.Title>
							<Button
								size="sm"
								variant="secondary"
								onPress={() => void runBusy(() => onUndoSend(activeDraft.id))}
							>
								<Undo2 size={13} color="#18181b" />
								<Button.Label>{t('mail.composer.undo')}</Button.Label>
							</Button>
						</View>
					</Alert.Content>
				</Alert>
			) : null}

			{reviewBlocked && activeDraft ? (
				<Alert status="accent">
					<Alert.Indicator />
					<Alert.Content>
						<Alert.Title>{t('mail.review.pending')}</Alert.Title>
						<Alert.Description>{t('mail.review.blocked-send')}</Alert.Description>
						<View className="flex-row gap-2 mt-2">
							<Button
								size="sm"
								variant="primary"
								isDisabled={busy}
								onPress={() => void runBusy(() => onApproveReview(activeDraft.id))}
							>
								<ShieldCheck size={13} color="#ffffff" />
								<Button.Label>{t('mail.review.approve')}</Button.Label>
							</Button>
						</View>
					</Alert.Content>
				</Alert>
			) : null}

			<View className="flex-row items-center justify-between gap-2">
				<View className="flex-row items-center gap-1.5">
					<Chip
						size="sm"
						variant={mode === 'reply' ? 'primary' : 'soft'}
						color={mode === 'reply' ? 'accent' : 'default'}
						onPress={() => setMode('reply')}
					>
						<Chip.Label>{t('mail.composer.reply')}</Chip.Label>
					</Chip>
					<Chip
						size="sm"
						variant={mode === 'note' ? 'primary' : 'soft'}
						color={mode === 'note' ? 'warning' : 'default'}
						onPress={() => setMode('note')}
					>
						<Chip.Label>{t('mail.composer.note')}</Chip.Label>
					</Chip>
				</View>
				{mode === 'reply' && !reviewBlocked && bodyText.trim().length > 0 ? (
					<Button
						size="sm"
						variant="secondary"
						isDisabled={busy}
						onPress={() =>
							void runBusy(() => onRequestReview(bodyText.trim(), currentUserId, activeDraft?.id))
						}
					>
						<Button.Label>{t('mail.review.request')}</Button.Label>
					</Button>
				) : null}
			</View>

			{mode === 'reply' && templates.length > 0 ? (
				<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5">
					{templates.map((tpl) => (
						<Chip
							key={tpl.id}
							size="sm"
							variant="soft"
							color="default"
							onPress={() => void handleTemplatePress(tpl)}
						>
							<Chip.Label>{tpl.shortcut || tpl.name}</Chip.Label>
						</Chip>
					))}
				</ScrollView>
			) : null}

			<View className="flex-row items-end gap-2">
				<TextInput
					className="flex-1 rounded-xl border border-border bg-field px-3.5 py-2.5 text-sm text-foreground max-h-28"
					value={bodyText}
					onChangeText={setBodyText}
					placeholder={
						mode === 'note' ? t('mail.composer.note-placeholder') : t('mail.composer.reply-placeholder')
					}
					multiline
					accessibilityLabel={mode === 'note' ? t('mail.composer.note') : t('mail.composer.reply')}
				/>
				<Button
					isIconOnly
					size="md"
					variant="primary"
					isDisabled={!bodyText.trim() || busy || (mode === 'reply' && reviewBlocked)}
					onPress={() => void handleSubmit()}
					accessibilityLabel={mode === 'note' ? t('mail.composer.save-note') : t('mail.composer.send')}
				>
					{mode === 'note' ? <StickyNote size={16} color="#ffffff" /> : <Send size={16} color="#ffffff" />}
				</Button>
			</View>
		</Surface>
	)
}
