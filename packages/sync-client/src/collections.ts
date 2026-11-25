/**
 * TanStack DB reactive collections backed by Huriro's change feed (§9.5).
 */
import type {
	CycleDto,
	DocPageDto,
	IssueDto,
	LabelDto,
	NotificationDto,
	ProjectDto,
	ProjectStatusDto,
	SavedViewDto,
	SyncChangeDto,
	SyncSnapshotResponse
} from '@huriro/contracts'
import { type Collection, createCollection } from '@tanstack/db'

interface SyncDriver<T extends { readonly id: string }> {
	begin: (options?: { snapshot?: boolean }) => void
	write: (msg: { type: 'insert' | 'update'; value: T } | { type: 'delete'; key: string }) => void
	commit: () => unknown
	markReady: () => void
	truncate: (options?: { markReady?: boolean }) => void
}

interface ManagedCollection<T extends { readonly id: string }> {
	readonly collection: Collection<T, string>
	replaceAll(items: readonly T[]): void
	upsertMany(items: readonly T[]): void
	deleteMany(keys: readonly string[]): void
	markReady(): void
	values(): T[]
}

interface ManagedCollectionOptions<T> {
	/**
	 * Write guard consulted before overwriting an EXISTING row. Return false to
	 * skip the write — used by the issues collection for version-guarded upserts
	 * so stale tier-2 hydration pages can never clobber newer rows that arrived
	 * through the change feed (§8.1, ADR-0031).
	 */
	readonly guardWrite?: ((incoming: T, existing: T) => boolean) | undefined
}

function makeManagedCollection<T extends { readonly id: string }>(
	id: string,
	opts?: ManagedCollectionOptions<T>
): ManagedCollection<T> {
	let driver: SyncDriver<T> | null = null

	const collection = createCollection<T, string>({
		id,
		getKey: (item) => item.id,
		startSync: true,
		sync: {
			rowUpdateMode: 'full',
			sync: (ctx) => {
				driver = {
					begin: (opts) => ctx.begin(opts),
					write: (msg) => ctx.write(msg as Parameters<typeof ctx.write>[0]),
					commit: () => ctx.commit(),
					markReady: () => ctx.markReady(),
					truncate: (opts) => ctx.truncate(opts)
				}
			}
		}
	})

	// Ensure sync adapter initialized even if startSync deferred.
	if (!driver) {
		void collection.preload().catch(() => {})
	}

	function ensureDriver(): SyncDriver<T> {
		if (!driver) {
			throw new Error(`Sync driver for collection "${id}" is not initialized`)
		}
		return driver
	}

	return {
		collection,
		replaceAll(items) {
			const d = ensureDriver()
			d.begin({ snapshot: true })
			for (const item of items) {
				d.write({ type: 'insert', value: item })
			}
			d.commit()
			d.markReady()
		},
		upsertMany(items) {
			if (items.length === 0) return
			const d = ensureDriver()
			d.begin()
			for (const item of items) {
				const existing = collection.get(item.id)
				if (existing !== undefined && opts?.guardWrite && !opts.guardWrite(item, existing)) {
					continue
				}
				d.write({ type: existing !== undefined ? 'update' : 'insert', value: item })
			}
			d.commit()
			d.markReady()
		},
		deleteMany(keys) {
			const existing = keys.filter((k) => collection.has(k))
			if (existing.length === 0) return
			const d = ensureDriver()
			d.begin()
			for (const k of existing) {
				d.write({ type: 'delete', key: k })
			}
			d.commit()
			d.markReady()
		},
		markReady() {
			ensureDriver().markReady()
		},
		values() {
			return [...collection.values()]
		}
	}
}

export const REPLICA_SCHEMA_VERSION = 1

/** Tier-2 retention window — must mirror the server's 30d core-snapshot cutoff (§8.1). */
export const TIER2_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/**
 * True when an issue belongs to the lazy tier-2 history tier: closed over 30
 * days ago or deleted over 30 days ago. Reopened/undone rows (closedAt/deletedAt
 * cleared, or recent) are tier-1 shaped and survive scope purges — this check is
 * the exact mirror of the server's `listCoreSnapshotIssues` exclusion filter.
 */
