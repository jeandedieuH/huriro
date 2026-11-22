import { createFileRoute } from '@tanstack/react-router'
import { InboxView } from '@/features/notifications/components/inbox-view'
import { useWorkspace } from '@/lib/workspace'

export const Route = createFileRoute('/inbox')({
	component: InboxRoute
})

function InboxRoute() {
	const { api } = useWorkspace()
	return <InboxView api={api} />
}
