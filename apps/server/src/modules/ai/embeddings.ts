/**
 * Embedding pipeline (§11.1): search_documents → ~1.5k-char chunks →
 * chunk_embeddings, keyed by content_hash so unchanged chunks skip
 * re-embedding. Runs as an outbox consumer in the worker drain — two-phase:
 * diff inside the tenant tx, provider call outside it, write-back in a fresh
 * tx (no network inside a DB lock).
 */
import { createHash } from 'node:crypto'
import type { Sql } from '@huriro/db'
import { withWorkspace } from '@huriro/db'
import type { GatewayDeps } from './gateway'
import { embed } from './gateway'
import {
	deleteEntityChunks,
	getAiFlags,
	getChunkHashes,
	getDefaultProvider,
	getEmbeddingModel,
	upsertChunks
} from './repo'

const CHUNK_CHARS = 1500
const CHUNK_OVERLAP = 150
const MAX_CHUNKS_PER_DOC = 64

export function chunkText(title: string, body: string): readonly string[] {
	const full = `${title}\n\n${body}`.trim()
	if (full.length === 0) return []
	const chunks: string[] = []
	for (let start = 0; start < full.length && chunks.length < MAX_CHUNKS_PER_DOC; ) {
		chunks.push(full.slice(start, start + CHUNK_CHARS))
		start += CHUNK_CHARS - CHUNK_OVERLAP
	}
	return chunks
}

function hash(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 32)
}

interface EmbeddingEvent {
	readonly workspaceId: string | null
	readonly eventType: string
	readonly payload: Record<string, unknown>
}

const DELETED_RE = /\.deleted\.v1$/
const UPSERTED_RE = /\.(created|updated)\.v1$/
const EMBEDDED_TYPES = new Set(['issue', 'doc_page'])

function entityFrom(event: EmbeddingEvent): { entityType: string; entityId: string } | null {
	const p = event.payload
	if (event.eventType.startsWith('tasks.issue.')) {
		const id = typeof p['issueId'] === 'string' ? p['issueId'] : null
		return id ? { entityType: 'issue', entityId: id } : null
	}
	if (event.eventType.startsWith('docs.page.')) {
		const id = typeof p['pageId'] === 'string' ? p['pageId'] : null
		return id ? { entityType: 'doc_page', entityId: id } : null
	}
	return null
}

/**
 * Called from drainOutboxOnce for every outbox row (after search indexing).
 * Returns true when the event was handled (or correctly ignored); throws are
 * the drain's retry signal, same contract as other consumers.
 */
export async function processEmbeddingOutboxEvent(
	app: Sql,
	event: EmbeddingEvent,
	deps: GatewayDeps
): Promise<boolean> {
	if (!event.workspaceId) return false
	const entity = entityFrom(event)
	if (!entity || !EMBEDDED_TYPES.has(entity.entityType)) return false
	if (!DELETED_RE.test(event.eventType) && !UPSERTED_RE.test(event.eventType)) return false

	// Phase 1 (inside tenant tx): flags + provider + content diff.
	const plan = await withWorkspace(app, { workspaceId: event.workspaceId }, async (tx) => {
		const flags = await getAiFlags(tx, event.workspaceId as string)
		if (!flags.aiEnabled) return null
		const provider = await getDefaultProvider(tx, event.workspaceId as string)
		if (!provider?.embeddingModel) return null

		if (DELETED_RE.test(event.eventType)) {
			await deleteEntityChunks(tx, event.workspaceId as string, entity.entityType, entity.entityId)
			return null
		}

		const [doc] = await tx<{ title: string; body: string }[]>`
			SELECT title, body FROM search_documents
			WHERE workspace_id = ${event.workspaceId}
				AND entity_type = ${entity.entityType}
				AND entity_id = ${entity.entityId}
		`
		if (!doc) {
			await deleteEntityChunks(tx, event.workspaceId as string, entity.entityType, entity.entityId)
			return null
		}

		const texts = chunkText(doc.title, doc.body)
		const existing = await getChunkHashes(
			tx,
			event.workspaceId as string,
			entity.entityType,
			entity.entityId,
			provider.embeddingModel
		)
		const wanted = texts.map((text, i) => ({ chunkIx: i, text, contentHash: hash(text) }))
		const dirty = wanted.filter((w) => existing.get(w.chunkIx) !== w.contentHash)
		// Whole-doc replace when any chunk changed or count differs — keeps
		// chunk_ix alignment simple at v1 scale.
		if (dirty.length === 0 && existing.size === wanted.length) return null
		return { provider, modelId: provider.embeddingModel, texts: wanted.map((w) => w.text), wanted }
	})
	if (!plan) return true

	const model = await withWorkspace(app, { workspaceId: event.workspaceId }, (tx) =>
		getEmbeddingModel(tx, plan.modelId)
	)
	if (!model) return true

	// Phase 2 (outside tx): provider call.
	const vectors = await withWorkspace(app, { workspaceId: event.workspaceId }, (tx) =>
		embed(tx, deps, event.workspaceId as string, null, plan.provider, plan.texts, model.id)
	)

	// Phase 3 (fresh tenant tx): write-back.
	await withWorkspace(app, { workspaceId: event.workspaceId }, (tx) =>
		upsertChunks(tx, event.workspaceId as string, {
			entityType: entity.entityType,
			entityId: entity.entityId,
			modelId: model.id,
			chunks: plan.wanted.map((w, i) => ({
				chunkIx: w.chunkIx,
				contentHash: w.contentHash,
				embedding: vectors[i] ?? []
			}))
		})
	)
	return true
}
