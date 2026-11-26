import type { DocDatabasePropertyDto, DocDatabaseRowDto } from '@huriro/contracts'
import { activateI18n } from '@huriro/i18n'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { emptyCell } from './components/cell-editor'
import {
	DatabaseBoardView,
	DatabaseCalendarView,
	DatabaseTableView,
	DatabaseTimelineView
} from './components/database-views'
import { FormulaEditor } from './components/formula-editor'

activateI18n('en')

const WS = '0190a0b1-9a9a-7000-8000-00000000d001'
const DB = '0190a0b1-9a9a-7000-8000-00000000d002'
const USER = '0190a0b1-9a9a-7000-8000-00000000d003'
const NOW = '2026-01-01T00:00:00.000Z'

function id(n: number): string {
	return `0190a0b1-9a9a-7000-8000-${String(n).padStart(12, '0')}`
}

function property(
	n: number,
	name: string,
	propType: DocDatabasePropertyDto['propType']
): DocDatabasePropertyDto {
	return {
		id: id(n),
		workspaceId: WS,
		databaseId: DB,
		name,
		propType,
		config: {},
		position: String(n).padStart(4, '0'),
		createdAt: NOW,
		updatedAt: NOW,
		version: 1
	}
}

function row(n: number, title: string, cells: DocDatabaseRowDto['cells'] = {}): DocDatabaseRowDto {
	return {
		id: id(100 + n),
		workspaceId: WS,
		databaseId: DB,
		pageId: null,
		title,
		position: String(n).padStart(4, '0'),
		createdBy: USER,
		updatedBy: USER,
		archivedAt: null,
		createdAt: NOW,
		updatedAt: NOW,
		version: 1,
		cells
	}
}

const title = property(10, 'Name', 'title')
const status = property(11, 'Status', 'select')
const estimate = property(12, 'Estimate', 'number')
const due = property(13, 'Due', 'date')
const owner = property(14, 'Owner', 'person')
const properties = [title, status, estimate, due, owner]
const rows = [
	row(1, 'Alpha', {
		[status.id]: { ...emptyCell(), text: 'In progress' },
		[estimate.id]: { ...emptyCell(), number: 3 },
		[due.id]: { ...emptyCell(), dateStart: '2026-01-05', dateEnd: '2026-01-08' },
		[owner.id]: { ...emptyCell(), json: [{ id: USER, name: 'Ada Lovelace', type: 'person' }] }
	}),
	row(2, 'Beta', {
		[status.id]: { ...emptyCell(), text: 'Done' },
		[estimate.id]: { ...emptyCell(), number: 5 },
		[due.id]: { ...emptyCell(), dateStart: '2026-01-09', dateEnd: '2026-01-15' }
	})
]

const meta: Meta<typeof DatabaseTableView> = {
	title: 'Databases/M10 Views & Controls',
	component: DatabaseTableView
}
export default meta
type Story = StoryObj<typeof DatabaseTableView>

export const TableWithAggregations: Story = {
	args: {
		databaseId: DB,
		rows,
		properties,
		config: { aggregations: { [estimate.id]: 'sum' } },
		onCellCommit: () => {}
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		expect(await canvas.findByText('Owner')).toBeInTheDocument()
		expect(canvas.getByText('Sum: 8')).toBeInTheDocument()
		await userEvent.click(canvas.getByRole('button', { name: 'Move Status column right' }))
	}
}

export const BoardGroupedByStatus: Story = {
	render: () => (
		<DatabaseBoardView
			databaseId={DB}
			rows={rows}
			properties={properties}
			config={{ groupByPropertyId: status.id }}
			onCellCommit={() => {}}
		/>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		expect(await canvas.findByText('In progress')).toBeInTheDocument()
		expect(canvas.getByText('Done')).toBeInTheDocument()
	}
}

export const CalendarWeek: Story = {
	render: () => (
		<DatabaseCalendarView
			databaseId={DB}
			rows={rows}
			properties={properties}
			config={{ datePropertyId: due.id, calendarMode: 'week' }}
			onCellCommit={() => {}}
		/>
	)
}

export const TimelineWithZoom: Story = {
	render: () => (
		<DatabaseTimelineView
			databaseId={DB}
			rows={rows}
			properties={properties}
			config={{ datePropertyId: due.id }}
			onCellCommit={() => {}}
		/>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await userEvent.click(await canvas.findByRole('button', { name: /zoom in/i }))
		expect(canvas.getByText('150%')).toBeInTheDocument()
	}
}

export const FormulaPreview: Story = {
	render: () => (
		<FormulaEditor
			value='prop("Estimate") * 2'
			properties={properties}
			sampleRow={rows[0]}
			onChange={() => {}}
		/>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		expect(await canvas.findByText('Preview:')).toBeInTheDocument()
		expect(canvas.getByText('6')).toBeInTheDocument()
	}
}
