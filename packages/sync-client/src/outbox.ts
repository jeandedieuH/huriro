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

export class HuriroMutationOutbox {
	private readonly storage: ReplicaStorage
	private readonly retryPolicy = new DefaultRetryPolicy()
	private queue: QueuedMutation[] = []
	private conflicts: SyncConflict[] = []
	private flushing = false

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
				if (Array.isArray(parsed)) this.conflicts = parsed
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

	getConflicts(): readonly SyncConflict[] {
		return this.conflicts
	}

	private async persistQueue(): Promise<void> {
		await this.storage.set(OUTBOX_STORAGE_KEY, JSON.stringify(this.queue))
	}

	private async persistConflicts(): Promise<void> {
		await this.storage.set(CONFLICTS_STORAGE_KEY, JSON.stringify(this.conflicts))
	}

	async enqueue(item: {
		readonly envelope: MutationEnvelope
		readonly base?: Record<string, unknown> | undefined
		readonly title?: string | undefined
	}): Promise<void> {
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
		await this.storage.set(OUTBOX_STORAGE_KEY, serialized)
	}

	async flush(
		transport: MutationTransport,
		callbacks: {
			readonly onApplied: (item: QueuedMutation, result: MutationResultDto) => void
			readonly onConflict: (conflict: SyncConflict) => void
			readonly onRejected: (item: QueuedMutation, status: number, error: string) => void
		}
	): Promise<{ readonly cursor: number | null; readonly outcomes: OutboxOutcome[] }> {
		if (this.flushing || this.queue.length === 0) {
			return { cursor: null, outcomes: [] }
		}
		this.flushing = true
		const outcomes: OutboxOutcome[] = []
		let maxCursor: number | null = null

		try {
			const now = Date.now()
			const due = this.queue.filter((q) => q.nextAttemptAt <= now)
			if (due.length === 0) return { cursor: null, outcomes: [] }

			const batch = due.slice(0, 50)
			const response = await transport.sendBatch(batch.map((b) => b.envelope))
			maxCursor = response.cursor

			const resultById = new Map(response.results.map((r) => [r.mutationId, r]))
			const nextQueue: QueuedMutation[] = []
			const replayedAutoMerges: QueuedMutation[] = []

			for (const q of this.queue) {
				const res = resultById.get(q.envelope.mutationId)
				if (!res) {
					nextQueue.push(q)
					continue
				}

				if (res.outcome === 'applied') {
					callbacks.onApplied(q, res)
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
						// Rebase disjoint changes onto the server's latest version and replay!
						const rebased: QueuedMutation = {
							...q,
							base: res.currentEntity,
							envelope: {
								...q.envelope,
								patch: merge.mergedPatch,
								baseVersion: res.currentVersion ?? Number(res.currentEntity['version'] ?? 1)
							}
						}
						replayedAutoMerges.push(rebased)
						nextQueue.push(rebased)
						continue
					}

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
					this.conflicts = [...this.conflicts.filter((c) => c.id !== conflict.id), conflict]
					await this.persistConflicts()
					callbacks.onConflict(conflict)
					outcomes.push({ kind: 'conflict', conflict })
					continue
				}

				// 403 / 404 / 422 — terminal rejection, roll back optimistic state.
				const errorMsg = res.error ?? `Mutation rejected (${res.status})`
				callbacks.onRejected(q, res.status, errorMsg)
				outcomes.push({ kind: 'rejected', item: q, status: res.status, error: errorMsg })
			}

			this.queue = nextQueue
			await this.persistQueue()

			if (replayedAutoMerges.length > 0) {
				this.flushing = false
				const followUp = await this.flush(transport, callbacks)
				if (followUp.cursor !== null) {
					maxCursor = maxCursor === null ? followUp.cursor : Math.max(maxCursor, followUp.cursor)
				}
				outcomes.push(...followUp.outcomes)
			}

			return { cursor: maxCursor, outcomes }
		} catch (err) {
			// Network or 5xx transient failure: increment retry count with exponential backoff + jitter.
			const updatedQueue: QueuedMutation[] = []
			for (const q of this.queue) {
				const retryable = this.retryPolicy.shouldRetry(
					err instanceof Error ? err : new Error(String(err)),
					q.retryCount
				)
				if (!retryable) {
					callbacks.onRejected(q, 500, 'Retry limit exceeded')
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
			return { cursor: null, outcomes }
		} finally {
			this.flushing = false
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
		await this.storage.delete(OUTBOX_STORAGE_KEY)
		await this.storage.delete(CONFLICTS_STORAGE_KEY)
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
