/**
 * Durable offline outbox & 3-way conflict handling (§9.5, §9.6).
 *
 * Uses `@tanstack/offline-transactions` retry policy + non-retriable markers
 * and persists queued mutations in `ReplicaStorage` (OPFS/IDB/Memory) with a
 * hard 5,000-mutation / 25 MB cap so offline writes survive tab closes and
 * replay exactly once via `Idempotency-Key`.
 */
import type {
	MutationEntity,
	MutationEnvelope,
	MutationOp,
	MutationResultDto,
	MutationsBatchResponse
} from '@huriro/contracts'
import { resolveFieldMerge } from '@huriro/domain'
import { DefaultRetryPolicy, NonRetriableError } from '@tanstack/offline-transactions'
import type { ReplicaStorage } from './storage'

export const MAX_OUTBOX_MUTATIONS = 5_000
export const MAX_OUTBOX_BYTES = 25 * 1024 * 1024
const OUTBOX_STORAGE_KEY = 'huriro:outbox:v1'
const CONFLICTS_STORAGE_KEY = 'huriro:conflicts:v1'

function entityKey(entity: MutationEntity, entityId: string): string {
	return `${entity}:${entityId}`
}

function valuesEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true
	if (typeof a !== typeof b || a === null || b === null) return false
	if (typeof a !== 'object') return false
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
		return a.every((v, i) => valuesEqual(v, b[i]))
	}
	const recA = a as Record<string, unknown>
	const recB = b as Record<string, unknown>
	const keysA = Object.keys(recA)
	const keysB = Object.keys(recB)
	if (keysA.length !== keysB.length) return false
	return keysA.every((k) => Object.hasOwn(recB, k) && valuesEqual(recA[k], recB[k]))
}

/**
 * Collapse two conflicts targeting the same `(entity, entityId)` so repeated
 * stale writes (e.g. a dragged slider) never pile up duplicate resolver rows.
 */
function mergeConflict(existing: SyncConflict, incoming: SyncConflict): SyncConflict | null {
	const localValues = { ...existing.localValues, ...incoming.localValues }
	const baseValues = { ...incoming.baseValues, ...existing.baseValues }
	const overlappingFields: string[] = []
	const seen = new Set<string>()
	for (const field of [...existing.overlappingFields, ...incoming.overlappingFields]) {
		if (seen.has(field)) continue
		seen.add(field)
		if (!valuesEqual(localValues[field], incoming.serverValues[field])) {
			overlappingFields.push(field)
		}
	}
	if (overlappingFields.length === 0) {
		return null
	}
	const overlappingSet = new Set(overlappingFields)
	const nonConflictingPatch: Record<string, unknown> = {}
	for (const [key, val] of Object.entries({
		...existing.nonConflictingPatch,
		...incoming.nonConflictingPatch
	})) {
		if (overlappingSet.has(key)) continue
		if (valuesEqual(val, incoming.serverValues[key])) continue
		nonConflictingPatch[key] = val
	}
	return {
		id: incoming.id,
		mutationId: incoming.mutationId,
		entity: incoming.entity,
		entityId: incoming.entityId,
		title: incoming.title,
		overlappingFields,
		nonConflictingPatch,
		baseValues,
		localValues,
		serverValues: incoming.serverValues,
		serverVersion: incoming.serverVersion
	}
}

function applyConflictUpsert(
	list: readonly SyncConflict[],
	incoming: SyncConflict
): { readonly next: SyncConflict[]; readonly active: SyncConflict | null } {
	const existing = list.find(
		(c) => c.id === incoming.id || (c.entity === incoming.entity && c.entityId === incoming.entityId)
	)
	if (!existing) {
		return { next: [...list, incoming], active: incoming }
	}
	const merged = mergeConflict(existing, incoming)
	const filtered = list.filter(
		(c) => c.id !== incoming.id && !(c.entity === incoming.entity && c.entityId === incoming.entityId)
	)
	return merged ? { next: [...filtered, merged], active: merged } : { next: filtered, active: null }
}

