import { createFileRoute } from '@tanstack/react-router'
import { ChatWorkspace } from '@/features/chat/components/chat-workspace'

export interface ChatSearchParams {
	readonly channel?: string | undefined
	readonly message?: string | undefined
}

export const Route = createFileRoute('/chat')({
	validateSearch: (search: Record<string, unknown>): ChatSearchParams => ({
		...(typeof search['channel'] === 'string' ? { channel: search['channel'] } : {}),
		...(typeof search['message'] === 'string' ? { message: search['message'] } : {})
	}),
	component: ChatRoute
})

function ChatRoute() {
	const search = Route.useSearch()
	return <ChatWorkspace requestedChannelId={search.channel} highlightedMessageId={search.message} />
}
