import type { DocDatabasePropertyDto, DocDatabaseRowDto } from '@huriro/contracts'
import { evaluateFormula, type FormulaValue, isFormulaDate, validateFormulaSource } from '@huriro/domain'
import { t } from '@huriro/i18n'
import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

const FUNCTION_HINTS = [
	'prop("Name")',
	'if(condition, then, else)',
	'concat(a, b)',
	'dateAdd(date, amount, "days")',
	'map(list, x -> x * 2)',
	'filter(list, x -> x > 0)',
	'sum(list)',
	'formatDate(date, "YYYY-MM-DD")'
] as const

export interface FormulaEditorProps {
	readonly value: string
	readonly properties: readonly DocDatabasePropertyDto[]
	readonly sampleRow?: DocDatabaseRowDto | undefined
	readonly onChange: (value: string) => void
}

function formulaCellValue(
	row: DocDatabaseRowDto,
	property: DocDatabasePropertyDto
): FormulaValue | undefined {
	if (property.propType === 'title') return row.title
	if (property.propType === 'created_time') return { kind: 'date', iso: row.createdAt }
	if (property.propType === 'updated_time') return { kind: 'date', iso: row.updatedAt }
	const cell = row.cells[property.id]
	if (!cell) return null
	if (cell.text !== null) return cell.text
	if (cell.number !== null) return cell.number
	if (cell.boolean !== null) return cell.boolean
	if (cell.dateStart !== null) return { kind: 'date', iso: cell.dateStart }
	if (Array.isArray(cell.json)) {
		return cell.json.map((item) => {
			if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') return item
			if (typeof item === 'object' && item !== null) {
				const record = item as Record<string, unknown>
				return String(
					record['name'] ?? record['title'] ?? record['filename'] ?? record['subject'] ?? record['id'] ?? ''
				)
			}
			return String(item ?? '')
		})
	}
	return null
}

function formatFormulaPreview(value: FormulaValue): string {
	if (Array.isArray(value)) return value.map(formatFormulaPreview).join(', ')
	if (isFormulaDate(value)) return value.iso.slice(0, 10)
	if (value === null) return 'null'
	return String(value)
}

/** Sandboxed formula authoring surface: validation is pure/domain-owned and output previews are text-only. */
export function FormulaEditor({ value, properties, sampleRow, onChange }: FormulaEditorProps) {
	const validation = useMemo(() => validateFormulaSource(value), [value])
	const preview = useMemo(() => {
		if (!validation.ok || !sampleRow) return null
		try {
			const result = evaluateFormula(value, {
				now: new Date(),
				prop: (name) => {
					const property = properties.find((candidate) => candidate.name === name)
					return property ? formulaCellValue(sampleRow, property) : undefined
				}
			})
			return { ok: true as const, text: formatFormulaPreview(result) }
		} catch (error) {
			return { ok: false as const, text: error instanceof Error ? error.message : String(error) }
		}
	}, [properties, sampleRow, validation.ok, value])
	const insertToken = (token: string) => {
		onChange(value + (value.endsWith(' ') || value.length === 0 ? '' : ' ') + token)
	}
	return (
		<div className="space-y-3">
			<Textarea
				aria-label={t('databases.formula.editor-label')}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				rows={7}
				className="font-mono text-sm"
				placeholder='prop("Estimate") * 2'
			/>
			<div className="flex flex-wrap gap-1.5">
				{properties
					.filter((p) => !['formula', 'rollup'].includes(p.propType))
					.slice(0, 12)
					.map((property) => (
						<Button
							key={property.id}
							type="button"
							size="sm"
							tone="outline"
							className="h-7 text-xs"
							onClick={() => insertToken(`prop("${property.name.replaceAll('"', '\\"')}")`)}
						>
							{property.name}
						</Button>
					))}
			</div>
			<details className="rounded-lg border border-border/70 bg-muted/30 p-2 text-xs">
				<summary className="cursor-pointer font-medium">{t('databases.formula.functions')}</summary>
				<div className="mt-2 flex flex-wrap gap-1.5">
					{FUNCTION_HINTS.map((hint) => (
						<button
							key={hint}
							type="button"
							onClick={() => insertToken(hint)}
							className="rounded border border-border/70 bg-background px-1.5 py-0.5 font-mono hover:bg-accent"
						>
							{hint}
						</button>
					))}
				</div>
			</details>
			<div className="flex items-center gap-2">
				<Badge tone={validation.ok ? 'success' : 'danger'}>
					{validation.ok ? t('databases.formula.valid') : t('databases.formula.invalid')}
				</Badge>
				{!validation.ok ? <p className="text-destructive text-xs">{validation.error?.message}</p> : null}
			</div>
			{preview ? (
				<div className="rounded-lg border border-border/70 bg-muted/30 p-2 text-xs">
					<span className="font-medium">{t('databases.formula.preview')}: </span>
					<span className={preview.ok ? 'font-mono' : 'text-destructive'}>{preview.text}</span>
				</div>
			) : null}
		</div>
	)
}
