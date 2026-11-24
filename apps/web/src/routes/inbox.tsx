import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkspace } from '@/lib/workspace'

const InboxView = lazy(() =>
	import('@/features/notifications/components/inbox-view').then((m) => ({ default: m.InboxView }))
)

export const Route = createFileRoute('/inbox')({
	component: InboxRoute
})

function InboxRoute() {
	const { api } = useWorkspace()
	return (
		<Suspense fallback={<Skeleton className="m-6 h-48 w-full" />}>
			<InboxView api={api} />
		</Suspense>
	)
}
