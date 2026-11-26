import type { DocPageDto, TeamspaceDto } from '@huriro/contracts'

/** Where a dragged page lands relative to the row it is dropped on. */
export type DocsDropZone = 'before' | 'inside' | 'after'

interface Positioned {
	readonly position: string
	readonly id: string
}

/** Fractional-index ordering with a stable id tie-break (shared by pages & teamspaces). */
export function compareByPosition(a: Positioned, b: Positioned): number {
	return a.position < b.position ? -1 : a.position > b.position ? 1 : a.id.localeCompare(b.id)
}

export function sortTeamspaces(list: readonly TeamspaceDto[]): TeamspaceDto[] {
	return [...list].sort(compareByPosition)
}

/** Groups live (non-archived, non-template) pages by parent, each bucket position-sorted. */
export function buildChildrenIndex(pages: readonly DocPageDto[]): Map<string | null, DocPageDto[]> {
	const map = new Map<string | null, DocPageDto[]>()
	for (const page of pages) {
		const bucket = map.get(page.parentId) ?? []
		bucket.push(page)
		map.set(page.parentId, bucket)
	}
	for (const bucket of map.values()) bucket.sort(compareByPosition)
	return map
}

/** True when `candidate` is `page` itself or lives anywhere beneath it (materialised-path check). */
export function isSelfOrDescendant(page: DocPageDto, candidate: DocPageDto): boolean {
	return candidate.id === page.id || candidate.path.startsWith(`${page.path}/`)
}

/** Ids of every ancestor of `page`, nearest first. Cycle-safe and depth-capped. */
export function collectAncestorIds(page: DocPageDto, byId: ReadonlyMap<string, DocPageDto>): string[] {
	const ids: string[] = []
	const seen = new Set<string>([page.id])
	let cursor = page.parentId
	while (cursor && !seen.has(cursor) && ids.length < 32) {
		const parent = byId.get(cursor)
		if (!parent) break
		ids.push(parent.id)
		seen.add(parent.id)
		cursor = parent.parentId
	}
	return ids
}

/** "Parent / Grandparent" trail shown beside search results so identical titles stay distinguishable. */
export function buildBreadcrumb(page: DocPageDto, byId: ReadonlyMap<string, DocPageDto>): string {
	return collectAncestorIds(page, byId)
		.reverse()
		.map((id) => byId.get(id)?.title ?? '')
		.filter(Boolean)
		.join(' / ')
}

/** Case/diacritic-insensitive title filter, best matches (prefix) first. */
export function filterPagesByQuery(pages: readonly DocPageDto[], query: string): DocPageDto[] {
	const needle = normalize(query)
	if (!needle) return []
	const hits = pages.filter((page) => normalize(page.title).includes(needle))
	return hits.sort((a, b) => {
		const aPrefix = normalize(a.title).startsWith(needle) ? 0 : 1
		const bPrefix = normalize(b.title).startsWith(needle) ? 0 : 1
		return aPrefix - bPrefix || a.title.localeCompare(b.title)
	})
}

function normalize(value: string): string {
	return value
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.trim()
}

/**
 * Collision-proof slug for pages created without a user-typed title
 * ("Untitled", duplicates): optimistic slugs must be unique locally because the
 * router resolves pages by slug before the server has a chance to de-dupe.
 */
export function buildUniqueSlug(title: string, id: string): string {
	const base = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60)
		.replace(/-+$/g, '')
	const suffix = id.replace(/-/g, '').slice(-6)
	return base ? `${base}-${suffix}` : `doc-${suffix}`
}

/**
 * Decides whether a drop is legal. Rules: never onto itself/its subtree, never a
 * no-op "inside" onto the current parent, and sibling-style drops at the root
 * must stay within the same teamspace (moves don't rewrite `teamspaceId`).
 */
export function canDropPage(drag: DocPageDto, target: DocPageDto, zone: DocsDropZone): boolean {
	if (isSelfOrDescendant(drag, target)) return false
	if (zone === 'inside') return drag.parentId !== target.id
	if (target.parentId === null) return (drag.teamspaceId ?? null) === (target.teamspaceId ?? null)
	return true
}

/** Maps a pointer's vertical position inside a row to a drop zone (top/bottom quarter = reorder). */
export function resolveDropZone(offsetY: number, height: number): DocsDropZone {
	if (height <= 0) return 'inside'
	const ratio = offsetY / height
	if (ratio < 0.28) return 'before'
	if (ratio > 0.72) return 'after'
	return 'inside'
}

export interface FlattenedDocOption {
	readonly page: DocPageDto
	readonly depth: number
}

/**
 * Depth-first flattening of the page tree for parent-selector dropdowns,
 * omitting `excludePage` and its entire subtree.
 */
export function flattenTreeForSelect(
	pages: readonly DocPageDto[],
	excludePage: DocPageDto
): FlattenedDocOption[] {
	const childrenByParent = buildChildrenIndex(pages)
	const out: FlattenedDocOption[] = []
	const visited = new Set<string>()

	function visit(parentId: string | null, depth: number) {
		if (depth >= 32) return
		for (const node of childrenByParent.get(parentId) ?? []) {
			if (visited.has(node.id) || isSelfOrDescendant(excludePage, node)) continue
			visited.add(node.id)
			out.push({ page: node, depth })
			visit(node.id, depth + 1)
		}
	}

	visit(null, 0)
	return out
}

/** Every non-null parent id that currently has at least one child page. */
export function collectExpandableIds(
	childrenByParent: ReadonlyMap<string | null, readonly DocPageDto[]>
): string[] {
	const ids: string[] = []
	for (const [parentId, kids] of childrenByParent) {
		if (parentId !== null && kids.length > 0) ids.push(parentId)
	}
	return ids
}
