import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { DatePicker } from './date-picker'

const meta: Meta<typeof DatePicker> = {
	title: 'UI/DatePicker',
	component: DatePicker,
	args: { value: '', onChange: fn() },
	decorators: [
		(Story) => (
			<div className="w-64">
				<Story />
			</div>
		)
	]
}
export default meta
type Story = StoryObj<typeof DatePicker>

export const Empty: Story = {}

export const Selected: Story = {
	args: { value: '2026-11-15' }
}

export const Disabled: Story = {
	args: { value: '2026-11-15', disabled: true }
}

export const SelectDate: Story = {
	args: { value: '2026-11-15' },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement)
		await userEvent.click(canvas.getByRole('button'))
		const grid = await within(document.body).findByRole('grid')
		await userEvent.click(within(grid).getByText('20'))
		await expect(args.onChange).toHaveBeenCalledWith('2026-11-20')
	}
}

export const ChangeYear: Story = {
	args: { value: '2026-11-15' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await userEvent.click(canvas.getByRole('button'))
		const yearTrigger = await within(document.body).findByRole('combobox', { name: /choose year/i })
		await userEvent.click(yearTrigger)
		await userEvent.click(await within(document.body).findByRole('option', { name: '2027' }))
		const updatedYearTrigger = await within(document.body).findByRole('combobox', { name: /choose year/i })
		await expect(updatedYearTrigger.textContent).toContain('2027')
	}
}

export const ClearDate: Story = {
	args: { value: '2026-11-15' },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement)
		await userEvent.click(canvas.getByRole('button'))
		await userEvent.click(await within(document.body).findByRole('button', { name: 'Clear' }))
		await expect(args.onChange).toHaveBeenCalledWith('')
	}
}
