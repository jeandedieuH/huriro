import { LinkedViewBlockExtension } from '@huriro/editor'
import { t } from '@huriro/i18n'
import { useCollectionItems } from '@huriro/sync-client'
import { type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { Database, Plus } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkspace } from '@/lib/workspace'
import { IssueSavedViewEmbed } from './issue-saved-view'

const LazyDatabaseWorkspace = lazy(() =>
	import('@/features/databases/components/database-workspace').then((module) => ({
		default: module.DatabaseWorkspace
	}))
)

export interface LinkedViewNodeViewOptions {
	readonly pageId?: string | undefined
}

function DatabasePicker(props: NodeViewProps) {
	const { engine } = useWorkspace()
	const databases = useCollectionItems(engine.collections.docDatabases)
	const savedViews = useCollectionItems(engine.collections.savedViews)
	const [busy, setBusy] = useState(false)
	const [sourceKind, setSourceKind] = useState<'database' | 'issue_saved_view'>('database')
	const pageId = (props.extension.options as LinkedViewNodeViewOptions).pageId
	const chooseDatabase = (sourceId: string) => {
		if (!sourceId) return
		props.updateAttributes({ sourceType: 'database', sourceId, viewId: '' })
	}
	const chooseIssueView = (sourceId: string) => {
		if (!sourceId) return
		props.updateAttributes({ sourceType: 'issue_saved_view', sourceId, viewId: '' })
	}
	const createDatabase = () => {
		setBusy(true)
		void engine
			.createDocDatabase({
				title: t('databases.new-title'),
				isInline: true,
				...(pageId ? { parentPageId: pageId } : {})
			})
			.then((detail) => {
				props.updateAttributes({
					sourceType: 'database',
					sourceId: detail.database.id,
					viewId: detail.views[0]?.id ?? ''
				})
			})
			.finally(() => setBusy(false))
	}
	return (
		<div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 border-dashed p-3">
			<Database className="size-4 text-muted-foreground" aria-hidden />
			<Select
				value={sourceKind}
				onValueChange={(value) =>
					setSourceKind(value === 'issue_saved_view' ? 'issue_saved_view' : 'database')
				}
			>
				<SelectTrigger aria-label={t('databases.linked.source-type')} className="h-8 w-40">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="database">{t('databases.linked.database')}</SelectItem>
					<SelectItem value="issue_saved_view">{t('databases.linked.issue-saved-view')}</SelectItem>
				</SelectContent>
			</Select>
			{sourceKind === 'database' ? (
				<>
					<span className="text-muted-foreground text-sm">{t('databases.linked.choose')}</span>
					<Select onValueChange={chooseDatabase}>
						<SelectTrigger aria-label={t('databases.linked.select')} className="h-8 w-56">
							<SelectValue placeholder={t('databases.linked.select-placeholder')} />
						</SelectTrigger>
						<SelectContent>
							{databases.map((database) => (
								<SelectItem key={database.id} value={database.id}>
									{database.title}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{props.editor.isEditable ? (
						<Button type="button" size="sm" tone="outline" disabled={busy} onClick={createDatabase}>
							<Plus className="size-3.5" aria-hidden />
							{t('databases.linked.create')}
						</Button>
					) : null}
				</>
			) : (
				<>
					<span className="text-muted-foreground text-sm">{t('databases.linked.choose-issue-view')}</span>
					<Select onValueChange={chooseIssueView}>
						<SelectTrigger aria-label={t('databases.linked.issue-saved-view')} className="h-8 w-56">
							<SelectValue placeholder={t('databases.linked.issue-view-placeholder')} />
						</SelectTrigger>
						<SelectContent>
							{savedViews.map((view) => (
								<SelectItem key={view.id} value={view.id}>
									{view.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</>
			)}
		</div>
	)
}

function LinkedViewNodeView(props: NodeViewProps) {
	const sourceType = String(props.node.attrs['sourceType'] ?? 'database')
	const sourceId = String(props.node.attrs['sourceId'] ?? '')
	const viewId = String(props.node.attrs['viewId'] ?? '') || undefined
	return (
		<NodeViewWrapper data-linked-view="true" contentEditable={false} className="my-4">
			{sourceType === 'database' && sourceId ? (
				<Suspense fallback={<Skeleton className="h-56 w-full" />}>
					<LazyDatabaseWorkspace
						databaseId={sourceId}
						viewId={viewId}
						compact
						readOnly={!props.editor.isEditable}
					/>
				</Suspense>
			) : sourceType === 'issue_saved_view' && sourceId ? (
				<IssueSavedViewEmbed savedViewId={sourceId} compact />
			) : sourceType === 'database' || sourceType === 'issue_saved_view' ? (
				<DatabasePicker {...props} />
			) : (
				<div className="rounded-lg border border-border/70 border-dashed p-4 text-muted-foreground text-sm">
					{t('databases.linked.unsupported')}
				</div>
			)}
		</NodeViewWrapper>
	)
}

export function createLinkedViewNodeViewExtension(options: LinkedViewNodeViewOptions = {}) {
	return LinkedViewBlockExtension.extend({
		addOptions() {
			return options
		},
		addNodeView() {
			return ReactNodeViewRenderer(LinkedViewNodeView)
		}
	})
}
