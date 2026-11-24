/**
 * AI module repo — every query runs inside `withWorkspace` (§12.4). The
 * embedding_models registry is instance-level; everything else is tenant data.
 */
import type { Queryable } from '@huriro/db'

export interface AiProviderRow {
	readonly id: string
	readonly kind: 'openai_compatible' | 'ollama'
	readonly name: string
	readonly baseUrl: string
	readonly apiKeyEnc: string | null
	readonly chatModel: string | null
	readonly embeddingModel: string | null
	readonly isDefault: boolean
	readonly createdAt: string
}

export interface AiWorkspaceFlags {
	readonly aiEnabled: boolean
	readonly aiTracePrompts: boolean
}

export async function getAiFlags(tx: Queryable, workspaceId: string): Promise<AiWorkspaceFlags> {
	const [row] = await tx<{ aiEnabled: boolean; aiTracePrompts: boolean }[]>`
		SELECT
			COALESCE((settings->>'ai_enabled')::boolean, false) AS "aiEnabled",
			COALESCE((settings->>'ai_trace_prompts')::boolean, false) AS "aiTracePrompts"
		FROM workspaces WHERE id = ${workspaceId}
	`
	return row ?? { aiEnabled: false, aiTracePrompts: false }
}

export async function setAiFlags(
	tx: Queryable,
	workspaceId: string,
	patch: { aiEnabled?: boolean; aiTracePrompts?: boolean }
): Promise<AiWorkspaceFlags> {
	await tx`
		UPDATE workspaces
		SET settings = settings
			${patch.aiEnabled !== undefined ? tx`|| jsonb_build_object('ai_enabled', ${patch.aiEnabled}::boolean)` : tx``}
			${patch.aiTracePrompts !== undefined ? tx`|| jsonb_build_object('ai_trace_prompts', ${patch.aiTracePrompts}::boolean)` : tx``}
		WHERE id = ${workspaceId}
	`
	return getAiFlags(tx, workspaceId)
}

export async function listProviders(tx: Queryable, workspaceId: string): Promise<AiProviderRow[]> {
	return tx<AiProviderRow[]>`
		SELECT id, kind, name, base_url AS "baseUrl", api_key_enc AS "apiKeyEnc",
			chat_model AS "chatModel", embedding_model AS "embeddingModel",
			is_default AS "isDefault", created_at::text AS "createdAt"
		FROM ai_providers
		WHERE workspace_id = ${workspaceId}
		ORDER BY created_at ASC
	`
}

export async function getDefaultProvider(tx: Queryable, workspaceId: string): Promise<AiProviderRow | null> {
	const [row] = await tx<AiProviderRow[]>`
		SELECT id, kind, name, base_url AS "baseUrl", api_key_enc AS "apiKeyEnc",
			chat_model AS "chatModel", embedding_model AS "embeddingModel",
			is_default AS "isDefault", created_at::text AS "createdAt"
		FROM ai_providers
		WHERE workspace_id = ${workspaceId} AND is_default = true
		ORDER BY created_at ASC
		LIMIT 1
	`
	return row ?? null
}

export async function upsertProvider(
	tx: Queryable,
	workspaceId: string,
	args: {
		readonly kind: 'openai_compatible' | 'ollama'
		readonly name: string
		readonly baseUrl: string
		readonly apiKeyEnc: string | null | undefined
		readonly chatModel?: string | undefined
		readonly embeddingModel?: string | undefined
	}
): Promise<AiProviderRow> {
	const [row] = await tx<AiProviderRow[]>`
		INSERT INTO ai_providers (workspace_id, kind, name, base_url, api_key_enc, chat_model, embedding_model)
		VALUES (
			${workspaceId}, ${args.kind}, ${args.name}, ${args.baseUrl},
			${args.apiKeyEnc === undefined ? null : args.apiKeyEnc},
			${args.chatModel ?? null}, ${args.embeddingModel ?? null}
		)
		ON CONFLICT (workspace_id, name) DO UPDATE SET
			kind = EXCLUDED.kind,
			base_url = EXCLUDED.base_url,
			api_key_enc = COALESCE(EXCLUDED.api_key_enc, ai_providers.api_key_enc),
			chat_model = COALESCE(EXCLUDED.chat_model, ai_providers.chat_model),
			embedding_model = COALESCE(EXCLUDED.embedding_model, ai_providers.embedding_model)
		RETURNING id, kind, name, base_url AS "baseUrl", api_key_enc AS "apiKeyEnc",
			chat_model AS "chatModel", embedding_model AS "embeddingModel",
			is_default AS "isDefault", created_at::text AS "createdAt"
	`
	if (!row) throw new Error('ai provider upsert returned no row')
	return row
}

