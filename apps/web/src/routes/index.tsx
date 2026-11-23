import { createFileRoute } from '@tanstack/react-router'
import { HomeView } from '@/features/home/components/home-view'

export const Route = createFileRoute('/')({
	component: HomeRoute
})

function HomeRoute() {
	return <HomeView />
}
