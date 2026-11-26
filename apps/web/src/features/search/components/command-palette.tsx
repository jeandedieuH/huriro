import type { SearchHitDto } from '@huriro/contracts'
import { type MessageId, t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import {
	Command,
	Download,
	FolderPlus,
	Home,
	Inbox,
	Keyboard,
	LayoutList,
	Mail,
	Moon,
	Plus,
	RefreshCw,
	Search,
	UserCheck
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useWorkspaceAvailability } from '@/features/availability/hooks/use-availability'
import { navigateToChat, navigateToDoc, navigateToMail } from '@/lib/navigation'
import type { TaskApiBridge } from '@/lib/sync-bootstrap'
import { type AppDestination, useUiStore } from '@/stores/ui-store'

export interface CommandPaletteProps {
	readonly api: TaskApiBridge
}

interface PaletteItem {
	readonly id: string
	readonly section: 'actions' | 'navigation' | 'content'
	readonly label: string
	readonly hint?: string | undefined
	readonly onRun: () => void
}

export function CommandPalette({ api }: CommandPaletteProps) {
	const engine = useSyncEngine()
	const localIssues = useCollectionItems(engine.collections.issues)
	const localDocs = useCollectionItems(engine.collections.docPages)

	const open = useUiStore((s) => s.commandPaletteOpen)
	const setOpen = useUiStore((s) => s.setCommandPaletteOpen)
	const setDestination = useUiStore((s) => s.setDestination)
	const setTasksLayout = useUiStore((s) => s.setTasksLayout)
	const setCreateIssueOpen = useUiStore((s) => s.setCreateIssueOpen)
	const setCreateDocOpen = useUiStore((s) => s.setCreateDocOpen)
	const setCreateProjectOpen = useUiStore((s) => s.setCreateProjectOpen)
	const setShortcutsDialogOpen = useUiStore((s) => s.setShortcutsDialogOpen)
	const setImportDialogOpen = useUiStore((s) => s.setImportDialogOpen)
	const toggleTheme = useUiStore((s) => s.toggleTheme)
	const selectIssue = useUiStore((s) => s.selectIssue)
	const pushToast = useUiStore((s) => s.pushToast)
	const { myAvailability, updateMyAvailability } = useWorkspaceAvailability()

	const [query, setQuery] = useState('')
	const [activeIndex, setActiveIndex] = useState(0)
	const [serverHits, setServerHits] = useState<SearchHitDto[]>([])

	useEffect(() => {
		if (!open) {
			setQuery('')
			setServerHits([])
			setActiveIndex(0)
		}
	}, [open])

	// 120 ms debounced FTS/trigram search against server/bridge (§17.7)
	useEffect(() => {
		if (!open) return
		const cleaned = query.trim().replace(/^>\s*/, '')
		if (cleaned.length < 2 || query.trim().startsWith('>')) {
			setServerHits([])
			return
		}
		const timer = setTimeout(() => {
			void api
				.searchIssues(cleaned)
				.then((hits) => setServerHits(hits))
				.catch(() => setServerHits([]))
		}, 120)
		return () => clearTimeout(timer)
	}, [api, open, query])

	const items = useMemo<PaletteItem[]>(() => {
		const trimmed = query.trim()
		const isActionOnly = trimmed.startsWith('>')
		const searchTerm = (isActionOnly ? trimmed.slice(1) : trimmed).trim().toLowerCase()

		const actions: PaletteItem[] = [
			{
				id: 'act-create-issue',
				section: 'actions',
				label: t('palette.action.create-issue'),
				hint: 'C',
				onRun: () => {
					setOpen(false)
					setDestination('tasks')
					setCreateIssueOpen(true)
				}
			},
			{
				id: 'act-create-doc',
				section: 'actions',
				label: t('docs.palette.new-doc'),
				onRun: () => {
					setOpen(false)
					setDestination('docs')
					setCreateDocOpen(true)
				}
			},
			{
				id: 'act-create-project',
				section: 'actions',
				label: t('palette.action.create-project'),
				onRun: () => {
					setOpen(false)
					setDestination('tasks')
					setCreateProjectOpen(true)
				}
			},
			{
				id: 'act-import',
				section: 'actions',
				label: t('palette.action.import'),
				onRun: () => {
					setOpen(false)
					setImportDialogOpen(true)
				}
			},
			{
				id: 'act-theme',
				section: 'actions',
				label: t('palette.action.toggle-theme'),
				onRun: () => {
					setOpen(false)
					toggleTheme()
				}
			},
			{
				id: 'act-availability-settings',
				section: 'actions',
				label: t('availability.command.open-settings'),
				onRun: () => {
					setOpen(false)
					setDestination('settings')
					useUiStore.getState().setSettingsSection('availability')
				}
			},
			{
				id: 'act-availability-dnd',
				section: 'actions',
				label: t('availability.command.toggle-dnd'),
				onRun: () => {
					setOpen(false)
					if (!myAvailability) return
					const active = myAvailability.dndUntil !== null && Date.parse(myAvailability.dndUntil) > Date.now()
					void updateMyAvailability({
						dndUntil: active ? null : new Date(Date.now() + 3_600_000).toISOString(),
						expectedVersion: myAvailability.version
					})
				}
			},
			{
				id: 'act-shortcuts',
				section: 'actions',
				label: t('palette.action.shortcuts'),
				hint: '?',
				onRun: () => {
					setOpen(false)
					setShortcutsDialogOpen(true)
				}
			},
			{
				id: 'act-force-resync',
				section: 'actions',
				label: t('palette.action.force-resync'),
				onRun: () => {
					setOpen(false)
					void engine
						.flushOutbox({ force: true })
						.then(() => engine.resyncSnapshot())
						.then((ok) => {
							if (ok) pushToast({ tone: 'success', title: t('sync.resync-done') })
						})
				}
			}
		]

		const navDestinations: { id: AppDestination; labelId: MessageId; hint: string }[] = [
			{ id: 'home', labelId: 'nav.home', hint: 'G H' },
			{ id: 'inbox', labelId: 'nav.inbox', hint: 'G I' },
			{ id: 'tasks', labelId: 'nav.tasks', hint: 'G T' },
			{ id: 'docs', labelId: 'nav.docs', hint: 'G D' },
			{ id: 'chat', labelId: 'nav.chat', hint: 'G C' },
			{ id: 'settings', labelId: 'nav.settings', hint: 'G S' }
		]
		const navigation: PaletteItem[] = [
			...navDestinations.map((dest) => ({
				id: `nav-${dest.id}`,
				section: 'navigation' as const,
				label: t(dest.labelId),
				hint: dest.hint,
				onRun: () => {
					setDestination(dest.id)
					setOpen(false)
				}
			})),
			{
				id: 'nav-shared-mail',
				section: 'navigation',
				label: t('mail.sidebar.all'),
				onRun: () => {
					navigateToMail()
					setOpen(false)
				}
			},
			{
				id: 'nav-my-work',
				section: 'navigation',
				label: t('palette.action.my-work'),
				onRun: () => {
					setDestination('tasks')
					setTasksLayout('my-work')
					setOpen(false)
				}
			}
		]

		const content: PaletteItem[] = []
		if (!isActionOnly) {
			const mergedIds = new Set<string>()
			for (const hit of serverHits) {
				mergedIds.add(hit.entityId)
				content.push({
					id: `hit-${hit.entityId}`,
					section: 'content',
					label: `${hit.identifier && hit.entityType !== 'doc_page' ? `${hit.identifier} · ` : ''}${hit.title}`,
					hint: hit.snippet.slice(0, 48),
					onRun: () => {
						if (hit.entityType === 'doc_page') {
							const withoutPrefix = hit.deepLink.replace(/^\/docs\//, '')
							const [slugPart, hashPart] = withoutPrefix.split('#')
							navigateToDoc(slugPart || hit.identifier || hit.entityId, hashPart)
						} else if (hit.entityType === 'message') {
							const url = new URL(hit.deepLink, 'http://localhost')
							const chan = url.searchParams.get('channel') ?? undefined
							const msgId = url.searchParams.get('message') ?? hit.entityId
							navigateToChat(chan, msgId)
						} else if (hit.entityType === 'mail_message') {
							const url = new URL(hit.deepLink, 'http://localhost')
							const convId = url.searchParams.get('conversation') ?? undefined
							navigateToMail(convId)
						} else {
							setDestination('tasks')
							selectIssue(hit.entityId, true)
						}
						setOpen(false)
					}
				})
			}

			// Also surface local replica matches offline with 0ms latency
			for (const issue of localIssues) {
				if (mergedIds.has(issue.id)) continue
				if (
					searchTerm.length === 0 ||
					issue.title.toLowerCase().includes(searchTerm) ||
					issue.identifier.toLowerCase().includes(searchTerm)
				) {
					content.push({
						id: `local-${issue.id}`,
						section: 'content',
						label: `${issue.identifier} · ${issue.title}`,
						onRun: () => {
							setDestination('tasks')
							selectIssue(issue.id, true)
							setOpen(false)
						}
					})
				}
				if (content.length >= 10) break
			}

			for (const doc of localDocs) {
				if (doc.archivedAt !== null || mergedIds.has(doc.id)) continue
				if (
					searchTerm.length === 0 ||
					doc.title.toLowerCase().includes(searchTerm) ||
					doc.slug.toLowerCase().includes(searchTerm)
				) {
					content.push({
						id: `local-doc-${doc.id}`,
						section: 'content',
						label: doc.title,
						hint: `/docs/${doc.slug}`,
						onRun: () => {
							navigateToDoc(doc.slug)
							setOpen(false)
						}
					})
				}
				if (content.length >= 16) break
			}
		}

		const filterFn = (item: PaletteItem) =>
			!searchTerm || item.label.toLowerCase().includes(searchTerm) || item.section === 'content'

		return [...actions.filter(filterFn), ...navigation.filter(filterFn), ...content]
	}, [
		engine,
		localDocs,
		localIssues,
		myAvailability,
		pushToast,
		query,
		selectIssue,
		serverHits,
		setCreateDocOpen,
		setCreateIssueOpen,
		setCreateProjectOpen,
		setDestination,
		setImportDialogOpen,
		setOpen,
		setShortcutsDialogOpen,
		setTasksLayout,
		toggleTheme,
		updateMyAvailability
	])

	function handleKeyDown(ev: React.KeyboardEvent) {
		if (ev.key === 'ArrowDown') {
			ev.preventDefault()
			setActiveIndex((prev) => (items.length === 0 ? 0 : (prev + 1) % items.length))
		} else if (ev.key === 'ArrowUp') {
			ev.preventDefault()
			setActiveIndex((prev) => (items.length === 0 ? 0 : (prev - 1 + items.length) % items.length))
		} else if (ev.key === 'Enter') {
			const selected = items[activeIndex]
			if (selected) {
				ev.preventDefault()
				selected.onRun()
			}
		}
	}

	const sections: { key: PaletteItem['section']; titleId: MessageId }[] = [
		{ key: 'actions', titleId: 'palette.section.actions' },
		{ key: 'navigation', titleId: 'palette.section.navigation' },
		{ key: 'content', titleId: 'palette.section.content' }
	]

	let flatIdx = -1

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
				<DialogHeader className="sr-only">
					<DialogTitle>{t('palette.title')}</DialogTitle>
					<DialogDescription>{t('palette.placeholder')}</DialogDescription>
				</DialogHeader>

				<div className="flex items-center border-b border-border px-3">
					<Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
					{/* Borderless input: suppress the global :focus-visible ring (globals.css)
					    — the caret signals focus. pr-8 keeps text clear of the close button. */}
					<Input
						value={query}
						onChange={(ev) => {
							setQuery(ev.target.value)
							setActiveIndex(0)
						}}
						onKeyDown={handleKeyDown}
						placeholder={t('palette.placeholder')}
						aria-label={t('palette.title')}
						autoFocus
						className="h-11 border-0 pr-8 shadow-none focus-visible:border-0 focus-visible:outline-none"
					/>
				</div>

				<div role="listbox" aria-label={t('palette.title')} className="max-h-80 overflow-y-auto p-2">
					{items.length === 0 ? (
						<p className="py-8 text-center text-sm text-muted-foreground">{t('palette.empty')}</p>
					) : (
						sections.map((section) => {
							const group = items.filter((item) => item.section === section.key)
							if (group.length === 0) return null
							return (
								<div key={section.key} className="mb-2 last:mb-0">
									<p className="px-2 py-1 text-xs font-semibold text-muted-foreground">
										{t(section.titleId)}
									</p>
									{group.map((item) => {
										flatIdx += 1
										const idx = flatIdx
										const active = idx === activeIndex
										return (
											<button
												key={item.id}
												type="button"
												role="option"
												aria-selected={active}
												onMouseEnter={() => setActiveIndex(idx)}
												onClick={item.onRun}
												className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm ${
													active ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/50'
												}`}
											>
												<span className="flex min-w-0 items-center gap-2">
													{item.id === 'act-create-issue' ? (
														<Plus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
													) : item.id === 'act-create-project' ? (
														<FolderPlus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
													) : item.id === 'act-import' ? (
														<Download className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
													) : item.id === 'act-theme' ? (
														<Moon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
													) : item.id === 'act-shortcuts' ? (
														<Keyboard className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
													) : item.id === 'act-force-resync' ? (
														<RefreshCw className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
													) : item.id === 'nav-home' ? (
														<Home className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
													) : item.id === 'nav-inbox' ? (
														<Inbox className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
													) : item.id === 'nav-shared-mail' ? (
														<Mail className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
													) : item.id === 'nav-my-work' ? (
														<UserCheck className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
													) : item.section === 'navigation' ? (
														<LayoutList className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
													) : (
														<Command className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
													)}
													<span className="truncate font-medium">{item.label}</span>
												</span>
												{item.hint ? (
													<span className="shrink-0 font-mono text-xs text-muted-foreground tnum">
														{item.hint}
													</span>
												) : null}
											</button>
										)
									})}
								</div>
							)
						})
					)}
				</div>
			</DialogContent>
		</Dialog>
	)
}
