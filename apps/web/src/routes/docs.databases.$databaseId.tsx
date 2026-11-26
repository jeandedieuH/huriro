import { createFileRoute } from '@tanstack/react-router'
import { DatabaseWorkspace } from '@/features/databases/components/database-workspace'

export const Route = createFileRoute('/docs/databases/$databaseId')({
	component: DatabaseDetailRoute
})

function DatabaseDetailRoute() {
	const { databaseId } = Route.useParams()
	return (
		<main className="mx-auto w-full max-w-7xl p-4 md:p-6">
			<DatabaseWorkspace databaseId={databaseId} />
		</main>
	)
}
