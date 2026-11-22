import type { DocVersionDetailDto, DocVersionDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { History, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface VersionTimelinePanelProps {
	readonly versions: readonly DocVersionDto[]
	readonly canWrite: boolean
	readonly onLoadDiff: (versionId: string) => Promise<DocVersionDetailDto>
	readonly onSaveSnapshot: (label: string) => Promise<void>
	readonly onRestore: (versionId: string) => Promise<void>
}

export function VersionTimelinePanel({
	versions,
	canWrite,
	onLoadDiff,
	onSaveSnapshot,
	onRestore
}: VersionTimelinePanelProps) {
	const [label, setLabel] = useState('')
	const [selectedDetail, setSelectedDetail] = useState<DocVersionDetailDto | null>(null)
	const [busy, setBusy] = useState(false)

	async function handleSave() {
		const trimmed = label.trim()
		if (!trimmed || busy) return
		setBusy(true)
		try {
			await onSaveSnapshot(trimmed)
			setLabel('')
		} finally {
			setBusy(false)
		}
	}

	async function selectVersion(versionId: string) {
		setBusy(true)
		try {
			const detail = await onLoadDiff(versionId)
			setSelectedDetail(detail)
		} finally {
			setBusy(false)
		}
	}

	const kindLabel = (kind: DocVersionDto['kind']) => {
		if (kind === 'named') return t('docs.versions.kind.named')
		if (kind === 'pre_restore') return t('docs.versions.kind.pre_restore')
		return t('docs.versions.kind.auto')
	}

	return (
		<div className="flex h-full flex-col gap-3 p-3">
			{canWrite ? (
				<div className="flex items-center gap-1.5">
					<Input
						aria-label={t('docs.versions.snapshot-placeholder')}
						value={label}
						onChange={(ev) => setLabel(ev.target.value)}
						placeholder={t('docs.versions.snapshot-placeholder')}
						className="h-8 text-xs"
					/>
					<Button type="button" size="sm" disabled={!label.trim() || busy} onClick={() => void handleSave()}>
						{t('docs.versions.save-snapshot')}
					</Button>
				</div>
			) : null}

			<ul className="max-h-56 space-y-1.5 overflow-y-auto">
				{versions.length === 0 ? (
					<li className="py-4 text-center text-xs text-muted-foreground">{t('docs.versions.empty')}</li>
				) : (
					versions.map((ver) => {
						const active = selectedDetail?.version.id === ver.id
						return (
							<li key={ver.id}>
								<button
									type="button"
									onClick={() => void selectVersion(ver.id)}
									className={cn(
										'flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors',
										active ? 'border-primary bg-accent/60' : 'border-border bg-card hover:bg-muted/60'
									)}
								>
									<div className="min-w-0">
										<div className="flex items-center gap-1.5">
											<History className="size-3 shrink-0 text-muted-foreground" aria-hidden />
											<span className="truncate font-medium text-foreground">
												{ver.label ?? kindLabel(ver.kind)}
											</span>
										</div>
										<time className="text-[11px] text-muted-foreground">{ver.createdAt.slice(0, 16)}</time>
									</div>
									<Badge tone={ver.kind === 'named' ? 'info' : 'outline'}>{kindLabel(ver.kind)}</Badge>
								</button>
							</li>
						)
					})
				)}
			</ul>

			{selectedDetail ? (
				<div className="flex min-h-0 flex-1 flex-col gap-2 rounded-md border border-border bg-surface-2 p-2.5">
					<div className="flex items-center justify-between gap-2">
						<span className="truncate text-xs font-medium text-foreground">
							{selectedDetail.version.label ?? kindLabel(selectedDetail.version.kind)}
						</span>
						{canWrite ? (
							<Button
								type="button"
								size="sm"
								tone="outline"
								disabled={busy}
								onClick={() => void onRestore(selectedDetail.version.id)}
								className="h-7 gap-1 px-2 text-xs"
							>
								<RotateCcw className="size-3" aria-hidden />
								<span>{t('docs.versions.restore')}</span>
							</Button>
						) : null}
					</div>

					<div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto font-mono text-[11px]">
						{selectedDetail.diff.length === 0 ? (
							<p className="text-muted-foreground">{t('docs.versions.diff-empty')}</p>
						) : (
							(() => {
								const seen = new Map<string, number>()
								return selectedDetail.diff.map((hunk) => {
									const base = `${hunk.kind}:${hunk.text}`
									const count = (seen.get(base) ?? 0) + 1
									seen.set(base, count)
									return (
										<div
											key={`${base}#${count}`}
											className={cn(
												'whitespace-pre-wrap rounded px-1.5 py-0.5',
												hunk.kind === 'add' && 'bg-(--success)/15 text-(--success)',
												hunk.kind === 'remove' && 'bg-destructive/15 text-destructive',
												hunk.kind === 'equal' && 'text-muted-foreground'
											)}
										>
											{hunk.kind === 'add'
												? `+ ${hunk.text}`
												: hunk.kind === 'remove'
													? `- ${hunk.text}`
													: `  ${hunk.text}`}
										</div>
									)
								})
							})()
						)}
					</div>
				</div>
			) : null}
		</div>
	)
}
