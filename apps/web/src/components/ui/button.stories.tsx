import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { Button } from './button'

const meta: Meta<typeof Button> = {
	title: 'UI/Button',
	component: Button,
	args: { children: 'Button', onClick: fn() }
}
export default meta
type Story = StoryObj<typeof Button>

export const Tones: Story = {
	render: (args) => (
		<div className="flex flex-wrap gap-2">
			<Button {...args} tone="default">
				Default
			</Button>
			<Button {...args} tone="secondary">
				Secondary
			</Button>
			<Button {...args} tone="outline">
				Outline
			</Button>
			<Button {...args} tone="ghost">
				Ghost
			</Button>
			<Button {...args} tone="destructive">
				Destructive
			</Button>
			<Button {...args} tone="link">
				Link
			</Button>
		</div>
	)
}

export const Sizes: Story = {
	render: (args) => (
		<div className="flex items-center gap-2">
			<Button {...args} size="sm">
				Small
			</Button>
			<Button {...args} size="default">
				Default
			</Button>
			<Button {...args} size="lg">
				Large
			</Button>
		</div>
	)
}

export const Disabled: Story = { args: { disabled: true } }
export const Loading: Story = { args: { loading: true } }

export const Clickable: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement)
		await userEvent.click(canvas.getByRole('button'))
		await expect(args.onClick).toHaveBeenCalled()
	}
}
