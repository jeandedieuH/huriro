import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { Button } from './button'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

const meta: Meta<typeof Popover> = {
	title: 'UI/Popover',
	component: Popover
}
export default meta
type Story = StoryObj<typeof Popover>

export const Default: Story = {
	render: () => (
		<Popover>
			<PopoverTrigger asChild>
				<Button tone="outline">Open popover</Button>
			</PopoverTrigger>
			<PopoverContent aria-label="Example popover" className="w-64">
				<div className="space-y-1">
					<p className="text-sm font-medium">Popover title</p>
					<p className="text-xs text-muted-foreground">A compact floating surface for contextual actions.</p>
				</div>
			</PopoverContent>
		</Popover>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await userEvent.click(canvas.getByRole('button', { name: 'Open popover' }))
		await expect(await within(document.body).findByText('Popover title')).toBeTruthy()
	}
}
