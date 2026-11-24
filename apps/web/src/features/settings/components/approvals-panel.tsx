import type { AgentApprovalDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { CheckCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useWorkspace } from '@/lib/workspace'
import {
	SettingsCard,
	SettingsCardBody,
	SettingsCardHeader,
	SettingsEmptyState,
	SettingsNotice,
	SettingsSkeleton
} from './settings-primitives'

/**
 * R2 approval queue (§13.5): pending agent write actions with their sanitized
 * preview, plus a decided history tab. Requires `approval.decide`.
 */
export function ApprovalsSettingsPanel() {
	const { api } = useWorkspace()

	const [pending, setPending] = useState<AgentApprovalDto[]>([])
	const [history, setHistory] = useState<AgentApprovalDto[] | null>(null)
	const [reasons, setReasons] = useState<Record<string, string>>({})
	const [loading, setLoading] = useState(true)
	const [denied, setDenied] = useState(false)
	const [busyId, setBusyId] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		let cancelled = false
		void api
			.listApprovals('pending')
			.then((res) => {
				if (cancelled) return
				setPending([...res.data])
				setLoading(false)
			})
			.catch(() => {
				if (cancelled) return
				setDenied(true)
				setLoading(false)
			})
		return () => {
			cancelled = true
		}
	}, [api])

	function loadHistory() {
		if (history !== null) return
		void api
			.listApprovals()
			.then((res) => setHistory(res.data.filter((a) => a.status !== 'pending')))
			.catch(() => setHistory([]))
	}

	async function decide(approval: AgentApprovalDto, decision: 'approve' | 'deny') {
		setBusyId(approval.id)
		setError(null)
		const reason = reasons[approval.id]?.trim()
		try {
			await api.decideApproval(approval.id, {
				decision,
				...(reason ? { reason } : {})
			})
			setPending((prev) => prev.filter((a) => a.id !== approval.id))
			setHistory(null)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to record decision')
		} finally {
			setBusyId(null)
		}
	}

	if (loading) {
		return <SettingsSkeleton rows={3} />
	}

	if (denied) {
		return (
			<SettingsCard labelledBy="approvals-settings-heading">
				<SettingsCardHeader
					headingId="approvals-settings-heading"
					icon={<CheckCheck className="size-4" />}
					title={t('settings.approvals.title')}
					description={t('settings.approvals.desc')}
				/>
				<SettingsCardBody>
					<SettingsNotice tone="info" title={t('settings.common.permission-title')}>
						{t('settings.approvals.denied')}
					</SettingsNotice>
				</SettingsCardBody>
			</SettingsCard>
		)
	}

	return (
		<SettingsCard labelledBy="approvals-settings-heading">
			<SettingsCardHeader
				headingId="approvals-settings-heading"
				icon={<CheckCheck className="size-4" />}
				title={t('settings.approvals.title')}
				description={t('settings.approvals.desc')}
				badge={
					pending.length > 0 ? (
						<Badge tone="warning" className="tnum">
							{pending.length}
						</Badge>
					) : null
				}
			/>

			<SettingsCardBody>
				{error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}

				<Tabs defaultValue="pending" onValueChange={(v) => v === 'history' && loadHistory()}>
					<TabsList>
						<TabsTrigger value="pending">
							{t('settings.approvals.tab-pending')}
							{pending.length > 0 ? (
								<Badge tone="secondary" className="ml-1.5 tnum">
									{pending.length}
								</Badge>
							) : null}
						</TabsTrigger>
						<TabsTrigger value="history">{t('settings.approvals.tab-history')}</TabsTrigger>
					</TabsList>

					<TabsContent value="pending" className="space-y-3 pt-3">
						{pending.length === 0 ? (
							<SettingsEmptyState
								icon={<CheckCheck className="size-4" />}
								message={t('settings.approvals.empty')}
							/>
						) : (
							pending.map((approval) => (
								<div
									key={approval.id}
									className="space-y-3 rounded-lg border border-border bg-surface-2/40 p-4 text-xs"
								>
									<div className="flex flex-wrap items-center justify-between gap-2">
										<div className="flex flex-wrap items-center gap-2">
											<span className="text-sm font-semibold text-foreground">
												{approval.agentName || approval.agentId}
											</span>
											<Badge tone="warning">{approval.tier}</Badge>
											<Badge tone="outline" className="font-mono">
												{approval.tool}
											</Badge>
										</div>
										<span className="text-muted-foreground tnum">
											{t('settings.approvals.expires')}: {new Date(approval.expiresAt).toLocaleString()}
										</span>
									</div>

									<pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 font-mono text-xs text-foreground">
										{approval.previewMd}
									</pre>

									<div className="flex flex-wrap items-center gap-2">
										<Input
											value={reasons[approval.id] ?? ''}
											onChange={(ev) => setReasons((prev) => ({ ...prev, [approval.id]: ev.target.value }))}
											placeholder={t('settings.approvals.reason')}
											aria-label={t('settings.approvals.reason')}
											className="h-8 max-w-64 text-xs"
										/>
										<Button
											size="sm"
											type="button"
											loading={busyId === approval.id}
											onClick={() => void decide(approval, 'approve')}
										>
											{t('settings.approvals.approve')}
										</Button>
										<Button
											size="sm"
											tone="outline"
											type="button"
											disabled={busyId === approval.id}
											onClick={() => void decide(approval, 'deny')}
										>
											{t('settings.approvals.deny')}
										</Button>
									</div>
								</div>
							))
						)}
					</TabsContent>

					<TabsContent value="history" className="space-y-2.5 pt-3">
						{history === null ? (
							<Skeleton className="h-16 w-full" />
						) : history.length === 0 ? (
							<SettingsEmptyState
								icon={<CheckCheck className="size-4" />}
								message={t('settings.approvals.empty')}
							/>
						) : (
							history.map((approval) => (
								<div
									key={approval.id}
									className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-2/40 px-4 py-3 text-xs"
								>
									<div className="flex flex-wrap items-center gap-2">
										<span className="font-semibold text-foreground">
											{approval.agentName || approval.agentId}
										</span>
										<Badge tone="outline" className="font-mono">
											{approval.tool}
										</Badge>
									</div>
									<div className="flex items-center gap-2">
										{approval.decisionReason ? (
											<span
												className="max-w-48 truncate text-muted-foreground"
												title={approval.decisionReason}
											>
												{approval.decisionReason}
											</span>
										) : null}
										<Badge
											tone={
												approval.status === 'approved' || approval.status === 'executed'
													? 'success'
													: approval.status === 'denied' || approval.status === 'failed'
														? 'danger'
														: 'secondary'
											}
										>
											{approval.status}
										</Badge>
									</div>
								</div>
							))
						)}
					</TabsContent>
				</Tabs>
			</SettingsCardBody>
		</SettingsCard>
	)
}
