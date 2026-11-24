import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'

const MailWorkspace = lazy(() =>
	import('@/features/mail/components/mail-workspace').then((m) => ({ default: m.MailWorkspace }))
)

export interface MailSearchParams {
	readonly conversation?: string | undefined
}

export const Route = createFileRoute('/mail')({
	validateSearch: (search: Record<string, unknown>): MailSearchParams => ({
		...(typeof search['conversation'] === 'string' ? { conversation: search['conversation'] } : {})
	}),
	component: MailRoute
})

function MailRoute() {
	const search = Route.useSearch()
	return (
		<Suspense fallback={<Skeleton className="m-6 h-48 w-full" />}>
			<MailWorkspace requestedConversationId={search.conversation} />
		</Suspense>
	)
}
