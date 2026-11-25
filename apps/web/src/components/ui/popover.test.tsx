import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoViolations } from '@/lib/test-setup'
import { Button } from './button'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

describe('Popover', () => {
	it('opens an accessibly named floating surface without axe violations', async () => {
		render(
			<Popover>
				<PopoverTrigger asChild>
					<Button tone="outline">Open popover</Button>
				</PopoverTrigger>
				<PopoverContent aria-label="Example popover">
					<p>Popover content</p>
				</PopoverContent>
			</Popover>
		)

		fireEvent.click(screen.getByRole('button', { name: 'Open popover' }))
		const dialog = await screen.findByRole('dialog', { name: 'Example popover' })
		expect(dialog).toHaveClass('huriro-popover')
		await expectNoViolations(dialog)
	})
})
