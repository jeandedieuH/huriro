import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkspace } from '@/lib/workspace'

const DocsWorkspace = lazy(() =>
	import('@/features/docs/components/docs-workspace').then((m) => ({ default: m.DocsWorkspace }))
)

export const Route = createFileRoute('/docs/')({
	component: DocsIndexRoute
})

function DocsIndexRoute() {
	const { api, currentUserId, isPreview } = useWorkspace()
	const navigate = useNavigate()
	return (
		<Suspense fallback={<Skeleton className="m-6 h-48 w-full" />}>
			<DocsWorkspace
				api={api}
				currentUserId={currentUserId}
				isPreview={isPreview}
				activeSlug={null}
				onSelectSlug={(slug) => void navigate({ to: '/docs/$slug', params: { slug } })}
			/>
		</Suspense>
	)
}