function upsertConflictList(list: readonly SyncConflict[], incoming: SyncConflict): SyncConflict[] {
	return applyConflictUpsert(list, incoming).next
}

function dedupeConflicts(list: readonly SyncConflict[]): SyncConflict[] {
	let acc: SyncConflict[] = []
	for (const conflict of list) {
		acc = upsertConflictList(acc, conflict)
	}
	return acc
}

/**
 * Select a strict-FIFO batch prefix containing at most one version-bumping
 * mutation (`op !== 'create'`) per entity, avoiding self-inflicted 409s inside
 * a single `/api/v1/mutations` batch while preserving entity ordering.
 */
function selectFlushBatch(due: readonly QueuedMutation[], limit: number): QueuedMutation[] {
	const batch: QueuedMutation[] = []
	const versionBumped = new Set<string>()
	for (const item of due) {
		if (batch.length >= limit) break
		const key = entityKey(item.envelope.entity, item.envelope.entityId)
		if (versionBumped.has(key)) break
		batch.push(item)
		if (item.envelope.op !== 'create') {
			versionBumped.add(key)
		}
	}
	return batch
}

export interface QueuedMutation {
	readonly envelope: MutationEnvelope
	readonly base?: Record<string, unknown> | undefined
	readonly retryCount: number
	readonly nextAttemptAt: number
	readonly title?: string | undefined
}

export interface SyncConflict {
	readonly id: string
	readonly mutationId: string
	readonly entity: MutationEntity
	readonly entityId: string
	readonly title: string
	readonly overlappingFields: readonly string[]
	readonly nonConflictingPatch: Record<string, unknown>
	readonly baseValues: Record<string, unknown>
	readonly localValues: Record<string, unknown>
	readonly serverValues: Record<string, unknown>
	readonly serverVersion: number
}

export type OutboxOutcome =
	| { readonly kind: 'applied'; readonly result: MutationResultDto; readonly item: QueuedMutation }
	| { readonly kind: 'conflict'; readonly conflict: SyncConflict }
	| {
			readonly kind: 'rejected'
			readonly item: QueuedMutation
			readonly status: number
			readonly error: string
	  }

export class OutboxQuotaError extends NonRetriableError {
	constructor(message: string) {
		super(message)
		this.name = 'OutboxQuotaError'
	}
}

export interface MutationTransport {
	sendBatch(mutations: readonly MutationEnvelope[]): Promise<MutationsBatchResponse>
}

export interface FlushOptions {
	/** Bypass exponential backoff delays and flush all queued mutations immediately. */
	readonly force?: boolean | undefined
}

export interface FlushResult {
	readonly cursor: number | null
	readonly outcomes: OutboxOutcome[]
	readonly error: string | null
	readonly nextRetryAt: number | null
}

export class HuriroMutationOutbox {
	private readonly storage: ReplicaStorage
	private readonly retryPolicy = new DefaultRetryPolicy()
	private queue: QueuedMutation[] = []
	private conflicts: SyncConflict[] = []
	private activeFlush: Promise<FlushResult> | null = null
	private flushRequested = false
	private forceRequested = false
	private inFlightMutationIds = new Set<string>()
	private persistQueueChain: Promise<void> = Promise.resolve()
	private persistConflictsChain: Promise<void> = Promise.resolve()

	constructor(storage: ReplicaStorage) {
		this.storage = storage
	}

	async load(): Promise<void> {
		const rawQueue = await this.storage.get(OUTBOX_STORAGE_KEY)
		if (rawQueue) {
			try {
				const parsed = JSON.parse(rawQueue) as QueuedMutation[]
				if (Array.isArray(parsed)) this.queue = parsed
			} catch {
				this.queue = []
			}
		}
		const rawConflicts = await this.storage.get(CONFLICTS_STORAGE_KEY)
		if (rawConflicts) {
			try {
				const parsed = JSON.parse(rawConflicts) as SyncConflict[]
				if (Array.isArray(parsed)) {
					const deduped = dedupeConflicts(parsed)
					this.conflicts = deduped
					if (deduped.length !== parsed.length) {
						await this.persistConflicts()
					}
				}
			} catch {
				this.conflicts = []
			}
		}
	}

