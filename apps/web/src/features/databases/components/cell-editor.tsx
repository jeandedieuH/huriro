import type { DocDatabasePropertyDto, DocDatabaseRowDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Check, Paperclip, Plus, Search, X } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useDatabaseWorkspaceContext } from './database-context'

export type DatabaseCellValue = DocDatabaseRowDto['cells'][string]

export function emptyCell(): DatabaseCellValue {
	return { text: null, number: null, boolean: null, dateStart: null, dateEnd: null, json: null }
}

function optionValues(config: Record<string, unknown>): string[] {
	const options = config['options']
	if (!Array.isArray(options)) return []
	return options
		.map((option) => {
			if (typeof option === 'string') return option
			if (typeof option === 'object' && option !== null) {
				const value =
					(option as Record<string, unknown>)['value'] ?? (option as Record<string, unknown>)['name']
				return typeof value === 'string' ? value : null
			}
			return null
		})
		.filter((value): value is string => typeof value === 'string' && value.length > 0)
}

function jsonArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : []
}

function recordId(value: unknown): string {
	if (typeof value === 'string') return value
	if (typeof value === 'object' && value !== null) {
		const record = value as Record<string, unknown>
		return String(record['id'] ?? record['targetId'] ?? '')
	}
	return ''
}

function recordLabel(value: unknown): string {
	if (typeof value === 'string') return value
	if (typeof value === 'object' && value !== null) {
		const record = value as Record<string, unknown>
		return String(
			record['name'] ?? record['title'] ?? record['filename'] ?? record['subject'] ?? record['id'] ?? ''
		)
	}
	return String(value ?? '')
}

function jsonArrayText(value: unknown): string {
	return jsonArray(value).map(recordLabel).filter(Boolean).join(', ')
}

export function formatDatabaseCell(row: DocDatabaseRowDto, property: DocDatabasePropertyDto): string {
	if (property.propType === 'title') return row.title
	if (property.propType === 'created_time') return new Date(row.createdAt).toLocaleDateString()
	if (property.propType === 'updated_time') return new Date(row.updatedAt).toLocaleDateString()
	if (property.propType === 'created_by') return row.createdBy.slice(0, 8)
	if (property.propType === 'updated_by') return row.updatedBy?.slice(0, 8) ?? ''
	const cell = row.cells[property.id]
	if (!cell) return ''
	if (cell.text) return cell.text
	if (cell.number !== null) return String(cell.number)
	if (cell.boolean !== null) return cell.boolean ? '✓' : ''
	if (cell.dateStart) return new Date(cell.dateStart).toLocaleDateString()
	if (cell.json !== null && cell.json !== undefined) return jsonArrayText(cell.json) || String(cell.json)
	return ''
}

interface SelectOptionRecord {
	readonly id: string
	readonly label: string
	readonly description?: string | undefined
	readonly payload: unknown
}

interface MultiValuePopoverProps {
	readonly property: DocDatabasePropertyDto
	readonly values: readonly unknown[]
	readonly options: readonly SelectOptionRecord[]
	readonly disabled?: boolean | undefined
	readonly allowCustom?: boolean | undefined
	readonly customLabel?: string | undefined
	readonly action?: ReactNode | undefined
	readonly onCommit: (values: unknown[]) => void
}

/** Shared chip + checklist picker used by multi-select, people, relation, and
 * file properties. Values remain JSON arrays, preserving offline portability. */
