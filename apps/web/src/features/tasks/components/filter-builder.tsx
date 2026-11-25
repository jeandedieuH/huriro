import {
	appendFilterNode,
	countFilterNodes,
	createPredicate,
	FILTER_FIELDS,
	type FilterExpr,
	type FilterField,
	type FilterOp,
	patchPredicate,
	removeFilterNode,
	setFilterCombinator,
	validateFilter
} from '@huriro/domain'
import { t } from '@huriro/i18n'
import { ListFilter, Plus, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useUiStore } from '@/stores/ui-store'

/**
 * Compound filter builder (§3.4). Edits a FilterExpr tree immutably through
 * the pure domain helpers (`@huriro/domain/filter-builder`); Apply validates
 * the tree and stores it in the ui-store, where the workspace evaluates it
 * against the local replica via `evaluateFilter` (offline-first: filtering
 * never requires a round-trip).
 *
 * Scope note: one nested group level is rendered; deeper server-authored
 * trees round-trip losslessly but display flattened rows (documented in the
 * slice report).
 */
export function FilterBuilderButton() {
	const filterExpr = useUiStore((s) => s.filterExpr)
	const setFilterExpr = useUiStore((s) => s.setFilterExpr)
	const [open, setOpen] = useState(false)
	const [draft, setDraft] = useState<FilterExpr | null>(null)
	// Rows shift position as predicates are added/removed, so positional keys
	// would remount the wrong editors; parallel ids allocated per row stay stable.
	const rowSeq = useRef(0)
	const [rowIds, setRowIds] = useState<readonly string[]>([])
	const nextRowId = () => {
		rowSeq.current += 1
		return `row-${rowSeq.current}`
	}

	const activeCount = useMemo(
		() => (filterExpr ? countFilterNodes(filterExpr as FilterExpr) - 1 : 0),
		[filterExpr]
	)
	const validation = useMemo(() => (draft ? validateFilter(draft) : null), [draft])

	const startEdit = () => {
		const initial = filterExpr
			? (structuredClone(filterExpr) as FilterExpr)
			: ({ kind: 'and', args: [] } as FilterExpr)
		setDraft(initial)
		const argCount = 'args' in (initial as object) ? ((initial as { args?: unknown[] }).args?.length ?? 0) : 0
		setRowIds(Array.from({ length: argCount }, () => nextRowId()))
	}

	const rows = useMemo(() => {
		if (draft?.kind !== 'and' || !('args' in draft)) return []
		return (draft as unknown as { args: FilterExpr[] }).args
	}, [draft])

	const patchRow = (idx: number, patch: Parameters<typeof patchPredicate>[1]) => {
		if (!draft) return
		setDraft((cur) => {
			if (!cur) return cur
			const args = rows.map((row, i) => (i === idx && row.kind === 'pred' ? patchPredicate(row, patch) : row))
			return { ...(cur as object), kind: 'and', args } as FilterExpr
		})
	}

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next)
				if (next) startEdit()
			}}
		>
			<PopoverTrigger asChild>
				<Button
					size="sm"
					tone={activeCount > 0 ? 'secondary' : 'outline'}
					aria-label={t('tasks.filter.builder')}
				>
					<ListFilter className="size-3.5" aria-hidden />
					{t('tasks.filter.builder')}
					{activeCount > 0 ? (
						<span className="rounded-full bg-primary/15 px-1.5 text-xs tnum">{activeCount}</span>
					) : null}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-136 space-y-2 p-3">
				<div className="flex items-center justify-between">
					<span className="text-xs font-medium text-muted-foreground">{t('tasks.filter.builder')}</span>
					{draft ? (
						<select
							aria-label={t('tasks.filter.match')}
							className="rounded border border-border bg-background px-1 py-0.5 text-xs"
							value={draft.kind === 'or' ? 'or' : 'and'}
							onChange={(e) => setDraft(setFilterCombinator(draft, e.target.value === 'or' ? 'or' : 'and'))}
						>
							<option value="and">{t('tasks.filter.match.all')}</option>
							<option value="or">{t('tasks.filter.match.any')}</option>
						</select>
					) : null}
				</div>

				<ul className="max-h-72 space-y-1.5 overflow-y-auto">
					{rows.map((row, idx) =>
						row.kind === 'pred' ? (
							<PredicateRow
								key={rowIds[idx] ?? `row-missing-${idx}`}
								field={row.field}
								op={row.op}
								value={'value' in row ? row.value : undefined}
								onPatch={(p) => patchRow(idx, p)}
								onRemove={() => {
									if (!draft) return
									setDraft(removeFilterNode(draft, [idx]))
									setRowIds((cur) => cur.filter((_, i) => i !== idx))
								}}
							/>
						) : null
					)}
				</ul>

				<div className="flex items-center gap-2">
					<Button
						size="sm"
						tone="ghost"
						onClick={() => {
							if (!draft) return
							setDraft(appendFilterNode(draft, [], createPredicate('status_category')) as FilterExpr)
							setRowIds((cur) => [...cur, nextRowId()])
						}}
					>
						<Plus className="size-3" aria-hidden /> {t('tasks.filter.add-rule')}
					</Button>
					<div className="flex-1" />
					{validation && !validation.ok ? (
						<span className="text-xs text-warning">{t('tasks.filter.incomplete')}</span>
					) : null}
					{filterExpr ? (
						<Button
							size="sm"
							tone="ghost"
							onClick={() => {
								setFilterExpr(null)
								setOpen(false)
							}}
						>
							{t('tasks.filter.clear')}
						</Button>
					) : null}
					<Button
						size="sm"
						disabled={!validation?.ok}
						onClick={() => {
							if (draft && validation?.ok) {
								setFilterExpr(countFilterNodes(draft) > 1 ? draft : null)
								setOpen(false)
							}
						}}
					>
						{t('tasks.filter.apply')}
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	)
}