	getPendingCount(): number {
		return this.queue.length
	}

	getPendingMutations(): readonly QueuedMutation[] {
		return this.queue
	}

	hasPendingForEntity(entity: MutationEntity, entityId: string): boolean {
		return this.queue.some((q) => q.envelope.entity === entity && q.envelope.entityId === entityId)
	}

	getNextAttemptAt(): number | null {
		if (this.queue.length === 0) return null
		let earliest = Number.POSITIVE_INFINITY
		for (const q of this.queue) {
			if (q.nextAttemptAt < earliest) earliest = q.nextAttemptAt
		}
		return earliest
	}

	getConflicts(): readonly SyncConflict[] {
		return this.conflicts
	}

	private writeStorageSerialized(kind: 'queue' | 'conflicts', payload: string | null): Promise<void> {
		const key = kind === 'queue' ? OUTBOX_STORAGE_KEY : CONFLICTS_STORAGE_KEY
		const run = () => (payload === null ? this.storage.delete(key) : this.storage.set(key, payload))
		if (kind === 'queue') {
			const next = this.persistQueueChain.catch(() => {}).then(run)
			this.persistQueueChain = next
			return next
		}
		const next = this.persistConflictsChain.catch(() => {}).then(run)
		this.persistConflictsChain = next
		return next
	}

	private persistQueue(): Promise<void> {
		return this.writeStorageSerialized('queue', JSON.stringify(this.queue))
	}

	private persistConflicts(): Promise<void> {
		return this.writeStorageSerialized('conflicts', JSON.stringify(this.conflicts))
	}

	/**
	 * Synchronously validate, coalesce/append into the in-memory queue, and kick
	 * off serialized storage persistence so callers can update collections before
	 * any `await` without reading stale versions.
	 */
	enqueueImmediate(item: {
		readonly envelope: MutationEnvelope
		readonly base?: Record<string, unknown> | undefined
		readonly title?: string | undefined
	}): Promise<void> {
		let lastEntityIdx = -1
		for (let i = this.queue.length - 1; i >= 0; i--) {
			const candidate = this.queue[i]
			if (
				candidate &&
				candidate.envelope.entity === item.envelope.entity &&
				candidate.envelope.entityId === item.envelope.entityId
			) {
				lastEntityIdx = i
				break
			}
		}

		const prev = lastEntityIdx >= 0 ? this.queue[lastEntityIdx] : undefined
		const canCoalesce =
			prev !== undefined &&
			item.envelope.op === 'update' &&
			prev.envelope.op === 'update' &&
			prev.retryCount === 0 &&
			!this.inFlightMutationIds.has(prev.envelope.mutationId) &&
			prev.envelope.baseVersion === item.envelope.baseVersion

		if (canCoalesce && prev) {
			const mergedQueuedAt = item.envelope.queuedAt ?? prev.envelope.queuedAt
			const mergedEntry: QueuedMutation = {
				...prev,
				title: item.title ?? prev.title,
				envelope: {
					...prev.envelope,
					mutationId: item.envelope.mutationId,
					...(mergedQueuedAt !== undefined ? { queuedAt: mergedQueuedAt } : {}),
					patch: { ...prev.envelope.patch, ...item.envelope.patch }
				}
			}
			const candidate = [...this.queue]
			candidate[lastEntityIdx] = mergedEntry
			const serialized = JSON.stringify(candidate)
			if (new TextEncoder().encode(serialized).byteLength > MAX_OUTBOX_BYTES) {
				throw new OutboxQuotaError(
					'Offline queue reached the 25 MB limit. Reconnect to sync pending changes first.'
				)
			}
			this.queue = candidate
			return this.writeStorageSerialized('queue', serialized)
		}

		if (this.queue.length >= MAX_OUTBOX_MUTATIONS) {
			throw new OutboxQuotaError(
				`Offline queue reached the ${MAX_OUTBOX_MUTATIONS}-mutation limit. Reconnect to sync before adding more changes.`
			)
		}
		const nextEntry: QueuedMutation = {
			envelope: item.envelope,
			base: item.base,
			retryCount: 0,
			nextAttemptAt: 0,
			title: item.title
		}
		const candidate = [...this.queue, nextEntry]
		const serialized = JSON.stringify(candidate)
		if (new TextEncoder().encode(serialized).byteLength > MAX_OUTBOX_BYTES) {
			throw new OutboxQuotaError(
				'Offline queue reached the 25 MB limit. Reconnect to sync pending changes first.'
			)
		}
		this.queue = candidate
		return this.writeStorageSerialized('queue', serialized)
	}

