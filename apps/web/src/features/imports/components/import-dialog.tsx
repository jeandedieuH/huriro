import type {
	GithubImportPayload,
	ImportDryRunBody,
	ImportDryRunPreviewDto,
	ImportExecuteBody,
	ImportJobDto,
	LinearImportPayload
} from '@huriro/contracts'
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
import type { TaskApiBridge } from '@/lib/sync-bootstrap'
import { useUiStore } from '@/stores/ui-store'

export interface ImportDialogProps {
	readonly api: TaskApiBridge
	readonly onImported?: () => void
}

const SAMPLE_LINEAR_JSON = JSON.stringify(
	[
		{
			id: 'lin-101',
			identifier: 'OLD-101',
			title: 'Migrate auth callbacks to PKCE flow',
			description: 'Imported cleanly with redirect mapping.',
			priority: 3,
			stateName: 'Todo'
		}
	],
	null,
	2
)

export function ImportDialog({ api, onImported }: ImportDialogProps) {
	const open = useUiStore((s) => s.importDialogOpen)
	const setOpen = useUiStore((s) => s.setImportDialogOpen)
	const pushToast = useUiStore((s) => s.pushToast)

	const [source, setSource] = useState<'linear' | 'github'>('linear')
	const [projectKey, setProjectKey] = useState('IMP')
	const [payloadText, setPayloadText] = useState(SAMPLE_LINEAR_JSON)
	const [dryRun, setDryRun] = useState<ImportDryRunPreviewDto | null>(null)
	const [result, setResult] = useState<ImportJobDto | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)

	function buildRequestBody(): ImportDryRunBody | null {
		setError(null)
		try {
			const parsed = JSON.parse(payloadText) as unknown[]
			if (!Array.isArray(parsed)) {
				setError('JSON payload must be an array of issues')
				return null
			}
			const cleanKey = projectKey.trim().toUpperCase()
			if (!cleanKey) {
				setError('Target project key is required')
				return null
			}
			if (source === 'linear') {
				return {
					source: 'linear',
					linear: {
						projectKey: cleanKey,
						projectName: cleanKey,
						issues: parsed as LinearImportPayload['issues']
					}
				}
			}
			return {
				source: 'github',
				github: {
					repo: 'owner/repo',
					projectKey: cleanKey,
					projectName: cleanKey,
					issues: parsed as GithubImportPayload['issues']
				}
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Invalid JSON payload')
			return null
		}
	}

	async function handlePreview() {
		const body = buildRequestBody()
		if (!body || busy) return
		setBusy(true)
		setResult(null)
		try {
			const res = await api.importDryRun(body)
			setDryRun(res)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Preview failed')
		} finally {
			setBusy(false)
		}
	}

	async function handleExecute() {
		const body = buildRequestBody()
		if (!body || busy) return
		setBusy(true)
		try {
			const execBody: ImportExecuteBody = {
				source: body.source,
				...(dryRun?.jobId ? { jobId: dryRun.jobId } : {}),
				...(body.linear ? { linear: body.linear } : {}),
				...(body.github ? { github: body.github } : {})
			}
			const res = await api.importExecute(execBody)
			setResult(res)
			onImported?.()
			pushToast({
				tone: 'success',
				title: t('imports.complete', {
					issues: Number(res.report['importedIssues'] ?? 0),
					comments: Number(res.report['importedComments'] ?? 0)
				})
			})
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Import failed')
		} finally {
			setBusy(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="max-w-xl">
				<DialogHeader>
					<DialogTitle>{t('imports.title')}</DialogTitle>
					<DialogDescription>
						Run a zero-write dry-run preview before creating issues and legacy ID mappings.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1">
							<span className="text-xs font-medium">{t('imports.source')}</span>
							<Select
								value={source}
								onValueChange={(v) => {
									setSource(v as 'linear' | 'github')
									setDryRun(null)
									setResult(null)
								}}
							>
								<SelectTrigger aria-label={t('imports.source')}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="linear">{t('imports.source.linear')}</SelectItem>
									<SelectItem value="github">{t('imports.source.github')}</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1">
							<label htmlFor="import-target-key" className="text-xs font-medium">
								{t('tasks.project.key')}
							</label>
							<Input
								id="import-target-key"
								value={projectKey}
								onChange={(ev) => setProjectKey(ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
								maxLength={12}
							/>
						</div>
					</div>

					<div className="space-y-1">
						<label htmlFor="import-json-payload" className="text-xs font-medium">
							{t('imports.payload-label')}
						</label>
						<Textarea
							id="import-json-payload"
							value={payloadText}
							onChange={(ev) => {
								setPayloadText(ev.target.value)
								setDryRun(null)
							}}
							rows={6}
							className="font-mono text-xs"
						/>
					</div>

					{error ? (
						<p role="alert" className="text-xs text-destructive">
							{error}
						</p>
					) : null}

					{dryRun ? (
						<div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
							<p className="font-medium">
								{t('imports.preview-summary', {
									issues: dryRun.counts.issues,
									comments: dryRun.counts.comments,
									skipped: dryRun.counts.skippedExisting
								})}
							</p>
						</div>
					) : null}

					{result ? (
						<div className="rounded-md border border-(--success)/40 bg-(--success)/10 p-3 text-xs text-(--success)">
							<p className="font-medium">
								{t('imports.complete', {
									issues: Number(result.report['importedIssues'] ?? 0),
									comments: Number(result.report['importedComments'] ?? 0)
								})}
							</p>
						</div>
					) : null}
				</div>

				<DialogFooter>
					<Button type="button" tone="outline" onClick={() => setOpen(false)}>
						{t('common.close')}
					</Button>
					<Button type="button" tone="secondary" onClick={() => void handlePreview()} loading={busy}>
						{t('imports.preview')}
					</Button>
					<Button type="button" onClick={() => void handleExecute()} loading={busy}>
						{t('imports.execute')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