function MultiValuePopover({
	property,
	values,
	options,
	disabled,
	allowCustom = false,
	customLabel,
	action,
	onCommit
}: MultiValuePopoverProps) {
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState('')
	const selectedIds = useMemo(() => new Set(values.map(recordId).filter(Boolean)), [values])
	const filteredOptions = useMemo(() => {
		const q = query.trim().toLowerCase()
		if (!q) return options
		return options.filter((option) => option.label.toLowerCase().includes(q))
	}, [options, query])

	const toggle = (option: SelectOptionRecord) => {
		if (selectedIds.has(option.id)) {
			onCommit(values.filter((value) => recordId(value) !== option.id))
		} else {
			onCommit([...values, option.payload])
		}
	}

	const addCustom = () => {
		const clean = query.trim()
		if (!clean || selectedIds.has(clean)) return
		onCommit([...values, clean])
		setQuery('')
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					disabled={disabled}
					aria-label={property.name}
					className="flex min-h-7 w-full flex-wrap items-center gap-1 rounded px-1 text-left text-sm hover:bg-muted/50"
				>
					{values.length === 0 ? (
						<span className="text-muted-foreground text-xs">{t('databases.cell.select-placeholder')}</span>
					) : (
						values.slice(0, 4).map((value) => (
							<Badge
								key={`${recordId(value)}-${recordLabel(value)}`}
								tone="secondary"
								className="max-w-32 truncate"
							>
								{recordLabel(value)}
							</Badge>
						))
					)}
					{values.length > 4 ? <Badge tone="outline">+{values.length - 4}</Badge> : null}
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-72 p-2">
				<div className="mb-2 flex items-center gap-1.5 border border-border/70 rounded-md px-2">
					<Search className="size-3.5 text-muted-foreground" aria-hidden />
					<Input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						aria-label={t('databases.cell.search')}
						className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
					/>
				</div>
				<div className="max-h-56 space-y-0.5 overflow-y-auto">
					{filteredOptions.map((option) => {
						const checked = selectedIds.has(option.id)
						return (
							<label
								key={option.id}
								htmlFor={`${property.id}-${option.id}`}
								className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
							>
								<Checkbox
									id={`${property.id}-${option.id}`}
									checked={checked}
									onCheckedChange={() => toggle(option)}
								/>
								<span className="min-w-0 flex-1">
									<span className="block truncate">{option.label}</span>
									{option.description ? (
										<span className="block truncate text-muted-foreground text-xs">{option.description}</span>
									) : null}
								</span>
								{checked ? <Check className="size-3.5 text-primary" aria-hidden /> : null}
							</label>
						)
					})}
					{filteredOptions.length === 0 ? (
						<p className="px-2 py-3 text-muted-foreground text-xs">{t('databases.cell.no-options')}</p>
					) : null}
				</div>
				{allowCustom && query.trim() ? (
					<Button
						type="button"
						size="sm"
						tone="ghost"
						className="mt-2 w-full justify-start"
						onClick={addCustom}
					>
						<Plus className="size-3.5" aria-hidden />
						{customLabel ?? query.trim()}
					</Button>
				) : null}
				{action ? <div className="mt-2 border-border/70 border-t pt-2">{action}</div> : null}
				{values.length > 0 ? (
					<Button
						type="button"
						size="sm"
						tone="ghost"
						className="mt-1 w-full justify-start text-destructive"
						onClick={() => onCommit([])}
					>
						<X className="size-3.5" aria-hidden />
						{t('common.clear')}
					</Button>
				) : null}
			</PopoverContent>
		</Popover>
	)
}

function relationOptions(
	property: DocDatabasePropertyDto,
	context: ReturnType<typeof useDatabaseWorkspaceContext>
): SelectOptionRecord[] {
	const config = property.config as Record<string, unknown>
	const targetType = typeof config['targetType'] === 'string' ? config['targetType'] : 'database'
	if (targetType === 'issue') {
		return context.issues
			.filter((issue) => issue.deletedAt === null)
			.map((issue) => ({
				id: issue.id,
				label: issue.title,
				description: issue.identifier,
				payload: { id: issue.id, type: 'issue', title: issue.title, identifier: issue.identifier }
			}))
	}
	if (targetType === 'mail') {
		return context.mailConversations.map((conversation) => ({
			id: conversation.id,
			label: conversation.subject || conversation.customerEmail || conversation.id,
			description: conversation.customerEmail ?? undefined,
			payload: { id: conversation.id, type: 'mail', subject: conversation.subject }
		}))
	}
	const targetDatabaseId = typeof config['targetDatabaseId'] === 'string' ? config['targetDatabaseId'] : ''
	return context.allRows
		.filter((row) => row.databaseId === targetDatabaseId && row.archivedAt === null)
		.map((row) => ({
			id: row.id,
			label: row.title || t('databases.row.untitled'),
			description: undefined,
			payload: { id: row.id, type: 'database_row', title: row.title }
		}))
}

interface DatabaseCellEditorProps {
	readonly row: DocDatabaseRowDto
	readonly property: DocDatabasePropertyDto
	readonly readOnly?: boolean | undefined
	readonly compact?: boolean | undefined
	readonly onCommit: (propertyId: string, cell: DatabaseCellValue, title?: string) => void
}

/** Property-aware inline editor. Formula/rollup/system values are deliberately
 * read-only: the server is authoritative for materialized values and the UI
 * renders them as text only (never HTML). */