	async enqueue(item: {
		readonly envelope: MutationEnvelope
		readonly base?: Record<string, unknown> | undefined
		readonly title?: string | undefined
	}): Promise<void> {
		return this.enqueueImmediate(item)
	}

	async flush(
		transport: MutationTransport,
		callbacks: {
			readonly onApplied: (item: QueuedMutation, result: MutationResultDto) => void
			readonly onConflict: (conflict: SyncConflict) => void
			readonly onRejected: (item: QueuedMutation, status: number, error: string) => void
		},
		opts?: FlushOptions
	): Promise<FlushResult> {
		if (this.activeFlush) {
			// Signal the active pass so concurrently enqueued mutations aren't orphaned.
			this.flushRequested = true
			if (opts?.force) this.forceRequested = true
			return this.activeFlush
		}
		if (this.queue.length === 0) {
			return { cursor: null, outcomes: [], error: null, nextRetryAt: null }
		}

		this.flushRequested = false
		this.forceRequested = false
		const promise = this.runFlush(transport, callbacks, opts?.force ?? false).finally(() => {
			this.activeFlush = null
		})
		this.activeFlush = promise
		return promise
	}

	private async runFlush(
		transport: MutationTransport,
		callbacks: {
			readonly onApplied: (item: QueuedMutation, result: MutationResultDto) => void
			readonly onConflict: (conflict: SyncConflict) => void
			readonly onRejected: (item: QueuedMutation, status: number, error: string) => void
		},
		initialForce: boolean
	): Promise<FlushResult> {
		const outcomes: OutboxOutcome[] = []
		let maxCursor: number | null = null
		let forceNext = initialForce
		let autoMergePasses = 0

		try {
			while (this.queue.length > 0) {
				const effectiveForce = forceNext || this.forceRequested
				forceNext = false
				this.forceRequested = false
				this.flushRequested = false

				const now = Date.now()
				const due = effectiveForce ? [...this.queue] : this.queue.filter((q) => q.nextAttemptAt <= now)
				if (due.length === 0) break

				const batch = selectFlushBatch(due, 50)
				for (const item of batch) {
					this.inFlightMutationIds.add(item.envelope.mutationId)
				}
				let response: MutationsBatchResponse
				try {
					response = await transport.sendBatch(batch.map((b) => b.envelope))
				} finally {
					for (const item of batch) {
						this.inFlightMutationIds.delete(item.envelope.mutationId)
					}
				}
				if (response.cursor > 0) {
					maxCursor = maxCursor === null ? response.cursor : Math.max(maxCursor, response.cursor)
				}

				type QueueEntry =
					| { readonly kind: 'rebased_automerge'; readonly item: QueuedMutation }
					| { readonly kind: 'unsettled'; readonly item: QueuedMutation }

				const resultById = new Map(response.results.map((r) => [r.mutationId, r]))
				const pendingEntries: QueueEntry[] = []
				const replayedAutoMerges: QueuedMutation[] = []
				const appliedByEntity = new Map<
					string,
					{ readonly data: Record<string, unknown>; readonly version: number }
				>()
				const settledCallbacks: (() => void)[] = []
				let conflictsChanged = false
				let madeProgress = false

				for (const q of this.queue) {
					const res = resultById.get(q.envelope.mutationId)
					if (!res) {
						pendingEntries.push({ kind: 'unsettled', item: q })
						continue
					}

					// Deleting a record already missing or archived on the server is idempotently satisfied;
					// do not roll back and resurrect stale local rows.
					if (res.outcome === 'applied' || (res.outcome === 'not_found' && q.envelope.op === 'delete')) {
						madeProgress = true
						if (res.outcome === 'applied' && res.data && typeof res.data['version'] === 'number') {
							appliedByEntity.set(entityKey(q.envelope.entity, q.envelope.entityId), {
								data: res.data,
								version: res.data['version']
							})
						}
						settledCallbacks.push(() => callbacks.onApplied(q, res))
						outcomes.push({ kind: 'applied', result: res, item: q })
						continue
					}

					if (res.outcome === 'stale_version' && res.currentEntity) {
						const merge = resolveFieldMerge({
							base: q.base,
							localPatch: q.envelope.patch,
							server: res.currentEntity,
							serverChangedFields: res.changedFields
						})

						if (merge.kind === 'auto_merged') {
							if (
								q.envelope.op === 'update' &&
								Object.keys(q.envelope.patch).length > 0 &&
								Object.keys(merge.mergedPatch).length === 0
							) {
								// Server already converged to the local field values; settle without replaying an empty patch.
								const convergedVersion = res.currentVersion ?? Number(res.currentEntity['version'] ?? 1)
								const syntheticResult: MutationResultDto = {
									mutationId: q.envelope.mutationId,
									status: 200,
									outcome: 'applied',
									data: res.currentEntity
								}
								madeProgress = true
								appliedByEntity.set(entityKey(q.envelope.entity, q.envelope.entityId), {
									data: res.currentEntity,
									version: convergedVersion
								})
								settledCallbacks.push(() => callbacks.onApplied(q, syntheticResult))
								outcomes.push({ kind: 'applied', result: syntheticResult, item: q })
								continue
							}

							// Rebase disjoint changes onto the server's latest version and replay!
							const rebased: QueuedMutation = {
								...q,
								base: res.currentEntity,
								retryCount: 0,
								nextAttemptAt: 0,
								envelope: {
									...q.envelope,
									patch: merge.mergedPatch,
									baseVersion: res.currentVersion ?? Number(res.currentEntity['version'] ?? 1)
								}
							}
							replayedAutoMerges.push(rebased)
							pendingEntries.push({ kind: 'rebased_automerge', item: rebased })
							continue
						}

						madeProgress = true
						const conflict: SyncConflict = {
							id: q.envelope.mutationId,
							mutationId: q.envelope.mutationId,
							entity: q.envelope.entity,
							entityId: q.envelope.entityId,
							title: q.title ?? String(res.currentEntity['title'] ?? q.envelope.entityId),
							overlappingFields: merge.overlappingFields,
							nonConflictingPatch: merge.nonConflictingPatch,
							baseValues: q.base ?? {},
							localValues: q.envelope.patch,
							serverValues: res.currentEntity,
							serverVersion: res.currentVersion ?? Number(res.currentEntity['version'] ?? 1)
						}
						const upserted = applyConflictUpsert(this.conflicts, conflict)
						this.conflicts = upserted.next
						conflictsChanged = true
						if (upserted.active) {
							const activeConflict = upserted.active
							settledCallbacks.push(() => callbacks.onConflict(activeConflict))
							outcomes.push({ kind: 'conflict', conflict: activeConflict })
						}
						continue
					}

					// 403 / 404 / 422 — terminal rejection, roll back optimistic state.
					madeProgress = true
					const errorMsg = res.error ?? `Mutation rejected (${res.status})`
					settledCallbacks.push(() => callbacks.onRejected(q, res.status, errorMsg))
					outcomes.push({ kind: 'rejected', item: q, status: res.status, error: errorMsg })
				}

				// Advance base/baseVersion on any queued follow-ups for an entity that just applied.
				const nextQueue: QueuedMutation[] = pendingEntries.map((entry) => {
					if (entry.kind !== 'unsettled' || entry.item.envelope.op === 'create') {
						return entry.item
					}
					const applied = appliedByEntity.get(
						entityKey(entry.item.envelope.entity, entry.item.envelope.entityId)
					)
					if (!applied || (entry.item.envelope.baseVersion ?? 0) > applied.version) {
						return entry.item
					}
					return {
						...entry.item,
						base: applied.data,
						envelope: {
							...entry.item.envelope,
							baseVersion: applied.version
						}
					}
				})

				this.queue = nextQueue
				for (const cb of settledCallbacks) {
					cb()
				}
				if (conflictsChanged) {
					await this.persistConflicts()
				}
				await this.persistQueue()

				if (replayedAutoMerges.length > 0) {
					autoMergePasses += 1
					if (autoMergePasses >= 5 && !this.flushRequested) break
					continue
				}
				if (this.flushRequested) continue
				if (!madeProgress) break
			}

			return {
				cursor: maxCursor,
				outcomes,
				error: null,
				nextRetryAt: this.getNextAttemptAt()
			}
		} catch (err) {
			this.flushRequested = false
			this.forceRequested = false
			const errorObj = err instanceof Error ? err : new Error(String(err))
			const errStatus = (err as { status?: number }).status ?? 500
			// Network or 5xx transient failure: increment retry count with exponential backoff + jitter.
			const updatedQueue: QueuedMutation[] = []
			for (const q of this.queue) {
				const retryable = this.retryPolicy.shouldRetry(errorObj, q.retryCount)
				if (!retryable) {
					callbacks.onRejected(q, errStatus, errorObj.message)
					outcomes.push({ kind: 'rejected', item: q, status: errStatus, error: errorObj.message })
					continue
				}
				const delay = this.retryPolicy.calculateDelay(q.retryCount)
				updatedQueue.push({
					...q,
					retryCount: q.retryCount + 1,
					nextAttemptAt: Date.now() + delay
				})
			}
			this.queue = updatedQueue
			await this.persistQueue()
			return {
				cursor: maxCursor,
				outcomes,
				error: errorObj.message,
				nextRetryAt: this.getNextAttemptAt()
			}
		}
	}

