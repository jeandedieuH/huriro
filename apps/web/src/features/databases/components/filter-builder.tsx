import type { DocDatabasePropertyDto } from '@huriro/contracts'
import type { DatabaseFilterExpr, DatabaseFilterOp } from '@huriro/domain'
import { t } from '@huriro/i18n'
import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const FILTER_OPS: readonly DatabaseFilterOp[] = [
	'eq',
	'neq',
	'in',
	'nin',
	'contains',
	'lt',
	'lte',
	'gt',
	'gte',
	'is_null',
	'is_not_null'
]

interface PredicateDraft {
	readonly key: string
	readonly propertyId: string
	readonly op: DatabaseFilterOp
	readonly value: string
}

function asPredicateDrafts(filter: DatabaseFilterExpr | undefined): {
	mode: 'and' | 'or'
	predicates: PredicateDraft[]
} {
	if (!filter || (filter.kind !== 'and' && filter.kind !== 'or')) return { mode: 'and', predicates: [] }
	const predicates = filter.children.flatMap((child, index) => {
		if (child.kind !== 'predicate') return []
		return [
			{
				key: `${child.propertyId}-${child.op}-${index}`,
				propertyId: child.propertyId,
				op: child.op,
				value: Array.isArray(child.value) ? child.value.join(', ') : String(child.value ?? '')
			}
		]
	})
	return { mode: filter.kind, predicates }
}

function predicateValue(op: DatabaseFilterOp, value: string): unknown {
	if (op === 'is_null' || op === 'is_not_null') return undefined
	if (op === 'in' || op === 'nin') {
		return value
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean)
	}
	return value
}

function buildFilter(
	mode: 'and' | 'or',
	predicates: readonly PredicateDraft[]
): DatabaseFilterExpr | undefined {
	const children = predicates
		.filter((predicate) => predicate.propertyId)
		.map((predicate) => ({
			kind: 'predicate' as const,
			propertyId: predicate.propertyId,
			op: predicate.op,
			...(predicateValue(predicate.op, predicate.value) !== undefined
				? { value: predicateValue(predicate.op, predicate.value) }
				: {})
		}))
	if (children.length === 0) return undefined
	return { kind: mode, children }
}

export interface DatabaseFilterBuilderProps {
	readonly properties: readonly DocDatabasePropertyDto[]
	readonly value: DatabaseFilterExpr | undefined
	readonly onChange: (filter: DatabaseFilterExpr | undefined) => void
}

/** Flat compound filter editor. It intentionally exposes AND/OR predicate
 * groups without nested-tree complexity; the stored expression remains the
 * canonical recursive format understood identically by server SQL and offline
 * replica evaluation. */
export function DatabaseFilterBuilder({ properties, value, onChange }: DatabaseFilterBuilderProps) {
	const [initialDrafts] = useState(() => asPredicateDrafts(value))
	const [mode, setMode] = useState<'and' | 'or'>(initialDrafts.mode)
	const [predicates, setPredicates] = useState<readonly PredicateDraft[]>(initialDrafts.predicates)
	const commit = (nextMode: 'and' | 'or', nextPredicates: readonly PredicateDraft[]) => {
		setMode(nextMode)
		setPredicates(nextPredicates)
		onChange(buildFilter(nextMode, nextPredicates))
	}
	const updatePredicate = (index: number, patch: Partial<PredicateDraft>) => {
		commit(
			mode,
			predicates.map((predicate, i) => (i === index ? { ...predicate, ...patch } : predicate))
		)
	}

	return (
		<div className="space-y-2 rounded-lg border border-border/70 p-2">
			<div className="flex items-center justify-between gap-2">
				<span className="font-medium text-xs">{t('databases.config.filter')}</span>
				<div className="flex items-center gap-1.5">
					<Select value={mode} onValueChange={(next) => commit(next === 'or' ? 'or' : 'and', predicates)}>
						<SelectTrigger aria-label={t('databases.config.filter-mode')} className="h-7 w-24 text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="and">{t('databases.config.filter-and')}</SelectItem>
							<SelectItem value="or">{t('databases.config.filter-or')}</SelectItem>
						</SelectContent>
					</Select>
					<Button
						type="button"
						size="sm"
						tone="outline"
						className="h-7 text-xs"
						onClick={() =>
							commit(mode, [
								...predicates,
								{ key: `new-${Date.now()}-${predicates.length}`, propertyId: '', op: 'contains', value: '' }
							])
						}
					>
						<Plus className="size-3" aria-hidden />
						{t('databases.config.filter-add')}
					</Button>
				</div>
			</div>
			{predicates.length === 0 ? (
				<p className="text-muted-foreground text-xs">{t('databases.config.filter-empty')}</p>
			) : null}
			{predicates.map((predicate, index) => (
				<div key={predicate.key} className="grid gap-1.5 sm:grid-cols-[1fr_120px_1fr_28px]">
					<Select
						value={predicate.propertyId}
						onValueChange={(next) => updatePredicate(index, { propertyId: next })}
					>
						<SelectTrigger aria-label={t('databases.config.filter-property')} className="h-8 text-xs">
							<SelectValue placeholder={t('databases.config.filter-property')} />
						</SelectTrigger>
						<SelectContent>
							{properties.map((property) => (
								<SelectItem key={property.id} value={property.id}>
									{property.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Select
						value={predicate.op}
						onValueChange={(next) => updatePredicate(index, { op: next as DatabaseFilterOp })}
					>
						<SelectTrigger aria-label={t('databases.config.filter-operator')} className="h-8 text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{FILTER_OPS.map((op) => (
								<SelectItem key={op} value={op}>
									{op}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Input
						aria-label={t('databases.config.filter-value')}
						value={predicate.value}
						disabled={predicate.op === 'is_null' || predicate.op === 'is_not_null'}
						onChange={(event) => updatePredicate(index, { value: event.target.value })}
						className="h-8 text-xs"
					/>
					<Button
						type="button"
						size="icon"
						tone="ghost"
						aria-label={t('databases.config.filter-remove')}
						className="size-8"
						onClick={() =>
							commit(
								mode,
								predicates.filter((_, i) => i !== index)
							)
						}
					>
						<X className="size-3.5" aria-hidden />
					</Button>
				</div>
			))}
		</div>
	)
}