const VALUELESS: readonly FilterOp[] = ['is_null', 'is_not_null']

function PredicateRow({
	field,
	op,
	value,
	onPatch,
	onRemove
}: {
	readonly field: FilterField
	readonly op: FilterOp
	readonly value: unknown
	readonly onPatch: (patch: { field?: FilterField; op?: FilterOp; value?: never }) => void
	readonly onRemove: () => void
}) {
	const def = FILTER_FIELDS[field] as (typeof FILTER_FIELDS)[keyof typeof FILTER_FIELDS] & {
		readonly values?: readonly (string | number)[]
	}
	const fields = Object.keys(FILTER_FIELDS) as FilterField[]
	const isMulti = op === 'in' || op === 'nin'
	return (
		<li className="flex items-center gap-1.5">
			<select
				aria-label={t('tasks.filtervalue.title')}
				className="w-32 rounded border border-border bg-background px-1 py-1 text-xs"
				value={field}
				onChange={(e) => onPatch({ field: e.target.value as FilterField })}
			>
				{fields.map((f) => (
					<option key={f} value={f}>
						{t(`tasks.filtervalue.${f}` as never)}
					</option>
				))}
			</select>
			<select
				aria-label="op"
				className="w-28 rounded border border-border bg-background px-1 py-1 text-xs"
				value={op}
				onChange={(e) => onPatch({ op: e.target.value as FilterOp })}
			>
				{def.ops.map((o) => (
					<option key={o} value={o}>
						{opLabel(o, def.type)}
					</option>
				))}
			</select>
			{VALUELESS.includes(op) ? null : (
				<FilterValueInput
					type={def.type}
					values={def.values}
					multi={isMulti}
					value={value}
					onChange={(v) => onPatch({ value: v as never })}
				/>
			)}
			<Button size="sm" tone="ghost" aria-label={t('tasks.filter.remove-rule')} onClick={onRemove}>
				<Trash2 className="size-3" aria-hidden />
			</Button>
		</li>
	)
}

