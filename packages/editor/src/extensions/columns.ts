import { mergeAttributes, Node } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

export const MIN_COLUMNS = 2
export const MAX_COLUMNS = 4
export const MIN_COLUMN_WIDTH_PCT = 15

export function normalizeColumnWidths(count: number, raw?: readonly number[] | null): number[] {
	const safeCount = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, count))
	if (!raw || raw.length !== safeCount) {
		const base = Math.floor((100 / safeCount) * 100) / 100
		const arr = Array.from({ length: safeCount }, () => base)
		const sum = arr.reduce((a, b) => a + b, 0)
		arr[arr.length - 1] = Number(((arr[arr.length - 1] ?? 0) + (100 - sum)).toFixed(2))
		return arr
	}
	const result = raw.map((w) => (Number.isFinite(w) ? Math.max(MIN_COLUMN_WIDTH_PCT, w) : 100 / safeCount))
	const frozen = new Array<boolean>(safeCount).fill(false)
	for (let iter = 0; iter < safeCount; iter++) {
		let frozenSum = 0
		let freeSum = 0
		for (let i = 0; i < safeCount; i++) {
			if (frozen[i]) frozenSum += result[i] ?? 0
			else freeSum += result[i] ?? 0
		}
		const remaining = Math.max(0, 100 - frozenSum)
		if (freeSum <= 0) break
		let changed = false
		for (let i = 0; i < safeCount; i++) {
			if (frozen[i]) continue
			const scaled = ((result[i] ?? 0) / freeSum) * remaining
			if (scaled < MIN_COLUMN_WIDTH_PCT) {
				result[i] = MIN_COLUMN_WIDTH_PCT
				frozen[i] = true
				changed = true
			}
		}
		if (!changed) {
			for (let i = 0; i < safeCount; i++) {
				if (!frozen[i]) result[i] = ((result[i] ?? 0) / freeSum) * remaining
			}
			break
		}
	}
	const rounded = result.map((w) => Math.max(MIN_COLUMN_WIDTH_PCT, Number(w.toFixed(2))))
	const roundedSum = rounded.reduce((a, b) => a + b, 0)
	const diff = Number((100 - roundedSum).toFixed(2))
	if (diff !== 0) {
		let maxIdx = 0
		for (let i = 1; i < rounded.length; i++) {
			if ((rounded[i] ?? 0) > (rounded[maxIdx] ?? 0)) maxIdx = i
		}
		rounded[maxIdx] = Number(((rounded[maxIdx] ?? 0) + diff).toFixed(2))
	}
	return rounded
}

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		columns: {
			setColumns: (count?: number) => ReturnType
			setColumnWidths: (widths: readonly number[]) => ReturnType
			unwrapColumns: () => ReturnType
			moveFocusToAdjacentColumn: (direction: -1 | 1) => ReturnType
			moveBlockToColumnSide: (sourcePos: number, targetPos: number, side: 'left' | 'right') => ReturnType
		}
	}
}

export const ColumnExtension = Node.create({
	name: 'column',
	content: 'block+',
	defining: true,
	isolating: true,

	parseHTML() {
		return [{ tag: 'div[data-column]' }]
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', mergeAttributes(HTMLAttributes, { 'data-column': 'true' }), 0]
	}
})