export function isTier2Issue(issue: Pick<IssueDto, 'closedAt' | 'deletedAt'>, nowMs: number): boolean {
	const cutoff = nowMs - TIER2_RETENTION_MS
	if (issue.closedAt !== null && Date.parse(issue.closedAt) < cutoff) return true
	if (issue.deletedAt !== null && Date.parse(issue.deletedAt) < cutoff) return true
	return false
}

export interface PersistedReplicaState {
	/** Versioned so older replicas can render locally without trusted-cursor drift. */
	readonly schemaVersion?: number | undefined
	readonly cursor: number
	readonly projects: ProjectDto[]
	readonly projectStatuses: ProjectStatusDto[]
	readonly labels: LabelDto[]
	readonly cycles: CycleDto[]
	readonly issues: IssueDto[]
	readonly savedViews: SavedViewDto[]
	readonly notifications: NotificationDto[]
	readonly docPages?: DocPageDto[] | undefined
}

export class HuriroSyncCollections {
	readonly projectsManaged = makeManagedCollection<ProjectDto>('projects')
	readonly statusesManaged = makeManagedCollection<ProjectStatusDto>('project_statuses')
	readonly labelsManaged = makeManagedCollection<LabelDto>('labels')
	readonly cyclesManaged = makeManagedCollection<CycleDto>('cycles')
	// Version-guarded upserts (§8.1): `version` is server-authoritative and
	// monotonic per issue, so a write carrying a strictly older version is always
	// stale — critically, tier-2 history hydration pages must never clobber newer
	// rows that arrived through the change feed mid-pagination. Equal versions
	// pass so idempotent rewrites and same-version optimistic writes still apply.
	readonly issuesManaged = makeManagedCollection<IssueDto>('issues', {
		guardWrite: (incoming, existing) => incoming.version >= existing.version
	})
	readonly viewsManaged = makeManagedCollection<SavedViewDto>('saved_views')
	readonly notificationsManaged = makeManagedCollection<NotificationDto>('notifications')
	readonly docPagesManaged = makeManagedCollection<DocPageDto>('doc_pages')

	get projects(): Collection<ProjectDto, string> {
		return this.projectsManaged.collection
	}
	get projectStatuses(): Collection<ProjectStatusDto, string> {
		return this.statusesManaged.collection
	}
	get labels(): Collection<LabelDto, string> {
		return this.labelsManaged.collection
	}
	get cycles(): Collection<CycleDto, string> {
		return this.cyclesManaged.collection
	}
	get issues(): Collection<IssueDto, string> {
		return this.issuesManaged.collection
	}
	get savedViews(): Collection<SavedViewDto, string> {
		return this.viewsManaged.collection
	}
	get notifications(): Collection<NotificationDto, string> {
		return this.notificationsManaged.collection
	}
	get docPages(): Collection<DocPageDto, string> {
		return this.docPagesManaged.collection
	}

	markAllReady(): void {
		this.projectsManaged.markReady()
		this.statusesManaged.markReady()
		this.labelsManaged.markReady()
		this.cyclesManaged.markReady()
		this.issuesManaged.markReady()
		this.viewsManaged.markReady()
		this.notificationsManaged.markReady()
		this.docPagesManaged.markReady()
	}

	applyFullSnapshot(snap: SyncSnapshotResponse | PersistedReplicaState): void {
		this.projectsManaged.replaceAll(snap.projects as unknown as ProjectDto[])
		this.statusesManaged.replaceAll(snap.projectStatuses as unknown as ProjectStatusDto[])
		this.labelsManaged.replaceAll(snap.labels as unknown as LabelDto[])
		this.cyclesManaged.replaceAll(snap.cycles as unknown as CycleDto[])
		// Tier-aware issues handling (§8.1, ADR-0031): the server's tier-1 core
		// snapshot legitimately OMITS closed/deleted-over-30d issues, so a plain
		// replace would silently wipe every hydrated tier-2 history row. Preserve
		// local rows that are still tier-2 shaped and absent from the snapshot;
		// rows present in the snapshot (e.g. reopened since hydration) take the
		// authoritative server copy. Tier-1 rows missing from the snapshot are
		// dropped as before — they were deleted or revoked.
		const snapIssues = snap.issues as unknown as IssueDto[]
		const snapIssueIds = new Set(snapIssues.map((i) => i.id))
		const nowMs = Date.now()
		const preservedTier2 = this.issuesManaged
			.values()
			.filter((i) => !snapIssueIds.has(i.id) && isTier2Issue(i, nowMs))
		this.issuesManaged.replaceAll([...snapIssues, ...preservedTier2])
		this.viewsManaged.replaceAll(snap.savedViews as unknown as SavedViewDto[])
		this.notificationsManaged.replaceAll(snap.notifications as unknown as NotificationDto[])
		this.docPagesManaged.replaceAll((snap.docPages ?? []) as unknown as DocPageDto[])
	}

