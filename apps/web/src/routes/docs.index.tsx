import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { DocsWorkspace } from '@/features/docs/components/docs-workspace'
import { useWorkspace } from '@/lib/workspace'

export const Route = createFileRoute('/docs/')({
	component: DocsIndexRoute
})

function DocsIndexRoute() {
	const { api, currentUserId, isPreview } = useWorkspace()
	const navigate = useNavigate()
	return (
		<DocsWorkspace
			api={api}
			currentUserId={currentUserId}
			isPreview={isPreview}
			activeSlug={null}
			onSelectSlug={(slug) => void navigate({ to: '/docs/$slug', params: { slug } })}
		/>
	)
}
