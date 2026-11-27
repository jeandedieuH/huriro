import type {
	MailDraftDto,
	MailIdentityDto,
	MailMacroDto,
	MailTagDto,
	MailTemplateDto,
	MailTimelineDto
} from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { generateUuidV7, useSyncEngine } from '@huriro/sync-client'
import { Stack, useLocalSearchParams } from 'expo-router'
import { Card, Chip } from 'heroui-native'
import { Mail, StickyNote } from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Text, View } from 'react-native'
import { Container } from '../../src/components/app/container'
import { EmptyStateCard } from '../../src/components/common/empty-state-card'
import { FlashList } from '../../src/components/common/flash-list'
import { MobileMailActions } from '../../src/components/mail/mobile-mail-actions'
import { MobileMailComposer } from '../../src/components/mail/mobile-mail-composer'
import { useMobileRuntime } from '../../src/lib/runtime-context'
import { useHuriroColors } from '../../src/lib/theme'

interface TimelineRow {
	readonly id: string
	readonly kind: 'message' | 'note' | 'event'
	readonly title: string
	readonly body: string
	readonly timestamp: string
}

export default function MailConversationScreen() {
	const params = useLocalSearchParams<{ conversationId?: string }>()
	const conversationId = typeof params['conversationId'] === 'string' ? params['conversationId'] : ''
	const { runtime } = useMobileRuntime()
	const engine = useSyncEngine()
	const colors = useHuriroColors()

	const [timeline, setTimeline] = useState<MailTimelineDto | null>(null)
	const [identities, setIdentities] = useState<MailIdentityDto[]>([])
	const [tags, setTags] = useState<MailTagDto[]>([])
	const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
	const [templates, setTemplates] = useState<MailTemplateDto[]>([])
	const [macros, setMacros] = useState<MailMacroDto[]>([])
	const [busy, setBusy] = useState(false)

	const loadConversation = useCallback(async () => {
		if (!conversationId || !runtime) return
		if (runtime.isPreview) {
			const now = new Date().toISOString()
			setTimeline({
				conversation: {
					id: conversationId,
					workspaceId: engine.workspaceId,
					inboxId: '0190a0b1-0000-7000-8000-000000000702',
					accountId: '0190a0b1-0000-7000-8000-000000000703',
					subject: 'Enterprise SSO onboarding question',
					status: 'open',
					assigneeId: engine.currentUserId,
					assigneeName: 'Owner',
					snoozedUntil: null,
					mergedIntoId: null,
					lastMessageAt: now,
					firstReplyAt: null,
					customerEmail: 'customer@acme.example',
					contactId: null,
					followUpAt: null,
					followUpCondition: null,
					slaNextDueAt: null,
					slaBreachedAt: null,
					priority: 'high',
					tagIds: [],
					snippet: 'Can we test SAML metadata upload on staging today?',
					messageCount: 1,
					createdAt: now,
					updatedAt: now,
					version: 1
				},
				messages: [
					{
						id: '0190a0b1-0000-7000-8000-000000000711',
						conversationId,
						direction: 'inbound',
						rfcMessageId: null,
						fromAddr: { email: 'customer@acme.example', name: 'Acme Customer' },
						toAddrs: [{ email: 'support@huriro.example', name: 'Support' }],
						ccAddrs: [],
						subject: 'Enterprise SSO onboarding question',
						snippet: 'Can we test SAML metadata upload on staging today?',
						sentAt: now,
						receivedAt: now,
						bodyHtml: null,
						bodyText: 'Can we test SAML metadata upload on staging today?',
						attachments: [],
						authResults: null,
						sendState: null,
						createdBy: null,
						createdAt: now
					}
				],
				notes: [],
				events: [],
				drafts: [],
				linkedTasks: [],
				linkedDocs: []
			})
			setIdentities([
				{
					id: '0190a0b1-0000-7000-8000-000000000720',
					accountId: '0190a0b1-0000-7000-8000-000000000703',
					address: 'support@huriro.example',
					displayName: 'Huriro Support',
					isDefault: true,
					createdAt: now
				}
			])
			return
		}

		const [tl, ids, allTags, convTags, tplList, macroList] = await Promise.all([
			runtime.api.getMailTimeline(conversationId),
			runtime.api.listMailIdentities(),
			runtime.api.listMailTags(),
			runtime.api.listConversationTags(conversationId),
			runtime.api.listMailTemplates(),
			runtime.api.listMailMacros()
		])
		setTimeline(tl)
		setIdentities(ids)
		setTags(allTags)
		setSelectedTagIds(convTags.map((tag) => tag.id))
		setTemplates(tplList)
		setMacros(macroList)
	}, [conversationId, runtime, engine.workspaceId, engine.currentUserId])

	useEffect(() => {
		void loadConversation().catch(() => {})
	}, [loadConversation])

	const rows = useMemo<TimelineRow[]>(() => {
		if (!timeline) return []
		const messageRows: TimelineRow[] = timeline.messages.map((m) => ({
			id: `msg:${m.id}`,
			kind: 'message',
			title: m.fromAddr.name ?? m.fromAddr.email,
			body: m.bodyText ?? m.snippet,
			timestamp: m.createdAt
		}))
		const noteRows: TimelineRow[] = timeline.notes.map((n) => ({
			id: `note:${n.id}`,
			kind: 'note',
			title: n.authorName ?? t('mail.timeline.note'),
			body: n.bodyText,
			timestamp: n.createdAt
		}))
		return [...messageRows, ...noteRows].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
	}, [timeline])

	const activeDraft: MailDraftDto | null =
		timeline?.drafts.find((d) => d.status === 'draft' || d.status === 'sending') ?? null
	const defaultIdentityId =
		activeDraft?.identityId ?? identities[0]?.id ?? '0190a0b1-0000-7000-8000-000000000720'
	const customerEmail = timeline?.conversation.customerEmail ?? 'customer@acme.example'

	async function ensureDraft(bodyText: string, existingDraftId?: string): Promise<MailDraftDto | null> {
		if (!timeline || !runtime) return null
		if (runtime.isPreview) {
			const now = new Date().toISOString()
			const previewDraft: MailDraftDto = {
				id: existingDraftId ?? generateUuidV7(),
				conversationId,
				identityId: defaultIdentityId,
				createdBy: engine.currentUserId,
				body: { text: bodyText },
				bodyText,
				recipients: { to: [{ email: customerEmail }] },
				inReplyToId: null,
				scheduledSendAt: null,
				status: 'draft',
				lockedBy: null,
				lockedUntil: null,
				collabEnabled: false,
				reviewStatus: 'none',
				reviewerId: null,
				reviewedAt: null,
				reviewNote: null,
				metadata: {},
				version: 1,
				createdAt: now,
				updatedAt: now
			}
			setTimeline((prev) => (prev ? { ...prev, drafts: [previewDraft] } : prev))
			return previewDraft
		}
		if (existingDraftId && activeDraft) return activeDraft
		return runtime.api.upsertMailDraft(conversationId, {
			identityId: defaultIdentityId,
			recipients: { to: [{ email: customerEmail }] },
			bodyText
		})
	}

	async function handleToggleStatus() {
		if (!timeline || !runtime) return
		const nextStatus = timeline.conversation.status === 'closed' ? 'open' : 'closed'
		setBusy(true)
		try {
			if (!runtime.isPreview) {
				await runtime.api.updateMailConversation(conversationId, { status: nextStatus })
				await loadConversation()
			} else {
				setTimeline({ ...timeline, conversation: { ...timeline.conversation, status: nextStatus } })
			}
		} finally {
			setBusy(false)
		}
	}

	async function handleToggleAssign() {
		if (!timeline || !runtime) return
		const nextAssignee =
			timeline.conversation.assigneeId === engine.currentUserId ? null : engine.currentUserId
		setBusy(true)
		try {
			if (!runtime.isPreview) {
				await runtime.api.updateMailConversation(conversationId, { assigneeId: nextAssignee })
				await loadConversation()
			} else {
				setTimeline({
					...timeline,
					conversation: { ...timeline.conversation, assigneeId: nextAssignee }
				})
			}
		} finally {
			setBusy(false)
		}
	}

	async function handleAutoRoute() {
		if (!runtime || runtime.isPreview) return
		setBusy(true)
		try {
			await runtime.api.routeConversationRoundRobin(conversationId)
			await loadConversation()
		} finally {
			setBusy(false)
		}
	}

	async function handleToggleTag(tagId: string) {
		if (!runtime) return
		const nextTagIds = selectedTagIds.includes(tagId)
			? selectedTagIds.filter((id) => id !== tagId)
			: [...selectedTagIds, tagId]
		setSelectedTagIds(nextTagIds)
		if (!runtime.isPreview) {
			await runtime.api.setConversationTags(conversationId, nextTagIds)
		}
	}

	async function handleRunMacro(macroId: string) {
		if (!runtime || runtime.isPreview) return
		setBusy(true)
		try {
			await runtime.api.applyMailMacro(macroId, [conversationId])
			await loadConversation()
		} finally {
			setBusy(false)
		}
	}

	return (
		<>
			<Stack.Screen
				options={{
					headerShown: true,
					title: timeline?.conversation.subject ?? 'Shared Inbox Thread'
				}}
			/>
			<Container
				scroll={false}
				edges={['bottom']}
				footer={
					timeline ? (
						<MobileMailComposer
							activeDraft={activeDraft}
							templates={templates}
							currentUserId={engine.currentUserId}
							onInsertTemplate={async (tpl) => {
								if (!runtime || runtime.isPreview) return tpl.bodyText
								const rendered = await runtime.api.renderMailTemplate(tpl.id, {
									variables: { customerEmail }
								})
								return rendered.bodyText
							}}
							onSendReply={async (bodyText, existingDraftId) => {
								if (!runtime) return
								const draft = await ensureDraft(bodyText, existingDraftId)
								if (!draft) return
								if (!runtime.isPreview) {
									await runtime.api.sendMailDraft(draft.id, {})
									await loadConversation()
								} else {
									setTimeline((prev) =>
										prev ? { ...prev, drafts: [{ ...draft, status: 'sending' }] } : prev
									)
								}
							}}
							onSaveNote={async (bodyText) => {
								if (!runtime) return
								if (!runtime.isPreview) {
									await runtime.api.createMailNote(conversationId, { bodyText })
									await loadConversation()
								} else {
									const now = new Date().toISOString()
									setTimeline((prev) =>
										prev
											? {
													...prev,
													notes: [
														...prev.notes,
														{
															id: generateUuidV7(),
															conversationId,
															authorId: engine.currentUserId,
															authorName: 'Owner',
															body: { text: bodyText },
															bodyText,
															mentions: [],
															createdAt: now
														}
													]
												}
											: prev
									)
								}
							}}
							onRequestReview={async (bodyText, reviewerId, existingDraftId) => {
								if (!runtime) return
								const draft = await ensureDraft(bodyText, existingDraftId)
								if (!draft) return
								if (!runtime.isPreview) {
									await runtime.api.requestMailDraftReview(draft.id, { reviewerId })
									await loadConversation()
								} else {
									setTimeline((prev) =>
										prev ? { ...prev, drafts: [{ ...draft, reviewStatus: 'requested', reviewerId }] } : prev
									)
								}
							}}
							onApproveReview={async (draftId) => {
								if (!runtime || runtime.isPreview) {
									setTimeline((prev) =>
										prev
											? {
													...prev,
													drafts: prev.drafts.map((d) =>
														d.id === draftId ? { ...d, reviewStatus: 'approved' } : d
													)
												}
											: prev
									)
									return
								}
								await runtime.api.completeMailDraftReview(draftId, { decision: 'approved' })
								await loadConversation()
							}}
							onUndoSend={async (draftId) => {
								if (!runtime || runtime.isPreview) {
									setTimeline((prev) =>
										prev
											? {
													...prev,
													drafts: prev.drafts.map((d) => (d.id === draftId ? { ...d, status: 'draft' } : d))
												}
											: prev
									)
									return
								}
								await runtime.api.undoMailDraft(draftId)
								await loadConversation()
							}}
						/>
					) : undefined
				}
			>
				<FlashList
					className="flex-1"
					data={rows}
					keyExtractor={(row) => row.id}
					contentContainerClassName="p-4 gap-3 pb-6"
					ListHeaderComponent={
						timeline ? (
							<View className="gap-3 mb-2">
								<MobileMailActions
									conversation={timeline.conversation}
									currentUserId={engine.currentUserId}
									tags={tags}
									selectedTagIds={selectedTagIds}
									macros={macros}
									busy={busy}
									onToggleStatus={() => void handleToggleStatus()}
									onToggleAssign={() => void handleToggleAssign()}
									onAutoRoute={() => void handleAutoRoute()}
									onToggleTag={(tagId) => void handleToggleTag(tagId)}
									onRunMacro={(macroId) => void handleRunMacro(macroId)}
								/>
							</View>
						) : null
					}
					renderItem={({ item }) => (
						<Card
							className={`p-3.5 rounded-2xl border ${
								item.kind === 'note' ? 'border-warning/60 bg-warning/10' : 'border-border/60'
							}`}
						>
							<View className="flex-row items-center justify-between gap-2 mb-1">
								<View className="flex-row items-center gap-1.5">
									{item.kind === 'note' ? (
										<StickyNote size={13} color={colors.warning} />
									) : (
										<Mail size={13} color={colors.success} />
									)}
									<Text className="text-xs font-semibold text-foreground">{item.title}</Text>
								</View>
								{item.kind === 'note' ? (
									<Chip size="sm" variant="soft" color="warning">
										<Chip.Label>{t('mail.timeline.note')}</Chip.Label>
									</Chip>
								) : null}
							</View>
							<Text className="text-sm text-foreground">{item.body}</Text>
							<Text className="text-[11px] text-muted mt-1">{item.timestamp.slice(0, 16)}</Text>
						</Card>
					)}
					ListEmptyComponent={
						<EmptyStateCard
							icon={<Mail size={22} color={colors.muted} />}
							title={t('mobile.inbox.tab.mail')}
							description={t('mail.conv.select-hint')}
						/>
					}
				/>
			</Container>
		</>
	)
}
