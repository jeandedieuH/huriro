import type { WorkspaceExportDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Download, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkspace } from '@/lib/workspace'

const EraseSchema = z.object({
	confirmEmail: z.email('Enter your account email to confirm erasure')
})

export function GovernanceSettingsPanel() {
	const { api } = useWorkspace()

	const [exportsList, setExportsList] = useState<WorkspaceExportDto[]>([])
	const [loading, setLoading] = useState(true)
	const [exporting, setExporting] = useState(false)
	const [erasing, setErasing] = useState(false)
	const [confirmEmail, setConfirmEmail] = useState('')
	const [erasedMessage, setErasedMessage] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		let cancelled = false
		void api
			.listWorkspaceExports()
			.then((rows) => {
				if (cancelled) return
				setExportsList(rows)
				setLoading(false)
			})
			.catch((err) => {
				if (cancelled) return
				setError(err instanceof Error ? err.message : 'Failed to load governance exports')
				setLoading(false)
			})
		return () => {
			cancelled = true
		}
	}, [api])

	async function handleCreateExport() {
		if (exporting) return
		setExporting(true)
		setError(null)
		try {
			const created = await api.createWorkspaceExport()
			setExportsList((prev) => [created, ...prev])
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to export workspace JSON')
		} finally {
			setExporting(false)
		}
	}

	async function handleEraseAccount(ev: React.FormEvent) {
		ev.preventDefault()
		if (erasing) return
		const parsed = EraseSchema.safeParse({ confirmEmail: confirmEmail.trim() })
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? 'Invalid email')
			return
		}
		setErasing(true)
		setError(null)
		try {
			await api.eraseMyAccount({ confirmEmail: parsed.data.confirmEmail })
			setErasedMessage(t('settings.governance.erase-done'))
			setConfirmEmail('')
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Account erasure failed')
		} finally {
			setErasing(false)
		}
	}

	return (
		<section
			aria-labelledby="settings-governance-heading"
			className="space-y-4 rounded-lg border border-border bg-card p-4"
		>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<h2 id="settings-governance-heading" className="text-sm font-semibold">
						{t('settings.governance.title')}
					</h2>
					<p className="text-xs text-muted-foreground">{t('settings.governance.desc')}</p>
				</div>
				<Button type="button" size="sm" disabled={exporting} onClick={() => void handleCreateExport()}>
					<Download className="mr-1.5 size-3.5" aria-hidden />
					{t('settings.governance.export-btn')}
				</Button>
			</div>

			{loading ? (
				<Skeleton className="h-16 w-full" />
			) : exportsList.length === 0 ? (
				<p className="text-xs text-muted-foreground">{t('settings.governance.export-empty')}</p>
			) : (
				<div className="space-y-2">
					<div className="text-xs font-medium">{t('settings.governance.exports-list')}</div>
					<ul className="space-y-1.5">
						{exportsList.map((item) => (
							<li
								key={item.id}
								className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-xs"
							>
								<div className="flex items-center gap-2">
									<Badge tone={item.status === 'completed' ? 'secondary' : 'outline'}>{item.status}</Badge>
									<span className="font-mono">{item.id.slice(0, 8)}</span>
									<span className="text-muted-foreground">{item.byteSize} B</span>
								</div>
								{item.status === 'completed' ? (
									<a
										href={api.getWorkspaceExportDownloadUrl(item.id)}
										className="font-medium text-primary underline"
									>
										{t('settings.governance.export-download')}
									</a>
								) : null}
							</li>
						))}
					</ul>
				</div>
			)}

			<form
				onSubmit={(e) => void handleEraseAccount(e)}
				className="space-y-2.5 rounded-md border border-destructive/40 bg-destructive/5 p-3"
			>
				<div className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
					<ShieldAlert className="size-4" aria-hidden />
					<span>{t('settings.governance.erase-title')}</span>
				</div>
				<p className="text-xs text-muted-foreground">{t('settings.governance.erase-warning')}</p>
				<div className="flex flex-col gap-2 sm:flex-row sm:items-end">
					<div className="flex-1 space-y-1">
						<label htmlFor="governance-erase-email" className="text-xs font-medium">
							{t('settings.governance.erase-confirm-label')}
						</label>
						<Input
							id="governance-erase-email"
							type="email"
							value={confirmEmail}
							onChange={(e) => setConfirmEmail(e.target.value)}
							placeholder="you@example.com"
						/>
					</div>
					<Button type="submit" size="sm" tone="destructive" disabled={erasing}>
						{t('settings.governance.erase-btn')}
					</Button>
				</div>
				{erasedMessage ? <p className="text-xs font-medium text-foreground">{erasedMessage}</p> : null}
			</form>

			{error ? (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : null}
		</section>
	)
}
