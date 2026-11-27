import type { IssueDto } from '@huriro/contracts'
import { Card, Chip, type ChipColor } from 'heroui-native'
import { ChevronRight } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { useHuriroColors } from '../../lib/theme'

const PRIORITY_META: Record<number, { readonly label: string; readonly color: ChipColor }> = {
	0: { label: 'None', color: 'default' },
	1: { label: 'Urgent', color: 'danger' },
	2: { label: 'High', color: 'warning' },
	3: { label: 'Medium', color: 'accent' },
	4: { label: 'Low', color: 'default' }
}

export function IssueCard({
	issue,
	statusName,
	onPress
}: {
	readonly issue: IssueDto
	readonly statusName?: string | undefined
	readonly onPress: (issue: IssueDto) => void
}) {
	const colors = useHuriroColors()
	const meta = PRIORITY_META[issue.priority] ?? { label: 'Medium', color: 'accent' as const }

	return (
		<Pressable onPress={() => onPress(issue)} accessibilityRole="button">
			<Card className="mb-3 p-4 rounded-2xl border border-border/60">
				<View className="flex-row items-center justify-between gap-2">
					<View className="flex-row items-center gap-2">
						<Text className="text-xs font-mono font-semibold text-muted">{issue.identifier}</Text>
						{statusName ? (
							<Chip size="sm" variant="secondary" color="default">
								<Chip.Label>{statusName}</Chip.Label>
							</Chip>
						) : null}
					</View>
					<View className="flex-row items-center gap-1.5">
						<Chip size="sm" variant="soft" color={meta.color}>
							<Chip.Label>{meta.label}</Chip.Label>
						</Chip>
						<ChevronRight size={15} color={colors.muted} />
					</View>
				</View>

				<Card.Title className="text-sm font-semibold mt-2" numberOfLines={2}>
					{issue.title}
				</Card.Title>

				{issue.descriptionText ? (
					<Card.Description className="text-xs mt-1" numberOfLines={2}>
						{issue.descriptionText}
					</Card.Description>
				) : null}
			</Card>
		</Pressable>
	)
}
