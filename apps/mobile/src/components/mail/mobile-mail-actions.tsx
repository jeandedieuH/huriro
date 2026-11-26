import type { MailConversationDto, MailMacroDto, MailTagDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Button, Card, Chip } from 'heroui-native'
import { CheckCircle2, RotateCcw, Shuffle, Tag, UserCheck, Zap } from 'lucide-react-native'
import { ScrollView, Text, View } from 'react-native'

/**
 * Mobile mail triage strip: conversation open/closed status, assignment/auto-routing,
 * conversation tags, and one-tap macros.
 */
export function MobileMailActions({
	conversation,
	currentUserId,
	tags,
	selectedTagIds,
	macros,
	busy,
	onToggleStatus,
	onToggleAssign,
	onAutoRoute,
	onToggleTag,
	onRunMacro
}: {
	readonly conversation: MailConversationDto
	readonly currentUserId: string
	readonly tags: readonly MailTagDto[]
	readonly selectedTagIds: readonly string[]
	readonly macros: readonly MailMacroDto[]
	readonly busy?: boolean
	readonly onToggleStatus: () => void
	readonly onToggleAssign: () => void
	readonly onAutoRoute: () => void
	readonly onToggleTag: (tagId: string) => void
	readonly onRunMacro: (macroId: string) => void
}) {
	const isClosed = conversation.status === 'closed'
	const assignedToMe = conversation.assigneeId === currentUserId

	return (
		<Card className="p-3.5 rounded-2xl border border-default-soft-hover gap-3">
			<View className="flex-row flex-wrap items-center gap-2">
				<Button
					size="sm"
					variant={isClosed ? 'secondary' : 'primary'}
					isDisabled={Boolean(busy)}
					onPress={onToggleStatus}
				>
					{isClosed ? <RotateCcw size={13} color="#18181b" /> : <CheckCircle2 size={13} color="#ffffff" />}
					<Button.Label>{isClosed ? t('mail.action.reopen') : t('mail.action.close')}</Button.Label>
				</Button>
				<Button size="sm" variant="secondary" isDisabled={Boolean(busy)} onPress={onToggleAssign}>
					<UserCheck size={13} color="#18181b" />
					<Button.Label>
						{assignedToMe ? t('mail.action.unassign') : t('mail.action.assign-to-me')}
					</Button.Label>
				</Button>
				<Button size="sm" variant="secondary" isDisabled={Boolean(busy)} onPress={onAutoRoute}>
					<Shuffle size={13} color="#18181b" />
					<Button.Label>{t('mail.route.action')}</Button.Label>
				</Button>
			</View>

			{tags.length > 0 ? (
				<View className="gap-1.5">
					<View className="flex-row items-center gap-1.5">
						<Tag size={12} color="#71717a" />
						<Text className="text-[11px] font-semibold uppercase text-muted">{t('mail.tags.title')}</Text>
					</View>
					<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5">
						{tags.map((tag) => {
							const active = selectedTagIds.includes(tag.id)
							return (
								<Chip
									key={tag.id}
									size="sm"
									variant={active ? 'primary' : 'soft'}
									color={active ? 'accent' : 'default'}
									onPress={() => onToggleTag(tag.id)}
								>
									<Chip.Label>{tag.name}</Chip.Label>
								</Chip>
							)
						})}
					</ScrollView>
				</View>
			) : null}

			{macros.length > 0 ? (
				<View className="gap-1.5">
					<View className="flex-row items-center gap-1.5">
						<Zap size={12} color="#71717a" />
						<Text className="text-[11px] font-semibold uppercase text-muted">{t('mail.macros.title')}</Text>
					</View>
					<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5">
						{macros.map((macro) => (
							<Chip
								key={macro.id}
								size="sm"
								variant="soft"
								color="default"
								onPress={() => onRunMacro(macro.id)}
							>
								<Chip.Label>{macro.name}</Chip.Label>
							</Chip>
						))}
					</ScrollView>
				</View>
			) : null}
		</Card>
	)
}
