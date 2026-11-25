import { t } from '@huriro/i18n'
import { useEffect, useState } from 'react'
import { useChatStore } from '../store/chat-store'

export function TypingIndicator({
	channelId,
	currentUserId,
	memberNamesById
}: {
	readonly channelId: string
	readonly currentUserId: string
	readonly memberNamesById: ReadonlyMap<string, string>
}) {
	const rawTyping = useChatStore((s) => s.typingByChannel[channelId])
	const [now, setNow] = useState(() => Date.now())

	useEffect(() => {
		if (!rawTyping) return
		setNow(Date.now())
		const id = setInterval(() => setNow(Date.now()), 1_000)
		return () => clearInterval(id)
	}, [rawTyping])

	const activeIds = rawTyping
		? Object.entries(rawTyping)
				.filter(([uid, until]) => uid !== currentUserId && until > now)
				.map(([uid]) => uid)
		: []

	if (activeIds.length === 0) return <div className="h-5" />

	const soleTyperId = activeIds.length === 1 ? activeIds[0] : undefined
	const label = soleTyperId
		? t('chat.typing.one', { name: memberNamesById.get(soleTyperId) ?? 'Someone' })
		: t('chat.typing.many')

	return (
		<p role="status" aria-live="polite" className="h-5 text-xs text-muted-foreground">
			{label}
		</p>
	)
}
