import { activateI18n } from '@huriro/i18n'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { expectNoViolations } from '@/lib/test-setup'
import { DatePicker, formatDatePickerValue, parseDatePickerValue } from './date-picker'
import { Dialog, DialogContent, DialogTitle } from './dialog'

activateI18n('en')

function ControlledDatePicker({
	initialValue,
	onValueChange
}: {
	initialValue: string
	onValueChange?: (value: string) => void
}) {
	const [value, setValue] = useState(initialValue)
	return (
		<div>
			<label htmlFor="test-date">Expiration</label>
			<DatePicker
				id="test-date"
				name="test-date"
				value={value}
				onChange={(nextValue) => {
					setValue(nextValue)
					onValueChange?.(nextValue)
				}}
			/>
		</div>
	)
}

describe('DatePicker', () => {
	it('parses and formats calendar dates without UTC day drift', () => {
		const parsed = parseDatePickerValue('2026-11-20')
		expect(parsed?.getFullYear()).toBe(2026)
		expect(parsed?.getMonth()).toBe(10)
		expect(parsed?.getDate()).toBe(20)
		expect(parsed ? formatDatePickerValue(parsed) : '').toBe('2026-11-20')
		expect(parseDatePickerValue('2026-02-31')).toBeUndefined()
		expect(parseDatePickerValue('not-a-date')).toBeUndefined()
	})

	it('selects a calendar day as a yyyy-mm-dd value', async () => {
		const onValueChange = vi.fn()
		render(<ControlledDatePicker initialValue="2026-11-15" onValueChange={onValueChange} />)

		fireEvent.click(screen.getByLabelText('Expiration'))
		const grid = await screen.findByRole('grid')
		expect(document.activeElement).toHaveTextContent('15')
		if (document.activeElement) fireEvent.keyDown(document.activeElement, { key: 'ArrowRight' })
		expect(document.activeElement).toHaveTextContent('16')
		fireEvent.click(within(grid).getByText('20'))

		expect(onValueChange).toHaveBeenLastCalledWith('2026-11-20')
	})

	it('uses a styled listbox to change the calendar year without closing the date popover', async () => {
		render(<ControlledDatePicker initialValue="2026-11-15" />)

		fireEvent.click(screen.getByLabelText('Expiration'))
		const yearTrigger = await screen.findByRole('combobox', { name: /choose year/i })
		expect(yearTrigger).toHaveTextContent('2026')

		fireEvent.pointerDown(yearTrigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
		const listbox = await screen.findByRole('listbox')
		expect(listbox).toHaveClass('max-h-64')
		await expectNoViolations(listbox)
		fireEvent.click(await screen.findByRole('option', { name: '2027' }))

		expect(await screen.findByRole('combobox', { name: /choose year/i })).toHaveTextContent('2027')
		expect(screen.getByRole('grid')).toBeInTheDocument()
	})

	it('uses a styled listbox to change the calendar month', async () => {
		render(<ControlledDatePicker initialValue="2026-11-15" />)
		fireEvent.click(screen.getByLabelText('Expiration'))
		const monthTrigger = await screen.findByRole('combobox', { name: /choose month/i })
		expect(monthTrigger).toHaveTextContent('Nov')

		fireEvent.pointerDown(monthTrigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
		fireEvent.click(await screen.findByRole('option', { name: 'Dec' }))

		expect(await screen.findByRole('combobox', { name: /choose month/i })).toHaveTextContent('Dec')
		expect(screen.getByRole('grid')).toBeInTheDocument()
	})

	it('clears the selected value from the footer action', async () => {
		const onValueChange = vi.fn()
		render(<ControlledDatePicker initialValue="2026-11-15" onValueChange={onValueChange} />)

		fireEvent.click(screen.getByLabelText('Expiration'))
		fireEvent.click(await screen.findByRole('button', { name: 'Clear' }))

		expect(onValueChange).toHaveBeenLastCalledWith('')
	})

	it('opens and selects dates from inside a modal dialog', async () => {
		const onValueChange = vi.fn()
		render(
			<Dialog open>
				<DialogContent>
					<DialogTitle>Publish</DialogTitle>
					<ControlledDatePicker initialValue="2026-11-15" onValueChange={onValueChange} />
				</DialogContent>
			</Dialog>
		)

		fireEvent.click(screen.getByLabelText('Expiration'))
		const grid = await screen.findByRole('grid')
		fireEvent.click(within(grid).getByText('20'))

		expect(onValueChange).toHaveBeenLastCalledWith('2026-11-20')
	})

	it('has no axe violations when the calendar popover is open', async () => {
		render(<ControlledDatePicker initialValue="2026-11-15" />)
		fireEvent.click(screen.getByLabelText('Expiration'))
		await screen.findByRole('grid')
		await expectNoViolations(screen.getByRole('dialog'))
	})
})
