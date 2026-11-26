import { t } from '@huriro/i18n'
import { useCollectionItems } from '@huriro/sync-client'
import { useNavigate } from '@tanstack/react-router'
import { Database, Plus, Rows3 } from 'lucide-react'
import { type FormEvent, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useWorkspace } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'

/** Standalone database index: full-page databases are first-class docs surfaces,
 * not only blocks embedded inside another page. */
export function DatabaseHome() {
	const { engine } = useWorkspace()
	const navigate = useNavigate()
	const pushToast = useUiStore((state) => state.pushToast)
	const databases = useCollectionItems(engine.collections.docDatabases)
	const rows = useCollectionItems(engine.collections.docDatabaseRows)
	const [open, setOpen] = useState(false)
	const [title, setTitle] = useState('')
	const [busy, setBusy] = useState(false)

	const sortedDatabases = useMemo(
		() => [...databases].sort((a, b) => a.title.localeCompare(b.title)),
		[databases]
	)
	const rowCounts = useMemo(() => {
		const counts = new Map<string, number>()
		for (const row of rows) {
			if (row.archivedAt === null) counts.set(row.databaseId, (counts.get(row.databaseId) ?? 0) + 1)
		}
		return counts
	}, [rows])

	async function handleCreate(event: FormEvent) {
		event.preventDefault()
		if (busy || !title.trim()) return
		setBusy(true)
		try {
			const detail = await engine.createDocDatabase({ title: title.trim(), isInline: false })
			setOpen(false)
			setTitle('')
			void navigate({ to: '/docs/databases/$databaseId', params: { databaseId: detail.database.id } })
		} catch (error) {
			pushToast({
				tone: 'danger',
				title: t('databases.error.create-database'),
				description: error instanceof Error ? error.message : undefined
			})
		} finally {
			setBusy(false)
		}
	}

	return (
		<main className="mx-auto w-full max-w-6xl space-y-5 p-6">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div className="space-y-1">
					<h1 className="flex items-center gap-2 font-semibold text-2xl tracking-tight">
						<Database className="size-6 text-primary" aria-hidden />
						{t('databases.home.title')}
					</h1>
					<p className="text-muted-foreground text-sm">{t('databases.home.description')}</p>
				</div>
				<Dialog open={open} onOpenChange={setOpen}>
					<DialogTrigger asChild>
						<Button type="button" size="sm">
							<Plus className="size-4" aria-hidden />
							{t('databases.home.new')}
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>{t('databases.home.new-title')}</DialogTitle>
						</DialogHeader>
						<form onSubmit={(event) => void handleCreate(event)} className="space-y-3">
							<Input
								aria-label={t('databases.home.name')}
								value={title}
								onChange={(event) => setTitle(event.target.value)}
								placeholder={t('databases.home.name-placeholder')}
							/>
							<DialogFooter>
								<Button type="submit" disabled={busy || !title.trim()}>
									{t('common.save')}
								</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>
			</header>

			{sortedDatabases.length === 0 ? (
				<Card className="flex flex-col items-center gap-2 border-dashed p-10 text-center">
					<Database className="size-8 text-muted-foreground" aria-hidden />
					<h2 className="font-medium">{t('databases.home.empty-title')}</h2>
					<p className="max-w-md text-muted-foreground text-sm">{t('databases.home.empty-description')}</p>
				</Card>
			) : (
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{sortedDatabases.map((database) => (
						<button
							key={database.id}
							type="button"
							onClick={() =>
								void navigate({ to: '/docs/databases/$databaseId', params: { databaseId: database.id } })
							}
							className="rounded-xl border border-border bg-card p-4 text-left shadow-(--shadow-1) transition-colors hover:border-primary/40 hover:bg-accent/40"
						>
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0">
									<h2 className="truncate font-medium">
										{database.icon ? `${database.icon} ` : ''}
										{database.title}
									</h2>
									<p className="mt-1 flex items-center gap-1 text-muted-foreground text-xs">
										<Rows3 className="size-3.5" aria-hidden />
										{t('databases.home.row-count', { count: rowCounts.get(database.id) ?? 0 })}
									</p>
								</div>
								{database.isInline ? (
									<Badge tone="outline">{t('databases.home.inline')}</Badge>
								) : (
									<Badge tone="secondary">{t('databases.home.full-page')}</Badge>
								)}
							</div>
						</button>
					))}
				</div>
			)}
		</main>
	)
}
