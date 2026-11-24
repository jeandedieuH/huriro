// AI gateway tables — owned by the `ai` module (§11.3, §5.4). Provider config
// is per-workspace (BYO key, envelope-encrypted); ai_runs is the append-only
// metering ledger; chunk_embeddings backs semantic search v1 with a
// dimension-less `halfvec` column + per-model partial HNSW indexes (§11.1).
import { sql } from 'drizzle-orm'
import {
	boolean,
	customType,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid
} from 'drizzle-orm/pg-core'
import { users } from './identity'
import { workspaces } from './tenancy'

/** pgvector halfvec — dimension-less; the typed cast lives in the index. */
const halfvec = customType<{ data: string; driverData: string }>({
	dataType() {
		return 'halfvec'
	}
})

/** Instance-level model registry — no tenant scope by design. */
export const embeddingModels = pgTable('embedding_models', {
	id: text('id').primaryKey(),
	provider: text('provider').notNull(),
	dimensions: integer('dimensions').notNull(),
	isActive: boolean('is_active').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const aiProviders = pgTable(
	'ai_providers',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		id: uuid('id').notNull().default(sql`uuidv7()`),
		kind: text('kind', { enum: ['openai_compatible', 'ollama'] }).notNull(),
		name: text('name').notNull(),
		baseUrl: text('base_url').notNull(),
		apiKeyEnc: text('api_key_enc'),
		chatModel: text('chat_model'),
		embeddingModel: text('embedding_model').references(() => embeddingModels.id),
		isDefault: boolean('is_default').notNull().default(true),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_ai_providers_ws_id').on(t.workspaceId, t.id),
		unique('uq_ai_providers_ws_name').on(t.workspaceId, t.name)
	]
)

export const aiRuns = pgTable(
	'ai_runs',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		id: uuid('id').notNull().default(sql`uuidv7()`),
		runType: text('run_type', { enum: ['chat', 'embedding', 'summary'] }).notNull(),
		providerId: uuid('provider_id'),
		model: text('model'),
		userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
		tokensIn: integer('tokens_in'),
		tokensOut: integer('tokens_out'),
		latencyMs: integer('latency_ms'),
		outcome: text('outcome', { enum: ['ok', 'error', 'cached'] }).notNull(),
		cacheKey: text('cache_key'),
		promptHash: text('prompt_hash'),
		promptTrace: jsonb('prompt_trace'),
		errorCode: text('error_code'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_ai_runs_ws_id').on(t.workspaceId, t.id),
		index('idx_ai_runs_ws_created').on(t.workspaceId, t.createdAt),
		index('idx_ai_runs_cache').on(t.workspaceId, t.cacheKey)
	]
)

export const aiCache = pgTable('ai_cache', {
	workspaceId: uuid('workspace_id')
		.notNull()
		.references(() => workspaces.id, { onDelete: 'cascade' }),
	cacheKey: text('cache_key').notNull(),
	model: text('model').notNull(),
	response: jsonb('response').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
})

export const chunkEmbeddings = pgTable(
	'chunk_embeddings',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		id: uuid('id').notNull().default(sql`uuidv7()`),
		entityType: text('entity_type').notNull(),
		entityId: uuid('entity_id').notNull(),
		chunkIx: integer('chunk_ix').notNull(),
		contentHash: text('content_hash').notNull(),
		modelId: text('model_id')
			.notNull()
			.references(() => embeddingModels.id),
		embedding: halfvec('embedding').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		unique('uq_chunk_embeddings_ws_id').on(t.workspaceId, t.id),
		unique('uq_chunk_embeddings_entity_chunk_model').on(
			t.workspaceId,
			t.entityType,
			t.entityId,
			t.chunkIx,
			t.modelId
		),
		index('idx_chunk_ws').on(t.workspaceId, t.modelId)
	]
)
