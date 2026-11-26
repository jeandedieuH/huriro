import type { DocDatabasePropertyDto, DocDatabaseRowDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { DatabaseCellEditor, type DatabaseCellValue, emptyCell, formatDatabaseCell } from './cell-editor'
import { useDatabaseWorkspaceContext } from './database-context'
import { useVirtualWindow } from './virtualized'

export interface DatabaseViewRendererProps {
	readonly databaseId: string
	readonly rows: readonly DocDatabaseRowDto[]
	readonly properties: readonly DocDatabasePropertyDto[]
	readonly readOnly?: boolean | undefined
	readonly compact?: boolean | undefined
	readonly config?: Record<string, unknown> | undefined
	readonly onCellCommit: (rowId: string, propertyId: string, cell: DatabaseCellValue, title?: string) => void
	readonly onOpenRow?: ((row: DocDatabaseRowDto) => void) | undefined
	readonly onConfigChange?: ((patch: Record<string, unknown>) => void) | undefined
	readonly propertyActions?: ((property: DocDatabasePropertyDto) => ReactNode) | undefined
}

function dateValue(row: DocDatabaseRowDto, property?: DocDatabasePropertyDto): string | null {
	if (!property) return null
	return row.cells[property.id]?.dateStart ?? null
}

function textValue(row: DocDatabaseRowDto, property?: DocDatabasePropertyDto): string {
	if (!property) return ''
	if (property.propType === 'title') return row.title
	return formatDatabaseCell(row, property)
}

function firstProperty(
	properties: readonly DocDatabasePropertyDto[],
	types: readonly string[]
): DocDatabasePropertyDto | undefined {
	return properties.find((property) => types.includes(property.propType))
}

function configuredProperty(
	properties: readonly DocDatabasePropertyDto[],
	config: Record<string, unknown> | undefined,
	key: string,
	types: readonly string[]
): DocDatabasePropertyDto | undefined {
	const id = config?.[key]
	if (typeof id === 'string') {
		const configured = properties.find((property) => property.id === id)
		if (configured) return configured
	}
	return firstProperty(properties, types)
}

function aggregationLabel(mode: string): string {
	switch (mode) {
		case 'count':
			return t('databases.table.aggregation.count')
		case 'unique':
			return t('databases.table.aggregation.unique')
		case 'sum':
			return t('databases.table.aggregation.sum')
		case 'avg':
			return t('databases.table.aggregation.avg')
		case 'min':
			return t('databases.table.aggregation.min')
		case 'max':
			return t('databases.table.aggregation.max')
		case 'percent_checked':
			return t('databases.table.aggregation.percent-checked')
		default:
			return ''
	}
}

function aggregateRows(
	rows: readonly DocDatabaseRowDto[],
	property: DocDatabasePropertyDto,
	mode: string
): string {
	const present = rows.map((row) => formatDatabaseCell(row, property)).filter((value) => value !== '')
	if (mode === 'count') return String(present.length)
	if (mode === 'unique') return String(new Set(present).size)
	if (mode === 'percent_checked') {
		const total = rows.length
		if (total === 0) return '0%'
		const checked = rows.filter((row) => row.cells[property.id]?.boolean === true).length
		return `${Math.round((checked / total) * 100)}%`
	}
	const numbers = rows
		.map((row) => {
			const cell = row.cells[property.id]
			if (typeof cell?.number === 'number') return cell.number
			const parsed = Number(cell?.text ?? '')
			return Number.isFinite(parsed) ? parsed : null
		})
		.filter((value): value is number => value !== null)
	if (numbers.length === 0) return ''
	if (mode === 'sum') return String(numbers.reduce((sum, value) => sum + value, 0))
	if (mode === 'avg')
		return String(Math.round((numbers.reduce((sum, value) => sum + value, 0) / numbers.length) * 100) / 100)
	if (mode === 'min') return String(Math.min(...numbers))
	if (mode === 'max') return String(Math.max(...numbers))
	return ''
}

function EmptyRows() {
	return (
		<div className="flex min-h-32 items-center justify-center rounded-lg border border-border/70 border-dashed text-sm text-muted-foreground">
			{t('databases.empty.rows')}
		</div>
	)
}

export function DatabaseTableView(props: DatabaseViewRendererProps) {
	const { rows, properties, readOnly, compact, onCellCommit, onOpenRow } = props
	const scrollRef = useRef<HTMLDivElement>(null)
	const rowHeight = compact ? 34 : 40
	const windowed = useVirtualWindow(rows.length, rowHeight, scrollRef)
	const visibleProperties = properties
	const configuredWidths = useMemo(
		() =>
			typeof props.config?.['columnWidths'] === 'object' && props.config['columnWidths'] !== null
				? (props.config['columnWidths'] as Record<string, unknown>)
				: {},
		[props.config]
	)
	const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() =>
		Object.fromEntries(
			Object.entries(configuredWidths).filter(
				(entry): entry is [string, number] => typeof entry[1] === 'number'
			)
		)
	)
	useEffect(() => {
		setColumnWidths(
			Object.fromEntries(
				Object.entries(configuredWidths).filter(
					(entry): entry is [string, number] => typeof entry[1] === 'number'
				)
			)
		)
	}, [configuredWidths])
	const widthFor = (property: DocDatabasePropertyDto, index: number) =>
		Math.max(96, Math.min(560, columnWidths[property.id] ?? (index === 0 ? 220 : 150)))
	const gridTemplateColumns = visibleProperties
		.map((property, index) => `minmax(${widthFor(property, index)}px,${widthFor(property, index)}px)`)
		.join(' ')
	const wrapText = props.config?.['wrapText'] === true
	const aggregations =
		typeof props.config?.['aggregations'] === 'object' && props.config['aggregations'] !== null
			? (props.config['aggregations'] as Record<string, unknown>)
			: {}
	const persistWidths = (next: Record<string, number>) => {
		setColumnWidths(next)
		props.onConfigChange?.({ columnWidths: next })
	}
	const resizeColumn = (
		event: React.PointerEvent<HTMLButtonElement>,
		property: DocDatabasePropertyDto,
		index: number
	) => {
		event.preventDefault()
		const startX = event.clientX
		const startWidth = widthFor(property, index)
		const next = { ...columnWidths }
		const move = (moveEvent: PointerEvent) => {
			next[property.id] = Math.max(96, Math.min(560, startWidth + moveEvent.clientX - startX))
			setColumnWidths({ ...next })
		}
		const up = () => {
			window.removeEventListener('pointermove', move)
			window.removeEventListener('pointerup', up)
			persistWidths(next)
		}
		window.addEventListener('pointermove', move)
		window.addEventListener('pointerup', up)
	}
	const moveColumn = (index: number, delta: -1 | 1) => {
		const target = index + delta
		if (target < 0 || target >= visibleProperties.length) return
		const ids = visibleProperties.map((property) => property.id)
		const temp = ids[index]
		ids[index] = ids[target] ?? ''
		ids[target] = temp ?? ''
		props.onConfigChange?.({ propertyOrder: ids.filter(Boolean) })
	}
	const reorderColumn = (sourceId: string, targetId: string) => {
		const ids = visibleProperties.map((property) => property.id)
		const sourceIndex = ids.indexOf(sourceId)
		const targetIndex = ids.indexOf(targetId)
		if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return
		const [moved] = ids.splice(sourceIndex, 1)
		if (!moved) return
		ids.splice(targetIndex, 0, moved)
		props.onConfigChange?.({ propertyOrder: ids })
	}
	if (rows.length === 0) return <EmptyRows />
	return (
		<div ref={scrollRef} className="max-h-140 overflow-auto rounded-lg border border-border/80 bg-card">
			<div
				className="sticky top-0 z-10 grid border-border/80 border-b bg-muted/95 backdrop-blur"
				style={{ gridTemplateColumns }}
			>
				{visibleProperties.map((property, index) => (
					<fieldset
						key={property.id}
						draggable={Boolean(props.onConfigChange)}
						onDragStart={(event) => {
							event.dataTransfer.setData('application/x-huriro-database-column', property.id)
							event.dataTransfer.effectAllowed = 'move'
						}}
						onDragOver={(event) => {
							if (props.onConfigChange) event.preventDefault()
						}}
						onDrop={(event) => {
							event.preventDefault()
							const sourceId = event.dataTransfer.getData('application/x-huriro-database-column')
							if (sourceId) reorderColumn(sourceId, property.id)
						}}
						className={cn(
							'group/property relative flex min-w-0 cursor-grab items-center gap-1 truncate px-3 py-2 font-medium text-muted-foreground text-xs active:cursor-grabbing',
							index === 0 && 'sticky left-0 z-20 bg-muted/95'
						)}
					>
						<span className="truncate">{property.name}</span>
						{props.onConfigChange ? (
							<span className="flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/property:opacity-100">
								<button
									type="button"
									aria-label={t('databases.table.move-column-left', { name: property.name })}
									className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
									disabled={index === 0}
									onClick={() => moveColumn(index, -1)}
								>
									<ChevronLeft className="size-3" aria-hidden />
								</button>
								<button
									type="button"
									aria-label={t('databases.table.move-column-right', { name: property.name })}
									className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
									disabled={index === visibleProperties.length - 1}
									onClick={() => moveColumn(index, 1)}
								>
									<ChevronRight className="size-3" aria-hidden />
								</button>
							</span>
						) : null}
						{props.propertyActions?.(property)}
						<button
							type="button"
							aria-label={t('databases.table.resize-column', { name: property.name })}
							className="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none opacity-0 hover:bg-primary/30 focus-visible:opacity-100 group-hover/property:opacity-100"
							onPointerDown={(event) => resizeColumn(event, property, index)}
							onKeyDown={(event) => {
								if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
								event.preventDefault()
								const delta = event.key === 'ArrowRight' ? 16 : -16
								persistWidths({
									...columnWidths,
									[property.id]: Math.max(96, Math.min(560, widthFor(property, index) + delta))
								})
							}}
						/>
					</fieldset>
				))}
			</div>
			<div style={{ paddingTop: windowed.paddingTop, paddingBottom: windowed.paddingBottom }}>
				{rows.slice(windowed.start, windowed.end).map((row) => (
					<div
						key={row.id}
						className="grid border-border/60 border-b transition-colors last:border-b-0 hover:bg-accent/35"
						style={{ gridTemplateColumns, minHeight: rowHeight }}
					>
						{visibleProperties.map((property, index) => (
							<div
								key={property.id}
								className={cn(
									'min-w-0 border-border/50 border-r px-2 py-1 last:border-r-0',
									wrapText ? 'whitespace-normal break-words' : 'overflow-hidden',
									index === 0 && 'sticky left-0 z-5 bg-card'
								)}
							>
								{index === 0 && onOpenRow ? (
									<button type="button" className="w-full text-left" onClick={() => onOpenRow(row)}>
										<DatabaseCellEditor
											row={row}
											property={property}
											readOnly={readOnly}
											compact
											onCommit={(pid, cell, title) => onCellCommit(row.id, pid, cell, title)}
										/>
									</button>
								) : (
									<DatabaseCellEditor
										row={row}
										property={property}
										readOnly={readOnly}
										compact
										onCommit={(pid, cell, title) => onCellCommit(row.id, pid, cell, title)}
									/>
								)}
							</div>
						))}
					</div>
				))}
			</div>
			<div
				className="sticky bottom-0 z-10 grid border-border/80 border-t bg-muted/95 backdrop-blur"
				style={{ gridTemplateColumns }}
			>
				{visibleProperties.map((property, index) => {
					const configured = aggregations[property.id]
					const mode = typeof configured === 'string' ? configured : index === 0 ? 'count' : 'none'
					const value = mode === 'none' ? '' : aggregateRows(rows, property, mode)
					return (
						<div
							key={property.id}
							className={cn(
								'min-w-0 truncate px-3 py-2 text-muted-foreground text-xs',
								index === 0 && 'sticky left-0 z-20 bg-muted/95 font-medium'
							)}
						>
							{value ? `${aggregationLabel(mode)}: ${value}` : ''}
						</div>
					)
				})}
			</div>
		</div>
	)
}

