import type { Meta, StoryObj } from '@storybook/react-vite'
import { EmptyState } from '@/components/ui/empty-state'
import { AppShell } from './app-shell'

const meta: Meta<typeof AppShell> = {
	title: 'Shell/AppShell',
	component: AppShell,
	parameters: { layout: 'fullscreen' },
	args: { activeNav: 'tasks', children: <EmptyState className="m-6" /> }
}
export default meta
type Story = StoryObj<typeof AppShell>

export const Light: Story = {}
export const Dark: Story = {
	decorators: [
		(Story) => (
			<div className="dark">
				<Story />
			</div>
		)
	]
}
