import type {
	GithubImportPayload,
	ImportDryRunBody,
	ImportDryRunPreviewDto,
	ImportExecuteBody,
	ImportJobDto,
	ImportSource,
	JiraImportPayload,
	LinearImportPayload,
	MarkdownImportPayload,
	NotionImportPayload,
	SlackImportPayload
} from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { strFromU8, unzipSync } from 'fflate'
import { useEffect, useState } from 'react'
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
	const importDialogSource = useUiStore((s) => s.importDialogSource)
	const setOpen = useUiStore((s) => s.setImportDialogOpen)
	const pushToast = useUiStore((s) => s.pushToast)

	const [source, setSource] = useState<ImportSource>(importDialogSource)
	const [projectKey, setProjectKey] = useState('IMP')
	const [payloadText, setPayloadText] = useState(SAMPLE_LINEAR_JSON)
	const [docFiles, setDocFiles] = useState<Array<{ path: string; markdown: string }>>([])
	const [dryRun, setDryRun] = useState<ImportDryRunPreviewDto | null>(null)
	const [result, setResult] = useState<ImportJobDto | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		if (!open) return
		setSource(importDialogSource)
		setDocFiles([])
		setDryRun(null)
		setResult(null)
		setError(null)
	}, [open, importDialogSource])

	async function handleDocFileUpload(files: FileList | null) {
		if (!files || files.length === 0) return
		setError(null)
		const collected: Array<{ path: string; markdown: string }> = []
		for (const file of Array.from(files)) {
			if (file.name.toLowerCase().endsWith('.zip')) {
				const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
				for (const [entryPath, bytes] of Object.entries(entries)) {
					if (entryPath.toLowerCase().endsWith('.md')) {
						collected.push({ path: entryPath, markdown: strFromU8(bytes) })
					}
				}
			} else if (file.name.toLowerCase().endsWith('.md') || file.name.toLowerCase().endsWith('.txt')) {
				collected.push({ path: file.name, markdown: await file.text() })
			}
		}
		if (collected.length === 0) {
			setError('No .md files found')
			return
		}
		setDocFiles(collected)
		setDryRun(null)
	}

	function buildRequestBody(): ImportDryRunBody | null {
		setError(null)
		if (source === 'notion' || source === 'markdown') {
			if (docFiles.length > 0) {
				return source === 'notion'
					? {
							source: 'notion',
							notion: { pages: docFiles.map((f) => ({ remotePath: f.path, markdown: f.markdown })) }
						}
					: {
							source: 'markdown',
							markdown: { files: docFiles.map((f) => ({ path: f.path, markdown: f.markdown })) }
						}
			}
			return source === 'notion'
				? {
						source: 'notion',
						notion: { pages: JSON.parse(payloadText) as NotionImportPayload['pages'] }
					}
				: {
						source: 'markdown',
						markdown: {
							files: [{ path: 'note.md', markdown: payloadText }] as MarkdownImportPayload['files']
						}
					}
		}
		if (source === 'slack') {
			try {
				const parsed = JSON.parse(payloadText) as SlackImportPayload
				if (!parsed || !Array.isArray(parsed.channels) || typeof parsed.messagesByChannel !== 'object') {
					setError('Slack payload must include channels[] and messagesByChannel{}')
					return null
				}
				return { source: 'slack', slack: parsed }
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Invalid Slack JSON payload')
				return null
			}
		}
		if (source === 'jira') {
			const cleanKey = projectKey.trim().toUpperCase() || 'JIRA'
			const trimmed = payloadText.trim()
			if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
				try {
					const parsed = JSON.parse(trimmed) as unknown
					const issues = Array.isArray(parsed)
						? (parsed as JiraImportPayload['issues'])
						: (parsed as { issues?: JiraImportPayload['issues'] }).issues
					if (!Array.isArray(issues)) {
						setError('Jira JSON must be an array of issues')
						return null
					}
					return {
						source: 'jira',
						jira: { projectKey: cleanKey, projectName: cleanKey, issues }
					}
				} catch (err) {
					setError(err instanceof Error ? err.message : 'Invalid Jira JSON payload')
					return null
				}
			}
			if (!trimmed) {
				setError('Provide Jira CSV or JSON export')
				return null
			}
			return {
				source: 'jira',
				jira: { projectKey: cleanKey, projectName: cleanKey, csv: trimmed }
			}
		}
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
				...(body.github ? { github: body.github } : {}),
				...(body.jira ? { jira: body.jira } : {}),
				...(body.slack ? { slack: body.slack } : {}),
				...(body.notion ? { notion: body.notion } : {}),
				...(body.markdown ? { markdown: body.markdown } : {})
			}
			const res = await api.importExecute(execBody)
			setResult(res)
			onImported?.()
			const importedPages = Number(res.report['importedPages'] ?? 0)
			const importedChannels = Number(res.report['importedChannels'] ?? 0)
			const importedMessages = Number(res.report['importedMessages'] ?? 0)
			pushToast({
				tone: 'success',
				title:
					source === 'notion' || source === 'markdown'
						? t('imports.complete-docs', { pages: importedPages })
						: source === 'slack'
							? t('imports.complete-chat', { channels: importedChannels, messages: importedMessages })
							: t('imports.complete', {
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
									setSource(v as ImportSource)
									setDocFiles([])
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
									<SelectItem value="jira">{t('imports.source.jira')}</SelectItem>
									<SelectItem value="slack">{t('imports.source.slack')}</SelectItem>
									<SelectItem value="notion">{t('imports.source.notion')}</SelectItem>
									<SelectItem value="markdown">{t('imports.source.markdown')}</SelectItem>
								</SelectContent>
							</Select>
						</div>
						{source === 'linear' || source === 'github' || source === 'jira' ? (
							<div className="space-y-1">
								<label htmlFor="import-target-key" className="text-xs font-medium">
									{t('tasks.project.key')}
								</label>
								<Input
									key="import-target-key"
									id="import-target-key"
									value={projectKey}
									onChange={(ev) => setProjectKey(ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
									maxLength={12}
								/>
							</div>
						) : (
							<div className="space-y-1">
								<label htmlFor="import-doc-files" className="text-xs font-medium">
									{t('imports.files-label')}
								</label>
								<Input
									key="import-doc-files"
									id="import-doc-files"
									type="file"
									multiple
									accept=".md,.txt,.zip"
									onChange={(ev) => void handleDocFileUpload(ev.target.files)}
								/>
							</div>
						)}
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
								{dryRun.source === 'slack'
									? t('imports.preview-chat-summary', {
											channels: dryRun.counts.channels ?? 0,
											messages: dryRun.counts.messages ?? 0,
											threads: dryRun.counts.threads ?? 0,
											skipped: dryRun.counts.skippedExisting
										})
									: t('imports.preview-summary', {
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
								{result.source === 'slack'
									? t('imports.complete-chat', {
											channels: Number(result.report['importedChannels'] ?? 0),
											messages: Number(result.report['importedMessages'] ?? 0)
										})
									: t('imports.complete', {
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
