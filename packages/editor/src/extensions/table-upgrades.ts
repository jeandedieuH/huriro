import { Extension } from '@tiptap/core'
import { TableCell, TableHeader } from '@tiptap/extension-table'
import type { Node as PmNode } from '@tiptap/pm/model'

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
		}
	}
}

function cellText(row: PmNode, colIndex: number): string {
	if (colIndex < 0 || colIndex >= row.childCount) return ''
	return row.child(colIndex).textContent.trim()
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
						tableNode.forEach((row) => {
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
				}
		}
	}
})