function multiValueLabels(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	return value
		.map((item) => {
			if (typeof item === 'string') return item
			if (typeof item === 'object' && item !== null) {
				const record = item as Record<string, unknown>
				return String(
					record['name'] ?? record['title'] ?? record['filename'] ?? record['subject'] ?? record['id'] ?? ''
				)
			}
			return ''
		})
		.filter(Boolean)
}

export function DatabaseBoardView(props: DatabaseViewRendererProps) {
	const { rows, properties, readOnly, compact, onCellCommit, onOpenRow } = props
	const context = useDatabaseWorkspaceContext()
	const groupProperty = configuredProperty(properties, props.config, 'groupByPropertyId', [
		'status',
		'select',
		'person'
	])
	const groups = useMemo(() => {
		const out = new Map<string, DocDatabaseRowDto[]>()
		for (const row of rows) {
			const keys =
				groupProperty?.propType === 'person'
					? multiValueLabels(row.cells[groupProperty.id]?.json)
					: [textValue(row, groupProperty)]
			for (const rawKey of keys.length > 0 ? keys : ['']) {
				const key = rawKey || t('databases.board.ungrouped')
				out.set(key, [...(out.get(key) ?? []), row])
			}
		}
		return [...out.entries()]
	}, [groupProperty, rows])
	if (!groupProperty || rows.length === 0) return <EmptyRows />
	const canDragGroup = !readOnly && ['select', 'status', 'person'].includes(groupProperty.propType)
	const moveRow = (rowId: string, groupName: string) => {
		if (!canDragGroup) return
		const isUngrouped = groupName === t('databases.board.ungrouped')
		if (groupProperty.propType === 'person') {
			// Person groups are multi-value aware: dropping replaces the assignment with
			// the destination member while preserving the member id needed by relation cells.
			const member = context.members.find(
				(candidate) => candidate.displayName === groupName || candidate.userId === groupName
			)
			onCellCommit(rowId, groupProperty.id, {
				...emptyCell(),
				json: isUngrouped
					? []
					: [
							{
								id: member?.userId ?? groupName,
								name: member?.displayName ?? groupName,
								type: 'person'
							}
						]
			})
			return
		}
		onCellCommit(rowId, groupProperty.id, { ...emptyCell(), text: isUngrouped ? null : groupName })
	}
	return (
		<div className="flex gap-3 overflow-x-auto pb-2">
			{groups.map(([name, groupRows]) => (
				<BoardColumn
					key={name}
					title={name}
					rows={groupRows}
					properties={properties}
					readOnly={readOnly}
					compact={compact}
					onCellCommit={onCellCommit}
					onOpenRow={onOpenRow}
					draggableCards={canDragGroup}
					onMoveRow={moveRow}
				/>
			))}
		</div>
	)
}

