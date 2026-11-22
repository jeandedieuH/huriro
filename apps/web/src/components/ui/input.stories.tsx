import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { Input } from './input'

const meta: Meta<typeof Input> = {
	title: 'UI/Input',
	component: Input,
	args: { placeholder: 'Type here' }
}
export default meta
type Story = StoryObj<typeof Input>

export const Default: Story = {}
export const Invalid: Story = { args: { invalid: true, defaultValue: 'bad@' } }
export const Disabled: Story = { args: { disabled: true } }
export const ReadOnly: Story = { args: { readOnly: true, defaultValue: 'locked' } }

export const Typing: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		const input = canvas.getByPlaceholderText('Type here')
		await userEvent.type(input, 'hello')
		await expect(input).toHaveValue('hello')
	}
}