	applyScopedSnapshot(snap: SyncSnapshotResponse): void {
		this.projectsManaged.upsertMany(snap.projects as unknown as ProjectDto[])
		this.statusesManaged.upsertMany(snap.projectStatuses as unknown as ProjectStatusDto[])
		this.labelsManaged.upsertMany(snap.labels as unknown as LabelDto[])
		this.cyclesManaged.upsertMany(snap.cycles as unknown as CycleDto[])
		this.issuesManaged.upsertMany(snap.issues as unknown as IssueDto[])
		this.viewsManaged.upsertMany(snap.savedViews as unknown as SavedViewDto[])
		this.docPagesManaged.upsertMany((snap.docPages ?? []) as unknown as DocPageDto[])
	}

	purgeDocPageScope(pageId: string): void {
		const target = this.docPagesManaged.values().find((p) => p.id === pageId)
		const keys = this.docPagesManaged
			.values()
			.filter(
				(p) =>
					p.id === pageId || p.parentId === pageId || (target ? p.path.startsWith(`${target.path}/`) : false)
			)
			.map((p) => p.id)
		this.docPagesManaged.deleteMany(keys.length > 0 ? keys : [pageId])
	}

	purgeProjectScope(projectId: string): void {
		this.projectsManaged.deleteMany([projectId])
		const statusKeys = this.statusesManaged
			.values()
			.filter((s) => s.projectId === projectId)
			.map((s) => s.id)
		this.statusesManaged.deleteMany(statusKeys)

		const cycleKeys = this.cyclesManaged
			.values()
			.filter((c) => c.projectId === projectId)
			.map((c) => c.id)
		this.cyclesManaged.deleteMany(cycleKeys)

		const issueKeys = this.issuesManaged
			.values()
			.filter((i) => i.projectId === projectId)
			.map((i) => i.id)
		this.issuesManaged.deleteMany(issueKeys)

		const viewKeys = this.viewsManaged
			.values()
			.filter((v) => v.projectId === projectId)
			.map((v) => v.id)
		this.viewsManaged.deleteMany(viewKeys)
	}

