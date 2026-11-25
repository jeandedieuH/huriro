import type { ProjectDto } from '@huriro/contracts'
import { activateI18n } from '@huriro/i18n'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { expectNoViolations } from '@/lib/test-setup'
import { InitiativeDialog, MilestoneDialog, ProjectUpdateDialog } from './planning-dialogs'

activateI18n('en')

const PROJECT: ProjectDto = {
	id: '0190a0b1-0000-7000-8000-000000000201',
	workspaceId: '0190a0b1-0000-7000-8000-000000000001',
	key: 'ENG',
	name: 'Engineering',
	description: '',
	visibility: 'workspace',
	position: 'V',
	archivedAt: null,
	triageEnabled: false,
	cycleEnabled: false,
	cycleDurationDays: 14,
	cycleCooldownDays: 0,
	cycleAutoRolloverMode: 'next_cycle',
	cycleStartWeekday: 1,
	createdBy: '0190a0b1-0000-7000-8000-000000000002',
	createdAt: '2026-11-22T00:00:00Z',
	updatedAt: '2026-11-22T00:00:00Z',
	version: 1
}

describe('planning dialogs', () => {
	it('creates an initiative with linked projects and passes axe', async () => {
		const onSubmit = vi.fn(async () => {})
		const { baseElement } = render(
			<InitiativeDialog
				open
				initiative={null}
				projects={[PROJECT]}
				onOpenChange={() => {}}
				onSubmit={onSubmit}
			/>
		)

		fireEvent.change(screen.getByLabelText('Initiative name'), { target: { value: 'Reliability' } })
		fireEvent.click(screen.getByRole('checkbox'))
		fireEvent.click(screen.getByRole('button', { name: 'Create initiative' }))

		await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
		expect(onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Reliability',
				projectIds: [PROJECT.id],
				health: 'on_track'
			}),
			undefined
		)
		await expectNoViolations(baseElement)
	})

	it('renders milestone and project update dialogs accessibly', async () => {
		const { baseElement } = render(
			<div>
				<MilestoneDialog
					open
					milestone={null}
					projects={[PROJECT]}
					initialProjectId={PROJECT.id}
					onOpenChange={() => {}}
					onSubmit={async () => {}}
				/>
				<ProjectUpdateDialog
					open
					projects={[PROJECT]}
					updates={[]}
					initialProjectId={PROJECT.id}
					onOpenChange={() => {}}
					onSubmit={async () => {}}
				/>
			</div>
		)
		expect(screen.getByText('New milestone')).toBeInTheDocument()
		expect(screen.getByText('New project update')).toBeInTheDocument()
		expect(screen.getByText('No project updates yet')).toBeInTheDocument()
		await expectNoViolations(baseElement)
	})
})
