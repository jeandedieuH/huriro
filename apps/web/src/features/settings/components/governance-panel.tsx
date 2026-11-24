import type { WorkspaceExportDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Download, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkspace } from '@/lib/workspace'
import {
	SettingsCard,
	SettingsCardBody,
	SettingsCardHeader,
	SettingsEmptyState,
	SettingsNotice
} from './settings-primitives'

const EraseSchema = z.object({
	confirmEmail: z.email('Enter your account email to confirm erasure')
})

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

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
		<div className="space-y-5">
			<SettingsCard labelledBy="settings-governance-heading">
				<SettingsCardHeader
					headingId="settings-governance-heading"
					icon={<ShieldCheck className="size-4" />}
					title={t('settings.governance.title')}
					description={t('settings.governance.desc')}
					action={
						<Button
							type="button"
							size="sm"
							disabled={exporting}
							loading={exporting}
							onClick={() => void handleCreateExport()}
						>
							<Download className="size-3.5" aria-hidden />
							<span>{t('settings.governance.export-btn')}</span>
						</Button>
					}
				/>
				<SettingsCardBody>
					{loading ? (
						<Skeleton className="h-16 w-full" />
					) : exportsList.length === 0 ? (
						<SettingsEmptyState
							icon={<Download className="size-4" />}
							message={t('settings.governance.export-empty')}
						/>
					) : (
						<div className="space-y-2.5">
							<h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								{t('settings.governance.exports-list')}
							</h3>
							<ul className="space-y-2">
								{exportsList.map((item) => (
									<li
										key={item.id}
										className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-2/40 px-3.5 py-2.5 text-xs"
									>
										<div className="flex flex-wrap items-center gap-2">
											<Badge tone={item.status === 'completed' ? 'success' : 'outline'}>{item.status}</Badge>
											<span className="font-mono text-foreground">{item.id.slice(0, 8)}</span>
											<span className="text-muted-foreground tnum">{formatBytes(item.byteSize)}</span>
										</div>
										{item.status === 'completed' ? (
											<a
												href={api.getWorkspaceExportDownloadUrl(item.id)}
												className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
											>
												<Download className="size-3.5" aria-hidden />
												<span>{t('settings.governance.export-download')}</span>
											</a>
										) : null}
									</li>
								))}
							</ul>
						</div>
					)}
				</SettingsCardBody>
			</SettingsCard>

			<SettingsCard tone="danger" labelledBy="settings-governance-erase-heading">
				<SettingsCardHeader
					headingId="settings-governance-erase-heading"
					tone="danger"
					icon={<ShieldAlert className="size-4" />}
					title={t('settings.governance.erase-title')}
					description={t('settings.governance.erase-warning')}
					badge={<Badge tone="danger">{t('settings.governance.danger-zone')}</Badge>}
				/>
				<SettingsCardBody>
					<form onSubmit={(e) => void handleEraseAccount(e)} className="space-y-3">
						<div className="flex flex-col gap-2 sm:flex-row sm:items-end">
							<div className="flex-1 space-y-1.5">
								<label htmlFor="governance-erase-email" className="text-xs font-medium text-foreground">
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
							<Button type="submit" size="sm" tone="destructive" disabled={erasing} loading={erasing}>
								{t('settings.governance.erase-btn')}
							</Button>
						</div>
						{erasedMessage ? <SettingsNotice tone="success">{erasedMessage}</SettingsNotice> : null}
						{error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
					</form>
				</SettingsCardBody>
			</SettingsCard>
		</div>
	)
}
