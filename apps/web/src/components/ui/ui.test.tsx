import { activateI18n } from '@huriro/i18n'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoViolations } from '@/lib/test-setup'
import { Badge } from './badge'
import { Button } from './button'
import { EmptyState } from './empty-state'
import { ErrorState } from './error-state'
import { Input } from './input'
import { Kbd } from './kbd'

activateI18n('en')

describe('ui components', () => {
	it('button renders all tones without axe violations', async () => {
		const { container } = render(
			<div>
				<Button>Default</Button>
				<Button tone="destructive">Destructive</Button>
				<Button tone="outline" disabled>
					Disabled
				</Button>
			</div>
		)
		await expectNoViolations(container)
	})

	it('input marks invalid state accessibly', () => {
		render(<Input invalid aria-label="email" />)
		expect(screen.getByLabelText('email')).toHaveAttribute('aria-invalid', 'true')
	})

	it('empty/error states provide accessible status text', async () => {
		const { container } = render(
			<div>
				<EmptyState />
				<ErrorState message="fail" />
				<Badge tone="success">ok</Badge>
				<Kbd>Esc</Kbd>
			</div>
		)
		expect(screen.getByRole('alert')).toBeInTheDocument()
		await expectNoViolations(container)
	})
})