export const ColumnsExtension = Node.create({
	name: 'columns',
	group: 'block',
	content: 'column{2,4}',
	defining: true,
	isolating: true,
	draggable: true,

	addAttributes() {
		return {
			widths: {
				default: [50, 50],
				parseHTML: (el) => {
					const raw = el.getAttribute('data-column-widths')
					if (!raw) return [50, 50]
					try {
						const parsed = JSON.parse(raw)
						if (Array.isArray(parsed)) {
							return normalizeColumnWidths(parsed.length, parsed.map(Number))
						}
					} catch {
						// fallback below
					}
					return [50, 50]
				},
				renderHTML: (attrs) => {
					const widths = Array.isArray(attrs['widths']) ? (attrs['widths'] as number[]) : [50, 50]
					return {
						'data-column-widths': JSON.stringify(widths),
						style: `--huriro-columns-template: ${widths.map((w) => `${w}%`).join(' ')}`
					}
				}
			}
		}
	},

	parseHTML() {
		return [{ tag: 'div[data-columns]' }]
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', mergeAttributes(HTMLAttributes, { 'data-columns': 'true' }), 0]
	},

	addNodeView() {
		return ({ node, editor, view, getPos, HTMLAttributes }) => {
			const dom = document.createElement('div')
			for (const [k, v] of Object.entries(HTMLAttributes)) {
				dom.setAttribute(k, String(v))
			}
			dom.setAttribute('data-columns', 'true')

			const controlsBar = document.createElement('div')
			controlsBar.setAttribute('data-columns-controls', 'true')
			controlsBar.contentEditable = 'false'

			const content = document.createElement('div')
			content.setAttribute('data-columns-grid', 'true')

			dom.append(controlsBar, content)

			const applyWidths = (widths: number[]) => {
				const normalized = normalizeColumnWidths(node.childCount || widths.length, widths)
				content.style.gridTemplateColumns = normalized.map((w) => `${w}%`).join(' ')
				controlsBar.innerHTML = ''
				for (let i = 0; i < normalized.length - 1; i++) {
					const sep = document.createElement('button')
					sep.type = 'button'
					sep.setAttribute('role', 'separator')
					sep.setAttribute('aria-orientation', 'vertical')
					sep.setAttribute('aria-label', `Resize column ${i + 1} and ${i + 2}`)
					sep.setAttribute('aria-valuemin', String(MIN_COLUMN_WIDTH_PCT))
					sep.setAttribute('aria-valuemax', String(100 - MIN_COLUMN_WIDTH_PCT))
					sep.setAttribute('aria-valuenow', String(Math.round(normalized[i] ?? 50)))
					sep.setAttribute('data-column-resize-handle', String(i))
					sep.disabled = !editor.isEditable

					const commitDelta = (deltaPct: number) => {
						if (!editor.isEditable) return
						const pos = getPos()
						if (typeof pos !== 'number') return
						const currentWidths = normalizeColumnWidths(
							node.childCount,
							Array.isArray(node.attrs['widths']) ? (node.attrs['widths'] as number[]) : null
						)
						const left = currentWidths[i] ?? 50
						const right = currentWidths[i + 1] ?? 50
						const nextLeft = Math.max(
							MIN_COLUMN_WIDTH_PCT,
							Math.min(left + right - MIN_COLUMN_WIDTH_PCT, left + deltaPct)
						)
						const nextRight = Number((left + right - nextLeft).toFixed(2))
						const next = [...currentWidths]
						next[i] = Number(nextLeft.toFixed(2))
						next[i + 1] = nextRight
						view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, widths: next }))
					}

					sep.addEventListener('keydown', (ev) => {
						if (ev.key === 'ArrowLeft') {
							ev.preventDefault()
							commitDelta(-5)
						} else if (ev.key === 'ArrowRight') {
							ev.preventDefault()
							commitDelta(5)
						}
					})
					sep.addEventListener('mousedown', (ev) => {
						if (!editor.isEditable) return
						ev.preventDefault()
						const startX = ev.clientX
						const totalWidth = content.getBoundingClientRect().width || 600
						const onMove = (moveEv: MouseEvent) => {
							const dx = moveEv.clientX - startX
							const deltaPct = (dx / totalWidth) * 100
							if (Math.abs(deltaPct) >= 1) {
								commitDelta(deltaPct)
							}
						}
						const onUp = () => {
							window.removeEventListener('mousemove', onMove)
							window.removeEventListener('mouseup', onUp)
						}
						window.addEventListener('mousemove', onMove)
						window.addEventListener('mouseup', onUp)
					})
					controlsBar.append(sep)
				}
			}

			applyWidths(Array.isArray(node.attrs['widths']) ? (node.attrs['widths'] as number[]) : [50, 50])

			return {
				dom,
				contentDOM: content,
				update(updatedNode) {
					if (updatedNode.type.name !== 'columns') return false
					node = updatedNode
					applyWidths(
						Array.isArray(updatedNode.attrs['widths']) ? (updatedNode.attrs['widths'] as number[]) : [50, 50]
					)
					return true
				},
				stopEvent(event) {
					const target = event.target
					return target instanceof window.Node && controlsBar.contains(target)
				},
				ignoreMutation(mutation) {
					return !content.contains(mutation.target)
				}
			}
		}
	},

	addCommands() {
		return {
			setColumns:
				(count = 2) =>
				({ commands }) => {
					const safeCount = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, count))
					const widths = normalizeColumnWidths(safeCount)
					const columnNodes = Array.from({ length: safeCount }, () => ({
						type: 'column',
						content: [{ type: 'paragraph' }]
					}))
					return commands.insertContent({
						type: this.name,
						attrs: { widths },
						content: columnNodes
					})
				},
			setColumnWidths:
				(widths) =>
				({ state, dispatch }) => {
					const { $from } = state.selection
					for (let d = $from.depth; d > 0; d--) {
						const ancestor = $from.node(d)
						if (ancestor.type.name === 'columns') {
							const pos = $from.before(d)
							const normalized = normalizeColumnWidths(ancestor.childCount, widths)
							if (dispatch) {
								dispatch(state.tr.setNodeMarkup(pos, undefined, { ...ancestor.attrs, widths: normalized }))
							}
							return true
						}
					}
					return false
				},
			unwrapColumns:
				() =>
				({ state, dispatch }) => {
					const { $from } = state.selection
					for (let d = $from.depth; d > 0; d--) {
						const ancestor = $from.node(d)
						if (ancestor.type.name === 'columns') {
							const pos = $from.before(d)
							const end = pos + ancestor.nodeSize
							const blocks: unknown[] = []
							ancestor.forEach((col) => {
								col.forEach((blk) => {
									blocks.push(blk)
								})
							})
							if (dispatch && blocks.length > 0) {
								const tr = state.tr.replaceWith(pos, end, blocks as never)
								dispatch(tr)
							}
							return true
						}
					}
					return false
				},
			moveBlockToColumnSide:
				(sourcePos, targetPos, side) =>
				({ state, dispatch }) => {
					if (sourcePos === targetPos) return false
					if (
						sourcePos < 0 ||
						targetPos < 0 ||
						sourcePos >= state.doc.content.size ||
						targetPos >= state.doc.content.size
					) {
						return false
					}
					const sourceNode = state.doc.nodeAt(sourcePos)
					const targetNode = state.doc.nodeAt(targetPos)
					if (!sourceNode?.isBlock || !targetNode?.isBlock) return false
					if (sourceNode.type.name === 'columns' || targetNode.type.name === 'columns') return false

					// Rails are intentionally limited to top-level blocks in v1. Nested
					// blocks already have vertical move semantics and ambiguous column parents.
					const $source = state.doc.resolve(sourcePos)
					const $target = state.doc.resolve(targetPos)
					if ($source.depth !== 0 || $target.depth !== 0) return false

					const columnsType = state.schema.nodes['columns']
					const columnType = state.schema.nodes['column']
					if (!columnsType || !columnType) return false
					const sourceColumn = columnType.create(null, sourceNode)
					const targetColumn = columnType.create(null, targetNode)
					const columnsNode = columnsType.create({ widths: [50, 50] }, [
						side === 'left' ? sourceColumn : targetColumn,
						side === 'left' ? targetColumn : sourceColumn
					])

					if (dispatch) {
						const tr = state.tr
						tr.delete(sourcePos, sourcePos + sourceNode.nodeSize)
						const adjustedTargetPos = sourcePos < targetPos ? targetPos - sourceNode.nodeSize : targetPos
						tr.delete(adjustedTargetPos, adjustedTargetPos + targetNode.nodeSize)
						const insertPos = Math.max(0, Math.min(tr.doc.content.size, adjustedTargetPos))
						tr.insert(insertPos, columnsNode)
						const selectionPos = Math.min(tr.doc.content.size, insertPos + 2)
						tr.setSelection(TextSelection.near(tr.doc.resolve(selectionPos)))
						dispatch(tr.scrollIntoView())
					}
					return true
				},
			moveFocusToAdjacentColumn:
				(direction) =>
				({ state, dispatch }) => {
					const { $from } = state.selection
					let columnsDepth = -1
					let columnDepth = -1
					for (let d = $from.depth; d > 0; d--) {
						const name = $from.node(d).type.name
						if (name === 'column' && columnDepth === -1) columnDepth = d
						if (name === 'columns' && columnsDepth === -1) {
							columnsDepth = d
							break
						}
					}
					if (columnsDepth === -1 || columnDepth === -1) return false
					const columnsNode = $from.node(columnsDepth)
					const colIndex = $from.index(columnsDepth)
					const nextIndex = colIndex + direction
					if (nextIndex < 0 || nextIndex >= columnsNode.childCount) return false
					let targetPos = $from.start(columnsDepth)
					for (let i = 0; i < nextIndex; i++) {
						targetPos += columnsNode.child(i).nodeSize
					}
					const targetColStart = targetPos + 1
					if (dispatch) {
						const SelectionCtor = state.selection.constructor as unknown as {
							near: (pos: ReturnType<typeof state.doc.resolve>) => typeof state.selection
						}
						const resolved = state.doc.resolve(Math.min(state.doc.content.size, targetColStart + 1))
						dispatch(state.tr.setSelection(SelectionCtor.near(resolved)).scrollIntoView())
					}
					return true
				}
		}
	},

	addKeyboardShortcuts() {
		return {
			'Mod-Alt-ArrowLeft': () => this.editor.commands.moveFocusToAdjacentColumn(-1),
			'Mod-Alt-ArrowRight': () => this.editor.commands.moveFocusToAdjacentColumn(1)
		}
	}
})
