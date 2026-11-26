import { Extension } from '@tiptap/core'
import { TableCell, TableHeader } from '@tiptap/extension-table'
import type { Node as PmNode } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'

export const TABLE_CELL_TONES = ['default', 'muted', 'info', 'success', 'warning', 'danger'] as const
export type TableCellTone = (typeof TABLE_CELL_TONES)[number]

function isCellTone(value: unknown): value is TableCellTone {
	return typeof value === 'string' && (TABLE_CELL_TONES as readonly string[]).includes(value)
}

const cellBackgroundAttribute = {
	backgroundTone: {
		default: 'default',
		parseHTML: (el: HTMLElement) => {
			const raw = el.getAttribute('data-cell-tone')
			return isCellTone(raw) ? raw : 'default'
		},
		renderHTML: (attrs: Record<string, unknown>) => {
			const tone = attrs['backgroundTone']
			return isCellTone(tone) && tone !== 'default' ? { 'data-cell-tone': tone } : {}
		}
	}
}

export const HuriroTableCell = TableCell.extend({
	addAttributes() {
		return {
			...this.parent?.(),
			...cellBackgroundAttribute
		}
	}
})

export const HuriroTableHeader = TableHeader.extend({
	addAttributes() {
		return {
			...this.parent?.(),
			...cellBackgroundAttribute
		}
	}
})

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		tableUpgrades: {
			setCellBackgroundTone: (tone: TableCellTone) => ReturnType
			sortTableByColumn: (columnIndex: number, direction?: 'asc' | 'desc') => ReturnType
			moveCurrentTableRow: (direction: -1 | 1) => ReturnType
			moveCurrentTableColumn: (direction: -1 | 1) => ReturnType
		}
	}
}

function cellText(row: PmNode, colIndex: number): string {
	if (colIndex < 0 || colIndex >= row.childCount) return ''
	return row.child(colIndex).textContent.trim()
}

function findTableParts(state: EditorState) {
	const { $from } = state.selection
	let tableDepth = -1
	let rowDepth = -1
	let cellDepth = -1
	for (let d = $from.depth; d > 0; d--) {
		const name = $from.node(d).type.name
		if ((name === 'tableCell' || name === 'tableHeader') && cellDepth === -1) cellDepth = d
		if (name === 'tableRow' && rowDepth === -1) rowDepth = d
		if (name === 'table') {
			tableDepth = d
			break
		}
	}
	if (tableDepth < 0 || rowDepth < 0 || cellDepth < 0) return null
	return { $from, tableDepth, rowDepth, cellDepth }
}

export const TableUpgradesExtension = Extension.create({
	name: 'tableUpgrades',

	addCommands() {
		return {
			setCellBackgroundTone:
				(tone) =>
				({ state, dispatch }) => {
					const { $from } = state.selection
					for (let d = $from.depth; d > 0; d--) {
						const node = $from.node(d)
						if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
							if (dispatch) {
								dispatch(
									state.tr.setNodeMarkup($from.before(d), undefined, {
										...node.attrs,
										backgroundTone: tone
									})
								)
							}
							return true
						}
					}
					return false
				},
			sortTableByColumn:
				(columnIndex, direction = 'asc') =>
				({ state, dispatch }) => {
					const { $from } = state.selection
					for (let d = $from.depth; d > 0; d--) {
						const tableNode = $from.node(d)
						if (tableNode.type.name !== 'table') continue
						if (tableNode.childCount <= 1) return false

						const rows: PmNode[] = []
						tableNode.forEach((row: PmNode) => {
							rows.push(row)
						})

						const firstRow = rows[0]
						const firstIsHeader =
							firstRow !== undefined &&
							firstRow.childCount > 0 &&
							firstRow.child(0).type.name === 'tableHeader'
						const headerRows = firstIsHeader && firstRow ? [firstRow] : []
						const bodyRows = firstIsHeader ? rows.slice(1) : rows
						if (bodyRows.length <= 1) return false

						const sorted = [...bodyRows].sort((a, b) => {
							const av = cellText(a, columnIndex)
							const bv = cellText(b, columnIndex)
							const an = Number(av)
							const bn = Number(bv)
							const cmp =
								av !== '' && bv !== '' && Number.isFinite(an) && Number.isFinite(bn)
									? an - bn
									: av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' })
							return direction === 'asc' ? cmp : -cmp
						})

						if (dispatch) {
							const tablePos = $from.before(d)
							const newTable = tableNode.type.create(tableNode.attrs, [...headerRows, ...sorted])
							dispatch(state.tr.replaceWith(tablePos, tablePos + tableNode.nodeSize, newTable))
						}
						return true
					}
					return false
				},
			moveCurrentTableRow:
				(direction) =>
				({ state, dispatch }) => {
					const parts = findTableParts(state)
					if (!parts) return false
					const { $from, tableDepth, rowDepth } = parts
					const tableNode = $from.node(tableDepth)
					const rowNode = $from.node(rowDepth)
					const rowIndex = $from.index(tableDepth)
					const nextIndex = rowIndex + direction
					if (nextIndex < 0 || nextIndex >= tableNode.childCount) return false
					if (dispatch) {
						const rowPos = $from.before(rowDepth)
						const tr = state.tr
						tr.delete(rowPos, rowPos + rowNode.nodeSize)
						const neighbor = tableNode.child(nextIndex)
						const insertPos = direction === -1 ? rowPos - neighbor.nodeSize : rowPos + neighbor.nodeSize
						tr.insert(insertPos, rowNode)
						dispatch(tr.scrollIntoView())
					}
					return true
				},
			moveCurrentTableColumn:
				(direction) =>
				({ state, dispatch }) => {
					const parts = findTableParts(state)
					if (!parts) return false
					const { $from, tableDepth, rowDepth } = parts
					const tableNode = $from.node(tableDepth)
					const colIndex = $from.index(rowDepth)
					const nextIndex = colIndex + direction
					if (nextIndex < 0) return false
					const rows: PmNode[] = []
					let supported = true
					tableNode.forEach((row: PmNode) => {
						if (nextIndex >= row.childCount) supported = false
						row.forEach((cell: PmNode) => {
							if (Number(cell.attrs['colspan'] ?? 1) !== 1 || Number(cell.attrs['rowspan'] ?? 1) !== 1) {
								supported = false
							}
						})
						rows.push(row)
					})
					if (!supported) return false
					if (dispatch) {
						const movedRows = rows.map((row) => {
							const cells: PmNode[] = []
							row.forEach((cell: PmNode) => {
								cells.push(cell)
							})
							const temp = cells[colIndex]
							cells[colIndex] = cells[nextIndex] as PmNode
							cells[nextIndex] = temp as PmNode
							return row.type.create(row.attrs, cells)
						})
						const tablePos = $from.before(tableDepth)
						const nextTable = tableNode.type.create(tableNode.attrs, movedRows)
						const tr = state.tr.replaceWith(tablePos, tablePos + tableNode.nodeSize, nextTable)
						dispatch(tr.scrollIntoView())
					}
					return true
				}
		}
	}
})
