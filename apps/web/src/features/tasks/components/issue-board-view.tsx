import type { IssueDto, ProjectStatusDto } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { ArrowRightLeft, Clock } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui-store'
import { PriorityBadge, StatusIcon } from './priority-status-badge'

export interface IssueBoardViewProps {
	readonly statuses: readonly ProjectStatusDto[]
	readonly issues: readonly IssueDto[]
	readonly pendingEntityIds: ReadonlySet<string>
	readonly announcement: string
	readonly onMoveIssue: (
		issueId: string,
		target: { statusId: string; afterIssueId?: string; beforeIssueId?: string }
	) => Promise<void>
}

function comparePos(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Kanban Board view (§9.5, §17.6, WCAG 2.2.2.1):
 * - Columns sorted by status `position`, cards sorted by issue `position` (COLLATE "C").
 * - Supports HTML5 drag-and-drop AND full non-drag alternatives:
 *   keyboard `H`/`L` (column move), `Mod+↑`/`Mod+↓` (reorder), and explicit `"Move to…"` menu.
 * - Live region announces moves for screen readers.
 */
export function IssueBoardView({
	statuses,
	issues,
	pendingEntityIds,
	announcement,
	onMoveIssue
}: IssueBoardViewProps) {
	const focusedIssueId = useUiStore((s) => s.focusedIssueId)
	const selectedIssueId = useUiStore((s) => s.selectedIssueId)
	const selectIssue = useUiStore((s) => s.selectIssue)
	const setFocusedIssueId = useUiStore((s) => s.setFocusedIssueId)

	const [draggedId, setDraggedId] = useState<string | null>(null)
	const [dragOverStatusId, setDragOverStatusId] = useState<string | null>(null)

	const sortedStatuses = [...statuses].sort((a, b) => comparePos(a.position, b.position))

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<div role="status" aria-live="polite" className="sr-only">
				{announcement}
			</div>

			<div className="flex flex-1 gap-4 overflow-x-auto p-4">
				{sortedStatuses.map((status) => {
					const columnIssues = issues
						.filter((issue) => issue.statusId === status.id)
						.sort((a, b) => comparePos(a.position, b.position))

					return (
						<section
							key={status.id}
							aria-label={status.name}
							onDragOver={(ev) => {
								ev.preventDefault()
								setDragOverStatusId(status.id)
							}}
							onDragLeave={() => {
								if (dragOverStatusId === status.id) setDragOverStatusId(null)
							}}
							onDrop={(ev) => {
								ev.preventDefault()
								setDragOverStatusId(null)
								const droppedId = draggedId ?? ev.dataTransfer.getData('text/plain')
								setDraggedId(null)
								if (!droppedId) return
								const last = columnIssues.filter((i) => i.id !== droppedId).at(-1)
								void onMoveIssue(droppedId, {
									statusId: status.id,
									...(last ? { afterIssueId: last.id } : {})
								})
							}}
							className={cn(
								'flex w-72 shrink-0 flex-col rounded-lg border border-border bg-surface-2/60',
								dragOverStatusId === status.id && 'border-ring bg-accent/30'
							)}
						>
							<header className="flex items-center justify-between border-b border-border px-3 py-2">
								<div className="flex items-center gap-2">
									<StatusIcon category={status.category} />
									<h3 className="text-sm font-semibold">{status.name}</h3>
								</div>
								<span className="font-mono text-xs text-muted-foreground tnum">{columnIssues.length}</span>
							</header>

							<div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
								{columnIssues.map((issue) => {
									const isFocused = focusedIssueId === issue.id
									const isSelected = selectedIssueId === issue.id
									const isPending = pendingEntityIds.has(issue.id)

									return (
										<article
											key={issue.id}
											draggable
											data-issue-id={issue.id}
											data-focused={isFocused || undefined}
											onDragStart={(ev) => {
												setDraggedId(issue.id)
												ev.dataTransfer.setData('text/plain', issue.id)
												ev.dataTransfer.effectAllowed = 'move'
											}}
											onDragOver={(ev) => {
												ev.preventDefault()
											}}
											onDrop={(ev) => {
												ev.stopPropagation()
												ev.preventDefault()
												setDragOverStatusId(null)
												const droppedId = draggedId ?? ev.dataTransfer.getData('text/plain')
												setDraggedId(null)
												if (!droppedId || droppedId === issue.id) return
												void onMoveIssue(droppedId, {
													statusId: status.id,
													beforeIssueId: issue.id
												})
											}}
											onFocus={() => setFocusedIssueId(issue.id)}
											className={cn(
												'group rounded-md border border-border bg-card p-3 shadow-(--shadow-1) transition-shadow',
												isSelected && 'border-primary',
												isFocused && 'ring-2 ring-ring'
											)}
										>
											<div className="flex items-center justify-between gap-2">
												<span className="font-mono text-xs text-muted-foreground tnum">
													{issue.identifier}
												</span>
												<div className="flex items-center gap-1">
													{isPending ? (
														<Clock className="size-3 text-(--warning)" aria-label={t('tasks.pending-sync')} />
													) : null}
													<DropdownMenu>
														<DropdownMenuTrigger asChild>
															<Button
																size="icon"
																tone="ghost"
																className="size-6"
																aria-label={`${t('tasks.move-to')} (${issue.identifier})`}
															>
																<ArrowRightLeft className="size-3.5" aria-hidden />
															</Button>
														</DropdownMenuTrigger>
														<DropdownMenuContent align="end">
															<DropdownMenuLabel>{t('tasks.move-to')}</DropdownMenuLabel>
															<DropdownMenuSeparator />
															{sortedStatuses.map((targetStatus) => (
																<DropdownMenuItem
																	key={targetStatus.id}
																	disabled={targetStatus.id === issue.statusId}
																	onSelect={() => {
																		const colTail = issues
																			.filter((i) => i.statusId === targetStatus.id && i.id !== issue.id)
																			.sort((a, b) => comparePos(a.position, b.position))
																			.at(-1)
																		void onMoveIssue(issue.id, {
																			statusId: targetStatus.id,
																			...(colTail ? { afterIssueId: colTail.id } : {})
																		})
																	}}
																>
																	<StatusIcon category={targetStatus.category} />
																	<span>{targetStatus.name}</span>
																</DropdownMenuItem>
															))}
														</DropdownMenuContent>
													</DropdownMenu>
												</div>
											</div>

											<button
												type="button"
												onClick={() => selectIssue(issue.id, true)}
												className="mt-1.5 block w-full text-left text-sm font-medium text-foreground hover:text-primary"
											>
												{issue.title}
											</button>

											<div className="mt-2.5 flex items-center justify-between">
												<PriorityBadge priority={issue.priority} />
											</div>
										</article>
									)
								})}
							</div>
						</section>
					)
				})}
			</div>
		</div>
	)
}
