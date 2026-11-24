import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkspace } from '@/lib/workspace'

const TasksWorkspace = lazy(() =>
	import('@/features/tasks/components/tasks-workspace').then((m) => ({ default: m.TasksWorkspace }))
)

export const Route = createFileRoute('/tasks')({
	component: TasksRoute
})

function TasksRoute() {
	const { api, currentUserId } = useWorkspace()
	return (
		<Suspense fallback={<Skeleton className="m-6 h-48 w-full" />}>
			<TasksWorkspace api={api} currentUserId={currentUserId} />
		</Suspense>
	)
}
