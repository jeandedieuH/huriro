import { createFileRoute } from '@tanstack/react-router'
import { DatabaseHome } from '@/features/databases/components/database-home'

export const Route = createFileRoute('/docs/databases/')({
	component: DatabaseHome
})
