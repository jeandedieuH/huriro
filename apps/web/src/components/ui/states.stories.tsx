import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './button'
import { EmptyState } from './empty-state'
import { ErrorState } from './error-state'

const meta: Meta<typeof EmptyState> = {
	title: 'UI/States',
	component: EmptyState
}
export default meta
type Story = StoryObj<typeof EmptyState>

export const Empty: Story = {
	args: {
		action: (
			<Button tone="outline" size="sm">
				New
			</Button>
		)
	}
}

export const Failure: Story = {
	render: () => (
		<ErrorState
			message="The request failed."
			action={
				<Button tone="outline" size="sm">
					Retry
				</Button>
			}
		/>
	)
}
