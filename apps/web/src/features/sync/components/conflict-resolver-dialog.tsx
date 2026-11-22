import { t } from '@huriro/i18n'
import { useSyncConflicts, useSyncEngine } from '@huriro/sync-client'
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
import { useUiStore } from '@/stores/ui-store'

/**
 * Field-level 3-way conflict resolver dialog (§9.6).
 * Users choose "Yours" vs "Theirs" per overlapping field without losing work.
 */
export function ConflictResolverDialog() {
	const engine = useSyncEngine()
	const conflicts = useSyncConflicts()
	const open = useUiStore((s) => s.conflictDialogOpen)
	const setOpen = useUiStore((s) => s.setConflictDialogOpen)

	const active = conflicts[0]
	const [choices, setChoices] = useState<Record<string, 'local' | 'server'>>({})
	const [submitting, setSubmitting] = useState(false)

	useEffect(() => {
		if (!active) return
		const initial: Record<string, 'local' | 'server'> = {}
		for (const field of active.overlappingFields) {
			initial[field] = 'local'
		}
		setChoices(initial)
	}, [active])

	if (!active) {
		return null
	}

	async function applyResolution() {
		if (!active || submitting) return
		setSubmitting(true)
		try {
			const mergedPatch: Record<string, unknown> = {}
			for (const field of active.overlappingFields) {
				mergedPatch[field] =
					choices[field] === 'server' ? active.serverValues[field] : active.localValues[field]
			}
			const allServer = active.overlappingFields.every((f) => choices[f] === 'server')
			await engine.resolveConflict(active.id, allServer ? 'keep_server' : mergedPatch)
			if (engine.getConflicts().length === 0) {
				setOpen(false)
			}
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="max-w-xl">
				<DialogHeader>
					<DialogTitle>{t('sync.conflict.title')}</DialogTitle>
					<DialogDescription>
						{t('sync.conflict.subtitle')} — {active.title}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					{active.overlappingFields.map((field) => {
						const localVal = String(active.localValues[field] ?? '—')
						const serverVal = String(active.serverValues[field] ?? '—')
						const pick = choices[field] ?? 'local'

						return (
							<div key={field} className="space-y-2 rounded-md border border-border p-3">
								<p className="font-mono text-xs font-semibold uppercase text-muted-foreground">{field}</p>
								<div className="grid grid-cols-2 gap-2">
									<button
										type="button"
										onClick={() => setChoices((prev) => ({ ...prev, [field]: 'local' }))}
										className={`rounded-md border p-2 text-left text-xs ${
											pick === 'local'
												? 'border-primary bg-primary/10 text-foreground'
												: 'border-border text-muted-foreground'
										}`}
									>
										<span className="block font-semibold">{t('sync.conflict.yours')}</span>
										<span className="mt-1 block break-words">{localVal}</span>
									</button>
									<button
										type="button"
										onClick={() => setChoices((prev) => ({ ...prev, [field]: 'server' }))}
										className={`rounded-md border p-2 text-left text-xs ${
											pick === 'server'
												? 'border-primary bg-primary/10 text-foreground'
												: 'border-border text-muted-foreground'
										}`}
									>
										<span className="block font-semibold">{t('sync.conflict.theirs')}</span>
										<span className="mt-1 block break-words">{serverVal}</span>
									</button>
								</div>
							</div>
						)
					})}
				</div>

				<DialogFooter>
					<Button
						type="button"
						tone="outline"
						onClick={() => void engine.resolveConflict(active.id, 'keep_server').then(() => setOpen(false))}
					>
						{t('sync.conflict.keep-theirs')}
					</Button>
					<Button type="button" onClick={() => void applyResolution()} loading={submitting}>
						{t('sync.conflict.apply')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
