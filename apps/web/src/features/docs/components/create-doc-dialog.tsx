import type { DocPageDto, DocVisibility } from '@huriro/contracts'
import { BUILTIN_DOC_TEMPLATES } from '@huriro/editor'
import { t } from '@huriro/i18n'
import { useSyncEngine } from '@huriro/sync-client'
import { type FormEvent, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useUiStore } from '@/stores/ui-store'

export interface CreateDocDialogProps {
	readonly pages: readonly DocPageDto[]
	readonly defaultParentId?: string | null
	readonly onCreated?: (page: DocPageDto) => void
}

export function CreateDocDialog({ pages, defaultParentId = null, onCreated }: CreateDocDialogProps) {
	const engine = useSyncEngine()
	const open = useUiStore((s) => s.createDocOpen)
	const setOpen = useUiStore((s) => s.setCreateDocOpen)
	const pushToast = useUiStore((s) => s.pushToast)

	const [title, setTitle] = useState('')
	const [parentId, setParentId] = useState<string>(defaultParentId ?? 'root')
	const [templateId, setTemplateId] = useState<string>('blank')
	const [visibility, setVisibility] = useState<DocVisibility>('workspace')
	const [busy, setBusy] = useState(false)

	const workspaceTemplates = useMemo(
		() => pages.filter((p) => p.archivedAt === null && p.isTemplate),
		[pages]
	)
	const eligibleParents = useMemo(
		() => pages.filter((p) => p.archivedAt === null && !p.isTemplate && p.depth < 20),
		[pages]
	)

	async function handleSubmit(ev: FormEvent) {
		ev.preventDefault()
		const clean = title.trim()
		if (!clean || busy) return
		setBusy(true)
		try {
			const created = await engine.createDocPage({
				title: clean,
				parentId: parentId === 'root' ? null : parentId,
				visibility,
				...(templateId !== 'blank' ? { templateId } : {})
			})
			setTitle('')
			setTemplateId('blank')
			setOpen(false)
			onCreated?.(created)
			pushToast({ tone: 'success', title: created.title })
		} catch (err) {
			pushToast({
				tone: 'danger',
				title: err instanceof Error ? err.message : 'Failed to create page'
			})
		} finally {
			setBusy(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>{t('docs.create.title')}</DialogTitle>
				</DialogHeader>

				<form onSubmit={(ev) => void handleSubmit(ev)} className="space-y-4">
					<div className="space-y-1.5">
						<label htmlFor="create-doc-title" className="text-xs font-medium">
							{t('docs.create.title-label')}
						</label>
						<Input
							id="create-doc-title"
							value={title}
							onChange={(ev) => setTitle(ev.target.value)}
							placeholder={t('docs.create.title-placeholder')}
							required
						/>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1.5">
							<span className="text-xs font-medium">{t('docs.create.parent-label')}</span>
							<Select value={parentId} onValueChange={setParentId}>
								<SelectTrigger aria-label={t('docs.create.parent-label')}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="root">{t('docs.create.root-option')}</SelectItem>
									{eligibleParents.map((p) => (
										<SelectItem key={p.id} value={p.id}>
											{p.title}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-1.5">
							<span className="text-xs font-medium">{t('docs.create.visibility-label')}</span>
							<Select value={visibility} onValueChange={(v) => setVisibility(v as DocVisibility)}>
								<SelectTrigger aria-label={t('docs.create.visibility-label')}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="workspace">{t('tasks.project.visibility-workspace')}</SelectItem>
									<SelectItem value="private">{t('tasks.project.visibility-private')}</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className="space-y-1.5">
						<span className="text-xs font-medium">{t('docs.create.template-label')}</span>
						<Select value={templateId} onValueChange={setTemplateId}>
							<SelectTrigger aria-label={t('docs.create.template-label')}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="blank">{t('docs.create.blank-template')}</SelectItem>
								{/* 'blank' is covered by the i18n'd item above — render it again and Radix treats both as selected, concatenating their labels in the trigger */}
								{BUILTIN_DOC_TEMPLATES.filter((tpl) => tpl.id !== 'blank').map((tpl) => (
									<SelectItem key={tpl.id} value={tpl.id}>
										{tpl.title}
									</SelectItem>
								))}
								{workspaceTemplates.map((tpl) => (
									<SelectItem key={tpl.id} value={tpl.id}>
										{tpl.title}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<DialogFooter>
						<Button type="button" tone="outline" onClick={() => setOpen(false)}>
							{t('common.cancel')}
						</Button>
						<Button type="submit" disabled={!title.trim()} loading={busy}>
							{t('docs.create.submit')}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
