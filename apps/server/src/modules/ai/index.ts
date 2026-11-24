/**
 * AI module (§11.3) — workspace AI settings + provider config (session-only,
 * ai.manage), summarize + semantic search (session, ai.use). The embedding
 * pipeline runs as an outbox consumer via processEmbeddingOutboxEvent.
 */
import type { Sql } from '@huriro/db'
import { Elysia } from 'elysia'
import type { Auth } from '../identity'
import { workspaceDerive } from '../tenancy'
import { processEmbeddingOutboxEvent } from './embeddings'
import type { GatewayDeps } from './gateway'
import {
	AiProviderIdParam,
	AiProviderUpsert,
	AiSemanticSearchQuery,
	AiSettingsPatch,
	AiSummarizeRequest
} from './schema'
import {
	deleteAiProvider,
	getAiSettings,
	patchAiSettings,
	semanticSearch,
	summarize,
	upsertAiProvider
} from './service'

export type { GatewayDeps }
export { processEmbeddingOutboxEvent }

export function aiModule(sql: Sql, auth: Auth | null, deps: GatewayDeps) {
	return (
		new Elysia({ name: 'huriro.ai' })
			.derive(workspaceDerive(sql, auth))
			// Settings + provider config — ai.manage (owner/admin).
			.get('/ai/settings', ({ inWorkspace }) => inWorkspace((_tx, actor) => getAiSettings(sql, actor)))
			.patch('/ai/settings', { body: AiSettingsPatch }, ({ inWorkspace, body }) =>
				inWorkspace((_tx, actor) => patchAiSettings(sql, actor, body))
			)
			.put('/ai/providers', { body: AiProviderUpsert }, ({ inWorkspace, body }) =>
				inWorkspace((_tx, actor) => upsertAiProvider(sql, actor, deps.rootSecret, body))
			)
			.delete('/ai/providers/:id', { params: AiProviderIdParam }, ({ inWorkspace, params }) =>
				inWorkspace((_tx, actor) => deleteAiProvider(sql, actor, params.id))
			)
			// AI use — ai.use (members+).
			.post('/ai/summarize', { body: AiSummarizeRequest }, ({ inWorkspace, body }) =>
				inWorkspace((_tx, actor) => summarize(sql, actor, deps, body))
			)
			.get('/ai/search', { query: AiSemanticSearchQuery }, ({ inWorkspace, query }) =>
				inWorkspace((_tx, actor) => semanticSearch(sql, actor, deps, query.q, query.limit ?? 20))
			)
	)
}
