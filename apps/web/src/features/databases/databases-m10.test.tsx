import type { DocDatabasePropertyDto, DocDatabaseRowDto } from '@huriro/contracts'
import { activateI18n } from '@huriro/i18n'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { expectNoViolations } from '@/lib/test-setup'
import { emptyCell } from './components/cell-editor'
import { DatabaseTableView } from './components/database-views'
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

describe('M10 database UI', () => {
	it('renders every configured table property, footer aggregations, and column reorder controls', async () => {
		const title = property(10, 'Name', 'title')
		const estimate = property(11, 'Estimate', 'number')
		const extras = Array.from({ length: 8 }, (_, index) => property(20 + index, `Field ${index + 1}`, 'text'))
		const properties = [title, estimate, ...extras]
		const rows = [
			row(1, 'Alpha', { [estimate.id]: { ...emptyCell(), number: 3 } }),
			row(2, 'Beta', { [estimate.id]: { ...emptyCell(), number: 4 } })
		]
		const onConfigChange = vi.fn()
		const { container } = render(
			<DatabaseTableView
				databaseId={DB}
				rows={rows}
				properties={properties}
				config={{ aggregations: { [estimate.id]: 'sum' }, columnWidths: { [estimate.id]: 180 } }}
				onConfigChange={onConfigChange}
				onCellCommit={() => {}}
			/>
		)

		expect(screen.getByText('Field 8')).toBeInTheDocument()
		expect(screen.getByText('Sum: 7')).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Move Estimate column right' }))
		expect(onConfigChange).toHaveBeenCalledWith({
			propertyOrder: [title.id, extras[0]!.id, estimate.id, ...extras.slice(1).map((item) => item.id)]
		})
		await expectNoViolations(container)
	})

	it('shows a deterministic live formula preview against a sample row', () => {
		const estimate = property(11, 'Estimate', 'number')
		const sample = row(1, 'Alpha', { [estimate.id]: { ...emptyCell(), number: 3 } })
		render(
			<FormulaEditor
				value='prop("Estimate") * 2'
				properties={[estimate]}
				sampleRow={sample}
				onChange={() => {}}
			/>
		)
		expect(screen.getByText('Preview:')).toBeInTheDocument()
		expect(screen.getByText('6')).toBeInTheDocument()
	})
})
