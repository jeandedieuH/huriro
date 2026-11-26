import type { DocDatabasePropertyDto, DocDatabaseRowDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Settings2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { PropertyConfigForm } from './database-config'

export interface PropertyEditorDialogProps {
	readonly property: DocDatabasePropertyDto
	readonly properties: readonly DocDatabasePropertyDto[]
	readonly allProperties?: readonly DocDatabasePropertyDto[] | undefined
	readonly sampleRow?: DocDatabaseRowDto | undefined
	readonly databases: readonly { readonly id: string; readonly title: string }[]
	readonly disabled?: boolean | undefined
	readonly onSave: (patch: { name: string; config: Record<string, unknown> }) => Promise<void> | void
}

/** Edit surface for an existing database property. Property type stays fixed
 * because changing storage semantics in place is unsafe, but its display name
 * and type-specific JSON configuration remain editable. */
export function PropertyEditorDialog({
	property,
	properties,
	allProperties,
	sampleRow,
	databases,
	disabled,
	onSave
}: PropertyEditorDialogProps) {
	const [open, setOpen] = useState(false)
	const [name, setName] = useState(property.name)
	const [config, setConfig] = useState<Record<string, unknown>>(property.config)
	const [saving, setSaving] = useState(false)

	async function save() {
		if (!name.trim()) return
		setSaving(true)
		try {
			await onSave({ name: name.trim(), config })
			setOpen(false)
		} finally {
			setSaving(false)
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (next) {
					setName(property.name)
					setConfig(property.config)
				}
				setOpen(next)
			}}
		>
			<DialogTrigger asChild>
				<button
					type="button"
					disabled={disabled}
					aria-label={t('databases.property.edit')}
					className="rounded p-0.5 text-muted-foreground/70 opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/property:opacity-100 disabled:hidden"
				>
					<Settings2 className="size-3" aria-hidden />
				</button>
			</DialogTrigger>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>{t('databases.property.edit-title')}</DialogTitle>
				</DialogHeader>
				<Input
					aria-label={t('databases.property.name')}
					value={name}
					onChange={(event) => setName(event.target.value)}
				/>
				<PropertyConfigForm
					propType={property.propType}
					config={config}
					properties={properties}
					allProperties={allProperties}
					sampleRow={sampleRow}
					databases={databases}
					onChange={setConfig}
				/>
				<DialogFooter>
					<Button type="button" disabled={saving || !name.trim()} onClick={() => void save()}>
						{t('common.save')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