function opLabel(op: FilterOp, type: string): string {
	if ((type === 'int' || type === 'number') && ['lt', 'lte', 'gt', 'gte'].includes(op)) {
		return t(`tasks.filterop.${op}.num` as never)
	}
	return t(`tasks.filterop.${op}` as never)
}

/** Value editor per field type — enum pickers, numbers, dates, relative dates, free text. */
function FilterValueInput({
	type,
	values,
	multi,
	value,
	onChange
}: {
	readonly type: string
	readonly values?: readonly (string | number)[] | undefined
	readonly multi: boolean
	readonly value: unknown
	readonly onChange: (v: unknown) => void
}) {
	if (values && values.length > 0) {
		if (multi) {
			const arr = Array.isArray(value) ? (value as (string | number)[]) : []
			return (
				<select
					multiple
					aria-label={t('tasks.value-placeholder')}
					className="h-16 min-w-36 flex-1 rounded border border-border bg-background px-1 py-0.5 text-xs"
					value={arr.map(String)}
					onChange={(e) => {
						const picked = Array.from(e.target.selectedOptions).map((o) => {
							const raw = values[Number(o.dataset['idx'])]
							return raw ?? o.value
						})
						onChange(picked)
					}}
				>
					{values.map((v, i) => (
						<option key={String(v)} value={String(v)} data-idx={i}>
							{enumLabel(type, v)}
						</option>
					))}
				</select>
			)
		}
		return (
			<select
				aria-label={t('tasks.value-placeholder')}
				className="min-w-36 flex-1 rounded border border-border bg-background px-1 py-1 text-xs"
				value={String(value ?? values[0])}
				onChange={(e) => {
					const match = values.find((v) => String(v) === e.target.value)
					onChange(match ?? e.target.value)
				}}
			>
				{values.map((v) => (
					<option key={String(v)} value={String(v)}>
						{enumLabel(type, v)}
					</option>
				))}
			</select>
		)
	}
	if (type === 'int' || type === 'number') {
		return (
			<input
				type="number"
				aria-label={t('tasks.value-placeholder')}
				className="w-24 rounded border border-border bg-background px-1.5 py-1 text-xs"
				value={typeof value === 'number' ? value : 0}
				onChange={(e) => onChange(Number(e.target.value))}
			/>
		)
	}
	if (type === 'date' || type === 'datetime') {
		// ISO date or Linear-style relative shorthand (+7d / -48h) — both validate.
		const isRel = typeof value === 'object' && value !== null && 'relative' in (value as object)
		return (
			<input
				type="text"
				aria-label={t('tasks.value-placeholder')}
				placeholder={isRel ? t('tasks.relative-date-placeholder') : t('tasks.date-placeholder')}
				className="w-32 rounded border border-border bg-background px-1.5 py-1 font-mono text-xs"
				value={
					isRel ? String((value as { relative: string }).relative) : typeof value === 'string' ? value : ''
				}
				onChange={(e) => {
					const raw = e.target.value
					if (/^[+-]\d{1,4}[mhdw]$/.test(raw)) onChange({ relative: raw })
					else onChange(raw)
				}}
			/>
		)
	}
	return (
		<input
			type="text"
			aria-label={t('tasks.value-placeholder')}
			className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-1 text-xs"
			value={typeof value === 'string' ? value : ''}
			onChange={(e) => onChange(e.target.value)}
		/>
	)
}

function enumLabel(type: string, v: string | number): string {
	if (type === 'enum') {
		const key = String(v)
		if (['backlog', 'unstarted', 'started', 'completed', 'cancelled'].includes(key)) {
			return t(`tasks.category.${key}` as never)
		}
		if (['none', 'pending', 'accepted', 'snoozed', 'declined', 'merged'].includes(key)) {
			return t(`tasks.triagestatus.${key}` as never)
		}
		if (['manual', 'mail', 'chat', 'form', 'github', 'gitlab', 'api', 'agent'].includes(key)) {
			return t(`tasks.source.${key}` as never)
		}
		if (['user', 'agent'].includes(key)) return key
	}
	return String(v)
}
