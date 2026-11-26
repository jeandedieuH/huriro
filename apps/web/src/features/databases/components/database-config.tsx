import type { DocDatabasePropertyDto, DocDatabaseRowDto, DocDatabaseViewDto } from '@huriro/contracts'
import { type DatabaseFilterExpr, validateDatabaseFilter } from '@huriro/domain'
import { t } from '@huriro/i18n'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { DatabaseFilterBuilder } from './filter-builder'
import { FormulaEditor } from './formula-editor'

const AGGREGATIONS = ['count', 'unique_values', 'sum', 'avg', 'min', 'max', 'percent_checked'] as const

function csvOptions(value: unknown): string {
	if (!Array.isArray(value)) return ''
	return value
		.map((item) =>
			typeof item === 'string'
				? item
				: typeof item === 'object' && item !== null
					? String(
							(item as Record<string, unknown>)['name'] ?? (item as Record<string, unknown>)['value'] ?? ''
						)
					: ''
		)
		.filter(Boolean)
		.join(', ')
}

function parseCsvOptions(value: string): string[] {
	return value
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean)
}

function textConfig(config: Record<string, unknown>, key: string): string {
	const value = config[key]
	return typeof value === 'string' ? value : ''
}

export interface PropertyConfigFormProps {
	readonly propType: DocDatabasePropertyDto['propType']
	readonly config: Record<string, unknown>
	readonly properties: readonly DocDatabasePropertyDto[]
	readonly allProperties?: readonly DocDatabasePropertyDto[] | undefined
	readonly sampleRow?: DocDatabaseRowDto | undefined
	readonly databases: readonly { readonly id: string; readonly title: string }[]
	readonly onChange: (config: Record<string, unknown>) => void
}

/** Type-specific property configuration. The wire contract intentionally keeps
 * config as JSON; this form is the typed editor over the server's known keys. */
