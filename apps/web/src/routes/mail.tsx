import { createFileRoute } from '@tanstack/react-router'
import { MailWorkspace } from '@/features/mail/components/mail-workspace'

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
	return <MailWorkspace requestedConversationId={search.conversation} />
}
