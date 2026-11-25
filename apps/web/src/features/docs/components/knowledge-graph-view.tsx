import type { KnowledgeGraphResponse } from '@huriro/contracts'
import { t } from '@huriro/i18n'
import { useCollectionItems, useSyncEngine } from '@huriro/sync-client'
import { FileText, Folder, Network } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { TaskApiBridge } from '@/lib/sync-bootstrap'
import { useUiStore } from '@/stores/ui-store'

export interface KnowledgeGraphViewProps {
	readonly api: TaskApiBridge
	readonly onSelectSlug: (slug: string) => void
}

interface PlacedNode {
	readonly id: string
	readonly x: number
	readonly y: number
	readonly label: string
	readonly kind: KnowledgeGraphResponse['nodes'][number]['kind']
	readonly slug: string | null | undefined
}

function layoutGraphNodes(graph: KnowledgeGraphResponse): PlacedNode[] {
	const count = graph.nodes.length
	if (count === 0) return []
	const cx = 320
	const cy = 200
	const radiusX = count <= 4 ? 140 : 230
	const radiusY = count <= 4 ? 95 : 140
	return graph.nodes.map((node, i) => {
		if (count === 1) {
			return { id: node.id, x: cx, y: cy, label: node.label, kind: node.kind, slug: node.slug }
		}
		const angle = (2 * Math.PI * i) / count - Math.PI / 2
		return {
			id: node.id,
			x: Math.round(cx + Math.cos(angle) * radiusX),
			y: Math.round(cy + Math.sin(angle) * radiusY),
			label: node.label,
			kind: node.kind,
			slug: node.slug
		}
	})
}

export function KnowledgeGraphView({ api, onSelectSlug }: KnowledgeGraphViewProps) {
	const engine = useSyncEngine()
	const teamspaces = useCollectionItems(engine.collections.teamspaces)
	const open = useUiStore((s) => s.docsGraphOpen)
	const setOpen = useUiStore((s) => s.setDocsGraphOpen)

	const [teamspaceFilter, setTeamspaceFilter] = useState<string>('all')
	const [graph, setGraph] = useState<KnowledgeGraphResponse>({ nodes: [], edges: [] })

	useEffect(() => {
		if (!open) return
		let cancelled = false
		void api
			.getKnowledgeGraph(teamspaceFilter === 'all' ? undefined : teamspaceFilter)
			.then((data) => {
				if (!cancelled) setGraph(data)
			})
			.catch(() => {
				if (!cancelled) setGraph({ nodes: [], edges: [] })
			})
		return () => {
			cancelled = true
		}
	}, [api, open, teamspaceFilter])

	const placed = useMemo(() => layoutGraphNodes(graph), [graph])
	const placedById = useMemo(() => new Map(placed.map((n) => [n.id, n])), [placed])
	const activeTeamspaces = teamspaces.filter((ts) => ts.archivedAt === null)

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="max-w-4xl">
				<DialogHeader>
					<div className="flex flex-wrap items-center justify-between gap-2 pr-6">
						<DialogTitle className="flex items-center gap-2">
							<Network className="size-4" aria-hidden />
							<span>{t('docs.graph.title')}</span>
						</DialogTitle>
						<Select value={teamspaceFilter} onValueChange={setTeamspaceFilter}>
							<SelectTrigger aria-label={t('docs.graph.filter-teamspace')} className="h-8 w-52 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">{t('docs.graph.all-teamspaces')}</SelectItem>
								{activeTeamspaces.map((ts) => (
									<SelectItem key={ts.id} value={ts.id}>
										{ts.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</DialogHeader>

				{graph.nodes.length === 0 ? (
					<p className="py-12 text-center text-sm text-muted-foreground">{t('docs.graph.empty')}</p>
				) : (
					<div className="grid gap-4 md:grid-cols-3">
						<div className="md:col-span-2 overflow-hidden rounded-lg border border-border bg-card">
							<svg
								viewBox="0 0 640 400"
								role="img"
								aria-label={t('docs.graph.title')}
								className="h-80 w-full"
							>
								{graph.edges.map((edge) => {
									const src = placedById.get(edge.sourceId)
									const dst = placedById.get(edge.targetId)
									if (!src || !dst) return null
									return (
										<line
											key={edge.id}
											x1={src.x}
											y1={src.y}
											x2={dst.x}
											y2={dst.y}
											stroke="var(--border)"
											strokeWidth={1.5}
										/>
									)
								})}
								{placed.map((node) => {
									const stroke =
										node.kind === 'teamspace'
											? 'var(--primary)'
											: node.kind === 'issue'
												? 'var(--info)'
												: 'var(--success)'
									return (
										<g key={node.id} transform={`translate(${node.x},${node.y})`}>
											<circle
												r={node.kind === 'teamspace' ? 18 : 14}
												fill="var(--card)"
												stroke={stroke}
												strokeWidth={2}
											/>
											<text y={28} textAnchor="middle" fontSize="11" fill="var(--foreground)">
												{node.label.length > 20 ? `${node.label.slice(0, 19)}…` : node.label}
											</text>
										</g>
									)
								})}
							</svg>
						</div>

						<div className="space-y-2">
							<p className="text-xs font-semibold">
								{t('docs.graph.nodes-list', { count: graph.nodes.length })}
							</p>
							<ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
								{graph.nodes.map((node) => (
									<li key={node.id}>
										<button
											type="button"
											disabled={!node.slug || node.kind !== 'doc_page'}
											onClick={() => {
												if (node.kind === 'doc_page' && node.slug) {
													onSelectSlug(node.slug)
													setOpen(false)
												}
											}}
											className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-left text-xs hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent"
										>
											<span className="flex min-w-0 items-center gap-1.5">
												{node.kind === 'teamspace' ? (
													<Folder className="size-3.5 shrink-0 text-primary" aria-hidden />
												) : (
													<FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
												)}
												<span className="truncate font-medium">{node.label}</span>
											</span>
											<Badge tone="outline">{node.kind}</Badge>
										</button>
									</li>
								))}
							</ul>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	)
}
