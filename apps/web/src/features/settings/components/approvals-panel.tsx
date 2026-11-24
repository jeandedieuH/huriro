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
				// approval.decide not held — the queue is invisible, not an error.
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
		return (
			<div className="space-y-3 rounded-lg border border-border bg-card p-4">
				<Skeleton className="h-5 w-40" />
				<Skeleton className="h-24 w-full" />
			</div>
		)
	}

	if (denied) return null

	return (
		<section
			aria-labelledby="approvals-settings-heading"
			className="space-y-4 rounded-lg border border-border bg-card p-4"
		>
			<div>
				<h2 id="approvals-settings-heading" className="flex items-center gap-2 text-sm font-semibold">
					<CheckCheck className="size-4 text-muted-foreground" aria-hidden />
					<span>{t('settings.approvals.title')}</span>
				</h2>
				<p className="mt-0.5 text-xs text-muted-foreground">{t('settings.approvals.desc')}</p>
			</div>

			{error ? (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : null}

			<Tabs defaultValue="pending" onValueChange={(v) => v === 'history' && loadHistory()}>
				<TabsList>
					<TabsTrigger value="pending">
						{t('settings.approvals.tab-pending')}
						{pending.length > 0 ? (
							<Badge tone="secondary" className="ml-1.5">
								{pending.length}
							</Badge>
						) : null}
					</TabsTrigger>
					<TabsTrigger value="history">{t('settings.approvals.tab-history')}</TabsTrigger>
				</TabsList>

				<TabsContent value="pending" className="space-y-2 pt-3">
					{pending.length === 0 ? (
						<p className="text-xs text-muted-foreground">{t('settings.approvals.empty')}</p>
					) : (
						pending.map((approval) => (
							<div key={approval.id} className="rounded-md border border-border bg-muted/30 p-3 text-xs">
								<div className="flex flex-wrap items-center gap-2">
									<span className="font-semibold">{approval.agentName || approval.agentId}</span>
									<Badge tone="secondary">{approval.tier}</Badge>
									<span className="font-mono">{approval.tool}</span>
								</div>
								<pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background p-2.5 font-mono text-xs">
									{approval.previewMd}
								</pre>
								<p className="mt-1.5 text-muted-foreground">
									{t('settings.approvals.expires')}: {new Date(approval.expiresAt).toLocaleString()}
								</p>
								<div className="mt-2 flex flex-wrap items-center gap-2">
									<Input
										value={reasons[approval.id] ?? ''}
										onChange={(ev) => setReasons((prev) => ({ ...prev, [approval.id]: ev.target.value }))}
										placeholder={t('settings.approvals.reason')}
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

				<TabsContent value="history" className="space-y-2 pt-3">
					{history === null ? (
						<Skeleton className="h-16 w-full" />
					) : history.length === 0 ? (
						<p className="text-xs text-muted-foreground">{t('settings.approvals.empty')}</p>
					) : (
						history.map((approval) => (
							<div
								key={approval.id}
								className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs"
							>
								<div>
									<span className="font-semibold">{approval.agentName || approval.agentId}</span>
									<span className="ml-2 font-mono">{approval.tool}</span>
								</div>
								<div className="flex items-center gap-2">
									{approval.decisionReason ? (
										<span className="max-w-48 truncate text-muted-foreground" title={approval.decisionReason}>
											{approval.decisionReason}
										</span>
									) : null}
									<Badge
										tone={
											approval.status === 'approved' || approval.status === 'executed'
												? 'default'
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
		</section>
	)
}
