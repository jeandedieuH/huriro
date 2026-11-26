import type { CreateProjectBody } from '@huriro/contracts'
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
import {
	DEFAULT_PROJECT_WORKFLOW_POLICY,
	ProjectWorkflowFields,
	type ProjectWorkflowPolicy
} from './project-workflow-fields'

const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/

export interface CreateProjectDialogProps {
	readonly onSubmit: (input: Omit<CreateProjectBody, 'id' | 'position'>) => Promise<void>
}

export function CreateProjectDialog({ onSubmit }: CreateProjectDialogProps) {
	const open = useUiStore((s) => s.createProjectOpen)
	const setOpen = useUiStore((s) => s.setCreateProjectOpen)
	const pushToast = useUiStore((s) => s.pushToast)

	const [key, setKey] = useState('')
	const [name, setName] = useState('')
	const [visibility, setVisibility] = useState<'workspace' | 'private'>('workspace')
	const [description, setDescription] = useState('')
	const [workflow, setWorkflow] = useState<ProjectWorkflowPolicy>(DEFAULT_PROJECT_WORKFLOW_POLICY)
	const [submitting, setSubmitting] = useState(false)
	const [keyTouched, setKeyTouched] = useState(false)

	const cleanKey = key.trim().toUpperCase()
	const isKeyValid = PROJECT_KEY_RE.test(cleanKey)
	const showKeyError = (keyTouched || cleanKey.length > 0) && cleanKey.length > 0 && !isKeyValid

	async function handleSubmit(ev: React.FormEvent) {
		ev.preventDefault()
		setKeyTouched(true)
		if (!isKeyValid || !name.trim() || submitting) return
		setSubmitting(true)
		try {
			await onSubmit({
				key: cleanKey,
				name: name.trim(),
				visibility,
				description: description.trim(),
				triageEnabled: workflow.triageEnabled,
				cycleEnabled: workflow.cycleEnabled,
				...(workflow.cycleEnabled
					? {
							cycleDurationDays: workflow.cycleDurationDays,
							cycleCooldownDays: workflow.cycleCooldownDays,
							cycleAutoRolloverMode: workflow.cycleAutoRolloverMode,
							cycleStartWeekday: workflow.cycleStartWeekday
						}
					: {})
			})
			setKey('')
			setKeyTouched(false)
			setName('')
			setDescription('')
			setVisibility('workspace')
			setWorkflow(DEFAULT_PROJECT_WORKFLOW_POLICY)
			setOpen(false)
		} catch (err) {
			pushToast({
				tone: 'danger',
				title: err instanceof Error ? err.message : t('error.title')
			})
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="max-h-[85vh] overflow-y-auto">
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
								onBlur={() => setKeyTouched(true)}
								placeholder={t('tasks.project.key-placeholder')}
								minLength={2}
								maxLength={10}
								pattern="^[A-Z][A-Z0-9]{1,9}$"
								aria-invalid={showKeyError}
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
					<p className={showKeyError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
						{t('tasks.project.key-hint')}
					</p>

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

					<ProjectWorkflowFields
						idPrefix="create-proj"
						value={workflow}
						onChange={(patch) => setWorkflow((prev) => ({ ...prev, ...patch }))}
					/>

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
						<Button type="submit" disabled={!isKeyValid || !name.trim()} loading={submitting}>
							{t('tasks.project.submit')}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