function BoardColumn({
	title,
	rows,
	properties,
	readOnly,
	compact,
	onCellCommit,
	onOpenRow,
	draggableCards = false,
	onMoveRow
}: { readonly title: string; readonly rows: readonly DocDatabaseRowDto[] } & Omit<
	DatabaseViewRendererProps,
	'databaseId' | 'rows'
> & {
		readonly draggableCards?: boolean | undefined
		readonly onMoveRow?: ((rowId: string, groupName: string) => void) | undefined
	}) {
	const ref = useRef<HTMLDivElement>(null)
	const rowHeight = compact ? 76 : 92
	const windowed = useVirtualWindow(rows.length, rowHeight, ref)
	const titleProperty = firstProperty(properties, ['title'])
	const summaryProperties = properties.filter((p) => p.propType !== 'title').slice(0, 2)
	return (
		<fieldset
			aria-label={title}
			tabIndex={draggableCards ? 0 : undefined}
			className="w-72 shrink-0 rounded-xl border border-border/80 bg-muted/35"
			onDragOver={(event) => {
				if (draggableCards) event.preventDefault()
			}}
			onDrop={(event) => {
				if (!draggableCards) return
				event.preventDefault()
				const rowId = event.dataTransfer.getData('application/x-huriro-database-row')
				if (rowId) onMoveRow?.(rowId, title)
			}}
		>
			<header className="flex items-center justify-between px-3 py-2">
				<h3 className="truncate font-medium text-sm">{title}</h3>
				<Badge tone="secondary">{rows.length}</Badge>
			</header>
			<div ref={ref} className="max-h-130 overflow-y-auto px-2 pb-2">
				<div
					style={{ paddingTop: windowed.paddingTop, paddingBottom: windowed.paddingBottom }}
					className="space-y-2"
				>
					{rows.slice(windowed.start, windowed.end).map((row) => (
						<article
							key={row.id}
							draggable={draggableCards}
							onDragStart={(event) => {
								event.dataTransfer.setData('application/x-huriro-database-row', row.id)
								event.dataTransfer.effectAllowed = 'move'
							}}
							style={{ minHeight: rowHeight - 8 }}
							className={cn(
								'rounded-lg border border-border/70 bg-card p-2 shadow-(--shadow-1)',
								draggableCards && 'cursor-grab active:cursor-grabbing'
							)}
						>
							<button
								type="button"
								className="mb-1 block w-full text-left font-medium text-sm"
								onClick={() => onOpenRow?.(row)}
							>
								{titleProperty ? formatDatabaseCell(row, titleProperty) : row.title}
							</button>
							<div className="space-y-1">
								{summaryProperties.map((property) => (
									<DatabaseCellEditor
										key={property.id}
										row={row}
										property={property}
										readOnly={readOnly}
										compact
										onCommit={(pid, cell, nextTitle) => onCellCommit(row.id, pid, cell, nextTitle)}
									/>
								))}
							</div>
						</article>
					))}
				</div>
			</div>
		</fieldset>
	)
}

