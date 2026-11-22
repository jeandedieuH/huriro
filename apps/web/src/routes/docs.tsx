import { t } from '@huriro/i18n'
import { createFileRoute } from '@tanstack/react-router'
import { EmptyState } from '@/components/ui/empty-state'

export const Route = createFileRoute('/docs')({
	component: DocsRoute
})

function DocsRoute() {
	return <EmptyState className="m-6" title={t('nav.docs')} hint={t('shell.placeholder-module')} />
}
