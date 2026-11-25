import type { ProjectDto } from '@huriro/contracts'
import { activateI18n } from '@huriro/i18n'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
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

const meta: Meta = {
	title: 'Tasks/Planning dialogs',
	parameters: { layout: 'centered' }
}
export default meta

type Story = StoryObj

export const InitiativeCreate: Story = {
	render: () => (
		<InitiativeDialog
			open
			initiative={null}
			projects={[PROJECT]}
			onOpenChange={() => {}}
			onSubmit={async () => {}}
		/>
	),
	play: async () => {
		const body = within(document.body)
		await userEvent.type(await body.findByLabelText('Initiative name'), 'Reliability program')
		await userEvent.click(body.getByRole('checkbox'))
		await expect(body.getByRole('button', { name: 'Create initiative' })).toBeEnabled()
	}
}

export const MilestoneCreate: Story = {
	render: () => (
		<MilestoneDialog
			open
			milestone={null}
			projects={[PROJECT]}
			initialProjectId={PROJECT.id}
			onOpenChange={() => {}}
			onSubmit={async () => {}}
		/>
	),
	play: async () => {
		const body = within(document.body)
		await userEvent.type(await body.findByLabelText('Milestone name'), 'Beta readiness')
		await expect(body.getByRole('button', { name: 'Create milestone' })).toBeEnabled()
	}
}

export const ProjectUpdateCreate: Story = {
	render: () => (
		<ProjectUpdateDialog
			open
			projects={[PROJECT]}
			updates={[]}
			initialProjectId={PROJECT.id}
			onOpenChange={() => {}}
			onSubmit={async () => {}}
		/>
	),
	play: async () => {
		const body = within(document.body)
		await expect(await body.findByText('No project updates yet')).toBeInTheDocument()
	}
}
