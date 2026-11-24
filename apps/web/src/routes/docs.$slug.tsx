import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkspace } from '@/lib/workspace'

const DocsWorkspace = lazy(() =>
	import('@/features/docs/components/docs-workspace').then((m) => ({ default: m.DocsWorkspace }))
)

export const Route = createFileRoute('/docs/$slug')({
	component: DocsSlugRoute
})

function DocsSlugRoute() {
	const { slug } = Route.useParams()
	const { api, currentUserId, isPreview } = useWorkspace()
	const navigate = useNavigate()
	return (
		<Suspense fallback={<Skeleton className="m-6 h-48 w-full" />}>
			<DocsWorkspace
				api={api}
				currentUserId={currentUserId}
				isPreview={isPreview}
				activeSlug={slug}
				onSelectSlug={(nextSlug) => void navigate({ to: '/docs/$slug', params: { slug: nextSlug } })}
			/>
		</Suspense>
	)
}
