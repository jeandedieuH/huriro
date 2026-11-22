import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { DocsWorkspace } from '@/features/docs/components/docs-workspace'
import { useWorkspace } from '@/lib/workspace'

export const Route = createFileRoute('/docs/$slug')({
	component: DocsSlugRoute
})

function DocsSlugRoute() {
	const { slug } = Route.useParams()
	const { api, currentUserId, isPreview } = useWorkspace()
	const navigate = useNavigate()
	return (
		<DocsWorkspace
			api={api}
			currentUserId={currentUserId}
			isPreview={isPreview}
			activeSlug={slug}
			onSelectSlug={(nextSlug) => void navigate({ to: '/docs/$slug', params: { slug: nextSlug } })}
		/>
	)
}
