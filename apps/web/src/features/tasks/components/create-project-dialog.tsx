import { t } from '@huriro/i18n'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useUiStore } from '@/stores/ui-store'

export interface CreateProjectDialogProps {
	readonly onSubmit: (input: {
		key: string
		name: string
		visibility: 'workspace' | 'private'
		description: string
	}) => Promise<void>
}

export function CreateProjectDialog({ onSubmit }: CreateProjectDialogProps) {
	const open = useUiStore((s) => s.createProjectOpen)
	const setOpen = useUiStore((s) => s.setCreateProjectOpen)

	const [key, setKey] = useState('')
	const [name, setName] = useState('')
	const [visibility, setVisibility] = useState<'workspace' | 'private'>('workspace')
	const [description, setDescription] = useState('')
	const [submitting, setSubmitting] = useState(false)

	async function handleSubmit(ev: React.FormEvent) {
		ev.preventDefault()
		const cleanKey = key.trim().toUpperCase()
		if (!cleanKey || !name.trim() || submitting) return
		setSubmitting(true)
		try {
			await onSubmit({
				key: cleanKey,
				name: name.trim(),
				visibility,
				description: description.trim()
			})
			setKey('')
			setName('')
			setDescription('')
			setVisibility('workspace')
			setOpen(false)
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('tasks.new-project')}</DialogTitle>
					<DialogDescription>
						Private projects are enforced at PostgreSQL RLS and sync boundaries.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={(ev) => void handleSubmit(ev)} className="space-y-4">
					<div className="grid grid-cols-3 gap-3">
						<div className="space-y-1">
							<label htmlFor="create-proj-key" className="text-xs font-medium">
								{t('tasks.project.key')}
							</label>
							<Input
								id="create-proj-key"
								value={key}
								onChange={(ev) => setKey(ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
								placeholder={t('tasks.project.key-placeholder')}
								maxLength={12}
								required
							/>
						</div>
						<div className="col-span-2 space-y-1">
							<label htmlFor="create-proj-name" className="text-xs font-medium">
								{t('tasks.project.name')}
							</label>
							<Input
								id="create-proj-name"
								value={name}
								onChange={(ev) => setName(ev.target.value)}
								placeholder={t('tasks.project.name-placeholder')}
								required
							/>
						</div>
					</div>

					<div className="space-y-1">
						<span className="text-xs font-medium">{t('tasks.project.visibility')}</span>
						<Select value={visibility} onValueChange={(v) => setVisibility(v as 'workspace' | 'private')}>
							<SelectTrigger aria-label={t('tasks.project.visibility')}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="workspace">{t('tasks.project.visibility-workspace')}</SelectItem>
								<SelectItem value="private">{t('tasks.project.visibility-private')}</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-1">
						<label htmlFor="create-proj-desc" className="text-xs font-medium">
							{t('tasks.create.description-label')}
						</label>
						<Textarea
							id="create-proj-desc"
							value={description}
							onChange={(ev) => setDescription(ev.target.value)}
							rows={2}
						/>
					</div>

					<DialogFooter>
						<Button type="button" tone="outline" onClick={() => setOpen(false)}>
							{t('common.cancel')}
						</Button>
						<Button type="submit" disabled={!key.trim() || !name.trim()} loading={submitting}>
							{t('tasks.project.submit')}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
