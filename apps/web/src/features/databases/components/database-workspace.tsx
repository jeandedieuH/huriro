import type { MailConversationDto } from '@huriro/contracts'
import {
	compareDatabaseRows,
	type DatabaseFilterExpr,
	type DatabaseSortSpec,
	evaluateDatabaseFilter
} from '@huriro/domain'
import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncScope } from '@huriro/sync-client'
import { useNavigate } from '@tanstack/react-router'
import {
	Calendar,
	GalleryVertical,
	Import,
	Kanban,
	List,
	Plus,
	Settings2,
	Table2,
	Timeline
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import type { WorkspaceMemberSummary } from '@/lib/api-bridge'
import { useWorkspace } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'
import type { DatabaseCellValue } from './cell-editor'
import { PropertyConfigForm, ViewConfigForm } from './database-config'
import { DatabaseWorkspaceContextProvider } from './database-context'
import { DatabaseViewRenderer } from './database-views'
import { PropertyEditorDialog } from './property-editor-dialog'

const VIEW_ICONS: Record<string, ReactNode> = {
	table: <Table2 className="size-3.5" aria-hidden />,
	board: <Kanban className="size-3.5" aria-hidden />,
	gallery: <GalleryVertical className="size-3.5" aria-hidden />,
	calendar: <Calendar className="size-3.5" aria-hidden />,
	timeline: <Timeline className="size-3.5" aria-hidden />,
	list: <List className="size-3.5" aria-hidden />
}
const VIEW_TYPES = ['table', 'board', 'gallery', 'calendar', 'timeline', 'list'] as const
const PROPERTY_TYPES = [
	'text',
	'number',
	'select',
	'multi_select',
	'status',
	'date',
	'person',
	'checkbox',
	'url',
	'email',
	'phone',
	'file',
	'relation',
	'rollup',
	'formula'
] as const

function sortedByPosition<T extends { readonly position: string; readonly id: string }>(
	items: readonly T[]
): T[] {
	return [...items].sort((a, b) =>
		a.position < b.position ? -1 : a.position > b.position ? 1 : a.id.localeCompare(b.id)
	)
}

function DatabaseRelationScope({ databaseId }: { readonly databaseId: string }) {
	useSyncScope(`db:${databaseId}`)
	return null
}

export interface DatabaseWorkspaceProps {
	readonly databaseId: string
	readonly viewId?: string | undefined
	readonly compact?: boolean
	readonly readOnly?: boolean
}

export function DatabaseWorkspace({
	databaseId,
	viewId,
	compact = false,
	readOnly = false
}: DatabaseWorkspaceProps) {
	const { engine, api } = useWorkspace()
	const navigate = useNavigate()
	const pushToast = useUiStore((state) => state.pushToast)
	const scope = useSyncScope(`db:${databaseId}`, { pinned: true })
	const databases = useCollectionItems(engine.collections.docDatabases)
	const allProperties = useCollectionItems(engine.collections.docDatabaseProperties)
	const allViews = useCollectionItems(engine.collections.docDatabaseViews)
	const allRows = useCollectionItems(engine.collections.docDatabaseRows)
	const issues = useCollectionItems(engine.collections.issues)
	const [members, setMembers] = useState<WorkspaceMemberSummary[]>([])
	const [mailConversations, setMailConversations] = useState<MailConversationDto[]>([])
	useEffect(() => {
		let cancelled = false
		void api
			.listMembers()
			.then((list) => {
				if (!cancelled) setMembers(list)
			})
			.catch(() => {})
		void api
			.listMailConversations({})
			.then((page) => {
				if (!cancelled) setMailConversations(page.data)
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [api])
	const databaseContext = useMemo(
		() => ({
			allRows,
			issues,
			mailConversations,
			members,
			uploadFile: api.uploadFile ? api.uploadFile.bind(api) : null
		}),
		[allRows, api, issues, mailConversations, members]
	)
	const database = databases.find((item) => item.id === databaseId)
	const properties = useMemo(
		() => sortedByPosition(allProperties.filter((item) => item.databaseId === databaseId)),
		[allProperties, databaseId]
	)
	const relationTargetDatabaseIds = useMemo(
		() => [
			...new Set(
				properties
					.filter((property) => property.propType === 'relation')
					.map((property) => property.config['targetDatabaseId'])
					.filter((id): id is string => typeof id === 'string' && id.length > 0 && id !== databaseId)
			)
		],
		[databaseId, properties]
	)
	const views = useMemo(
		() => sortedByPosition(allViews.filter((item) => item.databaseId === databaseId)),
		[allViews, databaseId]
	)
	const rows = useMemo(
		() =>
			sortedByPosition(allRows.filter((item) => item.databaseId === databaseId && item.archivedAt === null)),
		[allRows, databaseId]
	)
	const [selectedViewId, setSelectedViewId] = useState(viewId)
	useEffect(() => setSelectedViewId(viewId), [viewId])
	const activeView = views.find((view) => view.id === (selectedViewId ?? viewId)) ?? views[0]
	const viewConfig = (activeView?.config ?? {}) as Record<string, unknown>
	const visibleRows = useMemo(() => {
		let result = rows
		const filter = viewConfig['filter'] as DatabaseFilterExpr | undefined
		if (filter) result = result.filter((row) => evaluateDatabaseFilter(filter, row, properties))
		const sorts = Array.isArray(viewConfig['sorts']) ? (viewConfig['sorts'] as DatabaseSortSpec[]) : []
		if (sorts.length > 0) result = [...result].sort((a, b) => compareDatabaseRows(a, b, sorts, properties))
		return result
	}, [properties, rows, viewConfig])
	const hiddenPropertyIds = useMemo(
		() =>
			new Set(
				Array.isArray(viewConfig['hiddenPropertyIds']) ? (viewConfig['hiddenPropertyIds'] as string[]) : []
			),
		[viewConfig]
	)
	const visibleProperties = useMemo(() => {
		const configuredOrder = Array.isArray(viewConfig['propertyOrder'])
			? (viewConfig['propertyOrder'] as unknown[]).filter((id): id is string => typeof id === 'string')
			: []
		const rank = new Map(configuredOrder.map((id, index) => [id, index]))
		const ordered = [...properties].sort((a, b) => {
			const ar = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER
			const br = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER
			if (ar !== br) return ar - br
			return a.position.localeCompare(b.position)
		})
		return ordered.filter((property) => !hiddenPropertyIds.has(property.id))
	}, [hiddenPropertyIds, properties, viewConfig])
	const [addViewOpen, setAddViewOpen] = useState(false)
	const [newViewType, setNewViewType] = useState<(typeof VIEW_TYPES)[number]>('table')
	const [newViewName, setNewViewName] = useState('')
	const [addPropertyOpen, setAddPropertyOpen] = useState(false)
	const [propertyName, setPropertyName] = useState('')
	const [propertyType, setPropertyType] = useState<(typeof PROPERTY_TYPES)[number]>('text')
	const [propertyConfig, setPropertyConfig] = useState<Record<string, unknown>>({})
	const [viewConfigOpen, setViewConfigOpen] = useState(false)
	const [importOpen, setImportOpen] = useState(false)
	const [importFormat, setImportFormat] = useState<'csv' | 'json'>('csv')
	const [importData, setImportData] = useState('')
	const [busy, setBusy] = useState(false)

	if (!database) {
		return scope.ready ? (
			<div className="rounded-lg border border-border/70 p-4 text-muted-foreground text-sm">
				{t('databases.not-found')}
			</div>
		) : (
			<Skeleton className="h-48 w-full" />
		)
	}
	if (!scope.ready && rows.length === 0) return <Skeleton className="h-56 w-full" />

	const commitCell = (rowId: string, propertyId: string, cell: DatabaseCellValue, title?: string) => {
		if (readOnly) return
		void engine
			.updateDocDatabaseRow(databaseId, rowId, {
				cells: { [propertyId]: cell },
				...(title !== undefined ? { title } : {})
			})
			.catch((error: unknown) =>
				pushToast({
					title: t('databases.error.save'),
					description: error instanceof Error ? error.message : undefined,
					tone: 'danger'
				})
			)
	}

	const openRow = async (rowId: string) => {
		try {
			const allocated = await api.ensureDocDatabaseRowPage(databaseId, rowId)
			const detail = await api.getDocDetail(allocated.pageId)
			void navigate({ to: '/docs/$slug', params: { slug: detail.page.slug } })
		} catch (error) {
			pushToast({
				title: t('databases.error.open-row'),
				description: error instanceof Error ? error.message : undefined,
				tone: 'danger'
			})
		}
	}

	const addRow = () => {
		void engine.createDocDatabaseRow(databaseId, { title: '' }).catch((error: unknown) =>
			pushToast({
				title: t('databases.error.add-row'),
				description: error instanceof Error ? error.message : undefined,
				tone: 'danger'
			})
		)
	}

	const createView = () => {
		void engine
			.createDocDatabaseView(databaseId, {
				name: newViewName || t(`databases.view.${newViewType}`),
				viewType: newViewType,
				config: {}
			})
			.then(() => {
				setAddViewOpen(false)
				setNewViewName('')
			})
			.catch((error: unknown) =>
				pushToast({
					title: t('databases.error.add-view'),
					description: error instanceof Error ? error.message : undefined,
					tone: 'danger'
				})
			)
	}

	const createProperty = () => {
		const config = { ...propertyConfig }
		void engine
			.createDocDatabaseProperty(databaseId, {
				name: propertyName || t('databases.property.untitled'),
				propType: propertyType,
				config
			})
			.then(() => {
				setAddPropertyOpen(false)
				setPropertyName('')
				setPropertyConfig({})
			})
			.catch((error: unknown) =>
				pushToast({
					title: t('databases.error.add-property'),
					description: error instanceof Error ? error.message : undefined,
					tone: 'danger'
				})
			)
	}

	const runImport = () => {
		setBusy(true)
		void api
			.importDocDatabaseRows(databaseId, { format: importFormat, data: importData })
			.then((result) => {
				setImportOpen(false)
				setImportData('')
				pushToast({ title: t('databases.import.complete', { count: result.created }), tone: 'success' })
				void engine.resyncSnapshot()
			})
			.catch((error: unknown) =>
				pushToast({
					title: t('databases.error.import'),
					description: error instanceof Error ? error.message : undefined,
					tone: 'danger'
				})
			)
			.finally(() => setBusy(false))
	}

	const runExport = (format: 'csv' | 'json') => {
		void api
			.exportDocDatabaseRows(databaseId, format, activeView?.id)
			.then((data) => {
				const blob = new Blob([data], { type: format === 'csv' ? 'text/csv' : 'application/json' })
				const url = URL.createObjectURL(blob)
				const link = document.createElement('a')
				link.href = url
				link.download = `${database.title || 'database'}.${format}`
				link.click()
				URL.revokeObjectURL(url)
			})
			.catch((error: unknown) =>
				pushToast({
					title: t('databases.error.export'),
					description: error instanceof Error ? error.message : undefined,
					tone: 'danger'
				})
			)
	}

	return (
		<DatabaseWorkspaceContextProvider value={databaseContext}>
			{relationTargetDatabaseIds.map((id) => (
				<DatabaseRelationScope key={id} databaseId={id} />
			))}
			<section
				aria-label={database.title}
				className="space-y-3 rounded-xl border border-border/80 bg-background p-3"
			>
				<header className="flex flex-wrap items-center justify-between gap-2">
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<h2 className="truncate font-semibold text-lg">
								{database.icon} {database.title}
							</h2>
							<Badge tone="secondary">{rows.length}</Badge>
						</div>
						{!compact ? <p className="text-muted-foreground text-xs">{t('databases.subtitle')}</p> : null}
					</div>
					<div className="flex flex-wrap items-center gap-1.5">
						<Dialog open={importOpen} onOpenChange={setImportOpen}>
							<DialogTrigger asChild>
								<Button type="button" size="sm" tone="outline">
									<Import className="size-3.5" aria-hidden />
									{t('databases.import.action')}
								</Button>
							</DialogTrigger>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>{t('databases.import.title')}</DialogTitle>
									<DialogDescription>{t('databases.import.description')}</DialogDescription>
								</DialogHeader>
								<Select
									value={importFormat}
									onValueChange={(value) => setImportFormat(value === 'json' ? 'json' : 'csv')}
								>
									<SelectTrigger aria-label={t('databases.import.format')}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="csv">CSV</SelectItem>
										<SelectItem value="json">JSON</SelectItem>
									</SelectContent>
								</Select>
								<Textarea
									aria-label={t('databases.import.data')}
									value={importData}
									onChange={(event) => setImportData(event.target.value)}
									rows={9}
									className="font-mono text-xs"
								/>
								<DialogFooter>
									<Button type="button" disabled={busy || !importData.trim()} onClick={runImport}>
										{t('databases.import.run')}
									</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>
						<Button type="button" size="sm" tone="outline" onClick={() => runExport('csv')}>
							{t('databases.export.csv')}
						</Button>
						<Button type="button" size="sm" tone="outline" onClick={() => runExport('json')}>
							{t('databases.export.json')}
						</Button>
						{!readOnly ? (
							<Button type="button" size="sm" onClick={addRow}>
								<Plus className="size-3.5" aria-hidden />
								{t('databases.row.add')}
							</Button>
						) : null}
					</div>
				</header>

				<div className="flex flex-wrap items-center gap-1.5">
					{views.map((view) => (
						<Button
							key={view.id}
							type="button"
							size="sm"
							tone={view.id === activeView?.id ? 'secondary' : 'ghost'}
							className="h-7 gap-1 text-xs"
							onClick={() => setSelectedViewId(view.id)}
						>
							{VIEW_ICONS[view.viewType]}
							{view.name}
						</Button>
					))}
					{!readOnly ? (
						<Dialog open={addViewOpen} onOpenChange={setAddViewOpen}>
							<DialogTrigger asChild>
								<Button type="button" size="sm" tone="ghost" className="h-7 text-xs">
									<Plus className="size-3" aria-hidden />
									{t('databases.view.add')}
								</Button>
							</DialogTrigger>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>{t('databases.view.add-title')}</DialogTitle>
								</DialogHeader>
								<Input
									aria-label={t('databases.view.name')}
									value={newViewName}
									onChange={(event) => setNewViewName(event.target.value)}
								/>
								<Select
									value={newViewType}
									onValueChange={(value) => setNewViewType(value as (typeof VIEW_TYPES)[number])}
								>
									<SelectTrigger aria-label={t('databases.view.type')}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{VIEW_TYPES.map((type) => (
											<SelectItem key={type} value={type}>
												{t(`databases.view.${type}`)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<DialogFooter>
									<Button type="button" onClick={createView}>
										{t('databases.view.create')}
									</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>
					) : null}
					{!readOnly ? (
						<Dialog open={addPropertyOpen} onOpenChange={setAddPropertyOpen}>
							<DialogTrigger asChild>
								<Button type="button" size="sm" tone="ghost" className="h-7 text-xs">
									<Plus className="size-3" aria-hidden />
									{t('databases.property.add')}
								</Button>
							</DialogTrigger>
							<DialogContent className="max-w-2xl">
								<DialogHeader>
									<DialogTitle>{t('databases.property.add-title')}</DialogTitle>
								</DialogHeader>
								<Input
									aria-label={t('databases.property.name')}
									value={propertyName}
									onChange={(event) => setPropertyName(event.target.value)}
								/>
								<Select
									value={propertyType}
									onValueChange={(value) => setPropertyType(value as (typeof PROPERTY_TYPES)[number])}
								>
									<SelectTrigger aria-label={t('databases.property.type')}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{PROPERTY_TYPES.map((type) => (
											<SelectItem key={type} value={type}>
												{t(`databases.property-type.${type}`)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<PropertyConfigForm
									propType={propertyType}
									config={propertyConfig}
									properties={properties}
									allProperties={allProperties}
									sampleRow={rows[0]}
									databases={databases}
									onChange={setPropertyConfig}
								/>
								<DialogFooter>
									<Button
										type="button"
										disabled={
											!propertyName.trim() ||
											(propertyType === 'formula' && typeof propertyConfig['formulaSource'] !== 'string')
										}
										onClick={createProperty}
									>
										{t('databases.property.create')}
									</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>
					) : null}
					{activeView ? (
						<Dialog open={viewConfigOpen} onOpenChange={setViewConfigOpen}>
							<DialogTrigger asChild>
								<Button
									type="button"
									size="sm"
									tone="ghost"
									className="h-7 text-xs"
									aria-label={t('databases.config.view-settings')}
								>
									<Settings2 className="size-3" aria-hidden />
								</Button>
							</DialogTrigger>
							<DialogContent className="max-w-2xl">
								<DialogHeader>
									<DialogTitle>{t('databases.config.view-settings')}</DialogTitle>
								</DialogHeader>
								<ViewConfigForm
									key={activeView.id}
									view={activeView}
									properties={properties}
									onSave={async (config) => {
										await engine.updateDocDatabaseView(databaseId, activeView.id, { config })
										setViewConfigOpen(false)
									}}
								/>
							</DialogContent>
						</Dialog>
					) : null}
				</div>

				<DatabaseViewRenderer
					databaseId={databaseId}
					viewType={activeView?.viewType ?? 'table'}
					rows={visibleRows}
					properties={visibleProperties}
					readOnly={readOnly}
					compact={compact}
					config={viewConfig}
					onConfigChange={
						activeView
							? (patch) => {
									void engine.updateDocDatabaseView(databaseId, activeView.id, {
										config: { ...viewConfig, ...patch }
									})
								}
							: undefined
					}
					propertyActions={
						readOnly
							? undefined
							: (property) => (
									<PropertyEditorDialog
										property={property}
										properties={properties}
										sampleRow={rows[0]}
										databases={databases}
										onSave={async (patch) => {
											await engine.updateDocDatabaseProperty(databaseId, property.id, patch)
										}}
									/>
								)
					}
					onCellCommit={commitCell}
					onOpenRow={(row) => void openRow(row.id)}
				/>
			</section>
		</DatabaseWorkspaceContextProvider>
	)
}
