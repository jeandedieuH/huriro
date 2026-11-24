import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'

const ChatWorkspace = lazy(() =>
	import('@/features/chat/components/chat-workspace').then((m) => ({ default: m.ChatWorkspace }))
)

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
	return (
		<Suspense fallback={<Skeleton className="m-6 h-48 w-full" />}>
			<ChatWorkspace requestedChannelId={search.channel} highlightedMessageId={search.message} />
		</Suspense>
	)
}
