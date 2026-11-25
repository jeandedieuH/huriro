import type { EntityLinkDto, EntityType, PeekCardDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { Link2, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useWorkspace } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'

/**
 * Entity-graph UI (§7.1): a hover peek card for any linked entity plus the
 * per-issue linked-entities management section. Both directions of
 * `GET /graph/links` render here; deletes hit `DELETE /graph/links/:id`.
 */

/** Hover-peek wrapper — lazy-fetches `GET /graph/peek` on first open, caches per entity. */
export function EntityPeek({
	type,
	id,
	children
}: {
	readonly type: EntityType
	readonly id: string
	readonly children: React.ReactNode
}) {
	const { api } = useWorkspace()
	const [open, setOpen] = useState(false)
	const [card, setCard] = useState<PeekCardDto | null | undefined>(undefined)
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

	// Hover intent debounce: 250ms so skimming the list doesn't spam peeks.
	const scheduleOpen = (next: boolean) => {
		if (timer.current) clearTimeout(timer.current)
		timer.current = setTimeout(() => setOpen(next), next ? 250 : 150)
	}

	useEffect(() => {
		if (!open || card !== undefined) return
		let cancelled = false
		void api
			.peekEntity(type, id)
			.then((c) => {
				if (!cancelled) setCard(c)
			})
			.catch(() => {
				if (!cancelled) setCard(null)
			})
		return () => {
			cancelled = true
		}
	}, [api, card, id, open, type])

	return (
		<Popover open={open} onOpenChange={(o) => scheduleOpen(o)}>
			<PopoverTrigger
				asChild
				onMouseEnter={() => scheduleOpen(true)}
				onMouseLeave={() => scheduleOpen(false)}
			>
				<span className="inline-flex min-w-0">{children}</span>
			</PopoverTrigger>
			<PopoverContent
				className="w-72 p-3"
				onMouseEnter={() => scheduleOpen(true)}
				onMouseLeave={() => scheduleOpen(false)}
			>
				{card === undefined ? (
					<p className="text-sm text-muted-foreground">{t('peek.loading')}</p>
				) : card === null ? (
					<p className="text-sm text-muted-foreground">{t('peek.no-access')}</p>
				) : (
					<div className="space-y-1">
						<div className="flex items-center gap-2">
							<span className="rounded bg-accent px-1.5 py-0.5 text-xs text-muted-foreground">
								{t(`peek.type.${card.type}` as never)}
							</span>
							{card.status ? (
								<span className="rounded bg-accent px-1.5 py-0.5 text-xs">{card.status.label}</span>
							) : null}
						</div>
						<p className="truncate text-sm font-medium">{card.title}</p>
						{card.subtitle ? <p className="truncate text-xs text-muted-foreground">{card.subtitle}</p> : null}
						<p className="text-xs text-muted-foreground tnum">
							{new Date(card.updatedAt).toLocaleDateString()}
						</p>
					</div>
				)}
			</PopoverContent>
		</Popover>
	)
}

/** Linked-entities section for the issue detail panel. */
export function EntityLinksSection({ issueId }: { readonly issueId: string }) {
	const { api } = useWorkspace()
	const pushToast = useUiStore((s) => s.pushToast)
	const selectIssue = useUiStore((s) => s.selectIssue)
	const [links, setLinks] = useState<readonly EntityLinkDto[]>([])
	const [pickerOpen, setPickerOpen] = useState(false)

	const refresh = useCallback(() => {
		void api
			.listEntityLinks('issue', issueId)
			.then(setLinks)
			.catch(() => {})
	}, [api, issueId])

	useEffect(() => {
		refresh()
	}, [refresh])

	const removeLink = (linkId: string) => {
		void api
			.deleteEntityLink(linkId)
			.then(() => {
				pushToast({ title: t('tasks.links.removed') })
				refresh()
			})
			.catch(() => pushToast({ title: t('tasks.links.failed'), tone: 'danger' }))
	}

	return (
		<section aria-label={t('tasks.links.title')} className="space-y-2">
			<div className="flex items-center justify-between">
				<h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					<Link2 className="size-3" aria-hidden /> {t('tasks.links.title')}
				</h3>
				<Button
					size="sm"
					tone="ghost"
					aria-label={t('tasks.links.add')}
					onClick={() => setPickerOpen((v) => !v)}
				>
					<Plus className="size-3" aria-hidden />
				</Button>
			</div>
			{links.length === 0 ? (
				<p className="text-xs text-muted-foreground">{t('tasks.links.empty')}</p>
			) : (
				<ul className="space-y-1">
					{links.map((link) => {
						const outbound = link.sourceType === 'issue' && link.sourceId === issueId
						const otherType = outbound ? link.targetType : link.sourceType
						const otherId = outbound ? link.targetId : link.sourceId
						return (
							<li
								key={link.id}
								className="group flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-accent/40"
							>
								<span className="rounded bg-accent px-1.5 py-0.5 text-xs text-muted-foreground">
									{t(`tasks.links.type.${otherType}` as never)}
								</span>
								<EntityPeek type={otherType} id={otherId}>
									<button
										type="button"
										className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
										onClick={() => {
											// Task↔task links navigate in-app; other entity kinds
											// stay peek-only until their surfaces deep-link (§7.1).
											if (otherType === 'issue') selectIssue(otherId, true)
										}}
									>
										{otherId.slice(0, 8)}…
									</button>
								</EntityPeek>
								<span className="text-xs text-muted-foreground">
									{t(`tasks.links.kind.${link.relationKind}` as never)}
								</span>
								<Button
									size="sm"
									tone="ghost"
									className="opacity-0 group-hover:opacity-100"
									aria-label={t('tasks.links.remove')}
									onClick={() => removeLink(link.id)}
								>
									<X className="size-3" aria-hidden />
								</Button>
							</li>
						)
					})}
				</ul>
			)}
			{pickerOpen ? (
				<LinkTargetPicker
					issueId={issueId}
					onDone={() => {
						setPickerOpen(false)
						refresh()
					}}
				/>
			) : null}
		</section>
	)
}

/** Issue→issue link creation: searches workspace tasks via the existing search endpoint. */
function LinkTargetPicker({ issueId, onDone }: { readonly issueId: string; readonly onDone: () => void }) {
	const { api } = useWorkspace()
	const pushToast = useUiStore((s) => s.pushToast)
	const [query, setQuery] = useState('')
	const [hits, setHits] = useState<readonly { id: string; title: string }[]>([])

	useEffect(() => {
		if (query.trim().length < 2) {
			setHits([])
			return
		}
		let cancelled = false
		const handle = setTimeout(() => {
			void api
				.searchIssues(query.trim())
				.then((res) => {
					if (!cancelled) {
						setHits(
							res
								.filter((h) => h.entityType === 'issue' && h.entityId !== issueId)
								.slice(0, 8)
								.map((h) => ({ id: h.entityId, title: h.title }))
						)
					}
				})
				.catch(() => {})
		}, 250)
		return () => {
			cancelled = true
			clearTimeout(handle)
		}
	}, [api, issueId, query])

	return (
		<div className="space-y-1 rounded-md border border-border p-2">
			<input
				type="search"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				placeholder={t('tasks.triage.search-placeholder')}
				aria-label={t('tasks.links.pick-target')}
				className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
			/>
			<ul className="max-h-40 space-y-0.5 overflow-y-auto">
				{hits.map((h) => (
					<li key={h.id}>
						<button
							type="button"
							className="w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-accent/50"
							onClick={() => {
								void api
									.createEntityLink({
										sourceType: 'issue',
										sourceId: issueId,
										targetType: 'issue',
										targetId: h.id,
										relationKind: 'references'
									})
									.then(() => {
										pushToast({ title: t('tasks.links.added') })
										onDone()
									})
									.catch(() => pushToast({ title: t('tasks.links.failed'), tone: 'danger' }))
							}}
						>
							{h.title}
						</button>
					</li>
				))}
			</ul>
		</div>
	)
}