export async function deleteProvider(tx: Queryable, workspaceId: string, id: string): Promise<boolean> {
	const rows = await tx`
		DELETE FROM ai_providers WHERE workspace_id = ${workspaceId} AND id = ${id}
		RETURNING id
	`
	return rows.length > 0
}

export async function insertAiRun(
	tx: Queryable,
	workspaceId: string,
	args: {
		readonly runType: 'chat' | 'embedding' | 'summary'
		readonly providerId?: string | null
		readonly model?: string | null
		readonly userId?: string | null
		readonly tokensIn?: number | null
		readonly tokensOut?: number | null
		readonly latencyMs?: number | null
		readonly outcome: 'ok' | 'error' | 'cached'
		readonly cacheKey?: string | null
		readonly promptHash?: string | null
		readonly promptTrace?: Record<string, unknown> | null
		readonly errorCode?: string | null
	}
): Promise<void> {
	await tx`
		INSERT INTO ai_runs (
			workspace_id, run_type, provider_id, model, user_id,
			tokens_in, tokens_out, latency_ms, outcome, cache_key,
			prompt_hash, prompt_trace, error_code
		) VALUES (
			${workspaceId}, ${args.runType}, ${args.providerId ?? null}, ${args.model ?? null},
			${args.userId ?? null}, ${args.tokensIn ?? null}, ${args.tokensOut ?? null},
			${args.latencyMs ?? null}, ${args.outcome}, ${args.cacheKey ?? null},
			${args.promptHash ?? null},
			${args.promptTrace ? tx.json(args.promptTrace as never) : null},
			${args.errorCode ?? null}
		)
	`
}

export async function getCached(
	tx: Queryable,
	workspaceId: string,
	cacheKey: string
): Promise<Record<string, unknown> | null> {
	// Lazy expiry sweep on read — keeps the cache self-cleaning without a job.
	await tx`DELETE FROM ai_cache WHERE workspace_id = ${workspaceId} AND expires_at <= now()`
	const [hit] = await tx<{ response: Record<string, unknown> }[]>`
		SELECT response FROM ai_cache
		WHERE workspace_id = ${workspaceId} AND cache_key = ${cacheKey}
	`
	return hit?.response ?? null
}

export async function setCached(
	tx: Queryable,
	workspaceId: string,
	cacheKey: string,
	model: string,
	response: Record<string, unknown>,
	ttlSeconds: number
): Promise<void> {
	await tx`
		INSERT INTO ai_cache (workspace_id, cache_key, model, response, expires_at)
		VALUES (${workspaceId}, ${cacheKey}, ${model}, ${tx.json(response as never)},
			now() + (${ttlSeconds} || ' seconds')::interval)
		ON CONFLICT (workspace_id, cache_key) DO UPDATE
		SET response = EXCLUDED.response, model = EXCLUDED.model,
			created_at = now(), expires_at = EXCLUDED.expires_at
	`
}

// ---------- embedding registry + chunks ----------

export interface EmbeddingModelRow {
	readonly id: string
	readonly provider: string
	readonly dimensions: number
	readonly isActive: boolean
}

export async function getEmbeddingModel(tx: Queryable, id: string): Promise<EmbeddingModelRow | null> {
	const [row] = await tx<EmbeddingModelRow[]>`
		SELECT id, provider, dimensions, is_active AS "isActive"
		FROM embedding_models WHERE id = ${id}
	`
	return row ?? null
}

/** Replace an entity's chunks for a model (content-hash diff done by caller). */
export async function upsertChunks(
	tx: Queryable,
	workspaceId: string,
	args: {
		readonly entityType: string
		readonly entityId: string
		readonly modelId: string
		readonly chunks: readonly { chunkIx: number; contentHash: string; embedding: readonly number[] }[]
	}
): Promise<void> {
	// Replace wholesale per (entity, model): chunk count can shrink on edits.
	await tx`
		DELETE FROM chunk_embeddings
		WHERE workspace_id = ${workspaceId}
			AND entity_type = ${args.entityType}
			AND entity_id = ${args.entityId}
			AND model_id = ${args.modelId}
	`
	for (const c of args.chunks) {
		const vec = `[${c.embedding.join(',')}]`
		await tx`
			INSERT INTO chunk_embeddings
				(workspace_id, entity_type, entity_id, chunk_ix, content_hash, model_id, embedding)
			VALUES (
				${workspaceId}, ${args.entityType}, ${args.entityId}, ${c.chunkIx},
				${c.contentHash}, ${args.modelId}, ${vec}::halfvec
			)
		`
	}
}