	async resolveConflict(
		conflictId: string,
		choice: 'keep_local' | 'keep_server' | Record<string, unknown>
	): Promise<{ readonly conflict: SyncConflict; readonly rebased: MutationEnvelope | null }> {
		const conflict = this.conflicts.find((c) => c.id === conflictId)
		if (!conflict) {
			throw new Error(`Conflict "${conflictId}" not found`)
		}
		this.conflicts = this.conflicts.filter((c) => c.id !== conflictId)
		await this.persistConflicts()

		if (choice === 'keep_server') {
			return { conflict, rebased: null }
		}

		const resolvedPatch: Record<string, unknown> = { ...conflict.nonConflictingPatch }
		if (choice === 'keep_local') {
			for (const field of conflict.overlappingFields) {
				resolvedPatch[field] = conflict.localValues[field]
			}
		} else {
			for (const [k, v] of Object.entries(choice)) {
				resolvedPatch[k] = v
			}
		}

		const envelope: MutationEnvelope = {
			mutationId: generateUuidV7(),
			workspaceId: String(conflict.serverValues['workspaceId'] ?? ''),
			entity: conflict.entity,
			entityId: conflict.entityId,
			op: 'update' satisfies MutationOp,
			patch: resolvedPatch,
			baseVersion: conflict.serverVersion,
			queuedAt: new Date().toISOString()
		}

		await this.enqueue({
			envelope,
			base: conflict.serverValues,
			title: conflict.title
		})
		return { conflict, rebased: envelope }
	}

	async clearAll(): Promise<void> {
		this.queue = []
		this.conflicts = []
		await Promise.all([
			this.writeStorageSerialized('queue', null),
			this.writeStorageSerialized('conflicts', null)
		])
	}
}

export function generateUuidV7(nowMs: number = Date.now()): string {
	const bytes = new Uint8Array(16)
	crypto.getRandomValues(bytes)
	const ts = BigInt(nowMs) & 0xffffffffffffn
	for (let i = 0; i < 6; i++) {
		bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn)
	}
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
