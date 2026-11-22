import { t } from '@huriro/i18n'
import { createFileRoute } from '@tanstack/react-router'
import { EmptyState } from '@/components/ui/empty-state'

export const Route = createFileRoute('/chat')({
	component: ChatRoute
})

function ChatRoute() {
	return <EmptyState className="m-6" title={t('nav.chat')} hint={t('shell.placeholder-module')} />
}