export function DatabaseCellEditor({ row, property, readOnly, compact, onCommit }: DatabaseCellEditorProps) {
	const context = useDatabaseWorkspaceContext()
	const isTitle = property.propType === 'title'
	const cell = row.cells[property.id] ?? emptyCell()
	const initial = isTitle
		? row.title
		: (cell.text ?? (cell.number !== null ? String(cell.number) : jsonArrayText(cell.json)))
	const [draft, setDraft] = useState(initial)
	const [uploading, setUploading] = useState(false)
	const fileInputRef = useRef<HTMLInputElement | null>(null)
	useEffect(() => setDraft(initial), [initial])

	if (
		readOnly ||
		['formula', 'rollup', 'created_time', 'created_by', 'updated_time', 'updated_by'].includes(
			property.propType
		)
	) {
		return <span className="block truncate text-sm">{formatDatabaseCell(row, property)}</span>
	}

	if (property.propType === 'checkbox') {
		return (
			<Checkbox
				aria-label={property.name}
				checked={cell.boolean === true}
				onCheckedChange={(checked) => onCommit(property.id, { ...emptyCell(), boolean: checked === true })}
			/>
		)
	}

	if (property.propType === 'select' || property.propType === 'status') {
		const options = optionValues(property.config)
		return (
			<Select
				value={cell.text ?? ''}
				onValueChange={(value) => onCommit(property.id, { ...emptyCell(), text: value })}
			>
				<SelectTrigger
					aria-label={property.name}
					className={cn('h-8 border-0 shadow-none', compact && 'h-7 text-xs')}
				>
					<SelectValue placeholder={t('databases.cell.select-placeholder')} />
				</SelectTrigger>
				<SelectContent>
					{options.map((option) => (
						<SelectItem key={option} value={option}>
							{option}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		)
	}

	if (property.propType === 'multi_select') {
		const values = jsonArray(cell.json)
		const existing = new Set(values.map(recordId))
		const options = optionValues(property.config).map((option) => ({
			id: option,
			label: option,
			payload: option
		}))
		return (
			<MultiValuePopover
				property={property}
				values={values}
				options={options}
				allowCustom
				onCommit={(next) => {
					for (const value of next) existing.add(recordId(value))
					onCommit(property.id, { ...emptyCell(), json: next })
				}}
			/>
		)
	}

	if (property.propType === 'person') {
		const values = jsonArray(cell.json)
		const options = context.members.map((member) => ({
			id: member.userId,
			label: member.displayName || member.email,
			description: member.email,
			payload: { id: member.userId, type: 'person', name: member.displayName || member.email }
		}))
		return (
			<MultiValuePopover
				property={property}
				values={values}
				options={options}
				onCommit={(next) => onCommit(property.id, { ...emptyCell(), json: next })}
			/>
		)
	}

	if (property.propType === 'relation') {
		const values = jsonArray(cell.json)
		return (
			<MultiValuePopover
				property={property}
				values={values}
				options={relationOptions(property, context)}
				onCommit={(next) => onCommit(property.id, { ...emptyCell(), json: next })}
			/>
		)
	}

	if (property.propType === 'file') {
		const values = jsonArray(cell.json)
		const uploadAction = (
			<>
				<input
					ref={fileInputRef}
					type="file"
					className="hidden"
					onChange={(event) => {
						const file = event.target.files?.[0]
						event.target.value = ''
						if (!file || !context.uploadFile) return
						setUploading(true)
						void context
							.uploadFile(file)
							.then((uploaded) => {
								onCommit(property.id, {
									...emptyCell(),
									json: [
										...values,
										{
											id: uploaded.id,
											type: 'file',
											filename: uploaded.filename,
											contentType: uploaded.contentType
										}
									]
								})
							})
							.finally(() => setUploading(false))
					}}
				/>
				<Button
					type="button"
					size="sm"
					tone="outline"
					disabled={uploading || !context.uploadFile}
					className="w-full justify-start"
					onClick={() => fileInputRef.current?.click()}
				>
					<Paperclip className="size-3.5" aria-hidden />
					{uploading ? t('databases.cell.uploading') : t('databases.cell.upload-file')}
				</Button>
			</>
		)
		return (
			<MultiValuePopover
				property={property}
				values={values}
				options={[]}
				action={uploadAction}
				onCommit={(next) => onCommit(property.id, { ...emptyCell(), json: next })}
			/>
		)
	}

	if (property.propType === 'date') {
		return (
			<Input
				aria-label={property.name}
				type="date"
				value={cell.dateStart ? cell.dateStart.slice(0, 10) : ''}
				onChange={(event) => {
					const value = event.target.value
					onCommit(property.id, { ...emptyCell(), dateStart: value ? `${value}T00:00:00.000Z` : null })
				}}
				className={cn('h-8 border-0 px-1 shadow-none', compact && 'h-7 text-xs')}
			/>
		)
	}

	const commitText = () => {
		if (isTitle) {
			onCommit(property.id, cell, draft)
			return
		}
		if (property.propType === 'number') {
			const number = draft.trim() === '' ? null : Number(draft)
			if (number !== null && !Number.isFinite(number)) return
			onCommit(property.id, { ...emptyCell(), number })
			return
		}
		onCommit(property.id, { ...emptyCell(), text: draft || null })
	}

	return (
		<Input
			aria-label={property.name}
			type={
				property.propType === 'number'
					? 'number'
					: property.propType === 'email'
						? 'email'
						: property.propType === 'url'
							? 'url'
							: 'text'
			}
			value={draft}
			onChange={(event) => setDraft(event.target.value)}
			onBlur={commitText}
			onKeyDown={(event) => {
				if (event.key === 'Enter') event.currentTarget.blur()
			}}
			className={cn('h-8 border-0 px-1 shadow-none focus-visible:ring-1', compact && 'h-7 text-xs')}
		/>
	)
}