export function PropertyConfigForm({
	propType,
	config,
	properties,
	allProperties,
	sampleRow,
	databases,
	onChange
}: PropertyConfigFormProps) {
	const setKey = (key: string, value: unknown) => onChange({ ...config, [key]: value })
	const relationProperties = properties.filter((property) => property.propType === 'relation')
	const targetDatabaseId = textConfig(config, 'targetDatabaseId')
	const targetDatabaseProperties = (allProperties ?? properties).filter(
		(property) => property.databaseId === targetDatabaseId
	)

	if (propType === 'formula') {
		return (
			<FormulaEditor
				value={textConfig(config, 'formulaSource')}
				properties={properties}
				sampleRow={sampleRow}
				onChange={(value) => setKey('formulaSource', value)}
			/>
		)
	}

	if (propType === 'select' || propType === 'multi_select' || propType === 'status') {
		return (
			<div className="space-y-1.5">
				<label className="font-medium text-xs" htmlFor="property-options">
					{t('databases.config.options')}
				</label>
				<Textarea
					id="property-options"
					value={csvOptions(config['options'])}
					onChange={(event) => setKey('options', parseCsvOptions(event.target.value))}
					rows={2}
					className="text-xs"
				/>
			</div>
		)
	}

	if (propType === 'number') {
		return (
			<div className="space-y-1.5">
				<span className="font-medium text-xs">{t('databases.config.number-format')}</span>
				<Select
					value={textConfig(config, 'format') || 'number'}
					onValueChange={(value) => setKey('format', value)}
				>
					<SelectTrigger className="h-8 text-xs">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="number">Number</SelectItem>
						<SelectItem value="percent">Percent</SelectItem>
						<SelectItem value="currency">Currency</SelectItem>
					</SelectContent>
				</Select>
			</div>
		)
	}

	if (propType === 'date') {
		return (
			<div className="space-y-1.5">
				<label className="font-medium text-xs" htmlFor="date-reminder">
					{t('databases.config.reminder-days')}
				</label>
				<Input
					id="date-reminder"
					type="number"
					value={typeof config['reminderDays'] === 'number' ? String(config['reminderDays']) : ''}
					onChange={(event) => setKey('reminderDays', event.target.value ? Number(event.target.value) : null)}
					className="h-8 text-xs"
				/>
			</div>
		)
	}

	if (propType === 'relation') {
		return (
			<div className="grid gap-3 lg:grid-cols-3 sm:grid-cols-2">
				<div className="space-y-1.5">
					<span className="font-medium text-xs">{t('databases.config.relation-target')}</span>
					<Select
						value={textConfig(config, 'targetType') || 'database'}
						onValueChange={(value) => setKey('targetType', value)}
					>
						<SelectTrigger className="h-8 text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="database">Database</SelectItem>
							<SelectItem value="issue">Issue</SelectItem>
							<SelectItem value="mail">Mail</SelectItem>
						</SelectContent>
					</Select>
				</div>
				{(textConfig(config, 'targetType') || 'database') === 'database' ? (
					<div className="space-y-1.5">
						<span className="font-medium text-xs">{t('databases.config.target-database')}</span>
						<Select value={targetDatabaseId} onValueChange={(value) => setKey('targetDatabaseId', value)}>
							<SelectTrigger className="h-8 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{databases.map((database) => (
									<SelectItem key={database.id} value={database.id}>
										{database.title}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				) : null}
			</div>
		)
	}

	if (propType === 'rollup') {
		return (
			<div className="grid gap-3 sm:grid-cols-3">
				<div className="space-y-1.5">
					<span className="font-medium text-xs">{t('databases.config.relation-property')}</span>
					<Select
						value={textConfig(config, 'relationPropertyId')}
						onValueChange={(value) => setKey('relationPropertyId', value)}
					>
						<SelectTrigger className="h-8 text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{relationProperties.map((property) => (
								<SelectItem key={property.id} value={property.id}>
									{property.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="space-y-1.5">
					<span className="font-medium text-xs">{t('databases.config.aggregation')}</span>
					<Select
						value={textConfig(config, 'aggregation') || 'count'}
						onValueChange={(value) => setKey('aggregation', value)}
					>
						<SelectTrigger className="h-8 text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{AGGREGATIONS.map((aggregation) => (
								<SelectItem key={aggregation} value={aggregation}>
									{aggregation}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="space-y-1.5">
					<span className="font-medium text-xs">{t('databases.config.target-property')}</span>
					<Select
						value={textConfig(config, 'targetPropertyId')}
						onValueChange={(value) => setKey('targetPropertyId', value)}
					>
						<SelectTrigger className="h-8 text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{targetDatabaseProperties.map((property) => (
								<SelectItem key={property.id} value={property.id}>
									{property.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>
		)
	}

	return null
}

function aggregationModeLabel(mode: string): string {
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
			return t('databases.table.aggregation.percent_checked')
		default:
			return t('databases.table.aggregation.none')
	}
}

export interface ViewConfigFormProps {
	readonly view: DocDatabaseViewDto
	readonly properties: readonly DocDatabasePropertyDto[]
	readonly onSave: (config: Record<string, unknown>) => Promise<void> | void
}

/** Per-view filter/sort/group/visibility editor. `filter` and `sorts` use the
 * exact keys the server already honors for exports and structured row queries. */
export function ViewConfigForm({ view, properties, onSave }: ViewConfigFormProps) {
	const initial = view.config as Record<string, unknown>
	const [groupBy, setGroupBy] = useState(textConfig(initial, 'groupByPropertyId'))
	const [datePropertyId, setDatePropertyId] = useState(textConfig(initial, 'datePropertyId'))
	const [dependencyPropertyId, setDependencyPropertyId] = useState(
		textConfig(initial, 'dependencyPropertyId')
	)
	const [filter, setFilter] = useState<DatabaseFilterExpr | undefined>(() => {
		const candidate = initial['filter']
		return typeof candidate === 'object' && candidate !== null ? (candidate as DatabaseFilterExpr) : undefined
	})
	const [sortPropertyId, setSortPropertyId] = useState('')
	const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
	const [hidden, setHidden] = useState<Set<string>>(
		() =>
			new Set(Array.isArray(initial['hiddenPropertyIds']) ? (initial['hiddenPropertyIds'] as string[]) : [])
	)
	const [wrapText, setWrapText] = useState(initial['wrapText'] === true)
	const [aggregations, setAggregations] = useState<Record<string, string>>(() => {
		const raw = initial['aggregations']
		if (typeof raw !== 'object' || raw === null) return {}
		return Object.fromEntries(
			Object.entries(raw as Record<string, unknown>).filter(
				(entry): entry is [string, string] => typeof entry[1] === 'string'
			)
		)
	})
	const [error, setError] = useState('')

	async function save() {
		if (filter) {
			const validation = validateDatabaseFilter(filter, properties)
			if (!validation.ok) {
				setError(validation.errors[0] ?? t('databases.config.invalid-filter'))
				return
			}
		}
		setError('')
		await onSave({
			...initial,
			...(filter ? { filter } : {}),
			sorts: sortPropertyId ? [{ propertyId: sortPropertyId, direction: sortDirection }] : [],
			groupByPropertyId: groupBy || undefined,
			datePropertyId: datePropertyId || undefined,
			dependencyPropertyId: dependencyPropertyId || undefined,
			hiddenPropertyIds: [...hidden],
			wrapText,
			aggregations
		})
	}

	return (
		<div className="space-y-4">
			<div className="grid gap-3 sm:grid-cols-2">
				<Select value={groupBy} onValueChange={setGroupBy}>
					<SelectTrigger aria-label={t('databases.config.group-by')} className="h-8 text-xs">
						<SelectValue placeholder={t('databases.config.group-by')} />
					</SelectTrigger>
					<SelectContent>
						{properties
							.filter((p) => ['select', 'status', 'person'].includes(p.propType))
							.map((p) => (
								<SelectItem key={p.id} value={p.id}>
									{p.name}
								</SelectItem>
							))}
					</SelectContent>
				</Select>
				<Select value={datePropertyId} onValueChange={setDatePropertyId}>
					<SelectTrigger aria-label={t('databases.config.date-property')} className="h-8 text-xs">
						<SelectValue placeholder={t('databases.config.date-property')} />
					</SelectTrigger>
					<SelectContent>
						{properties
							.filter((p) => ['date', 'created_time', 'updated_time'].includes(p.propType))
							.map((p) => (
								<SelectItem key={p.id} value={p.id}>
									{p.name}
								</SelectItem>
							))}
					</SelectContent>
				</Select>
				<Select value={dependencyPropertyId} onValueChange={setDependencyPropertyId}>
					<SelectTrigger aria-label={t('databases.config.dependency-property')} className="h-8 text-xs">
						<SelectValue placeholder={t('databases.config.dependency-property')} />
					</SelectTrigger>
					<SelectContent>
						{properties
							.filter((p) => p.propType === 'relation')
							.map((p) => (
								<SelectItem key={p.id} value={p.id}>
									{p.name}
								</SelectItem>
							))}
					</SelectContent>
				</Select>
				<div className="flex gap-1.5">
					<Select value={sortPropertyId} onValueChange={setSortPropertyId}>
						<SelectTrigger aria-label={t('databases.config.sort')} className="h-8 flex-1 text-xs">
							<SelectValue placeholder={t('databases.config.sort')} />
						</SelectTrigger>
						<SelectContent>
							{properties.map((p) => (
								<SelectItem key={p.id} value={p.id}>
									{p.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Select
						value={sortDirection}
						onValueChange={(v) => setSortDirection(v === 'desc' ? 'desc' : 'asc')}
					>
						<SelectTrigger className="h-8 w-24 text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="asc">Asc</SelectItem>
							<SelectItem value="desc">Desc</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>
			<DatabaseFilterBuilder properties={properties} value={filter} onChange={setFilter} />
			{error ? (
				<p role="alert" className="text-destructive text-xs">
					{error}
				</p>
			) : null}
			<label htmlFor="database-wrap-text" className="flex items-center gap-2 text-xs">
				<Checkbox
					id="database-wrap-text"
					checked={wrapText}
					onCheckedChange={(checked) => setWrapText(checked === true)}
				/>
				{t('databases.config.wrap-text')}
			</label>
			<div className="space-y-1.5">
				<span className="font-medium text-xs">{t('databases.config.aggregations')}</span>
				<div className="grid max-h-32 gap-1.5 overflow-y-auto sm:grid-cols-2">
					{properties.map((property) => (
						<div key={property.id} className="grid grid-cols-[1fr_104px] items-center gap-1.5">
							<span className="truncate text-xs">{property.name}</span>
							<Select
								value={aggregations[property.id] ?? 'none'}
								onValueChange={(value) =>
									setAggregations((current) => ({ ...current, [property.id]: value }))
								}
							>
								<SelectTrigger
									aria-label={t('databases.config.aggregation-for', { name: property.name })}
									className="h-7 text-xs"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{['none', 'count', 'unique', 'sum', 'avg', 'min', 'max', 'percent_checked'].map((mode) => (
										<SelectItem key={mode} value={mode}>
											{aggregationModeLabel(mode)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					))}
				</div>
			</div>
			<div className="grid max-h-40 gap-2 overflow-y-auto sm:grid-cols-2">
				{properties.map((property) => (
					<label
						key={property.id}
						htmlFor={`visible-${property.id}`}
						className="flex items-center gap-2 text-xs"
					>
						<Checkbox
							id={`visible-${property.id}`}
							checked={!hidden.has(property.id)}
							onCheckedChange={(checked) => {
								const next = new Set(hidden)
								if (checked === true) next.delete(property.id)
								else next.add(property.id)
								setHidden(next)
							}}
						/>
						<span className="truncate">{property.name}</span>
					</label>
				))}
			</div>
			<DialogFooter>
				<Button type="button" onClick={() => void save()}>
					{t('common.save')}
				</Button>
			</DialogFooter>
		</div>
	)
}