	applyChanges(changes: readonly SyncChangeDto[]): {
		readonly grantScopes: string[]
		readonly revokedProjectIds: string[]
		readonly revokedDocPageIds: string[]
	} {
		const grantScopes = new Set<string>()
		const revokedProjectIds = new Set<string>()
		const revokedDocPageIds = new Set<string>()

		const projectUpserts: ProjectDto[] = []
		const projectDeletes: string[] = []
		const statusUpserts: ProjectStatusDto[] = []
		const statusDeletes: string[] = []
		const labelUpserts: LabelDto[] = []
		const labelDeletes: string[] = []
		const cycleUpserts: CycleDto[] = []
		const cycleDeletes: string[] = []
		const issueUpserts: IssueDto[] = []
		const issueDeletes: string[] = []
		const viewUpserts: SavedViewDto[] = []
		const viewDeletes: string[] = []
		const notifUpserts: NotificationDto[] = []
		const notifDeletes: string[] = []
		const docPageUpserts: DocPageDto[] = []
		const docPageDeletes: string[] = []

		for (const c of changes) {
			if (c.action === 'grant') {
				for (const s of c.scope) {
					if (s.startsWith('project:') || s.startsWith('doc_page:')) grantScopes.add(s)
				}
				continue
			}
			if (c.action === 'revoke') {
				for (const s of c.scope) {
					if (s.startsWith('project:')) revokedProjectIds.add(s.slice('project:'.length))
					if (s.startsWith('doc_page:')) revokedDocPageIds.add(s.slice('doc_page:'.length))
				}
				if (c.entity === 'project') revokedProjectIds.add(c.id)
				if (c.entity === 'doc_page') revokedDocPageIds.add(c.id)
				continue
			}

			const isDel = c.action === 'delete' || c.data === null
			switch (c.entity) {
				case 'project':
					if (isDel) projectDeletes.push(c.id)
					else projectUpserts.push(c.data as unknown as ProjectDto)
					break
				case 'project_status':
					if (isDel) statusDeletes.push(c.id)
					else statusUpserts.push(c.data as unknown as ProjectStatusDto)
					break
				case 'label':
					if (isDel) labelDeletes.push(c.id)
					else labelUpserts.push(c.data as unknown as LabelDto)
					break
				case 'cycle':
					if (isDel) cycleDeletes.push(c.id)
					else cycleUpserts.push(c.data as unknown as CycleDto)
					break
				case 'issue':
					if (isDel) issueDeletes.push(c.id)
					else issueUpserts.push(c.data as unknown as IssueDto)
					break
				case 'saved_view':
					if (isDel) viewDeletes.push(c.id)
					else viewUpserts.push(c.data as unknown as SavedViewDto)
					break
				case 'notification':
					if (isDel) notifDeletes.push(c.id)
					else notifUpserts.push(c.data as unknown as NotificationDto)
					break
				case 'doc_page':
					if (isDel) docPageDeletes.push(c.id)
					else docPageUpserts.push(c.data as unknown as DocPageDto)
					break
				default:
					break
			}
		}

		this.projectsManaged.upsertMany(projectUpserts)
		this.projectsManaged.deleteMany(projectDeletes)
		this.statusesManaged.upsertMany(statusUpserts)
		this.statusesManaged.deleteMany(statusDeletes)
		this.labelsManaged.upsertMany(labelUpserts)
		this.labelsManaged.deleteMany(labelDeletes)
		this.cyclesManaged.upsertMany(cycleUpserts)
		this.cyclesManaged.deleteMany(cycleDeletes)
		this.issuesManaged.upsertMany(issueUpserts)
		this.issuesManaged.deleteMany(issueDeletes)
		this.viewsManaged.upsertMany(viewUpserts)
		this.viewsManaged.deleteMany(viewDeletes)
		this.notificationsManaged.upsertMany(notifUpserts)
		this.notificationsManaged.deleteMany(notifDeletes)
		this.docPagesManaged.upsertMany(docPageUpserts)
		this.docPagesManaged.deleteMany(docPageDeletes)

		for (const pid of revokedProjectIds) {
			this.purgeProjectScope(pid)
		}
		for (const pageId of revokedDocPageIds) {
			this.purgeDocPageScope(pageId)
		}

		return {
			grantScopes: [...grantScopes],
			revokedProjectIds: [...revokedProjectIds],
			revokedDocPageIds: [...revokedDocPageIds]
		}
	}

	exportState(cursor: number): PersistedReplicaState {
		return {
			schemaVersion: REPLICA_SCHEMA_VERSION,
			cursor,
			projects: this.projectsManaged.values(),
			projectStatuses: this.statusesManaged.values(),
			labels: this.labelsManaged.values(),
			cycles: this.cyclesManaged.values(),
			issues: this.issuesManaged.values(),
			savedViews: this.viewsManaged.values(),
			notifications: this.notificationsManaged.values(),
			docPages: this.docPagesManaged.values()
		}
	}

	/**
	 * Hard wipe for sign-out/revoke — must NOT go through the tier-aware
	 * `applyFullSnapshot` (which preserves tier-2 rows): every row is tenant
	 * data and leaving any behind would leak across sessions (§16).
	 */
	clearAll(): void {
		this.projectsManaged.replaceAll([])
		this.statusesManaged.replaceAll([])
		this.labelsManaged.replaceAll([])
		this.cyclesManaged.replaceAll([])
		this.issuesManaged.replaceAll([])
		this.viewsManaged.replaceAll([])
		this.notificationsManaged.replaceAll([])
		this.docPagesManaged.replaceAll([])
	}
}