export async function getChunkHashes(
	tx: Queryable,
	workspaceId: string,
	entityType: string,
	entityId: string,
	modelId: string
): Promise<Map<number, string>> {
	const rows = await tx<{ chunkIx: number; contentHash: string }[]>`
		SELECT chunk_ix AS "chunkIx", content_hash AS "contentHash"
		FROM chunk_embeddings
		WHERE workspace_id = ${workspaceId}
			AND entity_type = ${entityType}
			AND entity_id = ${entityId}
			AND model_id = ${modelId}
	`
	return new Map(rows.map((r) => [r.chunkIx, r.contentHash]))
}

export async function deleteEntityChunks(
	tx: Queryable,
	workspaceId: string,
	entityType: string,
	entityId: string
): Promise<void> {
	await tx`
		DELETE FROM chunk_embeddings
		WHERE workspace_id = ${workspaceId}
			AND entity_type = ${entityType}
			AND entity_id = ${entityId}
	`
}

export interface SemanticHitRow {
	readonly entityType: string
	readonly entityId: string
	readonly title: string
	readonly snippet: string
	readonly distance: number
}

/**
 * Vector KNN over chunk_embeddings joined to search_documents for display —
 * with the SAME ACL predicate shape as executeSearchQuery (§11.4: permission
 * filter is a SQL predicate, not a post-filter). Dimensions come from the
 * embedding_models row (server-controlled int) — the halfvec typmod can't be
 * a bind parameter, so it's interpolated by the caller via unsafe().
 */
export async function vectorSearch(
	tx: Queryable,
	args: {
		readonly workspaceId: string
		readonly userId: string
		readonly isGuest: boolean
		readonly bypassAcl: boolean
		readonly modelId: string
		readonly dimensions: number
		readonly queryEmbedding: readonly number[]
		readonly limit: number
	}
): Promise<SemanticHitRow[]> {
	const vec = `[${args.queryEmbedding.join(',')}]`
	// $1 embedding, $2 workspace, $3 user, $4 isGuest, $5 bypassAcl,
	// $6 modelId, $7 candidate k, $8 limit — dims interpolated (int from registry).
	const rows = await tx.unsafe<SemanticHitRow[]>(
		`
		WITH knn AS (
			SELECT entity_type, entity_id,
				MIN(embedding::halfvec(${args.dimensions}) <=> $1::halfvec(${args.dimensions})) AS dist
			FROM chunk_embeddings
			WHERE workspace_id = $2 AND model_id = $6
			GROUP BY entity_type, entity_id
			ORDER BY dist ASC
			LIMIT $7
		)
		SELECT
			sd.entity_type AS "entityType",
			sd.entity_id AS "entityId",
			sd.title,
			left(coalesce(nullif(sd.body, ''), sd.title), 280) AS snippet,
			knn.dist::float8 AS distance
		FROM knn
		JOIN search_documents sd
			ON sd.workspace_id = $2
			AND sd.entity_type = knn.entity_type
			AND sd.entity_id = knn.entity_id
		LEFT JOIN projects proj
			ON proj.workspace_id = sd.workspace_id AND proj.id = sd.project_id
		LEFT JOIN doc_pages dp
			ON sd.entity_type = 'doc_page'
			AND dp.workspace_id = sd.workspace_id AND dp.id = sd.entity_id AND dp.archived_at IS NULL
		WHERE (sd.entity_type <> 'doc_page' OR dp.id IS NOT NULL)
			AND (
				$5
				OR (
					sd.entity_type = 'doc_page'
					AND dp.id IS NOT NULL
					AND (
						($4 = false AND dp.visibility = 'workspace')
						OR can_read(sd.workspace_id, 'doc_page', dp.id, $3, 'read')
					)
				)
				OR (
					sd.entity_type <> 'doc_page'
					AND (
						($4 = false AND (proj.id IS NULL OR proj.visibility = 'workspace'
							OR can_read(sd.workspace_id, 'project', proj.id, $3, 'read')))
						OR ($4 = true AND proj.id IS NOT NULL
							AND can_read(sd.workspace_id, 'project', proj.id, $3, 'read'))
					)
				)
			)
		ORDER BY knn.dist ASC
		LIMIT $8
		`,
		[
			vec,
			args.workspaceId,
			args.userId,
			args.isGuest,
			args.bypassAcl,
			args.modelId,
			args.limit * 4,
			args.limit
		]
	)
	return rows
}
