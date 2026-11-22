import type { ImportDryRunBody, ImportDryRunPreviewDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { strFromU8, unzipSync } from 'fflate'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { TaskApiBridge } from '@/lib/sync-bootstrap'
import { useUiStore } from '@/stores/ui-store'

export interface DocImportDialogProps {
	readonly api: TaskApiBridge
	readonly onImported?: () => void
}

export function DocImportDialog({ api, onImported }: DocImportDialogProps) {
	const open = useUiStore((s) => s.docImportOpen)
	const setOpen = useUiStore((s) => s.setDocImportOpen)
	const pushToast = useUiStore((s) => s.pushToast)

	const [source, setSource] = useState<'notion' | 'markdown'>('markdown')
	const [rootTitle, setRootTitle] = useState('')
	const [markdownText, setMarkdownText] = useState(
		'# Imported Notes\n\nPaste Markdown or upload files above.'
	)
	const [uploadedPages, setUploadedPages] = useState<Array<{ path: string; markdown: string }>>([])
	const [preview, setPreview] = useState<ImportDryRunPreviewDto | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)

	async function handleFileSelect(files: FileList | null) {
		if (!files || files.length === 0) return
		setError(null)
		const parsed: Array<{ path: string; markdown: string }> = []
		for (const file of Array.from(files)) {
			if (file.name.toLowerCase().endsWith('.zip')) {
				const buf = new Uint8Array(await file.arrayBuffer())
				const entries = unzipSync(buf)
				for (const [entryPath, bytes] of Object.entries(entries)) {
					if (entryPath.toLowerCase().endsWith('.md')) {
						parsed.push({ path: entryPath, markdown: strFromU8(bytes) })
					}
				}
			} else if (file.name.toLowerCase().endsWith('.md') || file.name.toLowerCase().endsWith('.txt')) {
				parsed.push({ path: file.name, markdown: await file.text() })
			}
		}
		if (parsed.length === 0) {
			setError('No .md files found in upload')
			return
		}
		setUploadedPages(parsed)
		setPreview(null)
	}

	function buildBody(): ImportDryRunBody {
		const cleanRoot = rootTitle.trim() || undefined
		const items =
			uploadedPages.length > 0 ? uploadedPages : [{ path: 'imported-note.md', markdown: markdownText }]
		if (source === 'notion') {
			return {
				source: 'notion',
				notion: {
					...(cleanRoot ? { rootTitle: cleanRoot } : {}),
					pages: items.map((item) => ({ remotePath: item.path, markdown: item.markdown }))
				}
			}
		}
		return {
			source: 'markdown',
			markdown: {
				...(cleanRoot ? { rootTitle: cleanRoot } : {}),
				files: items.map((item) => ({ path: item.path, markdown: item.markdown }))
			}
		}
	}

	async function handlePreview() {
		setBusy(true)
		setError(null)
		try {
			const res = await api.importDryRun(buildBody())
			setPreview(res)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Preview failed')
		} finally {
			setBusy(false)
		}
	}

	async function handleExecute() {
		setBusy(true)
		setError(null)
		try {
			const body = buildBody()
			const res = await api.importExecute({
				source: body.source,
				...(preview?.jobId ? { jobId: preview.jobId } : {}),
				...(body.notion ? { notion: body.notion } : {}),
				...(body.markdown ? { markdown: body.markdown } : {})
			})
			pushToast({
				tone: 'success',
				title: t('imports.complete-docs', { pages: Number(res.report['importedPages'] ?? 1) })
			})
			onImported?.()
			setOpen(false)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Import failed')
		} finally {
			setBusy(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>{t('docs.sidebar.import')}</DialogTitle>
				</DialogHeader>

				<div className="space-y-3">
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1">
							<span className="text-xs font-medium">{t('imports.source')}</span>
							<Select value={source} onValueChange={(v) => setSource(v as 'notion' | 'markdown')}>
								<SelectTrigger aria-label={t('imports.source')}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="markdown">{t('imports.source.markdown')}</SelectItem>
									<SelectItem value="notion">{t('imports.source.notion')}</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-1">
							<label htmlFor="doc-import-root-title" className="text-xs font-medium">
								{t('docs.create.root-option')}
							</label>
							<Input
								id="doc-import-root-title"
								value={rootTitle}
								onChange={(ev) => setRootTitle(ev.target.value)}
								placeholder="Optional folder title"
							/>
						</div>
					</div>

					<div className="space-y-1">
						<label htmlFor="doc-import-files" className="text-xs font-medium">
							{t('imports.files-label')}
						</label>
						<Input
							id="doc-import-files"
							type="file"
							multiple
							accept=".md,.txt,.zip"
							onChange={(ev) => void handleFileSelect(ev.target.files)}
						/>
						{uploadedPages.length > 0 ? (
							<p className="text-xs text-muted-foreground">{uploadedPages.length} Markdown files staged</p>
						) : null}
					</div>

					{uploadedPages.length === 0 ? (
						<div className="space-y-1">
							<label htmlFor="doc-import-markdown" className="text-xs font-medium">
								{t('imports.payload-label')}
							</label>
							<Textarea
								id="doc-import-markdown"
								rows={5}
								value={markdownText}
								onChange={(ev) => setMarkdownText(ev.target.value)}
								className="font-mono text-xs"
							/>
						</div>
					) : null}

					{error ? (
						<p role="alert" className="text-xs text-destructive">
							{error}
						</p>
					) : null}

					{preview ? (
						<div className="rounded-md border border-border bg-muted/40 p-2.5 text-xs">
							{t('imports.preview-docs-summary', {
								pages: preview.counts.pages ?? 0,
								skipped: preview.counts.skippedExisting
							})}
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
