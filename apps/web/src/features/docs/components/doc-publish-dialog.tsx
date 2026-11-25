import type { DocPageDto, DocPublicShareDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Copy, ExternalLink, Globe, Trash2 } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { TaskApiBridge } from '@/lib/sync-bootstrap'
import { useUiStore } from '@/stores/ui-store'

export interface DocPublishDialogProps {
	readonly api: TaskApiBridge
	readonly page: DocPageDto | null
	readonly workspaceSlug?: string | undefined
}

export function DocPublishDialog({ api, page, workspaceSlug = 'default' }: DocPublishDialogProps) {
	const open = useUiStore((s) => s.docPublishOpen)
	const setOpen = useUiStore((s) => s.setDocPublishOpen)
	const pushToast = useUiStore((s) => s.pushToast)

	const [share, setShare] = useState<DocPublicShareDto | null>(null)
	const [publicSlug, setPublicSlug] = useState('')
	const [includeChildren, setIncludeChildren] = useState(false)
	const [allowSearchIndexing, setAllowSearchIndexing] = useState(false)
	const [password, setPassword] = useState('')
	const [expiresAt, setExpiresAt] = useState('')
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		if (!open || !page) return
		let cancelled = false
		setPublicSlug(page.slug)
		setPassword('')
		void api
			.getDocPublicShare(page.id)
			.then((existing) => {
				if (cancelled) return
				setShare(existing)
				if (existing) {
					setPublicSlug(existing.publicSlug)
					setIncludeChildren(existing.includeChildren)
					setAllowSearchIndexing(existing.allowSearchIndexing)
					setExpiresAt(existing.expiresAt ? existing.expiresAt.slice(0, 10) : '')
				} else {
					setIncludeChildren(false)
					setAllowSearchIndexing(false)
					setExpiresAt('')
				}
			})
			.catch(() => {
				if (!cancelled) setShare(null)
			})
		return () => {
			cancelled = true
		}
	}, [api, open, page])

	if (!page) return null
	const activePage = page

	async function handleSave(ev: FormEvent) {
		ev.preventDefault()
		if (busy) return
		setBusy(true)
		try {
			const cleanSlug = publicSlug.trim()
			const next = await api.upsertDocPublicShare(activePage.id, {
				...(cleanSlug ? { publicSlug: cleanSlug } : {}),
				includeChildren,
				allowSearchIndexing,
				...(password.trim().length >= 4 ? { password: password.trim() } : {}),
				...(expiresAt.trim()
					? { expiresAt: new Date(`${expiresAt.trim()}T23:59:59Z`).toISOString() }
					: { expiresAt: null })
			})
			setShare(next)
			setPassword('')
			pushToast({ tone: 'success', title: next.publicSlug })
		} catch (err) {
			pushToast({ tone: 'danger', title: err instanceof Error ? err.message : 'Publish failed' })
		} finally {
			setBusy(false)
		}
	}

	async function handleRevoke() {
		if (busy) return
		setBusy(true)
		try {
			await api.revokeDocPublicShare(activePage.id)
			setShare(null)
			pushToast({ tone: 'success', title: t('docs.publish.revoke') })
		} catch (err) {
			pushToast({ tone: 'danger', title: err instanceof Error ? err.message : 'Unpublish failed' })
		} finally {
			setBusy(false)
		}
	}

	const effectiveSlug = share?.publicSlug ?? (publicSlug.trim() || activePage.slug)
	const publicPath = `/p/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(effectiveSlug)}`
	const mdPath = `/api/v1/public/docs/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(effectiveSlug)}.md`
	const llmsPath = `/api/v1/public/docs/${encodeURIComponent(workspaceSlug)}/llms.txt`

	function copyAbsolute(relPath: string) {
		const full = typeof window !== 'undefined' ? `${window.location.origin}${relPath}` : relPath
		if (typeof navigator !== 'undefined' && navigator.clipboard) {
			void navigator.clipboard.writeText(full)
		}
		pushToast({ tone: 'success', title: t('docs.link.copied') })
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<div className="flex items-center justify-between gap-2 pr-6">
						<DialogTitle className="flex items-center gap-2">
							<Globe className="size-4" aria-hidden />
							<span>{t('docs.publish.title')}</span>
						</DialogTitle>
						{share ? <Badge tone="success">Live</Badge> : null}
					</div>
				</DialogHeader>

				<form onSubmit={(ev) => void handleSave(ev)} className="space-y-3">
					<div className="space-y-1">
						<label htmlFor="publish-slug" className="text-xs font-medium">
							{t('docs.publish.slug')}
						</label>
						<Input
							id="publish-slug"
							value={publicSlug}
							onChange={(ev) => setPublicSlug(ev.target.value)}
							className="h-8 text-xs"
						/>
					</div>

					<div className="flex items-center gap-2">
						<Checkbox
							id="publish-children"
							checked={includeChildren}
							onCheckedChange={(v) => setIncludeChildren(Boolean(v))}
						/>
						<label htmlFor="publish-children" className="text-xs">
							{t('docs.publish.include-children')}
						</label>
					</div>

					<div className="flex items-center gap-2">
						<Checkbox
							id="publish-indexing"
							checked={allowSearchIndexing}
							onCheckedChange={(v) => setAllowSearchIndexing(Boolean(v))}
						/>
						<label htmlFor="publish-indexing" className="text-xs">
							{t('docs.publish.allow-indexing')}
						</label>
					</div>

					<div className="grid grid-cols-2 gap-2">
						<div className="space-y-1">
							<label htmlFor="publish-password" className="text-xs font-medium">
								{t('docs.publish.password')}
							</label>
							<Input
								id="publish-password"
								type="password"
								value={password}
								onChange={(ev) => setPassword(ev.target.value)}
								placeholder={share?.hasPassword ? '••••••••' : ''}
								className="h-8 text-xs"
							/>
						</div>
						<div className="space-y-1">
							<label htmlFor="publish-expires" className="text-xs font-medium">
								{t('docs.publish.expires-at')}
							</label>
							<DatePicker id="publish-expires" value={expiresAt} onChange={setExpiresAt} />
						</div>
					</div>

					{share ? (
						<div className="space-y-2 rounded-md border border-border bg-muted/30 p-2.5 text-xs">
							<div className="flex flex-wrap items-center gap-1.5">
								<Button
									type="button"
									size="sm"
									tone="outline"
									className="h-7 gap-1 px-2 text-xs"
									onClick={() => copyAbsolute(publicPath)}
								>
									<Copy className="size-3" aria-hidden />
									<span>{t('docs.publish.copy-url')}</span>
								</Button>
								<Button
									type="button"
									size="sm"
									tone="outline"
									className="h-7 gap-1 px-2 text-xs"
									onClick={() => copyAbsolute(mdPath)}
								>
									<Copy className="size-3" aria-hidden />
									<span>{t('docs.publish.copy-md')}</span>
								</Button>
								<a
									href={publicPath}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:underline"
								>
									<ExternalLink className="size-3" aria-hidden />
									<span>{t('docs.publish.open')}</span>
								</a>
								<a
									href={llmsPath}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:underline"
								>
									<span>{t('docs.publish.llms-txt')}</span>
								</a>
							</div>
						</div>
					) : null}

					<DialogFooter className="flex items-center justify-between gap-2">
						{share ? (
							<Button
								type="button"
								tone="outline"
								size="sm"
								disabled={busy}
								className="gap-1 text-destructive"
								onClick={() => void handleRevoke()}
							>
								<Trash2 className="size-3.5" aria-hidden />
								<span>{t('docs.publish.revoke')}</span>
							</Button>
						) : (
							<span />
						)}
						<Button type="submit" size="sm" disabled={busy}>
							{share ? t('docs.publish.update') : t('docs.publish.save')}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