function galleryCoverUrl(
	row: DocDatabaseRowDto,
	properties: readonly DocDatabasePropertyDto[]
): string | null {
	for (const property of properties) {
		if (property.propType !== 'file') continue
		const value = row.cells[property.id]?.json
		if (!Array.isArray(value)) continue
		for (const item of value) {
			if (typeof item !== 'object' || item === null) continue
			const record = item as Record<string, unknown>
			const id = typeof record['id'] === 'string' ? record['id'] : ''
			const contentType = typeof record['contentType'] === 'string' ? record['contentType'] : ''
			const filename = typeof record['filename'] === 'string' ? record['filename'].toLowerCase() : ''
			if (id && (contentType.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|svg)$/.test(filename))) {
				return `/api/v1/files/${encodeURIComponent(id)}/download`
			}
		}
	}
	return null
}

export function DatabaseGalleryView(props: DatabaseViewRendererProps) {
	const { rows, properties, readOnly, compact, onCellCommit, onOpenRow } = props
	const ref = useRef<HTMLDivElement>(null)
	const columns = compact ? 2 : 3
	const cardHeight = compact ? 150 : 190
	const rowCount = Math.ceil(rows.length / columns)
	const windowed = useVirtualWindow(rowCount, cardHeight, ref)
	const titleProperty = firstProperty(properties, ['title'])
	const summary = properties.filter((p) => p.propType !== 'title').slice(0, 3)
	if (rows.length === 0) return <EmptyRows />
	return (
		<div ref={ref} className="max-h-140 overflow-y-auto">
			<div
				style={{ paddingTop: windowed.paddingTop, paddingBottom: windowed.paddingBottom }}
				className="space-y-3"
			>
				{Array.from({ length: windowed.end - windowed.start }, (_, index) => {
					const rowIndex = windowed.start + index
					const batch = rows.slice(rowIndex * columns, rowIndex * columns + columns)
					return (
						<div
							key={rowIndex}
							className="grid gap-3"
							style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))`, minHeight: cardHeight }}
						>
							{batch.map((row) => (
								<article
									key={row.id}
									className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-(--shadow-1)"
								>
									{(() => {
										const coverUrl = galleryCoverUrl(row, properties)
										return (
											<div className="relative flex h-20 items-end overflow-hidden bg-linear-to-br from-muted to-accent/40 p-3">
												{coverUrl ? (
													<img
														src={coverUrl}
														alt=""
														loading="lazy"
														className="absolute inset-0 size-full object-cover"
													/>
												) : null}
												<button
													type="button"
													className="relative truncate rounded bg-background/75 px-1.5 py-0.5 text-left font-medium backdrop-blur-sm"
													onClick={() => onOpenRow?.(row)}
												>
													{titleProperty ? formatDatabaseCell(row, titleProperty) : row.title}
												</button>
											</div>
										)
									})()}
									<div className="space-y-1 p-3">
										{summary.map((property) => (
											<DatabaseCellEditor
												key={property.id}
												row={row}
												property={property}
												readOnly={readOnly}
												compact
												onCommit={(pid, cell, nextTitle) => onCellCommit(row.id, pid, cell, nextTitle)}
											/>
										))}
									</div>
								</article>
							))}
						</div>
					)
				})}
			</div>
		</div>
	)
}

export function DatabaseCalendarView(props: DatabaseViewRendererProps) {
	const { rows, properties, onOpenRow } = props
	const dateProperty = configuredProperty(properties, props.config, 'datePropertyId', [
		'date',
		'created_time',
		'updated_time'
	])
	const byDay = useMemo(() => {
		const map = new Map<string, DocDatabaseRowDto[]>()
		for (const row of rows) {
			const raw = dateValue(row, dateProperty)
			if (!raw) continue
			const key = raw.slice(0, 10)
			map.set(key, [...(map.get(key) ?? []), row])
		}
		return map
	}, [dateProperty, rows])
	const firstDate = [...byDay.keys()].sort()[0] ?? new Date().toISOString().slice(0, 10)
	const [dateCursor, setDateCursor] = useState(() => firstDate)
	const mode = props.config?.['calendarMode'] === 'week' ? 'week' : 'month'
	const anchor = new Date(`${dateCursor}T00:00:00.000Z`)
	const periodStart = new Date(anchor)
	if (mode === 'month') periodStart.setUTCDate(1)
	const gridStart = new Date(periodStart)
	gridStart.setUTCDate(gridStart.getUTCDate() - gridStart.getUTCDay())
	const dayCount = mode === 'week' ? 7 : 42
	const visibleEnd = new Date(gridStart)
	visibleEnd.setUTCDate(gridStart.getUTCDate() + dayCount - 1)
	const navigatePeriod = (delta: -1 | 1) => {
		const next = new Date(anchor)
		if (mode === 'week') next.setUTCDate(next.getUTCDate() + delta * 7)
		else next.setUTCMonth(next.getUTCMonth() + delta)
		setDateCursor(next.toISOString().slice(0, 10))
	}
	const title =
		mode === 'week'
			? `${gridStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })} – ${visibleEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`
			: periodStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
	if (!dateProperty || rows.length === 0) return <EmptyRows />
	return (
		<div className="overflow-hidden rounded-xl border border-border/80">
			<header className="flex items-center justify-between gap-2 border-border/80 border-b bg-card px-3 py-2">
				<Button
					type="button"
					size="icon"
					tone="ghost"
					aria-label={
						mode === 'week' ? t('databases.calendar.previous-week') : t('databases.calendar.previous-month')
					}
					onClick={() => navigatePeriod(-1)}
				>
					<ChevronLeft className="size-4" aria-hidden />
				</Button>
				<h3 className="min-w-0 flex-1 truncate text-center font-medium text-sm">{title}</h3>
				<div className="flex items-center gap-1">
					<Button
						type="button"
						size="sm"
						tone={mode === 'month' ? 'secondary' : 'ghost'}
						className="h-7 text-xs"
						onClick={() => props.onConfigChange?.({ calendarMode: 'month' })}
					>
						{t('databases.calendar.month')}
					</Button>
					<Button
						type="button"
						size="sm"
						tone={mode === 'week' ? 'secondary' : 'ghost'}
						className="h-7 text-xs"
						onClick={() => props.onConfigChange?.({ calendarMode: 'week' })}
					>
						{t('databases.calendar.week')}
					</Button>
					<Button
						type="button"
						size="icon"
						tone="ghost"
						aria-label={
							mode === 'week' ? t('databases.calendar.next-week') : t('databases.calendar.next-month')
						}
						onClick={() => navigatePeriod(1)}
					>
						<ChevronRight className="size-4" aria-hidden />
					</Button>
				</div>
			</header>
			<div className="grid grid-cols-7 border-border/80 border-b bg-muted/50 text-center text-muted-foreground text-xs">
				{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
					<div key={day} className="py-2">
						{day}
					</div>
				))}
			</div>
			<div className="grid grid-cols-7">
				{Array.from({ length: dayCount }, (_, index) => {
					const day = new Date(gridStart)
					day.setUTCDate(gridStart.getUTCDate() + index)
					const key = day.toISOString().slice(0, 10)
					const dayRows = byDay.get(key) ?? []
					const inMonth = day.getUTCMonth() === periodStart.getUTCMonth()
					return (
						<div
							key={key}
							className={cn(
								'border-border/60 border-r border-b p-1.5',
								mode === 'week' ? 'min-h-40' : 'min-h-28',
								mode === 'month' && !inMonth && 'bg-muted/25 text-muted-foreground'
							)}
						>
							<div className="mb-1 text-right text-xs">{day.getUTCDate()}</div>
							<div className="space-y-1">
								{dayRows.slice(0, mode === 'week' ? 6 : 3).map((row) => (
									<button
										key={row.id}
										type="button"
										onClick={() => onOpenRow?.(row)}
										className="block w-full truncate rounded bg-primary/10 px-1.5 py-0.5 text-left text-primary text-xs hover:bg-primary/15"
									>
										{row.title || t('databases.row.untitled')}
									</button>
								))}
								{dayRows.length > (mode === 'week' ? 6 : 3) ? (
									<div className="text-muted-foreground text-xs">
										{t('databases.calendar.more', { count: dayRows.length - (mode === 'week' ? 6 : 3) })}
									</div>
								) : null}
							</div>
						</div>
					)
				})}
			</div>
		</div>
	)
}

function relationIds(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	return value
		.map((item) => {
			if (typeof item === 'string') return item
			if (typeof item === 'object' && item !== null) {
				const id = (item as Record<string, unknown>)['id']
				return typeof id === 'string' ? id : ''
			}
			return ''
		})
		.filter(Boolean)
}

export function DatabaseTimelineView(props: DatabaseViewRendererProps) {
	const { rows, properties, onOpenRow } = props
	const ref = useRef<HTMLDivElement>(null)
	const [zoom, setZoom] = useState(1)
	const dateProperty = configuredProperty(properties, props.config, 'datePropertyId', [
		'date',
		'created_time',
		'updated_time'
	])
	const dependencyProperty = configuredProperty(properties, props.config, 'dependencyPropertyId', [
		'relation'
	])
	const datedRows = rows
		.flatMap((row) => {
			const date = dateValue(row, dateProperty)
			if (!date || !dateProperty) return []
			const end = row.cells[dateProperty.id]?.dateEnd ?? date
			return [{ row, date, end }]
		})
		.sort((a, b) => a.date.localeCompare(b.date))
	const windowed = useVirtualWindow(datedRows.length, 34, ref)
	const times = datedRows.map((item) => Date.parse(item.date)).filter(Number.isFinite)
	const min = Math.min(...times, Date.now())
	const max = Math.max(...times, min + 86_400_000)
	const span = Math.max(1, max - min)
	const rowIndexById = new Map(datedRows.map((item, index) => [item.row.id, index]))
	const laneHeight = windowed.paddingTop + windowed.paddingBottom + (windowed.end - windowed.start) * 34
	const dependencies = dependencyProperty
		? datedRows.flatMap((source) =>
				relationIds(source.row.cells[dependencyProperty.id]?.json).flatMap((targetId) => {
					const sourceIndex = rowIndexById.get(source.row.id)
					const targetIndex = rowIndexById.get(targetId)
					if (sourceIndex === undefined || targetIndex === undefined) return []
					if (sourceIndex < windowed.start || sourceIndex >= windowed.end) return []
					if (targetIndex < windowed.start || targetIndex >= windowed.end) return []
					const target = datedRows[targetIndex]
					if (!target) return []
					return [{ source, sourceIndex, target, targetIndex }]
				})
			)
		: []
	if (!dateProperty || datedRows.length === 0) return <EmptyRows />
	return (
		<div className="overflow-hidden rounded-xl border border-border/80">
			<header className="flex items-center justify-between border-border/80 border-b bg-card px-3 py-2">
				<span className="font-medium text-sm">{t('databases.timeline.scale')}</span>
				<div className="flex items-center gap-1">
					<Button
						type="button"
						size="icon"
						tone="ghost"
						aria-label={t('databases.timeline.zoom-out')}
						disabled={zoom <= 1}
						onClick={() => setZoom((value) => Math.max(1, value / 1.5))}
					>
						<ZoomOut className="size-4" aria-hidden />
					</Button>
					<span className="w-12 text-center text-muted-foreground text-xs">{Math.round(zoom * 100)}%</span>
					<Button
						type="button"
						size="icon"
						tone="ghost"
						aria-label={t('databases.timeline.zoom-in')}
						disabled={zoom >= 8}
						onClick={() => setZoom((value) => Math.min(8, value * 1.5))}
					>
						<ZoomIn className="size-4" aria-hidden />
					</Button>
				</div>
			</header>
			<div ref={ref} className="max-h-130 overflow-auto p-3">
				<div style={{ width: `${zoom * 100}%`, minWidth: '100%' }}>
					<div
						className="relative"
						style={{ paddingTop: windowed.paddingTop, paddingBottom: windowed.paddingBottom }}
					>
						{dependencies.length > 0 ? (
							<svg
								aria-hidden="true"
								className="pointer-events-none absolute top-0 bottom-0 left-48 z-0 w-[calc(100%-12rem)]"
								viewBox={`0 0 100 ${Math.max(1, laneHeight)}`}
								preserveAspectRatio="none"
							>
								<defs>
									<marker
										id={`database-dependency-arrow-${props.databaseId}`}
										markerWidth="6"
										markerHeight="6"
										refX="5"
										refY="3"
										orient="auto"
									>
										<path d="M0,0 L6,3 L0,6 z" fill="currentColor" />
									</marker>
								</defs>
								{dependencies.map(({ source, sourceIndex, target, targetIndex }) => {
									const sourceStart = Date.parse(source.date)
									const sourceEnd = Math.max(Date.parse(source.end), sourceStart + 86_400_000)
									const targetStart = Date.parse(target.date)
									const x1 = ((sourceEnd - min) / span) * 100
									const x2 = ((targetStart - min) / span) * 100
									const y1 = windowed.paddingTop + (sourceIndex - windowed.start) * 34 + 17
									const y2 = windowed.paddingTop + (targetIndex - windowed.start) * 34 + 17
									const conflict = targetStart < sourceEnd
									return (
										<path
											key={`${source.row.id}-${target.row.id}`}
											d={`M ${x1} ${y1} C ${x1 + 4} ${y1}, ${x2 - 4} ${y2}, ${x2} ${y2}`}
											fill="none"
											className={conflict ? 'text-destructive' : 'text-muted-foreground'}
											stroke="currentColor"
											strokeWidth="1.5"
											markerEnd={`url(#database-dependency-arrow-${props.databaseId})`}
										/>
									)
								})}
							</svg>
						) : null}
						{datedRows.slice(windowed.start, windowed.end).map(({ row, date, end }) => {
							const startMs = Date.parse(date)
							const endMs = Math.max(Date.parse(end), startMs + 86_400_000)
							const left = ((startMs - min) / span) * 100
							const width = Math.max(2.5, ((endMs - startMs) / span) * 100)
							return (
								<div
									key={row.id}
									className="relative z-10 grid h-8.5 grid-cols-[180px_1fr] items-center gap-3"
								>
									<button
										type="button"
										onClick={() => onOpenRow?.(row)}
										className="truncate text-left text-sm hover:text-primary"
									>
										{row.title || t('databases.row.untitled')}
									</button>
									<div className="relative h-5 rounded bg-muted/70">
										<div
											className="absolute top-1 h-3 min-w-10 rounded-full bg-primary/70"
											style={{
												left: `${Math.max(0, Math.min(97, left))}%`,
												width: `${Math.min(100, width)}%`
											}}
										/>
									</div>
								</div>
							)
						})}
					</div>
				</div>
			</div>
		</div>
	)
}

