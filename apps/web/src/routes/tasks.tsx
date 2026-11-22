import { createFileRoute } from '@tanstack/react-router'
import { TasksWorkspace } from '@/features/tasks/components/tasks-workspace'
import { useWorkspace } from '@/lib/workspace'

export const Route = createFileRoute('/tasks')({
	component: TasksRoute
})

function TasksRoute() {
	const { api, currentUserId } = useWorkspace()
	return <TasksWorkspace api={api} currentUserId={currentUserId} />
}