export function DatabaseListView(props: DatabaseViewRendererProps) {
	const { rows, properties, readOnly, compact, onCellCommit, onOpenRow } = props
	const ref = useRef<HTMLDivElement>(null)
	const rowHeight = compact ? 40 : 48
	const windowed = useVirtualWindow(rows.length, rowHeight, ref)
	const titleProperty = firstProperty(properties, ['title'])
	const summary = properties.filter((p) => p.propType !== 'title').slice(0, 2)
	if (rows.length === 0) return <EmptyRows />
	return (
		<div ref={ref} className="max-h-140 overflow-y-auto rounded-lg border border-border/80 bg-card">
			<div style={{ paddingTop: windowed.paddingTop, paddingBottom: windowed.paddingBottom }}>
				{rows.slice(windowed.start, windowed.end).map((row) => (
					<div
						key={row.id}
						style={{ minHeight: rowHeight }}
						className="grid grid-cols-[minmax(160px,1fr)_minmax(120px,180px)_minmax(120px,180px)] items-center gap-2 border-border/60 border-b px-3 py-1 last:border-b-0 hover:bg-accent/30"
					>
						<button
							type="button"
							onClick={() => onOpenRow?.(row)}
							className="truncate text-left font-medium text-sm"
						>
							{titleProperty ? formatDatabaseCell(row, titleProperty) : row.title}
						</button>
						{summary.map((property) => (
							<DatabaseCellEditor
								key={property.id}
								row={row}
								property={property}
								readOnly={readOnly}
								compact
								onCommit={(pid, cell, nextTitle) => onCellCommit(row.id, pid, cell, nextTitle)}
							/>
						))}
					</div>
				))}
			</div>
		</div>
	)
}

export function DatabaseViewRenderer({
	viewType,
	...props
}: DatabaseViewRendererProps & { readonly viewType: string }) {
	if (viewType === 'board') return <DatabaseBoardView {...props} />
	if (viewType === 'gallery') return <DatabaseGalleryView {...props} />
	if (viewType === 'calendar') return <DatabaseCalendarView {...props} />
	if (viewType === 'timeline') return <DatabaseTimelineView {...props} />
	if (viewType === 'list') return <DatabaseListView {...props} />
	return <DatabaseTableView {...props} />
}
